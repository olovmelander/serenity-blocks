/** The preview exercises the production world, director and documented capture controls. */
import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { meta as effectMeta, create } from '../../src/playground/effects/painted-ages.effect.js';
import { PaintedAgesWorld } from '../../src/themes/painted-ages/painted-ages-world.js';
import { PLAYGROUND_URL_PARAMETERS } from '../../src/ui/url-parameters/playground-parameters.js';

const file = 'src/playground/effects/painted-ages.effect.js';
const source = readFileSync(new URL('../../src/playground/effects/painted-ages.effect.js', import.meta.url), 'utf8');
const header = source.slice(source.indexOf('/**'), source.indexOf('*/', source.indexOf('/**')));
const reads = [...new Set([
    ...[...source.matchAll(/\bparams\.(?:get|has)\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/\bnum\(\s*params\s*,\s*'([^']+)'/g)].map((match) => match[1]),
])].sort();
const parameters = [
    'quality', 'level', 'board', 'statsHud', 'locks', 'deposits', 'event', 'eventAge', 'eventLevel',
    'lines', 'row', 'u', 'piece', 'turns', 'color', 'dist', 'cascade', 'combo', 'peak', 'b2b', 'wet',
    'sun', 'formation', 'view', 'reduce', 'parts', 'noPost', 'falseColor', 'bloom', 'px', 'py',
    'icon', 'iconFov', 'iconYaw', 'iconPitch', 'demo',
];

describe('Painted Ages playground', () => {
    it('mounts the real world, post and event director without crossing theme boundaries', () => {
        expect(effectMeta.id).toBe('painted-ages');
        expect(create).toBeTypeOf('function');
        for (const module of ['world', 'post', 'composition', 'director', 'core', 'tetrominos']) {
            expect(source).toContain(`../../themes/painted-ages/painted-ages-${module}.js`);
        }
        const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
        expect(imports.every((from) => from === 'three/webgpu' || from.startsWith('../../themes/painted-ages/'))).toBe(true);
        expect(source.match(/new PaintedAgesWorld\(/g)).toHaveLength(1);
        expect(source).toMatch(/new PaintedAgesWorld\(\{[^}]*capture: true/);
        expect(source).toContain('new PaintedAgesDirector(');
        expect(source).toContain('director.flush()');
        expect(source).toContain('world.clearHistory()');
        expect(source).toContain('world.prefillDeposits(deposits)');
    });

    it('documents exactly the controls read by the effect', () => {
        expect(reads).toEqual([...parameters].sort());
        const entries = PLAYGROUND_URL_PARAMETERS.filter((entry) => entry.scope.includes('painted-ages')
            && entry.sources.includes(file));
        expect(entries.map((entry) => entry.name).sort()).toEqual(reads);
        for (const name of reads) expect(header, name).toContain(`${name}=`);
    });

    it('offers every event that the deterministic replay can fire', () => {
        const offered = header.match(/event=([A-Za-z0-9|]+)/)[1].split('|').sort();
        const fired = [...new Set([...source.matchAll(/eventName === '([^']+)'/g)].map((match) => match[1]))].sort();
        expect(fired).toEqual(offered);
        expect(source).not.toContain('world.onCombo(0)');
        expect(source).toContain('director.onPieceLock(');
        expect(source).toContain('director.onLineClear(');
    });

    it('disposes its overlay, world and post and restores the camera', () => {
        const dispose = source.slice(source.lastIndexOf('dispose() {'));
        for (const call of ['overlay?.remove()', 'world.dispose()', 'post?.dispose()', 'camera.updateProjectionMatrix()']) {
            expect(dispose).toContain(call);
        }
    });
});

/** Exercise capture replay against the real world and director; no GPU or DOM overlay is needed. */
function capture(query) {
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 });
    const renderer = {
        toneMapping: THREE.NoToneMapping,
        getDrawingBufferSize: (size) => size.set(1280, 720),
        backend: { isWebGLBackend: true },
        render: vi.fn(),
    };
    return create({
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(42, 1280 / 720, 0.5, 25000),
        renderer,
        params: new URLSearchParams(`quality=Minimal&noPost=1&${query}`),
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Painted Ages deterministic gameplay captures', () => {
    it('keeps the live demo chain intact between consecutive clearing locks', () => {
        const effect = capture('demo=1');
        try {
            for (let time = 0; time <= 112; time++) effect.update(time / 10, 0.1);
            const state = effect.getDiagnostics();
            expect(state.counts.clears).toBe(5);
            expect(state.combo).toBe(5);
            expect(state.counts.chainSteps).toBe(4);
            effect.update(11.7, 0.5);
            expect(effect.getDiagnostics().combo).toBe(0);
            expect(effect.getDiagnostics().counts.releases).toBe(1);
        } finally {
            effect.dispose();
        }
    }, 20000); // Node performs the production worker's cold D8 bake synchronously.

    it('replays four distinct row pigments independently of the final locking piece', () => {
        const captured = [];
        const { onClear } = PaintedAgesWorld.prototype;
        vi.spyOn(PaintedAgesWorld.prototype, 'onClear').mockImplementation(function snapshot(context) {
            captured.push(Array.from(context.rowCodes));
            return onClear.call(this, context);
        });
        const effect = capture('event=quad&piece=I&eventAge=0.7');
        try {
            effect.seek(40);
            expect(captured[0]).toHaveLength(40);
            const rows = Array.from({ length: 4 }, (_, row) => captured[0].slice(row * 10, row * 10 + 10));
            expect(new Set(rows.map((row) => [...row].sort().join(','))).size).toBe(4);
            expect(rows.every((row) => row.some((code) => code !== 0 && code !== 7))).toBe(true);
            expect(effect.getDiagnostics().counts).toMatchObject({ locks: 1, clears: 1, lines: 4 });
            effect.seek(40);
            expect(captured[1]).toEqual(captured[0]);
        } finally {
            effect.dispose();
        }
    });

    it('deposits each cascade wave on its own frame and reproduces the same capture twice', () => {
        const effect = capture('event=clear&lines=3&cascade=3&eventAge=1.4&deposits=20');
        try {
            effect.seek(40);
            const first = effect.getDiagnostics();
            expect(first.counts).toMatchObject({ clears: 3, lines: 5 });
            expect(first.recordRows).toBe(25);
            expect(first.combo).toBe(1); // Cascade depth never becomes a consecutive-clear combo.
            effect.seek(40);
            expect(effect.getDiagnostics()).toEqual(first);
        } finally {
            effect.dispose();
        }
    });

    it.each([[4, false], [7, true], [8, true]])('releases peak %s with wet ground and the expected bow', (peak, bow) => {
        const effect = capture(`event=release&peak=${peak}&eventAge=2.5`);
        try {
            effect.seek(40);
            const state = effect.getDiagnostics();
            expect(state.counts).toMatchObject({ locks: peak + 1, clears: peak, releases: 1 });
            expect(state.combo).toBe(0);
            expect(state.bow > 0).toBe(bow);
            expect(state.wetGlobal).toBeGreaterThan(peak >= 7 ? 0.5 : 0);
            effect.seek(40);
            expect(effect.getDiagnostics()).toEqual(state);
        } finally {
            effect.dispose();
        }
    });
});
