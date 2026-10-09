/**
 * Verdant Hills — turning the director's cues into wind you can see.
 *
 * VerdantHillsReactions speaks in board terms ("left edge, two thirds up, strength 0.6,
 * the poppy kite"). VerdantHillsFxDirector knows where the board stands over the hill
 * (VerdantHillsStage) and what the ribbons, the seed simulation and the grass can do, and
 * translates: it draws ribbons of wind away from the card's edge, throws seed and chaff
 * out from behind it, lays down the short-lived force fields that carry them, winds the
 * whirl a combo builds around the board, starts the gusts that spread through the grass,
 * sends the front down the valley, and steers the pool of sunlight that crosses the hills
 * when the clouds open.
 */
import * as THREE from 'three/webgpu';
import { VERDANT_HILLS_CHAFF } from './verdant-hills-seeds.js';
import { VERDANT_HILLS_PARTICLES } from './verdant-hills-seed-sim.js';
import { VERDANT_HILLS_STAGE_DEPTH } from './verdant-hills-stage.js';
import { VERDANT_HILLS_KITE_COLOURS } from './verdant-hills-tetrominos.js';

const REFERENCE_SEEDS = 2400;
const CLEAR_WINDOW = 0.5;
const RISE_WINDOW = 1.5;
const SEED_WINDOW = 0.3;
const LEAF_WINDOW = 1.2;
/** How far above the ground seed is released, in metres: over the heads of the grass. */
const GRASS_TOPS = 0.75;
/** Where the valley's front starts (behind the lens) and how far down the wind it runs, metres. */
const FRONT_START = -45;
const FRONT_REACH = 1500;
/**
 * The pool of sunlight crosses the valley from left to right: the bearings (radians from the
 * lens's gaze) it enters and leaves at, the half-width of the stretch the board hides, and
 * how far out it runs (metres, start and end).
 */
const POOL_BEARINGS = Object.freeze([-0.66, 0.66, 0.19]);
const POOL_RANGE = Object.freeze([820, 1250]);
const { chaff: CHAFF, seed: SEED, pollen: POLLEN } = VERDANT_HILLS_PARTICLES;
const PETALS = [VERDANT_HILLS_CHAFF.buttercup, VERDANT_HILLS_CHAFF.daisy, VERDANT_HILLS_CHAFF.daisy,
    VERDANT_HILLS_CHAFF.buttercup, VERDANT_HILLS_CHAFF.clover];
const GRASSES = [VERDANT_HILLS_CHAFF.straw, VERDANT_HILLS_CHAFF.blade];
const LEAVES = [VERDANT_HILLS_CHAFF.oakLeaf, VERDANT_HILLS_CHAFF.oakLeafPale];
const WHITE = new THREE.Color(1, 0.99, 0.94);
const GOLD = new THREE.Color(1, 0.93, 0.7);
const KITE_TONES = VERDANT_HILLS_KITE_COLOURS.map((hex) => new THREE.Color(hex));
const UP = new THREE.Vector3(0, 1, 0);

export class VerdantHillsFxDirector {
    constructor({
        stage, sim, ribbons, waves, tier, rng = Math.random, groundHeight = () => -1e6, oak = null,
    }) {
        this.stage = stage;
        this.sim = sim;
        this.ribbons = ribbons;
        this.waves = waves;
        this.rng = rng;
        this.groundHeight = groundHeight;
        /** Where leaves are torn from when the great gust comes: the oak's crown ({ x, y, z, radius }). */
        this.oak = oak;
        this.scale = Math.max(0.2, tier.seeds / REFERENCE_SEEDS);
        this.fields = [];
        this.serials = new Map();
        this.emitted = new Map();
        this.waveSerial = -1;
        this.streakSerial = -1;
        this.epoch = null;
        this.whirlFeed = 0;
        this.whirlClock = 0;
        this.whirlTurn = 0;
        this.idleClock = 2.5;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        this.heading = new THREE.Vector3();
        this.axis = new THREE.Vector3();
        this.windward = new THREE.Vector3(0.5, 0, -0.866);
        this.front = { along: 0, width: 26, strength: 0 };
        this.pool = {
            x: 0, z: 0, radius: 420, strength: 0,
        };
        this.env = {
            windX: 0.5,
            windZ: -0.866,
            wind: 0.34,
            gust: 0,
            glow: 0,
            heat: 0,
            settled: false,
            front: null,
            pool: null,
            fields: this.fields,
        };
    }

    /**
     * Drop what is in flight. Which emitters, ribbons and gusts have already been played is
     * kept: it is forgotten only when the reactions themselves start over (see `follow`),
     * so a reset here never replays what is still queued there.
     */
    reset() {
        this.fields.length = 0;
        this.whirlFeed = 0;
        this.whirlClock = 0;
        this.idleClock = 2.5;
    }

    /** Start counting afresh when the reactions have been reset. */
    follow(epoch) {
        if (epoch === this.epoch) return;
        this.epoch = epoch;
        this.serials.clear();
        this.emitted.clear();
        this.waveSerial = -1;
        this.streakSerial = -1;
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    }

    pick(list) {
        return list[Math.floor(this.random() * list.length) % list.length];
    }

    /**
     * A spawn height kept clear of the grass: most pieces lock and most lines clear at the
     * foot of the board, and seed released down among the blades would never be seen.
     */
    above(x, y, z, clearance = GRASS_TOPS) {
        return Math.max(y, this.groundHeight(x, z) + clearance);
    }

    /** How many particles an emitter may release this frame to stay on its schedule. */
    due(emitter, total, window) {
        const target = total * Math.min(1, emitter.age / window);
        const done = this.emitted.get(emitter.id) || 0;
        const count = Math.max(0, Math.floor(target - done));
        this.emitted.set(emitter.id, done + count);
        return count;
    }

    /** The grass at the foot of the board, under a column of it. */
    meadowAt(column, target) {
        const screen = this.stage.screen(column, 0);
        return this.stage.ground(screen.x, Math.min(0.985, screen.y + 0.03), this.groundHeight, target);
    }

    // -- ribbons ------------------------------------------------------------------------
    /** A heading out from the board: sideways, a little up, and off down the wind. */
    outward(side, rise, downwind) {
        const { stage } = this;
        return this.heading.copy(stage.right).multiplyScalar(side)
            .addScaledVector(UP, rise)
            .addScaledVector(this.windward, downwind)
            .normalize();
    }

    lockRibbon(streak) {
        const { stage, ribbons } = this;
        const side = streak.side || (streak.column < 0.5 ? -1 : 1);
        const origin = stage.edge(side, streak.row, VERDANT_HILLS_STAGE_DEPTH, this.point, 0.012);
        origin.y = this.above(origin.x, origin.y, origin.z, 0.5);
        const tone = streak.kite >= 0 ? KITE_TONES[streak.kite % KITE_TONES.length] : WHITE;
        ribbons.launch({
            origin,
            heading: this.outward(side, 0.1 + this.random() * 0.14, 0.42),
            colour: tone,
            length: 3 + streak.strength * 2.4,
            speed: 8 + streak.strength * 6,
            life: 1.25 + streak.strength * 0.3,
            width: 0.04 + streak.strength * 0.025,
            strength: 0.75 + streak.strength * 0.25,
            loops: 1,
            loopRadius: 0.34 + streak.strength * 0.22,
            loopAt: 1.3 + this.random() * 0.7,
            lift: 0.05,
            wobble: 0.1,
            phase: this.random() * 6.28,
        });
    }

    clearRibbons(streak) {
        const { stage, ribbons } = this;
        const lines = Math.max(1, Math.min(3, streak.lines || 1));
        const sides = streak.side ? [streak.side] : [-1, 1];
        for (const side of sides) {
            for (let line = 0; line < lines; line += 1) {
                // One ribbon to a cleared row, stacked upward from the lowest.
                const row = Math.min(1, streak.row + (line - (lines - 1) / 2) * 0.05);
                const origin = stage.edge(side, row, VERDANT_HILLS_STAGE_DEPTH + line * 0.5, this.point, 0.02);
                origin.y = this.above(origin.x, origin.y, origin.z, 0.5);
                ribbons.launch({
                    origin,
                    heading: this.outward(side, 0.04 + this.random() * 0.16, 0.3 + this.random() * 0.15),
                    colour: WHITE,
                    length: 5.5 + lines * 1.3 + this.random() * 1.5,
                    speed: 13 + lines * 2 + this.random() * 3,
                    life: 1.6 + lines * 0.1,
                    width: 0.042 + streak.strength * 0.02,
                    strength: 1,
                    loops: 1,
                    loopRadius: 0.5 + this.random() * 0.3,
                    loopAt: 2.4 + this.random() * 1.6,
                    lift: 0.03 + this.random() * 0.05,
                    wobble: 0.14,
                    phase: this.random() * 6.28,
                });
            }
        }
    }

    /** The great gust: long ribbons laid across the whole view, behind the board. */
    greatRibbons(streak) {
        const { stage, ribbons } = this;
        const count = streak.strength >= 0.95 ? 3 : 2;
        for (let i = 0; i < count; i += 1) {
            const depth = 11 + i * 5 + this.random() * 3;
            const origin = stage.point(-0.08, 0.2 + 0.5 * this.random(), depth, this.point);
            origin.y = this.above(origin.x, origin.y, origin.z, 1.2);
            ribbons.launch({
                origin,
                heading: this.outward(1, 0.02 + this.random() * 0.05, 0.22),
                colour: i % 2 === 0 ? WHITE : GOLD,
                length: 15 + this.random() * 7,
                speed: 23 + this.random() * 6,
                life: 2.5,
                width: 0.06 + depth * 0.0035,
                strength: 0.7 + streak.strength * 0.3,
                loops: 1 + (i % 2),
                loopRadius: 1.1 + this.random() * 0.9,
                loopAt: stage.halfWidth(depth) * (0.5 + this.random() * 0.9),
                lift: 0.02,
                wobble: 0.3,
                phase: this.random() * 6.28,
            });
        }
    }

    /** A T-spin: a tight spiral of wind beside the board, climbing as it turns. */
    spinRibbon(streak) {
        const { stage, ribbons } = this;
        const side = streak.side || 1;
        const origin = stage.edge(side, streak.row, VERDANT_HILLS_STAGE_DEPTH, this.point, 0.01);
        origin.addScaledVector(stage.right, side * 1.5);
        origin.y = this.above(origin.x, origin.y - 0.6, origin.z, 0.5);
        const tone = streak.kite >= 0 ? KITE_TONES[streak.kite % KITE_TONES.length] : WHITE;
        for (let twin = 0; twin < 2; twin += 1) {
            ribbons.launch({
                origin,
                heading: this.heading.copy(stage.right).multiplyScalar(twin === 0 ? side : -side).normalize(),
                colour: twin === 0 ? tone : WHITE,
                length: 6.5,
                speed: 10,
                life: 1.9,
                width: 0.06,
                strength: 1,
                loops: 3,
                loopRadius: 0.62,
                loopAt: 0.05,
                lift: 0.2,
                wobble: 0.02,
                axis: this.axis.copy(stage.forward),
                phase: twin * 3.1,
            });
        }
    }

    /** The kite festival: a ribbon in each kite's colour, fanned upward from behind the board. */
    festivalRibbons() {
        const { stage, ribbons } = this;
        const centre = stage.centre(VERDANT_HILLS_STAGE_DEPTH + 1.5, this.foot);
        KITE_TONES.forEach((tone, slot) => {
            const fan = (slot / (KITE_TONES.length - 1)) * 2 - 1;
            const origin = this.point.copy(centre).addScaledVector(stage.right, fan * 1.2);
            origin.y = this.above(origin.x, origin.y - 1, origin.z, 0.8);
            ribbons.launch({
                origin,
                heading: this.heading.copy(stage.right).multiplyScalar(fan * 1.5)
                    .addScaledVector(UP, 1.1 - Math.abs(fan) * 0.5)
                    .addScaledVector(this.windward, 0.25)
                    .normalize(),
                colour: tone,
                length: 4.6,
                speed: 9 + this.random() * 3,
                life: 2.3,
                width: 0.06,
                strength: 1,
                loops: 1 + (slot % 2),
                loopRadius: 0.5 + this.random() * 0.25,
                loopAt: 1.2 + this.random() * 1.6,
                lift: 0.02,
                wobble: 0.55,
                axis: this.axis.copy(stage.right).multiplyScalar(fan >= 0 ? 1 : -1),
                phase: slot,
            });
        });
    }

    /** One turn of the whirl: a ribbon that circles the board once and climbs as it goes. */
    whirlRibbon(level, coloured) {
        const { stage, ribbons } = this;
        const centre = stage.centre(VERDANT_HILLS_STAGE_DEPTH, this.foot);
        const radius = 2.7 + 0.7 * level;
        this.whirlTurn += 1;
        const angle = this.whirlTurn * 2.399;
        // A point on the circle around the board, and the way round it from there.
        const out = this.axis.copy(stage.right).multiplyScalar(Math.cos(angle))
            .addScaledVector(stage.forward, Math.sin(angle));
        const origin = this.point.copy(centre).addScaledVector(out, radius);
        origin.y = this.above(origin.x, centre.y - 2.4 + 2.2 * level + this.random() * 1.6, origin.z, 0.6);
        // The way the whirl turns its seed (see the vortex field in `apply`): the ribbon runs with it.
        const tangent = this.heading.copy(stage.right).multiplyScalar(Math.sin(angle))
            .addScaledVector(stage.forward, -Math.cos(angle));
        ribbons.launch({
            origin,
            heading: tangent,
            colour: coloured || this.whirlTurn % 2 === 0 ? KITE_TONES[this.whirlTurn % KITE_TONES.length] : WHITE,
            length: 5 + level * 3,
            speed: 9 + level * 7,
            life: 1.5,
            width: 0.055 + level * 0.025,
            strength: 0.8 + level * 0.2,
            loops: 1.1,
            loopRadius: radius,
            loopAt: 0,
            lift: 0.1 + level * 0.1,
            wobble: 0.05,
            axis: out.multiplyScalar(-1),
            phase: angle,
        });
    }

    /** Now and then the breeze shows itself: one faint ribbon drifting over the hill. */
    idleRibbon(wind) {
        const { stage, ribbons } = this;
        const left = this.random() < 0.5;
        const depth = 12 + this.random() * 22;
        const across = left ? 0.02 + this.random() * 0.25 : 0.7 + this.random() * 0.2;
        const origin = stage.point(across, 0.3 + this.random() * 0.3, depth, this.point);
        origin.y = this.above(origin.x, origin.y, origin.z, 1.5);
        ribbons.launch({
            origin,
            heading: this.heading.copy(this.windward).addScaledVector(stage.right, left ? 0.5 : 0.2)
                .addScaledVector(UP, 0.04)
                .normalize(),
            colour: WHITE,
            length: 7 + this.random() * 5,
            speed: 7 + wind * 8,
            life: 2.6,
            width: 0.07 + depth * 0.004,
            strength: 0.42,
            loops: 1,
            loopRadius: 0.8 + this.random() * 0.8,
            loopAt: 5 + this.random() * 5,
            lift: 0.03,
            wobble: 0.3,
            phase: this.random() * 6.28,
        });
    }

    // -- seed and chaff -----------------------------------------------------------------
    lock(emitter, fresh) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const edge = stage.edge(side, emitter.row, VERDANT_HILLS_STAGE_DEPTH, this.point, 0.012);
        if (fresh) {
            const count = Math.round((26 + 44 * strength) * this.scale);
            for (let i = 0; i < count; i += 1) {
                const speed = (1.6 + 3.6 * this.random()) * (0.6 + strength);
                const x = edge.x + side * this.random() * 0.3;
                const z = edge.z + (this.random() - 0.5) * 1.2;
                const seed = this.random() < 0.6;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.9, z),
                    z,
                    side * speed,
                    1.8 + 3 * this.random(),
                    (this.random() - 0.5) * 2.6,
                    {
                        life: 2.4 + 1.8 * this.random(),
                        kind: seed ? SEED : CHAFF,
                        tint: this.pick(GRASSES),
                        size: seed ? 0.05 + 0.035 * this.random() : 0.05 + 0.035 * this.random(),
                    },
                );
            }
        }
        if (emitter.age < 0.25) {
            this.fields.push({
                kind: 'burst',
                x: edge.x - side * 0.4,
                // Where the seed is: lifted clear of the hill with it.
                y: this.above(edge.x, edge.y, edge.z) - 0.3,
                z: edge.z,
                radius: 4,
                power: 16 * strength + 4,
                up: 5,
            });
        }
    }

    /** A hard drop shakes the dandelion clocks: seed lifts off the grass where the piece came down. */
    seeds(emitter) {
        const { sim } = this;
        const spot = this.meadowAt(emitter.column, this.foot);
        const count = this.due(emitter, (40 + 60 * emitter.strength) * this.scale, SEED_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const spread = 0.5 + 2.6 * this.random();
            const x = spot.x + Math.cos(angle) * spread;
            const z = spot.z + Math.sin(angle) * spread * 0.7;
            sim.spawn(
                x,
                this.above(x, -1e6, z, 0.4) + 0.5 * this.random(),
                z,
                Math.cos(angle) * spread * 0.8,
                (1.8 + 3.4 * this.random()) * (0.6 + 0.6 * emitter.strength),
                Math.sin(angle) * spread * 0.8,
                { life: 3.4 + 3 * this.random(), kind: SEED, size: 0.05 + 0.035 * this.random() },
            );
        }
    }

    clear(emitter) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const lines = Math.max(1, emitter.lines);
        const edge = stage.edge(side, emitter.row, VERDANT_HILLS_STAGE_DEPTH, this.point, 0.02);
        const count = this.due(emitter, (24 + 28 * lines) * this.scale, CLEAR_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const speed = (4.5 + 7.5 * this.random()) * (0.7 + 0.5 * strength);
            const z = edge.z + (this.random() - 0.5) * 1.6;
            const roll = this.random();
            let kind = CHAFF;
            if (roll < 0.34) kind = SEED;
            else if (roll < 0.44) kind = POLLEN;
            sim.spawn(
                edge.x,
                this.above(edge.x, edge.y + (this.random() - 0.5) * (0.7 + 0.5 * lines), z),
                z,
                side * speed,
                1.4 + 3.2 * this.random(),
                (this.random() - 0.5) * 4,
                {
                    life: 2.4 + 2.2 * this.random(),
                    kind,
                    tint: this.random() < 0.6 ? this.pick(PETALS) : this.pick(GRASSES),
                    size: 0.042 + 0.032 * this.random(),
                },
            );
        }
        if (emitter.age < 0.75) {
            this.fields.push({
                kind: 'jet',
                x: edge.x + side * 1.5,
                y: this.above(edge.x, edge.y, edge.z),
                z: edge.z,
                dx: side,
                dy: 0.16,
                dz: 0,
                radius: 5.4,
                power: 16 * strength,
            });
        }
    }

    /** The hill breathes out: seed and petals lift off the grass all around the board, leaves off the oak. */
    rise(emitter) {
        const { stage, sim, oak } = this;
        const count = this.due(emitter, 420 * this.scale * emitter.strength, RISE_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const spot = stage.ground(this.random(), 0.6 + 0.39 * this.random(), this.groundHeight, this.foot);
            if (stage.reach < 40) {
                const seed = this.random() < 0.55;
                sim.spawn(
                    spot.x,
                    spot.y + 0.3 + 0.5 * this.random(),
                    spot.z,
                    (this.random() - 0.5) * 1.2,
                    1.6 + 3.6 * this.random(),
                    (this.random() - 0.5) * 1.2,
                    {
                        life: 2.8 + 2.6 * this.random(),
                        kind: seed ? SEED : CHAFF,
                        tint: this.pick(PETALS),
                        size: 0.04 + 0.03 * this.random(),
                    },
                );
            }
        }
        if (!oak) return;
        const torn = { id: `leaf${emitter.id}`, age: emitter.age };
        const leaves = this.due(torn, 150 * this.scale * emitter.strength, LEAF_WINDOW);
        for (let i = 0; i < leaves; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const reach = Math.sqrt(this.random()) * oak.radius;
            sim.spawn(
                oak.x + Math.cos(angle) * reach,
                oak.y + (this.random() - 0.35) * oak.radius * 0.6,
                oak.z + Math.sin(angle) * reach,
                this.windward.x * (4 + 5 * this.random()) + (this.random() - 0.5) * 2,
                0.5 + 2.4 * this.random(),
                this.windward.z * (4 + 5 * this.random()) + (this.random() - 0.5) * 2,
                {
                    life: 3 + 3 * this.random(),
                    kind: CHAFF,
                    tint: this.pick(LEAVES),
                    size: 0.11 + 0.08 * this.random(),
                },
            );
        }
    }

    /** Throw seed and petals into the whirl around the board. */
    ring(count, energy) {
        const { stage, sim } = this;
        const centre = stage.centre(VERDANT_HILLS_STAGE_DEPTH, this.point);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const radius = 2.8 + this.random();
            const speed = (1.2 + 1.8 * energy) * radius * (0.85 + 0.3 * this.random());
            const x = centre.x + Math.cos(angle) * radius;
            const z = centre.z + Math.sin(angle) * radius;
            const seed = this.random() < 0.5;
            sim.spawn(
                x,
                this.above(x, centre.y - 1.6 + this.random() * 2.4, z),
                z,
                -Math.sin(angle) * speed,
                0.3 + this.random(),
                Math.cos(angle) * speed,
                {
                    life: 2.4 + 2.4 * this.random(),
                    kind: seed ? SEED : CHAFF,
                    tint: this.pick(PETALS),
                    size: 0.055 + 0.04 * this.random(),
                },
            );
        }
    }

    spin(emitter, fresh) {
        const { stage, sim } = this;
        const { side } = emitter;
        const edge = stage.edge(side, emitter.row, VERDANT_HILLS_STAGE_DEPTH, this.point, 0.01);
        const x = edge.x + side * 2;
        if (fresh) {
            const count = Math.round(46 * this.scale);
            for (let i = 0; i < count; i += 1) {
                const angle = i * 0.7;
                const speed = 3 + 0.1 * i;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.6, edge.z),
                    edge.z,
                    Math.cos(angle) * speed * 0.8 + side * 2,
                    Math.sin(angle) * speed * 0.6 + 1.5,
                    Math.sin(angle) * 1.5,
                    {
                        life: 2 + 1.6 * this.random(),
                        kind: i % 3 === 0 ? SEED : CHAFF,
                        tint: VERDANT_HILLS_CHAFF.buttercup,
                        size: 0.06 + 0.03 * this.random(),
                    },
                );
            }
        }
        if (emitter.age < 1.1) {
            this.fields.push({
                kind: 'vortex',
                x,
                z: edge.z,
                radius: 1.2,
                reach: 3.4,
                top: this.above(x, edge.y, edge.z) + 0.6,
                spin: 4.4,
                turn: side,
                grip: 3,
                pull: 12,
                lift: 2.4,
            });
        }
    }

    /**
     * Apply one director frame. `wind` is {x, z, strength} from the light rig; returns the
     * environment for VerdantHillsSeedSim.step(), with the valley's front and the pool of
     * sunlight in world terms for the light rig.
     */
    apply(frame = {}, dt = 0, wind = { x: 0.5, z: -0.866, strength: 0.34 }) {
        const { fields, stage, waves } = this;
        fields.length = 0;
        this.follow(frame.epoch);
        this.windward.set(wind.x, 0, wind.z).normalize();
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const emitters = frame.emitters || [];
        for (let i = 0; i < emitters.length; i += 1) {
            const emitter = emitters[i];
            const fresh = this.serials.get(emitter.id) !== emitter.serial;
            if (fresh) {
                this.serials.set(emitter.id, emitter.serial);
                this.emitted.set(emitter.id, 0);
                this.emitted.set(`leaf${emitter.id}`, 0);
            }
            if (emitter.kind === 'lock') this.lock(emitter, fresh);
            else if (emitter.kind === 'seeds') this.seeds(emitter);
            else if (emitter.kind === 'clear') this.clear(emitter);
            else if (emitter.kind === 'rise' || emitter.kind === 'festival') this.rise(emitter);
            else if (emitter.kind === 'spin') this.spin(emitter, fresh);
            else if (emitter.kind === 'combo' && fresh) {
                this.ring(Math.round((20 + 56 * emitter.strength) * this.scale), emitter.strength);
            }
        }
        // Gusts and ribbons the director asked for, oldest first: each queue is a ring
        // buffer, so its slots are not in order, and a pool keeps whatever is added last.
        const play = (queue, last, start) => {
            let serial = last;
            const list = queue || [];
            for (let pass = 0; pass < list.length; pass += 1) {
                let next = null;
                for (let i = 0; i < list.length; i += 1) {
                    const item = list[i];
                    if (item.serial > serial && (!next || item.serial < next.serial)) next = item;
                }
                if (!next) break;
                ({ serial } = next);
                if (next.strength > 0) start(next);
            }
            return serial;
        };
        this.waveSerial = play(frame.waves, this.waveSerial, (wave) => {
            const spot = this.meadowAt(wave.column, this.foot);
            waves?.add(spot.x, spot.z, wave.strength);
        });
        this.streakSerial = play(frame.streaks, this.streakSerial, (streak) => {
            if (!this.ribbons) return;
            if (streak.kind === 'lock') this.lockRibbon(streak);
            else if (streak.kind === 'clear') this.clearRibbons(streak);
            else if (streak.kind === 'great') this.greatRibbons(streak);
            else if (streak.kind === 'spin') this.spinRibbon(streak);
            else if (streak.kind === 'festival') this.festivalRibbons();
        });
        const whirl = Number.isFinite(frame.whirl) ? Math.max(0, Math.min(1, frame.whirl)) : 0;
        if (whirl > 0.03) {
            const centre = stage.centre(VERDANT_HILLS_STAGE_DEPTH, this.point);
            fields.push({
                kind: 'vortex',
                x: centre.x,
                z: centre.z,
                radius: 2.9 + 0.7 * whirl,
                reach: 8,
                // The whirl rides up the board as the combo builds.
                top: centre.y - 1.1 + 2.3 * whirl,
                // Radians a second: a slow wheel that quickens as the combo builds.
                spin: 1.1 + 1.7 * whirl,
                turn: 1,
                grip: 3,
                pull: 9,
                lift: 2.6,
            });
            // Keep the whirl fed while it turns.
            this.whirlFeed += step * (22 + 70 * whirl) * this.scale;
            const feed = Math.floor(this.whirlFeed);
            if (feed > 0) {
                this.whirlFeed -= feed;
                this.ring(feed, whirl);
            }
            // And draw it: a ribbon every half-turn, coloured once the streamers unfurl.
            this.whirlClock -= step;
            if (this.whirlClock <= 0 && this.ribbons) {
                this.whirlClock = 0.46 - 0.28 * whirl;
                this.whirlRibbon(whirl, (frame.streamers || 0) > 0.15);
            }
        } else {
            this.whirlFeed = 0;
            this.whirlClock = 0;
        }
        const { env } = this;
        env.windX = this.windward.x;
        env.windZ = this.windward.z;
        env.wind = Number.isFinite(wind.strength) ? wind.strength : 0.34;
        env.gust = Number.isFinite(frame.gust) ? Math.max(0, Math.min(1, frame.gust)) : 0;
        env.glow = Number.isFinite(frame.glow) ? frame.glow : 0;
        env.heat = Number.isFinite(frame.heat) ? frame.heat : 0;
        env.settled = frame.settled === true;
        // The breeze showing itself while nothing else does.
        this.idleClock -= step;
        if (this.idleClock <= 0 && this.ribbons) {
            this.idleClock = 4.5 + this.random() * 5 - env.wind * 2;
            if (!env.settled && this.ribbons.active() < 3) this.idleRibbon(env.wind);
        }
        if (frame.front && frame.front.strength > 0.001) {
            // Slow over the hill at the lens, then away down the valley faster than the eye follows.
            const travel = Math.max(0, Math.min(1, (frame.front.position + 1.4) / 2.8));
            this.front.along = FRONT_START + FRONT_REACH * travel ** 2.2;
            this.front.width = 6 + Math.max(0, this.front.along) * 0.16;
            this.front.strength = frame.front.strength;
            env.front = this.front;
        } else env.front = null;
        if (frame.sunbreak && frame.sunbreak.strength > 0.001) {
            const travel = Math.max(0, Math.min(1, frame.sunbreak.progress));
            // It lingers over the hills either side of the board and hurries behind it.
            const [from, to, hidden] = POOL_BEARINGS;
            let bearing;
            if (travel < 0.42) bearing = from + (-hidden - from) * (travel / 0.42);
            else if (travel < 0.58) bearing = -hidden + 2 * hidden * ((travel - 0.42) / 0.16);
            else bearing = hidden + (to - hidden) * ((travel - 0.58) / 0.42);
            const range = POOL_RANGE[0] + (POOL_RANGE[1] - POOL_RANGE[0]) * travel;
            this.pool.x = stage.origin.x + Math.sin(bearing) * range;
            this.pool.z = stage.origin.z - Math.cos(bearing) * range;
            this.pool.radius = 190 + 80 * travel;
            this.pool.strength = frame.sunbreak.strength;
            env.pool = this.pool;
        } else env.pool = null;
        return env;
    }
}
