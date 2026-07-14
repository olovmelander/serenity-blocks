import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
    MessageTypes,
    PROTOCOL_CATALOG,
} from '../../src/core/network/message-types.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcRoot = path.join(repoRoot, 'src');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts']);

const SEND_BOUNDARIES = new Map([
    ['sendP2PMessage', 1],
    ['sendReliable', 1],
    ['sendUnreliable', 1],
    ['sendUnreliableNoDelay', 1],
    ['broadcastToAll', 0],
    ['broadcastSnapshot', 0],
    ['broadcastToPeers', 0],
]);

// These are the only dynamic forwarding calls in production. They accept a
// caller-owned, catalog-validated type and forward it without declaring a new
// wire type. Identify them structurally by class + method, never by line number.
const FORWARDER_BOUNDARIES = new Map([
    ['FFAGameStateP2P.broadcastToPeers', new Set(['sendP2PMessage'])],
    ['NetworkHandlerRegistry.register', new Set(['on'])],
    ['NetworkHandlerRegistry.dispose', new Set(['off'])],
]);

function listSourceFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...listSourceFiles(absolutePath));
        } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            files.push(absolutePath);
        }
    }
    return files;
}

function scriptKindFor(file) {
    if (file.endsWith('.ts')) return ts.ScriptKind.TS;
    return ts.ScriptKind.JS;
}

function propertyNameText(name, sourceFile) {
    if (!name) return null;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    return name.getText(sourceFile);
}

function enclosingMethodIdentity(node, sourceFile) {
    let methodName = null;
    let className = null;
    let current = node.parent;

    while (current) {
        if (!methodName && ts.isMethodDeclaration(current)) {
            methodName = propertyNameText(current.name, sourceFile);
        }
        if (ts.isClassDeclaration(current)) {
            className = current.name?.text || '<anonymous>';
            break;
        }
        current = current.parent;
    }

    return className && methodName ? `${className}.${methodName}` : null;
}

function callName(expression) {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
}

function collectNetworkRegistryBindings(sourceFile) {
    const bindings = new Set();

    function visit(node) {
        if (ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.initializer
            && ts.isCallExpression(node.initializer)
            && callName(node.initializer.expression) === 'createNetworkHandlerRegistry') {
            bindings.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return bindings;
}

function isThisExpression(node) {
    return node.kind === ts.SyntaxKind.ThisKeyword;
}

function isDirectNetworkReceiver(receiver, enclosingIdentity) {
    if (ts.isIdentifier(receiver)) {
        return receiver.text === 'network' || receiver.text === 'steamNetworking';
    }
    if (ts.isPropertyAccessExpression(receiver)) {
        return receiver.name.text === 'network' || receiver.name.text === 'steamNetworking';
    }
    return isThisExpression(receiver) && enclosingIdentity?.startsWith('SteamNetworking.');
}

function unwrapExpression(node) {
    let current = node;
    while (current && (ts.isParenthesizedExpression(current)
        || ts.isAsExpression(current)
        || ts.isNonNullExpression(current))) {
        current = current.expression;
    }
    return current;
}

function resolveMessageType(argument) {
    const expression = unwrapExpression(argument);
    if (!expression
        || !ts.isPropertyAccessExpression(expression)
        || !ts.isIdentifier(expression.expression)
        || expression.expression.text !== 'MessageTypes') {
        return null;
    }

    const key = expression.name.text;
    return {
        key,
        value: MessageTypes[key],
    };
}

function scanFile(file) {
    const source = readFileSync(file, 'utf8');
    const relativeFile = path.relative(repoRoot, file).replace(/\\/g, '/');
    const sourceFile = ts.createSourceFile(
        relativeFile,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(file),
    );
    const registryBindings = collectNetworkRegistryBindings(sourceFile);
    const violations = [];

    function visit(node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const methodName = node.expression.name.text;
            const receiver = node.expression.expression;
            const enclosingIdentity = enclosingMethodIdentity(node, sourceFile);
            const ignoredMethods = enclosingIdentity
                ? FORWARDER_BOUNDARIES.get(enclosingIdentity)
                : null;

            if (!ignoredMethods?.has(methodName)) {
                let argumentIndex = SEND_BOUNDARIES.get(methodName);

                if (argumentIndex === undefined
                    && methodName === 'register'
                    && ts.isIdentifier(receiver)
                    && registryBindings.has(receiver.text)) {
                    argumentIndex = 0;
                }

                if (argumentIndex === undefined
                    && (methodName === 'on' || methodName === 'off')
                    && isDirectNetworkReceiver(receiver, enclosingIdentity)) {
                    argumentIndex = 0;
                }

                if (argumentIndex !== undefined) {
                    const argument = node.arguments[argumentIndex];
                    const resolved = resolveMessageType(argument);
                    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
                    const site = `${relativeFile}:${line + 1}:${character + 1}`;

                    if (!resolved) {
                        violations.push(`${site} ${methodName} must use MessageTypes.<KEY>; found ${argument?.getText(sourceFile) || '<missing>'}`);
                    } else if (!resolved.value) {
                        violations.push(`${site} ${methodName} references unknown MessageTypes.${resolved.key}`);
                    } else if (PROTOCOL_CATALOG[resolved.value]?.status !== 'supported') {
                        violations.push(`${site} ${methodName} uses unsupported MessageTypes.${resolved.key}`);
                    }
                }
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return violations;
}

describe('wire message source contract', () => {
    it('uses declared, supported MessageTypes constants at every leaf send and registration site', () => {
        const violations = listSourceFiles(srcRoot)
            .flatMap((file) => scanFile(file));

        expect(
            violations,
            'Wire calls must name a supported MessageTypes constant; declare/catalog the type instead of using a literal or dynamic leaf argument.',
        ).toEqual([]);
    }, 30_000);
});
