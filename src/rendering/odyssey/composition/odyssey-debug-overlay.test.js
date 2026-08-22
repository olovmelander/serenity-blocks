import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { isOdysseyAAADebugEnabled, OdysseyDebugOverlay } from './odyssey-debug-overlay.js';

function stubSearch(search) {
    vi.stubGlobal('window', {
        location: { search },
    });
}

describe('isOdysseyAAADebugEnabled', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('enables the diagnostics overlay for odysseyAAA captures by default', () => {
        stubSearch('?odysseyAAA=1');

        expect(isOdysseyAAADebugEnabled()).toBe(true);
    });

    it('lets capture harnesses keep odysseyAAA while hiding the overlay', () => {
        stubSearch('?odysseyAAA=1&odysseyOverlay=0');

        expect(isOdysseyAAADebugEnabled()).toBe(false);
    });
});

describe('OdysseyDebugOverlay renderer lines (r185 Info.memory byte accounting)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const MiB = 1024 * 1024;

    it('renders a vram line in MiB when the renderer reports Info.memory.total', () => {
        const overlay = new OdysseyDebugOverlay();
        const lines = overlay._rendererLines({
            info: {
                render: {
                    drawCalls: 10, triangles: 100, calls: 1, timestamp: 0,
                },
                memory: {
                    geometries: 4,
                    textures: 7,
                    total: 12.5 * MiB,
                    texturesSize: 8 * MiB,
                    attributesSize: 3 * MiB,
                    renderTargets: 3,
                },
            },
        });

        expect(lines).toContain('mem       geo 4  tex 7');
        expect(lines).toContain('vram      12.5MB  tex 8.0MB  attr 3.0MB  rt 3');
    });

    it('omits the vram line for counts-only (r181 / WebGL2) memory and never prints NaN', () => {
        const overlay = new OdysseyDebugOverlay();
        const lines = overlay._rendererLines({
            info: {
                render: { drawCalls: 1, triangles: 3, calls: 1 },
                memory: { geometries: 2, textures: 1 },
            },
        });

        expect(lines).toContain('mem       geo 2  tex 1');
        expect(lines.some((line) => line.startsWith('vram'))).toBe(false);
        expect(lines.join('\n')).not.toMatch(/NaN/);
    });

    it('degrades to no renderer lines without a renderer', () => {
        const overlay = new OdysseyDebugOverlay();

        expect(overlay._rendererLines(null)).toEqual([]);
    });
});
