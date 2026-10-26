/**
 * Verdant Hills — a bright, windy day on the downs, shared by the isolated playground and
 * both player backends.
 *
 * VerdantHillsWorld is the composition root: it owns the light rig and its clouds, the
 * land, the sky, the grass, the oak and what people built, the kites, the ribbons of wind
 * and what the wind carries, frames the camera, and forwards gameplay envelopes to them
 * each frame. It also keeps the day's weather: the clock turns it by itself and every level
 * is one weather on (verdant-hills-moods.js).
 */
import * as THREE from 'three/webgpu';
import { verdantHillsEye, verdantHillsTarget, verdantHillsViewFor } from './verdant-hills-composition.js';
import { VerdantHillsBackdrop } from './verdant-hills-backdrop.js';
import { VerdantHillsFlock } from './verdant-hills-flock.js';
import { VerdantHillsFxDirector } from './verdant-hills-fx-director.js';
import { VerdantHillsHomestead } from './verdant-hills-homestead.js';
import { VerdantHillsKites } from './verdant-hills-kites.js';
import { VerdantHillsLife } from './verdant-hills-life.js';
import { VERDANT_HILLS_WIND_DIRECTION, VerdantHillsLight } from './verdant-hills-light.js';
import { VerdantHillsMeadow } from './verdant-hills-meadow.js';
import { VERDANT_HILLS_MOODS, verdantHillsMoodDrift, verdantHillsMoodName } from './verdant-hills-moods.js';
import { verdantHillsTier } from './verdant-hills-quality.js';
import { VerdantHillsRibbons } from './verdant-hills-ribbons.js';
import { VerdantHillsSeeds } from './verdant-hills-seeds.js';
import { VerdantHillsSheep } from './verdant-hills-sheep.js';
import { VerdantHillsSky } from './verdant-hills-sky.js';
import { VerdantHillsStage } from './verdant-hills-stage.js';
import { createVerdantHillsWorn, wearVerdantHillsFrame } from './verdant-hills-surge.js';
import { VERDANT_HILLS_PLACES, VerdantHillsTerrain, verdantHillsGroundHeight } from './verdant-hills-terrain.js';
import { createVerdantHillsPasture, layoutVerdantHillsSheep } from './verdant-hills-layout.js';
import { VerdantHillsTrees } from './verdant-hills-trees.js';
import { drainSteps } from '../shared/build-steps.js';
import { easeStep, nearestStep } from '../shared/mood-clock.js';

/** The flock's own seed: every session's flock starts its day the same way, as the layout does. */
export const VERDANT_HILLS_FLOCK_SEED = 0x5ee9;
/** How quickly the day takes a level's step, per second: most of the way in four seconds. */
const MOOD_FOLLOW = 0.6;

export class VerdantHillsWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets = null,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = verdantHillsTier(quality);
        this.rng = rng;
        this.assets = assets;
        this.group = new THREE.Group();
        this.group.name = 'Verdant Hills — a windy day on the downs';
        this.disposed = false;
        this.built = false;
        // The day's weather: the clock turns it, and every level is one weather on. `moodStep` is
        // the level's step as eased so far, and `moodStart` the seconds of weather the theme had
        // already lived before this world's clock began (a rebuild picks the day up there).
        this.level = 1;
        this.moodStep = 0;
        this.moodStart = 0;
        /** What the world wears each frame: the reactions frame with the surge spent on it. */
        this.worn = createVerdantHillsWorn();
        /** What the light rig is handed each frame (the fronts and the pool in world terms). */
        this.lit = {
            wind: 0,
            gale: 0,
            gust: 0,
            warmth: 0,
            glow: 0,
            shimmer: 0,
            settled: false,
            coverShift: 0,
            clearAir: 0,
            front: null,
            fronts: null,
            pool: null,
        };
        /** What the flock is handed each frame. */
        this.flockEnv = {
            fronts: [null, null, null], pool: null, festival: 0, settled: false, motion: 1, level: 0, fever: 0, mood: 0,
        };
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, a part (or the half of the meadow) to a step: run at once by build(), or
     * with a breath between steps while the theme comes in (shared/build-steps.js), so no single
     * task holds the page for the whole 0.4 s. The same parts in the same order, drawing from the
     * same random sequence.
     */
    * buildSteps() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed VerdantHillsWorld.');
        if (this.built) return;
        this.built = true;
        this.scene.add(this.group);
        this.light = new VerdantHillsLight({ tier: this.tier, rng: this.rng, clouds: this.assets?.clouds || null });
        this.light.addTo(this.group);
        this.light.frameShadows();
        // Each part is owned before it builds: if one throws halfway, dispose() still
        // reaches whatever it had already made.
        const { light, tier, rng } = this;
        this.terrain = new VerdantHillsTerrain({ light, landMap: this.assets?.land || null });
        this.group.add(this.terrain.group);
        yield 'light';
        this.terrain.build();
        yield 'terrain';
        this.sky = new VerdantHillsSky({ light, tier });
        this.group.add(this.sky.group);
        this.sky.build();
        // The lens marches the clouds before it draws each frame.
        light.cloudPass = this.sky;
        if (this.assets) {
            // The pack: the old oak and the field trees, the sprite trees of the far hills, and
            // what people built. Without it (a test, a failed load) the hills stand bare.
            this.trees = new VerdantHillsTrees({
                light, assets: this.assets, tier, rng,
            });
            this.group.add(this.trees.group);
            this.trees.build();
            yield 'trees';
            this.backdrop = new VerdantHillsBackdrop({
                light, impostors: this.assets.impostors, tier, rng,
            });
            this.group.add(this.backdrop.group);
            this.backdrop.build();
            yield 'backdrop';
            // With its two rigged models the flock lives (verdant-hills-flock.js); without them the
            // homestead stands its old still sheep where the layout puts them.
            const living = Boolean(this.assets.sheep) && tier.sheep > 0;
            this.homestead = new VerdantHillsHomestead({
                light,
                props: this.assets.props,
                tier,
                rng,
                oak: this.assets.trees?.['oak-hero'] || null,
                sheep: !living,
            });
            this.group.add(this.homestead.group);
            this.homestead.build();
            yield 'homestead';
            if (living) {
                this.flock = new VerdantHillsFlock({
                    entries: layoutVerdantHillsSheep(null, tier.sheep),
                    land: createVerdantHillsPasture(),
                    seed: VERDANT_HILLS_FLOCK_SEED,
                    wind: { x: VERDANT_HILLS_WIND_DIRECTION.x, z: VERDANT_HILLS_WIND_DIRECTION.z },
                });
                this.sheep = new VerdantHillsSheep({ light, models: this.assets.sheep, flock: this.flock });
                this.group.add(this.sheep.group);
                this.sheep.build();
                yield 'sheep';
            }
        }
        this.meadow = new VerdantHillsMeadow({ light, tier, rng });
        this.group.add(this.meadow.group);
        yield* this.meadow.buildSteps();
        yield 'meadow';
        this.life = new VerdantHillsLife({ light, tier, rng });
        this.group.add(this.life.group);
        this.life.build();
        this.kites = new VerdantHillsKites({ light });
        this.group.add(this.kites.group);
        this.kites.build();
        this.ribbons = new VerdantHillsRibbons({ light, tier });
        this.group.add(this.ribbons.group);
        this.ribbons.build();
        this.seeds = new VerdantHillsSeeds({
            light, tier, rng, homes: this.downHomes(), groundHeight: verdantHillsGroundHeight,
        });
        this.group.add(this.seeds.group);
        this.seeds.build();
        this.prepareCamera(this.camera.aspect);
        const { oak } = VERDANT_HILLS_PLACES;
        this.director = new VerdantHillsFxDirector({
            stage: this.stage,
            sim: this.seeds.sim,
            ribbons: this.ribbons,
            waves: light.waves,
            tier,
            rng,
            groundHeight: verdantHillsGroundHeight,
            oak: {
                x: oak.x + 1.5, y: verdantHillsGroundHeight(oak.x, oak.z) + 9.5, z: oak.z, radius: 8,
            },
        });
    }

    /** The measured board card in screen fractions (y down), or null for the default. */
    setBoard(rect) {
        this.stage?.setBoard(rect);
    }

    /** Where seed down hangs in the air: over the crown of the hill and out over the brow. */
    downHomes() {
        const { rng } = this;
        const homes = [];
        for (let i = 0; i < 260; i += 1) {
            const x = (rng() * 2 - 1) * 26;
            const z = -2 - rng() * 44;
            const floor = Math.max(verdantHillsGroundHeight(x, z), verdantHillsGroundHeight(0, 0) - 4);
            homes.push(x, floor + 0.7 + rng() * 5.5, z);
        }
        return new Float32Array(homes);
    }

    /** Forget every effect in flight (new session, settings off). */
    resetEffects() {
        this.director?.reset();
        this.seeds?.reset();
        this.ribbons?.reset();
        this.light?.reset();
    }

    /**
     * A new level: the day turns one weather on from wherever the clock has brought it. Aloud it
     * eases there (see `update`); `silent` (a rebuilt world, a capture) is there at once. A new
     * run goes back to the first level's weather the short way round.
     * @param {number} level
     * @param {{ silent?: boolean }} [options]
     */
    setLevel(level, { silent = false } = {}) {
        const wanted = Number(level);
        const was = this.level;
        this.level = Number.isFinite(wanted) ? Math.max(1, Math.min(9999, Math.round(wanted))) : this.level;
        // A new level sends a group or two of the flock on to fresh grass.
        if (!silent && this.level > was) this.flock?.onLevel();
        if (silent) this.moodStep = nearestStep(this.moodStep, this.level - 1, VERDANT_HILLS_MOODS.length);
        return this.level;
    }

    /** Seconds of weather lived at `time` on this world's clock, with what came before it. */
    moodLived(time = this.light?.uTime.value ?? 0) {
        const before = Number.isFinite(this.moodStart) ? Math.max(0, this.moodStart) : 0;
        return before + (Number.isFinite(time) ? Math.max(0, time) : 0);
    }

    /** How many weathers into the day it is at `time`: the level's step and the clock's turn. */
    moodPhase(time = this.light?.uTime.value ?? 0) {
        return this.moodStep + verdantHillsMoodDrift(this.moodLived(time));
    }

    /** Put the wind and the clouds back where a session starts (a replay begins from one place). */
    rewind() {
        this.resetEffects();
        this.light?.rewind();
        this.flock?.reset();
        this.sheep?.update();
    }

    prepareCamera(aspect) {
        const view = verdantHillsViewFor(Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9);
        const { camera } = this;
        camera.fov = view.fov;
        camera.near = 0.25;
        camera.far = 30000;
        camera.position.set(...verdantHillsEye(view));
        camera.lookAt(...verdantHillsTarget(view));
        camera.updateProjectionMatrix();
        if (!this.stage) this.stage = new VerdantHillsStage(camera);
        else this.stage.refresh();
    }

    update(rawTime, rawStep, frame = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const { light } = this;
        const time = Number.isFinite(rawTime) ? Math.max(0, rawTime) : light.uTime.value;
        const dt = Number.isFinite(rawStep) ? Math.max(0, rawStep) : 0;
        const direction = light.uWindDir.value;
        // How hot play runs, worn by everything at once (verdant-hills-surge.js).
        const worn = wearVerdantHillsFrame(frame, this.worn);
        const env = this.director.apply(worn, dt, { x: direction.x, z: direction.z, strength: light.uWind.value });
        const { lit } = this;
        lit.wind = worn.wind;
        lit.gale = worn.gale;
        lit.gust = worn.gust;
        lit.warmth = worn.warmth;
        lit.glow = worn.glow;
        lit.shimmer = worn.shimmer;
        lit.settled = worn.settled;
        lit.coverShift = worn.coverShift;
        lit.clearAir = worn.clearAir;
        lit.front = env.front;
        lit.fronts = env.fronts;
        lit.pool = env.pool;
        // The weather: the clock turns it by itself (a function of the time alone, so a seek and a
        // day lived through agree); a level's step eases in on top, the short way round. A slow
        // change of colour is not motion and no effect: neither setting holds it back.
        const follow = 1 - Math.exp(-dt * MOOD_FOLLOW);
        this.moodStep = easeStep(this.moodStep, this.level - 1, follow, VERDANT_HILLS_MOODS.length);
        light.setMood(this.moodPhase(time));
        light.update(time, lit);
        light.step(dt);
        this.ribbons.update(dt);
        this.life.update(worn, dt);
        this.homestead?.update(time, dt, worn);
        this.kites.update(time, dt, worn);
        this.seeds.update(dt, env);
        if (this.flock) {
            // The flock: the fronts that cross the valley, the pool of sunlight, the festival, the end
            // of a run, how hot play runs, Reduce motion and the day's weather.
            const { flockEnv } = this;
            flockEnv.fronts[0] = env.front;
            flockEnv.fronts[1] = env.fronts?.[0]?.strength > 0 ? env.fronts[0] : null;
            flockEnv.fronts[2] = env.fronts?.[1]?.strength > 0 ? env.fronts[1] : null;
            flockEnv.pool = env.pool;
            flockEnv.festival = worn.festival;
            flockEnv.settled = worn.settled;
            flockEnv.motion = worn.motion;
            flockEnv.level = worn.level;
            flockEnv.fever = worn.fever;
            flockEnv.mood = this.moodPhase(time);
            this.flock.step(dt, flockEnv);
            this.sheep.update();
        }
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            ...(this.meadow?.stats || {}),
            ...(this.trees?.stats || {}),
            ...(this.backdrop?.stats || {}),
            ...(this.homestead?.stats || {}),
            ...(this.flock ? {
                sheep: this.flock.sheep.length, sheepTriangles: this.sheep?.triangles || 0, flock: this.flock.census(),
            } : {}),
            ...(this.sky?.getDiagnostics() || {}),
            groundTriangles: this.terrain?.triangles || 0,
            butterflies: this.life?.butterflies || 0,
            swallows: this.life?.swallows || 0,
            kites: this.kites?.aloft || 0,
            ribbons: this.ribbons?.active() || 0,
            seeds: this.seeds?.sim?.counts() || null,
            waves: this.light?.waves.active() || 0,
            level: this.level,
            // The weather the day is turning to, and how far round it is.
            mood: verdantHillsMoodName(nearestStep(this.moodStep, this.level - 1, VERDANT_HILLS_MOODS.length)
                + verdantHillsMoodDrift(this.moodLived())),
            moodPhase: this.light?.moodPhase ?? 0,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.seeds?.dispose();
        this.ribbons?.dispose();
        this.kites?.dispose();
        this.life?.dispose();
        this.meadow?.dispose();
        this.sheep?.dispose();
        this.homestead?.dispose();
        this.backdrop?.dispose();
        this.trees?.dispose();
        this.sky?.dispose();
        this.terrain?.dispose();
        this.light?.dispose();
        this.seeds = null;
        this.ribbons = null;
        this.kites = null;
        this.director = null;
        this.life = null;
        this.meadow = null;
        this.sheep = null;
        this.flock = null;
        this.homestead = null;
        this.backdrop = null;
        this.trees = null;
        this.sky = null;
        this.terrain = null;
        this.stage = null;
        this.light = null;
        this.group.removeFromParent();
        this.group.clear();
    }
}
