/**
 * Share made a link nothing could open: nothing read it, Pages refuses a URL that long, and a
 * long game failed outright and still said "copied". The Replays sheet could open a replay file
 * but nothing made one. Export makes one, which the same sheet opens on another device.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { readFileSync } from 'node:fs';
import { DemoManager } from '../../src/core/demo/DemoManager.js';
import { DemoBrowser } from '../../src/ui/demo-browser.js';

const replay = () => ({
    id: 7,
    version: '3.0',
    gameMode: 'single-player',
    timestamp: 1700000000000,
    metadata: { score: 1234, level: 5 },
    inputs: [{ f: 1, t: 17, a: 'move', d: 1 }],
});

function harness({ loaded = replay() } = {}) {
    const anchor = { click: vi.fn(), remove: vi.fn(), style: {} };
    const blobs = [];
    vi.stubGlobal('document', {
        createElement: vi.fn(() => anchor),
        body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('URL', {
        createObjectURL: vi.fn((blob) => { blobs.push(blob); return 'blob:replay'; }),
        revokeObjectURL: vi.fn(),
    });
    const demoManager = new DemoManager();
    demoManager.loadDemo = vi.fn(async () => loaded);
    const browser = Object.assign(Object.create(DemoBrowser.prototype), {
        demoManager, setStatus: vi.fn(),
    });
    return {
        anchor, blobs, browser, demoManager,
    };
}

describe('exporting a replay', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('downloads a .json file, which the sheet\'s Import file accepts', async () => {
        const { anchor, browser } = harness();

        await browser.exportDemo({ id: 7, metadata: { score: 1234 } });

        expect(anchor.download).toMatch(/\.json$/);
        expect(anchor.href).toBe('blob:replay');
        expect(anchor.click).toHaveBeenCalledOnce();
        expect(readFileSync('index.html', 'utf8')).toContain('id="import-demo-input" accept=".json"');
    });

    it('loads only the replay asked for, when the card holds a summary', async () => {
        const { browser, demoManager } = harness();

        await browser.exportDemo({ id: 7, metadata: { score: 1234 } });

        expect(demoManager.loadDemo).toHaveBeenCalledWith(7);
    });

    it('releases the file\'s memory', async () => {
        const { browser } = harness();

        await browser.exportDemo(replay());

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:replay');
    });

    it('writes a file that imports back as the same replay', async () => {
        const { blobs, browser, demoManager } = harness();

        await browser.exportDemo(replay());
        const imported = demoManager.importFromJSON(await blobs[0].text());

        const { id, ...rest } = replay();
        expect(id).toBe(7);
        expect(imported).toEqual(rest);
    });

    it('leaves this device\'s id out, where it could collide on another', async () => {
        const { blobs, browser } = harness();

        await browser.exportDemo(replay());

        expect(JSON.parse(await blobs[0].text())).not.toHaveProperty('id');
    });

    it('says so when it fails, and does not claim a file', async () => {
        const { anchor, browser, demoManager } = harness();
        demoManager.loadDemo = vi.fn(async () => { throw new Error('gone'); });

        await browser.exportDemo({ id: 7 });

        expect(anchor.click).not.toHaveBeenCalled();
        expect(browser.setStatus).toHaveBeenCalledWith(expect.stringContaining('could not'), 'error');
    });
});

describe('importing a replay file', () => {
    afterEach(() => vi.restoreAllMocks());

    it.each([true, 'not an input list', {}])('rejects a malformed input list: %j', (inputs) => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(new DemoManager().importFromJSON(JSON.stringify({ ...replay(), inputs }))).toBeNull();
    });

    it('ignores an id in the file, so a replay here with that id is not in the way', () => {
        const demo = new DemoManager().importFromJSON(JSON.stringify(replay()));

        expect(demo).not.toHaveProperty('id');
        expect(demo.inputs).toHaveLength(1);
    });
});

describe('the dead link', () => {
    it('is gone from the replay store and the sheet', () => {
        expect(DemoManager.prototype.exportToURL).toBeUndefined();
        expect(DemoManager.prototype.importFromURL).toBeUndefined();
        expect(DemoBrowser.prototype.shareDemo).toBeUndefined();
    });
});
