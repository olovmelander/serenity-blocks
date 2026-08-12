import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    WORLD_BUILD_FAILURE_STORAGE_KEY,
    readWorldBuildFailures,
    reportWorldBuildFailure,
} from '../../src/rendering/odyssey/world/world-build-failure-report.js';

/**
 * WAVE 4/6 AUDIT PREREQUISITE — a One World build failure must be LOUD.
 *
 * The board's catch recovers into the legacy dioramas, which today makes the failure
 * invisible: a machine where the world never builds plays the fallback forever and
 * reports nothing, and the hatch-retirement decision gets made on the belief that the
 * world builds everywhere. These tests pin the two loud channels (persisted log +
 * player-visible banner) and — critically — that reporting can never break the recovery
 * it reports on.
 */

function makeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        _dump: () => Object.fromEntries(map),
    };
}

/** Minimal document double — enough for createElement/getElementById/append. */
function makeDoc() {
    const nodes = [];
    const makeEl = (tag) => {
        const el = {
            tag,
            id: '',
            children: [],
            attrs: {},
            style: {},
            textContent: '',
            type: '',
            parent: null,
            appendChild(c) { this.children.push(c); c.parent = this; return c; },
            setAttribute(k, v) { this.attrs[k] = v; },
            // Real handlers, so the dismiss path is actually exercised rather than stubbed
            // away — a no-op addEventListener would have let a broken dismiss button ship.
            addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); },
            click() { (this.handlers.click ?? []).forEach((fn) => fn()); },
            remove() {
                if (!this.parent) return;
                const i = this.parent.children.indexOf(this);
                if (i >= 0) this.parent.children.splice(i, 1);
                this.parent = null;
            },
        };
        el.handlers = {};
        Object.defineProperty(el.style, 'cssText', { value: '', writable: true });
        return el;
    };
    const body = makeEl('body');
    return {
        body,
        documentElement: body,
        createElement(tag) { const el = makeEl(tag); nodes.push(el); return el; },
        getElementById(id) {
            return body.children.find((c) => c.id === id) ?? null;
        },
        _nodes: nodes,
    };
}

describe('world build failure report', () => {
    it('persists the failure with timestamp, message and stack head', () => {
        const storage = makeStorage();
        reportWorldBuildFailure(new Error('pipeline creation refused'), { doc: null, storage });
        const entries = readWorldBuildFailures(storage);
        expect(entries).toHaveLength(1);
        expect(entries[0].message).toBe('pipeline creation refused');
        expect(entries[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(entries[0].stackHead).toContain('pipeline creation refused');
    });

    it('caps the log as a ring so a boot-loop cannot grow storage without bound', () => {
        const storage = makeStorage();
        for (let i = 0; i < 30; i += 1) {
            reportWorldBuildFailure(new Error(`boot ${i}`), { doc: null, storage });
        }
        const entries = readWorldBuildFailures(storage);
        expect(entries).toHaveLength(20);
        expect(entries[0].message).toBe('boot 10'); // oldest surviving
        expect(entries[19].message).toBe('boot 29');
    });

    it('shows one banner, and only one, no matter how many failures fire', () => {
        const doc = makeDoc();
        const storage = makeStorage();
        reportWorldBuildFailure(new Error('first'), { doc, storage });
        reportWorldBuildFailure(new Error('second'), { doc, storage });
        const banners = doc.body.children.filter(
            (c) => c.id === 'odyssey-world-build-failure-banner',
        );
        expect(banners).toHaveLength(1);
        expect(banners[0].attrs.role).toBe('alert');
        expect(banners[0].textContent).toContain('legacy chapter environments');
        expect(banners[0].textContent).toContain('fully playable');
    });

    it('dismisses on click, and a LATER failure may raise a fresh banner', () => {
        // Verified in a real browser first (the DOM double cannot prove a click listener
        // fires): dismiss removes it, and a subsequent failure is not silently swallowed.
        const doc = makeDoc();
        const storage = makeStorage();
        const banners = () => doc.body.children.filter(
            (c) => c.id === 'odyssey-world-build-failure-banner',
        );

        reportWorldBuildFailure(new Error('first'), { doc, storage });
        expect(banners()).toHaveLength(1);

        banners()[0].children.find((c) => c.tag === 'button').click();
        expect(banners()).toHaveLength(0);

        reportWorldBuildFailure(new Error('later'), { doc, storage });
        expect(banners()).toHaveLength(1);
        // ...and it reports the running total, not a reset counter.
        expect(banners()[0].textContent).toContain('#2');
    });

    it('never throws — not on missing DOM, missing storage, corrupt storage, or a non-Error', () => {
        expect(() => reportWorldBuildFailure(new Error('x'), { doc: null, storage: null })).not.toThrow();
        expect(() => reportWorldBuildFailure('a string, not an Error', { doc: null, storage: null })).not.toThrow();
        const corrupt = makeStorage({ [WORLD_BUILD_FAILURE_STORAGE_KEY]: '{not json' });
        expect(() => reportWorldBuildFailure(new Error('x'), { doc: null, storage: corrupt })).not.toThrow();
        expect(readWorldBuildFailures(corrupt)).toHaveLength(1); // corrupt log reset, entry recorded
        const throwing = {
            getItem: () => { throw new Error('storage quota'); },
            setItem: () => { throw new Error('storage quota'); },
        };
        expect(() => reportWorldBuildFailure(new Error('x'), { doc: makeDoc(), storage: throwing })).not.toThrow();
    });

    it('the board wires it into the fallback catch, AFTER the recovery, in its own guard', () => {
        // Source assertion, deliberately: constructing the board needs a WebGPU device.
        // What must not silently regress is the ORDER (report after the suppression reset,
        // so reporting can never prevent the fallback) and the inner try (a reporting throw
        // must not escape into the catch's caller).
        const src = readFileSync(
            path.resolve(
                path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
                '../../src/rendering/odyssey/OdysseyBoardController.js',
            ),
            'utf8',
        );
        const catchIdx = src.indexOf("console.error('[OdysseyBoard] One World failed to build");
        expect(catchIdx).toBeGreaterThan(-1);
        const catchBlock = src.slice(catchIdx, catchIdx + 1200);
        const resetIdx = catchBlock.indexOf('suppressedChapters = new Set()');
        const reportIdx = catchBlock.indexOf('reportWorldBuildFailure(error)');
        expect(resetIdx).toBeGreaterThan(-1);
        expect(reportIdx).toBeGreaterThan(resetIdx);
        expect(catchBlock.slice(0, reportIdx)).toMatch(/try\s*\{\s*$/m);
    });
});
