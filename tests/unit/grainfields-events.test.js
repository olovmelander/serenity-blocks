/**
 * Grainfields — what the events throw into the air and send through the stand (2026-11-14 pass):
 * a lock's petals and puff, a hard drop's burst, a clear's lane from the eye's feet with its chaff,
 * a twist's dust devil and the flakes wound up round it, four lines' shafts through the gate and
 * the gust that crosses the barley to the eye, a perfect clear's rising dust, a level-up's
 * time-lapse deck. The reactions run three-free; the world without a renderer and without its
 * authored assets (no trees, herd or geese: none of this needs them). Held as relations.
 */
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    GRAINFIELDS_PARTS, GrainfieldsWorld, LAPSE, REST_RIG, fovForAspect,
} from '../../src/themes/grainfields/grainfields-world.js';
import {
    DEG, EYE, PIECE_COLORS, PLACES, hexToLinear, rigFor,
} from '../../src/themes/grainfields/grainfields-core.js';
import {
    DEVIL_SHAPE, FRONT, GUST, GUST_ARRIVES, GUST_LIFE, GrainfieldsReactions, LANE_START, MAX_DEVILS, PULSE, RAYS,
} from '../../src/themes/grainfields/grainfields-reactions.js';
import { CHAFF_KIND, DEVIL_WALK, createChaff } from '../../src/themes/grainfields/grainfields-chaff.js';
import { DEVIL, DEVILS } from '../../src/themes/grainfields/grainfields-devil.js';
import { GATE_RAYS } from '../../src/themes/grainfields/grainfields-gate-rays.js';
import { createUniforms } from '../../src/themes/grainfields/grainfields-tsl.js';
import { fallbackLayout } from '../../src/themes/grainfields/grainfields-composition.js';
import { groundHeight } from '../../src/themes/grainfields/grainfields-plan.js';

vi.setConfig({ testTimeout: 60_000 });

const ASPECT = 16 / 9;
const LAYOUT = { ...fallbackLayout(1600, 900), hud: null };

/** The world's camera-less aim: the ground point `distance` metres out along a screen column. */
function makeAim() {
    const rig = rigFor(ASPECT);
    const tanH = Math.tan(rig.fov * DEG * 0.5) * ASPECT;
    return (x, y, distance) => {
        const bearing = rig.yaw * DEG + Math.atan((x * 2 - 1) * tanH);
        const gx = EYE.x + Math.sin(bearing) * distance;
        const gz = EYE.z - Math.cos(bearing) * distance;
        return [gx, groundHeight(gx, gz), gz];
    };
}
const clearAt = (reactions, c, time = 10) => reactions.clear(c, time, { layout: LAYOUT, aim: makeAim() });

describe('Grainfields events: the reactions', () => {
    it('raises a dust devil where a twist\'s whirl turns; a spin a smaller one on its own side', () => {
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 2, twist: true });
        expect(reactions.devils).toHaveLength(1);
        const [devil] = reactions.devils;
        const whirl = reactions.pulses.find((p) => p.kind === PULSE.whirl);
        expect([devil.x, devil.z, devil.at]).toEqual([whirl.x, whirl.z, whirl.at]);
        expect(devil.height).toBeCloseTo(DEVIL_SHAPE.height, 6);
        expect(Math.abs(devil.spin)).toBe(DEVIL_SHAPE.spin);
        // It stands in the open field a few dozen metres out.
        expect(Math.hypot(devil.x - EYE.x, devil.z - EYE.z)).toBeCloseTo(DEVIL_SHAPE.distance, 3);

        const left = reactions.spin({ u: 0.1 }, 12, { layout: LAYOUT, aim: makeAim() });
        expect(left.kind).toBe(PULSE.whirl);
        const small = reactions.devils[1];
        expect(small.power).toBeLessThan(devil.power);
        expect(small.height).toBeLessThan(devil.height);
        expect(small.radius).toBeLessThan(devil.radius);
        expect(small.spin).toBeLessThan(0);
        expect(small.x).toBeLessThan(EYE.x);
        reactions.spin({ u: 0.9 }, 12.5, { layout: LAYOUT, aim: makeAim() });
        expect(reactions.devils[2].spin).toBeGreaterThan(0);
        expect(reactions.devils[2].x).toBeGreaterThan(EYE.x);
    });

    it('keeps at most three devils (the oldest gives up its place) and forgets one that has blown out', () => {
        const reactions = new GrainfieldsReactions();
        for (let k = 0; k < MAX_DEVILS + 2; k += 1) {
            reactions.spin({ u: 0.2 }, 10 + k, { layout: LAYOUT, aim: makeAim() });
        }
        expect(reactions.devils).toHaveLength(MAX_DEVILS);
        expect(reactions.devils.map((d) => d.at)).toEqual([12, 13, 14]);
        expect(MAX_DEVILS).toBe(DEVILS);
        expect(DEVIL_SHAPE.life).toBe(DEVIL.life);
        reactions.prune(12 + DEVIL_SHAPE.life + 0.01);
        expect(reactions.devils.map((d) => d.at)).toEqual([13, 14]);
        reactions.reset();
        expect(reactions.devils).toEqual([]);
    });

    it('bursts shafts through the gate on four lines: up at once, held, then gone', () => {
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 3 }, 10);
        expect(reactions.rays(10.5)).toBe(0);
        clearAt(reactions, { lines: 4 }, 20);
        expect(reactions.rays(20)).toBe(0);
        expect(reactions.rays(20 + RAYS.rise)).toBeCloseTo(1, 6);
        expect(reactions.rays(20 + RAYS.hold)).toBeCloseTo(1, 6);
        const fading = reactions.rays(20 + RAYS.hold + RAYS.fade / 2);
        expect(fading).toBeGreaterThan(0);
        expect(fading).toBeLessThan(1);
        expect(reactions.rays(20 + RAYS.hold + RAYS.fade + 0.01)).toBe(0);
        // Never a step: a twentieth of a second moves it by a small share.
        let last = 0;
        for (let t = 20; t < 20 + RAYS.hold + RAYS.fade; t += 0.05) {
            const now = reactions.rays(t);
            expect(Math.abs(now - last), `at ${t.toFixed(2)}`).toBeLessThan(0.25);
            last = now;
        }
    });

    it('feeds shafts still standing instead of restarting them, and lights them dimmer for a back-to-back clear', () => {
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 4 }, 10);
        const before = reactions.rays(11.5);
        clearAt(reactions, { lines: 4 }, 11.5);
        expect(reactions.raysAt).toBe(10);
        expect(reactions.rays(11.5)).toBeGreaterThan(before);
        expect(reactions.rays(11.5)).toBeLessThanOrEqual(RAYS.gain);
        // ...and they now stand longer than the first burst alone would have.
        expect(reactions.rays(10 + RAYS.hold + RAYS.fade + 0.2)).toBeGreaterThan(0);
        for (let k = 0; k < 12; k += 1) clearAt(reactions, { lines: 4 }, 12 + k * 0.2);
        expect(reactions.raysGain).toBeLessThanOrEqual(RAYS.gain);

        const run = new GrainfieldsReactions();
        clearAt(run, { lines: 2, twist: true, b2b: true }, 10);
        expect(run.rays(10 + RAYS.rise)).toBeCloseTo(RAYS.b2b, 6);
        // New shafts burst out over what is left of the old: no drop to nothing at the new burst.
        const late = 10 + RAYS.hold + RAYS.fade * 0.5;
        const left = run.rays(late);
        clearAt(run, { lines: 4 }, late);
        expect(run.rays(late)).toBeCloseTo(left, 6);
        expect(run.rays(late + RAYS.rise)).toBeGreaterThan(left);
    });

    it('sends the gust in from the gate: its front runs from beyond the stand to behind the eye', () => {
        const reactions = new GrainfieldsReactions();
        expect(reactions.gust(5)).toEqual([0, GUST.from]);
        clearAt(reactions, { lines: 4 }, 10);
        const start = 10 + FRONT.delay;
        expect(reactions.gustAt).toBe(start);
        expect(reactions.gust(start - 0.01)[0]).toBe(0);
        // It sets out past the barley's far edge (150 m) and reaches the eye a few seconds on.
        expect(GUST.from).toBeGreaterThan(150);
        expect(GUST_ARRIVES).toBeGreaterThan(1.5);
        expect(GUST_ARRIVES).toBeLessThan(4);
        let last = Infinity;
        for (let age = 0.05; age < GUST_LIFE; age += 0.05) {
            const [strength, ahead] = reactions.gust(start + age);
            expect(ahead).toBeLessThan(last);
            last = ahead;
            expect(strength).toBeGreaterThanOrEqual(0);
            expect(strength).toBeLessThanOrEqual(GUST.gain);
        }
        const [atEye, ahead] = reactions.gust(start + GUST_ARRIVES);
        expect(ahead).toBeCloseTo(0, 6);
        expect(atEye).toBeCloseTo(1, 6);
        expect(reactions.gust(start + GUST_LIFE - 0.01)[1]).toBeLessThan(-GUST.past + 1);
        expect(reactions.gust(start + GUST_LIFE + 0.01)).toEqual([0, GUST.from]);
    });

    it('feeds a gust still on its way in, and sends a new one once it has struck', () => {
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 4 }, 10);
        const start = reactions.gustAt;
        clearAt(reactions, { lines: 4 }, 10.8);
        expect(reactions.gustAt).toBe(start);
        expect(reactions.gustGain).toBeGreaterThan(1);
        for (let k = 0; k < 8; k += 1) clearAt(reactions, { lines: 4 }, 10.9 + k * 0.05);
        expect(reactions.gustGain).toBeLessThanOrEqual(GUST.gain);
        const late = start + GUST_ARRIVES + 0.2;
        clearAt(reactions, { lines: 4 }, late);
        expect(reactions.gustAt).toBe(late + FRONT.delay);
        expect(reactions.gustGain).toBe(1);
    });

    it('writes the gust and hands back the shafts with the frame\'s other scalars', () => {
        const reactions = new GrainfieldsReactions();
        const u = createUniforms();
        u.gustFront.value.set(0.6, -0.8, GUST.from, 0);
        clearAt(reactions, { lines: 4 }, 10);
        const t = 10 + FRONT.delay + 1;
        const fx = reactions.writeUniforms(u, t);
        expect(fx.rays).toBe(reactions.rays(t));
        expect(fx.gust).toBe(reactions.gust(t)[0]);
        expect(fx.gust).toBeGreaterThan(0);
        // The way to the gate is the world's: the reactions write only the front and its strength.
        expect(u.gustFront.value.toArray()).toEqual([0.6, -0.8, reactions.gust(t)[1], fx.gust]);
    });

    it('starts a clear\'s lane at the eye\'s feet (the near stand fills the lower half of the frame)', () => {
        const reactions = new GrainfieldsReactions();
        clearAt(reactions, { lines: 1 });
        const [lane] = reactions.trails;
        expect(Math.hypot(lane.x - EYE.x, lane.z - EYE.z)).toBeCloseTo(LANE_START, 3);
        expect(LANE_START).toBeLessThan(5);
        // It still runs out away from the eye.
        expect(lane.hz).toBeLessThan(0);
    });
});

describe('Grainfields events: the chaff ring', () => {
    const u = createUniforms();
    const t = { noise: new THREE.DataTexture(new Uint8Array(4), 1, 1) };

    it('writes a record as the shader reads it; a puff carries its pigment on the seed\'s integer part', () => {
        const chaff = createChaff(u, t, 200);
        expect(chaff.ring).toBe(200);
        const {
            from, go, look, tint,
        } = chaff.records;
        chaff.fly({
            x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, life: 2.5, size: 0.07, rgb: [0.1, 0.2, 0.3], seed: 0.25, time: 9,
        });
        expect([...from.slice(0, 4)]).toEqual([1, 2, 3, 9]);
        expect([...go.slice(0, 4)]).toEqual([4, 5, 6, 2.5]);
        expect(look[2]).toBe(CHAFF_KIND.flake);
        expect(look[3]).toBeCloseTo(0.25, 6);
        expect([...tint.slice(0, 3)].map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3]);
        chaff.fly({
            x: 0, y: 0, z: 0, kind: CHAFF_KIND.puff, size: 0.5, grow: 2, pigment: 0.3, seed: 0.75, time: 9,
        });
        expect(look[4 + 2]).toBe(CHAFF_KIND.puff);
        expect(Math.floor(look[4 + 3])).toBe(3);
        expect(look[4 + 3] % 1).toBeCloseTo(0.75, 5);
        expect([look[4], look[4 + 1]]).toEqual([0.5, 2]);
        // A wound flake's row: radius, climb, turn, life; how the spiral opens rides with its colour.
        chaff.fly({
            x: 7, y: 8, z: 9, kind: CHAFF_KIND.wound, radius: 0.8, climb: 4, turn: -5, open: 0.17, life: 3, seed: 1.5, time: 9,
        });
        expect([...go.slice(8, 12)]).toEqual([0.800000011920929, 4, -5, 3]);
        expect(tint[8 + 3]).toBeCloseTo(0.17, 6);
        // (A seed is kept under 1: its integer part is the puffs'.)
        expect(look[8 + 3]).toBeLessThan(1);
        expect(chaff.thrown).toBe(3);
        chaff.dispose();
    });

    it('rings round, empties on a reset, and says how much of a full burst it carries', () => {
        const small = createChaff(u, t, 10);
        expect(small.ring).toBe(160);
        expect(small.share).toBe(0.45);
        for (let k = 0; k < 161; k += 1) {
            small.fly({
                x: k, y: 0, z: 0, time: k,
            });
        }
        expect(small.records.from[0]).toBe(160);
        expect(small.records.from[4]).toBe(1);
        small.reset();
        expect(small.thrown).toBe(0);
        for (let i = 0; i < small.ring; i += 1) expect(small.records.from[i * 4 + 3]).toBeLessThan(-1e5);
        small.dispose();
        const full = createChaff(u, t, 900);
        expect(full.share).toBe(1);
        expect(createChaff(u, t, 4000).share).toBe(1);
        full.dispose();
        expect(Math.hypot(...DEVIL_WALK)).toBeGreaterThan(0.5);
        expect(Math.hypot(...DEVIL_WALK)).toBeLessThan(3);
    });
});

describe('Grainfields events: the world', () => {
    const START = 10;
    let land;
    let shared;

    function makeWorld(quality = 'Minimal') {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(fovForAspect(ASPECT), ASPECT, REST_RIG.near, REST_RIG.far);
        const world = new GrainfieldsWorld({
            scene, quality, capture: true, prepared: quality === 'Minimal' ? { ...land, assets: null } : GrainfieldsWorld.prepareSync(quality),
        }).build();
        world.setViewport(1600, 900, ASPECT);
        return { scene, camera, world };
    }
    function begin({ world, camera }, time = START) {
        world.seek(time);
        world.updateCamera(camera, { time, delta: 0 });
        world.update({ time, delta: 0 }, camera);
    }
    function stepTo({ world, camera }, to, dt = 1 / 30) {
        const from = world.time;
        const steps = Math.max(1, Math.round((to - from) / dt));
        const h = (to - from) / steps;
        for (let i = 1; i <= steps; i += 1) {
            const time = from + i * h;
            world.updateCamera(camera, { time, delta: 0 });
            world.update({ time, delta: h }, camera);
        }
    }
    /** The chaff ring's records of a kind, as { born, life, y, size, rgb }. */
    function records(world, kind) {
        const { chaff } = world.parts;
        const {
            from, go, look, tint,
        } = chaff.records;
        const out = [];
        for (let i = 0; i < chaff.ring; i += 1) {
            if (from[i * 4 + 3] < -1e5 || Math.round(look[i * 4 + 2]) !== kind) continue;
            out.push({
                x: from[i * 4],
                y: from[i * 4 + 1],
                z: from[i * 4 + 2],
                born: from[i * 4 + 3],
                go: [go[i * 4], go[i * 4 + 1], go[i * 4 + 2]],
                life: go[i * 4 + 3],
                size: look[i * 4],
                grow: look[i * 4 + 1],
                pigment: Math.floor(look[i * 4 + 3]) / 10,
                rgb: [tint[i * 4], tint[i * 4 + 1], tint[i * 4 + 2]],
            });
        }
        return out;
    }

    beforeAll(() => {
        land = GrainfieldsWorld.prepareSync('Minimal');
        shared = makeWorld();
        begin(shared);
    });
    afterAll(() => shared?.world.dispose());

    it('builds the shafts, the devils and the chaff as parts, and knows the way to the gate', () => {
        const { world } = shared;
        for (const name of ['rays', 'devils', 'chaff']) {
            expect(GRAINFIELDS_PARTS).toContain(name);
            expect(world.parts[name], name).toBeTruthy();
            expect(world.parts[name].mesh.material.isNodeMaterial, name).toBe(true);
        }
        const d = world.u.gustFront.value;
        expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
        const to = [PLACES.gate.x - EYE.x, PLACES.gate.z - EYE.z];
        expect(d.x * to[0] + d.y * to[1]).toBeCloseTo(Math.hypot(...to), 3);
        // The shafts' heart lies on the eye's line to the gate, well in front of the fells.
        const [x, , z] = world.parts.rays.at;
        expect(Math.hypot(x - EYE.x, z - EYE.z)).toBeLessThan(GATE_RAYS.distance + 1);
        expect(Math.hypot(x - EYE.x, z - EYE.z)).toBeLessThan(Math.hypot(...to) * 0.6);
        expect(((x - EYE.x) * to[1] - (z - EYE.z) * to[0]) / Math.hypot(...to)).toBeCloseTo(0, 3);
    });

    it('lifts petals of the piece\'s colour and a puff where a lock lands; a hard drop bursts', () => {
        const { world } = shared;
        begin(shared);
        const colour = hexToLinear(PIECE_COLORS[4]);
        world.onLock({ u: 0.2, rows: [16], color: PIECE_COLORS[4] });
        const gap = world.reactions.gaps[0];
        const petals = records(world, CHAFF_KIND.flake);
        const puffs = records(world, CHAFF_KIND.puff);
        expect(petals.length).toBeGreaterThan(10);
        expect(puffs.length).toBeGreaterThan(0);
        petals.forEach((p) => {
            // Out of the ears round the beam's foot, upward, in the piece's colour (blue here).
            expect(Math.hypot(p.x - gap.footX, p.z - gap.footZ)).toBeLessThan(gap.radius + 0.01);
            expect(p.y).toBeGreaterThan(gap.footY);
            expect(p.go[1]).toBeGreaterThan(0);
            expect(p.born).toBeGreaterThanOrEqual(START);
            expect(p.rgb[2]).toBeGreaterThan(p.rgb[0]);
        });
        expect(colour[2]).toBeGreaterThan(colour[0]);
        expect(world.lastLock.rgb).toBe(gap.rgb);
        expect(world.lastLock.side).toBe(-1);

        begin(shared);
        world.onLock({
            u: 0.2, rows: [16], color: PIECE_COLORS[4], hardDrop: true,
        });
        const burst = records(world, CHAFF_KIND.flake);
        const cloud = records(world, CHAFF_KIND.puff);
        expect(burst.length).toBeGreaterThan(petals.length);
        expect(cloud.length).toBeGreaterThan(puffs.length);
        // The cloud is the field's dust with a breath of the piece in it; it swells as it rises.
        cloud.forEach((p) => {
            expect(p.pigment).toBeLessThan(0.25);
            expect(p.grow).toBeGreaterThan(p.size);
        });
        // Its crown goes out low and fast: some petals faster sideways than up.
        expect(burst.some((p) => Math.hypot(p.go[0], p.go[2]) > p.go[1])).toBe(true);
    });

    it('sizes a far lock\'s puff to its distance, so it stands as tall beside the card as a near one\'s', () => {
        const { world } = shared;
        begin(shared);
        world.onLock({ u: 0.2, rows: [19], color: PIECE_COLORS[0] });
        const near = records(world, CHAFF_KIND.flake);
        begin(shared);
        world.onLock({ u: 0.2, rows: [4], color: PIECE_COLORS[0] });
        const far = records(world, CHAFF_KIND.flake);
        const mean = (list, f) => list.reduce((sum, p) => sum + f(p), 0) / list.length;
        expect(mean(far, (p) => p.size)).toBeGreaterThan(mean(near, (p) => p.size) * 1.5);
        expect(mean(far, (p) => p.go[1])).toBeGreaterThan(mean(near, (p) => p.go[1]) * 1.2);
    });

    it('bursts whole after a pause and a quarter as much in a run of hard drops', () => {
        const { world } = shared;
        const drop = () => {
            const before = world.parts.chaff.thrown;
            world.onLock({
                u: 0.2, rows: [16], color: PIECE_COLORS[2], hardDrop: true,
            });
            return world.parts.chaff.thrown - before;
        };
        begin(shared);
        const first = drop();
        stepTo(shared, START + 0.5);
        const second = drop();
        stepTo(shared, START + 1);
        const third = drop();
        expect(second).toBeLessThan(first * 0.7);
        expect(third).toBeLessThan(first * 0.7);
        expect(third).toBeGreaterThan(8);
        // The air clears: after a pause the next drop bursts whole again.
        stepTo(shared, START + 6, 0.1);
        expect(drop()).toBe(first);
    });

    it('throws nothing into the air under reduced motion, and a seek empties the ring', () => {
        const { world } = shared;
        begin(shared);
        world.setReducedMotion(true);
        world.onLock({
            u: 0.3, rows: [14], color: PIECE_COLORS[1], hardDrop: true,
        });
        world.onClear({ lines: 4, twist: true, perfect: true });
        world.onSpin({ u: 0.4 });
        expect(world.parts.chaff.thrown).toBe(0);
        world.setReducedMotion(false);
        world.onLock({ u: 0.3, rows: [14], color: PIECE_COLORS[1] });
        expect(world.parts.chaff.thrown).toBeGreaterThan(0);
        begin(shared);
        expect(world.parts.chaff.thrown).toBe(0);
        expect(records(world, CHAFF_KIND.flake)).toEqual([]);
    });

    it('winds a twist\'s flakes up round its devil in the last piece\'s colour, one after another', () => {
        const { world } = shared;
        begin(shared);
        world.onLock({ u: 0.8, rows: [15], color: PIECE_COLORS[6] });
        const before = world.parts.chaff.thrown;
        world.onClear({ lines: 2, twist: true });
        const [devil] = world.reactions.devils;
        const wound = records(world, CHAFF_KIND.wound);
        expect(world.parts.chaff.thrown).toBeGreaterThan(before);
        expect(wound.length).toBeGreaterThan(20);
        const red = hexToLinear(PIECE_COLORS[6]);
        expect(red[0]).toBeGreaterThan(red[2]);
        wound.forEach((p) => {
            // Each leaves the foot where the walking devil stands at that moment, and climbs.
            const age = p.born - devil.at;
            expect(age).toBeGreaterThan(0);
            expect(p.x).toBeCloseTo(devil.x + DEVIL_WALK[0] * age, 3);
            expect(p.z).toBeCloseTo(devil.z + DEVIL_WALK[1] * age, 3);
            expect(p.go[1]).toBeGreaterThan(0);
            expect(Math.sign(p.go[2])).toBe(Math.sign(devil.spin));
            expect(p.rgb[0]).toBeGreaterThan(p.rgb[2]);
        });
        const births = wound.map((p) => p.born);
        expect(Math.max(...births) - Math.min(...births)).toBeGreaterThan(3);
        // ...and the devils part draws it while it lives.
        stepTo(shared, START + 2);
        expect(world.parts.devils.count).toBe(1);
        expect(world.parts.devils.mesh.visible).toBe(true);
        stepTo(shared, START + DEVIL.life + 0.5, 0.1);
        expect(world.parts.devils.count).toBe(0);
        expect(world.parts.devils.mesh.visible).toBe(false);
    });

    it('lights the gate\'s shafts on four lines and tears chaff out of the stand as the gust comes in', () => {
        const { world } = shared;
        begin(shared);
        expect(world.parts.rays.mesh.visible).toBe(false);
        world.onClear({ lines: 4 });
        stepTo(shared, START + 0.6);
        expect(world.fx.rays).toBeGreaterThan(0.5);
        expect(world.parts.rays.mesh.visible).toBe(true);
        expect(world.parts.rays.strength.value).toBe(world.fx.rays);
        // The gust's chaff: each flake is thrown when the front reaches it (the nearest last), and
        // flies toward the eye and past it.
        const d = world.u.gustFront.value;
        const start = world.reactions.gustAt;
        // (The clear's two lanes throw their chaff away from the eye; the gust's comes toward it.)
        const stream = records(world, CHAFF_KIND.flake).filter((p) => p.go[0] * d.x + p.go[2] * d.y < -8);
        expect(stream.length).toBeGreaterThan(30);
        stream.forEach((p) => {
            const ahead = (p.x - EYE.x) * d.x + (p.z - EYE.z) * d.y;
            const reached = start + (GUST.from - ahead) / GUST.speed;
            expect(p.born).toBeGreaterThanOrEqual(reached - 1e-3);
            expect(p.born).toBeLessThan(reached + 0.31);
        });
        // The front reaches the eye and the uniform follows it past.
        stepTo(shared, start + GUST_ARRIVES);
        expect(world.u.gustFront.value.z).toBeCloseTo(0, 0);
        expect(world.u.gustFront.value.w).toBeGreaterThan(0.9);
        stepTo(shared, start + GUST_LIFE + 0.2);
        expect(world.u.gustFront.value.w).toBe(0);
        stepTo(shared, START + 14, 0.1);
        expect(world.parts.rays.mesh.visible).toBe(false);
    });

    it('lets gold dust rise all over the near stand in a perfect clear\'s still air', () => {
        const { world } = shared;
        begin(shared);
        world.onClear({ crown: true });
        const risers = records(world, CHAFF_KIND.wound);
        expect(risers.length).toBeGreaterThan(40);
        risers.forEach((p) => {
            // Out over the field (near the lens a mote is a blob), slow, long-lived.
            expect(Math.hypot(p.x - EYE.x, p.z - EYE.z)).toBeGreaterThan(10);
            expect(p.go[1]).toBeGreaterThan(0);
            expect(p.go[1]).toBeLessThan(1.5);
            expect(p.life).toBeGreaterThan(5);
        });
        expect(world.counts.perfects).toBe(1);
    });

    it('carries a clear\'s chaff out along its lane, more of it for more lines', () => {
        const { world } = shared;
        const thrownBy = (lines) => {
            begin(shared);
            world.onClear({ lines });
            return records(world, CHAFF_KIND.flake);
        };
        const one = thrownBy(1);
        const three = thrownBy(3);
        expect(one.length).toBeGreaterThan(8);
        expect(three.length).toBeGreaterThan(one.length);
        const [lane] = world.reactions.trails;
        three.forEach((p) => {
            expect(p.go[0] * lane.hx + p.go[2] * lane.hz).toBeGreaterThan(0);
            expect(p.born).toBeGreaterThanOrEqual(lane.at);
        });
        expect(records(world, CHAFF_KIND.puff).length).toBeGreaterThan(0);
    });

    it('turns the day in time-lapse on a level-up: the deck races on, never back, and not under reduced motion', () => {
        const drift = (levels, reduced = false) => {
            const w = makeWorld();
            w.world.setReducedMotion(reduced);
            begin(w);
            const seen = [];
            levels.forEach((at, k) => {
                stepTo(w, at);
                const before = w.world.u.drift.value.x;
                w.world.levelUp(k + 2);
                w.world.update({ time: w.world.time, delta: 0 }, w.camera);
                // The level-up itself moves nothing: the run carries on from where it stands.
                seen.push(w.world.u.drift.value.x - before);
            });
            stepTo(w, START + 14);
            const { x } = w.world.u.drift.value;
            w.world.dispose();
            return { x, seen };
        };
        const plain = drift([]);
        const once = drift([START + 1]);
        const twice = drift([START + 1, START + 3]);
        const perSecond = plain.x / (START + 14);
        // (A level-up also warms the surge, which runs the deck on a little by itself.)
        expect(once.x - plain.x).toBeGreaterThan(LAPSE.run * perSecond - 1);
        expect(once.x - plain.x).toBeLessThan(LAPSE.run * perSecond * 1.05);
        // A second level-up while the first still runs adds a whole run of its own.
        expect(twice.x - plain.x).toBeGreaterThan((once.x - plain.x) * 1.9);
        [...once.seen, ...twice.seen].forEach((jump) => expect(Math.abs(jump)).toBeLessThan(1e-6));
        // Reduced motion: no race (the level-up's own warmth runs the deck on a few metres).
        expect(Math.abs(drift([START + 1], true).x - drift([], true).x)).toBeLessThan(10);
        expect(LAPSE.span).toBeGreaterThan(2);
    });

    it('scales a burst to the tier\'s ring: a leaner ring throws fewer, never none', () => {
        const high = makeWorld('High');
        begin(high);
        high.world.onLock({
            u: 0.2, rows: [16], color: PIECE_COLORS[2], hardDrop: true,
        });
        const { world } = shared;
        begin(shared);
        world.onLock({
            u: 0.2, rows: [16], color: PIECE_COLORS[2], hardDrop: true,
        });
        expect(high.world.parts.chaff.ring).toBeGreaterThan(world.parts.chaff.ring);
        expect(high.world.parts.chaff.thrown).toBeGreaterThan(world.parts.chaff.thrown);
        expect(world.parts.chaff.thrown).toBeGreaterThan(20);
        // One event never fills a ring.
        expect(high.world.parts.chaff.thrown).toBeLessThan(high.world.parts.chaff.ring * 0.5);
        expect(world.parts.chaff.thrown).toBeLessThan(world.parts.chaff.ring * 0.5);
        high.world.dispose();
    });

    it('replays the same chaff after a seek', () => {
        const { world } = shared;
        const run = () => {
            begin(shared);
            world.onLock({
                u: 0.7, rows: [12], color: PIECE_COLORS[3], hardDrop: true,
            });
            world.onClear({ lines: 4, twist: true });
            return [...world.parts.chaff.records.from.slice(0, 400)];
        };
        expect(run()).toEqual(run());
    });
});
