import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { URL_PARAMETER_CATALOG } from '../../src/ui/url-parameters/catalog.js';
import { FLAG_REGISTRY } from '../../src/core/flags.js';

const root = path.resolve(import.meta.dirname, '../..');
const names = new Set(URL_PARAMETER_CATALOG.map((entry) => entry.name));

afterEach(() => vi.unstubAllGlobals());

describe('the source-backed URL parameter reference', () => {
    it('provides complete readable entries, valid examples, and existing source references', () => {
        const identities = new Set();
        URL_PARAMETER_CATALOG.forEach((entry) => {
            ['name', 'category', 'scope', 'description', 'values', 'defaultValue', 'example'].forEach((key) => {
                expect(typeof entry[key], `${entry.name}.${key}`).toBe('string');
                expect(entry[key].trim().length, `${entry.name}.${key}`).toBeGreaterThan(0);
            });
            expect(entry.name).toMatch(/^[A-Za-z][A-Za-z0-9_.-]*$/);
            expect(new URLSearchParams(entry.example).has(entry.name), entry.example).toBe(true);
            const identity = `${entry.name}:${entry.scope}`;
            expect(identities.has(identity), `duplicate scoped entry ${identity}`).toBe(false);
            identities.add(identity);
            expect(entry.sources.length).toBeGreaterThan(0);
            entry.sources.forEach((source) => {
                expect(source).not.toContain('..');
                expect(fs.existsSync(path.join(root, source)), source).toBe(true);
            });
        });
    });

    it('covers the registered flags, except the declared-only rngV2 placeholder', () => {
        FLAG_REGISTRY.filter((flag) => flag.name !== 'rngV2').forEach((flag) => {
            expect(names.has(flag.name), flag.name).toBe(true);
        });
        expect(names.has('rngV2')).toBe(false);
    });

    it('keeps literal URL reads in the referenced source files represented in the catalog', () => {
        const sources = [...new Set(URL_PARAMETER_CATALOG.flatMap((entry) => entry.sources))];
        const reads = new Set();
        // This guards direct URLSearchParams reads and shared flag readers. Dynamic helper
        // keys and effect-specific parsers also need the documented manual source audit.
        sources.filter((file) => /\.[jt]s$/.test(file)).forEach((file) => {
            const parsed = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'),
                ts.ScriptTarget.Latest, true);
            const params = new Set();
            const isSearch = (node) => ts.isNewExpression(node)
                && ts.isIdentifier(node.expression) && node.expression.text === 'URLSearchParams';
            const findParams = (node) => {
                if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
                    && node.initializer && isSearch(node.initializer)) params.add(node.name.text);
                ts.forEachChild(node, findParams);
            };
            findParams(parsed);
            const visit = (node) => {
                if (ts.isCallExpression(node) && node.arguments.length
                    && ts.isStringLiteral(node.arguments[0])) {
                    const callee = node.expression;
                    if (ts.isIdentifier(callee) && ['readFlag', 'readNetFlag', 'readOnlineNetFlag'].includes(callee.text)) {
                        reads.add(node.arguments[0].text);
                    } else if (ts.isPropertyAccessExpression(callee) && ['get', 'has'].includes(callee.name.text)) {
                        const receiver = callee.expression;
                        if (isSearch(receiver) || (ts.isIdentifier(receiver) && params.has(receiver.text))) {
                            reads.add(node.arguments[0].text);
                        }
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(parsed);
        });
        expect([...reads].filter((name) => !names.has(name))).toEqual([]);
    });

    it('imports documentation without reading the browser URL or saved preferences', async () => {
        const fail = () => { throw new Error('Reference must not evaluate live settings'); };
        vi.stubGlobal('location', { get search() { return fail(); } });
        vi.stubGlobal('localStorage', { getItem: fail, setItem: fail });
        vi.stubGlobal('window', { get location() { return fail(); }, get localStorage() { return fail(); } });
        vi.resetModules();
        const { URL_PARAMETER_CATALOG: catalog } = await import('../../src/ui/url-parameters/catalog.js');
        expect(catalog.length).toBe(URL_PARAMETER_CATALOG.length);
        expect(Object.isFrozen(catalog)).toBe(true);
    });
});
