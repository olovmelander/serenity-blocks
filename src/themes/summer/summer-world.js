/**
 * Summer — Midsummer's Eve by the lake, shared by the isolated playground and both player
 * backends.
 *
 * SummerWorld is the composition root: it owns the light rig, the land, the woods, the
 * meadow, the homestead, the lake and the air, frames the camera, and forwards gameplay
 * envelopes to them each frame.
 */
import * as THREE from 'three/webgpu';
import { SummerAtmosphere } from './summer-atmosphere.js';
import { SummerBackdrop } from './summer-backdrop.js';
import { summerEye, summerViewFor } from './summer-composition.js';
import { SummerForest } from './summer-forest.js';
import { SummerFxDirector } from './summer-fx-director.js';
import { SummerGarlands } from './summer-garlands.js';
import { SummerHomestead } from './summer-homestead.js';
import { SUMMER_MIRROR_LAYER, SummerLake } from './summer-lake.js';
import { SummerLife } from './summer-life.js';
import { SummerLight } from './summer-light.js';
import { SummerMeadow } from './summer-meadow.js';
import { SummerPetals } from './summer-petals.js';
import { summerTier } from './summer-quality.js';
import { SummerShore } from './summer-shore.js';
import { SUMMER_STAGE_DEPTH, SummerStage } from './summer-stage.js';
import { SummerTerrain, summerGroundHeight } from './summer-terrain.js';

export class SummerWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = summerTier(quality);
        this.rng = rng;
        this.assets = assets;
        this.group = new THREE.Group();
        this.group.name = 'Summer — Midsummer\'s Eve by the lake';
        this.disposed = false;
        this.built = false;
        this.boardCentre = new THREE.Vector3();
    }

    build() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed SummerWorld.');
        if (this.built) return this;
        if (!this.assets) throw new Error('[Summer] The world needs its loaded assets before it can build.');
        this.built = true;
        this.scene.add(this.group);
        this.light = new SummerLight({ tier: this.tier, rng: this.rng });
        this.light.addTo(this.group);
        this.light.frameShadows();
        // Each part is owned before it builds: if one throws halfway, dispose() still
        // reaches whatever it had already made.
        const { light, tier, rng } = this;
        const { impostors, props } = this.assets;
        this.terrain = new SummerTerrain({ light });
        this.group.add(this.terrain.group);
        this.terrain.build();
        this.forest = new SummerForest({
            light, assets: this.assets, tier, rng,
        });
        this.group.add(this.forest.group);
        this.forest.build();
        this.backdrop = new SummerBackdrop({
            light, impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        this.atmosphere = new SummerAtmosphere({ light, tier, rng });
        this.group.add(this.atmosphere.group);
        this.atmosphere.build();
        this.homestead = new SummerHomestead({
            light, props, tier, rng,
        });
        this.group.add(this.homestead.group);
        this.homestead.build();
        this.meadow = new SummerMeadow({ light, tier, rng });
        this.group.add(this.meadow.group);
        this.meadow.build();
        this.shore = new SummerShore({
            light, tier, rng, meadow: this.meadow,
        });
        this.group.add(this.shore.group);
        this.shore.build();
        this.life = new SummerLife({ light, tier, rng });
        this.group.add(this.life.group);
        this.life.build();
        this.garlands = new SummerGarlands({ light, tier });
        this.group.add(this.garlands.group);
        this.garlands.build();
        this.petals = new SummerPetals({
            light, tier, rng, homes: this.downHomes(), groundHeight: summerGroundHeight,
        });
        this.group.add(this.petals.group);
        this.petals.build();
        this.lake = new SummerLake({ light, tier, lakeMap: this.terrain.lakeMap });
        this.group.add(this.lake.group);
        this.lake.build();
        // The meadow lies behind its own crest as the lake sees it, so it is left out of the mirror.
        this.reflect([this.terrain.group, this.forest.group, this.backdrop.group, this.atmosphere.group,
            this.homestead.group, this.shore.group, this.life.group, this.garlands.group, this.petals.group]);
        this.prepareCamera(this.camera.aspect);
        this.director = new SummerFxDirector({
            stage: this.stage,
            sim: this.petals.sim,
            ripples: this.lake.ripples,
            waves: light.waves,
            tier,
            rng,
            groundHeight: summerGroundHeight,
            maypole: this.homestead.bouquetAnchors(),
        });
        return this;
    }

    /** Put these parts of the scene in the lake's mirror, except what marks itself as never seen there. */
    reflect(roots) {
        roots.forEach((root) => root?.traverse((object) => {
            if (object.userData?.unmirrored !== true) object.layers.enable(SUMMER_MIRROR_LAYER);
        }));
    }

    /** The measured board card in screen fractions (y down), or null for the default. */
    setBoard(rect) {
        if (!this.stage) return;
        this.stage.setBoard(rect);
        this.placeGarlands();
    }

    /** Wind the combo's ribbons around where the board now stands. */
    placeGarlands() {
        const { stage } = this;
        if (!stage || !this.garlands) return;
        const centre = stage.centre(SUMMER_STAGE_DEPTH, this.boardCentre);
        const height = (stage.board.y1 - stage.board.y0) * 2 * SUMMER_STAGE_DEPTH * stage.tanV;
        this.garlands.setBoard(centre, height);
    }

    /** Where seed down hangs in the air: over the meadow and out across the near water. */
    downHomes() {
        const { rng } = this;
        const homes = [];
        for (let i = 0; i < 260; i += 1) {
            const x = (rng() * 2 - 1) * 30;
            const z = 12 - rng() * 52;
            homes.push(x, Math.max(0, summerGroundHeight(x, z)) + 0.6 + rng() * 5.5, z);
        }
        return new Float32Array(homes);
    }

    /** Forget every effect in flight (new session, settings off). */
    resetEffects() {
        this.director?.reset();
        this.petals?.reset();
        this.light?.reset();
        this.lake?.reset();
    }

    prepareCamera(aspect) {
        const view = summerViewFor(Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9);
        const { camera } = this;
        camera.fov = view.fov;
        camera.near = 0.25;
        camera.far = 3600;
        camera.position.set(...summerEye(view));
        camera.lookAt(view.target[0], view.target[1], view.target[2]);
        camera.updateProjectionMatrix();
        if (!this.stage) this.stage = new SummerStage(camera);
        else this.stage.refresh();
        this.placeGarlands();
        this.lake?.watch(camera);
    }

    update(rawTime, rawStep, frame = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const { light } = this;
        const time = Number.isFinite(rawTime) ? Math.max(0, rawTime) : light.uTime.value;
        const dt = Number.isFinite(rawStep) ? Math.max(0, rawStep) : 0;
        const direction = light.uWindDir.value;
        const env = this.director.apply(frame, dt, { x: direction.x, z: direction.z, strength: light.uWind.value });
        light.update(time, { ...frame, front: env.front });
        light.step(dt);
        this.petals.update(dt, env);
        this.life.update(frame);
        this.garlands.update(frame);
        const rocked = this.homestead.update(time, dt, frame);
        if (rocked) this.lake.ripples.add(rocked.x, rocked.z, 0.2);
        this.lake.update(dt, frame);
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            ...(this.forest?.stats || {}),
            ...(this.meadow?.stats || {}),
            ...(this.shore?.stats || {}),
            farTrees: this.backdrop?.count || 0,
            butterflies: this.life?.butterflies || 0,
            swallows: this.life?.swallows || 0,
            petals: this.petals?.sim?.counts() || null,
            rings: this.lake?.ripples.active() || 0,
            waves: this.light?.waves.active() || 0,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.lake?.dispose();
        this.petals?.dispose();
        this.garlands?.dispose();
        this.life?.dispose();
        this.shore?.dispose();
        this.meadow?.dispose();
        this.homestead?.dispose();
        this.atmosphere?.dispose();
        this.backdrop?.dispose();
        this.forest?.dispose();
        this.terrain?.dispose();
        this.light?.dispose();
        this.lake = null;
        this.petals = null;
        this.director = null;
        this.stage = null;
        this.garlands = null;
        this.life = null;
        this.shore = null;
        this.meadow = null;
        this.homestead = null;
        this.atmosphere = null;
        this.backdrop = null;
        this.forest = null;
        this.terrain = null;
        this.light = null;
        this.group.removeFromParent();
        this.group.clear();
    }
}
