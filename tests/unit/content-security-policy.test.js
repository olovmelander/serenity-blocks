import { describe, expect, it } from 'vitest';
import {
    createContentSecurityPolicy,
    extractInlineScriptHashes,
} from '../../electron/content-security-policy.js';

function directives(policy) {
    return Object.fromEntries(policy.split('; ').map((directive) => {
        const [name, ...sources] = directive.split(' ');
        return [name, sources];
    }));
}

describe('Electron content security policy', () => {
    it('allows GLB embedded texture blob fetches in packaged builds', () => {
        const policy = createContentSecurityPolicy({
            mode: 'packaged',
            inlineScriptHashes: ["'sha256-startup'"],
        });
        const parsed = directives(policy);

        expect(parsed['connect-src']).toEqual(expect.arrayContaining(["'self'", 'file:', 'data:', 'blob:']));
        expect(parsed['img-src']).toEqual(expect.arrayContaining(["'self'", 'file:', 'data:', 'blob:']));
        expect(parsed['script-src']).toContain("'sha256-startup'");
        expect(parsed['object-src']).toEqual(["'none'"]);
        expect(parsed['frame-src']).toEqual(["'none'"]);
        expect(parsed['base-uri']).toEqual(["'none'"]);
    });

    it('allows GLB embedded texture blob fetches in dev Electron', () => {
        const policy = createContentSecurityPolicy({ mode: 'dev' });
        const parsed = directives(policy);

        expect(parsed['connect-src']).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:', 'http://localhost:5173', 'ws://localhost:5173']));
        expect(parsed['img-src']).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']));
        expect(parsed['script-src']).toEqual(expect.arrayContaining(["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"]));
        expect(parsed['object-src']).toEqual(["'none'"]);
        expect(parsed['frame-src']).toEqual(["'none'"]);
    });

    it('hashes only attribute-less inline startup scripts', () => {
        const hashes = extractInlineScriptHashes(`
            <script>window.a = 1;</script>
            <script type="module">window.b = 2;</script>
            <script src="./assets/app.js"></script>
            <script>window.c = 3;</script>
        `);

        expect(hashes).toHaveLength(2);
        expect(hashes.every((hash) => hash.startsWith("'sha256-"))).toBe(true);
    });
});
