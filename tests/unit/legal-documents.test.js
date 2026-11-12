import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    LEGAL_DOCUMENTS, createLegalDocumentsView, renderMarkdown,
} from '../../src/ui/legal/legal-documents.js';

const root = new URL('../../', import.meta.url);

describe('Credits & legal reader (src/ui/legal/legal-documents.js)', () => {
    it('renders the Markdown the legal files use', () => {
        const html = renderMarkdown([
            '# Credits',
            '',
            'Made by **Olov** with `code` and *care*.',
            '',
            '- one',
            '- two,',
            '  continued',
            '',
            '| Work | Licence |',
            '| --- | --- |',
            '| Moon | CC BY 4.0 |',
            '',
            '> quoted',
            '',
            '```text',
            'Copyright <2026>',
            '```',
        ].join('\n'));
        expect(html).toContain('<h3>Credits</h3>');
        expect(html).toContain('<strong>Olov</strong>');
        expect(html).toContain('<code>code</code>');
        expect(html).toContain('<em>care</em>');
        expect(html).toContain('<ul><li>one</li><li>two, continued</li></ul>');
        expect(html).toContain('<th>Work</th>');
        expect(html).toContain('<td>CC BY 4.0</td>');
        expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
        expect(html).toContain('<pre><code>Copyright &lt;2026&gt;</code></pre>');
    });

    it('escapes everything and never makes a link the window could follow', () => {
        const html = renderMarkdown('<script>alert(1)</script> [site](https://example.com) <https://example.org>');
        expect(html).not.toContain('<script');
        expect(html).not.toMatch(/<a\s/);
        expect(html).toContain('site (<span class="legal-doc__link">https://example.com</span>)');
        expect(html).toContain('<span class="legal-doc__link">https://example.org</span>');
    });

    it('offers five documents, the copyright statement last, each with its button in index.html', () => {
        expect(LEGAL_DOCUMENTS.map(({ id, file }) => [id, file])).toEqual([
            ['credits', 'CREDITS.md'],
            ['notices', 'THIRD_PARTY_NOTICES.md'],
            ['licences', 'THIRD_PARTY_LICENSES.md'],
            ['privacy', 'PRIVACY_POLICY.md'],
            ['copyright', 'COPYRIGHT.md'],
        ]);
        const page = readFileSync(new URL('index.html', root), 'utf8');
        const buttons = [...page.matchAll(/data-legal-doc="([^"]+)"[^>]*>([^<]+)<\/button>/g)]
            .map((match) => [match[1], match[2]]);
        expect(buttons).toEqual(LEGAL_DOCUMENTS.map(({ id, label }) => [id, label]));
    });

    it('shows the copyright statement as text a player can read, with no link left half-rendered', () => {
        const html = renderMarkdown(readFileSync(new URL('COPYRIGHT.md', root), 'utf8'));
        expect(html).toContain('<h3>Copyright</h3>');
        expect(html).toContain('All rights reserved.');
        expect(html).toContain('<code>CREDITS.md</code>');
        expect(html).not.toContain('legal-doc__link');
    });

    it('renders every legal file in the repository', () => {
        for (const { file } of LEGAL_DOCUMENTS) {
            if (file === 'THIRD_PARTY_LICENSES.md') continue; // written by the build
            const html = renderMarkdown(readFileSync(new URL(file, root), 'utf8'));
            expect(html.length, file).toBeGreaterThan(500);
            expect(html, file).not.toMatch(/<(script|a|img|iframe)\b/);
        }
    });

    it('loads a document on demand, once, and says when a file only comes with a build', async () => {
        const buttons = LEGAL_DOCUMENTS.map(({ id }) => {
            const attributes = {};
            return {
                dataset: { legalDoc: id },
                classList: { toggle: vi.fn() },
                setAttribute: (name, value) => { attributes[name] = value; },
                attributes,
                addEventListener: vi.fn(),
            };
        });
        const reader = { innerHTML: '', scrollTop: 5, setAttribute: vi.fn() };
        const panel = {
            querySelector: (selector) => (selector === '.legal-doc' ? reader : null),
            querySelectorAll: () => buttons,
        };
        const fetchText = vi.fn(async (file) => {
            if (file === 'THIRD_PARTY_LICENSES.md') throw new Error('404');
            return `# ${file}`;
        });
        const view = createLegalDocumentsView(panel, { fetchText });
        await view.show('credits');
        await view.show('credits');
        expect(fetchText).toHaveBeenCalledTimes(1);
        expect(reader.innerHTML).toContain('<h3>CREDITS.md</h3>');
        expect(reader.scrollTop).toBe(0);
        expect(buttons[0].attributes['aria-pressed']).toBe('true');
        await view.show('licences');
        expect(reader.innerHTML).toContain('THIRD_PARTY_LICENSES.md comes with a build of the game.');
        expect(reader.innerHTML).toContain('LICENSE.electron.txt');
    });
});
