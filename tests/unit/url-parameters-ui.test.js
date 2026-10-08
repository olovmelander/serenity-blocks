import {
    describe, expect, it, vi,
} from 'vitest';
import {
    UrlParametersView, filterUrlParameters, renderUrlParameter,
} from '../../src/ui/url-parameters/UrlParametersView.js';
import { looseNode } from './helpers/loose-dom.js';

const CATALOG = [
    {
        name: 'unlockAll',
        category: 'Development',
        scope: 'Game',
        description: 'Temporarily makes the theme and music collection available.',
        values: '1 enables; otherwise disabled',
        defaultValue: 'Disabled',
        example: 'unlockAll=1',
        sources: ['src/core/progression/development-access.js'],
    },
    {
        name: 'wolfhourQuality',
        category: 'Theme visuals',
        scope: 'Wolfhour theme only',
        description: 'Overrides the scene quality.',
        values: ['low', 'high'],
        defaultValue: 'Saved graphics quality',
        example: 'wolfhourQuality=low',
        notes: 'Only affects the named theme.',
        sources: ['src/themes/wolfhour/test.js'],
    },
];

describe('read-only URL parameter reference', () => {
    it('searches name, description, scope and category with combined case-insensitive terms', () => {
        expect(filterUrlParameters(CATALOG, 'UNLOCK')).toEqual([CATALOG[0]]);
        expect(filterUrlParameters(CATALOG, 'music game')).toEqual([CATALOG[0]]);
        expect(filterUrlParameters(CATALOG, 'theme quality', 'Theme visuals')).toEqual([CATALOG[1]]);
        expect(filterUrlParameters(CATALOG, 'wolfhour', 'Development')).toEqual([]);
        expect(filterUrlParameters(CATALOG, '   ')).toEqual(CATALOG);
        expect(CATALOG).toHaveLength(2);
    });

    it('renders defaults, accepted values, scoped usage, both query examples and source references', () => {
        const markup = renderUrlParameter(CATALOG[1]);
        expect(markup).toContain('Wolfhour theme only');
        expect(markup).toContain('low · high');
        expect(markup).toContain('Saved graphics quality');
        expect(markup).toContain('?wolfhourQuality=low');
        expect(markup).toContain('&amp;wolfhourQuality=low');
        expect(markup).toContain('src/themes/wolfhour/test.js');
        expect(markup).toContain('<summary tabindex="0">');
        expect(markup).not.toContain('<a ');
        expect(markup).not.toContain('type="checkbox"');
    });

    it('escapes every catalog field and never turns an example into a navigation link', () => {
        const value = '<img src=x onerror=alert(1)>';
        const markup = renderUrlParameter({
            name: value,
            category: value,
            scope: value,
            description: value,
            values: value,
            defaultValue: value,
            example: `?name=${value}`,
            notes: value,
            sources: [value],
        });
        expect(markup).not.toContain('<img');
        expect(markup).not.toContain('href=');
        expect(markup).toContain('?name=&lt;img');
    });

    it('updates live results and empty state, clears filters, and stops after its settings owner aborts', () => {
        const root = looseNode();
        const owner = new AbortController();
        const view = new UrlParametersView(root, { catalog: CATALOG, signal: owner.signal });
        expect(root.innerHTML).toContain('Temporary development reference');
        expect(root.innerHTML).toContain('Reload the page after editing the URL.');
        expect(view.count.textContent).toBe('2 of 2 parameter entries');
        expect(view.clear.disabled).toBe(true);
        view.search.value = 'absent';
        view.search.fire('input');
        expect(view.count.textContent).toBe('0 of 2 parameter entries');
        expect(view.empty.hidden).toBe(false);
        view.search.value = '';
        view.category.value = 'Theme visuals';
        view.category.fire('change');
        expect(view.count.textContent).toBe('1 of 2 parameter entries');
        expect(view.empty.hidden).toBe(true);
        expect(view.results.innerHTML).not.toContain('unlockAll');
        view.clear.fire('click');
        expect(view.count.textContent).toBe('2 of 2 parameter entries');
        expect(view.search.focused).toBe(1);
        expect(view.clear.disabled).toBe(true);
        const before = view.results.innerHTML;
        owner.abort();
        view.search.value = 'absent';
        view.search.fire('input');
        expect(view.results.innerHTML).toBe(before);
        expect(view.search.listenerCount('input')).toBe(0);
    });

    it('does no rendering when its initialization was already cancelled', () => {
        const root = looseNode();
        const owner = new AbortController();
        owner.abort();
        const render = vi.spyOn(UrlParametersView.prototype, 'render');
        const view = new UrlParametersView(root, { catalog: CATALOG, signal: owner.signal });
        expect(view.controller.signal.aborted).toBe(true);
        expect(render).not.toHaveBeenCalled();
        render.mockRestore();
    });
});
