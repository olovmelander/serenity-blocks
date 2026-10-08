import { describe, expect, it } from 'vitest';
import { countDomGlobalReads } from '../../scripts/architecture-dom-reads.mjs';

describe('architecture DOM-global access scan', () => {
    it('ignores filenames, strings, regular expressions, template text and comments', () => {
        const source = [
            "const song = 'rainy-window.mp3';",
            'const label = "document.title navigator.userAgent";',
            'const literal = `window.innerWidth`;',
            'const pattern = /window.innerWidth/;',
            '// window.innerWidth',
            '/* document.body and navigator.userAgent */',
        ].join('\n');
        expect(countDomGlobalReads(source)).toBe(0);
    });

    it('counts actual direct accesses inside nested code and template expressions', () => {
        const source = [
            'function inspect() {',
            '  return () => window.innerWidth + document.body.clientWidth + navigator.userAgent.length;',
            '}',
            // The scanner must parse these expressions, not interpolate the fixture here.
            // eslint-disable-next-line no-template-curly-in-string
            'const label = `window.fake: ${window.location.href} ${document.title}`;',
            'window . status = "ready";',
        ].join('\n');
        expect(countDomGlobalReads(source)).toBe(6);
    });

    it('preserves direct noncomputed and nonoptional scope without counting similarly named members', () => {
        const source = [
            'window["innerWidth"]; document?.body; navigator?.userAgent;',
            'object.window.innerWidth; globalThis.document.body;',
            'window.document.body; document.defaultView?.innerWidth;',
        ].join('\n');
        expect(countDomGlobalReads(source)).toBe(2);
    });
});
