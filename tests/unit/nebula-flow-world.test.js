/**
 * Nebula Flow — the world, on the CPU: a real NebulaFlowWorld in a THREE.Scene, no renderer,
 * driven in fixed steps as the theme drives it (the camera, then the gameplay staged since the last
 * frame, then the frame).
 *
 * These pin behaviour and contracts — what a lock, a clear, a chain, four lines and a new level
 * DO, in what order and how often — never a tuning number: constants are imported, and the
 * assertions are relations (counted, ordered, bounded, monotonic).
 */
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    NEBULA_FLOW_PARTS, NebulaFlowWorld, REST_RIG, fovForAspect,
} from '../../src/themes/nebula-flow/nebula-flow-world.js';
import {
    BIRTH_FADE,
    BIRTH_LIFE,
    BIRTH_SLOTS,
    BIRTH_ROWS,
    FLIGHT,
    FLIGHT_DROP,
    FLOW_REST,
    FRONT_LIFE,
    FRONT_ROWS,
    FRONT_SLOTS,
    FRONT_SPEED,
    GREAT_FRONT_SPEED,
    LANTERN_ROWS,
    HUSH_HOLD,
    KIND_AMBIENT,
    KIND_DROP,
    KIND_GREAT,
    KIND_LOCK,
    NEBULA_PALETTES,
    PALETTE_HOME,
    PALETTE_STEP,
    PILLAR_PLAN,
    PILLAR_ROWS,
    RELEASE_FADE,
    SHAPES,
    birthDone,
    birthLight,
    cellsFromMatrix,
    dustDistance,
    paletteAt,
    paletteName,
    palettePlace,
    pieceColor,
    pillarDistance,
    screenToNursery,
    vortexForCombo,
} from '../../src/themes/nebula-flow/nebula-flow-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/nebula-flow/nebula-flow-quality.js';
import { boardPoint, fallbackLayout } from '../../src/themes/nebula-flow/nebula-flow-composition.js';
import { NEBULA_FLOW_TETROMINOS } from '../../src/themes/nebula-flow/nebula-flow-tetrominos.js';

vi.setConfig({ testTimeout: 30_000 }); // every test builds the nursery's materials

const COLORS = NEBULA_FLOW_TETROMINOS.colors;
const T_CELLS = cellsFromMatrix(SHAPES.T);
const worlds = [];

function makeWorld(quality = 'High', {
    width = 1280, height = 720, layout, at = 10, reduce = false,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new NebulaFlowWorld({ scene, quality, capture: true }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setReducedMotion(reduce);
    world.setViewport(width, height, aspect);
    world.setLayout(layout === undefined ? fallbackLayout(width, height) : layout, aspect);
    world.seek(at);
    const sim = {
        time: at, delta: 0, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
    return { scene, camera, world };
}

/** One frame as the theme runs it: the camera, the gameplay staged since the last frame, the world. */
function frame(world, camera, dt, during = null) {
    const sim = {
        time: world.time + dt, delta: dt, pointerX: 0, pointerY: 0,
    };
    world.updateCamera(camera, sim);
    during?.();
    world.update(sim, camera);
}

function run(world, camera, seconds, dt = 1 / 30) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i += 1) frame(world, camera, dt);
}

const lock = (world, extra = {}) => world.onLock({
    u: 0.2, rows: [12, 11], color: COLORS.T, cells: T_CELLS, ...extra,
});
const lit = (world) => world.births.filter((b) => b.power > 0 && b.kind !== KIND_AMBIENT);
const ambient = (world) => world.births.filter((b) => b.power > 0 && b.kind === KIND_AMBIENT);
const newest = (world) => lit(world).reduce((a, b) => (b.born > a.born ? b : a));
/** The live fronts that left the cluster at or after `t`. */
const clusterFronts = (world, t) => world.fronts.filter((f) => f.strength > 0 && f.born >= t - 1e-9
    && f.x === world.cluster.x && f.y === world.cluster.y);
const tallest = (pillars) => pillars.reduce((a, b) => (b.top > a.top ? b : a));
const tableOf = (rows) => rows.map((v) => v.toArray());
/** A card's left and right edges in nursery space. */
const edgesOf = (card, aspect) => [(card.x0 * 2 - 1) * aspect, (card.x1 * 2 - 1) * aspect];
/** A board row's centre line in nursery space. */
const rowY = (world, u, row) => {
    const pt = boardPoint(world.layout.boards[0], u, row);
    return screenToNursery(pt.x, pt.y, world.aspect)[1];
};

/**
 * A phone's own layout (the stylesheet's mobile sizing: board = min(clamp(280, 80vw, 350),
 * (100vh − 250) / 2), card ≈ 1.19·board wide and 2·board + 158 tall, the stats bar below it).
 */
function phoneLayout(W = 390, H = 844) {
    const board = Math.min(Math.max(280, Math.min(0.8 * W, 350)), (H - 250) / 2);
    const cw = 1.19 * board;
    const ch = 2 * board + 158;
    const bottom = H / 2 + ch / 2;
    const rect = (l, t, r, b) => ({
        x0: l / W, y0: t / H, x1: r / W, y1: b / H,
    });
    return {
        cardCount: 1,
        cards: [rect(W / 2 - cw / 2, H / 2 - ch / 2, W / 2 + cw / 2, bottom)],
        hud: null,
        boards: [rect(W / 2 - board / 2, bottom - 24 - 2 * board, W / 2 + board / 2, bottom - 24), null, null, null, null],
    };
}

/** Four cards side by side across a 16:9 screen (local versus): little of the pillars shows. */
function versusLayout(W = 1920, H = 1080) {
    const span = [0.016, 0.984];
    const gap = 0.014;
    const w = (span[1] - span[0] - gap * 3) / 4;
    const cards = [0, 1, 2, 3].map((i) => ({
        x0: span[0] + i * (w + gap), y0: 0.07, x1: span[0] + i * (w + gap) + w, y1: 0.98,
    }));
    const boards = cards.map((c) => {
        const bw = (c.x1 - c.x0) * 0.8;
        const bh = (bw * W * 2) / H;
        const cx = (c.x0 + c.x1) / 2;
        return {
            x0: cx - bw / 2, y0: c.y1 - 0.03 - bh, x1: cx + bw / 2, y1: c.y1 - 0.03,
        };
    });
    return {
        cardCount: 4, cards, hud: null, boards: [...boards, null],
    };
}

afterEach(() => {
    worlds.splice(0).forEach((w) => w.dispose());
    vi.restoreAllMocks();
});

describe('Nebula Flow world: build', () => {
    it('builds every named part on every tier, all node materials, with the tier\'s stars', () => {
        expect(QUALITY_NAMES).toHaveLength(6);
        QUALITY_NAMES.forEach((quality) => {
            const { world, scene } = makeWorld(quality);
            expect(world.tier, quality).toBe(QUALITY[quality]);
            expect(Object.keys(world.parts), quality).toEqual([...NEBULA_FLOW_PARTS]);
            NEBULA_FLOW_PARTS.forEach((name) => {
                expect(world.parts[name].mesh.parent, `${quality} ${name}`).toBe(world.root);
            });
            expect(world.root.parent).toBe(scene);
            const materials = [];
            scene.traverse((o) => { if (o.material) materials.push(o.material); });
            expect(materials, quality).toHaveLength(NEBULA_FLOW_PARTS.length);
            expect(materials.every((m) => m.isNodeMaterial), quality).toBe(true);
            expect(world.parts.stars.count, quality).toBe(QUALITY[quality].stars);
            // the young stars already in the pillars with no play
            expect(ambient(world), quality).toHaveLength(Math.min(QUALITY[quality].ambient, BIRTH_SLOTS));
            expect(lit(world), quality).toHaveLength(0);
        });
    });

    it('builds the High tier for a quality it does not know', () => {
        const { world } = makeWorld('Cinematic');
        expect(world.tier).toBe(QUALITY.High);
    });

    it('draws only the parts it is asked for', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['nebula', 'births']);
        NEBULA_FLOW_PARTS.forEach((name) => {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'nebula' || name === 'births');
        });
        world.showOnlyParts(NEBULA_FLOW_PARTS);
        NEBULA_FLOW_PARTS.forEach((name) => expect(world.parts[name].mesh.visible, name).toBe(true));
    });

    it('leaves the scene clean when disposed, freeing every geometry, material and texture once', () => {
        const { world, scene } = makeWorld('Low');
        const spies = [
            ...world.textures.map((t) => vi.spyOn(t, 'dispose')),
            ...NEBULA_FLOW_PARTS.map((name) => vi.spyOn(world.parts[name].mesh.geometry, 'dispose')),
            ...NEBULA_FLOW_PARTS.map((name) => vi.spyOn(world.parts[name].mesh.material, 'dispose')),
        ];
        expect(world.textures.length).toBeGreaterThan(0);
        world.dispose();
        expect(scene.children).toHaveLength(0);
        expect(world.parts).toEqual({});
        expect(world.u).toBeNull();
        spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
        // a second dispose and a frame after it are harmless
        expect(() => world.dispose()).not.toThrow();
        expect(() => world.update({ time: 1, delta: 0.1 })).not.toThrow();
        spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    });

    it('frames the sprites\' pass with a rest camera that opens up on a tall screen', () => {
        let last = 0;
        [3, 21 / 9, 16 / 9, 4 / 3, 1, 0.46, 0.2].forEach((aspect) => {
            const fov = fovForAspect(aspect);
            expect(fov).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fov).toBeLessThanOrEqual(REST_RIG.maxFov);
            expect(fov).toBeGreaterThanOrEqual(last);
            last = fov;
        });
        expect(fovForAspect(Number.NaN)).toBe(fovForAspect(16 / 9));
        const { world } = makeWorld('Low');
        const cam = world.restCamera();
        expect(cam.aspect).toBeCloseTo(16 / 9, 9);
        expect(cam.fov).toBe(fovForAspect(16 / 9));
        expect(world.restCamera()).toBe(cam);
    });
});

describe('Nebula Flow world: the stage', () => {
    it('stands the pillars either side of the card, the cluster above the frame and the vortex on the card', () => {
        const { world } = makeWorld('Low');
        const { aspect } = world;
        const card = world.layout.cards[0];
        const [left, right] = edgesOf(card, aspect);
        expect(world.getState().pillars).toEqual(PILLAR_PLAN.map((p) => p.name));
        world.pillars.forEach((p) => {
            if (p.side < 0) expect(p.x0, p.name).toBeLessThan(left);
            else expect(p.x0, p.name).toBeGreaterThan(right);
            expect(Math.abs(p.x0), p.name).toBeLessThan(aspect);
        });
        expect(world.cluster.y).toBeGreaterThan(1);
        const [hx, hy] = screenToNursery((card.x0 + card.x1) / 2, (card.y0 + card.y1) / 2, aspect);
        expect(world.heart.x).toBeCloseTo(hx, 9);
        expect(world.heart.y).toBeCloseTo(hy, 9);
        // the shader reads the same stage
        const rows = world.u.tables.pillars;
        world.pillars.forEach((p, i) => {
            expect(rows[i * PILLAR_ROWS].toArray()).toEqual([p.x0, p.y0, p.top, p.lean]);
            expect(rows[i * PILLAR_ROWS + 1].toArray()).toEqual([p.w0, p.w1, p.depth, p.seed]);
        });
        expect(world.u.cluster.value.toArray()).toEqual([world.cluster.x, world.cluster.y]);
        expect(world.u.aspect.value).toBeCloseTo(aspect, 9);
        expect(world.u.vortex.value.x).toBeCloseTo(hx, 9);
        // the post's light shafts come from the cluster, above the frame
        const post = world.getPostState();
        expect(post.sun.y).toBeLessThan(0);
        expect(post.sun.x).toBeGreaterThan(0);
        expect(post.sun.x).toBeLessThan(1);
    });

    it('kindles every lock\'s star inside the dust, in view, on its column\'s side', () => {
        const { world, camera } = makeWorld('High');
        for (let i = 0; i < 16; i += 1) {
            const u = ((i * 0.37) % 1) * 0.9 + 0.05;
            frame(world, camera, 0.2, () => lock(world, { u, rows: [2 + ((i * 5) % 17)] }));
            const b = newest(world);
            expect(dustDistance(world.pillars, b.x, b.y), `lock ${i}`).toBeLessThan(0);
            expect(world.hidden(b.x, b.y), `lock ${i}`).toBe(false);
            expect(Math.abs(b.x), `lock ${i}`).toBeLessThan(world.aspect);
            expect(Math.sign(b.x), `lock ${i}`).toBe(u < 0.5 ? -1 : 1);
        }
    });

    [
        ['with no board on screen', null],
        ['before its card is measured', fallbackLayout(390, 844)],
        ['round its own card, which fills the width', phoneLayout()],
    ].forEach(([label, layout]) => {
        it(`stands pillars on both sides of a phone ${label}, and kindles every star in view`, () => {
            const { world, camera } = makeWorld('Low', { width: 390, height: 844, layout });
            const { aspect } = world;
            [-1, 1].forEach((side) => {
                const own = world.pillars.filter((p) => p.side === side);
                expect(own, `side ${side}`).toHaveLength(2);
                own.forEach((p) => {
                    expect(Math.sign(p.x0), p.name).toBe(side);
                    // its head shows in the frame
                    expect(Math.abs(p.x0 + p.lean) - p.w1, p.name).toBeLessThan(aspect);
                });
            });
            if (layout) {
                // the tallest head on each side rises above the card when the card fills the width
                const card = layout.cards[0];
                const cardTop = 1 - card.y0 * 2;
                const [, right] = edgesOf(card, aspect);
                if (right > aspect * 0.85) {
                    [-1, 1].forEach((side) => {
                        expect(tallest(world.pillars.filter((p) => p.side === side)).top, `side ${side}`)
                            .toBeGreaterThan(cardTop);
                    });
                }
            }
            for (let i = 0; i < 12; i += 1) {
                const u = ((i * 0.37) % 1) * 0.9 + 0.05;
                frame(world, camera, 0.2, () => lock(world, { u, rows: [3 + (i % 15)] }));
                const b = newest(world);
                expect(dustDistance(world.pillars, b.x, b.y), `lock ${i}`).toBeLessThan(0);
                expect(world.hidden(b.x, b.y), `lock ${i} at ${b.x.toFixed(2)}, ${b.y.toFixed(2)}`).toBe(false);
                // inside the frame, not past its edge where the pillars stand
                expect(Math.abs(b.x), `lock ${i}`).toBeLessThan(aspect);
                expect(Math.sign(b.x), `lock ${i}`).toBe(u < 0.5 ? -1 : 1);
            }
            // the sites follow the rows (not one fallback point for every lock)
            expect(new Set(lit(world).map((b) => b.y.toFixed(3))).size).toBeGreaterThan(4);
            [...ambient(world), ...lit(world)].forEach((b) => expect(Math.abs(b.x)).toBeLessThan(aspect));
            frame(world, camera, 1 / 30, () => world.greatStar(world.time, 1));
            const great = world.births.find((b) => b.kind === KIND_GREAT);
            expect(Math.abs(great.x)).toBeLessThan(aspect);
            expect(world.hidden(great.x, great.y)).toBe(false);
        });
    });
});

describe('Nebula Flow world: a new stage', () => {
    it('keeps every kindled star, and the great star\'s hole, in its pillar when the stage is laid out anew', () => {
        const { world, camera } = makeWorld('High', { width: 1920, height: 969 });
        for (let i = 0; i < 8; i += 1) {
            frame(world, camera, 0.2, () => lock(world, { u: (i % 2 ? 0.75 : 0.2) + (i % 3) * 0.04, rows: [6 + i] }));
        }
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [16, 17, 18, 19], lines: 4 }));
        run(world, camera, HUSH_HOLD + 0.5, 1 / 30);
        expect(world.getState().counts.quads).toBe(1);
        const inDust = () => {
            lit(world).forEach((b) => expect(dustDistance(world.pillars, b.x, b.y), `${b.x}, ${b.y}`).toBeLessThan(0));
            expect(dustDistance(world.pillars, world.hole.x, world.hole.y)).toBeLessThan(0);
        };
        inDust();
        const first = lit(world).map((b) => [b.x, b.y]);
        [[1920, 1080], [1600, 969], [390, 844]].forEach(([width, height]) => {
            const aspect = width / height;
            world.setViewport(width, height, aspect);
            world.setLayout(width < height ? phoneLayout(width, height) : fallbackLayout(width, height), aspect);
            inDust();
            // and inside the frame, a stage turned upright included
            lit(world).forEach((b) => expect(Math.abs(b.x)).toBeLessThan(aspect));
            // the great star's hole goes with it, and what the shaders read follows
            const great = world.births.findIndex((b) => b.kind === KIND_GREAT);
            expect([world.hole.x, world.hole.y]).toEqual([world.births[great].x, world.births[great].y]);
            expect(world.u.tables.births[great * BIRTH_ROWS].x).toBe(world.births[great].x);
        });
        // back on the first stage, every star is back on its own place
        world.setViewport(1920, 969, 1920 / 969);
        world.setLayout(fallbackLayout(1920, 969), 1920 / 969);
        lit(world).forEach((b, i) => {
            expect(b.x).toBeCloseTo(first[i][0], 9);
            expect(b.y).toBeCloseTo(first[i][1], 9);
        });
    });

    it('kindles every star inside the frame on a crowded versus screen, and the great star where it shows', () => {
        const { world, camera } = makeWorld('High', { width: 1920, height: 1080, layout: versusLayout() });
        for (let i = 0; i < 12; i += 1) {
            frame(world, camera, 0.1, () => lock(world, { player: i % 4, u: i % 2 ? 0.9 : 0.1, rows: [4 + i] }));
            const b = newest(world);
            expect(Math.abs(b.x)).toBeLessThan(world.aspect);
            expect(Math.abs(b.y)).toBeLessThan(1);
        }
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [19], lines: 4 }));
        run(world, camera, HUSH_HOLD + 0.2, 1 / 30);
        const great = world.births.find((b) => b.kind === KIND_GREAT);
        expect(great).toBeDefined();
        // the head of the tallest pillar that shows: above the cards on this screen
        expect(world.hidden(great.x, great.y)).toBe(false);
        expect(Math.abs(great.x)).toBeLessThan(world.aspect);
    });
});

describe('Nebula Flow world: a lock', () => {
    it('sends a spark from the card\'s edge into a pillar, where a star in the piece\'s colour and shape kindles', () => {
        const { world, camera } = makeWorld('High');
        let t = 0;
        frame(world, camera, 1 / 60, () => {
            t = world.time;
            lock(world, { u: 0.2, rows: [12, 11] });
        });
        expect(world.getState().counts.locks).toBe(1);
        expect(lit(world)).toHaveLength(1);
        const b = lit(world)[0];
        expect(b.kind).toBe(KIND_LOCK);
        expect(b.rgb).toEqual(pieceColor(COLORS.T));
        expect(b.cells).toEqual(T_CELLS);
        expect(b.released).toBe(-1);
        // it leaves the card's left edge at the piece's height, and lights when its flight is over
        const [left, right] = edgesOf(world.layout.cards[0], world.aspect);
        expect(b.from[0]).toBeCloseTo(left, 9);
        expect(b.from[1]).toBeCloseTo(rowY(world, 0.2, 11.5), 9);
        expect(b.flight).toBe(FLIGHT);
        expect(b.born).toBeCloseTo(t + FLIGHT, 9);
        expect(b.x).toBeLessThan(left);
        expect(dustDistance(world.pillars, b.x, b.y)).toBeLessThan(0);
        expect(world.hidden(b.x, b.y)).toBe(false);
        // the shader is handed the same birth
        const i = world.births.indexOf(b);
        const rows = world.u.tables.births;
        expect(rows[i * BIRTH_ROWS].toArray()).toEqual([b.x, b.y, b.born, b.power]);
        expect(rows[i * BIRTH_ROWS + 1].toArray()).toEqual([...b.rgb, KIND_LOCK]);
        expect(rows[i * BIRTH_ROWS + 3].toArray()).toEqual(T_CELLS.slice(0, 4));
        expect(rows[i * BIRTH_ROWS + 5].toArray()).toEqual([b.from[0], b.from[1], FLIGHT, b.bow]);
        // a ripple of its colour runs out through the dust as it lights
        const ripple = world.fronts.find((f) => f.strength > 0 && f.x === b.x && f.y === b.y);
        expect(ripple.born).toBe(b.born);
        expect(ripple.rgb).toEqual(b.rgb);
        // held: not counted until it lights, then held until a clear
        expect(world.getState().held).toBe(0);
        run(world, camera, FLIGHT + 0.1, 1 / 60);
        expect(world.getState().held).toBe(1);
        expect(world.getState().free).toBe(0);
        // a piece in a right-hand column leaves the card's right edge for a right-hand pillar
        frame(world, camera, 1 / 60, () => lock(world, { u: 0.8, rows: [4], color: COLORS.L }));
        const r = newest(world);
        expect(r.from[0]).toBeCloseTo(right, 9);
        expect(r.from[1]).toBeCloseTo(rowY(world, 0.8, 4), 9);
        expect(r.x).toBeGreaterThan(right);
        expect(r.rgb).toEqual(pieceColor(COLORS.L));
    });

    it('kindles a piece from a higher row higher in its pillar', () => {
        const high = makeWorld('Low');
        frame(high.world, high.camera, 1 / 60, () => lock(high.world, { rows: [2] }));
        const low = makeWorld('Low');
        frame(low.world, low.camera, 1 / 60, () => lock(low.world, { rows: [18] }));
        expect(newest(high.world).y).toBeGreaterThan(newest(low.world).y);
    });

    it('sends a hard drop\'s spark quicker, to a bigger star, with a kick when it lands', () => {
        const hard = makeWorld('High');
        let t = 0;
        frame(hard.world, hard.camera, 1 / 60, () => {
            t = hard.world.time;
            lock(hard.world, { hardDrop: true });
        });
        const soft = makeWorld('High');
        frame(soft.world, soft.camera, 1 / 60, () => lock(soft.world));
        const h = lit(hard.world)[0];
        const s = lit(soft.world)[0];
        expect(h.kind).toBe(KIND_DROP);
        expect(h.flight).toBe(FLIGHT_DROP);
        expect(h.born).toBeCloseTo(t + FLIGHT_DROP, 9);
        expect(h.born - t).toBeLessThan(s.flight);
        expect(h.power).toBeGreaterThan(s.power);
        expect(h.size).toBeGreaterThan(s.size);
        const ripple = (w, b) => w.fronts.find((f) => f.strength > 0 && f.x === b.x && f.y === b.y);
        expect(ripple(hard.world, h).strength).toBeGreaterThan(ripple(soft.world, s).strength);
        // the kick lands with the star, not with the lock
        expect(hard.world.kick).toBe(0);
        run(hard.world, hard.camera, FLIGHT_DROP + 0.02, 1 / 60);
        run(soft.world, soft.camera, FLIGHT_DROP + 0.02, 1 / 60);
        expect(hard.world.kick).toBeGreaterThan(soft.world.kick);
    });

    it('reuses the oldest slot when every slot burns', () => {
        const { world, camera } = makeWorld('Minimal');
        const borns = [];
        for (let i = 0; i < BIRTH_SLOTS + 6; i += 1) {
            frame(world, camera, 0.1, () => {
                lock(world, { u: ((i * 0.37) % 1) * 0.9 + 0.05, color: COLORS[Object.keys(SHAPES)[i % 7]] });
                borns.push(world.time + FLIGHT);
            });
            expect(lit(world).length + ambient(world).length).toBeLessThanOrEqual(BIRTH_SLOTS);
        }
        expect(world.getState().counts.locks).toBe(BIRTH_SLOTS + 6);
        // the ring holds exactly the newest BIRTH_SLOTS stars
        const held = world.births.map((b) => b.born).sort((a, b) => a - b);
        const expected = borns.slice(-BIRTH_SLOTS);
        expect(held).toHaveLength(expected.length);
        held.forEach((born, i) => expect(born).toBeCloseTo(expected[i], 9));
    });

    it('keeps its ambient stars while a slot is free', () => {
        const { world, camera } = makeWorld('High');
        const resting = ambient(world).length;
        expect(resting).toBe(QUALITY.High.ambient);
        // fill every free slot, free those stars with a clear and let them burn out
        for (let i = 0; i < BIRTH_SLOTS - resting; i += 1) {
            frame(world, camera, 0.05, () => lock(world, { u: ((i * 0.37) % 1) * 0.9 + 0.05 }));
        }
        expect(ambient(world)).toHaveLength(resting);
        run(world, camera, FLIGHT + 0.1, 1 / 30);
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [19], lines: 1 }));
        run(world, camera, RELEASE_FADE + 8, 0.5);
        const spent = lit(world).filter((b) => birthDone(b, world.time));
        expect(spent).toHaveLength(BIRTH_SLOTS - resting);
        // a slot is free: the next lock takes it, and the ambient stars burn on
        frame(world, camera, 1 / 30, () => lock(world));
        expect(ambient(world)).toHaveLength(resting);
    });

    it('gives the ambient stars\' slots back to them once the stars that took them are done', () => {
        const { world, camera } = makeWorld('Minimal');
        const resting = ambient(world).length;
        for (let i = 0; i < BIRTH_SLOTS; i += 1) {
            frame(world, camera, 0.05, () => lock(world, { u: ((i * 0.37) % 1) * 0.9 + 0.05 }));
        }
        // a full ring took them
        expect(ambient(world).length).toBeLessThan(resting);
        run(world, camera, FLIGHT + 0.1, 1 / 30);
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [19], lines: 1 }));
        run(world, camera, RELEASE_FADE + 8, 0.5);
        world.resetSession();
        expect(ambient(world)).toHaveLength(resting);
    });

    it('never moves a young star while another\'s slot is borrowed', () => {
        const { world, camera } = makeWorld('High');
        const places = () => world.births.map((b) => (b.kind === KIND_AMBIENT ? [b.x, b.y, b.angle] : null));
        const before = places();
        // a lock's star still burning in the first young star's slot (the last slot)
        Object.assign(world.births[BIRTH_SLOTS - 1], {
            kind: KIND_LOCK, power: 1, born: world.time, released: -1,
        });
        expect(ambient(world)).toHaveLength(QUALITY.High.ambient - 1);
        frame(world, camera, 0.05);
        // a new stage places the young stars again: the ones still there stay put
        world.setViewport(1280, 720, 1280 / 720);
        world.compose();
        world.placeAmbient();
        places().forEach((place, i) => {
            if (place) expect(place).toEqual(before[i]);
        });
    });

    it('never takes a spark still in flight, and keeps the stars burning steady over one fading out', () => {
        const { world, camera } = makeWorld('Minimal');
        // fading: freed a while ago
        for (let i = 0; i < 8; i += 1) frame(world, camera, 0.05, () => lock(world, { u: ((i * 0.37) % 1) * 0.9 + 0.05 }));
        run(world, camera, FLIGHT + 0.1, 1 / 30);
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [19], lines: 1 }));
        run(world, camera, RELEASE_FADE * 0.75, 0.25);
        const fading = new Set(lit(world));
        // fill the rest of the ring with stars held in the dust, the last still in flight
        while (lit(world).length + ambient(world).length < BIRTH_SLOTS) frame(world, camera, 0.05, () => lock(world));
        run(world, camera, 1, 1 / 30);
        frame(world, camera, 1 / 60, () => lock(world, { u: 0.8 }));
        const inFlight = newest(world);
        expect(inFlight.born).toBeGreaterThan(world.time);
        for (let i = 0; i < 4; i += 1) {
            const before = world.births.map((b) => ({ ...b }));
            frame(world, camera, 1 / 60, () => lock(world, { u: 0.3 }));
            const taken = world.births.findIndex((b, k) => b.born !== before[k].born);
            const was = before[taken];
            // never the spark in flight, never a held star while a freed one fades
            expect(was.born).toBeLessThanOrEqual(world.time);
            expect(was.kind === KIND_AMBIENT || fading.has(world.births[taken]) || was.released >= 0).toBe(true);
        }
        expect(world.births).toContain(inFlight);
    });
});

describe('Nebula Flow world: a clear', () => {
    it('leaves a star that burned out in the dust out', () => {
        const { world, camera } = makeWorld('Minimal');
        lock(world);
        const star = newest(world);
        run(world, camera, FLIGHT + BIRTH_LIFE + BIRTH_FADE + 2, 0.5);
        expect(birthDone(star, world.time)).toBe(true);
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [19], lines: 1 }));
        expect(star.released).toBeLessThan(0);
        run(world, camera, 4, 0.25);
        expect(birthLight(world.time - star.born, star.released, star.kind)).toBeLessThan(1e-6);
        expect(world.getState().held + world.getState().free).toBe(0);
    });

    it('leaves out a star that burns out while the clear\'s front is still on its way to it', () => {
        const { world, camera } = makeWorld('Minimal');
        lock(world);
        const star = newest(world);
        const reach = Math.hypot(star.x - world.cluster.x, star.y - world.cluster.y) / FRONT_SPEED;
        // the clear comes just before it burns out, the front just after
        run(world, camera, star.born - world.time + BIRTH_LIFE + BIRTH_FADE - reach / 2, 0.5);
        expect(birthDone(star, world.time)).toBe(false);
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [19], lines: 1 }));
        expect(star.released).toBeLessThan(0);
        run(world, camera, reach + 2, 0.25);
        expect(birthLight(world.time - star.born, star.released, star.kind)).toBeLessThan(1e-6);
    });

    it('keeps every front of a four-line clear when the ring is full', () => {
        const { world, camera } = makeWorld('High');
        // fill the ring: clears and the ripples of locks
        for (let i = 0; i < 4; i += 1) frame(world, camera, 0.3, () => world.onClear({ rows: [18, 19], lines: 2 }));
        for (let i = 0; i < FRONT_SLOTS - 8; i += 1) frame(world, camera, 0.1, () => lock(world, { u: i % 2 ? 0.8 : 0.2 }));
        const t = world.time + 1 / 30;
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [16, 17, 18, 19], lines: 4 }));
        const shell = clusterFronts(world, t);
        expect(shell).toHaveLength(4);
        // each one runs its whole life
        run(world, camera, 1.5, 1 / 30);
        expect(clusterFronts(world, t)).toHaveLength(4);
    });

    it('never cuts a clear\'s fronts short for the ripples of the locks that follow', () => {
        const { world, camera } = makeWorld('High');
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [18, 19], lines: 2 }));
        const shells = clusterFronts(world, world.time).map((f) => ({ born: f.born, life: f.life }));
        expect(shells).toHaveLength(2);
        // quick play through the fronts' whole life: a lock every 0.3 s, each with its ripple
        const steps = Math.ceil(FRONT_LIFE / 0.3);
        for (let i = 0; i < steps; i += 1) {
            const u = i % 2 ? 0.8 : 0.2;
            frame(world, camera, 0.3, () => lock(world, { u, rows: [10] }));
            shells.forEach((s) => {
                if (world.time - s.born < s.life) expect(world.fronts.some((f) => f.born === s.born)).toBe(true);
            });
        }
        expect(world.getState().counts.locks).toBeGreaterThan(8);
    });

    it('frees every star held in the dust, as the front from the cluster reaches it, never before the clear', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        [0.15, 0.85, 0.3].forEach((u, i) => {
            frame(world, camera, 0.1, () => lock(world, { u, rows: [6 + i * 4] }));
        });
        run(world, camera, FLIGHT + 0.1, 1 / 30);
        let t = 0;
        let inFlight = null;
        frame(world, camera, 1 / 60, () => {
            t = world.time;
            lock(world, { u: 0.6 }); // its spark is still on its way when the rows go
            inFlight = newest(world);
            world.onClear({ rows: [19, 18], lines: 2 });
        });
        const held = lit(world).filter((b) => b !== inFlight);
        expect(held).toHaveLength(3);
        held.forEach((b) => {
            expect(b.released).toBeGreaterThanOrEqual(0);
            expect(b.born + b.released).toBeGreaterThanOrEqual(t);
        });
        // nearer the cluster, freed sooner
        const dist = (b) => Math.hypot(b.x - world.cluster.x, b.y - world.cluster.y);
        const byDistance = [...held].sort((a, b) => dist(a) - dist(b));
        for (let i = 1; i < byDistance.length; i += 1) {
            expect(byDistance[i].born + byDistance[i].released)
                .toBeGreaterThanOrEqual(byDistance[i - 1].born + byDistance[i - 1].released);
        }
        // the spark still in flight and the ambient stars are kept for later
        expect(inFlight.released).toBe(-1);
        ambient(world).forEach((b) => expect(b.released).toBe(-1));
        expect(world.getState().counts.releases).toBe(3);
        // once the front has passed they burn free; the late one is held for the next clear
        run(world, camera, 4, 1 / 30);
        expect(world.getState().free).toBe(3);
        expect(world.getState().held).toBe(1);
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [19], lines: 1 }));
        expect(inFlight.released).toBeGreaterThanOrEqual(0);
        expect(world.getState().counts.releases).toBe(4);
    });

    [1, 2, 3].forEach((lines) => {
        it(`sends ${lines} front(s) from the cluster and a blade out of the card per cleared row`, () => {
            const { world, camera } = makeWorld('High', { at: 20 });
            const rows = [19, 18, 17].slice(0, lines);
            let t = 0;
            frame(world, camera, 1 / 60, () => {
                t = world.time;
                world.onClear({ rows, lines });
            });
            expect(clusterFronts(world, t)).toHaveLength(lines);
            // the shader is handed the ones in flight (born this frame, they light up on the next)
            run(world, camera, 0.45, 1 / 60);
            expect(world.getState().fronts).toBe(lines);
            expect(world.u.frontCount.value).toBe(lines);
            const [left, right] = edgesOf(world.layout.cards[0], world.aspect);
            const blades = world.parts.blades.table.filter((row, i) => i % 2 === 1 && row.w > 0);
            expect(blades).toHaveLength(lines);
            rows.forEach((row, i) => {
                const [y, start, l, r] = world.parts.blades.table[i * 2].toArray();
                expect(y).toBeCloseTo(rowY(world, 0.5, row), 9);
                expect(start).toBeGreaterThanOrEqual(t);
                expect(l).toBeCloseTo(left, 9);
                expect(r).toBeCloseTo(right, 9);
            });
            expect(world.flash).toBeGreaterThan(0);
            expect(world.getState().counts.clears).toBe(1);
            expect(world.getState().counts.quads).toBe(0);
        });
    });

    it('holds its breath on four lines, then kindles a great star in the tallest pillar\'s head', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        lock(world);
        run(world, camera, FLIGHT + 0.1, 1 / 60);
        run(world, camera, 2, 1 / 30); // let the lock's flash settle
        const before = world.flash;
        let t = 0;
        frame(world, camera, 1 / 60, () => {
            t = world.time;
            world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        });
        expect(clusterFronts(world, t)).toHaveLength(4);
        // the flash is held for the great star; the nursery sinks
        expect(world.flash).toBeLessThanOrEqual(before);
        expect(world.queue.some((e) => e.kind === 'great' && Math.abs(e.time - (t + HUSH_HOLD)) < 1e-9)).toBe(true);
        run(world, camera, HUSH_HOLD * 0.5, 1 / 60);
        expect(world.u.hush.value).toBeGreaterThan(0.5);
        expect(world.births.some((b) => b.kind === KIND_GREAT)).toBe(false);
        run(world, camera, HUSH_HOLD * 0.5 + 0.1, 1 / 60);
        const great = world.births.find((b) => b.kind === KIND_GREAT);
        expect(great).toBeTruthy();
        expect(great.born).toBeCloseTo(t + HUSH_HOLD, 9);
        // in the head of the tallest pillar
        const tall = tallest(world.pillars);
        expect(pillarDistance(tall, great.x, great.y)).toBeLessThan(0);
        expect(great.y).toBeGreaterThan((tall.y0 + tall.top) / 2);
        world.pillars.filter((p) => p !== tall).forEach((p) => expect(great.y, p.name).toBeGreaterThan(p.top - 0.5));
        // a flash, a quick wide front from the star, and a hole blown in the dust round it
        expect(world.flash).toBeGreaterThan(0.3);
        const blast = world.fronts.find((f) => f.strength > 0 && f.x === great.x && f.y === great.y);
        expect(blast.speed).toBe(GREAT_FRONT_SPEED);
        expect(world.hole.x).toBe(great.x);
        expect(world.hole.y).toBe(great.y);
        expect(world.hole.radius).toBeGreaterThan(0);
        run(world, camera, 1, 1 / 30);
        expect(world.u.hole.value.z).toBeGreaterThan(0);
        expect(world.u.hush.value).toBe(0);
        expect(world.getState().counts.quads).toBe(1);
        // the lock's star was freed by it all
        expect(lit(world).find((b) => b.kind === KIND_LOCK).released).toBeGreaterThanOrEqual(0);
    });

    it('kindles a greater star for a perfect clear', () => {
        const four = makeWorld('Low', { at: 20 });
        frame(four.world, four.camera, 1 / 60, () => four.world.onClear({ rows: [19, 18, 17, 16], lines: 4 }));
        run(four.world, four.camera, HUSH_HOLD + 0.1, 1 / 60);
        const perfect = makeWorld('Low', { at: 20 });
        frame(perfect.world, perfect.camera, 1 / 60, () => perfect.world.onClear({ rows: [19, 18], lines: 2, perfect: true }));
        run(perfect.world, perfect.camera, HUSH_HOLD + 0.1, 1 / 60);
        const a = four.world.births.find((b) => b.kind === KIND_GREAT);
        const b = perfect.world.births.find((x) => x.kind === KIND_GREAT);
        expect(b.power).toBeGreaterThan(a.power);
        expect(perfect.world.getState().counts.quads).toBe(1);
    });

    it('twists the flow on a T-spin and lets it spring back; a plain clear leaves it be', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18], lines: 2, tspin: true }));
        let peak = 0;
        for (let i = 0; i < 20; i += 1) {
            frame(world, camera, 1 / 60);
            peak = Math.max(peak, Math.abs(world.twist));
        }
        expect(peak).toBeGreaterThan(0.05);
        expect(world.u.twist.value).toBeCloseTo(world.twist, 9);
        run(world, camera, 5, 1 / 60);
        expect(Math.abs(world.twist)).toBeLessThan(0.005);
        expect(Math.abs(world.twistVelocity)).toBeLessThan(0.05);
        const plain = makeWorld('Low', { at: 20 });
        frame(plain.world, plain.camera, 1 / 60, () => plain.world.onClear({ rows: [19, 18], lines: 2 }));
        run(plain.world, plain.camera, 0.3, 1 / 60);
        expect(plain.world.twist).toBe(0);
    });
});

describe('Nebula Flow world: the chain, the levels and the clock', () => {
    it('winds the vortex up a step at a time in the colour of the piece that made it, and lets go when the chain breaks', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        frame(world, camera, 1 / 60, () => lock(world, { color: COLORS.S }));
        world.onCombo(1);
        run(world, camera, 1, 1 / 30);
        expect(world.vortex).toBe(0);
        const flowAt = () => {
            const before = world.flow;
            run(world, camera, 1, 1 / 30);
            return world.flow - before;
        };
        const restFlow = flowAt();
        let last = 0;
        for (let n = 2; n <= 6; n += 1) {
            world.onCombo(n);
            run(world, camera, 1.2, 1 / 30);
            expect(world.vortex, `chain ${n}`).toBeGreaterThan(last);
            expect(world.vortex, `chain ${n}`).toBeLessThanOrEqual(vortexForCombo(n) + 1e-9);
            expect(world.getState().vortex).toBe(world.vortex);
            last = world.vortex;
        }
        expect(world.vortexTint).toEqual(pieceColor(COLORS.S));
        expect(world.u.vortex.value.z).toBeCloseTo(world.vortex, 9);
        expect(world.u.vortexTint.value.toArray()).toEqual(pieceColor(COLORS.S));
        expect(world.getState().combo).toBe(6);
        // the gas runs faster through a chain
        expect(flowAt()).toBeGreaterThan(restFlow * 1.2);
        world.onCombo(0);
        run(world, camera, 6, 1 / 30);
        expect(world.vortex).toBeLessThan(last * 0.3);
    });

    it('snaps the palette on a silent level, and moves it a step along on a new one with a front in its colours', () => {
        const { world, camera } = makeWorld('High', { at: 1 });
        expect(world.getState().palette).toBe(NEBULA_PALETTES[PALETTE_HOME].name);
        const frontsAt = () => world.frontCursor;
        // a silent level (a run's start) is where the sky stands at once, with no fanfare
        world.levelUp(3, { silent: true });
        expect(world.levelPlace).toBe(2);
        expect(frontsAt()).toBe(0);
        const snapped = paletteAt(palettePlace(2, world.time), {});
        expect(world.u.cavityNear.value.toArray()).toEqual(snapped.cavityNear);
        expect(world.getState().palette).toBe(paletteName(palettePlace(2, world.time)));
        // a new level: a front in the coming palette leaves the cluster and the sky eases there
        let t = 0;
        frame(world, camera, 1 / 60, () => {
            t = world.time;
            world.levelUp(4);
        });
        const fronts = clusterFronts(world, t);
        expect(fronts).toHaveLength(1);
        expect(fronts[0].rgb).toEqual(paletteAt(palettePlace(3, t), {}).cavityNear);
        expect(world.flash).toBeGreaterThan(0);
        expect(world.levelPlace).toBeGreaterThan(2);
        expect(world.levelPlace).toBeLessThan(3);
        run(world, camera, 8, 1 / 20);
        expect(world.levelPlace).toBeCloseTo(3, 2);
        expect(world.getState().level).toBe(4);
        // the same level again changes nothing
        const cursor = frontsAt();
        world.levelUp(4);
        expect(frontsAt()).toBe(cursor);
    });

    it('keeps the palette\'s place for a new run, and walks a jump of levels rather than strobing', () => {
        const { world, camera } = makeWorld('High', { at: 30 });
        world.levelUp(4);
        run(world, camera, 8, 1 / 30);
        const reached = world.levelPlace;
        expect(reached).toBeGreaterThan(2.9);
        world.resetSession();
        expect(world.level).toBe(1);
        run(world, camera, 3, 1 / 30);
        // the new run's level 1 is where the last run left the palette
        expect(world.levelPlace).toBeCloseTo(reached, 6);
        // and a world rebuilt for it (a quality change) comes back there, told the base
        const rebuilt = makeWorld('Low', { at: world.time }).world;
        rebuilt.levelUp(1, { silent: true, base: world.levelBase });
        expect(rebuilt.levelPlace).toBeCloseTo(reached, 6);
        world.levelUp(6);
        const from = world.levelPlace;
        run(world, camera, 1, 1 / 60);
        expect(world.levelPlace - from).toBeGreaterThan(0.2);
        expect(world.levelPlace - from).toBeLessThanOrEqual(1);
    });

    it('drifts the palette with the clock alone', () => {
        const idle = makeWorld('Low', { at: 1 }).world;
        const later = makeWorld('Low', { at: 1 + PALETTE_STEP }).world;
        expect(later.getState().level).toBe(1);
        expect(later.getState().palette).not.toBe(idle.getState().palette);
        expect(later.u.cavityNear.value.equals(idle.u.cavityNear.value)).toBe(false);
        // and within a single run, frame by frame
        const { world, camera } = makeWorld('Low', { at: 1 });
        const start = world.u.cavityNear.value.clone();
        run(world, camera, PALETTE_STEP * 0.5, 0.5);
        expect(world.u.cavityNear.value.equals(start)).toBe(false);
        expect(world.levelPlace).toBe(0);
    });
});

describe('Nebula Flow world: a session', () => {
    /** The same play on any world. */
    const play = (world, camera) => {
        frame(world, camera, 1 / 60, () => lock(world, { u: 0.3, rows: [9] }));
        run(world, camera, 0.5, 1 / 30);
        frame(world, camera, 1 / 60, () => lock(world, {
            u: 0.7, rows: [15], hardDrop: true, color: COLORS.Z,
        }));
        run(world, camera, 0.8, 1 / 30);
        frame(world, camera, 1 / 60, () => {
            world.onClear({ rows: [19, 18], lines: 2 });
            world.onCombo(2);
        });
        run(world, camera, 1.5, 1 / 30);
    };
    const snapshot = (world) => ({
        births: tableOf(world.u.tables.births),
        fronts: tableOf(world.u.tables.fronts).slice(0, world.u.frontCount.value * FRONT_ROWS),
        blades: tableOf(world.parts.blades.table),
        state: world.getState(),
        flow: world.flow,
        vortex: world.vortex,
    });

    it('replays any moment exactly: a seek drops everything in flight', () => {
        const a = makeWorld('Medium', { at: 30 });
        const b = makeWorld('Medium', { at: 30 });
        play(a.world, a.camera);
        play(b.world, b.camera);
        const first = snapshot(a.world);
        expect(snapshot(b.world)).toEqual(first);
        // a world that has played on, seeked back, plays the same again
        frame(a.world, a.camera, 1 / 60, () => a.world.onClear({ rows: [19, 18, 17, 16], lines: 4 }));
        run(a.world, a.camera, 0.1, 1 / 30);
        a.world.seek(30);
        expect(a.world.queue).toHaveLength(0);
        const sim = {
            time: 30, delta: 0, pointerX: 0, pointerY: 0,
        };
        a.world.updateCamera(a.camera, sim);
        a.world.update(sim, a.camera);
        play(a.world, a.camera);
        expect(snapshot(a.world)).toEqual(first);
    });

    it('starts a new run at rest, keeping the clock, the gas\'s flow and the stars already kindled', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        lock(world);
        frame(world, camera, 1 / 60, () => lock(world, { u: 0.8, rows: [5] }));
        world.levelUp(3);
        world.onCombo(5);
        run(world, camera, 1.5, 1 / 30);
        const kindled = lit(world).map((b) => ({ ...b, cells: [...b.cells], rgb: [...b.rgb] }));
        const {
            time, flow, levelPlace,
        } = world;
        const { held } = world.getState();
        expect(held).toBe(2);
        world.resetSession();
        expect(world.time).toBe(time);
        expect(world.flow).toBe(flow);
        expect(world.levelPlace).toBe(levelPlace);
        expect(world.combo).toBe(0);
        expect(world.level).toBe(1);
        expect(world.vortex).toBe(0);
        expect(world.queue).toHaveLength(0);
        expect(world.getState().counts).toEqual({
            locks: 0, clears: 0, quads: 0, releases: 0,
        });
        expect(lit(world).map((b) => ({ ...b }))).toEqual(kindled);
        expect(world.getState().held).toBe(held);
        // and the next clear frees them
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19], lines: 1 }));
        lit(world).forEach((b) => expect(b.released).toBeGreaterThanOrEqual(0));
    });

    it('runs the gas, the vortex and the twist at half pace for reduced motion', () => {
        const calm = makeWorld('Low', { reduce: true });
        const full = makeWorld('Low');
        expect(calm.world.flow).toBeCloseTo(full.world.flow * 0.5, 9);
        expect(full.world.flow).toBeCloseTo(10 * FLOW_REST, 9);
        [calm, full].forEach(({ world }) => world.onCombo(4));
        const flowFrom = [calm.world.flow, full.world.flow];
        run(calm.world, calm.camera, 3, 1 / 30);
        run(full.world, full.camera, 3, 1 / 30);
        expect(calm.world.flow - flowFrom[0]).toBeLessThan((full.world.flow - flowFrom[1]) * 0.75);
        // the chain winds the same, but the picture turns less
        expect(calm.world.vortex).toBeCloseTo(full.world.vortex, 9);
        expect(calm.world.u.vortex.value.z).toBeLessThan(full.world.u.vortex.value.z);
        [calm, full].forEach(({ world, camera }) => {
            frame(world, camera, 1 / 60, () => world.onClear({ rows: [19], lines: 1, tspin: true }));
            run(world, camera, 0.15, 1 / 60);
        });
        expect(Math.abs(calm.world.u.twist.value)).toBeLessThan(Math.abs(full.world.u.twist.value));
    });

    it('hands the post one reused object: the cluster\'s place, a flash on a clear, an iris that closes for it', () => {
        const { world, camera } = makeWorld('High', { at: 20 });
        const post = world.getPostState();
        frame(world, camera, 1 / 60);
        expect(world.getPostState()).toBe(post);
        expect(post.exposure).toBeGreaterThan(0);
        expect(post.exposure).toBeLessThanOrEqual(1);
        const rest = {
            exposure: post.exposure, bloom: post.bloomBoost, rays: post.rays,
        };
        frame(world, camera, 1 / 60, () => world.onClear({ rows: [19, 18], lines: 2 }));
        expect(world.getPostState()).toBe(post);
        expect(post.flash).toBeGreaterThan(0);
        expect(post.flashTint).toHaveLength(3);
        expect(post.exposure).toBeLessThan(rest.exposure);
        expect(post.bloomBoost).toBeGreaterThan(rest.bloom);
        expect(post.rays).toBeGreaterThan(rest.rays);
        expect(world.u.iris.value).toBeGreaterThan(1);
        // and it settles back
        run(world, camera, 12, 1 / 10);
        expect(post.flash).toBeLessThan(0.01);
        expect(post.exposure).toBeGreaterThan(0.95);
    });

    it('hands the nursery only the lit stars\' lanterns and holes, and darkens every part of a star that is done', () => {
        const { world, camera } = makeWorld('Minimal');
        const lamps = () => world.u.lanternCount.value;
        const resting = ambient(world).length;
        expect(lamps()).toBe(resting);
        lock(world);
        lock(world, { u: 0.8, rows: [4] });
        // in flight: no lantern yet
        frame(world, camera, 1 / 60);
        expect(lamps()).toBe(resting);
        run(world, camera, FLIGHT + 0.2, 1 / 30);
        expect(lamps()).toBe(resting + 2);
        const star = newest(world);
        const slot = world.births.indexOf(star);
        const row = world.u.tables.lanterns.slice(0, lamps() * LANTERN_ROWS)
            .find((r, k) => k % LANTERN_ROWS === 0 && r.x === star.x && r.y === star.y);
        expect(row).toBeDefined();
        expect(row.z).toBeCloseTo(star.power * birthLight(world.time - star.born, star.released, star.kind), 9);
        expect(row.w).toBe(0); // held: no hole
        // freed: a hole opens, then the star fades, the dust heals and the slot goes dark
        frame(world, camera, 1 / 30, () => world.onClear({ rows: [19], lines: 1 }));
        run(world, camera, 4, 1 / 30);
        const freed = world.u.tables.lanterns.slice(0, lamps() * LANTERN_ROWS)
            .find((r, k) => k % LANTERN_ROWS === 0 && r.x === star.x && r.y === star.y);
        expect(freed.w).toBeGreaterThan(0.004);
        run(world, camera, RELEASE_FADE + 2, 0.5);
        expect(birthDone(star, world.time)).toBe(true);
        expect(lamps()).toBe(resting);
        expect(world.u.tables.births[slot * BIRTH_ROWS].w).toBe(0);
        expect(star.power).toBeGreaterThan(0); // the slot itself is free for the next lock
    });

    it('aims the cluster\'s shafts through the frame the icon zooms to', () => {
        const { world } = makeWorld('High');
        const sun = { ...world.getPostState().sun };
        world.zoomTo(-0.4, 0.36, 0.55);
        const zoomed = world.getPostState().sun;
        // the cluster sits further up and further right of a frame centred left of the screen's
        expect(zoomed.y).toBeLessThan(sun.y);
        expect(zoomed.x).toBeGreaterThan(sun.x);
        world.zoomTo();
        expect(world.getPostState().sun).toEqual(sun);
    });

    it('reports its state for the playground and the tests', () => {
        const { world } = makeWorld('High', { at: 1 });
        const state = world.getState();
        expect(Object.keys(state)).toEqual(expect.arrayContaining([
            'aspect', 'combo', 'counts', 'free', 'fronts', 'held', 'level', 'palette', 'pillars', 'time', 'twist', 'vortex',
        ]));
        expect(state).toMatchObject({
            time: 1, combo: 0, level: 1, vortex: 0, twist: 0, held: 0, free: 0, fronts: 0,
        });
        expect(state.aspect).toBeCloseTo(16 / 9, 9);
        expect(state.palette).toBe(NEBULA_PALETTES[PALETTE_HOME].name);
        expect(state.counts).toEqual({
            locks: 0, clears: 0, quads: 0, releases: 0,
        });
        // a copy: changing it changes nothing
        state.counts.locks = 9;
        expect(world.getState().counts.locks).toBe(0);
    });
});
