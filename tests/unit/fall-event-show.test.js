/**
 * Fall — each game event's own form (`frame.fx`): the director's show, the light it is drawn with,
 * what it throws (maple keys, acorns, motes, sparks, the lantern ring) and the flock a perfect clear
 * startles. Behaviour, not tuned numbers: every event has its form, the biggest moments the most,
 * nothing in flight is ever cut, nothing restarts when events overlap, and every reading is the
 * same at any frame rate.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FALL_VIEWS } from '../../src/themes/fall/fall-composition.js';
import { FallEventFx, KEY_REST } from '../../src/themes/fall/fall-event-fx.js';
import {
    FALL_EVENT_TIERS, FallEventLight, fallCrownGlow, fallEventRandom, fallEventTier, fallPulseHeight, fallRingFade,
    fallRingRadius,
} from '../../src/themes/fall/fall-event-light.js';
import { FallFlush } from '../../src/themes/fall/fall-flush.js';
import { FallLight } from '../../src/themes/fall/fall-light.js';
import { FALL_TIERS } from '../../src/themes/fall/fall-quality.js';
import {
    FALL_CUE_KINDS, FALL_PULSE_SLOTS, FALL_RING_SECONDS, FALL_RING_SLOTS, FallReactions,
} from '../../src/themes/fall/fall-reactions.js';
import { FallStage } from '../../src/themes/fall/fall-stage.js';
import { fallTerrainHeight } from '../../src/themes/fall/fall-terrain.js';

const STEP = 1 / 60;

function seededRandom(seed = 187) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function create(quality = 'High') {
    return new FallReactions({ quality, rng: seededRandom() });
}

function advance(reactions, seconds, fps = 60) {
    const frames = Math.round(seconds * fps);
    for (let i = 0; i < frames; i += 1) reactions.update(1 / fps);
    return reactions.getFrame();
}

function cell(x, y) {
    return { x, y, shape: [[1]] };
}

const kinds = (frame) => frame.fx.cues.map((cue) => cue.kind);

/** The game's landscape eye and its stage, as FallWorld frames them. */
function landscapeStage() {
    const view = FALL_VIEWS.landscape;
    const camera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.3, 600);
    camera.position.set(view.position[0], view.position[1] + fallTerrainHeight(0, view.position[2]), view.position[2]);
    camera.lookAt(...view.target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return new FallStage(camera);
}

/** A few crown points either side of the board, as FallForest.sampleCrownPoints gives them. */
function crownPoints() {
    const points = [];
    for (let i = 0; i < 40; i += 1) {
        const side = i % 2 === 0 ? -1 : 1;
        points.push(side * (5 + (i % 7)), 7 + (i % 5), -2 - (i % 6), 0);
    }
    return Float32Array.from(points);
}

function light(quality = 'High') {
    return new FallLight({ tier: FALL_TIERS[quality], rng: () => 0.5 });
}

describe('the show: every event has a form of its own', () => {
    it('gives a long hard drop a thump (a ring and acorns), a short one none', () => {
        const long = create();
        long.onHardDrop({ distance: 16 });
        long.onPieceLock({ piece: cell(2, 22) });
        expect(long.frame.fx.rings).toHaveLength(1);
        expect(kinds(long.frame)).toEqual(['thump']);
        const short = create();
        short.onHardDrop({ distance: 2 });
        short.onPieceLock({ piece: cell(2, 22) });
        expect(short.frame.fx.rings).toHaveLength(0);
        expect(short.frame.fx.cues).toHaveLength(0);
        // A plain lock (no drop) has none either: it is the lightest thing the grove does.
        const plain = create();
        plain.onPieceLock({ piece: cell(2, 22) });
        expect(plain.frame.fx.rings).toHaveLength(0);
    });

    it('climbs a ladder from one line to four: nothing more, the canopy, keys, the sunburst', () => {
        const shows = [1, 2, 3, 4].map((lines) => {
            const reactions = create();
            reactions.onPieceLock({ piece: cell(4, 20) });
            reactions.onLineClear(lines, { clearedRows: [20] });
            return advance(reactions, 0.2).fx;
        });
        expect(shows[0].canopy).toBe(0);
        expect(shows[1].canopy).toBeGreaterThan(0);
        expect(shows[2].canopy).toBeGreaterThan(shows[1].canopy);
        expect(shows.map((fx) => fx.cues.some((cue) => cue.kind === 'keys'))).toEqual([false, false, true, true]);
        expect(shows.map((fx) => fx.fan > 0)).toEqual([false, false, false, true]);
        expect(shows.map((fx) => fx.floods.length)).toEqual([0, 0, 0, 1]);
    });

    it('lights a ring of lanterns as a combo counts up, and lets it go out after the chain', () => {
        const reactions = create();
        const readings = [];
        for (let count = 2; count <= 8; count += 1) {
            reactions.onPieceLock({ piece: cell(4, 20) });
            reactions.onLineClear(1, { clearedRows: [20] });
            reactions.onCombo(count);
            readings.push(advance(reactions, 0.4).fx.lantern);
        }
        for (let i = 1; i < readings.length; i += 1) expect(readings[i]).toBeGreaterThan(readings[i - 1]);
        expect(kinds(reactions.frame)).toContain('sparks');
        // (It goes out one light after another: all but gone after the chain.)
        expect(advance(reactions, 12).fx.lantern).toBeLessThan(0.002);
        expect(advance(reactions, 8).fx.lantern).toBe(0);
    });

    it('sends a twist a spiral, a back-to-back a pulse up both great trunks', () => {
        const twist = create();
        twist.onTwist({ piece: cell(7, 18) });
        expect(kinds(twist.frame)).toEqual(['spiral']);
        expect(twist.frame.fx.cues[0].side).toBe(1);
        const b2b = create();
        b2b.onBackToBack();
        expect(b2b.frame.fx.pulses).toHaveLength(1);
        advance(b2b, 0.3);
        b2b.onBackToBack();
        expect(b2b.frame.fx.pulses).toHaveLength(2);
        // With both climbing a third lifts the younger rather than restarting either.
        const ages = b2b.frame.fx.pulses.map((pulse) => pulse.age);
        b2b.onBackToBack();
        expect(b2b.frame.fx.pulses.map((pulse) => pulse.age)).toEqual(ages);
        expect(b2b.frame.fx.pulses).toHaveLength(FALL_PULSE_SLOTS);
    });

    it('makes a perfect clear the crown of them all', () => {
        const quad = create();
        quad.onPieceLock({ piece: cell(4, 20) });
        quad.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        const crowned = create();
        crowned.onPieceLock({ piece: cell(4, 20) });
        crowned.onLineClear(4, { clearedRows: [20, 21, 22, 23] });
        crowned.onPerfectClear();
        const a = advance(quad, 0.5).fx;
        const b = advance(crowned, 0.5).fx;
        expect(b.fan).toBeGreaterThan(a.fan);
        expect(b.rings.some((ring) => ring.wave)).toBe(true);
        expect(kinds(crowned.frame).sort()).toEqual(expect.arrayContaining(['dust', 'flush', 'keys']));
        expect(b.canopy).toBeGreaterThan(a.canopy);
    });

    it('carries a level\'s new light across the grove as a front', () => {
        const reactions = create();
        reactions.onLevelUp();
        const positions = [];
        for (let i = 0; i < 4; i += 1) positions.push(advance(reactions, 0.35).fx.light.position);
        for (let i = 1; i < positions.length; i += 1) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
        expect(advance(reactions, 3).fx.light).toBeNull();
    });

    it('makes a game over a moment, not a state, and keeps the run\'s end whatever the effects say', () => {
        const reactions = create();
        reactions.onPieceLock({ piece: cell(4, 20) });
        reactions.onLineClear(2, { clearedRows: [20] });
        reactions.onCombo(4);
        reactions.onGameOver();
        expect(reactions.vortexTarget).toBe(0);
        const peak = Math.max(...[0.2, 0.2, 0.2].map(() => advance(reactions, 0.2).fx.hush));
        expect(peak).toBeGreaterThan(0.5);
        expect(advance(reactions, 4).fx.hush).toBeLessThan(0.2);
        expect(advance(reactions, 8).fx.hush).toBeLessThan(0.005);
        // With effects off the run still ends (the vortex lets go), with no hush.
        const quiet = create();
        quiet.onCombo(4);
        quiet.onGameOver({ effects: false });
        expect(quiet.vortexTarget).toBe(0);
        expect(advance(quiet, 0.3).fx.hush).toBe(0);
    });

    it('starts a new run fresh without cutting what is still in the air', () => {
        const reactions = create();
        for (let i = 0; i < 4; i += 1) {
            reactions.onPieceLock({ piece: cell(4, 20) });
            reactions.onLineClear(1, { clearedRows: [20] });
        }
        reactions.onBackToBack();
        reactions.onHardDrop({ distance: 18 });
        const before = reactions.frame;
        const { epoch } = before.fx;
        expect(reactions.streak).toBeGreaterThan(1);
        expect(reactions.onSessionStart({ effects: false })).toBe(true);
        expect(reactions.streak).toBe(0);
        expect(reactions.pendingDrop).toBe(0);
        // The light and the leaves already out stay out; the clock and the serials run on.
        expect(reactions.frame.glow).toBeCloseTo(before.glow, 9);
        expect(reactions.frame.emitters.map((emitter) => emitter.serial))
            .toEqual(before.emitters.map((emitter) => emitter.serial));
        expect(reactions.frame.fx.epoch).toBe(epoch);
        // The next lock after it is a plain one (the drop was the last run's).
        reactions.onPieceLock({ piece: cell(4, 20) });
        expect(reactions.frame.fx.rings.filter((ring) => !ring.wave)).toHaveLength(0);
    });

    it('gives way first where it is lightest: thumps, and never a ring already running', () => {
        const reactions = create();
        const drop = () => {
            reactions.onHardDrop({ distance: 18 });
            reactions.onPieceLock({ piece: cell(2, 22) });
        };
        drop();
        drop(); // too soon after the last: no second ring
        expect(reactions.frame.fx.rings).toHaveLength(1);
        for (let i = 0; i < 8; i += 1) {
            advance(reactions, 0.25);
            drop();
        }
        const { rings } = reactions.frame.fx;
        expect(rings.length).toBeLessThanOrEqual(FALL_RING_SLOTS);
        // A full table: a thump is let go, a perfect clear's wave takes the ring furthest through.
        const serials = rings.map((ring) => ring.serial);
        reactions.onPerfectClear();
        const after = reactions.frame.fx.rings;
        expect(after.some((ring) => ring.wave)).toBe(true);
        expect(after.filter((ring) => serials.includes(ring.serial)).length).toBeGreaterThanOrEqual(serials.length - 1);
        expect(after.every((ring) => ring.age < FALL_RING_SECONDS.wave)).toBe(true);
    });

    it('reads the same at any frame rate', () => {
        const run = (fps) => {
            const reactions = create();
            const script = [
                [0.1, () => { reactions.onHardDrop({ distance: 18 }); reactions.onPieceLock({ piece: cell(2, 22) }); }],
                [0.5, () => { reactions.onPieceLock({ piece: cell(4, 20) }); reactions.onLineClear(4, { clearedRows: [20] }); }],
                [0.9, () => reactions.onBackToBack()],
                [1.3, () => reactions.onLevelUp()],
                [1.6, () => reactions.onPerfectClear()],
            ];
            const samples = [];
            const frames = Math.round(3 * fps);
            // (Read between the events: at an event's own frame the coarser clock has simply run a
            // whole frame further into it.)
            const at = [0.7, 1.1, 2.0, 2.5, 3.0].map((t) => Math.round(t * fps));
            for (let i = 1; i <= frames; i += 1) {
                const t = i / fps;
                reactions.update(1 / fps);
                // (Each event lands when the director's own clock reaches it, at either rate.)
                while (script.length && script[0][0] <= t + 1e-9) script.shift()[1]();
                if (at.includes(i)) {
                    const { fx } = reactions.getFrame();
                    samples.push([fx.fan, fx.canopy, fx.hush, fx.light?.position ?? null, fx.rings.length, fx.pulses.length]);
                }
            }
            return samples;
        };
        const slow = run(30);
        const fast = run(150);
        expect(slow.length).toBe(fast.length);
        slow.forEach((row, i) => row.forEach((value, k) => {
            if (value === null) expect(fast[i][k]).toBeNull();
            else expect(fast[i][k]).toBeCloseTo(value, 1);
        }));
    });

    it('numbers its one-shot cues and lets each go after a moment', () => {
        const reactions = create();
        reactions.onTwist({ piece: cell(2, 18) });
        reactions.onPerfectClear();
        const { cues } = reactions.frame.fx;
        const serials = cues.map((cue) => cue.serial);
        expect(new Set(serials).size).toBe(serials.length);
        expect([...serials].sort((a, b) => a - b)).toEqual(serials);
        cues.forEach((cue) => expect(FALL_CUE_KINDS).toContain(cue.kind));
        expect(advance(reactions, 1.2).fx.cues).toHaveLength(0);
    });

    it('takes junk without throwing or lighting anything', () => {
        const reactions = create();
        for (const junk of [undefined, null, 0, 'x', [], {}, { effects: 'no' }]) {
            expect(() => reactions.onGameOver(junk ?? undefined)).not.toThrow();
            expect(() => reactions.onSessionStart(junk ?? undefined)).not.toThrow();
        }
        reactions.onHardDrop({ distance: NaN });
        reactions.onPieceLock({ piece: { x: Infinity, y: 'a', shape: null } });
        const { fx } = advance(reactions, 0.1);
        expect(fx.rings).toHaveLength(0);
        expect(Number.isFinite(fx.fan) && Number.isFinite(fx.canopy) && Number.isFinite(fx.lantern)).toBe(true);
    });
});

describe('the show\'s light (FallEventLight)', () => {
    it('keeps rings, pulses and the crowns\' glow inside their lives', () => {
        expect(fallRingFade(0, 1)).toBe(0);
        expect(fallRingFade(0.5, 1)).toBeGreaterThan(0);
        expect(fallRingFade(1, 1)).toBe(0);
        expect(fallRingFade(NaN, 1)).toBe(0);
        expect(fallRingRadius(1, true)).toBeGreaterThan(fallRingRadius(1));
        let last = -Infinity;
        for (let t = 0; t < 3; t += 0.1) {
            expect(fallRingRadius(t)).toBeGreaterThanOrEqual(last);
            last = fallRingRadius(t);
            expect(fallPulseHeight(t + 0.1)).toBeGreaterThan(fallPulseHeight(t));
        }
        expect(fallCrownGlow(0.2)).toBe(0);
        expect(fallCrownGlow(1.4)).toBeGreaterThan(0.5);
        expect(fallCrownGlow(3)).toBe(0);
    });

    it('turns the director\'s frame into finite uniforms, and rests on junk', () => {
        const rig = light();
        const { events } = rig;
        const stage = landscapeStage();
        const reactions = create();
        reactions.onHardDrop({ distance: 18 });
        reactions.onPieceLock({ piece: cell(2, 22) });
        reactions.onLineClear(4, { clearedRows: [20] });
        reactions.onBackToBack();
        reactions.onLevelUp();
        const frame = advance(reactions, 0.5);
        events.update(frame, { stage, flash: 1 });
        expect(events.state.rings).toBeGreaterThan(0);
        expect(events.state.floods).toBeGreaterThan(0);
        expect(events.state.pulses).toBeGreaterThan(0);
        expect(events.state.dawn).toBeGreaterThan(0);
        const values = () => [...events.uRings.map((u) => u.value.toArray()), events.uFlood.value.toArray(),
            events.uDawn.value.toArray(), events.uPulse.value.toArray(), [events.uCrown.value, events.uCanopy.value]].flat();
        expect(values().every(Number.isFinite)).toBe(true);
        // Reduce flashing: the floods and the light front go, the motion of the floor stays.
        events.update(frame, { stage, flash: 0 });
        expect(events.state.floods).toBe(0);
        expect(events.state.dawn).toBe(0);
        expect(events.state.rings).toBeGreaterThan(0);
        for (const junk of [undefined, null, {}, { fx: 3 }, { fx: { rings: 'x', floods: [null], pulses: [{ age: NaN }] } }]) {
            expect(() => events.update(junk, { stage })).not.toThrow();
            expect(values().every(Number.isFinite)).toBe(true);
        }
        events.reset();
        expect(events.state).toEqual({
            rings: 0, floods: 0, dawn: 0, pulses: 0, crown: 0, canopy: 0,
        });
        rig.dispose();
    });

    it('builds no hook on a tier that does not carry it', () => {
        expect(fallEventTier('Low')).toBe(FALL_EVENT_TIERS.Low);
        expect(fallEventTier(FALL_TIERS.Minimal)).toBe(FALL_EVENT_TIERS.Minimal);
        expect(fallEventTier('nonsense')).toBe(FALL_EVENT_TIERS.High);
        const low = new FallEventLight({ tier: FALL_TIERS.Low });
        const lit = new THREE.Color();
        expect(low.onGround(lit, { world: null })).toBe(lit);
        expect(low.onBark(lit, { world: null, tree: null })).toBe(lit);
        const minimal = new FallEventLight({ tier: FALL_TIERS.Minimal });
        expect(minimal.tier.floor).toBe(false);
    });
});

describe('what the events throw (FallEventFx)', () => {
    function fx(quality = 'High') {
        const rig = light(quality);
        const show = new FallEventFx({
            light: rig,
            tier: FALL_TIERS[quality],
            rng: fallEventRandom(7),
            groundHeight: fallTerrainHeight,
            crownPoints: crownPoints(),
        }).build();
        return { rig, show, stage: landscapeStage() };
    }

    it('throws for each cue once, and only for the cues it has a form for', () => {
        const { rig, show, stage } = fx();
        const reactions = create();
        reactions.onPieceLock({ piece: cell(4, 20) });
        reactions.onLineClear(3, { clearedRows: [20] });
        const frame = reactions.getFrame();
        show.play(frame, { time: 0, dt: STEP, stage });
        const { thrown } = show.counts();
        expect(show.counts().keys).toBeGreaterThan(10);
        show.play(frame, { time: STEP, dt: STEP, stage });
        expect(show.counts().thrown).toBe(thrown);
        // A fresh start of the director (a new epoch: its serials start again) is read afresh.
        reactions.reset();
        reactions.onTwist({ piece: cell(2, 18) });
        show.play(reactions.getFrame(), { time: 2 * STEP, dt: STEP, stage });
        expect(show.counts().thrown).toBeGreaterThan(thrown);
        rig.dispose();
        show.dispose();
    });

    it('lets the new particle go when every slot is in flight, never one already flying', () => {
        const { rig, show } = fx('Minimal');
        const ring = show.keyRing;
        let accepted = 0;
        for (let i = 0; i < ring.capacity * 3; i += 1) {
            if (show.key(0, 12, -2, 0.5, 0, 0)) accepted += 1;
        }
        expect(accepted).toBe(ring.capacity);
        const ends = Float64Array.from(ring.ends);
        expect(show.key(0, 12, -2, 0.5, 0, 0)).toBe(false);
        expect(Array.from(ring.ends)).toEqual(Array.from(ends));
        expect(show.counts().refused).toBeGreaterThan(0);
        // Once they have landed and lain their while, the slots are free again.
        show.time = Math.max(...ends) + 0.01;
        expect(show.key(0, 12, -2, 0.5, 0, 0)).toBe(true);
        show.reset();
        expect(show.counts().keys).toBe(0);
        rig.dispose();
        show.dispose();
    });

    it('lands a key and an acorn on the floor where they come down', () => {
        const { rig, show } = fx();
        expect(show.key(2, 9, -1, 0.8, 0.4, -0.3, { sink: 1.3 })).toBe(true);
        const k = show.keyRing.data;
        const [x, y, z, , vx, vy, vz, sink, , , , fallTime] = k;
        // The vertex stage's path (fall-event-fx.js createKeyMaterial), at the moment it lands.
        const drag = 2.2;
        const sinkRate = 3;
        const thrown = (1 - Math.exp(-fallTime * drag)) / drag;
        const sunk = sink * (fallTime - (1 - Math.exp(-fallTime * sinkRate)) / sinkRate);
        const at = [x + vx * thrown, y + vy * thrown - sunk, z + vz * thrown];
        expect(at[1]).toBeCloseTo(fallTerrainHeight(at[0], at[2]) + 0.03, 1);
        expect(show.keyRing.ends[0]).toBeCloseTo(fallTime + KEY_REST, 6);
        expect(show.acorn(2, 9, -1, 0.2, 0.1)).toBe(true);
        const a = show.acornRing.data;
        expect(a[6]).toBeCloseTo(Math.sqrt((2 * (9 - a[10])) / 8.5), 6);
        // Junk never reaches the GPU.
        expect(show.key(NaN, 1, 1, 0, 0, 0)).toBe(false);
        expect(show.acorn(0, -50, 0, 0, 0)).toBe(false);
        rig.dispose();
        show.dispose();
    });

    it('keeps the vortex in sparks while it turns, and the lantern ring at the card\'s foot', () => {
        const { rig, show, stage } = fx();
        const reactions = create();
        for (let i = 0; i < 6; i += 1) {
            reactions.onPieceLock({ piece: cell(4, 20) });
            reactions.onLineClear(1, { clearedRows: [20] });
            reactions.onCombo(i + 2);
        }
        let t = 0;
        for (let i = 0; i < 30; i += 1) {
            t += STEP;
            show.play(reactions.update(STEP), { time: t, dt: STEP, stage });
        }
        expect(show.counts().lights).toBeGreaterThan(20);
        expect(show.uLantern.value).toBeGreaterThan(0);
        const foot = show.uFoot.value;
        expect(foot.y).toBeCloseTo(fallTerrainHeight(foot.x, foot.z), 6);
        rig.dispose();
        show.dispose();
    });
});

describe('the flock a perfect clear startles (FallFlush)', () => {
    it('flies each bird until it has left the frame, and lets new ones go when all are out', () => {
        const rig = light();
        const stage = landscapeStage();
        const flush = new FallFlush({ light: rig, tier: FALL_TIERS.High, rng: fallEventRandom(3) }).build();
        const reactions = create();
        reactions.onPerfectClear();
        flush.play(reactions.getFrame(), { time: 0, stage });
        const { flying } = flush.counts();
        expect(flying).toBe(flush.capacity);
        // Each bird's last moment is out of the frame (or about to be): the flock leaves whole.
        const out = new THREE.Vector3();
        for (let i = 0; i < flush.capacity; i += 1) {
            const o = i * 12;
            const d = flush.data;
            const life = d[o + 10];
            const run = d[o + 7] * (life - 0.6 + 0.4 * (1 - Math.exp(-2.6 * (life - 0.6))));
            if (life < 12) {
                stage.project(d[o] + d[o + 4] * run, d[o + 1] + d[o + 5] * run, d[o + 2] + d[o + 6] * run, out);
                expect(out.x > 0.95 || out.x < 0.05 || out.y < 0.05 || out.y > 0.95 || out.z <= 0).toBe(true);
            }
        }
        // The same cue is not read twice; a second perfect clear finds every bird in the air.
        flush.play(reactions.getFrame(), { time: 0.1, stage });
        expect(flush.counts().flown).toBe(flush.capacity);
        reactions.onPerfectClear();
        flush.play(reactions.getFrame(), { time: 0.2, stage });
        expect(flush.counts().refused).toBeGreaterThan(0);
        flush.reset();
        expect(flush.counts().flying).toBe(0);
        rig.dispose();
        flush.dispose();
    });

    it('flies fewer birds on a cheaper tier, and none without the game\'s eye', () => {
        const rig = light('Minimal');
        const flush = new FallFlush({ light: rig, tier: FALL_TIERS.Minimal, rng: fallEventRandom(3) }).build();
        expect(flush.capacity).toBe(FALL_EVENT_TIERS.Minimal.birds);
        expect(flush.capacity).toBeLessThan(FALL_EVENT_TIERS.High.birds);
        expect(flush.burst(1, null)).toBe(0);
        expect(flush.burst(1, landscapeStage())).toBe(flush.capacity);
        rig.dispose();
        flush.dispose();
    });
});
