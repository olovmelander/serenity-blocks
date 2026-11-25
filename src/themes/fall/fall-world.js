/**
 * Fall — the enchanted grove, shared by the isolated playground and both player backends.
 *
 * FallWorld is the composition root: it owns the light rig, the forest floor, the trees
 * and the air, frames the camera, and forwards gameplay envelopes to them each frame (the
 * director's frame: its envelopes, fronts, and what the surge of play asks of the grove). It
 * also keeps the grove's light: the clock turns it by itself and every level is one light on
 * (fall-moods.js).
 */
import * as THREE from 'three/webgpu';
import { FallAtmosphere } from './fall-atmosphere.js';
import { FallBackdrop } from './fall-backdrop.js';
import { FALL_FEATURE_TREES, FALL_VIEWS, fallViewFor } from './fall-composition.js';
import { FallForest } from './fall-forest.js';
import { FallLeafDirector } from './fall-leaf-director.js';
import { FallLeaves } from './fall-leaves.js';
import { FallLight } from './fall-light.js';
import { FALL_MOODS, fallMoodDrift, fallMoodName } from './fall-moods.js';
import { FALL_AIRS, fallAirDrift, fallAirName } from './fall-airs.js';
import {
    FALL_HAPPENINGS, createFallHappening, fallHappeningAt, fallHappeningHeld, fallShaftAt,
} from './fall-happenings.js';
import { FallVisitors } from './fall-visitors.js';
import { fallTier } from './fall-quality.js';
import { FallStage } from './fall-stage.js';
import { createSquirrelSteps } from './fall-squirrel.js';
import { createPerches } from './fall-squirrel-limbs.js';
import { SquirrelMind } from './fall-squirrel-mind.js';
import {
    SQUIRREL_TRUNK_SPAN, TrunkSurface, createSquirrelStage, measureTrunkSteps,
} from './fall-squirrel-stage.js';
import { FallTerrain, fallTerrainHeight } from './fall-terrain.js';
import { FallUnderstory } from './fall-understory.js';
import { FALL_SLICE_MS, fallSlice } from './fall-slices.js';
import { easeStep, nearestStep } from '../shared/mood-clock.js';
import { drainSteps, stepClock } from '../shared/build-steps.js';

/** How quickly the grove takes a level's step, per second: most of the way in four seconds. */
const MOOD_FOLLOW = 0.6;
/** The squirrel's trees: the hero maple left of the board and the hero oak right of it. */
const SQUIRREL_TREES = Object.freeze({ maple: FALL_FEATURE_TREES[0], oak: FALL_FEATURE_TREES[1] });
/** Which of the director's emitters startle the squirrel, and how (a lock only after a long drop). */
const SQUIRREL_CUES = Object.freeze({
    clear: 'clear', shower: 'four', combo: 'combo', spin: 'spin', crown: 'perfect', twin: 'combo',
});
/** A lock's emitter strength is 0.24 + 0.5 x the drop: from about half the board's height it startles. */
const DROP_CUE = 0.45;
/**
 * The litter the squirrel stirs: leaves a second thrown out behind its paws while it digs, how many
 * a landing on the floor puffs up, and how fast they go (metres a second).
 */
const SQUIRREL_LITTER = Object.freeze({ dig: 7, landing: 4, speed: 2.1 });

export class FallWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets, squirrel = true, squirrelSeed = 271,
        squirrelStart = 'crown', squirrelScript = [], happenSeed = null,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = fallTier(quality);
        this.rng = rng;
        this.assets = assets;
        this.group = new THREE.Group();
        this.group.name = 'Fall — enchanted grove';
        this.disposed = false;
        this.built = false;
        // The grove's light: the clock turns it, and every level is one light on. `moodStep` is
        // the level's step as eased so far, and `moodStart` the seconds of day the theme had
        // already lived before this world's clock began (a rebuild picks the light up there).
        this.level = 1;
        this.moodStep = 0;
        this.moodStart = 0;
        // The grove's air (fall-airs.js): its own clock beside the light's, a level one air on too.
        // `airHold` pins one air (a capture, the playground's ?air=).
        this.airStep = 0;
        this.airHold = null;
        // The grove's happenings (fall-happenings.js): what comes by, on the same lived clock. Their
        // order is dealt from a seed (the squirrel's, unless one is given: a new day for both).
        this.happenSeed = Number.isFinite(happenSeed) ? happenSeed >>> 0 : (Number(squirrelSeed) >>> 0) || 0;
        this.happenings = true;
        this.happenHold = null;
        this.happening = createFallHappening();
        this.shaft = {
            x: 0, z: 0, radius: 5, strength: 0, cloud: 0,
        };
        // The red squirrel (fall-squirrel*.js): off with ?squirrel=0 or when its asset did not arrive.
        this.squirrelWanted = squirrel;
        this.squirrelSeed = squirrelSeed;
        this.squirrelStart = squirrelStart;
        this.squirrelScript = squirrelScript;
        this.squirrelSerial = -1;
        this.time = 0;
        // The litter it stirs (squirrelLitter): what is owed of the dig's leaves, the leap whose
        // landing has puffed, and a generator of its own (the grove's draws stay as they were).
        this.squirrelDig = 0;
        this.squirrelLanded = null;
        this.squirrelDice = 20261;
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, a part or two to a step (shared/build-steps.js breathes between them):
     * the whole grove in one call was a ~80 ms task on every Fall start, the switch's longest
     * frame (docs/THEME_FLEET_240_2026-10.md §13). Same parts, same order, same random draws. The
     * floor, the grove, the understory and the squirrel build a time slice a step themselves (single
     * steps of 18-40 ms on a first visit before, 2026-10-31).
     */
    * buildSteps() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed FallWorld.');
        if (this.built) return;
        if (!this.assets) throw new Error('[Fall] FallWorld needs its loaded assets before it can build.');
        this.built = true;
        this.scene.add(this.group);
        this.light = new FallLight({ tier: this.tier, rng: this.rng });
        this.light.addTo(this.group);
        this.light.frameShadows();
        // Each part is owned before it builds: if one throws halfway, dispose() still
        // reaches whatever it had already made.
        const { light, tier, rng } = this;
        const { foliage, impostors } = this.assets;
        this.terrain = new FallTerrain({ light, rng });
        this.group.add(this.terrain.group);
        yield 'light';
        yield* this.terrain.buildSteps();
        yield 'terrain';
        this.forest = new FallForest({
            light, assets: this.assets, tier, rng,
        });
        this.group.add(this.forest.group);
        yield* this.forest.buildSteps();
        yield 'forest';
        this.understory = new FallUnderstory({
            light, foliage, tier, rng, quality: this.quality, trees: this.assets.trees,
        });
        this.group.add(this.understory.group);
        yield* this.understory.buildSteps();
        yield 'understory';
        this.backdrop = new FallBackdrop({
            light, impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        this.atmosphere = new FallAtmosphere({
            light, tier, rng, quality: this.quality,
        });
        this.group.add(this.atmosphere.group);
        this.atmosphere.build();
        yield 'backdrop and air';
        const crownPoints = this.forest.sampleCrownPoints(Math.min(900, tier.leaves));
        this.leaves = new FallLeaves({
            light, foliage, tier, rng, crownPoints,
        });
        this.group.add(this.leaves.group);
        this.leaves.build();
        yield 'leaves';
        // The visitors a happening brings (fall-visitors.js): geese, jays, acorns.
        this.visitors = new FallVisitors({
            light, quality: this.quality, groundHeight: fallTerrainHeight, crownPoints,
        }).build();
        this.group.add(this.visitors.group);
        yield* this.buildSquirrelSteps();
        yield 'squirrel';
        this.prepareCamera(this.camera.aspect);
        this.director = new FallLeafDirector({
            stage: this.stage,
            sim: this.leaves.sim,
            tier: this.tier,
            rng: this.rng,
            crownPoints,
            groundHeight: fallTerrainHeight,
        });
    }

    /**
     * The squirrel: its two trunks measured from their bark, its mind, its body. Nothing when the
     * asset is missing (the grove is whole without it).
     */
    buildSquirrel() {
        drainSteps(this.buildSquirrelSteps());
    }

    /** buildSquirrel(), a time slice a step: each trunk measured, then the body. */
    * buildSquirrelSteps() {
        const gltf = this.assets.squirrel;
        if (!this.squirrelWanted || !gltf) return;
        const clock = stepClock(FALL_SLICE_MS);
        const trunks = {};
        for (const [name, tree] of Object.entries(SQUIRREL_TREES)) {
            yield* fallSlice(clock, 'squirrel trunks');
            const asset = this.assets.trees[tree.asset];
            if (!asset?.bark?.index) return;
            const { bark } = asset;
            const colour = bark.attributes.color;
            const sway = colour ? Float32Array.from({ length: colour.count }, (_, i) => colour.getX(i)) : null;
            trunks[name] = new TrunkSurface(yield* measureTrunkSteps({
                positions: bark.attributes.position.array,
                index: bark.index.array,
                sway,
                place: {
                    x: tree.x, y: fallTerrainHeight(tree.x, tree.z), z: tree.z, yaw: tree.yaw, scale: tree.scale,
                },
                span: SQUIRREL_TRUNK_SPAN[name],
            }, clock), name);
        }
        const eye = FALL_VIEWS.landscape.position;
        // Its boughs, and its perches close to the eye: of the trees that arrived.
        const perches = createPerches({
            placements: FALL_FEATURE_TREES.filter((tree) => this.assets.trees[tree.asset]),
            groundHeight: fallTerrainHeight,
            eye: [eye[0], eye[1], eye[2]],
        });
        this.squirrelStage = createSquirrelStage({
            trunks,
            groundHeight: fallTerrainHeight,
            eye: [eye[0], eye[1], eye[2]],
            limbs: perches.limbs,
            pads: perches.pads,
        });
        this.squirrelMind = new SquirrelMind({
            stage: this.squirrelStage, seed: this.squirrelSeed, start: this.squirrelStart, script: this.squirrelScript,
        });
        yield* fallSlice(clock, 'squirrel trunks');
        this.squirrel = yield* createSquirrelSteps({
            light: this.light, gltf, clock, quality: this.quality,
        });
        this.group.add(this.squirrel.group, this.squirrel.shade);
        this.squirrelPose = null;
    }

    /** Tell the squirrel what the board did: the director's new emitters, once each. */
    cueSquirrel(time, frame) {
        const mind = this.squirrelMind;
        if (!mind || !Array.isArray(frame?.emitters)) return;
        let newest = this.squirrelSerial;
        for (const emitter of frame.emitters) {
            if (emitter.serial > this.squirrelSerial) {
                newest = Math.max(newest, emitter.serial);
                const at = Math.max(0, time - (Number.isFinite(emitter.age) ? emitter.age : 0));
                if (emitter.kind === 'lock') {
                    if (emitter.strength >= DROP_CUE) mind.cue('drop', at, (emitter.strength - 0.24) / 0.5);
                } else if (SQUIRREL_CUES[emitter.kind] && !(emitter.kind === 'clear' && emitter.side > 0)) {
                    // (Both sides of a clear are one clear.)
                    mind.cue(SQUIRREL_CUES[emitter.kind], at, emitter.strength);
                }
            }
        }
        this.squirrelSerial = newest;
    }

    /**
     * The squirrel in the leaves: a dig throws them out behind it, a landing on the floor puffs a few
     * up. Leaves of the air's own reserve (never one in flight); nothing when there is none to spare.
     */
    squirrelLitter(dt) {
        const mind = this.squirrelMind;
        const pose = this.squirrelPose;
        const sim = this.leaves?.sim;
        const act = mind?.act;
        if (!pose?.visible || !sim || !act || !(dt > 0)) return;
        const dice = () => {
            this.squirrelDice = (Math.imul(this.squirrelDice, 1103515245) + 12345) & 0x7fffffff;
            return this.squirrelDice / 0x7fffffff;
        };
        const [qx, qy, qz, qw] = pose.quaternion;
        const forward = [2 * (qx * qz + qw * qy), 2 * (qy * qz - qw * qx), 1 - 2 * (qx * qx + qy * qy)];
        const [x, y, z] = pose.position;
        const onFloor = act.from.on === 'ground' && !mind.padOf(act.from);
        if (onFloor && act.kind === 'stay' && pose.clip === 'dig') {
            this.squirrelDig += dt * SQUIRREL_LITTER.dig;
            while (this.squirrelDig >= 1) {
                this.squirrelDig -= 1;
                const out = SQUIRREL_LITTER.speed * (0.6 + 0.8 * dice());
                const side = (dice() - 0.5) * 1.6;
                // Out behind it, between its hind legs, and up.
                sim.spawn(
                    x + forward[0] * 0.2,
                    y + 0.12,
                    z + forward[2] * 0.2,
                    -forward[0] * out + forward[2] * side,
                    1.6 + 1.8 * dice(),
                    -forward[2] * out - forward[0] * side,
                );
            }
        } else this.squirrelDig = 0;
        // A landing on the floor (not on a perch): once for each leap, as it touches down.
        if (act.kind === 'leap' && act.to.on === 'ground' && !mind.padOf(act.to) && this.squirrelLanded !== act
            && this.time >= act.t0 + act.crouch + act.flight) {
            this.squirrelLanded = act;
            for (let i = 0; i < SQUIRREL_LITTER.landing; i += 1) {
                const angle = dice() * Math.PI * 2;
                const out = SQUIRREL_LITTER.speed * (0.5 + 0.6 * dice());
                sim.spawn(
                    x + Math.cos(angle) * 0.25,
                    y + 0.1,
                    z + Math.sin(angle) * 0.25,
                    Math.cos(angle) * out,
                    1.2 + 1.4 * dice(),
                    Math.sin(angle) * out,
                );
            }
        }
    }

    /** The run ended: the squirrel takes cover behind its tree and peeks out. */
    onGameOver() {
        this.squirrelMind?.cue('over', this.time);
    }

    /** The measured board card in screen fractions (y down), or null for the default. */
    setBoard(rect) {
        this.stage?.setBoard(rect);
    }

    /**
     * A new level: the grove turns one light on from wherever the clock has brought it. Aloud it
     * eases there (see `update`); `silent` (a rebuilt world, a capture) is there at once. A new
     * run goes back to the first level's light the short way round.
     * @param {number} level
     * @param {{ silent?: boolean }} [options]
     */
    setLevel(level, { silent = false } = {}) {
        const wanted = Number(level);
        this.level = Number.isFinite(wanted) ? Math.max(1, Math.min(9999, Math.round(wanted))) : this.level;
        if (silent) {
            this.moodStep = nearestStep(this.moodStep, this.level - 1, FALL_MOODS.length);
            this.airStep = nearestStep(this.airStep, this.level - 1, FALL_AIRS.length);
        }
        return this.level;
    }

    /** How many airs into the wheel it is at `time`: the level's step and the clock's turn (or the held air). */
    airPhase(time = this.light?.uTime.value ?? 0) {
        if (this.airHold !== null) return this.airHold;
        return this.airStep + fallAirDrift(this.moodLived(time));
    }

    /**
     * Hold the grove in one air (its index on the wheel; a fraction stands between two), or let the
     * clock turn it again (null). For captures and the playground's ?air=.
     * @param {number | null} [index]
     */
    holdAir(index = null) {
        this.airHold = Number.isFinite(index) ? Number(index) : null;
        return this.airHold;
    }

    /** Let the happenings come (the default), or keep the grove to itself. */
    setHappenings(on = true) {
        this.happenings = on !== false;
        return this.happenings;
    }

    /**
     * Hold one happening for a capture or the playground: `kind` as if it began at `at` seconds on
     * this world's clock (null lets the clock deal them again). `roll` picks its variant (0..1).
     * @param {string | null} kind
     * @param {number} [at]
     * @param {number} [roll]
     */
    playHappening(kind = null, at = this.time, roll = 0.37) {
        this.happenHold = FALL_HAPPENINGS.includes(kind)
            ? { kind, at: Number.isFinite(at) ? at : 0, roll: Number.isFinite(roll) ? roll : 0.37 } : null;
        return this.happenHold;
    }

    /** What is happening at `time` on this world's clock (kind null: nothing). */
    happeningAt(time = this.light?.uTime.value ?? 0) {
        const hold = this.happenHold;
        if (hold) return fallHappeningHeld(hold.kind, hold.at, time, hold.roll, this.happening);
        if (!this.happenings) return fallHappeningHeld(null, 0, time, 0, this.happening);
        return fallHappeningAt(this.moodLived(time), this.happenSeed, this.happening);
    }

    /** Seconds of day lived at `time` on this world's clock, with what came before it. */
    moodLived(time = this.light?.uTime.value ?? 0) {
        const before = Number.isFinite(this.moodStart) ? Math.max(0, this.moodStart) : 0;
        return before + (Number.isFinite(time) ? Math.max(0, time) : 0);
    }

    /** How many lights into the day it is at `time`: the level's step and the clock's turn. */
    moodPhase(time = this.light?.uTime.value ?? 0) {
        return this.moodStep + fallMoodDrift(this.moodLived(time));
    }

    /** Forget every leaf in flight and every pending emitter (new session, settings off). */
    resetEffects() {
        this.director?.reset();
        this.leaves?.reset();
        // The director's serials start again from nothing.
        this.squirrelSerial = -1;
        this.squirrelDig = 0;
        this.squirrelLanded = null;
        this.squirrelDice = 20261;
    }

    prepareCamera(aspect) {
        const view = fallViewFor(Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9);
        const { camera } = this;
        camera.fov = view.fov;
        camera.near = 0.3;
        camera.far = 600;
        camera.position.set(
            view.position[0],
            view.position[1] + fallTerrainHeight(0, view.position[2]),
            view.position[2],
        );
        camera.lookAt(view.target[0], view.target[1], view.target[2]);
        camera.updateProjectionMatrix();
        if (!this.stage) this.stage = new FallStage(camera);
        else this.stage.refresh();
    }

    update(time, dt, frame = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const { light } = this;
        const direction = light.uWindDir.value;
        const env = this.director.apply(frame, dt, { x: direction.x, z: direction.z, strength: light.uWind.value });
        // The light: the clock turns it by itself (a function of the time alone, so a seek and a
        // day lived through agree); a level's step eases in on top, the short way round. A slow
        // change of colour is not motion and no effect: neither setting holds it back. A clock that
        // makes no sense stays where the light last was.
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        const follow = 1 - Math.exp(-step * MOOD_FOLLOW);
        this.moodStep = easeStep(this.moodStep, this.level - 1, follow, FALL_MOODS.length);
        this.airStep = easeStep(this.airStep, this.level - 1, follow, FALL_AIRS.length);
        const clock = Number.isFinite(time) ? time : light.uTime.value;
        light.setMood(this.moodPhase(clock));
        // The air turns the same way: its mist, wind, rain and cloud are the light rig's to hand on.
        light.setAir(this.airPhase(clock));
        // How fast the crowns let go is the air's to say (the great fall; a windy day).
        env.shed = light.airShed;
        // What comes by: a wandering shaft is the light's, the rest the visitors'.
        const happening = this.happeningAt(clock);
        if (happening.kind === 'shaft') {
            const shaft = fallShaftAt(happening.u, happening.roll, this.shaft);
            light.setSpot(shaft.x, shaft.z, shaft.radius, shaft.strength, shaft.cloud);
        } else light.setSpot();
        this.visitors?.update(clock, happening, this.stage, env, dt);
        light.update(time, { ...frame, front: env.front, fronts: env.fronts }, dt);
        this.leaves.update(dt, env, frame.heat);
        this.atmosphere.update(time, dt, frame);
        this.understory.update();
        if (this.squirrelMind && Number.isFinite(time)) {
            this.time = time;
            this.squirrelMind.motion = Number.isFinite(frame.motion) ? frame.motion : 1;
            this.cueSquirrel(time, frame);
            this.squirrelPose = this.squirrelMind.pose(time, this.squirrelPose || undefined);
            this.squirrel.update(this.squirrelPose);
            this.squirrelLitter(dt);
        }
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            ...(this.forest?.stats || {}),
            farTrees: this.backdrop?.count || 0,
            leaves: this.leaves?.sim?.counts() || null,
            level: this.level,
            // The light the grove is turning to, and how far round it is.
            mood: fallMoodName(nearestStep(this.moodStep, this.level - 1, FALL_MOODS.length)
                + fallMoodDrift(this.moodLived())),
            moodPhase: this.light?.moodPhase ?? 0,
            // The air it stands in, and how far round the wheel it is.
            air: fallAirName(this.light?.airPhase ?? 0),
            airPhase: this.light?.airPhase ?? 0,
            // What is happening in it just now (null: nothing).
            happening: this.happening.kind,
            // The squirrel, when the grove has one: what it is doing and where.
            ...(this.squirrel ? {
                squirrel: {
                    visible: Boolean(this.squirrelPose?.visible),
                    act: this.squirrelPose?.act ?? null,
                    clip: this.squirrelPose?.clip ?? null,
                    on: this.squirrelMind?.act?.from?.on ?? null,
                    position: (this.squirrelPose?.position || [0, 0, 0]).map((v) => Math.round(v * 100) / 100),
                },
            } : {}),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.squirrel?.dispose();
        this.squirrel = null;
        this.squirrelMind = null;
        this.leaves?.dispose();
        this.visitors?.dispose();
        this.visitors = null;
        this.atmosphere?.dispose();
        this.backdrop?.dispose();
        this.understory?.dispose();
        this.forest?.dispose();
        this.terrain?.dispose();
        this.light?.dispose();
        this.leaves = null;
        this.director = null;
        this.stage = null;
        this.atmosphere = null;
        this.backdrop = null;
        this.understory = null;
        this.forest = null;
        this.terrain = null;
        this.light = null;
        this.group.removeFromParent();
        this.group.clear();
    }
}
