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

export class GoldenForestWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = goldenForestTier(quality);
        this.rng = rng;
        this.assets = assets;
        this.group = new THREE.Group();
        this.group.name = 'Golden Forest — the lake at the golden hour';
        this.disposed = false;
        this.built = false;
    }

    build() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed GoldenForestWorld.');
        if (this.built) return this;
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
        this.forest = new GoldenForestForest({
            light, assets: this.assets, tier, rng,
        });
        this.group.add(this.forest.group);
        this.forest.build();
        this.backdrop = new GoldenForestBackdrop({
            light, impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        this.atmosphere = new GoldenForestAtmosphere({ light, tier, rng });
        this.group.add(this.atmosphere.group);
        this.atmosphere.build();
        this.shore = new GoldenForestShore({
            light, props, tier, rng,
        });
        this.group.add(this.shore.group);
        this.shore.build();
        this.birds = new GoldenForestBirds({ light, tier, rng });
        this.group.add(this.birds.group);
        this.birds.build();
        this.ribbons = new GoldenForestRibbons({ light, tier });
        this.group.add(this.ribbons.group);
        this.ribbons.build();
        this.sparks = new GoldenForestSparks({
            tier, rng, homes: this.fireflyHomes(), groundHeight: goldenForestGroundHeight,
        });
        this.group.add(this.sparks.group);
        this.sparks.build();
        this.lake = new GoldenForestLake({ light, tier, lakeMap: this.terrain.lakeMap });
        this.group.add(this.lake.group);
        this.lake.build();
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
        return this;
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

    update(rawTime, rawStep, frame = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const { light } = this;
        const time = Number.isFinite(rawTime) ? Math.max(0, rawTime) : light.uTime.value;
        const dt = Number.isFinite(rawStep) ? Math.max(0, rawStep) : 0;
        const direction = light.uWindDir.value;
        const env = this.director.apply(frame, dt, { x: direction.x, z: direction.z });
        light.update(time, { ...frame, front: env.front });
        this.sparks.update(dt, env);
        this.birds.update(frame);
        this.ribbons.update(frame);
        const rocked = this.shore.update(time, dt);
        if (rocked) this.lake.ripples.add(rocked.x, rocked.z, 0.2);
        this.lake.update(dt, frame);
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
