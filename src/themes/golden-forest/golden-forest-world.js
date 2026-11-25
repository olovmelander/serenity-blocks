/**
 * Golden Forest — the lake at the golden hour, shared by the isolated playground and both
 * player backends.
 *
 * GoldenForestWorld is the composition root: it owns the light rig, the shores, the
 * conifers, the lake and the air, frames the camera, and forwards gameplay envelopes to
 * them each frame. It also keeps the lake's hour: the clock turns it by itself and every level
 * is one hour on (golden-forest-moods.js); and its air, which the clock turns on a pace of its
 * own (golden-forest-airs.js).
 */
import * as THREE from 'three/webgpu';
import { goldenForestAirDrift, goldenForestAirIndex, goldenForestAirName } from './golden-forest-airs.js';
import { GoldenForestAtmosphere } from './golden-forest-atmosphere.js';
import { GoldenForestBackdrop } from './golden-forest-backdrop.js';
import { GoldenForestBirds } from './golden-forest-birds.js';
import { GOLDEN_FOREST_VIEWS, goldenForestEye, goldenForestViewFor } from './golden-forest-composition.js';
import { seeded } from './golden-forest-crane-flight.js';
import { GoldenForestFlurry } from './golden-forest-flurry.js';
import { GoldenForestForest } from './golden-forest-forest.js';
import { GOLDEN_FOREST_MIRROR_LAYER, GOLDEN_FOREST_WAVE, GoldenForestLake } from './golden-forest-lake.js';
import { GoldenForestLight } from './golden-forest-light.js';
import { GOLDEN_FOREST_MOODS, goldenForestMoodDrift, goldenForestMoodName } from './golden-forest-moods.js';
import { goldenForestTier } from './golden-forest-quality.js';
import { GoldenForestRibbons } from './golden-forest-ribbons.js';
import { GoldenForestShore } from './golden-forest-shore.js';
import { GoldenForestSparkDirector } from './golden-forest-spark-director.js';
import { GoldenForestSparks } from './golden-forest-sparks.js';
import { GOLDEN_FOREST_STAGE_DEPTH, GoldenForestStage } from './golden-forest-stage.js';
import { GoldenForestTerrain, goldenForestGroundHeight } from './golden-forest-terrain.js';
import { drainSteps } from '../shared/build-steps.js';
import { easeStep, nearestStep } from '../shared/mood-clock.js';

/** How quickly the lake takes a level's step, per second: most of the way in four seconds. */
const MOOD_FOLLOW = 0.6;
/** Where a twist winds the water up: metres out from the card's edge, and back from its plane. */
const SWIRL_PLACE = Object.freeze({ out: 1.9, back: 0.6 });
/** Crown points the spruces breathe their pollen from: how many are drawn, and from how high up. */
const POLLEN_CROWNS = Object.freeze({ drawn: 420, kept: 110, above: 5.5 });

export class GoldenForestWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets, samples = 0,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = goldenForestTier(quality);
        /** The scene pass's samples; the lake's mirror takes the same (shared/scene-antialias.js). */
        this.samples = samples;
        this.rng = rng;
        this.assets = assets;
        this.group = new THREE.Group();
        this.group.name = 'Golden Forest — the lake at the golden hour';
        this.disposed = false;
        this.built = false;
        // The lake's hour: the clock turns it, and every level is one hour on. `moodStep` is the
        // level's step as eased so far, and `moodStart` the seconds of evening the theme had
        // already lived before this world's clock began (a rebuild picks the hour up there).
        this.level = 1;
        this.moodStep = 0;
        this.moodStart = 0;
        /** An air held still (its index) for a capture or a test; null lets the clock turn them. */
        this.airHold = null;
        /** Reduce motion's share (setMotion), and the envelopes as worn (wear()). */
        this.motion = 1;
        this.worn = {
            gust: 0,
            gustSpeed: 0,
            flock: 0,
            flockSpeed: 0,
            warmth: 0,
            level: 0,
            fever: 0,
            crown: 0,
            gold: 0,
            motion: 1,
            // The cloud's rush as the hour turns, the shores' gilding and the evening after a game.
            rush: 0,
            gild: 0,
            gildReach: 0,
            dusk: 0,
        };
        /** The lake's tracks as placed on the water this frame (kept, and filled again). */
        this.tracks = { waves: [], swirls: [], roads: [] };
        this.trackPool = Array.from({ length: 8 }, () => ({
            x: 0, z: 0, age: 0, strength: 0, turn: 1,
        }));
        this.trackPoint = new THREE.Vector3();
        /** Skeins of cranes called so far by this director (its epoch says when it started over). */
        this.flightsSeen = 0;
        this.flightEpoch = null;
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, a part to a step: run at once by build(), or with a breath between steps
     * while the theme comes in (shared/build-steps.js), so no single task holds the page for the
     * whole build. The same parts in the same order, drawing from the same random sequence.
     */
    * buildSteps() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed GoldenForestWorld.');
        if (this.built) return;
        if (!this.assets) throw new Error('[GoldenForest] The world needs its loaded assets before it can build.');
        this.built = true;
        this.scene.add(this.group);
        this.light = new GoldenForestLight({ tier: this.tier, rng: this.rng });
        this.light.addTo(this.group);
        this.light.frameShadows();
        // Each part is owned before it builds: if one throws halfway, dispose() still
        // reaches whatever it had already made.
        const { light, tier, rng } = this;
        const { impostors, props } = this.assets;
        this.terrain = new GoldenForestTerrain({ light });
        this.group.add(this.terrain.group);
        this.terrain.build();
        yield 'terrain';
        this.forest = new GoldenForestForest({
            light, assets: this.assets, tier, rng,
        });
        this.group.add(this.forest.group);
        this.forest.build();
        yield 'forest';
        this.backdrop = new GoldenForestBackdrop({
            light, impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        yield 'backdrop';
        this.atmosphere = new GoldenForestAtmosphere({ light, tier, rng });
        this.group.add(this.atmosphere.group);
        this.atmosphere.build();
        yield 'atmosphere';
        this.shore = new GoldenForestShore({
            light, props, tier, rng,
        });
        this.group.add(this.shore.group);
        this.shore.build();
        yield 'shore';
        this.birds = new GoldenForestBirds({
            light, tier, rng, crane: this.assets.crane, camera: this.camera,
        });
        this.group.add(this.birds.group);
        this.birds.build();
        yield 'birds';
        this.ribbons = new GoldenForestRibbons({ light, tier });
        this.group.add(this.ribbons.group);
        this.ribbons.build();
        yield 'ribbons';
        this.sparks = new GoldenForestSparks({
            tier, rng, homes: this.fireflyHomes(), groundHeight: goldenForestGroundHeight,
        });
        this.group.add(this.sparks.group);
        this.sparks.build();
        yield 'sparks';
        // What the events throw (its own random stream: the fireflies and the lake draw as before).
        this.flurry = new GoldenForestFlurry({
            light, tier, rng: seeded(0x9f01d), groundHeight: goldenForestGroundHeight,
        });
        this.group.add(this.flurry.group);
        this.flurry.build();
        this.flurry.crowns = this.pollenCrowns();
        yield 'flurry';
        this.lake = new GoldenForestLake({
            light, tier, lakeMap: this.terrain.lakeMap, samples: this.samples,
        });
        this.group.add(this.lake.group);
        this.lake.build();
        yield 'lake';
        this.reflect([this.terrain.group, this.forest.group, this.backdrop.group, this.atmosphere.group,
            this.shore.group, this.birds.group, this.ribbons.group, this.sparks.group, this.flurry.group]);
        this.atmosphere.keepOutOfMirror(GOLDEN_FOREST_MIRROR_LAYER);
        this.prepareCamera(this.camera.aspect);
        this.director = new GoldenForestSparkDirector({
            stage: this.stage,
            sim: this.sparks.sim,
            ripples: this.lake.ripples,
            tier,
            rng,
            groundHeight: goldenForestGroundHeight,
        });
    }

    /** Put these parts of the scene in the lake's mirror. */
    reflect(roots) {
        roots.forEach((root) => root?.traverse((object) => object.layers.enable(GOLDEN_FOREST_MIRROR_LAYER)));
    }

    /** The measured board card in screen fractions (y down), or null for the default. */
    setBoard(rect) {
        this.stage?.setBoard(rect);
    }

    /** Where fireflies keep house: the lower boughs by the water, the reeds and the shallows. */
    fireflyHomes() {
        const { rng } = this;
        const homes = [];
        const boughs = this.forest.sampleCrownPoints(260);
        for (let i = 0; i < boughs.length; i += 3) {
            if (boughs[i + 1] < 7.5 && boughs[i + 2] > -70) homes.push(boughs[i], boughs[i + 1], boughs[i + 2]);
        }
        for (let i = 0; i < 220; i += 1) {
            const x = (rng() * 2 - 1) * 30;
            const z = 10 - rng() * 44;
            const ground = goldenForestGroundHeight(x, z);
            homes.push(x, Math.max(0, ground) + 0.3 + rng() * (ground < 0 ? 1.5 : 2.6), z);
        }
        return new Float32Array(homes);
    }

    /**
     * Crown points high in the near conifers, for their pollen: drawn with a generator of their
     * own, so the rest of the world is built from the same random stream as ever.
     */
    pollenCrowns() {
        const points = this.forest.sampleCrownPoints(POLLEN_CROWNS.drawn, seeded(0x70117e));
        const kept = [];
        for (let i = 0; i < points.length && kept.length < POLLEN_CROWNS.kept * 3; i += 3) {
            if (points[i + 1] > POLLEN_CROWNS.above) kept.push(points[i], points[i + 1], points[i + 2]);
        }
        return new Float32Array(kept);
    }

    /** Forget every effect in flight (new session, settings off). */
    resetEffects() {
        this.director?.reset();
        this.sparks?.reset();
        this.flurry?.reset();
        this.lake?.reset();
        this.birds?.reset();
        Object.assign(this.worn, {
            gust: 0, gustSpeed: 0, flock: 0, flockSpeed: 0, warmth: 0, rush: 0, gild: 0, gildReach: 0, dusk: 0,
        });
    }

    prepareCamera(aspect) {
        const view = goldenForestViewFor(Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9);
        const { camera } = this;
        camera.fov = view.fov;
        camera.near = 0.3;
        camera.far = 3400;
        camera.position.set(...goldenForestEye(view));
        camera.lookAt(view.target[0], view.target[1], view.target[2]);
        camera.updateProjectionMatrix();
        if (!this.stage) this.stage = new GoldenForestStage(camera);
        else this.stage.refresh();
        this.lake?.watch(camera);
        // The gilding spreads round the lake as the landscape lens sees it, whatever the frame.
        const eye = GOLDEN_FOREST_VIEWS.landscape.position;
        this.light?.uEyeGround.value.set(eye[0], eye[2]);
    }

    /**
     * A new level: the lake turns one hour on from wherever the clock has brought it. Aloud it
     * eases there (see `update`); `silent` (a rebuilt world, a capture) is there at once. A new
     * run goes back to the first level's hour the short way round.
     * @param {number} level
     * @param {{ silent?: boolean }} [options]
     */
    setLevel(level, { silent = false } = {}) {
        const wanted = Number(level);
        this.level = Number.isFinite(wanted) ? Math.max(1, Math.min(9999, Math.round(wanted))) : this.level;
        if (silent) this.moodStep = nearestStep(this.moodStep, this.level - 1, GOLDEN_FOREST_MOODS.length);
        return this.level;
    }

    /** Seconds of evening lived at `time` on this world's clock, with what came before it. */
    moodLived(time = this.light?.uTime.value ?? 0) {
        const before = Number.isFinite(this.moodStart) ? Math.max(0, this.moodStart) : 0;
        return before + (Number.isFinite(time) ? Math.max(0, time) : 0);
    }

    /** How many hours into the evening it is at `time`: the level's step and the clock's turn. */
    moodPhase(time = this.light?.uTime.value ?? 0) {
        return this.moodStep + goldenForestMoodDrift(this.moodLived(time));
    }

    /**
     * Hold one air still (by name or number: golden-forest-airs.js), or let the clock turn them
     * again (null). For a capture, a test, a lens.
     * @param {string | number | null} which
     */
    setAirHold(which) {
        const index = goldenForestAirIndex(which);
        this.airHold = index >= 0 ? index : null;
        return this.airHold;
    }

    /** How many airs into the evening it is at `time`: the clock's turn, or the air held. */
    airPhase(time = this.light?.uTime.value ?? 0) {
        return this.airHold === null ? goldenForestAirDrift(this.moodLived(time)) : this.airHold;
    }

    /** The theme is built hidden behind the one playing: the combo ribbons draw (unseen) meanwhile. */
    setWarming(on) {
        if (this.ribbons) this.ribbons.warming = on === true;
    }

    /**
     * Reduce motion: the wind, the fronts, the startled flock and the river's turn are calmed to
     * this share (1: all of it). The theme sets it from Settings and the system preference.
     */
    setMotion(scale) {
        this.motion = Number.isFinite(scale) ? THREE.MathUtils.clamp(scale, 0, 1) : 1;
    }

    /**
     * The envelopes as the world wears them. Anything that MOVES the scene (the gust bending every
     * bough and carrying the motes, the flock bursting wide) follows its envelope through a
     * critically damped spring, and the warmth of the sky and crowns eases in, so a lock leans the
     * forest instead of jerking it and rapid locks raise the wind instead of shaking the trees.
     * How hot play runs (`level`, `fever`) is spent here too: the evening wind rises, the
     * fireflies wake and fall into step, the sun pours in, the birds go up.
     */
    wear(frame, dt) {
        const unit = (value, high = 1) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, high) : 0);
        const { worn } = this;
        const motion = this.motion ?? 1;
        const level = unit(frame.level);
        const fever = unit(frame.fever);
        worn.level = level;
        worn.fever = fever;
        worn.crown = unit(frame.crown, 1.2);
        worn.gold = unit(frame.gold, 1.5);
        worn.motion = motion;
        worn.rush = unit(frame.rush);
        worn.dusk = unit(frame.dusk);
        // A perfect clear's crown gilds every shore at once, whatever the combo has done.
        const crowned = Math.min(1, worn.crown);
        worn.gild = Math.max(unit(frame.gild), crowned);
        worn.gildReach = Math.max(unit(frame.gildReach), Math.min(1, crowned * 1.5));
        const spring = (key, speed, target, omega) => {
            if (dt > 0) {
                const step = Math.min(dt, 0.05);
                const pull = omega * omega * (target - worn[key]) - 2 * omega * worn[speed];
                worn[speed] += pull * step;
                worn[key] += worn[speed] * step;
                if (!Number.isFinite(worn[key]) || !Number.isFinite(worn[speed])) {
                    worn[key] = target;
                    worn[speed] = 0;
                }
            }
            return worn[key];
        };
        spring('gust', 'gustSpeed', unit(frame.gust), 7);
        spring('flock', 'flockSpeed', Math.max(unit(frame.flock), fever * 0.45), 4);
        if (dt > 0) worn.warmth += (unit(frame.warmth) - worn.warmth) * (1 - Math.exp(-Math.min(dt, 0.05) * 9));
        return worn;
    }

    /**
     * The lake's tracks in world terms: a great wave starts under the board's foot, a spiral
     * beside the card where the twist's helix stands, a pulse on the sun's road needs no place.
     */
    placeTracks(frame) {
        const { tracks, trackPool, stage } = this;
        tracks.waves.length = 0;
        tracks.swirls.length = 0;
        tracks.roads.length = 0;
        let used = 0;
        const take = () => (used < trackPool.length ? trackPool[used++] : null);
        const each = (list, place) => {
            if (!Array.isArray(list)) return;
            for (let i = 0; i < list.length; i += 1) {
                const source = list[i];
                const slot = source && source.strength > 0 ? take() : null;
                if (!slot) continue;
                slot.age = source.age;
                slot.strength = source.strength;
                slot.turn = source.turn < 0 ? -1 : 1;
                place(source, slot);
            }
        };
        each(frame.waves, (source, slot) => {
            const spot = this.director.waterAt(source.column ?? 0.5, 0, this.trackPoint);
            Object.assign(slot, { x: spot.x, z: spot.z });
            tracks.waves.push(slot);
            // The wave's crest reaches the rowboat: it rocks at its mooring.
            const boat = this.shore?.boatPlace;
            if (boat) {
                const crest = GOLDEN_FOREST_WAVE.start + slot.age * GOLDEN_FOREST_WAVE.speed;
                const away = Math.hypot(boat.x - spot.x, boat.z - spot.z);
                if (Math.abs(crest - away) < 3) this.shore.rock(Math.min(1, slot.strength) * (this.motion ?? 1));
            }
        });
        each(frame.swirls, (source, slot) => {
            const edge = stage.edge(slot.turn, 0, GOLDEN_FOREST_STAGE_DEPTH, this.trackPoint, 0);
            Object.assign(slot, { x: edge.x + slot.turn * SWIRL_PLACE.out, z: edge.z - SWIRL_PLACE.back });
            tracks.swirls.push(slot);
        });
        each(frame.roads, (source, slot) => tracks.roads.push(slot));
        return tracks;
    }

    update(rawTime, rawStep, given = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const frame = given || {};
        const { light } = this;
        const time = Number.isFinite(rawTime) ? Math.max(0, rawTime) : light.uTime.value;
        const dt = Number.isFinite(rawStep) ? Math.max(0, rawStep) : 0;
        const direction = light.uWindDir.value;
        const worn = this.wear(frame, dt);
        const env = this.director.apply(frame, dt, { x: direction.x, z: direction.z }, worn);
        // The hour: the clock turns it by itself (a function of the time alone, so a seek and an
        // evening lived through agree); a level's step eases in on top, the short way round. A slow
        // change of colour is not motion and no effect: neither setting holds it back.
        const follow = 1 - Math.exp(-dt * MOOD_FOLLOW);
        this.moodStep = easeStep(this.moodStep, this.level - 1, follow, GOLDEN_FOREST_MOODS.length);
        light.setMood(this.moodPhase(time));
        light.setAir(this.airPhase(time));
        light.update(time, frame, worn, env.fronts);
        this.sparks.update(dt, env);
        // The bursts the director asked for, the lake's tracks, and the skeins it has called.
        this.flurry.play(frame, { time, stage: this.stage, ripples: this.lake.ripples });
        this.lake.setTracks(this.placeTracks(frame));
        if (frame.epoch !== this.flightEpoch) {
            this.flightEpoch = frame.epoch;
            this.flightsSeen = 0;
        }
        const flights = Number.isFinite(frame.flights) ? frame.flights : 0;
        if (flights > this.flightsSeen) {
            this.flightsSeen = flights;
            this.birds.callSkein(time);
        }
        this.birds.update(frame, dt, worn, time);
        this.ribbons.update(frame, worn);
        const rocked = this.shore.update(time, dt);
        if (rocked) this.lake.ripples.add(rocked.x, rocked.z, 0.2);
        this.lake.update(dt, frame, worn);
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            ...(this.forest?.stats || {}),
            farTrees: this.backdrop?.count || 0,
            birds: this.birds?.count || 0,
            sparks: this.sparks?.sim?.counts() || null,
            flurry: this.flurry?.counts() || null,
            rings: this.lake?.ripples.active() || 0,
            level: this.level,
            // The hour the lake is turning to, and how far round it is.
            mood: goldenForestMoodName(nearestStep(this.moodStep, this.level - 1, GOLDEN_FOREST_MOODS.length)
                + goldenForestMoodDrift(this.moodLived())),
            moodPhase: this.light?.moodPhase ?? 0,
            // The air the lake stands in, and how far round the airs it is.
            air: goldenForestAirName(this.airPhase()),
            airPhase: this.light?.airPhase ?? 0,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.lake?.dispose();
        this.flurry?.dispose();
        this.sparks?.dispose();
        this.ribbons?.dispose();
        this.birds?.dispose();
        this.shore?.dispose();
        this.atmosphere?.dispose();
        this.backdrop?.dispose();
        this.forest?.dispose();
        this.terrain?.dispose();
        this.light?.dispose();
        this.lake = null;
        this.flurry = null;
        this.sparks = null;
        this.director = null;
        this.stage = null;
        this.ribbons = null;
        this.birds = null;
        this.shore = null;
        this.atmosphere = null;
        this.backdrop = null;
        this.forest = null;
        this.terrain = null;
        this.light = null;
        this.group.removeFromParent();
        this.group.clear();
    }
}
