/**
 * Forest — turning the director's cues into light in the old wood.
 *
 * ForestReactions speaks in board terms ("left edge, two thirds up, strength 0.6").
 * ForestFireflyDirector knows where the board stands in the forest (ForestStage) and what
 * the firefly simulation and the light rig can do, and translates: it sends the waves of
 * light out across the floor, throws reserve sparks out from behind the card, lays down the
 * short-lived force fields that carry them, shakes dew from the boughs, winds garlands up
 * the old trunks while a combo keeps the forest awake, and calls the fireflies together
 * into one of the wood's animals on the knoll.
 */
import * as THREE from 'three/webgpu';
import { FOREST_FIGURES, createForestFigurePoints, forestFigure } from './forest-figures.js';
import { FOREST_FIREFLY_DEW } from './forest-firefly-sim.js';
import { FOREST_STAGE_DEPTH } from './forest-stage.js';

const REFERENCE_FIREFLIES = 2400;
const CLEAR_WINDOW = 0.5;
const RISE_WINDOW = 1.5;
const DEW_WINDOW = 0.5;
const FIGURE_SEED = 20261008;
/** What a wave of each kind is: how fast it runs, how wide its front, how high it climbs. */
export const FOREST_WAVES = Object.freeze({
    lock: {
        speed: 9, width: 0.85, reach: 2.4, life: 2.6, gain: 1.25,
    },
    drop: {
        speed: 12, width: 1.1, reach: 3.6, life: 3, gain: 1.4,
    },
    clear: {
        speed: 15, width: 1.7, reach: 7, life: 3.8, gain: 1.3,
    },
    quad: {
        speed: 20, width: 3, reach: 17, life: 4.8, gain: 1.4,
    },
    combo: {
        speed: 13, width: 1.5, reach: 5, life: 3.4, gain: 1.1,
    },
    spin: {
        speed: 11, width: 1.2, reach: 6, life: 2.8, gain: 1.2,
    },
    level: {
        speed: 10, width: 3.6, reach: 12, life: 5.5, gain: 1.1,
    },
    figure: {
        speed: 6, width: 2.2, reach: 3, life: 2.6, gain: 0.5,
    },
});

export class ForestFireflyDirector {
    constructor({
        stage, sim, pulses, tier, rng = Math.random, groundHeight = () => 0, trunks = [], boughs = null,
        figureAnchor = null, eye = { x: 0, z: 13 },
    }) {
        this.stage = stage;
        this.sim = sim;
        this.pulses = pulses;
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.boughs = boughs;
        this.scale = Math.max(0.2, tier.fireflies / REFERENCE_FIREFLIES);
        this.fields = [];
        this.serials = new Map();
        this.emitted = new Map();
        this.waveSerial = -1;
        this.epoch = null;
        this.haloFeed = 0;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        this.front = {
            x: 0, width: 20, strength: 0, direction: 1,
        };
        this.env = {
            windX: 1,
            windZ: 0,
            gust: 0,
            glow: 0,
            heat: 0,
            sync: 0,
            beatRate: 0.3,
            settled: false,
            front: null,
            fields: this.fields,
        };
        // The trunks worth winding a garland round: old, near, and in front of the eye.
        const posts = trunks
            .filter((trunk) => trunk.radius > 0.24 && trunk.z < eye.z - 2)
            .map((trunk) => ({ ...trunk, range: Math.hypot(trunk.x - eye.x, trunk.z - eye.z) }))
            .filter((trunk) => trunk.range < 46)
            .sort((a, b) => a.range - b.range)
            .slice(0, Math.max(2, Math.min(6, Math.round(2 + this.scale * 3))));
        this.posts = posts.map((trunk, index) => ({ ...trunk, turn: index % 2 === 0 ? 1 : -1, feed: 0 }));
        // The figure: where it stands, how many lights it is made of, and every animal laid
        // out now, so a summons finds its lights waiting and builds nothing.
        this.figureAnchor = figureAnchor;
        this.figureLights = Math.max(60, Math.min(Math.round(sim.reserve * 0.42), Math.round(560 * this.scale)));
        this.figurePoints = new Map();
        this.figureSparks = [];
        this.figureSerial = 0;
        this.figureHeld = false;
        this.figureBeat = 0;
        if (figureAnchor) FOREST_FIGURES.forEach((figure) => this.pointsFor(figure));
    }

    /** The lights of one animal, in its own plane. */
    pointsFor(figure) {
        let points = this.figurePoints.get(figure.id);
        if (!points) {
            // Its own generator: an animal is the same animal every time it comes.
            let state = FIGURE_SEED;
            const steady = () => {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                return state / 4294967296;
            };
            points = createForestFigurePoints(figure, this.figureLights, steady);
            this.figurePoints.set(figure.id, points);
        }
        return points;
    }

    /**
     * Drop what is in flight. Which emitters and waves have already been played is kept:
     * it is forgotten only when the reactions themselves start over (see `follow`), so a
     * reset here never replays what is still queued there.
     */
    reset() {
        this.fields.length = 0;
        this.haloFeed = 0;
        this.posts.forEach((post) => {
            // eslint-disable-next-line no-param-reassign
            post.feed = 0;
        });
        this.figureSparks.length = 0;
        this.figureHeld = false;
    }

    /** Start counting afresh when the reactions have been reset. */
    follow(epoch) {
        if (epoch === this.epoch) return;
        this.epoch = epoch;
        this.serials.clear();
        this.emitted.clear();
        this.waveSerial = -1;
        this.figureSerial = 0;
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    }

    /** A spawn height kept clear of the moss. */
    above(x, y, z) {
        return Math.max(y, this.groundHeight(x, z) + 0.15);
    }

    /** How many sparks an emitter may release this frame to stay on its schedule. */
    due(emitter, total, window) {
        const target = total * Math.min(1, emitter.age / window);
        const done = this.emitted.get(emitter.id) || 0;
        const count = Math.max(0, Math.floor(target - done));
        this.emitted.set(emitter.id, done + count);
        return count;
    }

    /** Send a wave of light out from the floor behind a place on the board. */
    sendWave(wave) {
        const shape = FOREST_WAVES[wave.kind] || FOREST_WAVES.lock;
        const spot = this.stage.floor(wave.column, wave.row, this.foot);
        this.pulses?.add(spot.x, spot.y, spot.z, {
            strength: wave.strength * shape.gain,
            speed: shape.speed,
            width: shape.width,
            reach: shape.reach,
            heat: wave.heat,
            life: shape.life,
        });
    }

    lock(emitter, fresh) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const edge = stage.edge(side, emitter.row, FOREST_STAGE_DEPTH, this.point, 0.012);
        if (fresh) {
            const count = Math.round((10 + 26 * strength) * this.scale);
            for (let i = 0; i < count; i += 1) {
                const speed = (1 + 2.4 * this.random()) * (0.6 + strength);
                const x = edge.x + side * this.random() * 0.3;
                const z = edge.z + (this.random() - 0.5) * 1.2;
                sim.spawn(
                    x,
                    this.above(x, edge.y + (this.random() - 0.5) * 0.9, z),
                    z,
                    side * speed,
                    0.4 + 2.4 * this.random(),
                    (this.random() - 0.5) * 2.6,
                    { life: 1.6 + 1.6 * this.random(), heat: 0.1 * strength, size: 0.1 + 0.05 * this.random() },
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
                power: 11 * strength + 3,
                up: 3.5,
            });
        }
    }

    /** A hard drop shakes the boughs: dew comes down through the moonlight. */
    dew(emitter) {
        const { sim, boughs } = this;
        if (!boughs || boughs.length < 3) return;
        const count = this.due(emitter, (70 + 110 * emitter.strength) * this.scale, DEW_WINDOW);
        const sites = boughs.length / 3;
        for (let i = 0; i < count; i += 1) {
            const pick = Math.floor(this.random() * sites) * 3;
            sim.spawn(
                boughs[pick] + (this.random() - 0.5) * 1.4,
                boughs[pick + 1] - this.random() * 0.4,
                boughs[pick + 2] + (this.random() - 0.5) * 1.4,
                (this.random() - 0.5) * 0.5,
                -0.2 - this.random() * 0.8,
                (this.random() - 0.5) * 0.5,
                {
                    life: 2.6 + 1.6 * this.random(), size: 0.035 + 0.035 * this.random(), kind: FOREST_FIREFLY_DEW,
                },
            );
        }
    }

    clear(emitter) {
        const { stage, sim } = this;
        const { side, strength } = emitter;
        const lines = Math.max(1, emitter.lines);
        const edge = stage.edge(side, emitter.row, FOREST_STAGE_DEPTH, this.point, 0.02);
        const count = this.due(emitter, (30 + 34 * lines) * this.scale, CLEAR_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const speed = (2.8 + 4.6 * this.random()) * (0.7 + 0.5 * strength);
            const z = edge.z + (this.random() - 0.5) * 1.6;
            sim.spawn(
                edge.x,
                this.above(edge.x, edge.y + (this.random() - 0.5) * (0.7 + 0.5 * lines), z),
                z,
                side * speed,
                -0.2 + 2.6 * this.random(),
                (this.random() - 0.5) * 4,
                { life: 1.9 + 1.9 * this.random(), heat: 0.15 + 0.14 * lines, size: 0.1 + 0.06 * this.random() },
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
                power: 10 * strength,
            });
        }
    }

    /** The whole floor gives up its fireflies: they lift out of the ferns all around the board. */
    rise(emitter) {
        const { stage, sim } = this;
        const count = this.due(emitter, 520 * this.scale * emitter.strength, RISE_WINDOW);
        for (let i = 0; i < count; i += 1) {
            const spot = stage.floor(-1.9 + this.random() * 4.8, this.random() ** 1.3 * 0.72, this.foot);
            sim.spawn(
                spot.x,
                spot.y + 0.12,
                spot.z,
                (this.random() - 0.5) * 0.8,
                1.3 + 3.2 * this.random(),
                (this.random() - 0.5) * 0.8,
                { life: 2.8 + 2.6 * this.random(), heat: 0.3 + 0.5 * this.random(), size: 0.1 + 0.07 * this.random() },
            );
        }
    }

    /** Throw a ring of sparks into the slow wheel around the board. */
    ring(count, energy) {
        const { stage, sim } = this;
        const centre = stage.centre(FOREST_STAGE_DEPTH, this.point);
        for (let i = 0; i < count; i += 1) {
            const angle = this.random() * Math.PI * 2;
            const radius = 2.7 + this.random();
            const speed = (0.3 + 0.4 * energy) * radius * (0.85 + 0.3 * this.random());
            const x = centre.x + Math.cos(angle) * radius;
            const z = centre.z + Math.sin(angle) * radius;
            sim.spawn(
                x,
                this.above(x, this.groundHeight(x, z) + 0.3 + this.random() * 2.2, z),
                z,
                -Math.sin(angle) * speed,
                0.5 + this.random() * 1.2,
                Math.cos(angle) * speed,
                { life: 2.2 + 2.2 * this.random(), heat: 0.2 + 0.5 * energy, size: 0.1 + 0.06 * this.random() },
            );
        }
    }

    spin(emitter, fresh) {
        const { stage, sim } = this;
        const { side } = emitter;
        const edge = stage.edge(side, emitter.row, FOREST_STAGE_DEPTH, this.point, 0.01);
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
                    { life: 1.8 + 1.4 * this.random(), heat: 0.6, size: 0.1 + 0.06 * this.random() },
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
                floor: this.groundHeight(x, edge.z),
                top: edge.y + 2.5,
                spin: 4.4,
                turn: side,
                grip: 3,
                pull: 12,
                lift: 2,
            });
        }
    }

    /** While the forest is awake, fireflies wind up the old trunks in garlands. */
    garlands(wake, heat, step) {
        const { sim, fields } = this;
        for (let i = 0; i < this.posts.length; i += 1) {
            const post = this.posts[i];
            const orbit = post.radius + 0.5;
            const climb = 1.6 + wake * Math.min(post.crownBase + 4, 15);
            fields.push({
                kind: 'vortex',
                x: post.x,
                z: post.z,
                radius: orbit,
                reach: orbit + 1.9,
                floor: post.y,
                top: post.y + climb,
                spin: 0.8 + 0.7 * wake,
                turn: post.turn,
                grip: 3.4,
                pull: 12,
                lift: 0.55 + 0.9 * wake,
            });
            post.feed += step * (5 + 14 * wake) * this.scale;
            const feed = Math.floor(post.feed);
            if (feed > 0) {
                post.feed -= feed;
                for (let n = 0; n < feed; n += 1) {
                    const angle = this.random() * Math.PI * 2;
                    const speed = (0.8 + 0.7 * wake) * orbit;
                    sim.spawn(
                        post.x + Math.cos(angle) * orbit,
                        post.y + 0.15 + this.random() * 0.9,
                        post.z + Math.sin(angle) * orbit,
                        -Math.sin(angle) * speed * post.turn,
                        0.6 + this.random(),
                        Math.cos(angle) * speed * post.turn,
                        {
                            life: 5 + 4 * this.random() + wake * 3,
                            heat: 0.12 + heat * 0.7,
                            size: 0.085 + 0.05 * this.random(),
                        },
                    );
                }
            }
        }
    }

    /** Call an animal: fireflies lift from the ferns round the knoll and fly to their places. */
    gatherFigure(kind) {
        const { sim, figureAnchor } = this;
        if (!figureAnchor) return;
        const figure = forestFigure(kind);
        const figurePoints = this.pointsFor(figure);
        // Whatever figure was standing gives way to the new one.
        if (this.figureSparks.length) sim.release(0.8);
        this.figureSparks.length = 0;
        const count = figurePoints.length / 4;
        for (let i = 0; i < count; i += 1) {
            const u = figurePoints[i * 4] * figure.scale;
            const v = figurePoints[i * 4 + 1] * figure.scale;
            const w = figurePoints[i * 4 + 2] * figure.scale;
            const tx = figureAnchor.x + figureAnchor.facing.x * u + figureAnchor.depth.x * w;
            const tz = figureAnchor.z + figureAnchor.facing.z * u + figureAnchor.depth.z * w;
            const ty = figureAnchor.y + v;
            // Each light starts in the ferns somewhere near and rises to its place.
            const angle = this.random() * Math.PI * 2;
            const reach = 1.5 + this.random() * 6.5;
            const x = tx + Math.cos(angle) * reach;
            const z = tz + Math.sin(angle) * reach;
            const index = sim.spawn(x, this.groundHeight(x, z) + 0.15 + this.random() * 0.5, z, 0, 0.8, 0, {
                life: 30,
                heat: 0.45 + 0.4 * figurePoints[i * 4 + 3],
                size: 0.07 + 0.045 * figurePoints[i * 4 + 3],
            });
            if (index >= 0) {
                // The lights do not all arrive together: the animal draws itself.
                sim.bind(index, tx, ty, tz, 0.5 + this.random() * 0.7);
                this.figureSparks.push(index);
            }
        }
        this.figureHeld = true;
        this.figureBeat = 0.4;
    }

    figure(frame, step) {
        const cue = frame.figure;
        if (cue && cue.serial !== this.figureSerial) {
            this.figureSerial = cue.serial;
            if (cue.held) this.gatherFigure(cue.kind);
        }
        if (!this.figureHeld) return;
        if (!cue || !cue.held) {
            // It lets go: the lights drift apart and go out.
            this.sim.release(2.4);
            this.figureSparks.length = 0;
            this.figureHeld = false;
            return;
        }
        // While it stands, a slow light breathes out over the moss from under its hooves.
        this.figureBeat -= step;
        if (this.figureBeat <= 0 && cue.presence > 0.8) {
            this.figureBeat = 1.5;
            const shape = FOREST_WAVES.figure;
            this.pulses?.add(this.figureAnchor.x, this.figureAnchor.y, this.figureAnchor.z, {
                strength: shape.gain,
                speed: shape.speed,
                width: shape.width,
                reach: shape.reach,
                heat: 0.6,
                life: shape.life,
            });
        }
    }

    /**
     * Apply one director frame. `wind` is {x, z} from the light rig; returns the
     * environment for ForestFireflySim.step().
     */
    apply(frame = {}, dt = 0, wind = { x: 1, z: 0 }) {
        const { fields, stage } = this;
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
            else if (emitter.kind === 'dew') this.dew(emitter);
            else if (emitter.kind === 'clear') this.clear(emitter);
            else if (emitter.kind === 'rise') this.rise(emitter);
            else if (emitter.kind === 'spin') this.spin(emitter, fresh);
            else if (emitter.kind === 'combo' && fresh) {
                this.ring(Math.round((20 + 60 * emitter.strength) * this.scale), emitter.strength);
            }
        }
        // Waves the director asked for, oldest first: the queue is a ring buffer, so its
        // slots are not in order, and the pool keeps whatever is added last.
        const waves = frame.waves || [];
        for (let pass = 0; pass < waves.length; pass += 1) {
            let next = null;
            for (let i = 0; i < waves.length; i += 1) {
                const wave = waves[i];
                if (wave.serial > this.waveSerial && (!next || wave.serial < next.serial)) next = wave;
            }
            if (!next) break;
            this.waveSerial = next.serial;
            if (next.strength > 0) this.sendWave(next);
        }
        const wake = Number.isFinite(frame.wake) ? Math.max(0, Math.min(1, frame.wake)) : 0;
        const heat = Number.isFinite(frame.heat) ? Math.max(0, Math.min(1, frame.heat)) : 0;
        if (wake > 0.03) {
            this.garlands(wake, heat, step);
            // And a slow wheel of them turns behind the board itself.
            const centre = stage.centre(FOREST_STAGE_DEPTH, this.point);
            fields.push({
                kind: 'vortex',
                x: centre.x,
                z: centre.z,
                radius: 2.9 + 0.7 * wake,
                reach: 7.5,
                floor: this.groundHeight(centre.x, centre.z),
                top: this.groundHeight(centre.x, centre.z) + 2 + 5.2 * wake,
                spin: 0.3 + 0.4 * wake,
                turn: 1,
                grip: 3,
                pull: 9,
                lift: 0.5 + 0.9 * wake,
            });
            this.haloFeed += step * (8 + 26 * wake) * this.scale;
            const feed = Math.floor(this.haloFeed);
            if (feed > 0) {
                this.haloFeed -= feed;
                this.ring(feed, wake);
            }
        } else {
            this.haloFeed = 0;
        }
        this.figure(frame, step);
        const { env } = this;
        env.windX = wind.x;
        env.windZ = wind.z;
        env.gust = Number.isFinite(frame.gust) ? Math.max(0, Math.min(1, frame.gust)) : 0;
        env.glow = Number.isFinite(frame.glow) ? frame.glow : 0;
        env.heat = heat;
        env.sync = Number.isFinite(frame.sync) ? frame.sync : 0;
        env.beatRate = Number.isFinite(frame.beatRate) ? frame.beatRate : 0.3;
        env.settled = frame.settled === true;
        if (frame.front && frame.front.strength > 0.001) {
            this.front.x = frame.front.position * stage.halfWidth(46);
            this.front.strength = frame.front.strength;
            this.front.direction = frame.front.direction;
            env.front = this.front;
        } else env.front = null;
        return env;
    }
}
