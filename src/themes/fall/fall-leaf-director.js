/**
 * Fall — turning the director's emitters into leaves.
 *
 * FallReactions speaks in board terms ("left edge, two thirds up, strength 0.6").
 * FallLeafDirector knows where the board stands in the forest (FallStage) and what the
 * leaf simulation can do, and translates: it throws reserve leaves out from behind the
 * card, lays down the short-lived force fields that carry them, feeds the combo vortex,
 * and reports the wind the simulation should feel this frame.
 */
import * as THREE from 'three/webgpu';
import { FALL_STAGE_DEPTH } from './fall-stage.js';

const REFERENCE_LEAVES = 2600;
const CLEAR_WINDOW = 0.5;
const SHOWER_WINDOW = 1.4;

export class FallLeafDirector {
    constructor({
        stage, sim, tier, rng = Math.random, crownPoints = null, groundHeight = () => 0,
    }) {
        this.stage = stage;
        this.sim = sim;
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.scale = Math.max(0.2, tier.leaves / REFERENCE_LEAVES);
        // Crowns close enough to the board for their falling leaves to be seen.
        this.shedPoints = [];
        if (crownPoints) {
            for (let i = 0; i < crownPoints.length; i += 4) {
                if (Math.abs(crownPoints[i]) < 26 && crownPoints[i + 2] > -34) {
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

    /** A spawn height kept clear of the forest floor: the lowest board rows sit at ground level. */
    above(x, y, z) {
        return Math.max(y, this.groundHeight(x, z) + 0.2);
    }

    /** How many leaves an emitter may release this frame to stay on its schedule. */
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
        const edge = stage.edge(side, emitter.row, FALL_STAGE_DEPTH, this.point, 0.012);
        if (fresh) {
            const count = Math.round((8 + 22 * strength) * this.scale);
            for (let i = 0; i < count; i += 1) {
                const speed = (2.4 + 4.6 * this.random()) * (0.6 + strength);
                const x = edge.x + side * this.random() * 0.3;
                const z = edge.z + (this.random() - 0.5) * 1.2;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.9, z),
                    z,
                    side * speed,
                    0.6 + 3 * this.random(),
                    (this.random() - 0.5) * 3,
                );
            }
        }
        if (emitter.age < 0.28) {
            this.fields.push({
                kind: 'burst', x: edge.x - side * 0.4, y: edge.y - 0.3, z: edge.z, radius: 4.2, power: 24 * strength + 6, up: 7,
            });
        }
        if (emitter.age < 0.2) {
            // The thump also lifts whatever lies on the floor beside the board.
            const foot = stage.edge(side, 0, FALL_STAGE_DEPTH, this.foot);
            const x = foot.x + side * 1.4;
            const z = foot.z - 1.5;
            this.fields.push({
                kind: 'burst', x, y: this.groundHeight(x, z) - 0.3, z, radius: 3.6, power: 14 * strength + 4, up: 11,
            });
        }
    }

    clear(emitter) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const lines = Math.max(1, emitter.lines);
        const edge = stage.edge(side, emitter.row, FALL_STAGE_DEPTH, this.point, 0.02);
        const count = this.due(emitter, (24 + 26 * lines) * this.scale, CLEAR_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const speed = (5 + 7 * this.random()) * (0.7 + 0.5 * strength);
            const z = edge.z + (this.random() - 0.5) * 1.6;
            sim.spawn(
                edge.x,
                this.above(edge.x, edge.y + (this.random() - 0.5) * (0.7 + 0.5 * lines), z),
                z,
                side * speed,
                -0.4 + 3 * this.random(),
                (this.random() - 0.5) * 4.4,
            );
        }
        if (emitter.age < 0.75) {
            this.fields.push({
                kind: 'jet', x: edge.x + side * 1.5, y: edge.y, z: edge.z, dx: side, dy: 0.1, dz: 0, radius: 5.2, power: 20 * strength,
            });
        }
    }

    shower(emitter) {
        const { sim, shedPoints } = this;
        const count = this.due(emitter, 420 * this.scale * emitter.strength, SHOWER_WINDOW);
        for (let i = 0; i < count; i += 1) {
            let x = (this.random() * 2 - 1) * 18;
            let y = 9 + this.random() * 6;
            let z = 6 - this.random() * 26;
            if (shedPoints.length) {
                const pick = Math.floor(this.random() * (shedPoints.length / 3)) * 3;
                x = shedPoints[pick] + (this.random() - 0.5) * 2;
                // Let go from the lower boughs so the shower is in frame at once.
                y = Math.min(shedPoints[pick + 1], 5.5 + this.random() * 6.5);
                z = shedPoints[pick + 2] + (this.random() - 0.5) * 2;
            }
            sim.spawn(x, y, z, (this.random() - 0.5) * 2.4, -1.2 - 2.4 * this.random(), (this.random() - 0.5) * 2.4);
        }
    }

    /** Throw a ring of leaves into the orbit around the board. */
    ring(count, energy) {
        const { stage, sim } = this;
        const centre = stage.centre(FALL_STAGE_DEPTH, this.point);
        const floor = this.groundHeight(centre.x, centre.z);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const radius = 2.6 + this.random();
            const speed = 4 + 3 * this.random() + energy * 3;
            sim.spawn(
                centre.x + Math.cos(angle) * radius,
                floor + 0.2 + this.random() * 2.4,
                centre.z + Math.sin(angle) * radius,
                -Math.sin(angle) * speed,
                0.4 + this.random() * 1.2,
                Math.cos(angle) * speed,
            );
        }
    }

    spin(emitter, fresh) {
        const { stage, sim } = this;
        const { side } = emitter;
        const edge = stage.edge(side, emitter.row, FALL_STAGE_DEPTH, this.point, 0.01);
        const x = edge.x + side * 2;
        if (fresh) {
            const count = Math.round(34 * this.scale);
            for (let i = 0; i < count; i += 1) {
                const angle = i * 0.7;
                const speed = 3 + 0.12 * i;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.6, edge.z),
                    edge.z,
                    Math.cos(angle) * speed * 0.8 + side * 2,
                    Math.sin(angle) * speed * 0.6 + 1.5,
                    Math.sin(angle) * 1.5,
                );
            }
        }
        if (emitter.age < 1.1) {
            this.fields.push({
                kind: 'vortex', x, z: edge.z, radius: 1.2, reach: 2.6, top: edge.y + 2.5, spin: 7, turn: side, grip: 3, pull: 3, lift: 2,
            });
        }
    }

    /**
     * Apply one director frame. `wind` is {x, z, strength} from the light rig; returns the
     * environment for FallLeafSim.step().
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
            else if (emitter.kind === 'clear') this.clear(emitter);
            else if (emitter.kind === 'shower') this.shower(emitter);
            else if (emitter.kind === 'spin') this.spin(emitter, fresh);
            else if (emitter.kind === 'combo' && fresh) this.ring(Math.round((16 + 50 * emitter.strength) * this.scale), emitter.strength);
        }
        const vortex = Number.isFinite(frame.vortex) ? Math.max(0, Math.min(1, frame.vortex)) : 0;
        if (vortex > 0.03) {
            const centre = stage.centre(FALL_STAGE_DEPTH, this.point);
            const floor = this.groundHeight(centre.x, centre.z);
            fields.push({
                kind: 'vortex',
                x: centre.x,
                z: centre.z,
                radius: 2.7 + 0.8 * vortex,
                reach: 4.4 + vortex,
                top: floor + 2.4 + 7.5 * vortex,
                spin: 4.2 + 7.5 * vortex,
                turn: 1,
                grip: 2.4,
                pull: 2.6,
                lift: 1.4 + 2.8 * vortex,
            });
            // Keep the column fed while it turns.
            this.vortexFeed += Math.max(0, dt) * (14 + 46 * vortex) * this.scale;
            const feed = Math.floor(this.vortexFeed);
            if (feed > 0) {
                this.vortexFeed -= feed;
                this.ring(feed, vortex);
            }
        } else this.vortexFeed = 0;
        const { env } = this;
        env.windX = wind.x;
        env.windZ = wind.z;
        env.breeze = 0.5 + wind.strength * 2.2;
        env.gust = (Number.isFinite(frame.gust) ? Math.max(0, Math.min(1, frame.gust)) : 0) * 4.5;
        if (frame.front && frame.front.strength > 0.001) {
            this.front.x = frame.front.position * stage.halfWidth(26);
            this.front.strength = frame.front.strength;
            this.front.direction = frame.front.direction;
            env.front = this.front;
        } else env.front = null;
        return env;
    }
}
