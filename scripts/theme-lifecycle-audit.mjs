// Theme lifecycle audit - static guardrail for the theme disposal contract.
//
// ThemeManager calls cleanup(), and BaseTheme.cleanup() calls
// releaseInactiveResources() -> stop(). The audit protects that path from:
//
//   1. cleanup() overrides that skip super.cleanup().
//   2. stop() overrides that skip super.stop().
//   3. add/removeEventListener calls with an inline .bind(this).
//   4. raw window resize listeners with no visible removal path.
//   5. dispose() methods with no stop()/cleanup() adapter. ThemeManager does
//      not call the legacy dispose() convention directly.
//   6. super.dispose() calls. BaseTheme has no dispose() method.
//   7. asynchronous teardown overrides. ThemeManager teardown is deliberately
//      synchronous, so an async override would publish terminal state too late.
//   8. animation-loop RAFs that are neither registered nor stored on the theme.
//   9. WebGPURenderer.init() calls with no lifecycle-owned late-retirement path.
//  10. stop()/cleanup() returns that can bypass the corresponding BaseTheme
//      teardown, or stop() work gated on activity flags the manager invalidates
//      before it enters terminal cleanup.
//
// The checker parses source instead of searching raw text. That keeps comments,
// strings, and helper classes from satisfying or violating a BaseTheme
// subclass's lifecycle contract, and lets the same audit cover JS and TS.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Audit/parser tooling is intentionally a development-only dependency.
// eslint-disable-next-line import/no-extraneous-dependencies
import ts from 'typescript';

export function isAuditedThemeSource(fileName) {
    return fileName.endsWith('.js') || fileName.endsWith('.ts');
}

function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(fullPath));
        } else if (entry.isFile() && isAuditedThemeSource(entry.name)) {
            files.push(fullPath);
        }
    }

    return files;
}

function isClassLike(node) {
    return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

function isBaseThemeSubclass(node, sourceFile) {
    const extendsClause = node.heritageClauses?.find(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    );

    return extendsClause?.types.some(
        (type) => type.expression.getText(sourceFile) === 'BaseTheme',
    ) ?? false;
}

function collectBaseThemeSubclasses(sourceFile) {
    const subclasses = [];

    function visit(node) {
        if (isClassLike(node) && isBaseThemeSubclass(node, sourceFile)) {
            subclasses.push(node);
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return subclasses;
}

function getMemberName(member, sourceFile) {
    if (!member.name) return null;
    if (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)) {
        return member.name.text;
    }
    return member.name.getText(sourceFile);
}

function isCallableMember(member) {
    if (ts.isMethodDeclaration(member)) return true;
    return ts.isPropertyDeclaration(member)
        && Boolean(member.initializer)
        && (
            ts.isArrowFunction(member.initializer)
            || ts.isFunctionExpression(member.initializer)
        );
}

function isAsyncCallableMember(member) {
    const callable = ts.isPropertyDeclaration(member)
        ? member.initializer
        : member;
    return Boolean(callable?.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
    ));
}

function getMethods(classNode, methodName, sourceFile) {
    return classNode.members.filter(
        (member) => isCallableMember(member)
            && getMemberName(member, sourceFile) === methodName,
    );
}

/**
 * Traverse executable syntax while treating nested classes as separate
 * ownership scopes.
 */
function nodeContains(root, predicate) {
    let found = false;

    function visit(node) {
        if (found) return;
        if (node !== root && isClassLike(node)) return;
        if (predicate(node)) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    }

    visit(root);
    return found;
}

function isSuperMethodCall(node, methodName) {
    return ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.kind === ts.SyntaxKind.SuperKeyword
        && node.expression.name.text === methodName;
}

function callsSuperMethod(methods, methodName) {
    return methods.some(
        (method) => nodeContains(
            method,
            (node) => isSuperMethodCall(node, methodName),
        ),
    );
}

function getCallableRoot(member) {
    return ts.isPropertyDeclaration(member)
        ? member.initializer
        : member;
}

/**
 * Collect nodes owned by one lifecycle callable. Nested functions/classes are
 * separate execution scopes: a return or super call inside one cannot satisfy
 * the enclosing lifecycle method's synchronous teardown contract.
 */
function collectCallableNodes(member, predicate) {
    const root = getCallableRoot(member);
    const matches = [];
    if (!root) return matches;

    function visit(node) {
        if (
            node !== root
            && (
                isClassLike(node)
                || ts.isFunctionLike(node)
            )
        ) {
            return;
        }
        if (predicate(node)) {
            matches.push(node);
        }
        ts.forEachChild(node, visit);
    }

    visit(root);
    return matches;
}

function isAllowedCleanupIdempotenceReturn(returnNode, member, sourceFile) {
    const root = getCallableRoot(member);
    let ancestor = returnNode.parent;
    while (ancestor && ancestor !== root) {
        if (ts.isIfStatement(ancestor)) {
            const condition = ancestor.expression.getText(sourceFile);
            if (
                /\bthis\.cleanupComplete\b/.test(condition)
                || /\bthis\.cleanupInProgress\b/.test(condition)
            ) {
                return true;
            }
        }
        ancestor = ancestor.parent;
    }
    return false;
}

function canReturnBeforeSuper(member, methodName, sourceFile) {
    const superCalls = collectCallableNodes(
        member,
        (node) => isSuperMethodCall(node, methodName),
    );
    if (superCalls.length === 0) return false;

    const firstSuperCall = Math.min(...superCalls.map((node) => node.getStart(sourceFile)));
    return collectCallableNodes(member, ts.isReturnStatement).some((returnNode) => (
        returnNode.getStart(sourceFile) < firstSuperCall
        && !(
            methodName === 'cleanup'
            && isAllowedCleanupIdempotenceReturn(returnNode, member, sourceFile)
        )
    ));
}

function hasActivityGatedStop(member, sourceFile) {
    return collectCallableNodes(member, ts.isIfStatement).some((ifStatement) => (
        /\bthis\.(?:isActive|isPaused)\b/.test(
            ifStatement.expression.getText(sourceFile),
        )
        && nodeContains(
            ifStatement.thenStatement,
            (node) => (
                ts.isReturnStatement(node)
                || (
                    ts.isCallExpression(node)
                    && ts.isPropertyAccessExpression(node.expression)
                    && /^(?:cancel|cleanup|clear|dispose|release|remove|stop|teardown)/i
                        .test(node.expression.name.text)
                )
            ),
        )
    ));
}

function isWindowMethodCall(node, methodName) {
    return ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'window'
        && node.expression.name.text === methodName;
}

function isThisMethodCall(node, methodName) {
    return ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
        && node.expression.name.text === methodName;
}

function isRequestAnimationFrameCall(node) {
    if (!ts.isCallExpression(node)) return false;
    if (ts.isIdentifier(node.expression)) {
        return node.expression.text === 'requestAnimationFrame';
    }
    return ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'window'
        && node.expression.name.text === 'requestAnimationFrame';
}

function isRendererInitCall(node) {
    return ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'init'
        && /renderer/i.test(node.expression.expression.getText());
}

function storesCallOnThis(call) {
    const { parent } = call;
    return ts.isBinaryExpression(parent)
        && parent.right === call
        && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(parent.left)
        && parent.left.expression.kind === ts.SyntaxKind.ThisKeyword;
}

function isStringArgument(node, value) {
    return Boolean(node) && ts.isStringLiteralLike(node) && node.text === value;
}

function containsBindThis(node) {
    if (!node) return false;
    return nodeContains(
        node,
        (candidate) => ts.isCallExpression(candidate)
            && ts.isPropertyAccessExpression(candidate.expression)
            && candidate.expression.name.text === 'bind'
            && candidate.arguments.some(
                (argument) => argument.kind === ts.SyntaxKind.ThisKeyword,
            ),
    );
}

/**
 * Analyze one source file for lifecycle-contract violations.
 * Exported for unit tests (tests/unit/theme-lifecycle-audit.test.js).
 *
 * Only classes that directly extend BaseTheme are inspected.
 *
 * @param {string} source - JS/TS source containing a theme implementation
 * @param {string} [fileName='theme.js'] - filename used to select parser mode
 * @returns {string[]} human-readable issue strings (empty = clean)
 */
export function analyzeThemeSource(source, fileName = 'theme.js') {
    const scriptKind = fileName.endsWith('.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
    const sourceFile = ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKind,
    );
    const issues = new Set();

    collectBaseThemeSubclasses(sourceFile).forEach((classNode) => {
        const cleanupMethods = getMethods(classNode, 'cleanup', sourceFile);
        const stopMethods = getMethods(classNode, 'stop', sourceFile);
        const disposeMethods = getMethods(classNode, 'dispose', sourceFile);
        const releaseMethods = getMethods(
            classNode,
            'releaseInactiveResources',
            sourceFile,
        );

        if (
            cleanupMethods.length > 0
            && !callsSuperMethod(cleanupMethods, 'cleanup')
        ) {
            issues.add('cleanup() without super.cleanup()');
        }

        // stop() overrides must chain to super.stop() so the base safety nets
        // (cancelAnimationFrames, clearTrackedResources) always run.
        if (stopMethods.length > 0 && !callsSuperMethod(stopMethods, 'stop')) {
            issues.add('stop() without super.stop()');
        }

        if (
            stopMethods.some((method) => canReturnBeforeSuper(
                method,
                'stop',
                sourceFile,
            ))
        ) {
            issues.add('stop() can return before super.stop()');
        }

        if (
            cleanupMethods.some((method) => canReturnBeforeSuper(
                method,
                'cleanup',
                sourceFile,
            ))
        ) {
            issues.add('cleanup() can return before super.cleanup()');
        }

        if (
            stopMethods.some((method) => hasActivityGatedStop(method, sourceFile))
        ) {
            issues.add('stop() teardown gated by activity state');
        }

        if (
            disposeMethods.length > 0
            && stopMethods.length === 0
            && cleanupMethods.length === 0
        ) {
            issues.add('dispose() without stop()/cleanup() adapter');
        }

        if (
            nodeContains(
                classNode,
                (node) => isSuperMethodCall(node, 'dispose'),
            )
        ) {
            issues.add('super.dispose() call (BaseTheme has no dispose())');
        }

        [
            ['stop', stopMethods],
            ['cleanup', cleanupMethods],
            ['dispose', disposeMethods],
            ['releaseInactiveResources', releaseMethods],
        ].forEach(([methodName, methods]) => {
            if (methods.some(isAsyncCallableMember)) {
                issues.add(
                    `async ${methodName}() is unsupported by synchronous teardown`,
                );
            }
        });

        const hasRendererInit = nodeContains(classNode, isRendererInitCall);
        const usesOwnedRendererInit = nodeContains(
            classNode,
            (node) => isThisMethodCall(node, 'initializeRendererCandidate'),
        );
        const retiresLateInitPromise = nodeContains(
            classNode,
            (node) => ts.isCallExpression(node)
                && ts.isPropertyAccessExpression(node.expression)
                && node.expression.name.text === 'then'
                && node.expression.expression.getText(sourceFile) === 'initPromise',
        );
        if (hasRendererInit && !usesOwnedRendererInit && !retiresLateInitPromise) {
            issues.add(
                'renderer init without lifecycle-owned late retirement',
            );
        }

        classNode.members
            .filter(isCallableMember)
            .filter((member) => (
                /^(?:_?animate|startAnimation|startAnimationLoop|startRenderLoop|_?animationDriver|_?renderLoop)$/i
                    .test(getMemberName(member, sourceFile) || '')
            ))
            .forEach((method) => {
                const rafCalls = [];
                nodeContains(method, (node) => {
                    if (isRequestAnimationFrameCall(node)) {
                        rafCalls.push(node);
                    }
                    return false;
                });
                if (rafCalls.length === 0) return;

                const registersAnimation = nodeContains(
                    method,
                    (node) => isThisMethodCall(node, 'registerAnimation'),
                );
                const storesEveryFrame = rafCalls.every(storesCallOnThis);
                if (!registersAnimation && !storesEveryFrame) {
                    issues.add(
                        'animation loop requestAnimationFrame without a tracked handle',
                    );
                }
            });

        let hasInlineAddBind = false;
        let hasInlineRemoveBind = false;
        let hasRawResizeAdd = false;
        let hasRawResizeRemove = false;
        let hasTrackedResize = false;

        nodeContains(classNode, (node) => {
            if (isWindowMethodCall(node, 'addEventListener')) {
                hasInlineAddBind ||= containsBindThis(node.arguments[1]);
                hasRawResizeAdd ||= isStringArgument(node.arguments[0], 'resize');
            }
            if (isWindowMethodCall(node, 'removeEventListener')) {
                hasInlineRemoveBind ||= containsBindThis(node.arguments[1]);
                hasRawResizeRemove ||= isStringArgument(node.arguments[0], 'resize');
            }
            if (
                isThisMethodCall(node, 'registerEventListener')
                && ts.isIdentifier(node.arguments[0])
                && node.arguments[0].text === 'window'
                && isStringArgument(node.arguments[1], 'resize')
            ) {
                hasTrackedResize = true;
            }
            return false;
        });

        if (hasInlineAddBind) {
            issues.add('window.addEventListener with bind(this)');
        }
        if (hasInlineRemoveBind) {
            issues.add('window.removeEventListener with bind(this)');
        }
        if (hasRawResizeAdd && !hasRawResizeRemove && !hasTrackedResize) {
            issues.add('window resize listener without a removal path');
        }
    });

    return [...issues];
}

function toRelative(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll('\\', '/');
}

function main() {
    const rootDir = path.resolve(process.cwd(), 'src', 'themes');
    const files = walk(rootDir);
    const report = files
        .map((filePath) => ({
            relativePath: toRelative(filePath),
            issues: analyzeThemeSource(
                fs.readFileSync(filePath, 'utf8'),
                filePath,
            ),
        }))
        .filter((entry) => entry.issues.length > 0);

    if (report.length === 0) {
        console.log('Theme lifecycle audit passed with no obvious issues.');
        process.exit(0);
    }

    console.log('Theme lifecycle audit found potential issues:\n');
    report.forEach((entry) => {
        console.log(`${entry.relativePath}`);
        entry.issues.forEach((issue) => {
            console.log(`  - ${issue}`);
        });
        console.log('');
    });

    process.exitCode = 1;
}

if (
    process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
    main();
}
