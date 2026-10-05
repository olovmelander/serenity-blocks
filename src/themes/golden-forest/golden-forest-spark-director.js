/**
 * Golden Forest — turning the director's cues into light on the lake.
 *
 * GoldenForestReactions speaks in board terms ("left edge, two thirds up, strength 0.6").
 * GoldenForestSparkDirector knows where the board stands over the water (GoldenForestStage)
 * and what the firefly simulation and the lake can do, and translates: it throws reserve
 * sparks out from behind the card, lays down the short-lived force fields that carry them,
 * feeds the river a combo winds around the board, and drops rings on the water — where a
 * piece landed, where a spark went out, and now and then where a fish rose.
 */
import * as THREE from 'three/webgpu';
import { GOLDEN_FOREST_STAGE_DEPTH } from './golden-forest-stage.js';

const REFERENCE_SPARKS = 2200;
const CLEAR_WINDOW = 0.5;
const RISE_WINDOW = 1.5;
const SPLASH_WINDOW = 0.22;

export class GoldenForestSparkDirector {
    constructor({
        stage, sim, ripples, tier, rng = Math.random, groundHeight = () => -1,
    }) {
        this.stage = stage;
        this.sim = sim;
        this.ripples = ripples;
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.scale = Math.max(0.2, tier.sparks / REFERENCE_SPARKS);
        this.fields = [];
        this.serials = new Map();
        this.emitted = new Map();
        this.ringSerial = -1;
        this.epoch = null;
        this.vortexFeed = 0;
        this.fishClock = 3;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        this.front = {
            x: 0, width: 22, strength: 0, direction: 1,
        };
        this.env = {
            windX: 1, windZ: 0, gust: 0, glow: 0, heat: 0, settled: false, front: null, fields: this.fields,
        };
    }

    /**
     * Drop what is in flight. Which emitters and rings have already been played is kept:
     * it is forgotten only when the reactions themselves start over (see `follow`), so a
     * reset here never replays what is still queued there.
     */
    reset() {
        this.fields.length = 0;
        this.vortexFeed = 0;
        this.fishClock = 3;
    }

    /** Start counting afresh when the reactions have been reset. */
    follow(epoch) {
        if (epoch === this.epoch) return;
        this.epoch = epoch;
        this.serials.clear();
        this.emitted.clear();
        this.ringSerial = -1;
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    }

    /** A spawn height kept clear of the water and the bank. */
    above(x, y, z) {
        return Math.max(y, Math.max(0, this.groundHeight(x, z)) + 0.15);
    }

    /** How many sparks an emitter may release this frame to stay on its schedule. */
    due(emitter, total, window) {
        const target = total * Math.min(1, emitter.age / window);
        const done = this.emitted.get(emitter.id) || 0;
        const count = Math.max(0, Math.floor(target - done));
        this.emitted.set(emitter.id, done + count);
        return count;
    }

    /** The water behind a place on the board. */
    waterAt(column, row, target) {
        const screen = this.stage.screen(column, row);
        return this.stage.water(screen.x, screen.y, target);
    }

    lock(emitter, fresh) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const edge = stage.edge(side, emitter.row, GOLDEN_FOREST_STAGE_DEPTH, this.point, 0.012);
        if (fresh) {
            const count = Math.round((10 + 26 * strength) * this.scale);
            for (let i = 0; i < count; i += 1) {
                const speed = (1.8 + 4.2 * this.random()) * (0.6 + strength);
                const x = edge.x + side * this.random() * 0.3;
                const z = edge.z + (this.random() - 0.5) * 1.2;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.9, z),
                    z,
                    side * speed,
                    0.4 + 2.6 * this.random(),
                    (this.random() - 0.5) * 2.6,
                    1.5 + 1.5 * this.random(),
                    0.15 * strength,
                    0.11 + 0.06 * this.random(),
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
                power: 20 * strength + 5,
                up: 5,
            });
        }
    }

    /** A hard drop throws light up off the water where the piece came down. */
    splash(emitter) {
        const { sim } = this;
        const spot = this.waterAt(emitter.column, emitter.row, this.foot);
        const count = this.due(emitter, (40 + 60 * emitter.strength) * this.scale, SPLASH_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const spread = 0.6 + 2.2 * this.random();
            sim.spawn(
                spot.x + Math.cos(angle) * 0.3,
                0.08,
                spot.z + Math.sin(angle) * 0.3,
                Math.cos(angle) * spread,
                (4 + 6 * this.random()) * (0.6 + 0.6 * emitter.strength),
                Math.sin(angle) * spread,
                1.2 + 1.2 * this.random(),
                0.5,
                0.1 + 0.06 * this.random(),
            );
        }
    }

    clear(emitter) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const lines = Math.max(1, emitter.lines);
        const edge = stage.edge(side, emitter.row, GOLDEN_FOREST_STAGE_DEPTH, this.point, 0.02);
        const count = this.due(emitter, (30 + 34 * lines) * this.scale, CLEAR_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const speed = (5 + 8 * this.random()) * (0.7 + 0.5 * strength);
            const z = edge.z + (this.random() - 0.5) * 1.6;
            sim.spawn(
                edge.x,
                this.above(edge.x, edge.y + (this.random() - 0.5) * (0.7 + 0.5 * lines), z),
                z,
                side * speed,
                -0.2 + 2.6 * this.random(),
                (this.random() - 0.5) * 4,
                1.8 + 1.8 * this.random(),
                0.2 + 0.15 * lines,
                0.11 + 0.07 * this.random(),
            );
        }
        if (emitter.age < 0.75) {
            this.fields.push({
                kind: 'jet',
                x: edge.x + side * 1.5,
                y: edge.y,
                z: edge.z,
                dx: side,
                dy: 0.12,
                dz: 0,
                radius: 5.4,
                power: 18 * strength,
            });
        }
    }

    /** The lake breathes out: sparks lift off the water all around the board. */
    rise(emitter) {
        const { stage, sim } = this;
        const count = this.due(emitter, 520 * this.scale * emitter.strength, RISE_WINDOW);
        const reach = stage.halfWidth(GOLDEN_FOREST_STAGE_DEPTH + 6);
        for (let i = 0; i < count; i += 1) {
            const sx = this.random();
            const spot = stage.water(sx, 0.6 + 0.4 * this.random(), this.foot);
            // Keep to open water within sight of the board.
            const x = Math.max(-reach, Math.min(reach, spot.x));
            const z = Math.min(stage.origin.z - 3, spot.z);
            if (this.groundHeight(x, z) < 0) {
                sim.spawn(
                    x,
                    0.08,
                    z,
                    (this.random() - 0.5) * 0.8,
                    1.4 + 3.4 * this.random(),
                    (this.random() - 0.5) * 0.8,
                    2.6 + 2.4 * this.random(),
                    0.3 + 0.5 * this.random(),
                    0.11 + 0.07 * this.random(),
                );
            }
        }
    }

    /** Throw a ring of sparks into the orbit around the board. */
    ring(count, energy) {
        const { stage, sim } = this;
        const centre = stage.centre(GOLDEN_FOREST_STAGE_DEPTH, this.point);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const radius = 2.7 + this.random();
            const speed = (1.2 + 1.8 * energy) * radius * (0.85 + 0.3 * this.random());
            const x = centre.x + Math.cos(angle) * radius;
            const z = centre.z + Math.sin(angle) * radius;
            sim.spawn(
                x,
                this.above(x, 0.3 + this.random() * 2.2, z),
                z,
                -Math.sin(angle) * speed,
                0.5 + this.random() * 1.2,
                Math.cos(angle) * speed,
                2.2 + 2.2 * this.random(),
                0.25 + 0.5 * energy,
                0.11 + 0.07 * this.random(),
            );
        }
    }

    spin(emitter, fresh) {
        const { stage, sim } = this;
        const { side } = emitter;
        const edge = stage.edge(side, emitter.row, GOLDEN_FOREST_STAGE_DEPTH, this.point, 0.01);
        const x = edge.x + side * 2;
        if (fresh) {
            const count = Math.round(44 * this.scale);
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
                    1.8 + 1.4 * this.random(),
                    0.6,
                    0.11 + 0.06 * this.random(),
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
                top: edge.y + 2.5,
                spin: 4.4,
                turn: side,
                grip: 3,
                pull: 12,
                lift: 2,
            });
        }
    }

    /**
     * Apply one director frame. `wind` is {x, z} from the light rig; returns the
     * environment for GoldenForestSparkSim.step().
     */
    apply(frame = {}, dt = 0, wind = { x: 1, z: 0 }) {
        const { fields, stage, ripples } = this;
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
            else if (emitter.kind === 'splash') this.splash(emitter);
            else if (emitter.kind === 'clear') this.clear(emitter);
            else if (emitter.kind === 'rise') this.rise(emitter);
            else if (emitter.kind === 'spin') this.spin(emitter, fresh);
            else if (emitter.kind === 'combo' && fresh) {
                this.ring(Math.round((20 + 60 * emitter.strength) * this.scale), emitter.strength);
            }
        }
        // Rings the director asked for, oldest first: the queue is a ring buffer, so its
        // slots are not in order, and the lake's pool keeps whatever is added last.
        const rings = frame.rings || [];
        for (let pass = 0; pass < rings.length; pass += 1) {
            let next = null;
            for (let i = 0; i < rings.length; i += 1) {
                const ring = rings[i];
                if (ring.serial > this.ringSerial && (!next || ring.serial < next.serial)) next = ring;
            }
            if (!next) break;
            this.ringSerial = next.serial;
            if (next.strength > 0) {
                const spot = this.waterAt(next.column, next.row, this.foot);
                ripples?.add(spot.x, spot.z, next.strength);
            }
        }
        // Sparks that went out on the water since the last frame.
        for (let i = 0; i < this.sim.touchCount; i += 1) {
            const touch = this.sim.touches[i];
            ripples?.add(touch.x, touch.z, touch.strength);
        }
        // Now and then a fish rises.
        this.fishClock -= step;
        if (this.fishClock <= 0 && frame.settled !== true) {
            this.fishClock = 4.5 + this.random() * 6;
            const spot = stage.water(0.06 + this.random() * 0.88, 0.62 + this.random() * 0.3, this.foot);
            if (this.groundHeight(spot.x, spot.z) < -0.4) ripples?.add(spot.x, spot.z, 0.3 + this.random() * 0.2);
        }
        const vortex = Number.isFinite(frame.vortex) ? Math.max(0, Math.min(1, frame.vortex)) : 0;
        if (vortex > 0.03) {
            const centre = stage.centre(GOLDEN_FOREST_STAGE_DEPTH, this.point);
            fields.push({
                kind: 'vortex',
                x: centre.x,
                z: centre.z,
                radius: 2.8 + 0.8 * vortex,
                reach: 8,
                top: 2.2 + 6.5 * vortex,
                // Radians a second: a slow wheel that quickens as the combo builds.
                spin: 1.2 + 1.8 * vortex,
                turn: 1,
                grip: 3,
                pull: 9,
                lift: 1 + 2 * vortex,
            });
            // Keep the river fed while it turns.
            this.vortexFeed += step * (30 + 90 * vortex) * this.scale;
            const feed = Math.floor(this.vortexFeed);
            if (feed > 0) {
                this.vortexFeed -= feed;
                this.ring(feed, vortex);
            }
        } else this.vortexFeed = 0;
        const { env } = this;
        env.windX = wind.x;
        env.windZ = wind.z;
        env.gust = Number.isFinite(frame.gust) ? Math.max(0, Math.min(1, frame.gust)) : 0;
        env.glow = Number.isFinite(frame.glow) ? frame.glow : 0;
        env.heat = Number.isFinite(frame.heat) ? frame.heat : 0;
        env.settled = frame.settled === true;
        if (frame.front && frame.front.strength > 0.001) {
            this.front.x = frame.front.position * stage.halfWidth(60);
            this.front.strength = frame.front.strength;
            this.front.direction = frame.front.direction;
            env.front = this.front;
        } else env.front = null;
        return env;
    }
}
