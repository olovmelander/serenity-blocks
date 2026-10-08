/**
 * Summer — turning the director's cues into petals, rings and wind.
 *
 * SummerReactions speaks in board terms ("left edge, two thirds up, strength 0.6, poppy").
 * SummerFxDirector knows where the board stands over the meadow and the lake (SummerStage)
 * and what the petal simulation, the lake and the meadow can do, and translates: it throws
 * petals out from behind the card, lays down the short-lived force fields that carry them,
 * feeds the flower crown a combo winds around the board, starts the gusts that spread
 * through the grass, and drops rings on the water — where a piece landed, where a petal
 * came down, and now and then where a fish rose.
 */
import * as THREE from 'three/webgpu';
import { SUMMER_PARTICLES } from './summer-petal-sim.js';
import { SUMMER_STAGE_DEPTH } from './summer-stage.js';

const REFERENCE_PETALS = 2400;
const CLEAR_WINDOW = 0.5;
const RISE_WINDOW = 1.5;
const SEED_WINDOW = 0.3;
const BOUQUET_WINDOW = 0.7;
const FLOWER_KINDS = 7;
/** Where a lake ring opens: metres out from the near shore for the foot of the board, and for its top. */
const RING_NEAR = 1.5;
const RING_REACH = 26;
/** How far above the ground petals are released, in metres: over the heads of the meadow. */
const FLOWER_TOPS = 1.15;
const { petal: PETAL, seed: SEED, pollen: POLLEN } = SUMMER_PARTICLES;

export class SummerFxDirector {
    constructor({
        stage, sim, ripples, waves, tier, rng = Math.random, groundHeight = () => -1, maypole = null,
    }) {
        this.stage = stage;
        this.sim = sim;
        this.ripples = ripples;
        this.waves = waves;
        this.rng = rng;
        this.groundHeight = groundHeight;
        /** Where the bouquet is thrown from: the top of the maypole and its two wreaths. */
        this.maypole = maypole;
        this.scale = Math.max(0.2, tier.petals / REFERENCE_PETALS);
        this.fields = [];
        this.serials = new Map();
        this.emitted = new Map();
        this.ringSerial = -1;
        this.waveSerial = -1;
        this.epoch = null;
        this.crownFeed = 0;
        this.crownTurn = 0;
        this.thrown = 0;
        this.fishClock = 3;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        this.front = {
            x: 0, width: 20, strength: 0, direction: 1,
        };
        this.env = {
            windX: 1, windZ: 0, wind: 0.3, gust: 0, glow: 0, heat: 0, settled: false, front: null, fields: this.fields,
        };
    }

    /**
     * Drop what is in flight. Which emitters, rings and gusts have already been played is
     * kept: it is forgotten only when the reactions themselves start over (see `follow`),
     * so a reset here never replays what is still queued there.
     */
    reset() {
        this.fields.length = 0;
        this.crownFeed = 0;
        this.fishClock = 3;
    }

    /** Start counting afresh when the reactions have been reset. */
    follow(epoch) {
        if (epoch === this.epoch) return;
        this.epoch = epoch;
        this.serials.clear();
        this.emitted.clear();
        this.ringSerial = -1;
        this.waveSerial = -1;
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    }

    /**
     * A spawn height kept clear of the water and of the flowers: most pieces lock and most
     * lines clear at the foot of the board, and petals released down among the stems would
     * never be seen.
     */
    above(x, y, z, clearance = FLOWER_TOPS) {
        return Math.max(y, Math.max(0, this.groundHeight(x, z)) + clearance);
    }

    /** How many particles an emitter may release this frame to stay on its schedule. */
    due(emitter, total, window) {
        const target = total * Math.min(1, emitter.age / window);
        const done = this.emitted.get(emitter.id) || 0;
        const count = Math.max(0, Math.floor(target - done));
        this.emitted.set(emitter.id, done + count);
        return count;
    }

    /**
     * The lake behind a place on the board: the column gives the bearing, the row how far
     * out from the near shore the ring opens (a piece that lands low lands near).
     */
    waterAt(column, row, target) {
        const screen = this.stage.screen(column, row);
        return this.stage.lake(screen.x, RING_NEAR + row * RING_REACH, this.groundHeight, target);
    }

    /** The meadow at the foot of the board, under a column of it. */
    meadowAt(column, target) {
        const screen = this.stage.screen(column, 0);
        return this.stage.ground(screen.x, Math.min(0.985, screen.y + 0.03), this.groundHeight, target);
    }

    lock(emitter, fresh) {
        const { stage, sim } = this;
        const { side, strength, flower } = emitter;
        const edge = stage.edge(side, emitter.row, SUMMER_STAGE_DEPTH, this.point, 0.012);
        if (fresh) {
            const count = Math.round((34 + 56 * strength) * this.scale);
            for (let i = 0; i < count; i += 1) {
                const speed = (1.6 + 3.6 * this.random()) * (0.6 + strength);
                const x = edge.x + side * this.random() * 0.3;
                const z = edge.z + (this.random() - 0.5) * 1.2;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.9, z),
                    z,
                    side * speed,
                    2.2 + 3.2 * this.random(),
                    (this.random() - 0.5) * 2.6,
                    {
                        life: 2.4 + 1.8 * this.random(), kind: PETAL, flower, size: 0.09 + 0.06 * this.random(),
                    },
                );
            }
            const motes = Math.round((8 + 14 * strength) * this.scale);
            for (let i = 0; i < motes; i += 1) {
                sim.spawn(
                    edge.x,
                    this.above(edge.x, edge.y + (this.random() - 0.5) * 0.6, edge.z),
                    edge.z,
                    side * (1 + 2.5 * this.random()),
                    0.6 + 2 * this.random(),
                    (this.random() - 0.5) * 2,
                    { life: 1.1 + this.random(), kind: POLLEN, size: 0.05 + 0.03 * this.random() },
                );
            }
        }
        if (emitter.age < 0.25) {
            this.fields.push({
                kind: 'burst',
                x: edge.x - side * 0.4,
                y: edge.y - 0.3,
                z: edge.z,
                radius: 4,
                power: 18 * strength + 5,
                up: 6,
            });
        }
    }

    /** A hard drop shakes the dandelion clocks: seed lifts off the meadow where the piece came down. */
    seeds(emitter) {
        const { sim } = this;
        const spot = this.meadowAt(emitter.column, this.foot);
        const count = this.due(emitter, (34 + 52 * emitter.strength) * this.scale, SEED_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const spread = 0.5 + 2.4 * this.random();
            const x = spot.x + Math.cos(angle) * spread;
            const z = spot.z + Math.sin(angle) * spread * 0.7;
            sim.spawn(
                x,
                this.above(x, 0, z, 0.4) + 0.5 * this.random(),
                z,
                Math.cos(angle) * spread * 0.8,
                (1.8 + 3.4 * this.random()) * (0.6 + 0.6 * emitter.strength),
                Math.sin(angle) * spread * 0.8,
                { life: 3.4 + 3 * this.random(), kind: SEED, size: 0.045 + 0.03 * this.random() },
            );
        }
    }

    clear(emitter) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const lines = Math.max(1, emitter.lines);
        const edge = stage.edge(side, emitter.row, SUMMER_STAGE_DEPTH, this.point, 0.02);
        const count = this.due(emitter, (26 + 30 * lines) * this.scale, CLEAR_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const speed = (4.5 + 7.5 * this.random()) * (0.7 + 0.5 * strength);
            const z = edge.z + (this.random() - 0.5) * 1.6;
            sim.spawn(
                edge.x,
                this.above(edge.x, edge.y + (this.random() - 0.5) * (0.7 + 0.5 * lines), z),
                z,
                side * speed,
                1.6 + 3.4 * this.random(),
                (this.random() - 0.5) * 4,
                {
                    life: 2.4 + 2.2 * this.random(),
                    kind: this.random() < 0.14 ? POLLEN : PETAL,
                    flower: emitter.flower,
                    size: 0.055 + 0.04 * this.random(),
                },
            );
        }
        if (emitter.age < 0.75) {
            this.fields.push({
                kind: 'jet',
                x: edge.x + side * 1.5,
                y: edge.y,
                z: edge.z,
                dx: side,
                dy: 0.16,
                dz: 0,
                radius: 5.4,
                power: 16 * strength,
            });
        }
    }

    /** The meadow breathes out: petals and seed lift off the grass all around the board. */
    rise(emitter) {
        const { stage, sim } = this;
        const count = this.due(emitter, 440 * this.scale * emitter.strength, RISE_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const spot = stage.ground(this.random(), 0.55 + 0.44 * this.random(), this.groundHeight, this.foot);
            const floor = this.groundHeight(spot.x, spot.z);
            if (floor > 0.1) {
                const seed = this.random() < 0.3;
                sim.spawn(
                    spot.x,
                    floor + 0.3 + 0.5 * this.random(),
                    spot.z,
                    (this.random() - 0.5) * 1.2,
                    1.6 + 3.6 * this.random(),
                    (this.random() - 0.5) * 1.2,
                    {
                        life: 2.8 + 2.6 * this.random(), kind: seed ? SEED : PETAL, size: 0.05 + 0.04 * this.random(),
                    },
                );
            }
        }
    }

    /** Seven kinds picked: the maypole throws the bouquet into the evening. */
    bouquet(emitter) {
        const { sim, maypole } = this;
        if (!maypole) return;
        const count = this.due(emitter, 300 * this.scale * emitter.strength, BOUQUET_WINDOW);
        for (let i = 0; i < count; i += 1) {
            // Counted across frames, not within one: however few petals a frame throws, the
            // burst as a whole carries all seven kinds from the top and both wreaths.
            this.thrown += 1;
            const turn = this.thrown;
            const from = turn % 3 === 0 ? maypole.top : maypole.wreaths[turn % 2];
            const angle = this.random() * Math.PI * 2;
            const tilt = this.random() * 1.2 - 0.25;
            const speed = 2.4 + 5.6 * this.random();
            sim.spawn(
                from.x + (this.random() - 0.5) * 0.5,
                from.y + (this.random() - 0.5) * 0.5,
                from.z + (this.random() - 0.5) * 0.5,
                Math.cos(angle) * Math.cos(tilt) * speed,
                Math.sin(tilt) * speed + 2.2,
                Math.sin(angle) * Math.cos(tilt) * speed,
                {
                    life: 3 + 2.6 * this.random(),
                    kind: this.random() < 0.12 ? POLLEN : PETAL,
                    // One after another, so the burst carries all seven colours.
                    flower: turn % FLOWER_KINDS,
                    size: 0.07 + 0.05 * this.random(),
                },
            );
        }
        if (emitter.age < 0.5) {
            this.fields.push({
                kind: 'burst', x: maypole.top.x, y: maypole.top.y - 1.2, z: maypole.top.z, radius: 6, power: 14, up: 5,
            });
        }
    }

    /** Throw petals into the orbit around the board, each the next of the seven kinds. */
    ring(count, energy) {
        const { stage, sim } = this;
        const centre = stage.centre(SUMMER_STAGE_DEPTH, this.point);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const radius = 2.8 + this.random();
            const speed = (1.2 + 1.8 * energy) * radius * (0.85 + 0.3 * this.random());
            const x = centre.x + Math.cos(angle) * radius;
            const z = centre.z + Math.sin(angle) * radius;
            this.crownTurn = (this.crownTurn + 1) % FLOWER_KINDS;
            sim.spawn(
                x,
                this.above(x, centre.y - 1.6 + this.random() * 2.4, z),
                z,
                -Math.sin(angle) * speed,
                0.3 + this.random(),
                Math.cos(angle) * speed,
                {
                    life: 2.4 + 2.4 * this.random(),
                    kind: this.random() < 0.12 ? POLLEN : PETAL,
                    flower: this.crownTurn,
                    size: 0.06 + 0.04 * this.random(),
                },
            );
        }
    }

    spin(emitter, fresh) {
        const { stage, sim } = this;
        const { side } = emitter;
        const edge = stage.edge(side, emitter.row, SUMMER_STAGE_DEPTH, this.point, 0.01);
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
                        kind: PETAL,
                        flower: emitter.flower,
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
                top: edge.y + 0.6,
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
     * environment for SummerPetalSim.step().
     */
    apply(frame = {}, dt = 0, wind = { x: 1, z: 0, strength: 0.3 }) {
        const {
            fields, stage, ripples, waves,
        } = this;
        fields.length = 0;
        this.follow(frame.epoch);
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const emitters = frame.emitters || [];
        for (let i = 0; i < emitters.length; i += 1) {
            const emitter = emitters[i];
            const fresh = this.serials.get(emitter.id) !== emitter.serial;
            if (fresh) {
                this.serials.set(emitter.id, emitter.serial);
                this.emitted.set(emitter.id, 0);
            }
            if (emitter.kind === 'lock') this.lock(emitter, fresh);
            else if (emitter.kind === 'seeds') this.seeds(emitter);
            else if (emitter.kind === 'clear') this.clear(emitter);
            else if (emitter.kind === 'rise') this.rise(emitter);
            else if (emitter.kind === 'bouquet') this.bouquet(emitter);
            else if (emitter.kind === 'spin') this.spin(emitter, fresh);
            else if (emitter.kind === 'combo' && fresh) {
                this.ring(Math.round((20 + 56 * emitter.strength) * this.scale), emitter.strength);
            }
        }
        // Rings and gusts the director asked for, oldest first: each queue is a ring buffer,
        // so its slots are not in order, and a pool keeps whatever is added last.
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
        this.ringSerial = play(frame.rings, this.ringSerial, (ring) => {
            const spot = this.waterAt(ring.column, ring.row, this.foot);
            ripples?.add(spot.x, spot.z, ring.strength);
        });
        this.waveSerial = play(frame.waves, this.waveSerial, (wave) => {
            const spot = this.meadowAt(wave.column, this.foot);
            waves?.add(spot.x, spot.z, wave.strength);
        });
        // Petals that came down on the water since the last frame.
        for (let i = 0; i < this.sim.touchCount; i += 1) {
            const touch = this.sim.touches[i];
            ripples?.add(touch.x, touch.z, touch.strength);
        }
        // Now and then a fish rises.
        this.fishClock -= step;
        if (this.fishClock <= 0 && frame.settled !== true) {
            this.fishClock = 4.5 + this.random() * 6;
            const spot = stage.water(0.06 + this.random() * 0.88, 0.5 + this.random() * 0.2, this.foot);
            if (this.groundHeight(spot.x, spot.z) < -0.4) ripples?.add(spot.x, spot.z, 0.3 + this.random() * 0.2);
        }
        const crown = Number.isFinite(frame.crown) ? Math.max(0, Math.min(1, frame.crown)) : 0;
        if (crown > 0.03) {
            const centre = stage.centre(SUMMER_STAGE_DEPTH, this.point);
            fields.push({
                kind: 'vortex',
                x: centre.x,
                z: centre.z,
                radius: 2.9 + 0.7 * crown,
                reach: 8,
                // The crown rides up the board as the combo builds.
                top: centre.y - 1.1 + 2.3 * crown,
                // Radians a second: a slow wheel that quickens as the combo builds.
                spin: 1.1 + 1.7 * crown,
                turn: 1,
                grip: 3,
                pull: 9,
                lift: 2.6,
            });
            // Keep the crown fed while it turns.
            this.crownFeed += step * (26 + 84 * crown) * this.scale;
            const feed = Math.floor(this.crownFeed);
            if (feed > 0) {
                this.crownFeed -= feed;
                this.ring(feed, crown);
            }
        } else this.crownFeed = 0;
        const { env } = this;
        env.windX = wind.x;
        env.windZ = wind.z;
        env.wind = Number.isFinite(wind.strength) ? wind.strength : 0.3;
        env.gust = Number.isFinite(frame.gust) ? Math.max(0, Math.min(1, frame.gust)) : 0;
        env.glow = Number.isFinite(frame.glow) ? frame.glow : 0;
        env.heat = Number.isFinite(frame.heat) ? frame.heat : 0;
        env.settled = frame.settled === true;
        if (frame.front && frame.front.strength > 0.001) {
            this.front.x = frame.front.position * stage.halfWidth(40);
            this.front.strength = frame.front.strength;
            this.front.direction = frame.front.direction;
            env.front = this.front;
        } else env.front = null;
        return env;
    }
}
