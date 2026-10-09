/**
 * Vesper Chrysalis — random play against the real world.
 *
 * Seeded runs of a few thousand events each: locks, hard drops, clears of one to four lines,
 * T-spins, perfect clears, chains that grow, jump and break, new levels, new runs, game overs,
 * seeks, boards that come and go and change shape, windows that resize, reduced motion switched on
 * and off, and frames of every length from none at all to a stall of most of a minute. After
 * every frame the world is audited: nothing it holds may leave its range, nothing due may be left
 * waiting, every counter must agree with what was asked of it, and every number a shader or the
 * post reads must be finite.
 *
 * The events are those the director can deliver, and a few a careless caller might: colours and
 * counts may be anything, and now and then a row or a column is not a number. A fault found here
 * is reduced to a test of its own, in this file or in vesper-chrysalis-world.test.js.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    REST_RIG, VESPER_PARTS, VesperWorld, fovForAspect,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-world.js';
import {
    BLOOM_FULL, BLOOM_HOLD, BLOOM_RISE, HUSH_HOLD, MOTH_FLIGHT, RING_LIVE, RING_SLOTS, SWELL_LIVE, WING_FALL,
    mulberry32, swellPassTime,
} from '../../src/themes/vesper-chrysalis/vesper-chrysalis-core.js';
import { QUALITY_NAMES } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-quality.js';
import { fallbackLayout } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-composition.js';
import { PULSE_TRAVEL } from '../../src/themes/vesper-chrysalis/vesper-chrysalis-relic.js';

vi.setConfig({ testTimeout: 180000 });

const FRAMES = [[1600, 900], [1920, 1080], [390, 844], [3440, 1440], [1000, 1000], [820, 1180]];
const COLOURS = ['#00f0f0', '#f0f000', '#a000f0', '#00f000', '#f00000', '#0000f0', '#f0a000', 0xff70ff];
const JUNK_COLOURS = [null, undefined, '', 'blue', '#12', NaN, {}, -1];

/** A board layout as the theme's layout watch would report it, or null (no board on screen). */
function someLayout(rand, width, height) {
    const r = rand();
    if (r < 0.25) return null;
    if (r < 0.6) return fallbackLayout(width, height);
    const card = (x0, x1) => ({
        x0, y0: 0.12, x1, y1: 0.92,
    });
    const board = (x0, x1) => ({
        x0: x0 + 0.02, y0: 0.3, x1: x1 - 0.02, y1: 0.88,
    });
    if (r < 0.75) {
        // Two boards side by side.
        return {
            cardCount: 2,
            cards: [card(0.08, 0.4), card(0.6, 0.92)],
            hud: null,
            boards: [null, board(0.08, 0.4), board(0.6, 0.92), null, null],
        };
    }
    if (r < 0.88) {
        // Four across.
        const cards = [0, 1, 2, 3].map((i) => card(0.02 + i * 0.245, 0.02 + i * 0.245 + 0.225));
        return {
            cardCount: 4,
            cards,
            hud: null,
            boards: [null, ...cards.map((c) => board(c.x0, c.x1))],
        };
    }
    // A card whose canvas is not up yet (a mode starting).
    return {
        cardCount: 1, cards: [card(0.35, 0.65)], hud: null, boards: [null, null, null, null, null],
    };
}

/** Every number the shaders share, with a name to report it by. */
function sharedNumbers(world) {
    const out = [];
    const take = (name, value) => {
        if (typeof value === 'number') out.push([name, value]);
        else if (value && typeof value.toArray === 'function') {
            value.toArray().forEach((v, k) => out.push([`${name}[${k}]`, v]));
        }
    };
    Object.keys(world.u).forEach((key) => {
        const node = world.u[key];
        if (Array.isArray(node)) node.forEach((slot, i) => take(`u.${key}[${i}]`, slot.value));
        else if (node && typeof node === 'object' && 'value' in node && !node.value?.isTexture) {
            take(`u.${key}`, node.value);
        }
    });
    world.blooms.rows.forEach((row, i) => take(`blooms.rows[${i}]`, row));
    world.blooms.tints.forEach((tint, i) => take(`blooms.tints[${i}]`, tint));
    return out;
}

/**
 * Play `events` random events on a new world and audit every frame.
 * @returns {{ faults: string[], stats: object }}
 */
function play(seed, { events = 2500, quality = 'Low' } = {}) {
    const rand = mulberry32(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    let [width, height] = pick(FRAMES);
    const scene = new THREE.Scene();
    const shape = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(shape), shape, REST_RIG.near, REST_RIG.far);
    const world = new VesperWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, shape);
    world.setLayout(someLayout(rand, width, height), shape);
    let time = Math.floor(rand() * 30);
    world.seek(time);

    const faults = [];
    const stats = {
        frames: 0,
        events: 0,
        locks: 0,
        clears: 0,
        quads: 0,
        falls: 0,
        fallsToShorter: 0,
        stepsWhileFalling: 0,
        newRuns: 0,
        zeroFrames: 0,
        stalls: 0,
        mostPending: 0,
        mothsCut: 0,
        ringsUnseen: 0,
    };
    /** What this run has asked of the world since its last new run or seek: what its counts report. */
    const asked = { locks: 0, clears: 0, moths: 0 };
    /**
     * What it has asked since the last seek: what the pools' cursors have come to. (A new run
     * leaves what is in the air to run out: the pools are not rewound, only a seek does that.)
     */
    const written = {
        moths: 0, rings: 0, swells: 0, pulses: 0,
    };
    const cursors = {
        ring: 0, swell: 0, pulse: 0, moth: 0, dust: 0,
    };
    /** Each lily's light at the last frame (null across a seek, which puts the lake out at once). */
    let lastLevels = null;
    let lastAudit = 0;
    /** When the moth in each slot of the pool lands. */
    const landing = [];
    /** A new run: the counts start again. The lake fades from what it holds; nothing is rewound. */
    const newCounts = () => {
        Object.keys(asked).forEach((key) => { asked[key] = 0; });
    };
    /** A seek: everything starts again. */
    const forget = () => {
        newCounts();
        Object.keys(written).forEach((key) => { written[key] = 0; });
        Object.keys(cursors).forEach((key) => { cursors[key] = 0; });
        lastLevels = null;
        landing.length = 0;
    };
    /** When the last event that can leave something on its way was sent. */
    let lastEvent = -Infinity;
    // The furthest ahead anything is ever scheduled: a moth's longest flight, or a swell's
    // crossing after a four-line clear's hush, with room for what follows the pass.
    const furthestPass = Math.max(...world.blooms.plan.map((b) => swellPassTime(b.x, b.z)));
    const horizon = Math.max(MOTH_FLIGHT * 3, HUSH_HOLD + furthestPass + 2);

    // What the pools' reuse takes away is counted, not asserted (the world test pins the pace at
    // which it starts): moths overwritten in the air, and rings overwritten before they began.
    const { launch } = world.moths;
    world.moths.launch = (moth) => {
        const slot = launch(moth);
        if (landing[slot] > moth.time + 1e-9) stats.mothsCut += 1;
        landing[slot] = moth.time + moth.flight;
        return slot;
    };
    const ring = world.ring.bind(world);
    world.ring = (...args) => {
        if (world.u.ringA[world.ringCursor % RING_SLOTS].value.z > world.time) stats.ringsUnseen += 1;
        return ring(...args);
    };
    // The fastest a lily's light can change: its rise (a smoothstep over BLOOM_RISE) plus its fade.
    const steepest = (1.5 * BLOOM_FULL) / BLOOM_RISE + BLOOM_FULL / BLOOM_HOLD;

    let note = 'start';
    const fault = (what) => {
        const where = `seed ${seed} ${quality}, frame ${stats.frames} (t=${time.toFixed(3)}), after ${note}`;
        if (faults.length < 12) faults.push(`${where}: ${what}`);
    };
    /** Fault unless `ok`. */
    const need = (ok, what) => {
        if (!ok) fault(what());
    };

    const audit = () => {
        const t = world.time;
        const { blooms, u } = world;
        if (u.time.value !== t) fault(`the shaders' clock ${u.time.value} is not the world's ${t}`);

        // ── The lilies ──
        const levels = [];
        for (let i = 0; i < blooms.count; i++) {
            const s = blooms.state[i];
            const level = blooms.levelAt(i, t);
            levels.push(level);
            if (!(level >= 0 && level <= BLOOM_FULL + 1e-9)) fault(`lily ${i} holds ${level}`);
            // No lily's light jumps: it opens and it lets go smoothly, however the frames fall.
            if (lastLevels && Math.abs(level - lastLevels[i]) > steepest * (t - lastAudit) + 1e-9) {
                fault(`lily ${i} jumped from ${lastLevels[i]} to ${level} in ${t - lastAudit} s`);
            }
            if (!(s.from >= 0 && s.from <= BLOOM_FULL + 1e-9 && s.to >= 0 && s.to <= BLOOM_FULL + 1e-9)) {
                fault(`lily ${i} runs from ${s.from} to ${s.to}`);
            }
            if (!(s.t0 <= t)) fault(`lily ${i} changed at ${s.t0}, which has not come yet`);
            const row = blooms.rows[i];
            need(
                row.x === s.t0 && row.y === s.from && row.z === s.to,
                () => `lily ${i}: the shader's row is not its state`,
            );
            need(row.w <= t, () => `lily ${i} is told to flash at ${row.w}, which has not come yet`);
            const tint = blooms.tints[i];
            need(
                tint.x === s.rgb[0] && tint.y === s.rgb[1] && tint.z === s.rgb[2],
                () => `lily ${i}: the shader's tint is not its colour`,
            );
        }
        lastLevels = levels;
        lastAudit = t;
        // ── What is on its way to them ──
        stats.mostPending = Math.max(stats.mostPending, blooms.pending.length);
        const onWater = u.swellA.map((slot) => slot.value.x);
        blooms.pending.forEach((e, i) => {
            need(e.at > t, () => `a ${e.kind} due at ${e.at} is still waiting`);
            need(e.at < t + horizon, () => `a ${e.kind} is scheduled for ${e.at}, ${(e.at - t).toFixed(1)} s ahead`);
            // The list is kept in time order: a change is never applied before an earlier one.
            const earlier = i > 0 ? blooms.pending[i - 1].at : -Infinity;
            need(e.at >= earlier, () => `a ${e.kind} due at ${e.at} is listed after one due at ${earlier}`);
            need(
                Number.isInteger(e.index) && e.index >= 0 && e.index < blooms.count,
                () => `a ${e.kind} for lily ${e.index}`,
            );
            need(
                e.kind !== 'strike' || (e.amount > 0 && e.rgb.every(Number.isFinite)),
                () => `a strike of ${e.amount} in ${e.rgb}`,
            );
            // A release is a swell's doing: that swell is on the water, and due at this lily just then.
            if (e.kind === 'release') {
                const b = blooms.plan[e.index];
                need(
                    onWater.includes(e.tag),
                    () => `lily ${e.index} is to let go for a swell (${e.tag}) the lake does not draw`,
                );
                need(
                    Math.abs(e.tag + swellPassTime(b.x, b.z) - e.at) < 1e-9,
                    () => `lily ${e.index} is to let go at ${e.at}, not when its swell (${e.tag}) passes it`,
                );
            }
        });
        need(
            !(t - lastEvent > horizon && blooms.pending.length),
            () => `${blooms.pending.length} changes still waiting ${(t - lastEvent).toFixed(1)} s after the last event`,
        );
        for (const [name, waiting] of [['kick', world.pendingKick], ['fed', world.pendingFed]]) {
            need(
                waiting.time === Infinity || waiting.time > t,
                () => `the pending ${name} of ${waiting.time} was never applied`,
            );
        }

        // ── Counters and cursors ──
        const { counts } = world;
        need(counts.locks === asked.locks, () => `counts ${counts.locks} locks of ${asked.locks}`);
        need(counts.clears === asked.clears, () => `counts ${counts.clears} clears of ${asked.clears}`);
        need(counts.moths === asked.moths, () => `sent ${counts.moths} moths for ${asked.moths} asked`);
        // The pools: one slot a moth, a swell a clear, a pulse a lock or a step of the chain, and
        // a ring for every lock's own lily, every hard drop's strike and every four-line clear.
        need(world.moths.cursor === written.moths, () => `moth cursor ${world.moths.cursor}, ${written.moths} sent`);
        need(world.swellCursor === written.swells, () => `swell cursor ${world.swellCursor}, ${written.swells} clears`);
        need(world.pulseCursor === written.pulses, () => `pulse cursor ${world.pulseCursor}, ${written.pulses} asked`);
        need(world.ringCursor === written.rings, () => `ring cursor ${world.ringCursor}, ${written.rings} rings asked`);
        const now = {
            ring: world.ringCursor,
            swell: world.swellCursor,
            pulse: world.pulseCursor,
            moth: world.moths.cursor,
            dust: world.dust.cursor,
        };
        Object.keys(now).forEach((key) => {
            need(
                Number.isInteger(now[key]) && now[key] >= cursors[key],
                () => `${key} cursor went from ${cursors[key]} to ${now[key]}`,
            );
            cursors[key] = now[key];
        });
        need(counts.quads <= counts.clears, () => 'more four-line clears than clears');

        // ── The wings ──
        const wing = u.wing.value;
        if (!(world.wing >= 0 && world.wing <= 1)) fault(`wing ${world.wing}`);
        if (wing.x !== world.wing) fault(`the shaders' wing ${wing.x} is not the world's ${world.wing}`);
        const fallAge = t - world.fallStart;
        if (fallAge >= 0 && fallAge < WING_FALL) {
            need(world.wing === world.fallFrom, () => `falling wings changed from ${world.fallFrom} to ${world.wing}`);
            need(Math.abs(wing.z - fallAge / WING_FALL) <= 1e-9, () => `fall ${wing.z} at ${fallAge} s`);
        } else if (wing.z !== 0) fault(`fall ${wing.z} with nothing falling`);
        // (A chain may run while the old wings fall: its own wait, and `wing` stays the old ones'.)
        const eyes = u.eyes.value;
        for (const [name, v] of [['hind eye', eyes.x], ['fore eye', eyes.y], ['radiance', eyes.z]]) {
            if (!(v >= 0 && v <= 1)) fault(`${name} ${v}`);
        }

        // ── What the evening is told ──
        for (const key of ['breath', 'power', 'crack', 'wake', 'night']) {
            need(u[key].value >= 0 && u[key].value <= 1, () => `${key} ${u[key].value}`);
        }
        const gains = [['surge', u.surge.value], ['aurora', u.aurora.value], ['fed', u.fed.value.w], ['flash', wing.w]];
        for (const [name, v] of gains) need(v >= 0 && v < 10, () => `${name} ${v}`);
        need(
            u.combo.value === world.combo && Number.isInteger(world.combo) && world.combo >= 0,
            () => `combo ${world.combo}`,
        );

        // ── Live flags against the slots' own ages ──
        const ages = (slots, component) => slots.map((slot) => t - slot.value.getComponent(component));
        const flags = [
            ['rings', u.ringsLive.value, ages(u.ringA, 2), RING_LIVE, RING_LIVE],
            ['swell', u.swellLive.value, ages(u.swellA, 0), SWELL_LIVE, SWELL_LIVE],
            ['pulses', u.pulsesLive.value, ages(u.pulseA, 0), PULSE_TRAVEL * 1.6, 30],
        ];
        for (const [name, flag, list, shown, dead] of flags) {
            need(flag === 0 || flag === 1, () => `${name} flag ${flag}`);
            // Anything the shader would draw must be announced; with every slot spent the loop is skipped.
            const running = list.some((age) => age >= 0 && age < shown);
            need(!running || flag === 1, () => `${name} running with the flag down`);
            need(!list.every((age) => age >= dead) || flag === 0, () => `${name} flag up with every slot spent`);
        }

        // ── Finite, everywhere ──
        for (const [name, v] of sharedNumbers(world)) {
            if (!Number.isFinite(v)) fault(`${name} is ${v}`);
        }
        const post = world.getPostState();
        for (const key of ['flash', 'kick', 'shafts', 'bloomBoost', 'exposure']) {
            if (!(Number.isFinite(post[key]) && post[key] >= 0)) fault(`post.${key} is ${post[key]}`);
        }
        if (!(post.exposure > 0 && post.exposure <= 1)) fault(`post.exposure ${post.exposure}`);
        if (!(post.prism.radius >= 0 && post.prism.strength >= 0 && post.prism.strength <= 1)) {
            fault(`post.prism ${post.prism.radius} / ${post.prism.strength}`);
        }
        if (!(post.heart.x >= -0.5 && post.heart.x <= 1.5 && post.heart.y >= -0.5 && post.heart.y <= 1.5)) {
            fault(`heart at ${post.heart.x}, ${post.heart.y}`);
        }
        if (![...camera.matrixWorld.elements, camera.fov].every(Number.isFinite)) fault('the camera is not finite');
        if (!(camera.fov > 10 && camera.fov <= REST_RIG.maxFov)) fault(`lens ${camera.fov}`);
        for (const v of [world.drift, world.beat, world.storm, world.kick, world.flash]) {
            if (!Number.isFinite(v)) fault(`a clock or a decay is ${v}`);
        }
        if (stats.frames % 40 === 0) {
            for (const name of ['aBirth', 'aMotion', 'aLook']) {
                const { array } = world.dust.geometry.getAttribute(name);
                for (let i = 0; i < array.length; i++) {
                    if (!Number.isFinite(array[i])) {
                        fault(`dust ${name}[${i}] is ${array[i]}`);
                        break;
                    }
                }
            }
            const state = world.getState();
            const text = JSON.stringify(state);
            need(JSON.stringify(JSON.parse(text)) === text, () => 'getState is not plain data');
            need(state.held >= 0 && state.held <= BLOOM_FULL * blooms.count + 1e-9, () => `held ${state.held}`);
        }
    };

    /** What eases toward a target frame by frame. */
    const eased = () => [world.wing, world.breath, world.crack, world.eyeHind, world.eyeFore, world.power];

    const step = (delta, pointer = null) => {
        time += delta;
        const sim = {
            time, delta, pointerX: pointer ? pointer[0] : 0, pointerY: pointer ? pointer[1] : 0,
        };
        const before = eased();
        world.updateCamera(camera, sim);
        world.update(sim, camera);
        stats.frames += 1;
        // A frame of no time moves nothing that eases, whatever was asked of the world before it.
        if (delta === 0) {
            const after = eased();
            need(after.every((v, i) => v === before[i]), () => `a frame of no time moved ${before} to ${after}`);
        }
        audit();
    };

    /** What a lock asks of the counts and the pools: a hard drop sends three moths and writes two rings. */
    const tallyLock = (hardDrop) => {
        asked.locks += 1;
        asked.moths += hardDrop ? 3 : 1;
        written.moths += hardDrop ? 3 : 1;
        written.rings += hardDrop ? 2 : 1;
        written.pulses += 1;
        lastEvent = time;
    };
    /** What a clear asks: a swell, and for four lines (or a perfect clear) a ring under the chrysalis. */
    const tallyClear = (quad) => {
        asked.clears += 1;
        written.swells += 1;
        written.rings += quad ? 1 : 0;
        lastEvent = time;
    };

    const lock = () => {
        const hardDrop = rand() < 0.3;
        const top = Math.floor(rand() * 18);
        const rows = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, i) => Math.min(19, top + i));
        const r = rand();
        let u = rand();
        if (r < 0.05) u = 0.5;
        else if (r < 0.08) u = pick([-0.4, 0, 1, 1.7]);
        const detail = {
            u,
            rows: rand() < 0.05 ? [] : rows,
            hardDrop,
            color: rand() < 0.1 ? pick(JUNK_COLOURS) : pick(COLOURS),
            player: Math.floor(rand() * 5),
            screen: rand() < 0.03 ? { x: rand(), y: rand() } : null,
        };
        world.onLock(detail);
        tallyLock(hardDrop);
        stats.locks += 1;
        note = hardDrop ? 'a hard drop' : 'a lock';
    };
    const clear = () => {
        const r = rand();
        let lines = 1;
        if (r > 0.5) lines = 2;
        if (r > 0.75) lines = 3;
        if (r > 0.88) lines = 4;
        const perfect = rand() < 0.04;
        world.onClear({
            lines,
            rows: rand() < 0.3 ? null : Array.from({ length: lines }, (_, i) => 19 - i),
            tspin: rand() < 0.12,
            perfect,
            player: Math.floor(rand() * 5),
            screen: rand() < 0.03 ? { x: rand(), y: rand() } : null,
        });
        tallyClear(lines === 4 || perfect);
        stats.clears += 1;
        if (lines === 4 || perfect) stats.quads += 1;
        note = `a clear of ${lines}${perfect ? ' (perfect)' : ''}`;
    };
    /** Whether wings are falling as the world's clock stands. */
    const fallingNow = () => world.time - world.fallStart >= 0 && world.time - world.fallStart < WING_FALL;
    const chain = (n) => {
        const before = world.combo;
        const count = Math.max(0, Math.round(Number(n) || 0));
        // Wings that stand fall when the chain drops (to nothing, or to a shorter one); wings
        // already falling are not dropped again; a longer chain rings the silk. (How much wing
        // counts as standing is the world's to tune: wings well open must fall, none at all cannot.)
        const lower = count < before && !fallingNow();
        const start = world.fallStart;
        const { falls } = world.counts;
        const { wing } = world;
        world.onCombo(n);
        if (world.combo !== count) fault(`a chain of ${String(n)} left the combo at ${world.combo}`);
        const drops = world.fallStart !== start;
        need(!(lower && wing > 0.2) || drops, () => `a chain of ${before} -> ${count} left wings at ${wing} standing`);
        need(!drops || (lower && wing > 0), () => `a chain of ${before} -> ${count} dropped wings at ${wing}`);
        const told = `a chain of ${before} -> ${count}`;
        need(world.counts.falls - falls === (drops ? 1 : 0), () => `${told} miscounted its fall`);
        need(world.wing === wing, () => `${told} moved the wings from ${wing} to ${world.wing}`);
        if (drops) {
            stats.falls += 1;
            if (count > 0) stats.fallsToShorter += 1;
            need(world.fallStart === world.time && world.fallFrom === wing, () => 'a fall that starts elsewhere');
        }
        if (count > before) {
            written.pulses += 1;
            if (fallingNow()) stats.stepsWhileFalling += 1;
        }
        lastEvent = time; // the scales of new or falling wings are still to appear
        note = `a chain of ${String(n)}`;
    };
    const newRun = (gameOver) => {
        const before = {
            levels: world.blooms.plan.map((_, i) => world.blooms.levelAt(i, world.time)),
            cursors: [world.moths.cursor, world.ringCursor, world.swellCursor, world.pulseCursor],
            level: world.level,
            wing: world.wing,
            drift: world.drift,
        };
        const chained = world.combo > 0 && !fallingNow();
        const start = world.fallStart;
        if (gameOver) world.onGameOver();
        world.resetSession();
        newCounts();
        const drops = world.fallStart !== start;
        if (chained && before.wing > 0.2 && !drops) fault('a new run left the wings of its chain standing');
        if (drops && !(chained && before.wing > 0)) fault('a new run dropped wings that were not standing');
        if (drops) stats.falls += 1;
        // The soft reset: the chain is over and nothing more will land, but nothing on screen jumps.
        const after = {
            levels: world.blooms.plan.map((_, i) => world.blooms.levelAt(i, world.time)),
            cursors: [world.moths.cursor, world.ringCursor, world.swellCursor, world.pulseCursor],
            level: world.level,
            wing: world.wing,
            drift: world.drift,
        };
        if (JSON.stringify(after) !== JSON.stringify(before)) fault('a new run moved something on screen');
        if (world.time !== time) fault('a new run moved the clock');
        if (world.combo !== 0 || world.blooms.pending.length) fault('a new run kept its chain or something on its way');
        if (Object.values(world.counts).some((count) => count !== 0)) fault('a new run kept its counts');
        const waiting = [world.pendingKick.time, world.pendingFed.time];
        if (waiting.some((when) => when !== Infinity)) fault('a new run kept a kick or a feed');
        stats.newRuns += 1;
        note = gameOver ? 'a game over' : 'a new run';
    };

    while (stats.events < events) {
        const r = rand();
        let burst = 0;
        if (r > 0.5) burst = 1;
        if (r > 0.9) burst = 2 + Math.floor(rand() * 4);
        for (let k = 0; k < burst; k++) {
            stats.events += 1;
            const e = rand();
            if (e < 0.5) {
                lock();
                // A piece that clears lengthens the chain; one that does not breaks it.
                if (rand() < 0.35) {
                    clear();
                    chain(world.combo + 1);
                } else if (world.combo > 0 && rand() < 0.8) chain(0);
            } else if (e < 0.58) clear();
            else if (e < 0.66) chain(Math.floor(rand() * 14)); // the longest chain on any board: it can jump either way
            else if (e < 0.7) {
                world.levelUp(1 + Math.floor(rand() * 30), { silent: rand() < 0.2 });
                note = 'a new level';
            } else if (e < 0.72) newRun(false);
            else if (e < 0.74) newRun(true);
            else if (e < 0.745) {
                time = Math.floor(rand() * 300);
                world.seek(time);
                forget();
                lastEvent = -Infinity;
                note = 'a seek';
            } else if (e < 0.79) {
                world.setLayout(someLayout(rand, width, height), width / height);
                note = 'a layout change';
            } else if (e < 0.82) {
                [width, height] = pick(FRAMES);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                world.setViewport(width, height, width / height);
                if (rand() < 0.5) world.setLayout(someLayout(rand, width, height), width / height);
                note = `a resize to ${width}x${height}`;
            } else if (e < 0.85) {
                world.setReducedMotion(rand() < 0.5);
                note = 'a reduced-motion switch';
            } else if (e < 0.86) {
                world.bindCamera(camera);
                world.showOnlyParts(rand() < 0.5 ? VESPER_PARTS : ['sky', 'lake', 'wings', 'blooms']);
                note = 'a rebind';
            } else if (e < 0.9) {
                // What a careless caller might send: every one of these is one the world says it reads.
                const bareLock = (detail) => {
                    world.onLock(detail);
                    tallyLock(false);
                };
                const bareClear = (detail) => {
                    world.onClear(detail);
                    tallyClear(false);
                };
                const junk = pick([
                    () => bareLock(),
                    () => bareLock({ color: {}, rows: [] }),
                    () => bareClear(),
                    () => bareClear({ lines: 'four', rows: 'all' }),
                    () => bareLock({ u: NaN, rows: [NaN, Infinity] }),
                    () => bareLock({ u: Infinity, rows: ['x'] }),
                    () => chain('3'),
                    () => chain(NaN),
                    () => chain(-2),
                    () => chain(2.6),
                    () => world.levelUp('x'),
                    () => world.levelUp(),
                    () => world.setViewport(0, 0, NaN),
                    () => world.setLayout(undefined),
                ]);
                junk();
                lastEvent = time;
                note = `${note} and a careless call`;
            } else {
                // A run of locks as fast as a frame can hold.
                const run = 2 + Math.floor(rand() * 6);
                for (let i = 0; i < run; i++) lock();
            }
        }
        // ── The frame ──
        const f = rand();
        const pointer = rand() < 0.3 ? [rand() * 2 - 1, rand() * 2 - 1] : null;
        if (f < 0.08) {
            stats.zeroFrames += 1;
            step(0, pointer);
        } else if (f < 0.72) step(1 / 60, pointer);
        else if (f < 0.9) step(0.002 + rand() * 0.1, pointer);
        else if (f < 0.97) step(0.2 + rand() * 1.8, pointer);
        else {
            stats.stalls += 1;
            step(3 + rand() * 45, pointer);
        }
    }

    // ── And then nothing: everything on its way arrives, and the evening comes to rest ──
    note = 'the last event';
    for (let i = 0; i < 40; i++) step(horizon / 20);
    if (world.blooms.pending.length) fault(`${world.blooms.pending.length} changes never arrived`);
    world.onCombo(0);
    for (let i = 0; i < 200; i++) step((BLOOM_HOLD * 14) / 200);
    const flags = [world.u.ringsLive.value, world.u.swellLive.value, world.u.pulsesLive.value];
    if (flags.some((flag) => flag !== 0)) fault(`live flags ${flags} at rest`);
    if (world.wing !== 0) fault(`wings ${world.wing} at rest`);
    if (world.getState().held > 1e-3) fault(`the lake still holds ${world.getState().held} at rest`);
    if (Math.abs(world.u.breath.value - 1) > 1e-6) fault(`breath ${world.u.breath.value} at rest`);
    const post = world.getPostState();
    if (post.flash > 1e-6 || post.kick > 1e-6 || post.prism.strength !== 0 || Math.abs(post.exposure - 1) > 1e-4) {
        fault(`the post is not at rest: ${JSON.stringify(post)}`);
    }
    world.dispose();
    return { faults, stats };
}

describe('vesper world: random play', () => {
    const runs = [
        [0x1001, 'Minimal'], [0x2002, 'Low'], [0x3003, 'Medium'], [0x4004, 'High'], [0x5005, 'Ultra'],
        [0x6006, 'Extreme'], [0x7007, 'Low'], [0x8008, 'High'],
    ];

    it.each(runs)('keeps every invariant through 2500 random events (seed %i, %s)', (seed, quality) => {
        const { faults, stats } = play(seed, { events: 2500, quality });
        // VESPER_FUZZ_STATS=1 prints each run's tallies (what was played, what the pools' reuse cost).
        if (process.env.VESPER_FUZZ_STATS) console.log(`seed ${seed} ${quality}: ${JSON.stringify(stats)}`);
        expect(faults).toEqual([]);
        // The run was a run: it did what it set out to do.
        expect(stats.events).toBeGreaterThanOrEqual(2500);
        expect(stats.locks).toBeGreaterThan(800);
        expect(stats.clears).toBeGreaterThan(200);
        expect(stats.quads).toBeGreaterThan(10);
        expect(stats.falls).toBeGreaterThan(10);
        expect(stats.fallsToShorter).toBeGreaterThan(3); // a chain that broke into a new one
        expect(stats.stepsWhileFalling).toBeGreaterThan(3); // new wings that had to wait
        expect(stats.newRuns).toBeGreaterThan(20);
        expect(stats.zeroFrames).toBeGreaterThan(20);
        expect(stats.stalls).toBeGreaterThan(5);
        expect(stats.mostPending).toBeGreaterThan(3);
    });

    it('covers every tier the theme offers', () => {
        expect([...new Set(runs.map(([, quality]) => quality))].sort()).toEqual([...QUALITY_NAMES].sort());
    });

    it('plays the same game from the same seed', () => {
        const a = play(0x9009, { events: 400, quality: 'Low' });
        const b = play(0x9009, { events: 400, quality: 'Low' });
        expect(a.faults).toEqual([]);
        expect(b.stats).toEqual(a.stats);
    });
});

describe('vesper world: what one malformed event can do', () => {
    /** A small world on a desktop frame with the solo board up. */
    function small() {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(fovForAspect(16 / 9), 16 / 9, REST_RIG.near, REST_RIG.far);
        const world = new VesperWorld({ scene, quality: 'Minimal', capture: true }).build();
        world.bindCamera(camera);
        world.setViewport(1600, 900, 16 / 9);
        world.setLayout(fallbackLayout(1600, 900), 16 / 9);
        world.seek(10);
        const step = (seconds, frames = Math.max(1, Math.round(seconds * 60))) => {
            const t0 = world.time;
            for (let i = 1; i <= frames; i++) {
                const sim = { time: t0 + (seconds * i) / frames, delta: seconds / frames };
                world.updateCamera(camera, sim);
                world.update(sim, camera);
            }
        };
        step(0, 1);
        return { world, step };
    }

    // A row that is not a number, left as it is, puts NaN in the moth's start, its flight and its
    // landing time. A strike with such a time can never come due, and the lilies' list is worked
    // off in order: everything listed after it — every later lock, every clear — would wait
    // behind it for ever, and the lake never light again until the next reset. The director never
    // sends such a row; the world replaces one all the same, and the list takes no change whose
    // time is not a number.
    it('does not let one lock with a row or a column that is not a number stop the lilies for good', () => {
        const malformed = [
            { rows: [NaN] }, { rows: [Infinity] }, { rows: ['x'] }, { u: NaN }, { u: -Infinity, rows: [NaN] },
        ];
        for (const bad of malformed) {
            const { world, step } = small();
            const sent = [];
            const { launch } = world.moths;
            world.moths.launch = (moth) => {
                sent.push(moth);
                return launch(moth);
            };
            world.onLock({ u: 0.2, rows: [12], ...bad });
            // The moth is sent, from a real place on the card at a real moment, as for a piece on the floor.
            expect(sent).toHaveLength(1);
            expect([...sent[0].from, ...sent[0].to, sent[0].time, sent[0].flight].every(Number.isFinite)).toBe(true);
            expect(world.blooms.pending.every((e) => Number.isFinite(e.at))).toBe(true);
            step(0.5);
            world.onLock({ u: 0.8, rows: [12] });
            world.onLock({ u: 0.2, rows: [12], hardDrop: true });
            step(6);
            expect(world.blooms.pending).toEqual([]);
            expect(world.getState().held).toBeGreaterThan(0);
            expect(world.counts).toMatchObject({ locks: 3, moths: 5 });
            for (const [name, v] of sharedNumbers(world)) expect(Number.isFinite(v), name).toBe(true);
            for (const name of ['aBirth', 'aMotion', 'aLook']) {
                const scales = Array.from(world.dust.geometry.getAttribute(name).array);
                expect(scales.every(Number.isFinite), name).toBe(true);
            }
            world.dispose();
        }
    });

    it('takes no change into the lilies\' list that could never come due, and no moth from nowhere', () => {
        const { world, step } = small();
        const { blooms } = world;
        blooms.strike(0, [1, 1, 1], NaN, 0.9);
        blooms.strike(0, [1, 1, 1], Infinity, 0.9);
        blooms.release(0, NaN, 3);
        blooms.release(0, -Infinity, 3);
        expect(blooms.pending).toEqual([]);
        // A moth whose start is not a place is not sent: no slot, no ring, no scales, no count.
        const cursors = [world.moths.cursor, world.ringCursor, world.dust.cursor];
        expect(world.sendMoth(1, [NaN, 4, -15], [1, 1, 1], 0.9)).toBe(world.time);
        expect(world.sendMoth(1, [0, Infinity, -15], [1, 1, 1], 0.9)).toBe(world.time);
        expect([world.moths.cursor, world.ringCursor, world.dust.cursor]).toEqual(cursors);
        expect(world.counts.moths).toBe(0);
        expect(blooms.pending).toEqual([]);
        // The list still works: a real moth lands.
        const landed = world.sendMoth(1, [0, 4, -15], [1, 1, 1], 0.9);
        step(landed - world.time + 1);
        expect(blooms.levelAt(1, world.time)).toBeGreaterThan(0);
        world.dispose();
    });

    it('takes columns off the board, no rows, unknown players and junk colours in its stride', () => {
        const { world, step } = small();
        const calls = [
            { u: -3, rows: [5] }, { u: 9, rows: [5] }, { u: 0.3, rows: [] }, { u: 0.3, rows: [40] },
            { u: 0.3, rows: [-7] }, { u: 0.3, rows: [3], player: 99 }, { u: 0.3, rows: [3], player: -1 },
            { u: 0.3, rows: [3], color: {} }, { u: 0.3, rows: [3], color: '#zzzzzz' }, { u: 0.3, rows: null },
            { u: 0.3, rows: 'x' },
        ];
        for (const detail of calls) {
            world.onLock(detail);
            world.onClear({ lines: 1, rows: detail.rows, player: detail.player });
        }
        step(6);
        expect(world.blooms.pending).toEqual([]);
        expect(world.counts.locks).toBe(calls.length);
        expect(world.getState().held).toBeGreaterThan(0);
        for (const [name, v] of sharedNumbers(world)) expect(Number.isFinite(v), name).toBe(true);
        world.dispose();
    });
});
