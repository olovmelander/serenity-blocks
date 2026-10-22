/**
 * Fall — turning the director's emitters into leaves.
 *
 * FallReactions speaks in board terms ("left edge, two thirds up, strength 0.6").
 * FallLeafDirector knows where the board stands in the forest (FallStage) and what the
 * leaf simulation can do, and translates: it throws reserve leaves out from behind the
 * card, lays down the short-lived force fields that carry them, feeds the combo vortex,
 * and reports the wind the simulation should feel this frame: the breeze, the gust, every gust
 * front crossing and how hard the storm of play makes the crowns shed. Under reduced motion
 * (`frame.motion` below 1) every throw and force field is gentler.
 */
import * as THREE from 'three/webgpu';
import { FALL_STAGE_DEPTH } from './fall-stage.js';

const REFERENCE_LEAVES = 2600;
const CLEAR_WINDOW = 0.5;
const SHOWER_WINDOW = 1.4;
/** A back-to-back's twin cascade from the two great trees lets go over this long. */
const TWIN_WINDOW = 0.7;
/** A perfect clear flings the vortex's leaves out over the grove between these ages, this far. */
const CROWN_BURST = Object.freeze([0.3, 0.7]);
const CROWN_RADIUS = 9;
/** Gust fronts the environment can carry at once (as many as the director sends). */
const FRONT_SLOTS = 3;
/** Front strengths below this blow nothing. */
const FRONT_FLOOR = 0.001;

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
        // The two great trees that frame the board: the crowns left and right of it.
        this.leftCrowns = [];
        this.rightCrowns = [];
        for (let i = 0; i < this.shedPoints.length; i += 3) {
            const x = this.shedPoints[i];
            if (x < -3) this.leftCrowns.push(i);
            else if (x > 3) this.rightCrowns.push(i);
        }
        this.fields = [];
        this.serials = new Map();
        this.emitted = new Map();
        this.vortexFeed = 0;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        /** How much of each throw's speed and each field's push plays (reduced motion lowers it). */
        this.pace = 1;
        this.fronts = Array.from({ length: FRONT_SLOTS }, () => ({
            x: 0, width: 9, strength: 0, direction: 1,
        }));
        // The environment's view of them: the live ones, in the director's order.
        this.liveFronts = [];
        this.env = {
            windX: 1, windZ: 0, breeze: 0, gust: 0, front: null, fronts: this.liveFronts, storm: 0, fields: this.fields,
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

    /**
     * Throw one event leaf at the pace motion allows. An event's leaves always fly: with the
     * reserve exhausted the simulation takes the leaf that has flown longest.
     */
    toss(x, y, z, vx, vy, vz, steal = true) {
        const { pace } = this;
        return this.sim.spawn(x, y, z, vx * pace, vy * pace, vz * pace, 0, steal);
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
        const { stage } = this;
        const { side, strength } = emitter;
        const edge = stage.edge(side, emitter.row, FALL_STAGE_DEPTH, this.point, 0.012);
        if (fresh) {
            const count = Math.round((8 + 22 * strength) * this.scale);
            for (let i = 0; i < count; i += 1) {
                const speed = (2.4 + 4.6 * this.random()) * (0.6 + strength);
                const x = edge.x + side * this.random() * 0.3;
                const z = edge.z + (this.random() - 0.5) * 1.2;
                this.toss(
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
        const { stage } = this;
        const { side, strength } = emitter;
        const lines = Math.max(1, emitter.lines);
        const edge = stage.edge(side, emitter.row, FALL_STAGE_DEPTH, this.point, 0.02);
        const count = this.due(emitter, (24 + 26 * lines) * this.scale, CLEAR_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const speed = (5 + 7 * this.random()) * (0.7 + 0.5 * strength);
            const z = edge.z + (this.random() - 0.5) * 1.6;
            this.toss(
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
        const { shedPoints } = this;
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
            this.toss(x, y, z, (this.random() - 0.5) * 2.4, -1.2 - 2.4 * this.random(), (this.random() - 0.5) * 2.4);
        }
    }

    /** Throw a ring of leaves into the orbit around the board (`steal`: see toss()). */
    ring(count, energy, steal = true) {
        const { stage } = this;
        const centre = stage.centre(FALL_STAGE_DEPTH, this.point);
        const floor = this.groundHeight(centre.x, centre.z);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const radius = 2.6 + this.random();
            const speed = 4 + 3 * this.random() + energy * 3;
            this.toss(
                centre.x + Math.cos(angle) * radius,
                floor + 0.2 + this.random() * 2.4,
                centre.z + Math.sin(angle) * radius,
                -Math.sin(angle) * speed,
                0.4 + this.random() * 1.2,
                Math.cos(angle) * speed,
                steal,
            );
        }
    }

    spin(emitter, fresh) {
        const { stage } = this;
        const { side } = emitter;
        const edge = stage.edge(side, emitter.row, FALL_STAGE_DEPTH, this.point, 0.01);
        const x = edge.x + side * 2;
        if (fresh) {
            const count = Math.round(34 * this.scale);
            for (let i = 0; i < count; i += 1) {
                const angle = i * 0.7;
                const speed = 3 + 0.12 * i;
                this.toss(
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
     * A back-to-back: the two great trees answer at once. Leaves let go from the crowns on both
     * sides of the board and stream in toward it, more of them the stronger the run of
     * back-to-backs (the emitter's strength).
     */
    twin(emitter) {
        const { stage, shedPoints } = this;
        const count = this.due(emitter, (70 + 130 * emitter.strength) * this.scale, TWIN_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const side = (emitter.serial + i) % 2 === 0 ? -1 : 1;
            const points = side < 0 ? this.leftCrowns : this.rightCrowns;
            let x;
            let y;
            let z;
            if (points.length) {
                const pick = points[Math.floor(this.random() * points.length)];
                x = shedPoints[pick] + (this.random() - 0.5) * 2;
                y = Math.min(shedPoints[pick + 1], 6 + this.random() * 6);
                z = shedPoints[pick + 2] + (this.random() - 0.5) * 2;
            } else {
                const edge = stage.edge(side, 1, FALL_STAGE_DEPTH, this.point, 0.25);
                ({ x } = edge);
                y = edge.y + this.random() * 2;
                z = edge.z + (this.random() - 0.5) * 2;
            }
            const speed = (2.2 + 3.4 * this.random()) * (0.7 + 0.5 * emitter.strength);
            this.toss(x, y, z, -side * speed, -0.6 - 1.8 * this.random(), (this.random() - 0.5) * 2.4);
        }
    }

    /**
     * A perfect clear: the vortex lets go. A broad burst at the column flings the leaves it holds
     * out and up over the grove, to fall back as the column unwinds.
     */
    crown(emitter) {
        if (emitter.age < CROWN_BURST[0] || emitter.age > CROWN_BURST[1]) return;
        const centre = this.stage.centre(FALL_STAGE_DEPTH, this.point);
        this.fields.push({
            kind: 'burst',
            x: centre.x,
            y: this.groundHeight(centre.x, centre.z) + 2.5,
            z: centre.z,
            radius: CROWN_RADIUS,
            power: 14 * emitter.strength,
            up: 9,
        });
    }

    /**
     * Apply one director frame. `wind` is {x, z, strength} from the light rig; returns the
     * environment for FallLeafSim.step().
     */
    apply(frame = {}, dt = 0, wind = { x: 1, z: 0, strength: 0.3 }) {
        const { fields, stage } = this;
        fields.length = 0;
        const motion = Number.isFinite(frame.motion) ? Math.max(0, Math.min(1, frame.motion)) : 1;
        this.pace = 0.6 + 0.4 * motion;
        const fever = Number.isFinite(frame.surge?.fever) ? Math.max(0, Math.min(1, frame.surge.fever)) : 0;
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
            else if (emitter.kind === 'twin') this.twin(emitter);
            else if (emitter.kind === 'crown') this.crown(emitter);
            else if (emitter.kind === 'combo' && fresh) this.ring(Math.round((16 + 50 * emitter.strength) * this.scale), emitter.strength);
        }
        const vortex = Number.isFinite(frame.vortex) ? Math.max(0, Math.min(1, frame.vortex)) : 0;
        if (vortex > 0.03) {
            const centre = stage.centre(FALL_STAGE_DEPTH, this.point);
            const floor = this.groundHeight(centre.x, centre.z);
            // In a fever the column climbs into the crowns, wider, faster and fuller.
            fields.push({
                kind: 'vortex',
                x: centre.x,
                z: centre.z,
                radius: 2.7 + 0.8 * vortex + 0.9 * fever,
                reach: 4.4 + vortex + fever,
                top: floor + 2.4 + 7.5 * vortex + 6 * fever * vortex,
                spin: 4.2 + 7.5 * vortex + 2.5 * fever,
                turn: 1,
                grip: 2.4,
                pull: 2.6,
                lift: 1.4 + 2.8 * vortex + 1.6 * fever,
            });
            // Keep the column fed while it turns (a continuous feed: it never takes a leaf in flight).
            this.vortexFeed += Math.max(0, dt) * (14 + 46 * vortex + 40 * fever * vortex) * this.scale;
            const feed = Math.floor(this.vortexFeed);
            if (feed > 0) {
                this.vortexFeed -= feed;
                this.ring(feed, vortex, false);
            }
        } else this.vortexFeed = 0;
        // Under reduced motion every gameplay field pushes and turns more gently.
        if (this.pace < 1) {
            for (let i = 0; i < fields.length; i += 1) {
                const field = fields[i];
                if (field.kind === 'vortex') field.spin *= this.pace;
                else field.power *= this.pace;
            }
        }
        const { env } = this;
        env.windX = wind.x;
        env.windZ = wind.z;
        env.breeze = 0.5 + wind.strength * 2.2;
        env.gust = (Number.isFinite(frame.gust) ? Math.max(0, Math.min(1, frame.gust)) : 0) * 4.5 * motion;
        env.storm = Number.isFinite(frame.storm) ? Math.max(0, Math.min(1, frame.storm)) : 0;
        // Every front crossing, in world x (a frame from an older director may carry one `front`).
        const { liveFronts } = this;
        liveFronts.length = 0;
        let strongest = null;
        const given = Array.isArray(frame.fronts) ? frame.fronts : [frame.front];
        for (let i = 0; i < given.length && liveFronts.length < FRONT_SLOTS; i += 1) {
            const source = given[i];
            if (!source || !(source.strength > FRONT_FLOOR)) continue;
            const front = this.fronts[liveFronts.length];
            front.x = source.position * stage.halfWidth(26);
            front.strength = source.strength * motion;
            front.direction = source.direction;
            liveFronts.push(front);
            if (!strongest || front.strength > strongest.strength) strongest = front;
        }
        env.front = strongest;
        return env;
    }
}
