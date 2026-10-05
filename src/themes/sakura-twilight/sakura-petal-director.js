/**
 * Sakura Twilight — turning the director's emitters into things that happen.
 *
 * SakuraReactions speaks in board terms ("left edge, two thirds up, strength 0.6").
 * SakuraPetalDirector knows where the board stands in the garden (SakuraStage) and what
 * the garden can do, and translates: it throws reserve petals out from behind the card,
 * lays down the short-lived force fields that carry them, feeds the combo stream, drops
 * rings on the lake, sets lanterns afloat or aloft, sends shooting stars, and reports the
 * wind the petal simulation should feel this frame.
 */
import * as THREE from 'three/webgpu';
import { SAKURA_STAGE_DEPTH } from './sakura-stage.js';

const REFERENCE_PETALS = 6000;
const CLEAR_WINDOW = 0.5;
const SHOWER_WINDOW = 1.6;

export class SakuraPetalDirector {
    /**
     * `effects` are the garden's one-shot hooks, each optional:
     *   ring(x, z, strength), star(strength), floatLantern(x, z, vx, vz, power),
     *   skyLantern(x, y, z, delay)
     */
    constructor({
        stage, sim, tier, rng = Math.random, crownPoints = null, surface = () => 0, effects = {},
    }) {
        this.stage = stage;
        this.sim = sim;
        this.rng = rng;
        this.surface = surface;
        this.effects = effects;
        this.tier = tier;
        this.scale = Math.max(0.2, tier.petals / REFERENCE_PETALS);
        // Crowns close enough to the board for their falling petals to be seen.
        this.shedPoints = [];
        if (crownPoints) {
            for (let i = 0; i < crownPoints.length; i += 4) {
                if (Math.abs(crownPoints[i]) < 30 && crownPoints[i + 2] > -40) {
                    this.shedPoints.push(crownPoints[i], crownPoints[i + 1], crownPoints[i + 2]);
                }
            }
        }
        this.fields = [];
        this.serials = new Map();
        this.emitted = new Map();
        this.vortexFeed = 0;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        this.front = {
            x: 0, width: 9, strength: 0, direction: 1,
        };
        this.env = {
            windX: 1, windZ: 0, breeze: 0, gust: 0, front: null, fields: this.fields,
        };
    }

    reset() {
        this.serials.clear();
        this.emitted.clear();
        this.fields.length = 0;
        this.vortexFeed = 0;
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    }

    /** A spawn height kept clear of the ground: the lowest board rows sit below the knoll. */
    above(x, y, z) {
        return Math.max(y, this.surface(x, z) + 0.2);
    }

    /** How many petals an emitter may release this frame to stay on its schedule. */
    due(emitter, total, window) {
        const target = total * Math.min(1, emitter.age / window);
        const done = this.emitted.get(emitter.id) || 0;
        const count = Math.max(0, Math.floor(target - done));
        this.emitted.set(emitter.id, done + count);
        return count;
    }

    lock(emitter, fresh) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const edge = stage.edge(side, emitter.row, SAKURA_STAGE_DEPTH, this.point, 0.012);
        if (fresh) {
            const count = Math.round((24 + 64 * strength) * this.scale);
            for (let i = 0; i < count; i += 1) {
                const speed = (2.0 + 4.2 * this.random()) * (0.6 + strength);
                const x = edge.x + side * this.random() * 0.3;
                const z = edge.z + (this.random() - 0.5) * 1.2;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.9, z),
                    z,
                    side * speed,
                    0.5 + 2.6 * this.random(),
                    (this.random() - 0.5) * 3,
                    0.7 + 0.3 * strength,
                );
            }
            // The piece seems to fall through the card into the lake behind it.
            const drop = stage.lake(emitter.column, 24 + 10 * this.random(), this.foot);
            this.effects.ring?.(drop.x, drop.z, 0.45 + strength * 0.9);
        }
        if (emitter.age < 0.28) {
            this.fields.push({
                kind: 'burst', x: edge.x - side * 0.4, y: edge.y - 0.3, z: edge.z, radius: 4.2, power: 20 * strength + 5, up: 6,
            });
        }
        if (emitter.age < 0.2) {
            // The thump also lifts whatever lies on the grass beside the board.
            const foot = stage.edge(side, 0, SAKURA_STAGE_DEPTH, this.foot);
            const x = foot.x + side * 1.4;
            const z = foot.z - 1.5;
            this.fields.push({
                kind: 'burst', x, y: this.surface(x, z) - 0.3, z, radius: 3.6, power: 12 * strength + 4, up: 9,
            });
        }
    }

    clear(emitter, fresh) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const lines = Math.max(1, emitter.lines);
        const edge = stage.edge(side, emitter.row, SAKURA_STAGE_DEPTH, this.point, 0.02);
        const count = this.due(emitter, (46 + 54 * lines) * this.scale, CLEAR_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const speed = (4.5 + 7 * this.random()) * (0.7 + 0.5 * strength);
            const z = edge.z + (this.random() - 0.5) * 1.6;
            sim.spawn(
                edge.x,
                this.above(edge.x, edge.y + (this.random() - 0.5) * (0.7 + 0.5 * lines), z),
                z,
                side * speed,
                -0.3 + 2.8 * this.random(),
                (this.random() - 0.5) * 4.4,
                0.7 + 0.3 * strength,
            );
        }
        if (emitter.age < 0.75) {
            this.fields.push({
                kind: 'jet', x: edge.x + side * 1.5, y: edge.y, z: edge.z, dx: side, dy: 0.12, dz: 0, radius: 5.2, power: 18 * strength,
            });
        }
        if (fresh && side < 0) {
            // One ring for the whole clear, wide and bright, from the middle of the lake.
            const drop = stage.lake(0.5, 30, this.foot);
            this.effects.ring?.(drop.x, drop.z, 0.7 + lines * 0.22);
        }
    }

    /** Hanafubuki: the crowns let go all at once. */
    shower(emitter) {
        const { sim, shedPoints } = this;
        const count = this.due(emitter, 900 * this.scale * emitter.strength, SHOWER_WINDOW);
        for (let i = 0; i < count; i += 1) {
            let x = (this.random() * 2 - 1) * 20;
            let y = 7 + this.random() * 6;
            let z = 8 - this.random() * 30;
            if (shedPoints.length) {
                const pick = Math.floor(this.random() * (shedPoints.length / 3)) * 3;
                x = shedPoints[pick] + (this.random() - 0.5) * 2;
                y = shedPoints[pick + 1] - this.random() * 0.8;
                z = shedPoints[pick + 2] + (this.random() - 0.5) * 2;
            }
            sim.spawn(
                x,
                y,
                z,
                (this.random() - 0.5) * 2.4,
                -0.6 - 1.8 * this.random(),
                (this.random() - 0.5) * 2.4,
                0.35 + 0.4 * this.random(),
            );
        }
    }

    /** Throw a ring of petals into the orbit around the board. */
    ring(count, energy) {
        const { stage, sim } = this;
        const centre = stage.centre(SAKURA_STAGE_DEPTH, this.point);
        const floor = this.surface(centre.x, centre.z);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const radius = 2.6 + this.random();
            const speed = 3.6 + 3 * this.random() + energy * 3;
            sim.spawn(
                centre.x + Math.cos(angle) * radius,
                floor + 0.2 + this.random() * 2.4,
                centre.z + Math.sin(angle) * radius,
                -Math.sin(angle) * speed,
                0.4 + this.random() * 1.2,
                Math.cos(angle) * speed,
                0.6 + 0.4 * energy,
            );
        }
    }

    spin(emitter, fresh) {
        const { stage, sim } = this;
        const { side } = emitter;
        const edge = stage.edge(side, emitter.row, SAKURA_STAGE_DEPTH, this.point, 0.01);
        const x = edge.x + side * 2;
        if (fresh) {
            const count = Math.round(70 * this.scale);
            for (let i = 0; i < count; i += 1) {
                const angle = i * 0.7;
                const speed = 3 + 0.06 * i;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.6, edge.z),
                    edge.z,
                    Math.cos(angle) * speed * 0.8 + side * 2,
                    Math.sin(angle) * speed * 0.6 + 1.5,
                    Math.sin(angle) * 1.5,
                    0.95,
                );
            }
        }
        if (emitter.age < 1.1) {
            this.fields.push({
                kind: 'vortex', x, z: edge.z, radius: 1.2, reach: 2.6, top: edge.y + 2.5, spin: 7, turn: side, grip: 3, pull: 3, lift: 2,
            });
        }
    }

    /** The fallen petals around the board are breathed up off the grass and the water. */
    rise(emitter) {
        const centre = this.stage.centre(SAKURA_STAGE_DEPTH, this.point);
        if (emitter.age < 1.3) {
            this.fields.push({
                kind: 'lift', x: centre.x, z: centre.z - 6, radius: 26, top: this.surface(centre.x, centre.z) + 7, power: 6.5 * emitter.strength, swirl: 2.2,
            });
        }
    }

    /** Lanterns pushed out from the bank on either side of the board. */
    floats(emitter) {
        const { stage } = this;
        const count = Math.max(1, Math.round(emitter.lines));
        for (let i = 0; i < count; i += 1) {
            const side = (i + emitter.serial) % 2 === 0 ? -1 : 1;
            const shore = stage.lake(side < 0 ? -0.9 - this.random() : 1.9 + this.random(), 19 + this.random() * 7, this.foot);
            this.effects.floatLantern?.(
                shore.x,
                shore.z,
                -side * (0.04 + this.random() * 0.1),
                -0.16 - this.random() * 0.2,
                1 + emitter.strength * 0.5,
            );
        }
    }

    /** A flight of sky lanterns from the banks and the far shore, staggered over a few seconds. */
    lanterns(emitter) {
        const share = Math.max(3, Math.round(this.tier.skyLanterns * (0.25 + 0.75 * emitter.strength)));
        for (let i = 0; i < share; i += 1) {
            const near = this.random() < 0.45;
            const side = this.random() < 0.5 ? -1 : 1;
            const x = near ? side * (7 + this.random() * 20) : (this.random() * 2 - 1) * 110;
            const z = near ? -4 - this.random() * 34 : -60 - this.random() * 100;
            this.effects.skyLantern?.(x, Math.max(0, this.surface(x, z)) + 0.6 + this.random() * 0.8, z, this.random() * 4.5);
        }
    }

    /**
     * Apply one director frame. `wind` is {x, z, strength} from the light rig; returns the
     * environment for SakuraPetalSim.step().
     */
    apply(frame = {}, dt = 0, wind = { x: 1, z: 0, strength: 0.3 }) {
        const { fields, stage } = this;
        fields.length = 0;
        const emitters = frame.emitters || [];
        for (let i = 0; i < emitters.length; i += 1) {
            const emitter = emitters[i];
            const fresh = this.serials.get(emitter.id) !== emitter.serial;
            if (fresh) {
                this.serials.set(emitter.id, emitter.serial);
                this.emitted.set(emitter.id, 0);
            }
            if (emitter.kind === 'lock') this.lock(emitter, fresh);
            else if (emitter.kind === 'clear') this.clear(emitter, fresh);
            else if (emitter.kind === 'shower') this.shower(emitter);
            else if (emitter.kind === 'spin') this.spin(emitter, fresh);
            else if (emitter.kind === 'rise') this.rise(emitter);
            else if (emitter.kind === 'combo' && fresh) {
                this.ring(Math.round((30 + 90 * emitter.strength) * this.scale), emitter.strength);
            } else if (emitter.kind === 'star' && fresh) this.effects.star?.(emitter.strength);
            else if (emitter.kind === 'floats' && fresh) this.floats(emitter);
            else if (emitter.kind === 'lanterns' && fresh) this.lanterns(emitter);
        }
        const vortex = Number.isFinite(frame.vortex) ? Math.max(0, Math.min(1, frame.vortex)) : 0;
        if (vortex > 0.03) {
            const centre = stage.centre(SAKURA_STAGE_DEPTH, this.point);
            const floor = this.surface(centre.x, centre.z);
            fields.push({
                kind: 'vortex',
                x: centre.x,
                z: centre.z,
                radius: 2.7 + 0.8 * vortex,
                reach: 4.4 + vortex,
                top: floor + 2.4 + 7.5 * vortex,
                spin: 4.0 + 7.5 * vortex,
                turn: 1,
                grip: 2.4,
                pull: 2.6,
                lift: 1.2 + 2.6 * vortex,
            });
            // Keep the stream fed while it turns.
            this.vortexFeed += Math.max(0, dt) * (26 + 90 * vortex) * this.scale;
            const feed = Math.floor(this.vortexFeed);
            if (feed > 0) {
                this.vortexFeed -= feed;
                this.ring(feed, vortex);
            }
        } else this.vortexFeed = 0;
        const { env } = this;
        env.windX = wind.x;
        env.windZ = wind.z;
        env.breeze = 0.4 + wind.strength * 2.0;
        env.gust = (Number.isFinite(frame.gust) ? Math.max(0, Math.min(1, frame.gust)) : 0) * 4.5;
        // When the game ends the air goes still.
        const hush = Number.isFinite(frame.hush) ? Math.max(0, Math.min(1, frame.hush)) : 0;
        env.breeze *= 1 - hush * 0.85;
        if (frame.front && frame.front.strength > 0.001) {
            this.front.x = frame.front.position * stage.halfWidth(26);
            this.front.strength = frame.front.strength;
            this.front.direction = frame.front.direction;
            env.front = this.front;
        } else env.front = null;
        return env;
    }
}
