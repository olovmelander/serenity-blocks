/**
 * Fall — the enchanted grove, shared by the isolated playground and both player backends.
 *
 * FallWorld is the composition root: it owns the light rig, the forest floor, the trees
 * and the air, frames the camera, and forwards gameplay envelopes to them each frame.
 */
import * as THREE from 'three/webgpu';
import { FallAtmosphere } from './fall-atmosphere.js';
import { FallBackdrop } from './fall-backdrop.js';
import { fallViewFor } from './fall-composition.js';
import { FallForest } from './fall-forest.js';
import { FallLeafDirector } from './fall-leaf-director.js';
import { FallLeaves } from './fall-leaves.js';
import { FallLight } from './fall-light.js';
import { fallTier } from './fall-quality.js';
import { FallStage } from './fall-stage.js';
import { FallTerrain, fallTerrainHeight } from './fall-terrain.js';
import { FallUnderstory } from './fall-understory.js';

export class FallWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets,
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
    }

    build() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed FallWorld.');
        if (this.built) return this;
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
        this.forest = new FallForest({
            light, assets: this.assets, tier, rng,
        });
        this.group.add(this.forest.group);
        this.forest.build();
        this.understory = new FallUnderstory({
            light, foliage, tier, rng,
        });
        this.group.add(this.understory.group);
        this.understory.build();
        this.backdrop = new FallBackdrop({
            light, impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        this.atmosphere = new FallAtmosphere({ light, tier, rng });
        this.group.add(this.atmosphere.group);
        this.atmosphere.build();
        const crownPoints = this.forest.sampleCrownPoints(Math.min(900, tier.leaves));
        this.leaves = new FallLeaves({
            light, foliage, tier, rng, crownPoints,
        });
        this.group.add(this.leaves.group);
        this.leaves.build();
        this.prepareCamera(this.camera.aspect);
        this.director = new FallLeafDirector({
            stage: this.stage,
            sim: this.leaves.sim,
            tier: this.tier,
            rng: this.rng,
            crownPoints,
            groundHeight: fallTerrainHeight,
        });
        return this;
    }

    /** The measured board card in screen fractions (y down), or null for the default. */
    setBoard(rect) {
        this.stage?.setBoard(rect);
    }

    /** Forget every leaf in flight and every pending emitter (new session, settings off). */
    resetEffects() {
        this.director?.reset();
        this.leaves?.reset();
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
        light.update(time, { ...frame, front: env.front });
        this.leaves.update(dt, env, frame.heat);
        this.atmosphere.update(time, dt, frame);
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            ...(this.forest?.stats || {}),
            farTrees: this.backdrop?.count || 0,
            leaves: this.leaves?.sim?.counts() || null,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
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
