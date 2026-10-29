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
import { fallTier } from './fall-quality.js';
import { FallStage } from './fall-stage.js';
import { createSquirrel } from './fall-squirrel.js';
import { SquirrelMind } from './fall-squirrel-mind.js';
import {
    SQUIRREL_TRUNK_SPAN, TrunkSurface, createSquirrelStage, measureTrunk,
} from './fall-squirrel-stage.js';
import { FallTerrain, fallTerrainHeight } from './fall-terrain.js';
import { FallUnderstory } from './fall-understory.js';
import { easeStep, nearestStep } from '../shared/mood-clock.js';
import { drainSteps } from '../shared/build-steps.js';

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

export class FallWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets, squirrel = true, squirrelSeed = 271,
        squirrelStart = 'crown', squirrelScript = [],
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
        // The red squirrel (fall-squirrel*.js): off with ?squirrel=0 or when its asset did not arrive.
        this.squirrelWanted = squirrel;
        this.squirrelSeed = squirrelSeed;
        this.squirrelStart = squirrelStart;
        this.squirrelScript = squirrelScript;
        this.squirrelSerial = -1;
        this.time = 0;
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, a part or two to a step (shared/build-steps.js breathes between them):
     * the whole grove in one call was a ~80 ms task on every Fall start, the switch's longest
     * frame (docs/THEME_FLEET_240_2026-10.md §13). Same parts, same order, same random draws.
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
        this.terrain.build();
        yield 'terrain';
        this.forest = new FallForest({
            light, assets: this.assets, tier, rng,
        });
        this.group.add(this.forest.group);
        this.forest.build();
        yield 'forest';
        this.understory = new FallUnderstory({
            light, foliage, tier, rng,
        });
        this.group.add(this.understory.group);
        this.understory.build();
        yield 'understory';
        this.backdrop = new FallBackdrop({
            light, impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        this.atmosphere = new FallAtmosphere({ light, tier, rng });
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
        this.buildSquirrel();
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
        const gltf = this.assets.squirrel;
        if (!this.squirrelWanted || !gltf) return;
        const trunks = {};
        for (const [name, tree] of Object.entries(SQUIRREL_TREES)) {
            const asset = this.assets.trees[tree.asset];
            if (!asset?.bark?.index) return;
            const { bark } = asset;
            const colour = bark.attributes.color;
            const sway = colour ? Float32Array.from({ length: colour.count }, (_, i) => colour.getX(i)) : null;
            trunks[name] = new TrunkSurface(measureTrunk({
                positions: bark.attributes.position.array,
                index: bark.index.array,
                sway,
                place: {
                    x: tree.x, y: fallTerrainHeight(tree.x, tree.z), z: tree.z, yaw: tree.yaw, scale: tree.scale,
                },
                span: SQUIRREL_TRUNK_SPAN[name],
            }), name);
        }
        const eye = FALL_VIEWS.landscape.position;
        this.squirrelStage = createSquirrelStage({
            trunks, groundHeight: fallTerrainHeight, eye: [eye[0], eye[1], eye[2]],
        });
        this.squirrelMind = new SquirrelMind({
            stage: this.squirrelStage, seed: this.squirrelSeed, start: this.squirrelStart, script: this.squirrelScript,
        });
        this.squirrel = createSquirrel({ light: this.light, gltf });
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
        if (silent) this.moodStep = nearestStep(this.moodStep, this.level - 1, FALL_MOODS.length);
        return this.level;
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
        light.setMood(this.moodPhase(Number.isFinite(time) ? time : light.uTime.value));
        light.update(time, { ...frame, front: env.front, fronts: env.fronts }, dt);
        this.leaves.update(dt, env, frame.heat);
        this.atmosphere.update(time, dt, frame);
        if (this.squirrelMind && Number.isFinite(time)) {
            this.time = time;
            this.squirrelMind.motion = Number.isFinite(frame.motion) ? frame.motion : 1;
            this.cueSquirrel(time, frame);
            this.squirrelPose = this.squirrelMind.pose(time, this.squirrelPose || undefined);
            this.squirrel.update(this.squirrelPose);
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
