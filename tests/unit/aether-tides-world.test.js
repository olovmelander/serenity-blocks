import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { AetherTidesWorld, REST_RIG } from '../../src/themes/aether-tides/aether-tides-world.js';
import {
    AETHER_PALETTES, EVENT_ROWS, HUSH_HOLD, LOCK_POUR, PALETTE_KEYS, RING_LIFE, SIM_DT, SIM_MAX_STEPS, SPARK_FLIGHT,
    SPLAT_CELL, SPLAT_ROUND, SPLAT_SLOTS, STARFIRE, STAR_LIFE, STAR_SLOTS, maelstromPosition, pieceColor, ringPassTime,
    tideStarPosition,
} from '../../src/themes/aether-tides/aether-tides-core.js';
import {
    BOARD_GRID, PLAYER_SLOTS, boardFor, cardFor, fallbackLayout, rectToTide,
} from '../../src/themes/aether-tides/aether-tides-composition.js';
import { QUALITY, QUALITY_NAMES, tierFor } from '../../src/themes/aether-tides/aether-tides-quality.js';
import { POST_LOOK } from '../../src/themes/aether-tides/aether-tides-post.js';
import { gridFor } from '../../src/themes/aether-tides/aether-tides-fluid.js';
import {
    BEAM_ROWS, BEAM_SLOTS, BURST_ROWS, BURST_SLOTS, CELL_ROWS, CELL_SLOTS, FX_ROWS, FxTable, ROW_BEAM, ROW_BURST,
    ROW_CELL,
} from '../../src/themes/aether-tides/aether-tides-fx.js';

/**
 * The world drives real render passes (the fluid's solver, the light buffers), so it is built
 * here on a stand-in renderer: the state RendererUtils saves and restores, and a record of every
 * pass drawn (which material into which target). Nothing is rasterised; what is tested is the
 * choreography — the numbers the events write into the tables the shaders read.
 */
function fakeRenderer() {
    const clear = new THREE.Color(0x02030a);
    return {
        toneMapping: THREE.NoToneMapping,
        toneMappingExposure: 1,
        outputColorSpace: THREE.SRGBColorSpace,
        autoClear: false,
        target: null,
        mrt: null,
        renderObject: null,
        pixelRatio: 1.25,
        clearAlpha: 1,
        scissor: false,
        passes: [],
        getRenderTarget() { return this.target; },
        setRenderTarget(target) { this.target = target; },
        getActiveCubeFace: () => 0,
        getActiveMipmapLevel: () => 0,
        getRenderObjectFunction() { return this.renderObject; },
        setRenderObjectFunction(fn) { this.renderObject = fn; },
        getPixelRatio() { return this.pixelRatio; },
        setPixelRatio(ratio) { this.pixelRatio = ratio; },
        getMRT() { return this.mrt; },
        setMRT(mrt) { this.mrt = mrt; },
        getClearColor(out) { return out.copy(clear); },
        setClearColor(color, alpha = 1) {
            clear.set(color);
            this.clearAlpha = alpha;
        },
        getClearAlpha() { return this.clearAlpha; },
        getScissorTest() { return this.scissor; },
        setScissorTest(on) { this.scissor = on; },
        clearHex: () => clear.getHex(),
        render(object) {
            this.passes.push({ material: object.material.name, target: this.target?.texture?.name ?? null });
        },
    };
}

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true, at = 10, layout,
} = {}) {
    const scene = new THREE.Scene();
    const renderer = fakeRenderer();
    const world = new AetherTidesWorld({
        scene, renderer, quality, capture,
    }).build();
    world.setViewport(width, height, width / height);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(layout ?? (live ? fallbackLayout(width, height) : null), width / height);
    world.seek(at);
    world.update({ time: at, delta: 0 });
    renderer.passes.length = 0;
    return { scene, renderer, world };
}

/** Advance the world by whole simulation steps, a frame at a time. */
function run(world, seconds) {
    const frames = Math.max(1, Math.round(seconds / SIM_DT));
    for (let i = 0; i < frames; i += 1) world.update({ time: 0, delta: SIM_DT });
}

/** The board and its card, in tide space, as the world aims at them. */
function stageOf(world, player = 0) {
    const board = boardFor(world.layout, player);
    return {
        board: rectToTide(board, world.aspect),
        card: rectToTide(cardFor(world.layout, board), world.aspect),
        hud: world.layout.hud ? rectToTide(world.layout.hud, world.aspect) : null,
    };
}

const cellSize = (board) => ({
    cw: (board.x1 - board.x0) / BOARD_GRID.columns,
    ch: (board.y1 - board.y0) / BOARD_GRID.rows,
});

/** Slots written at or after `since` (a fresh table holds nothing else). */
const splatsSince = (world, since) => world.events.splats.filter((s) => s.t0 >= since - 1e-9);
const cellSplats = (world, since) => splatsSince(world, since).filter((s) => s.kind === SPLAT_CELL);
const roundSplats = (world, since) => splatsSince(world, since).filter((s) => s.kind === SPLAT_ROUND);
const ringsSince = (world, since) => world.events.rings.filter((r) => r.t0 >= since - 1e-9);
const litStars = (world) => world.events.stars.filter((s) => s.born > -1e5);
const isMoving = (s) => Math.hypot(s.bx - s.ax, s.by - s.ay) > 1e-6;
const pours = (s) => s.r + s.g + s.b > 0;
const pushes = (s) => Math.hypot(s.fx, s.fy) > 0;

/** Rows of the stardust / beam table written at or after `since`. */
function burstsSince(world, since) {
    const { data } = world.fx.table;
    const out = [];
    for (let i = 0; i < BURST_SLOTS; i += 1) {
        const o = (ROW_BURST + i * BURST_ROWS) * 4;
        if (data[o + 2] >= since - 1e-3) out.push({ x: data[o], y: data[o + 1], at: data[o + 2] });
    }
    return out;
}
function beamsSince(world, since) {
    const { data } = world.fx.table;
    const out = [];
    for (let i = 0; i < BEAM_SLOTS; i += 1) {
        const o = (ROW_BEAM + i * BEAM_ROWS) * 4;
        if (data[o + 3] >= since - 1e-3) {
            out.push({
                x0: data[o], y: data[o + 1], x1: data[o + 2], at: data[o + 3],
            });
        }
    }
    return out;
}
/** The outlines of an echo's cells drawn at or after `since`. */
function outlinesSince(world, since) {
    const { data } = world.fx.table;
    const out = [];
    for (let i = 0; i < CELL_SLOTS; i += 1) {
        const o = (ROW_CELL + i * CELL_ROWS) * 4;
        if (data[o + 2] >= since - 1e-3) {
            out.push({
                x: data[o], y: data[o + 1], at: data[o + 2], half: data[o + 3],
            });
        }
    }
    return out;
}

const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** The solver's own pass materials. */
const SOLVER_MATERIALS = [
    'velocityMaterial', 'divergenceMaterial', 'pressureMaterial', 'projectMaterial', 'dyeMaterial', 'weaveMaterial',
];
const gapTo = (rect, x, y) => Math.hypot(Math.max(rect.x0 - x, 0, x - rect.x1), Math.max(rect.y0 - y, 0, y - rect.y1));
const allFinite = (list) => {
    for (let i = 0; i < list.length; i += 1) if (!Number.isFinite(list[i])) return false;
    return true;
};

/** Every number the shaders are handed. */
function expectFiniteTables(world, label = '') {
    expect(allFinite(world.events.data), `${label} event table`).toBe(true);
    expect(allFinite(world.fx.table.data), `${label} fx table`).toBe(true);
    for (const row of world.tide.rows) {
        expect(Number.isFinite(row.x + row.y + row.z + row.w), `${label} uniform rows`).toBe(true);
    }
    const post = world.getPostState();
    for (const key of ['flash', 'kick', 'bloomBoost', 'exposure']) {
        expect(Number.isFinite(post[key]), `${label} ${key}`).toBe(true);
    }
    expect(Number.isFinite(world.wellOpen), `${label} well`).toBe(true);
    expect(Number.isFinite(world.now), `${label} clock`).toBe(true);
}

const T_LEFT = {
    player: 0, cells: [[4, 18], [3, 19], [4, 19], [5, 19]], rows: [18, 19], u: 0.45, color: '#3CE68C',
};
const T_RIGHT = {
    player: 0, cells: [[7, 18], [6, 19], [7, 19], [8, 19]], rows: [18, 19], u: 0.75, color: '#F5C542',
};
const I_FLOOR = {
    player: 0, cells: [[6, 19], [7, 19], [8, 19], [9, 19]], rows: [19], u: 0.8, color: '#2CE0FF',
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('aether tides world: build', () => {
    it('builds every tier from node materials only, with the whole picture and the solver its tier pays for', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const materials = new Set();
            scene.traverse((object) => {
                if (object.material) materials.add(object.material);
            });
            expect(materials.size, quality).toBeGreaterThanOrEqual(4);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
                // The picture is drawn in clip space, straight over the frame.
                expect(material.depthTest, material.name).toBe(false);
                expect(material.depthWrite, material.name).toBe(false);
            }
            // The whole picture and every event, on every tier.
            for (const part of ['nebula', 'stars', 'beams', 'stardust']) {
                expect(world.parts[part], `${quality}.${part}`).toBeTruthy();
                expect(world.parts[part].frustumCulled, `${quality}.${part}`).toBe(false);
                expect(scene.children, `${quality}.${part}`).toContain(world.parts[part]);
            }
            // The solver's own passes are node materials too: one renderer, both backends.
            for (const key of SOLVER_MATERIALS) {
                expect(world.fluid[key].isNodeMaterial, `${quality}.${key}`).toBe(true);
            }
            const grid = gridFor(1600 / 900, tier.cells);
            expect(world.fluid.size, quality).toMatchObject(grid);
            expect(world.fluid.size.dyeHeight, quality).toBeGreaterThanOrEqual(grid.height);
            expect(world.fluid.sweeps, quality).toBe(tier.sweeps);
            expect(world.light.steps, quality).toBe(tier.lightSteps);
            expect(world.getState(), quality).toMatchObject({
                quality,
                palette: AETHER_PALETTES[0].name,
                combo: 0,
                well: 0,
                locks: 0,
                stars: 0,
                splats: 0,
                rings: 0,
                stolen: 0,
            });
            expect(world.getState().fluid).toMatchObject({ steps: 0, clock: 10, sweeps: tier.sweeps });
            expectFiniteTables(world, quality);
            world.dispose();
        }
        expect(REST_RIG.near).toBeGreaterThan(0);
        expect(REST_RIG.far).toBeGreaterThan(REST_RIG.near);
        expect(REST_RIG.fov).toBeGreaterThan(0);
    });

    it('falls back to the High tier for a quality it does not know', () => {
        const { world } = makeWorld('Nonsense');
        expect(world.tier).toBe(QUALITY.High);
        expect(world.fluid.sweeps).toBe(QUALITY.High.sweeps);
        world.dispose();
    });

    it('lays the resting nebula out on a seek, then solves a step with full-screen passes', () => {
        const scene = new THREE.Scene();
        const renderer = fakeRenderer();
        const world = new AetherTidesWorld({
            scene, renderer, quality: 'Low', capture: true,
        }).build();
        expect(renderer.passes).toHaveLength(0); // building draws nothing
        world.seek(4);
        // Every target cleared, then the dye laid out as the resting nebula.
        const reset = renderer.passes.slice();
        expect(reset.length).toBeGreaterThan(0);
        expect(reset[reset.length - 1].material).toMatch(/dye/);
        expect(reset[reset.length - 1].target).toMatch(/dye/);
        for (const kind of ['velocity', 'pressure', 'weave', 'dye']) {
            expect(reset.some((pass) => new RegExp(kind).test(pass.target)), kind).toBe(true);
        }
        expect(reset.every((pass) => pass.target !== null)).toBe(true);
        expect(world.now).toBe(4);

        // A frame that owes no step solves nothing: only the light is carried.
        renderer.passes.length = 0;
        world.update({ time: 4, delta: 0 });
        expect(renderer.passes.some((pass) => /velocity|pressure|project/.test(pass.material))).toBe(false);
        expect(renderer.passes.length).toBeGreaterThan(0);

        // One step: velocity, divergence, the pressure sweeps, the projection, then the dye.
        renderer.passes.length = 0;
        world.update({ time: 4, delta: SIM_DT });
        const names = renderer.passes.map((pass) => pass.material);
        const first = (pattern) => names.findIndex((name) => pattern.test(name));
        expect(first(/velocity/)).toBe(0);
        expect(first(/divergence/)).toBeGreaterThan(first(/velocity/));
        expect(first(/pressure/)).toBeGreaterThan(first(/divergence/));
        expect(first(/project/)).toBeGreaterThan(first(/pressure/));
        expect(first(/dye/)).toBeGreaterThan(first(/project/));
        expect(names.filter((name) => /pressure/.test(name))).toHaveLength(QUALITY.Low.sweeps);
        expect(names.filter((name) => /velocity/.test(name))).toHaveLength(1);
        // Each pass writes the target it does not read.
        const velocity = renderer.passes.filter((pass) => /velocity/.test(pass.target)).map((pass) => pass.target);
        expect(new Set(velocity).size).toBe(2);
        expect(world.getState().fluid.steps).toBe(1);
        expect(world.now).toBeCloseTo(4 + SIM_DT, 12);
        world.dispose();
    });

    it('hands the renderer back as it found it', () => {
        const { renderer, world } = makeWorld('Low');
        const canvasTarget = { texture: { name: 'somebody else\'s target' } };
        renderer.setRenderTarget(canvasTarget);
        renderer.toneMapping = THREE.AgXToneMapping;
        const before = {
            hex: renderer.clearHex(), autoClear: renderer.autoClear, pixelRatio: renderer.pixelRatio,
        };
        world.onLock(T_LEFT);
        run(world, 0.2);
        world.seek(3);
        run(world, 0.1);
        expect(renderer.getRenderTarget()).toBe(canvasTarget);
        expect(renderer.toneMapping).toBe(THREE.AgXToneMapping);
        expect(renderer.clearHex()).toBe(before.hex);
        expect(renderer.autoClear).toBe(before.autoClear);
        expect(renderer.pixelRatio).toBe(before.pixelRatio);
        expect(renderer.getMRT()).toBeNull();
        // Nothing was drawn to the canvas: the theme's post stack does that.
        const elsewhere = renderer.passes
            .filter((pass) => pass.target === canvasTarget.texture.name || pass.target === null);
        expect(elsewhere).toHaveLength(0);
        world.dispose();
    });

    it('steps on a fixed clock: whole steps, the remainder shown by extrapolation', () => {
        const { world } = makeWorld('Minimal');
        const t0 = world.now;
        world.update({ time: 0, delta: 0.01 });
        expect(world.getState().fluid.steps).toBe(0);
        expect(world.now).toBeCloseTo(t0 + 0.01, 12);
        expect(world.tide.ahead.value).toBeCloseTo(0.01, 12);
        world.update({ time: 0, delta: 0.01 });
        expect(world.getState().fluid.steps).toBe(1);
        expect(world.now).toBeCloseTo(t0 + 0.02, 12);
        expect(world.tide.ahead.value).toBeCloseTo(0.02 - SIM_DT, 12);
        expect(world.tide.time.value).toBeCloseTo(t0 + SIM_DT, 12);
        expect(world.picture.time.value).toBeCloseTo(world.now, 12);
        // A capture never drops simulated time: half a second is thirty steps, in one frame.
        world.update({ time: 0, delta: 0.5 });
        expect(world.getState().fluid.steps).toBe(31);
        expect(world.now).toBeCloseTo(t0 + 0.52, 9);
        // Negative or missing time is no time.
        world.update({ time: 0, delta: -4 });
        world.update({});
        world.update();
        expect(world.now).toBeCloseTo(t0 + 0.52, 9);
        world.dispose();

        // In play a frame too slow to keep up runs a few steps and lets the rest go.
        const live = makeWorld('Minimal', { capture: false }).world;
        const start = live.now;
        live.update({ time: 0, delta: 0.5 });
        expect(live.getState().fluid.steps).toBe(SIM_MAX_STEPS);
        expect(live.now).toBeCloseTo(start + SIM_MAX_STEPS * SIM_DT, 9);
        live.dispose();
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['nebula', 'beams', 'no-such-part']);
        Object.keys(world.parts).forEach((name) => {
            expect(world.parts[name].visible, name).toBe(name === 'nebula' || name === 'beams');
        });
        world.showOnlyParts(Object.keys(world.parts));
        expect(Object.values(world.parts).every((part) => part.visible)).toBe(true);
        world.dispose();
    });

    it('follows the frame: the grid is cut to its shape, the card thins the gas behind it', () => {
        const { world } = makeWorld('Low');
        const wide = { ...world.fluid.size };
        expect(wide.width).toBeGreaterThan(wide.height);
        expect(world.picture.pixels.value).toBe(450);
        const { card } = stageOf(world);
        const voided = world.fieldUniforms.card.value;
        expect(voided.x).toBeCloseTo((card.x0 + card.x1) / 2, 9);
        expect(voided.z).toBeCloseTo((card.x1 - card.x0) / 2, 9);
        expect(voided.w).toBeCloseTo((card.y1 - card.y0) / 2, 9);
        expect(world.fieldUniforms.cardVoid.value).toBeGreaterThan(0);

        world.setViewport(430, 932, 430 / 932);
        expect(world.aspect).toBeCloseTo(430 / 932, 12);
        expect(world.fluid.size.height).toBeGreaterThan(world.fluid.size.width);
        expect(world.fluid.size).toMatchObject(gridFor(430 / 932, QUALITY.Low.cells));
        expect(world.tide.screen.value.x).toBeCloseTo(430 / 932, 12);
        expect(world.picture.pixels.value).toBe(466);
        // The light buffers follow the grid.
        expect(world.light.size).toEqual({ width: world.fluid.size.width, height: world.fluid.size.height });
        // The live layout survives a resize; without one the stylesheet's layout is recomputed.
        expect(world.layoutLive).toBe(true);
        world.setLayout(null);
        expect(world.layoutLive).toBe(false);
        const upright = stageOf(world).card;
        expect(upright.x1 - upright.x0).toBeLessThan(2 * world.aspect);
        expect(Math.abs((upright.x0 + upright.x1) / 2)).toBeLessThan(1e-9);
        // The new grid starts from still gas, on the clock it already had.
        const { clock } = world.fluid;
        run(world, SIM_DT);
        expect(world.getState().fluid.steps).toBe(1);
        expect(world.fluid.clock).toBeCloseTo(clock + SIM_DT, 12);
        expectFiniteTables(world);

        // Several boards share the frame evenly: no one card is hollowed out.
        const two = fallbackLayout(1600, 900);
        two.cards = [
            {
                x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.9,
            },
            {
                x0: 0.6, y0: 0.1, x1: 0.9, y1: 0.9,
            },
        ];
        world.setLayout(two, 16 / 9);
        expect(world.aspect).toBeCloseTo(16 / 9, 12);
        expect(world.fieldUniforms.cardVoid.value).toBe(0);
        world.dispose();
    });

    it('releases what it built, leaves the scene and survives a second dispose', () => {
        const { scene, world } = makeWorld('Medium');
        const {
            fluid, light, nebula, stars, noise,
        } = world;
        const disposals = [
            vi.spyOn(fluid, 'dispose'),
            vi.spyOn(light, 'dispose'),
            vi.spyOn(nebula, 'dispose'),
            vi.spyOn(stars, 'dispose'),
            vi.spyOn(world.fx, 'dispose'), vi.spyOn(noise, 'dispose'),
        ];
        const targets = [fluid.vel.read, fluid.vel.write, fluid.dye.read, fluid.pres.read, fluid.weave.read, light.glow]
            .map((target) => vi.spyOn(target, 'dispose'));
        expect(scene.children.length).toBeGreaterThanOrEqual(4);
        world.dispose();
        expect(scene.children).toHaveLength(0);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        for (const target of targets) expect(target).toHaveBeenCalledOnce();
        for (const key of ['fluid', 'light', 'nebula', 'stars', 'fx', 'noise']) expect(world[key], key).toBeNull();
        expect(() => world.dispose()).not.toThrow();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        // A late gameplay event after retirement is harmless.
        expect(() => {
            world.onLock(T_LEFT);
            world.onClear({ lines: 4 });
        }).not.toThrow();
    });

    it('keeps the clock and the events when the device cannot draw to float targets', () => {
        const scene = new THREE.Scene();
        const renderer = fakeRenderer();
        const world = new AetherTidesWorld({
            scene, renderer, quality: 'Low', capture: true, live: false,
        }).build();
        world.setViewport(1600, 900, 16 / 9);
        world.seek(10);
        world.onLock(T_LEFT);
        world.onClear({ rows: [19], lines: 1 });
        run(world, 0.1);
        // Nothing is solved…
        expect(renderer.passes.some((pass) => /velocity|pressure|project|dye|weave/.test(pass.material))).toBe(false);
        // …but the clock runs and the table is written: the sprites and the fronts still play.
        expect(world.now).toBeCloseTo(10.1, 9);
        expect(world.events.splatCount).toBeGreaterThan(0);
        expect(world.events.ringCount).toBeGreaterThan(0);
        expect(litStars(world)).toHaveLength(1);
        expectFiniteTables(world);
        world.dispose();
    });
});

describe('aether tides world: locks', () => {
    it('pours the piece\'s own footprint beside its card: one cell splat per cell, in its colour', () => {
        const { world } = makeWorld('Low');
        const { board, card } = stageOf(world);
        const { cw, ch } = cellSize(board);
        const at = world.eventClock;
        world.onLock(T_LEFT);

        const poured = cellSplats(world, at);
        expect(poured).toHaveLength(T_LEFT.cells.length);
        const rgb = pieceColor(T_LEFT.color);
        const offsets = poured.map((splat, i) => {
            const [column, row] = T_LEFT.cells[i];
            // Each cell pours for a moment, at the instant of the lock, and stays where it stands.
            expect(splat.t0).toBe(at);
            expect(splat.duration).toBe(LOCK_POUR);
            expect(isMoving(splat)).toBe(false);
            // A cell-shaped footprint a little smaller than its cell, so the piece reads as cells.
            expect(splat.radius).toBeGreaterThan(cw * 0.3);
            expect(splat.radius).toBeLessThanOrEqual(cw * 0.5);
            // The piece's colour, and no push of its own (a push per cell would shear the shape).
            expect(splat.r).toBeGreaterThan(0);
            expect(splat.g / splat.r).toBeCloseTo(rgb[1] / rgb[0], 9);
            expect(splat.b / splat.r).toBeCloseTo(rgb[2] / rgb[0], 9);
            expect(pushes(splat)).toBe(false);
            return [
                splat.ax - (board.x0 + (column + 0.5) * cw),
                splat.ay - (board.y0 + (row + 0.5) * ch),
            ];
        });
        // The echo keeps the piece's shape: every cell moved by the same amount, straight sideways.
        for (const [dx, dy] of offsets) {
            expect(dx).toBeCloseTo(offsets[0][0], 9);
            expect(dy).toBeCloseTo(0, 9);
        }
        // A piece left of the board's middle leaves by the left: the whole echo is outside the card.
        expect(offsets[0][0]).toBeLessThan(0);
        for (const splat of poured) {
            expect(splat.ax + cw * 0.5).toBeLessThan(card.x0);
            expect(splat.ax - cw * 0.5).toBeGreaterThan(-world.aspect);
            expect(Math.abs(splat.ay)).toBeLessThan(1);
        }
        expect(world.getState().locks).toBe(1);
        expect(world.lockCount).toBe(1);
        world.dispose();
    });

    it('sends a piece on the right half out by the right, past the HUD when the HUD stands in its rows', () => {
        const { world } = makeWorld('Low');
        const { board, card, hud } = stageOf(world);
        const { cw } = cellSize(board);
        // On the floor, below the stats bar: right beside the card.
        let at = world.eventClock;
        world.onLock(T_RIGHT);
        for (const splat of cellSplats(world, at)) {
            expect(splat.ax - cw * 0.5).toBeGreaterThan(card.x1);
            expect(splat.ax + cw * 0.5).toBeLessThan(world.aspect);
        }
        const low = Math.min(...cellSplats(world, at).map((splat) => splat.ax));
        // Half way up the board, level with the stats bar: beyond it, never on top of it.
        run(world, 0.5);
        at = world.eventClock;
        world.onLock({ ...T_RIGHT, cells: [[7, 8], [6, 9], [7, 9], [8, 9]], rows: [8, 9] });
        const high = cellSplats(world, at);
        expect(high).toHaveLength(4);
        for (const splat of high) {
            const cell = {
                x0: splat.ax - cw * 0.5, y0: splat.ay - cw * 0.5, x1: splat.ax + cw * 0.5, y1: splat.ay + cw * 0.5,
            };
            expect(overlaps(cell, card)).toBe(false);
            expect(overlaps(cell, hud)).toBe(false);
            expect(cell.x1).toBeLessThan(world.aspect);
        }
        expect(Math.min(...high.map((splat) => splat.ax))).toBeGreaterThan(hud.x1);
        expect(Math.min(...high.map((splat) => splat.ax))).toBeGreaterThan(low);
        world.dispose();
    });

    it('lights exactly one star and sends out one front, from where the echo stands', () => {
        const { world } = makeWorld('Low');
        const { card } = stageOf(world);
        const at = world.eventClock;
        world.onLock(T_LEFT);
        const poured = cellSplats(world, at);
        const ex = poured.reduce((sum, splat) => sum + splat.ax, 0) / poured.length;
        const ey = poured.reduce((sum, splat) => sum + splat.ay, 0) / poured.length;

        // ── the front ──
        const rings = ringsSince(world, at);
        expect(rings).toHaveLength(1);
        expect(rings[0].t0).toBe(at);
        expect(rings[0].x).toBeCloseTo(ex, 9);
        expect(rings[0].y).toBeCloseTo(ey, 9);
        expect(rings[0].push).toBeGreaterThan(0);
        expect(rings[0].reach).toBeGreaterThan(0);
        expect(rings[0].reach).toBeLessThan(1); // a lock stirs its own neighbourhood, not the sky

        // ── the star ──
        const stars = litStars(world);
        expect(stars).toHaveLength(1);
        const [star] = stars;
        const rgb = pieceColor(T_LEFT.color);
        expect([star.r, star.g, star.b]).toEqual(rgb);
        // Its spark leaves the echo a moment after the lock and takes its flight to arrive.
        expect(star.fromX).toBeCloseTo(ex, 9);
        expect(star.fromY).toBeCloseTo(ey, 9);
        expect(star.left).toBeGreaterThanOrEqual(at);
        expect(star.left - at).toBeLessThan(0.25);
        expect(star.born - star.left).toBeCloseTo(SPARK_FLIGHT, 9);
        expect(star.dies - star.born).toBeCloseTo(STAR_LIFE, 9);
        expect(star.flux).toBeGreaterThan(0);
        // It opens in open sky on the echo's side: on the screen, clear of the card.
        expect(Math.abs(star.x)).toBeLessThan(world.aspect);
        expect(Math.abs(star.y)).toBeLessThan(1);
        expect(star.x).toBeLessThan(card.x0);
        expect(gapTo(card, star.x, star.y)).toBeGreaterThan(0.05);

        // ── the spark's wake: a source that flies the same path, in the piece's colour ──
        const wake = roundSplats(world, at)
            .filter((s) => isMoving(s) && Math.hypot(s.bx - star.x, s.by - star.y) < 1e-9);
        expect(wake).toHaveLength(1);
        expect(wake[0].ax).toBeCloseTo(ex, 9);
        expect(wake[0].ay).toBeCloseTo(ey, 9);
        expect(wake[0].t0).toBeCloseTo(star.left, 12);
        expect(wake[0].duration).toBeCloseTo(SPARK_FLIGHT, 12);
        expect(wake[0].bend).toBeCloseTo(star.bend, 12);
        expect(wake[0].g / wake[0].r).toBeCloseTo(rgb[1] / rgb[0], 9);

        // ── the push that carries the echo off whole, after it has stood for a breath ──
        const shove = roundSplats(world, at).filter((s) => !isMoving(s) && !pours(s) && pushes(s));
        expect(shove).toHaveLength(1);
        expect(shove[0].ax).toBeCloseTo(ex, 9);
        expect(shove[0].ay).toBeCloseTo(ey, 9);
        expect(shove[0].t0).toBeGreaterThan(at);
        expect(shove[0].fx).toBeLessThan(0); // away from the card
        // It covers the whole footprint.
        expect(shove[0].radius).toBeGreaterThan(Math.max(...poured.map((s) => Math.abs(s.ax - ex))));

        // ── and behind the glass the piece breathes its colour toward the echo ──
        const breath = roundSplats(world, at).filter((s) => !isMoving(s) && pours(s));
        expect(breath).toHaveLength(1);
        expect(breath[0].t0).toBe(at);
        expect(gapTo(card, breath[0].ax, breath[0].ay)).toBe(0);
        expect(breath[0].fx).toBeLessThan(0);
        expect(breath[0].ay).toBeCloseTo(ey, 9);

        // A handful of stardust where the echo stands.
        const dust = burstsSince(world, at);
        expect(dust).toHaveLength(1);
        expect(dust[0].x).toBeCloseTo(ex, 5);
        expect(dust[0].y).toBeCloseTo(ey, 5);
        // And the piece's shape drawn crisp for a moment: one outline over each cell of the echo.
        const outlines = outlinesSince(world, at);
        expect(outlines).toHaveLength(poured.length);
        outlines.forEach((outline, i) => {
            expect(outline.x).toBeCloseTo(poured[i].ax, 5);
            expect(outline.y).toBeCloseTo(poured[i].ay, 5);
            expect(outline.half).toBeGreaterThan(0);
            expect(outline.half).toBeLessThan(poured[i].radius * 1.5);
        });

        // The star is in flight, then burning.
        expect(world.getState().stars).toBe(0);
        run(world, star.born - world.now + 0.05);
        expect(world.getState().stars).toBe(1);
        expect(world.getState()).toMatchObject({ locks: 1, stolen: 0 });
        expectFiniteTables(world);
        world.dispose();
    });

    it('slams a hard drop down from above: one more streak, more gas, a harder push, a kick', () => {
        const soft = makeWorld('Low').world;
        const hard = makeWorld('Low').world;
        const at = soft.eventClock;
        soft.onLock(I_FLOOR);
        hard.onLock({ ...I_FLOOR, hardDrop: true });

        // The same footprint, in the same place.
        const softCells = cellSplats(soft, at);
        const hardCells = cellSplats(hard, at);
        expect(hardCells).toHaveLength(softCells.length);
        hardCells.forEach((splat, i) => {
            expect(splat.ax).toBeCloseTo(softCells[i].ax, 12);
            expect(splat.ay).toBeCloseTo(softCells[i].ay, 12);
            expect(splat.r).toBeGreaterThan(softCells[i].r);
            expect(splat.heat).toBeGreaterThan(softCells[i].heat);
        });
        const ex = hardCells.reduce((sum, splat) => sum + splat.ax, 0) / hardCells.length;
        const ey = hardCells.reduce((sum, splat) => sum + splat.ay, 0) / hardCells.length;

        // One more source than a soft lock: the streak, coming straight down into the echo.
        expect(roundSplats(hard, at)).toHaveLength(roundSplats(soft, at).length + 1);
        const streak = roundSplats(hard, at).filter((s) => isMoving(s) && Math.hypot(s.bx - ex, s.by - ey) < 1e-9);
        expect(streak).toHaveLength(1);
        expect(streak[0].ax).toBeCloseTo(ex, 9);
        expect(streak[0].ay).toBeLessThan(ey - 0.2); // from above (y is down)
        expect(streak[0].t0).toBe(at);
        expect(streak[0].fy).toBeGreaterThan(0);
        expect(pours(streak[0])).toBe(true);
        expect(roundSplats(soft, at).some((s) => isMoving(s) && Math.hypot(s.bx - ex, s.by - ey) < 1e-9)).toBe(false);

        // The echo is pushed sooner and harder, and downward as well as out.
        const shoveOf = (world) => roundSplats(world, at).find((s) => !isMoving(s) && !pours(s) && pushes(s));
        expect(shoveOf(hard).t0).toBeLessThan(shoveOf(soft).t0);
        expect(Math.hypot(shoveOf(hard).fx, shoveOf(hard).fy))
            .toBeGreaterThan(Math.hypot(shoveOf(soft).fx, shoveOf(soft).fy));
        expect(shoveOf(hard).fy).toBeGreaterThan(shoveOf(soft).fy);

        // A wider, harder front; a brighter star; still one of each.
        const [softRing] = ringsSince(soft, at);
        const [hardRing] = ringsSince(hard, at);
        expect(ringsSince(hard, at)).toHaveLength(1);
        expect(hardRing.reach).toBeGreaterThan(softRing.reach);
        expect(hardRing.push).toBeGreaterThan(softRing.push);
        expect(hardRing.heat).toBeGreaterThan(softRing.heat);
        expect(litStars(hard)).toHaveLength(1);
        expect(litStars(hard)[0].flux).toBeGreaterThan(litStars(soft)[0].flux);

        // Only the hard drop strikes the post stack.
        run(soft, SIM_DT);
        run(hard, SIM_DT);
        expect(soft.getPostState()).toMatchObject({ flash: 0, kick: 0, exposure: 1 });
        expect(hard.getPostState().kick).toBeGreaterThan(0.1);
        expect(hard.getPostState().flash).toBeGreaterThan(0);
        expect(hard.getPostState().exposure).toBeLessThan(1);
        // The kick dies away.
        const { kick } = hard.getPostState();
        run(hard, 0.5);
        expect(hard.getPostState().kick).toBeLessThan(kick * 0.2);
        soft.dispose();
        hard.dispose();
    });

    it('falls back to the rows and the column when it is handed no cells (a scrolling board)', () => {
        const { world } = makeWorld('Low');
        const { board, card } = stageOf(world);
        const { cw, ch } = cellSize(board);
        const at = world.eventClock;
        world.onLock({
            player: 0, cells: [], rows: [5], u: 0.8, color: '#FF7A3C',
        });
        const poured = cellSplats(world, at);
        expect(poured).toHaveLength(1);
        // Row five, on the right: the echo stands at that height, right of the card.
        expect(poured[0].ay).toBeCloseTo(board.y0 + 5.5 * ch, 9);
        expect(poured[0].ax - cw * 0.5).toBeGreaterThan(card.x1);
        expect(litStars(world)).toHaveLength(1);
        expect(ringsSince(world, at)).toHaveLength(1);
        // Several rows are several cells, one above the other.
        run(world, 0.5);
        const next = world.eventClock;
        world.onLock({ rows: [16, 17, 18, 19], u: 0.05 });
        const column = cellSplats(world, next);
        expect(column).toHaveLength(4);
        expect(new Set(column.map((splat) => splat.ax.toFixed(9))).size).toBe(1);
        expect(column[0].ax + cw * 0.5).toBeLessThan(card.x0);
        // Nothing at all to go on: a cell on the floor, in the nebula's own violet.
        run(world, 0.5);
        const last = world.eventClock;
        world.onLock({});
        const lone = cellSplats(world, last);
        expect(lone).toHaveLength(1);
        expect(lone[0].ay).toBeCloseTo(board.y0 + 19.5 * ch, 9);
        const violet = pieceColor(null);
        expect(lone[0].b / lone[0].r).toBeCloseTo(violet[2] / violet[0], 9);
        expect(() => world.onLock(null)).not.toThrow();
        expect(world.lockCount).toBe(3);
        expectFiniteTables(world);
        world.dispose();
    });

    it('pours a meditation click where it was clicked, and seats its star close by', () => {
        const { world } = makeWorld('Low', { live: false });
        expect(world.layoutLive).toBe(false);
        const at = world.eventClock;
        world.onLock({ screen: { x: 0.2, y: 0.8 }, color: '#FF4D6D' });
        const poured = cellSplats(world, at);
        expect(poured).toHaveLength(1);
        expect(poured[0].ax).toBeCloseTo((0.2 - 0.5) * 2 * world.aspect, 9);
        expect(poured[0].ay).toBeCloseTo((0.8 - 0.5) * 2, 9);
        const [star] = litStars(world);
        expect(Math.hypot(star.x - poured[0].ax, star.y - poured[0].ay)).toBeLessThan(0.5);
        expect(Math.abs(star.x)).toBeLessThan(world.aspect);
        expect(Math.abs(star.y)).toBeLessThan(1);
        const [ring] = ringsSince(world, at);
        expect(ring.x).toBeCloseTo(poured[0].ax, 9);
        expect(ring.y).toBeCloseTo(poured[0].ay, 9);
        // With no board on screen a lock from a board still lands where the solo board would stand.
        run(world, 0.5);
        const next = world.eventClock;
        world.onLock(T_LEFT);
        const fallback = rectToTide(fallbackLayout(900 * world.aspect, 900).cards[0], world.aspect);
        for (const splat of cellSplats(world, next)) expect(splat.ax).toBeLessThan(fallback.x0);
        expectFiniteTables(world);
        world.dispose();
    });

    it('lands a local-multiplayer lock beside that player\'s own card, clear of every card', () => {
        const layout = {
            cardCount: 2,
            cards: [
                {
                    x0: 0.08, y0: 0.08, x1: 0.42, y1: 0.92,
                },
                {
                    x0: 0.58, y0: 0.08, x1: 0.92, y1: 0.92,
                },
            ],
            hud: null,
            boards: new Array(PLAYER_SLOTS).fill(null),
        };
        layout.boards[1] = {
            x0: 0.12, y0: 0.2, x1: 0.38, y1: 0.9,
        };
        layout.boards[2] = {
            x0: 0.62, y0: 0.2, x1: 0.88, y1: 0.9,
        };
        const { world } = makeWorld('Low', { layout });
        const cards = layout.cards.map((card) => rectToTide(card, world.aspect));
        const boards = [null, rectToTide(layout.boards[1], world.aspect), rectToTide(layout.boards[2], world.aspect)];
        for (const [player, lock] of [[1, T_LEFT], [1, T_RIGHT], [2, T_LEFT], [2, T_RIGHT]]) {
            run(world, 0.3);
            const at = world.eventClock;
            world.onLock({ ...lock, player });
            const poured = cellSplats(world, at);
            const { cw } = cellSize(boards[player]);
            expect(poured, `player ${player}`).toHaveLength(4);
            for (const splat of poured) {
                const cell = {
                    x0: splat.ax - cw * 0.5, y0: splat.ay - cw * 0.5, x1: splat.ax + cw * 0.5, y1: splat.ay + cw * 0.5,
                };
                for (const card of cards) expect(overlaps(cell, card), `player ${player}`).toBe(false);
                expect(cell.x0, `player ${player}`).toBeGreaterThan(-world.aspect);
                expect(cell.x1, `player ${player}`).toBeLessThan(world.aspect);
            }
            // It keeps the row the piece locked in, on its own board.
            const rows = poured.map((splat) => splat.ay).sort((a, b) => a - b);
            const { ch } = cellSize(boards[player]);
            expect(rows[0]).toBeCloseTo(boards[player].y0 + 18.5 * ch, 9);
        }
        expect(world.lockCount).toBe(4);
        expectFiniteTables(world);
        world.dispose();
    });

    it('never grows a table: more locks than there are slots reuse them', () => {
        const { world } = makeWorld('Minimal');
        const tables = {
            splats: world.events.splats.slice(), rings: world.events.rings.slice(), stars: world.events.stars.slice(),
        };
        const { data } = world.events;
        const fx = world.fx.table.data;
        const locks = STAR_SLOTS + 9;
        for (let i = 0; i < locks; i += 1) {
            run(world, 0.1);
            world.onLock({
                ...(i % 2 ? T_LEFT : T_RIGHT),
                hardDrop: i % 3 === 0,
                cells: [[i % 8, 19 - (i % 12)], [(i % 8) + 1, 19 - (i % 12)]],
            });
        }
        expect(world.lockCount).toBe(locks);
        expect(world.events.data).toBe(data);
        expect(world.fx.table.data).toBe(fx);
        expect(world.events.splats).toHaveLength(SPLAT_SLOTS);
        expect(world.events.stars).toHaveLength(STAR_SLOTS);
        for (const key of Object.keys(tables)) {
            world.events[key].forEach((slot, i) => expect(slot, key).toBe(tables[key][i]));
        }
        expect(world.events.data).toHaveLength(EVENT_ROWS * 4);
        // Every star slot has been written; the newest lock's star is among them.
        expect(litStars(world)).toHaveLength(STAR_SLOTS);
        expect(Math.max(...litStars(world).map((star) => star.left))).toBeGreaterThan(world.eventClock);
        run(world, 1);
        expect(world.getState().stars).toBeLessThanOrEqual(STAR_SLOTS);
        expect(world.getState().stars).toBeGreaterThan(STAR_SLOTS / 2);
        expectFiniteTables(world);
        world.dispose();
    });
});

describe('aether tides world: clears', () => {
    it('fires each cleared row out of both sides of the card and sends one front out from the board', () => {
        const { world } = makeWorld('Low');
        const { board, card } = stageOf(world);
        const { ch } = cellSize(board);
        const at = world.eventClock;
        world.onClear({ rows: [19, 18], lines: 2 });

        // Two jets a row: from the card's edge, along the row, off the edge of the screen.
        const jets = roundSplats(world, at);
        expect(jets).toHaveLength(4);
        for (const row of [19, 18]) {
            const y = board.y0 + (row + 0.5) * ch;
            const mine = jets.filter((jet) => Math.abs(jet.ay - y) < 1e-9);
            expect(mine, `row ${row}`).toHaveLength(2);
            const [left, right] = mine.sort((a, b) => a.bx - b.bx);
            expect(left.ax).toBeCloseTo(card.x0, 9);
            expect(left.bx).toBeLessThan(-world.aspect);
            expect(left.fx).toBeLessThan(0);
            expect(right.ax).toBeCloseTo(card.x1, 9);
            expect(right.bx).toBeGreaterThan(world.aspect);
            expect(right.fx).toBeGreaterThan(0);
            for (const jet of mine) {
                expect(jet.t0).toBeGreaterThanOrEqual(at);
                expect(jet.t0 - at).toBeLessThan(0.2);
                expect(pours(jet)).toBe(true);
                expect(jet.heat).toBeGreaterThan(0);
                expect(jet.radius).toBeGreaterThan(0);
            }
        }
        // A blade of light for each jet, and stardust from both sides of the card.
        const beams = beamsSince(world, at);
        expect(beams).toHaveLength(4);
        expect(beams.filter((beam) => beam.x1 < beam.x0)).toHaveLength(2);
        for (const beam of beams) {
            expect(Math.abs(beam.x1)).toBeGreaterThan(world.aspect);
            expect(Math.min(Math.abs(beam.x0 - card.x0), Math.abs(beam.x0 - card.x1))).toBeLessThan(1e-5);
        }
        expect(burstsSince(world, at).map((burst) => burst.x).sort((a, b) => a - b)).toEqual(
            [Math.fround(card.x0), Math.fround(card.x1)],
        );

        // One front, from the middle of what was cleared, that reaches the whole sky.
        const rings = ringsSince(world, at);
        expect(rings).toHaveLength(1);
        expect(rings[0].t0).toBe(at);
        expect(rings[0].x).toBeCloseTo((board.x0 + board.x1) / 2, 9);
        expect(rings[0].y).toBeCloseTo(board.y0 + 19 * ch, 9);
        expect(rings[0].reach).toBeGreaterThan(Math.hypot(world.aspect, 1));
        expect(rings[0].push).toBeGreaterThan(0);
        // The gas behind the board wells up: the spring opens on the next step, then closes.
        const flowAt = () => Math.max(...world.events.wells.map((well) => well.flow));
        const rest = flowAt();
        run(world, SIM_DT);
        expect(flowAt()).toBeGreaterThan(rest + 1);
        run(world, 2);
        expect(flowAt()).toBeCloseTo(rest, 6);
        // The post stack is struck.
        expect(world.flash.strength).toBeGreaterThan(0);
        expect(world.kick.strength).toBeGreaterThan(0);
        expectFiniteTables(world);
        world.dispose();
    });

    it('answers more lines with more: jets for every row, a harder front, a second one from three', () => {
        const fronts = [];
        for (const lines of [1, 2, 3]) {
            const { world } = makeWorld('Low');
            const { board } = stageOf(world);
            const { ch } = cellSize(board);
            const at = world.eventClock;
            // Without rows it clears from the floor up.
            world.onClear({ lines });
            const jets = roundSplats(world, at);
            expect(jets, `${lines} lines`).toHaveLength(lines * 2);
            const heights = [...new Set(jets.map((jet) => jet.ay.toFixed(9)))].map(Number).sort((a, b) => b - a);
            expect(heights).toHaveLength(lines);
            heights.forEach((y, i) => expect(y).toBeCloseTo(board.y0 + (19.5 - i) * ch, 9));
            expect(beamsSince(world, at), `${lines} lines`).toHaveLength(lines * 2);
            const rings = ringsSince(world, at).sort((a, b) => a.t0 - b.t0);
            expect(rings, `${lines} lines`).toHaveLength(lines >= 3 ? 2 : 1);
            fronts.push({ push: rings[0].push, heat: rings[0].heat, flash: world.flash.strength });
            // Nothing waits: fewer than four lines fire at once.
            expect(rings[0].t0).toBe(at);
            expect(world.picture.hush.value).toBe(0);
            run(world, 0.1);
            expect(world.picture.hush.value).toBe(0);
            expectFiniteTables(world, `${lines} lines`);
            world.dispose();
        }
        for (let i = 1; i < fronts.length; i += 1) {
            expect(fronts[i].push).toBeGreaterThan(fronts[i - 1].push);
            expect(fronts[i].heat).toBeGreaterThan(fronts[i - 1].heat);
            expect(fronts[i].flash).toBeGreaterThan(fronts[i - 1].flash);
        }
        // No line count is one line; more than four is four; nothing at all is nothing.
        const { world } = makeWorld('Low');
        let at = world.eventClock;
        world.onClear({});
        expect(roundSplats(world, at)).toHaveLength(2);
        run(world, 4);
        at = world.eventClock;
        world.onClear({ lines: 9 });
        expect(roundSplats(world, at)).toHaveLength(8);
        expect(() => world.onClear(null)).not.toThrow();
        world.dispose();
    });

    it('sets off every star the board has lit as the front reaches it, never before the star has opened', () => {
        const { world } = makeWorld('Low');
        const locks = [T_LEFT, T_RIGHT, I_FLOOR, { ...T_LEFT, cells: [[1, 6], [0, 7], [1, 7], [2, 7]], rows: [6, 7] }];
        for (const lock of locks) {
            world.onLock(lock);
            run(world, 0.4);
        }
        run(world, 1.5); // every one of them has opened
        // One more, whose spark is still in flight when the rows clear.
        world.onLock({ ...T_RIGHT, cells: [[8, 3], [7, 4], [8, 4], [9, 4]], rows: [3, 4] });
        const stars = litStars(world);
        expect(stars).toHaveLength(5);
        const before = stars.map((star) => star.dies);
        const late = stars[4];
        expect(late.born).toBeGreaterThan(world.now);
        stars.forEach((star) => expect(star.dies - star.born).toBeCloseTo(STAR_LIFE, 9));

        const at = world.eventClock;
        world.onClear({ rows: [19], lines: 1 });
        // (The lock of that last piece left a small front of its own in the same instant.)
        const [front] = ringsSince(world, at).sort((a, b) => b.reach - a.reach);
        expect(front.reach).toBeGreaterThan(Math.hypot(world.aspect, 1));
        const passes = stars
            .map((star) => front.t0 + ringPassTime(Math.hypot(star.x - front.x, star.y - front.y), front.reach));
        stars.forEach((star, i) => {
            // Every living star's time is cut short…
            expect(star.dies, `star ${i}`).toBeLessThan(before[i]);
            expect(star.dies, `star ${i}`).toBeLessThan(at + RING_LIFE);
            // …to no sooner than the front arrives, and never before the star has opened.
            expect(star.dies, `star ${i}`).toBeGreaterThanOrEqual(passes[i] - 1e-9);
            expect(star.dies, `star ${i}`).toBeGreaterThan(star.born);
            expect(star.dies, `star ${i}`).toBeGreaterThan(at);
        });
        // A star that is already burning goes exactly as the front passes it: nearer ones first.
        for (let i = 0; i < 4; i += 1) expect(stars[i].dies).toBeCloseTo(passes[i], 9);
        const byDistance = stars.slice(0, 4)
            .map((star) => [Math.hypot(star.x - front.x, star.y - front.y), star.dies])
            .sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < byDistance.length; i += 1) {
            expect(byDistance[i][1]).toBeGreaterThanOrEqual(byDistance[i - 1][1]);
        }
        // The one still in flight opens first, then goes.
        expect(late.dies).toBeGreaterThan(late.born);
        expect(late.dies - late.born).toBeLessThan(1);

        // A second clear never gives a star its time back.
        const cut = stars.map((star) => star.dies);
        run(world, 0.05);
        world.onClear({ rows: [19], lines: 1 });
        stars.forEach((star, i) => expect(star.dies).toBeLessThanOrEqual(cut[i]));
        // They burn until the front arrives, flare, and are gone.
        expect(world.getState().stars).toBeGreaterThanOrEqual(4);
        run(world, RING_LIFE + 2);
        expect(world.getState().stars).toBe(0);
        // A star that has already gone is not woken by a later clear.
        const spent = stars.map((star) => star.dies);
        world.onClear({ rows: [19], lines: 1 });
        stars.forEach((star, i) => expect(star.dies).toBe(spent[i]));
        expectFiniteTables(world);
        world.dispose();
    });

    it('holds its breath on four lines: everything is scheduled a hush later, then fires in starfire', () => {
        const { world } = makeWorld('Low');
        const { board } = stageOf(world);
        world.onLock(T_LEFT);
        run(world, 1.5);
        const [star] = litStars(world);
        const rest = { ...world.getPostState() };
        const shock = world.picture.shock.value.clone();

        const at = world.eventClock;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        const fires = at + HUSH_HOLD;
        expect(world.hushAt).toBe(at);
        // Nothing the clear wrote starts before the breath is let go.
        const jets = roundSplats(world, at);
        expect(jets).toHaveLength(8);
        for (const jet of jets) expect(jet.t0).toBeGreaterThanOrEqual(fires - 1e-9);
        const rings = ringsSince(world, at).sort((a, b) => a.t0 - b.t0);
        expect(rings.length).toBeGreaterThanOrEqual(2);
        for (const ring of rings) expect(ring.t0).toBeGreaterThanOrEqual(fires - 1e-9);
        expect(rings[0].t0).toBeCloseTo(fires, 12);
        expect(rings[0].x).toBeCloseTo((board.x0 + board.x1) / 2, 9);
        for (const beam of beamsSince(world, at)) expect(beam.at).toBeGreaterThanOrEqual(fires - 1e-3);
        expect(beamsSince(world, at)).toHaveLength(8);
        for (const burst of burstsSince(world, at)) expect(burst.at).toBeGreaterThanOrEqual(fires - 1e-3);
        // The star the board lit goes when that later front reaches it.
        expect(star.dies).toBeCloseTo(
            fires + ringPassTime(Math.hypot(star.x - rings[0].x, star.y - rings[0].y), rings[0].reach),
            9,
        );
        // The Tide Star answers with a front of its own.
        const tideStar = tideStarPosition(0, fires, world.aspect);
        expect(rings.some((ring) => Math.hypot(ring.x - tideStar.x, ring.y - tideStar.y) < 1e-9)).toBe(true);
        expect(burstsSince(world, at).some((burst) => Math.hypot(burst.x - tideStar.x, burst.y - tideStar.y) < 1e-4))
            .toBe(true);

        // ── the hush: everything sinks, nothing flashes ──
        run(world, HUSH_HOLD * 0.6);
        expect(world.picture.hush.value).toBeGreaterThan(0.8);
        expect(world.getPostState().flash).toBe(0);
        expect(world.getPostState().kick).toBe(0);
        expect(world.getPostState().exposure).toBeLessThan(rest.exposure);
        expect(world.events.wells.every((well) => well.flow < 3)).toBe(true);

        // ── then everything fires at once ──
        run(world, HUSH_HOLD * 0.4 + 0.25);
        expect(world.picture.hush.value).toBeLessThan(0.2);
        const post = world.getPostState();
        expect(post.flash).toBeGreaterThan(0.3);
        expect(post.kick).toBeGreaterThan(0);
        expect(post.bloomBoost).toBeGreaterThan(rest.bloomBoost);
        // The Tide Star flares: brighter, and blowing harder at the gas round it.
        expect(world.flareStrength(world.now)).toBeGreaterThan(0.3);
        expect(world.picture.starFlux.value.x).toBeGreaterThan(1.3);
        // The fronts burn in starfire for a while, whatever the palette.
        const burning = world.picture.shock.value;
        expect(burning.r).toBeCloseTo(STARFIRE[0], 6);
        expect(burning.g).toBeCloseTo(STARFIRE[1], 6);
        expect(burning.b).toBeCloseTo(STARFIRE[2], 6);
        expect(burning.equals(shock)).toBe(false);
        run(world, 6);
        expect(world.picture.shock.value.r).toBeCloseTo(shock.r, 6);
        expect(world.picture.shock.value.b).toBeCloseTo(shock.b, 6);
        expect(world.flareStrength(world.now)).toBe(0);
        expect(world.picture.hush.value).toBe(0);
        expect(world.getPostState().flash).toBeLessThan(0.01);
        expectFiniteTables(world);
        world.dispose();
    });

    it('keeps the echo of the piece that made a four-line clear', () => {
        // The clear's jets start a breath later; counting what is in flight at THAT instant as
        // spent used to hand them the slots of the lock written in the same frame.
        for (const hardDrop of [false, true]) {
            const { world } = makeWorld('Low');
            run(world, 0.2);
            const at = world.eventClock;
            world.onLock({ ...T_LEFT, hardDrop });
            const written = world.events.splats.filter((s) => s.t0 >= at - 1e-9 && s.duration > 0).length;
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
            expect(cellSplats(world, at)).toHaveLength(T_LEFT.cells.length);
            const after = world.events.splats.filter((s) => s.t0 >= at - 1e-9 && s.duration > 0).length;
            expect(after).toBe(written + 8);
            expect(world.events.stolen).toBe(0);
        }
    });

    it('treats a perfect clear as a four-line clear, however few lines it took', () => {
        const { world } = makeWorld('Low');
        const at = world.eventClock;
        world.onClear({ rows: [19], lines: 1, perfect: true });
        expect(world.hushAt).toBe(at);
        expect(roundSplats(world, at)).toHaveLength(2);
        for (const ring of ringsSince(world, at)) expect(ring.t0).toBeGreaterThanOrEqual(at + HUSH_HOLD - 1e-9);
        const tideStar = tideStarPosition(0, at + HUSH_HOLD, world.aspect);
        expect(ringsSince(world, at).some((ring) => Math.hypot(ring.x - tideStar.x, ring.y - tideStar.y) < 1e-9))
            .toBe(true);
        // And the spring behind the board opens wider than a plain line's.
        const plain = makeWorld('Low').world;
        plain.onClear({ rows: [19], lines: 1 });
        expect(world.burst.strength).toBeGreaterThan(plain.burst.strength);
        plain.dispose();
        world.dispose();
    });

    it('turns the whole tide about the board for a T-spin', () => {
        const { world } = makeWorld('Low');
        const swirlAt = () => Math.max(...world.events.wells.map((well) => Math.abs(well.swirl)));
        const rest = swirlAt();
        const at = world.eventClock;
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        expect(world.twist.at).toBe(at);
        expect(Math.abs(world.twist.strength)).toBeGreaterThan(0);
        run(world, SIM_DT);
        expect(swirlAt()).toBeGreaterThan(rest + 1);
        // A plain clear turns nothing.
        const plain = makeWorld('Low').world;
        plain.onClear({ rows: [19, 18], lines: 2 });
        run(plain, SIM_DT);
        expect(Math.max(...plain.events.wells.map((well) => Math.abs(well.swirl)))).toBeCloseTo(rest, 6);
        plain.dispose();
        // It winds down.
        run(world, 4);
        expect(swirlAt()).toBeCloseTo(rest, 6);
        world.dispose();
    });

    it('starts a click\'s clear where it was clicked, and fires no rows', () => {
        const { world } = makeWorld('Low', { live: false });
        const at = world.eventClock;
        world.onClear({ lines: 1, combo: 3, screen: { x: 0.15, y: 0.9 } });
        expect(roundSplats(world, at)).toHaveLength(0);
        expect(beamsSince(world, at)).toHaveLength(0);
        const [ring] = ringsSince(world, at);
        expect(ring.x).toBeCloseTo((0.15 - 0.5) * 2 * world.aspect, 9);
        expect(ring.y).toBeCloseTo(0.8, 9);
        expectFiniteTables(world);
        world.dispose();
    });
});

describe('aether tides world: the maelstrom', () => {
    it('opens on the second clear of a chain and deepens with every step', () => {
        const { world } = makeWorld('Low');
        expect(world.getState()).toMatchObject({ combo: 0, well: 0 });
        const rest = { ...world.getPostState() };
        const tide = world.tide.tide.value;
        // One clear is not a chain.
        world.onCombo(1);
        expect(world.combo).toBe(1);
        expect(world.wellAim).toBe(0);
        run(world, 1);
        expect(world.wellOpen).toBe(0);
        expect(world.picture.well.value.w).toBe(0);
        // The second opens it; it eases open, it does not snap.
        world.onCombo(2);
        const two = world.wellAim;
        expect(two).toBeGreaterThan(0);
        expect(world.wellOpen).toBe(0);
        run(world, 0.2);
        expect(world.wellOpen).toBeGreaterThan(0);
        expect(world.wellOpen).toBeLessThan(two);
        run(world, 4);
        expect(world.wellOpen).toBeCloseTo(two, 3);
        // Every further step aims deeper, and never past fully open.
        let previous = two;
        for (const combo of [3, 4, 6, 9, 15, 40]) {
            world.onCombo(combo);
            expect(world.wellAim, `combo ${combo}`).toBeGreaterThan(previous);
            expect(world.wellAim, `combo ${combo}`).toBeLessThanOrEqual(1);
            previous = world.wellAim;
        }
        run(world, 5);
        expect(world.wellOpen).toBeCloseTo(previous, 3);
        expect(world.getState()).toMatchObject({ combo: 40, well: Number(world.wellOpen.toFixed(3)) });

        // It stands in the open sky, draws the gas in and turns it, and bends the light behind it.
        const where = maelstromPosition(world.now, world.aspect);
        const well = world.picture.well.value;
        expect(well.x).toBeCloseTo(where.x, 9);
        expect(well.y).toBeCloseTo(where.y, 9);
        expect(well.w).toBe(world.wellOpen);
        expect(well.z).toBeGreaterThan(0);
        const sink = world.events.wells
            .find((slot) => Math.hypot(slot.x - where.x, slot.y - where.y) < 1e-2 && slot.flow < 0);
        expect(sink).toBeTruthy();
        expect(sink.swirl).toBeGreaterThan(0);
        expect(sink.drain).toBeGreaterThan(0);
        // The chain charges the tide and the post.
        expect(world.tide.tide.value).toBeGreaterThan(tide);
        expect(world.getPostState().bloomBoost).toBeGreaterThan(rest.bloomBoost);
        expect(world.picture.starFlux.value.x).toBeGreaterThan(1);
        expectFiniteTables(world);
        world.dispose();
    });

    it('feeds the maelstrom as the chain grows: arms of gas drawn in, and a front running inward', () => {
        const { world } = makeWorld('Low');
        world.onLock(T_LEFT);
        run(world, 1.2);
        const at = world.eventClock;
        const where = { ...maelstromPosition(at, world.aspect) };
        world.onCombo(2);
        // Arms of gas that end in the well.
        const arms = roundSplats(world, at);
        expect(arms.length).toBeGreaterThanOrEqual(2);
        for (const arm of arms) {
            expect(arm.bx).toBeCloseTo(where.x, 9);
            expect(arm.by).toBeCloseTo(where.y, 9);
            expect(Math.hypot(arm.ax - where.x, arm.ay - where.y)).toBeGreaterThan(0.5);
            expect(pours(arm)).toBe(true);
        }
        // One of them in the colour of the piece that made the chain.
        const rgb = pieceColor(T_LEFT.color);
        expect(arms.some((arm) => Math.abs(arm.g / arm.r - rgb[1] / rgb[0]) < 1e-9)).toBe(true);
        // A front that pulls instead of pushing.
        const rings = ringsSince(world, at);
        expect(rings).toHaveLength(1);
        expect(rings[0].push).toBeLessThan(0);
        expect(rings[0].x).toBeCloseTo(where.x, 9);
        expect(rings[0].y).toBeCloseTo(where.y, 9);
        expect(burstsSince(world, at)).toHaveLength(1);
        // The same combo reported twice is not another step.
        const written = splatsSince(world, at).length;
        world.onCombo(2);
        expect(splatsSince(world, at)).toHaveLength(written);
        expect(ringsSince(world, at)).toHaveLength(1);
        // The next step feeds it again.
        run(world, 1);
        const next = world.eventClock;
        world.onCombo(3);
        expect(roundSplats(world, next).length).toBeGreaterThanOrEqual(2);
        expect(ringsSince(world, next)).toHaveLength(1);
        expectFiniteTables(world);
        world.dispose();
    });

    it('lets go when the chain breaks: a front and two jets from the well, and the tide runs out', () => {
        const { world } = makeWorld('Low');
        const release = vi.spyOn(world, 'releaseMaelstrom');
        world.onCombo(2);
        world.onCombo(3);
        world.onCombo(4);
        run(world, 4);
        const open = world.wellOpen;
        expect(open).toBeGreaterThan(0.3);
        expect(release).not.toHaveBeenCalled();

        const at = world.eventClock;
        const where = { ...maelstromPosition(at, world.aspect) };
        world.onCombo(0);
        expect(release).toHaveBeenCalledOnce();
        expect(world.combo).toBe(0);
        expect(world.wellAim).toBe(0);
        expect(world.releaseAt).toBe(at);
        // A front from where the well stood, pushing outward…
        const rings = ringsSince(world, at);
        expect(rings).toHaveLength(1);
        expect(rings[0].x).toBeCloseTo(where.x, 9);
        expect(rings[0].y).toBeCloseTo(where.y, 9);
        expect(rings[0].push).toBeGreaterThan(0);
        // …and two jets along its axis, opposite ways.
        const jets = roundSplats(world, at);
        expect(jets).toHaveLength(2);
        for (const jet of jets) {
            expect(jet.ax).toBeCloseTo(where.x, 9);
            expect(jet.ay).toBeCloseTo(where.y, 9);
            expect(jet.t0).toBe(at);
            expect(pours(jet)).toBe(true);
        }
        expect(jets[0].bx - where.x).toBeCloseTo(-(jets[1].bx - where.x), 9);
        expect(jets[0].by - where.y).toBeCloseTo(-(jets[1].by - where.y), 9);
        expect(Math.hypot(jets[0].bx - where.x, jets[0].by - where.y)).toBeGreaterThan(0.5);
        expect(burstsSince(world, at)).toHaveLength(1);
        // It closes slower than it opened, and all the way.
        run(world, 0.3);
        expect(world.wellOpen).toBeLessThan(open);
        expect(world.wellOpen).toBeGreaterThan(open * 0.3);
        run(world, 12);
        expect(world.wellOpen).toBe(0);
        expect(world.getState().well).toBe(0);
        expect(world.picture.well.value.w).toBe(0);
        // Nothing to let go of twice.
        world.onCombo(0);
        expect(release).toHaveBeenCalledOnce();
        expectFiniteTables(world);
        world.dispose();
    });

    it('lets nothing go when there is nothing to let go of', () => {
        const { world } = makeWorld('Low');
        const release = vi.spyOn(world, 'releaseMaelstrom');
        // A single clear that goes nowhere.
        world.onCombo(1);
        run(world, 1);
        world.onCombo(0);
        // A chain broken before the well had opened at all.
        world.onCombo(2);
        world.onCombo(0);
        expect(release).not.toHaveBeenCalled();
        expect(world.wellAim).toBe(0);
        // Nonsense is no chain.
        world.onCombo(NaN);
        expect(world.combo).toBe(0);
        world.onCombo(-4);
        expect(world.combo).toBe(0);
        world.onCombo(undefined);
        expect(world.combo).toBe(0);
        world.onCombo(3.4);
        expect(world.combo).toBe(3);
        expectFiniteTables(world);
        world.dispose();
    });

    it('forgets the chain when a run ends, and lets the nebula flow on', () => {
        const { world } = makeWorld('Low');
        world.onLock(T_LEFT);
        world.onCombo(5);
        run(world, 3);
        const { clock } = world.fluid;
        const { steps } = world.getState().fluid;
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.wellAim).toBe(0);
        // The gas is not reset, and the star it lit stays.
        expect(world.fluid.clock).toBe(clock);
        expect(world.getState().fluid.steps).toBe(steps);
        expect(world.getState().stars).toBe(1);
        run(world, 12);
        expect(world.wellOpen).toBe(0);
        // The next run's first clear is a chain of one again.
        world.onCombo(1);
        expect(world.wellAim).toBe(0);
        world.dispose();
    });
});

describe('aether tides world: levels, seeks and reduced motion', () => {
    it('changes the nebula\'s colours for a new level, blending from the old ones', () => {
        const { world } = makeWorld('Low');
        const [first, second] = AETHER_PALETTES;
        const gasA = world.fieldUniforms.gasA.value;
        expect(gasA.r).toBeCloseTo(first.gasA[0], 6);
        expect(gasA.g).toBeCloseTo(first.gasA[1], 6);
        expect(gasA.b).toBeCloseTo(first.gasA[2], 6);
        for (const key of PALETTE_KEYS) expect(world.palette[key], key).toEqual(first[key]);
        const heal = world.tide.heal.value;

        const at = world.eventClock;
        world.levelUp(2);
        expect(world.level).toBe(2);
        expect(world.getState().palette).toBe(second.name);
        // Nothing has changed colour yet: it blends.
        expect(world.palette.gasA).toEqual(first.gasA);
        // A soft front from the board announces it.
        expect(ringsSince(world, at)).toHaveLength(1);
        run(world, 1.3);
        const mid = world.palette.gasA.slice();
        for (let c = 0; c < 3; c += 1) {
            expect(mid[c]).toBeGreaterThanOrEqual(Math.min(first.gasA[c], second.gasA[c]) - 1e-9);
            expect(mid[c]).toBeLessThanOrEqual(Math.max(first.gasA[c], second.gasA[c]) + 1e-9);
        }
        expect(mid).not.toEqual(first.gasA);
        expect(mid).not.toEqual(second.gasA);
        // While the colours turn the nebula heals faster, so the new palette takes hold.
        expect(world.tide.heal.value).toBeGreaterThan(heal);
        run(world, 3);
        for (const key of PALETTE_KEYS) {
            world.palette[key].forEach((channel, c) => expect(channel, key).toBeCloseTo(second[key][c], 9));
        }
        // The uniforms the shaders read follow.
        expect(gasA.r).toBeCloseTo(second.gasA[0], 6);
        expect(gasA.g).toBeCloseTo(second.gasA[1], 6);
        expect(world.picture.deep.value.b).toBeCloseTo(second.deep[2], 6);
        expect(world.picture.starColorA.value.r).toBeCloseTo(second.star[0], 6);
        expect(world.picture.starColorB.value.g).toBeCloseTo(second.companion[1], 6);
        expect(world.picture.dustTint.value.r).toBeCloseTo(second.dust[0], 6);
        run(world, 12);
        expect(world.tide.heal.value).toBeCloseTo(heal, 9);

        // The same level again is no event.
        const again = world.eventClock;
        world.levelUp(2);
        expect(ringsSince(world, again).filter((ring) => ring.t0 === again)).toHaveLength(0);
        // The palettes come round again; nonsense is level one.
        world.levelUp(AETHER_PALETTES.length + 1);
        expect(world.getState().palette).toBe(first.name);
        world.levelUp(NaN);
        expect(world.level).toBe(1);
        world.levelUp(-3);
        expect(world.level).toBe(1);
        expectFiniteTables(world);
        world.dispose();
    });

    it('rests on a level\'s palette at once when asked to do it silently', () => {
        const { world } = makeWorld('Low');
        const third = AETHER_PALETTES[2];
        const at = world.eventClock;
        world.levelUp(3, { silent: true });
        expect(world.getState().palette).toBe(third.name);
        for (const key of PALETTE_KEYS) expect(world.palette[key], key).toEqual(third[key]);
        expect(world.fieldUniforms.gasC.value.b).toBeCloseTo(third.gasC[2], 6);
        expect(ringsSince(world, at)).toHaveLength(0);
        expect(world.flash.strength).toBe(0);
        run(world, 1);
        for (const key of PALETTE_KEYS) expect(world.palette[key], key).toEqual(third[key]);
        world.dispose();
    });

    it('clears everything in flight on a seek: still gas, no chain, nothing held', () => {
        const { renderer, world } = makeWorld('Low');
        world.onLock({ ...T_LEFT, hardDrop: true });
        world.onLock(T_RIGHT);
        world.onCombo(4);
        run(world, 1);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4, tspin: true });
        run(world, 0.5);
        expect(world.getState().splats).toBeGreaterThan(0);
        expect(world.getState().rings).toBeGreaterThan(0);
        expect(world.wellOpen).toBeGreaterThan(0);
        expect(world.getPostState().flash).toBeGreaterThan(0);

        renderer.passes.length = 0;
        world.seek(50);
        expect(world.now).toBe(50);
        expect(world.eventClock).toBe(50);
        expect(world.getState()).toMatchObject({
            combo: 0, well: 0, locks: 0, stars: 0, splats: 0, rings: 0, stolen: 0,
        });
        expect(world.getState().fluid).toMatchObject({ steps: 0, clock: 50 });
        expect(splatsSince(world, -1e5)).toHaveLength(0);
        expect(ringsSince(world, -1e5)).toHaveLength(0);
        expect(litStars(world)).toHaveLength(0);
        expect(burstsSince(world, -1e5)).toHaveLength(0);
        expect(beamsSince(world, -1e5)).toHaveLength(0);
        expect(outlinesSince(world, -1e5)).toHaveLength(0);
        expect(world.wellOpen).toBe(0);
        expect(world.wellAim).toBe(0);
        expect(world.getPostState()).toMatchObject({ flash: 0, kick: 0, bloomBoost: 0 });
        // The gas is laid out again as the resting nebula.
        expect(renderer.passes.some((pass) => /dye/.test(pass.material))).toBe(true);
        run(world, 0.5);
        expect(world.flareStrength(world.now)).toBe(0);
        expect(world.picture.hush.value).toBe(0);
        expect(world.getPostState()).toMatchObject({ flash: 0, kick: 0, exposure: 1 });
        expect(world.getState()).toMatchObject({ splats: 0, rings: 0, stars: 0 });
        expectFiniteTables(world);
        world.dispose();
    });

    it('replays the same script to the same table: a seek and a fixed-step run reproduce a frame', () => {
        const script = (world) => {
            world.seek(20);
            world.onLock(T_LEFT);
            run(world, 0.25);
            world.onLock({ ...I_FLOOR, hardDrop: true });
            world.onClear({ rows: [19], lines: 1 });
            world.onCombo(1);
            run(world, 0.4);
            world.onLock(T_RIGHT);
            world.onClear({ rows: [19, 18], lines: 2, tspin: true });
            world.onCombo(2);
            run(world, 0.6);
            world.levelUp(2);
            run(world, 0.3);
            return {
                events: Array.from(world.events.data),
                fx: Array.from(world.fx.table.data),
                post: { ...world.getPostState() },
                state: { ...world.getState(), cpuMs: 0, fluid: null },
            };
        };
        const a = makeWorld('Low');
        const b = makeWorld('Low');
        const first = script(a.world);
        expect(script(b.world)).toEqual(first);
        // The same world, sought back and played again. (The level it had reached is put back
        // first: a seek rewinds what is in flight, never the palette the run rests on.)
        a.world.levelUp(1, { silent: true });
        expect(script(a.world)).toEqual(first);
        // One frame of thirty steps, or thirty frames of one: the table does not care.
        const coarse = makeWorld('Low');
        coarse.world.seek(20);
        coarse.world.onLock(T_LEFT);
        coarse.world.update({ time: 0, delta: 0.5 });
        const fine = makeWorld('Low');
        fine.world.seek(20);
        fine.world.onLock(T_LEFT);
        run(fine.world, 0.5);
        expect(Array.from(coarse.world.events.data)).toEqual(Array.from(fine.world.events.data));
        for (const { world } of [a, b, coarse, fine]) world.dispose();
    });

    it('scales every push down under reduced motion, and keeps the feedback', () => {
        const lively = makeWorld('Low').world;
        const calm = makeWorld('Low').world;
        calm.setReducedMotion(true);
        expect(calm.reducedMotion).toBe(true);
        const at = lively.eventClock;
        const pushOf = (list) => list.reduce((sum, s) => sum + Math.hypot(s.fx, s.fy), 0);
        const pourOf = (list) => list.reduce((sum, s) => sum + s.r + s.g + s.b, 0);

        // ── a hard drop ──
        for (const world of [lively, calm]) world.onLock({ ...T_LEFT, hardDrop: true });
        // The same gas in the same place: the piece is still answered.
        expect(cellSplats(calm, at)).toHaveLength(4);
        cellSplats(calm, at).forEach((splat, i) => {
            expect(splat.ax).toBe(cellSplats(lively, at)[i].ax);
            expect(splat.r).toBe(cellSplats(lively, at)[i].r);
        });
        expect(litStars(calm)).toHaveLength(1);
        // Every push is gentler.
        expect(pushOf(splatsSince(calm, at))).toBeGreaterThan(0);
        expect(pushOf(splatsSince(calm, at))).toBeLessThan(pushOf(splatsSince(lively, at)) * 0.75);
        expect(ringsSince(calm, at)[0].push).toBeLessThan(ringsSince(lively, at)[0].push * 0.75);
        expect(ringsSince(calm, at)[0].rough).toBeLessThan(ringsSince(lively, at)[0].rough);
        expect(ringsSince(calm, at)[0].reach).toBe(ringsSince(lively, at)[0].reach);
        expect(calm.kick.strength).toBeGreaterThan(0);
        expect(calm.kick.strength).toBeLessThan(lively.kick.strength * 0.75);
        expect(calm.flash.strength).toBeLessThan(lively.flash.strength * 0.75);

        // ── a clear ──
        for (const world of [lively, calm]) run(world, 1);
        const clearAt = lively.eventClock;
        for (const world of [lively, calm]) world.onClear({ rows: [19, 18, 17], lines: 3 });
        expect(roundSplats(calm, clearAt)).toHaveLength(roundSplats(lively, clearAt).length);
        expect(pourOf(roundSplats(calm, clearAt))).toBeCloseTo(pourOf(roundSplats(lively, clearAt)), 6);
        expect(pushOf(roundSplats(calm, clearAt))).toBeLessThan(pushOf(roundSplats(lively, clearAt)) * 0.75);
        ringsSince(calm, clearAt).forEach((ring, i) => {
            expect(ring.push).toBeLessThan(ringsSince(lively, clearAt)[i].push * 0.75);
            expect(ring.push).toBeGreaterThan(0);
        });
        expect(calm.flash.strength).toBeLessThan(lively.flash.strength * 0.75);

        // ── a chain, and its release ──
        for (const world of [lively, calm]) {
            world.onCombo(3);
            run(world, 3);
        }
        // The well opens as far (it is what the chain looks like) but pulls and turns less.
        expect(calm.wellOpen).toBeCloseTo(lively.wellOpen, 9);
        const sinkOf = (world) => world.events.wells.reduce((best, well) => (well.flow < best.flow ? well : best));
        expect(sinkOf(calm).flow).toBeLessThan(0);
        expect(Math.abs(sinkOf(calm).flow)).toBeLessThan(Math.abs(sinkOf(lively).flow) * 0.75);
        expect(sinkOf(calm).swirl).toBeLessThan(sinkOf(lively).swirl * 0.75);
        // The tide itself runs slower, and the view does not drift.
        expect(calm.tide.tide.value).toBeLessThan(lively.tide.tide.value * 0.75);
        expect(calm.tide.gust.value).toBeLessThan(lively.tide.gust.value * 0.75);
        expect(calm.picture.view.value.toArray()).toEqual([0, 0]);
        expect(lively.picture.view.value.length()).toBeGreaterThan(0.01);
        const breakAt = lively.eventClock;
        for (const world of [lively, calm]) world.onCombo(0);
        expect(ringsSince(calm, breakAt)).toHaveLength(1);
        expect(ringsSince(calm, breakAt)[0].push).toBeLessThan(ringsSince(lively, breakAt)[0].push * 0.75);
        expect(pushOf(roundSplats(calm, breakAt))).toBeLessThan(pushOf(roundSplats(lively, breakAt)) * 0.75);
        // Switched off again, the next lock is as lively as ever.
        calm.setReducedMotion(false);
        for (const world of [lively, calm]) run(world, 1);
        const again = lively.eventClock;
        for (const world of [lively, calm]) world.onLock(T_RIGHT);
        expect(pushOf(splatsSince(calm, again))).toBeCloseTo(pushOf(splatsSince(lively, again)), 9);
        expectFiniteTables(calm);
        lively.dispose();
        calm.dispose();
    });

    it('leans the view with the pointer, eased', () => {
        const { world } = makeWorld('Low');
        world.setReducedMotion(true); // no drift: only the pointer moves the view
        world.update({
            time: 0, delta: SIM_DT, pointerX: 1, pointerY: -1,
        });
        const first = world.picture.view.value.clone();
        expect(first.x).toBeGreaterThan(0);
        expect(first.x).toBeLessThan(0.1);
        expect(first.y).toBeLessThan(0);
        for (let i = 0; i < 240; i += 1) {
            world.update({
                time: 0, delta: SIM_DT, pointerX: 1, pointerY: -1,
            });
        }
        const settled = world.picture.view.value.clone();
        expect(settled.x).toBeGreaterThan(first.x * 5);
        expect(settled.y).toBeLessThan(first.y * 5);
        for (let i = 0; i < 600; i += 1) world.update({ time: 0, delta: SIM_DT });
        expect(world.picture.view.value.length()).toBeLessThan(1e-3);
        world.dispose();
    });

    it('never writes a number that is not one, in any frame shape, whatever the play', () => {
        for (const [width, height] of [[1600, 900], [2560, 1080], [1000, 1000], [430, 932]]) {
            const { world } = makeWorld('Minimal', { width, height });
            const label = `${width}x${height}`;
            const check = (step) => expectFiniteTables(world, `${label} ${step}`);
            for (let column = 0; column < BOARD_GRID.columns; column += 1) {
                world.onLock({
                    player: 0,
                    cells: [
                        [column, 19 - column],
                        [Math.min(9, column + 1), 19 - column],
                        [column, Math.max(0, 18 - column)],
                    ],
                    rows: [18 - column, 19 - column],
                    u: (column + 0.5) / 10,
                    hardDrop: column % 3 === 0,
                    color: column % 2 ? '#3A7BFF' : 0xff4d6d,
                });
                run(world, 0.05);
            }
            check('locks');
            world.onLock({ cells: [], rows: [0], u: 0 });
            world.onLock({
                cells: [], rows: [19], u: 1, hardDrop: true,
            });
            world.onLock({ rows: [] });
            world.onLock({ screen: { x: 0, y: 0 } });
            world.onLock({ screen: { x: 1, y: 1 }, hardDrop: true });
            world.onLock({ player: 3, cells: [[0, 0]] });
            check('odd locks');
            for (let lines = 1; lines <= 4; lines += 1) {
                world.onClear({ lines, rows: Array.from({ length: lines }, (_, i) => 19 - i), combo: lines });
                world.onCombo(lines);
                run(world, 0.2);
                check(`${lines} lines`);
            }
            world.onClear({
                rows: [0], lines: 1, perfect: true, tspin: true, b2b: true,
            });
            world.onClear({ lines: 2, screen: { x: 0.5, y: 0.5 } });
            world.onClear({ rows: [19, 19, 19, 19, 19, 19], lines: 6, player: 4 });
            world.onClear({});
            world.onCombo(12);
            world.levelUp(4);
            run(world, 1.5);
            check('a long chain');
            world.onCombo(0);
            world.levelUp(2);
            world.resetSession();
            run(world, 4);
            check('the break');
            world.setLayout(null);
            world.onLock(T_LEFT);
            world.onClear({ lines: 4 });
            run(world, 1);
            check('no board on screen');
            world.seek(0);
            check('a seek');
            world.dispose();
        }
    });
});

describe('aether tides stardust table', () => {
    const burstRows = (table, slot) => Array.from(table.data.subarray(
        (ROW_BURST + slot * BURST_ROWS) * 4,
        (ROW_BURST + (slot + 1) * BURST_ROWS) * 4,
    ));
    const beamRows = (table, slot) => Array.from(table.data.subarray(
        (ROW_BEAM + slot * BEAM_ROWS) * 4,
        (ROW_BEAM + (slot + 1) * BEAM_ROWS) * 4,
    ));

    it('starts with every slot parked far in the past, so nothing draws', () => {
        const table = new FxTable();
        expect(table.data).toBeInstanceOf(Float32Array);
        expect(table.data).toHaveLength(FX_ROWS * 4);
        expect(ROW_BEAM).toBe(ROW_BURST + BURST_SLOTS * BURST_ROWS);
        expect(FX_ROWS).toBeGreaterThanOrEqual(ROW_BEAM + BEAM_SLOTS * BEAM_ROWS);
        expect(allFinite(table.data)).toBe(true);
        for (let slot = 0; slot < BURST_SLOTS; slot += 1) expect(burstRows(table, slot)[2]).toBeLessThan(-1e5);
        for (let slot = 0; slot < BEAM_SLOTS; slot += 1) expect(beamRows(table, slot)[3]).toBeLessThan(-1e5);
    });

    it('hands bursts out round-robin, so the oldest gives way first', () => {
        const table = new FxTable();
        for (let i = 0; i < BURST_SLOTS; i += 1) {
            expect(table.burst({
                x: i,
                y: -i,
                at: 2 + i,
                color: [1, 0.5, 0.25],
                speed: 1.5,
                dirX: 0,
                dirY: -2,
                aim: 0.75,
                life: 1.25,
                size: 2,
            })).toBe(i);
        }
        // (x, y, t0, aim) (r, g, b, speed) (dirX, dirY, life, size): the direction is made a unit one.
        expect(burstRows(table, 3)).toEqual([3, -3, 5, 0.75, 1, 0.5, 0.25, 1.5, 0, -1, 1.25, 2]);
        // One more than there are slots replaces the first.
        expect(table.burst({
            x: 50, y: 60, at: 99, color: [0.25, 0.5, 1],
        })).toBe(0);
        expect(burstRows(table, 0).slice(0, 3)).toEqual([50, 60, 99]);
        expect(burstRows(table, 1).slice(0, 3)).toEqual([1, -1, 3]);
        expect(table.burstCursor).toBe(1);
        expect(table.data).toHaveLength(FX_ROWS * 4);
    });

    it('throws a burst every way when it is given no direction, whatever aim it asks for', () => {
        const table = new FxTable();
        const slot = table.burst({
            x: 0.5, y: 0.5, at: 1, color: [1, 1, 1], aim: 0.9,
        });
        const [, , , aim, , , , speed, dirX, dirY, life, size] = burstRows(table, slot);
        expect(aim).toBe(0);
        // Still a unit direction: the shader never divides by nothing.
        expect(Math.hypot(dirX, dirY)).toBe(1);
        expect(speed).toBeGreaterThan(0);
        expect(life).toBeGreaterThan(0);
        expect(size).toBeGreaterThan(0);
        // A direction too small to mean anything is no direction either.
        const tiny = table.burst({
            x: 0, y: 0, at: 1, color: [1, 1, 1], dirX: 1e-6, dirY: -1e-6, aim: 0.5,
        });
        expect(burstRows(table, tiny)[3]).toBe(0);
        // A real one keeps its aim and is normalised.
        const aimed = table.burst({
            x: 0, y: 0, at: 1, color: [1, 1, 1], dirX: 3, dirY: 4, aim: 0.5,
        });
        const rows = burstRows(table, aimed);
        expect(rows[3]).toBe(0.5);
        expect(rows[8]).toBeCloseTo(0.6, 6);
        expect(rows[9]).toBeCloseTo(0.8, 6);
        expect(allFinite(table.data)).toBe(true);
    });

    it('hands beams out round-robin and parks everything again on a reset', () => {
        const table = new FxTable();
        for (let i = 0; i < BEAM_SLOTS + 2; i += 1) {
            expect(table.beam({
                x0: -0.5, y: i * 0.125, x1: -2, at: 4 + i, color: [0.5, 1, 0.25], thickness: 0.0625,
            })).toBe(i % BEAM_SLOTS);
        }
        // (x0, y, x1, t0) (r, g, b, thickness); the two newest have replaced the two oldest.
        expect(beamRows(table, 0)).toEqual([-0.5, BEAM_SLOTS * 0.125, -2, 4 + BEAM_SLOTS, 0.5, 1, 0.25, 0.0625]);
        expect(beamRows(table, 2)).toEqual([-0.5, 0.25, -2, 6, 0.5, 1, 0.25, 0.0625]);
        table.burst({
            x: 1, y: 1, at: 7, color: [1, 1, 1],
        });
        const { data } = table;

        table.reset();
        expect(table.data).toBe(data);
        expect(table.burstCursor).toBe(0);
        expect(table.beamCursor).toBe(0);
        for (let slot = 0; slot < BURST_SLOTS; slot += 1) expect(burstRows(table, slot)[2]).toBeLessThan(-1e5);
        for (let slot = 0; slot < BEAM_SLOTS; slot += 1) expect(beamRows(table, slot)[3]).toBeLessThan(-1e5);
        expect(allFinite(table.data)).toBe(true);
        // And the first slot is the next one written.
        expect(table.beam({
            x0: 0, y: 0, x1: 1, at: 1, color: [1, 1, 1], thickness: 0.1,
        })).toBe(0);
        expect(table.burst({
            x: 0, y: 0, at: 1, color: [1, 1, 1],
        })).toBe(0);
    });

    it('hands the echo\'s outlines out round-robin, and parks them on a reset', () => {
        const table = new FxTable();
        const cellRows = (slot) => Array.from(table.data.subarray(
            (ROW_CELL + slot * CELL_ROWS) * 4,
            (ROW_CELL + (slot + 1) * CELL_ROWS) * 4,
        ));
        expect(ROW_CELL).toBe(ROW_BEAM + BEAM_SLOTS * BEAM_ROWS);
        expect(FX_ROWS).toBe(ROW_CELL + CELL_SLOTS * CELL_ROWS);
        // Room for the cells of several pieces at once: an outline outlives the next lock.
        expect(CELL_SLOTS).toBeGreaterThanOrEqual(12);
        for (let slot = 0; slot < CELL_SLOTS; slot += 1) expect(cellRows(slot)[2]).toBeLessThan(-1e5);
        for (let i = 0; i < CELL_SLOTS + 1; i += 1) {
            expect(table.cell({
                x: i * 0.25, y: -0.5, at: 3 + i, half: 0.03125, color: [0.25, 1, 0.5], gain: 2,
            })).toBe(i % CELL_SLOTS);
        }
        // (x, y, t0, half) (r, g, b, gain); the newest has replaced the oldest.
        expect(cellRows(0)).toEqual([CELL_SLOTS * 0.25, -0.5, 3 + CELL_SLOTS, 0.03125, 0.25, 1, 0.5, 2]);
        expect(cellRows(1)).toEqual([0.25, -0.5, 4, 0.03125, 0.25, 1, 0.5, 2]);
        // An outline that names no gain is drawn at full strength.
        const plain = table.cell({
            x: 0, y: 0, at: 1, half: 0.5, color: [1, 1, 1],
        });
        expect(cellRows(plain)[7]).toBe(1);
        table.reset();
        expect(table.cellCursor).toBe(0);
        for (let slot = 0; slot < CELL_SLOTS; slot += 1) expect(cellRows(slot)[2]).toBeLessThan(-1e5);
        expect(allFinite(table.data)).toBe(true);
    });
});

describe('aether tides tiers', () => {
    it('defines every quality tier for the world and the post', () => {
        expect(QUALITY_NAMES).toEqual(['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme']);
        for (const name of QUALITY_NAMES) {
            expect(QUALITY[name]).toBeTruthy();
            expect(tierFor(name)).toBe(QUALITY[name]);
            expect(POST_LOOK[name]).toBeTruthy();
        }
        expect(tierFor('nope')).toBe(QUALITY.High);
        expect(tierFor(undefined)).toBe(QUALITY.High);
    });

    it('scales every budget monotonically with the tier', () => {
        for (let i = 1; i < QUALITY_NAMES.length; i++) {
            const a = QUALITY[QUALITY_NAMES[i - 1]];
            const b = QUALITY[QUALITY_NAMES[i]];
            for (const key of ['cells', 'dyeHeight', 'sweeps', 'lightSteps', 'starLayers', 'sparkles']) {
                expect(b[key], `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(a[key]);
            }
            expect(Number(b.spikes), `${QUALITY_NAMES[i]}.spikes`).toBeGreaterThanOrEqual(Number(a.spikes));
            const lookA = POST_LOOK[QUALITY_NAMES[i - 1]];
            const lookB = POST_LOOK[QUALITY_NAMES[i]];
            for (const key of ['bloom', 'fringe', 'bloomStrength', 'bloomResolution']) {
                expect(Number(lookB[key]), `${QUALITY_NAMES[i]}.${key}`).toBeGreaterThanOrEqual(Number(lookA[key]));
            }
        }
    });

    it('keeps the fluid and every event on every tier', () => {
        for (const name of QUALITY_NAMES) {
            const tier = QUALITY[name];
            // A grid worth solving on, a dye worth looking at, a pressure that converges a little.
            expect(tier.cells, name).toBeGreaterThanOrEqual(4000);
            expect(tier.dyeHeight, name).toBeGreaterThanOrEqual(144);
            expect(tier.sweeps, name).toBeGreaterThanOrEqual(2);
            expect(tier.starLayers, name).toBeGreaterThanOrEqual(1);
            // Stardust for a lock to throw.
            expect(tier.sparkles, name).toBeGreaterThanOrEqual(BURST_SLOTS * 4);
            // The grid is cut to the frame, with square cells, for a wide screen and a tall one.
            for (const aspect of [21 / 9, 16 / 9, 1, 9 / 19.5]) {
                const grid = gridFor(aspect, tier.cells);
                expect(grid.width / grid.height, name).toBeCloseTo(aspect, 1);
                expect(grid.width * grid.height, name).toBeGreaterThan(tier.cells * 0.8);
                expect(grid.width * grid.height, name).toBeLessThan(tier.cells * 1.25);
            }
        }
        // A frame shape that makes no sense is clamped, never a grid of nothing.
        for (const aspect of [0, 0.001, 1000]) {
            const grid = gridFor(aspect, QUALITY.Minimal.cells);
            expect(grid.width).toBeGreaterThanOrEqual(24);
            expect(grid.height).toBeGreaterThanOrEqual(24);
        }
    });
});
