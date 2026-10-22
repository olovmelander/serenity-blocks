/**
 * Golden Forest — the lake at the golden hour, shared by the isolated playground and both
 * player backends.
 *
 * GoldenForestWorld is the composition root: it owns the light rig, the shores, the
 * conifers, the lake and the air, frames the camera, and forwards gameplay envelopes to
 * them each frame.
 */
import * as THREE from 'three/webgpu';
import { GoldenForestAtmosphere } from './golden-forest-atmosphere.js';
import { GoldenForestBackdrop } from './golden-forest-backdrop.js';
import { GoldenForestBirds } from './golden-forest-birds.js';
import { goldenForestEye, goldenForestViewFor } from './golden-forest-composition.js';
import { GoldenForestForest } from './golden-forest-forest.js';
import { GOLDEN_FOREST_MIRROR_LAYER, GoldenForestLake } from './golden-forest-lake.js';
import { GoldenForestLight } from './golden-forest-light.js';
import { goldenForestTier } from './golden-forest-quality.js';
import { GoldenForestRibbons } from './golden-forest-ribbons.js';
import { GoldenForestShore } from './golden-forest-shore.js';
import { GoldenForestSparkDirector } from './golden-forest-spark-director.js';
import { GoldenForestSparks } from './golden-forest-sparks.js';
import { GoldenForestStage } from './golden-forest-stage.js';
import { GoldenForestTerrain, goldenForestGroundHeight } from './golden-forest-terrain.js';
import { drainSteps } from '../shared/build-steps.js';

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
        };
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
        this.birds = new GoldenForestBirds({ light, tier, rng });
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
        this.lake = new GoldenForestLake({
            light, tier, lakeMap: this.terrain.lakeMap, samples: this.samples,
        });
        this.group.add(this.lake.group);
        this.lake.build();
        yield 'lake';
        this.reflect([this.terrain.group, this.forest.group, this.backdrop.group, this.atmosphere.group,
            this.shore.group, this.birds.group, this.ribbons.group, this.sparks.group]);
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

    /** Forget every effect in flight (new session, settings off). */
    resetEffects() {
        this.director?.reset();
        this.sparks?.reset();
        this.lake?.reset();
        Object.assign(this.worn, {
            gust: 0, gustSpeed: 0, flock: 0, flockSpeed: 0, warmth: 0,
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

    update(rawTime, rawStep, frame = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const { light } = this;
        const time = Number.isFinite(rawTime) ? Math.max(0, rawTime) : light.uTime.value;
        const dt = Number.isFinite(rawStep) ? Math.max(0, rawStep) : 0;
        const direction = light.uWindDir.value;
        const worn = this.wear(frame || {}, dt);
        const env = this.director.apply(frame, dt, { x: direction.x, z: direction.z }, worn);
        light.update(time, frame, worn, env.fronts);
        this.sparks.update(dt, env);
        this.birds.update(frame, dt, worn);
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
            rings: this.lake?.ripples.active() || 0,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.lake?.dispose();
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
