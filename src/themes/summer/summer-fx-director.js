/**
 * Summer — turning the director's cues into petals, rings and wind.
 *
 * SummerReactions speaks in board terms ("left edge, two thirds up, strength 0.6, poppy").
 * SummerFxDirector knows where the board stands over the meadow and the lake (SummerStage)
 * and what the petal simulation, the lake and the meadow can do, and translates: it throws
 * petals out from behind the card, lays down the short-lived force fields that carry them,
 * feeds the flower crown a combo winds around the board, starts the gusts that spread
 * through the grass, and drops rings on the water — where a piece landed, where a petal
 * came down, and now and then where a fish rose. As play runs hot the meadow itself lets go of
 * its petals and seed into the evening air (drift), most of all in a fever. The two largest
 * things are its own: the flowers that open in the sky over the lake (blossom), each a thread of
 * light that climbs and bursts into a whorl of one kind's petals, and the stone that skips down
 * the sun's road (skip), ring after ring.
 */
import * as THREE from 'three/webgpu';
import { SUMMER_PARTICLES } from './summer-petal-sim.js';
import { SUMMER_STAGE_DEPTH } from './summer-stage.js';

/**
 * The pool the event counts below are written for (High). The largest thing the game can ask for
 * at once (four lines and a perfect clear on top: the jets, the rising meadow, the bouquet and
 * seven flowers) takes about 3,050 of its 3,440 reserve particles, which leaves a combo's crown
 * its 400 while the flowers hang: tests/unit/summer-fx-director.test.js holds the headroom.
 */
const REFERENCE_PETALS = 4000;
const CLEAR_WINDOW = 0.5;
const RISE_WINDOW = 1.5;
const SEED_WINDOW = 0.3;
const BOUQUET_WINDOW = 0.7;
const FLOWER_KINDS = 7;
/** Fronts of wind the reactions can send across at once (summer-reactions.js). */
const FRONT_SLOTS = 3;
/**
 * Where a lake ring opens: metres out from the near shore for the foot of the board, and for its
 * top. The crest of flowers the camera looks over hides the first fifteen metres of the lake, so
 * the nearest ring opens beyond them: it was a metre and a half out, where no ring was ever seen.
 */
const RING_NEAR = 17;
const RING_REACH = 30;
/** How far above the ground petals are released, in metres: over the heads of the meadow. */
const FLOWER_TOPS = 1.15;
const {
    petal: PETAL, seed: SEED, pollen: POLLEN, glow: GLOW,
} = SUMMER_PARTICLES;
/** A flower in the sky: seconds its shoot climbs before it opens, and how far it climbs, metres. */
const BLOSSOM_RISE = 0.42;
const BLOSSOM_CLIMB = 3.4;
/** Petals in one sky flower at the reference pool, and how far its longest petals reach, metres. */
const BLOSSOM_PETALS = 210;
const BLOSSOM_REACH = 1.3;
/** The bouquet's flower opens on the line of sight to the maypole's head, this far from the eye. */
const BLOSSOM_CROWN_DEPTH = 8.2;
/** Seconds a sky flower holds its shape before its petals let go and fall. */
const BLOSSOM_HANG = 1.6;
/** How quickly the air stops a petal (the simulation's drag): a burst's reach is its speed over this. */
const PETAL_DRAG = 1.7;
/** A flower opens over the maypole when its emitter says so (summer-reactions.js). */
const BLOSSOM_MAYPOLE = -1;
/**
 * Where the flowers of a perfect clear open: in the air beside the board, nearer than the birch
 * and the spruce that frame the picture (further off, their crowns hid every flower but one).
 * Shares of the open strip beside the board (0 at the board, 1 at the screen's edge), how far down
 * the screen, and metres from the eye.
 */
const BLOSSOM_SPOTS = [
    [0.56, 0.3, 7.6], [0.5, 0.22, 7.2], [0.82, 0.5, 8], [0.78, 0.48, 7.4], [0.2, 0.42, 8.4], [0.24, 0.4, 7.8],
];
/**
 * How far down the screen the flowers of a narrow side stand, one above another, and how much
 * smaller they are drawn there so that three of them find room above the meadow.
 */
const BLOSSOM_STACK = [0.2, 0.37, 0.54];
const BLOSSOM_STACKED = 0.78;
/** A flower keeps this share of the screen's width clear between its rim and the card or the edge. */
const BLOSSOM_MARGIN = 0.008;
/**
 * A skipping stone: metres from the eye to its first touch (the first water the eye sees past the
 * crest of the meadow), the length of its first hop, and how the hops shorten.
 */
const SKIP_START = 43;
const SKIP_HOP = 9.5;
const SKIP_SHORTEN = 0.8;

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
        /** Petals and seed the meadow lets go of as play runs hot, owed to the air (drift). */
        this.driftFeed = 0;
        this.thrown = 0;
        this.fishClock = 3;
        /** Which sky flowers have opened, and how many times each stone has touched (by emitter). */
        this.opened = new Map();
        this.hops = new Map();
        /** How much of its full size the flower now opening may take (blossomSpot keeps it). */
        this.blossomFit = 1;
        /** Unit vector toward the sun (apply() keeps it): the stone skips down its road. */
        this.sun = new THREE.Vector3(-0.25, 0.16, -0.95);
        this.heart = new THREE.Vector3();
        /** Where the maypole's head is seen on screen (scratch for blossomSpot). */
        this.seen = { x: 0.25, y: 0.1, depth: 0 };
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        this.front = {
            x: 0, width: 20, strength: 0, direction: 1,
        };
        /** Every front crossing, in world x: one reused slot each, null where none crosses. */
        this.frontSlots = Array.from({ length: FRONT_SLOTS }, () => ({
            x: 0, width: 20, strength: 0, direction: 1,
        }));
        this.env = {
            windX: 1,
            windZ: 0,
            wind: 0.3,
            gust: 0,
            glow: 0,
            heat: 0,
            settled: false,
            front: null,
            fronts: Array.from({ length: FRONT_SLOTS }, () => null),
            fields: this.fields,
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
        this.driftFeed = 0;
        this.fishClock = 3;
    }

    /** Start counting afresh when the reactions have been reset. */
    follow(epoch) {
        if (epoch === this.epoch) return;
        this.epoch = epoch;
        this.serials.clear();
        this.emitted.clear();
        this.opened.clear();
        this.hops.clear();
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

    /**
     * A hard drop comes down like a stone in the grass: a ring of the piece's own petals is
     * knocked off the flowers under it and leaps out of the meadow to both sides of the board's
     * foot, pollen among them, and the dandelion clocks let go of their seed. (The spot is
     * behind the card: the ring is thrown wide and high enough to be seen leaving it.)
     */
    seeds(emitter, fresh = false) {
        const { sim } = this;
        const spot = this.meadowAt(emitter.column, this.foot);
        if (fresh) {
            const ring = Math.round((26 + 30 * emitter.strength) * this.scale);
            for (let i = 0; i < ring; i += 1) {
                const angle = (i / ring) * Math.PI * 2 + this.random() * 0.2;
                const speed = (5.5 + 3 * emitter.strength) * (0.85 + 0.3 * this.random());
                const x = spot.x + Math.cos(angle) * 0.4;
                const z = spot.z + Math.sin(angle) * 0.3;
                const pollen = i % 4 === 3;
                sim.spawn(
                    x,
                    // Over the heads of the flowers: among them it would never be seen.
                    this.above(x, 0, z, FLOWER_TOPS + 0.15) + 0.3 * this.random(),
                    z,
                    Math.cos(angle) * speed,
                    2.2 + 1.6 * this.random(),
                    Math.sin(angle) * speed * 0.6,
                    {
                        life: 1.3 + 0.8 * this.random(),
                        kind: pollen ? POLLEN : PETAL,
                        flower: emitter.flower,
                        size: pollen ? 0.1 : 0.09 + 0.06 * this.random(),
                        // The air carries it out before it starts to fall.
                        hang: pollen ? 0 : 0.3,
                    },
                );
            }
        }
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

    /**
     * The meadow lets go: petals and seed lift off the flowers all across the view and drift up
     * into the light on the breeze, slower and higher than a quad's rising meadow.
     */
    drift(count, windX, windZ) {
        const { stage, sim } = this;
        for (let i = 0; i < count; i += 1) {
            // Across the whole view, crowded a little toward the near meadow where they read.
            const down = 0.55 + 0.43 * Math.sqrt(this.random());
            const spot = stage.ground(this.random(), down, this.groundHeight, this.foot);
            const floor = this.groundHeight(spot.x, spot.z);
            if (floor > 0.1) {
                const seed = this.random() < 0.4;
                sim.spawn(
                    spot.x,
                    floor + 0.3 + 0.7 * this.random(),
                    spot.z,
                    (this.random() - 0.5) * 0.8 + windX * 0.7,
                    1.4 + 2.4 * this.random(),
                    (this.random() - 0.5) * 0.8 + windZ * 0.7,
                    {
                        life: 3.6 + 3 * this.random(), kind: seed ? SEED : PETAL, size: 0.06 + 0.05 * this.random(),
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

    /**
     * Where a sky flower opens, and how large it may be there (`this.blossomFit`, a share of its
     * full size). The six of a perfect clear take the open air to either side of the board and
     * its score panel, in turn. Where a side is wide they stand in two columns; where it is
     * narrow (the score panel's side in single player) they stand one above another in the
     * middle of it, drawn small enough to fit; where there is no room beside the board at all
     * (an upright screen) they open in a row above it. The bouquet's own opens about the maypole's
     * head, or, where the board stands in front of the pole, in the open air nearest it. Wherever
     * it opens, a flower's whole rim is kept clear of the card, the panel, the screen's edges and
     * the meadow under it.
     */
    blossomSpot(emitter, target) {
        const { stage, maypole } = this;
        const { board } = stage;
        const covered = stage.covered();
        const full = this.blossomRadius(emitter);
        const crowning = emitter.lines === BLOSSOM_MAYPOLE && Boolean(maypole);
        // (Anything that is not a spot's number takes the first: a junk payload opens a flower, not an error.)
        const index = Number.isFinite(emitter.lines)
            ? Math.max(0, Math.round(emitter.lines)) % BLOSSOM_SPOTS.length : 0;
        const [across, down, away] = BLOSSOM_SPOTS[index];
        const depth = crowning ? BLOSSOM_CROWN_DEPTH : away;
        // What a share of the screen's width, and of its height, is in metres at the flower's depth.
        const wide = 2 * stage.tanH * depth;
        const tall = 2 * stage.tanV * depth;
        let left = index % 2 === 0;
        let sx = 0.5;
        let sy = down;
        if (crowning) {
            // The bouquet's flower opens about the pole's head as the eye sees it, as near as the
            // others, so it is as large and as crisp as they are.
            const seen = stage.project(maypole.top, this.seen);
            sx = seen ? seen.x : 0.25;
            sy = seen ? seen.y : 0.1;
            left = sx < (covered.x0 + covered.x1) / 2;
        }
        const room = left ? covered.x0 : 1 - covered.x1;
        if (room < 0.14) {
            // No room beside the board: a row above it (the bouquet's flower in the middle of it).
            // Each is fitted to its sixth of the width and to the gap between the screen's top
            // and the board's.
            const strip = 1 / BLOSSOM_SPOTS.length;
            const gap = Math.max(0.06, board.y0);
            this.blossomFit = Math.min(1, (0.46 * strip * wide) / full, (0.46 * gap * tall) / full);
            sx = crowning ? 0.5 : (index + 0.5) * strip;
            sy = Math.max(0.06, board.y0 * 0.55);
        } else {
            const stacked = room < 0.3 && !crowning;
            // The strip's width is all the room the petals have: the flower is drawn to fit it.
            this.blossomFit = Math.min(1, (0.46 * room * wide) / full) * (stacked ? BLOSSOM_STACKED : 1);
            if (stacked) {
                sx = left ? covered.x0 * 0.5 : covered.x1 + room * 0.5;
                sy = BLOSSOM_STACK[Math.floor(index / 2) % BLOSSOM_STACK.length];
            } else if (!crowning) sx = left ? covered.x0 * (1 - across) : covered.x1 + room * across;
            // Its whole rim stays in the strip: never behind the card or the panel, never off the side.
            const half = (full * this.blossomFit) / wide + BLOSSOM_MARGIN;
            sx = Math.min(Math.max(sx, (left ? 0 : covered.x1) + half), (left ? covered.x0 : 1) - half);
        }
        // Its rim stays under the top of the screen (the bouquet's may lose a sliver of it there,
        // to sit as close about the pole's head as it can).
        sy = Math.max(sy, ((full * this.blossomFit) / tall) * (crowning ? 0.8 : 1) + 0.02);
        stage.point(sx, sy, depth, target);
        // And it opens over the heads of the meadow's flowers, not among them.
        const floor = Math.max(0, this.groundHeight(target.x, target.z)) + FLOWER_TOPS
            + 0.7 * full * this.blossomFit;
        if (target.y < floor) target.setY(floor);
        return target;
    }

    /** A sky flower's radius in metres at its full size, before it is fitted to its place. */
    blossomRadius(emitter) {
        const strength = Math.max(0.2, Number.isFinite(emitter.strength) ? emitter.strength : 0.2);
        return BLOSSOM_REACH * (0.75 + 0.35 * strength) * (emitter.lines === BLOSSOM_MAYPOLE ? 1.15 : 1);
    }

    /**
     * A flower opens in the sky: a thread of light climbs from below, and where it stops the
     * petals of one kind are flung out of a glowing heart to their places in a flower drawn in
     * the air: five to eight great petals round a heart of gold, each of them made of the small
     * ones. The air holds it a moment, so it is seen as the flower it is; then the petals let go
     * and fall. `flower` outside the seven makes it a flower of every colour.
     */
    blossom(emitter) {
        if (emitter.age < 0) return;
        const { sim, stage } = this;
        const heart = this.blossomSpot(emitter, this.heart);
        const strength = Math.max(0.2, emitter.strength);
        const mixed = !(emitter.flower >= 0 && emitter.flower < FLOWER_KINDS);
        if (emitter.age < BLOSSOM_RISE) {
            const count = this.due(emitter, 22 * this.scale, BLOSSOM_RISE);
            for (let i = 0; i < count; i += 1) {
                const climbed = Math.min(1, (emitter.age + this.random() * 0.03) / BLOSSOM_RISE);
                const eased = 1 - (1 - climbed) * (1 - climbed);
                const x = heart.x + (this.random() - 0.5) * 0.25;
                const z = heart.z + (this.random() - 0.5) * 0.25;
                sim.spawn(
                    x,
                    // (Never from under the meadow: the thread starts over the grass.)
                    this.above(x, heart.y - BLOSSOM_CLIMB * (1 - eased), z, 0.35),
                    z,
                    (this.random() - 0.5) * 0.6,
                    1.5 + this.random(),
                    (this.random() - 0.5) * 0.6,
                    { life: 0.5 + 0.4 * this.random(), kind: POLLEN, size: 0.1 + 0.06 * this.random() },
                );
            }
            return;
        }
        if (this.opened.get(emitter.id) === true) return;
        this.opened.set(emitter.id, true);
        const lobes = mixed ? 7 : 5 + (emitter.flower % 4);
        // The bouquet's flower crowning the maypole is a little larger and has more petals in it;
        // one in a narrow strip beside the score panel is drawn to fit it.
        const crowning = emitter.lines === BLOSSOM_MAYPOLE;
        const radius = this.blossomRadius(emitter) * this.blossomFit;
        const reach = radius * PETAL_DRAG;
        const total = Math.round(BLOSSOM_PETALS * this.scale * strength * (crowning ? 1.25 : 1));
        const turn = emitter.seed * Math.PI * 2;
        const wedge = Math.PI / lobes;
        for (let i = 0; i < total; i += 1) {
            // One of the flower's great petals, and a place inside it: thin at the heart, widest
            // two thirds of the way out, closing at the tip (most of the small petals lie toward
            // the rim, where the outline is).
            const along = 0.2 + 0.8 * Math.sqrt(this.random());
            const breadth = Math.sin(along * Math.PI) ** 0.75 * wedge * 0.8;
            const angle = turn + (i % lobes) * wedge * 2 + (this.random() * 2 - 1) * breadth;
            // Thrown from the heart so that the air stops it at its place.
            const speed = reach * along * (0.94 + 0.12 * this.random());
            const across = Math.cos(angle) * speed;
            const up = Math.sin(angle) * speed;
            const out = (this.random() - 0.5) * 0.5;
            sim.spawn(
                heart.x,
                heart.y,
                heart.z,
                stage.right.x * across + stage.up.x * up + stage.forward.x * out,
                stage.right.y * across + stage.up.y * up + stage.forward.y * out,
                stage.right.z * across + stage.up.z * up + stage.forward.z * out,
                {
                    life: BLOSSOM_HANG + 2 + 1.6 * this.random(),
                    kind: PETAL,
                    flower: mixed ? (i % lobes) % FLOWER_KINDS : emitter.flower,
                    size: (0.09 + 0.06 * this.random()) * (radius / BLOSSOM_REACH) ** 0.5,
                    hang: BLOSSOM_HANG * (0.8 + 0.5 * this.random()),
                    shine: 0.4,
                },
            );
        }
        // The heart of the flower: a small gold light, and a ring of pollen thrown off it.
        sim.spawn(heart.x, heart.y, heart.z, 0, 0, 0, {
            life: 1.5, kind: GLOW, flower: 1, size: radius * 0.95,
        });
        const stamens = Math.round(18 * this.scale);
        for (let i = 0; i < stamens; i += 1) {
            const angle = (i / stamens) * Math.PI * 2;
            const speed = reach * 0.17 * (0.7 + 0.6 * this.random());
            sim.spawn(
                heart.x,
                heart.y,
                heart.z,
                (stage.right.x * Math.cos(angle) + stage.up.x * Math.sin(angle)) * speed,
                (stage.right.y * Math.cos(angle) + stage.up.y * Math.sin(angle)) * speed,
                (stage.right.z * Math.cos(angle) + stage.up.z * Math.sin(angle)) * speed,
                { life: 1 + 0.8 * this.random(), kind: POLLEN, size: 0.1 + 0.05 * this.random() },
            );
        }
    }

    /**
     * A stone skips down the sun's road: each touch leaves a ring a little further out and a
     * little fainter, the hops shortening as it loses way, and a few drops jump where it touched.
     */
    skip(emitter) {
        if (emitter.age < 0) return;
        const { stage, sim, ripples } = this;
        const hops = Math.max(3, Math.min(8, Math.round(emitter.lines) || 5));
        const done = this.serials.get(emitter.id) === emitter.serial ? (this.hops.get(emitter.id) || 0) : 0;
        // The stone slows: its touches come quicker and quicker (a geometric run of intervals).
        const due = Math.min(hops, Math.floor(
            Math.log(1 - Math.min(0.999, emitter.age / emitter.duration) * (1 - SKIP_SHORTEN ** hops))
                / Math.log(SKIP_SHORTEN),
        ) + 1);
        const flat = Math.hypot(this.sun.x, this.sun.z) || 1;
        const dx = this.sun.x / flat;
        const dz = this.sun.z / flat;
        for (let hop = done; hop < due; hop += 1) {
            const out = SKIP_START + SKIP_HOP * ((1 - SKIP_SHORTEN ** hop) / (1 - SKIP_SHORTEN));
            const x = stage.origin.x + dx * out;
            const z = stage.origin.z + dz * out;
            if (this.groundHeight(x, z) < -0.05) {
                const fade = SKIP_SHORTEN ** hop;
                ripples?.add(x, z, (1 + 1.6 * emitter.strength) * (0.4 + 0.6 * fade));
                // A glint where the stone touches: the splash catching the sun.
                sim.spawn(x, 0.3, z, 0, 0, 0, {
                    life: 0.8, kind: GLOW, flower: FLOWER_KINDS, size: 2.2 + 2.4 * fade,
                });
                const drops = Math.round((5 + 6 * fade) * this.scale);
                for (let i = 0; i < drops; i += 1) {
                    sim.spawn(
                        x,
                        0.12,
                        z,
                        dx * 2.4 + (this.random() - 0.5) * 1.6,
                        2.2 + 2.4 * this.random() * fade,
                        dz * 2.4 + (this.random() - 0.5) * 1.6,
                        { life: 0.5 + 0.4 * this.random(), kind: POLLEN, size: 0.09 + 0.07 * this.random() },
                    );
                }
            }
        }
        this.hops.set(emitter.id, due);
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
     * Apply one director frame. `wind` is {x, z, strength} from the light rig and `worn` the
     * world's reading of play (SummerWorld.wear: level, fever, Reduce motion's share); returns
     * the environment for SummerPetalSim.step(), with the fronts crossing in world x.
     */
    apply(frame = {}, dt = 0, wind = { x: 1, z: 0, strength: 0.3 }, worn = null, sun = null) {
        const {
            fields, stage, ripples, waves,
        } = this;
        fields.length = 0;
        this.follow(frame.epoch);
        if (sun && Number.isFinite(sun.x) && Number.isFinite(sun.z)) this.sun.copy(sun);
        const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const emitters = frame.emitters || [];
        for (let i = 0; i < emitters.length; i += 1) {
            const emitter = emitters[i];
            const fresh = this.serials.get(emitter.id) !== emitter.serial;
            if (fresh) {
                this.serials.set(emitter.id, emitter.serial);
                this.emitted.set(emitter.id, 0);
                this.hops.set(emitter.id, 0);
                this.opened.delete(emitter.id);
            }
            if (emitter.kind === 'lock') this.lock(emitter, fresh);
            else if (emitter.kind === 'seeds') this.seeds(emitter, fresh);
            else if (emitter.kind === 'blossom') this.blossom(emitter);
            else if (emitter.kind === 'skip') this.skip(emitter);
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
        // As play runs hot the meadow lets go of its petals and seed into the air: a few in hot
        // play, a steady breath of them in a fever.
        const level = worn && Number.isFinite(worn.level) ? Math.max(0, Math.min(1, worn.level)) : 0;
        const fever = worn && Number.isFinite(worn.fever) ? Math.max(0, Math.min(1, worn.fever)) : 0;
        const motion = worn && Number.isFinite(worn.motion) ? Math.max(0, Math.min(1, worn.motion)) : 1;
        const breath = Math.max(0, level - 0.3) * 24 + fever * 150;
        if (breath > 0 && frame.settled !== true) {
            this.driftFeed += step * breath * this.scale * (0.5 + 0.5 * motion);
            const count = Math.floor(this.driftFeed);
            if (count > 0) {
                this.driftFeed -= count;
                this.drift(count, Number.isFinite(wind.x) ? wind.x : 1, Number.isFinite(wind.z) ? wind.z : 0);
            }
        } else this.driftFeed = 0;
        const { env } = this;
        env.windX = wind.x;
        env.windZ = wind.z;
        env.wind = Number.isFinite(wind.strength) ? wind.strength : 0.3;
        env.gust = Number.isFinite(frame.gust) ? Math.max(0, Math.min(1, frame.gust)) : 0;
        // The down and petals in the air glow with the evening (play raises its floor: wear()).
        const glow = worn && Number.isFinite(worn.glow) ? worn.glow : frame.glow;
        env.glow = Number.isFinite(glow) ? glow : 0;
        env.heat = Number.isFinite(frame.heat) ? frame.heat : 0;
        env.settled = frame.settled === true;
        if (frame.front && frame.front.strength > 0.001) {
            this.front.x = frame.front.position * stage.halfWidth(40);
            this.front.strength = frame.front.strength;
            this.front.direction = frame.front.direction;
            env.front = this.front;
        } else env.front = null;
        // Every front crossing; a frame that names only one front has that one.
        const crossing = Array.isArray(frame.fronts) ? frame.fronts : [frame.front];
        for (let i = 0; i < FRONT_SLOTS; i += 1) {
            const front = crossing[i];
            if (front && Number.isFinite(front.position) && front.strength > 0.001) {
                const slot = this.frontSlots[i];
                slot.x = front.position * stage.halfWidth(40);
                slot.strength = front.strength;
                slot.direction = front.direction;
                env.fronts[i] = slot;
            } else env.fronts[i] = null;
        }
        return env;
    }
}
