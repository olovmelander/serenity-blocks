/**
 * Verdant Hills — a bright, windy day on the downs, shared by the isolated playground and
 * both player backends.
 *
 * VerdantHillsWorld is the composition root: it owns the light rig and its clouds, the
 * land, the sky, the grass, the oak and what people built, the kites, the ribbons of wind
 * and what the wind carries, frames the camera, and forwards gameplay envelopes to them
 * each frame.
 */
import * as THREE from 'three/webgpu';
import { verdantHillsEye, verdantHillsTarget, verdantHillsViewFor } from './verdant-hills-composition.js';
import { VerdantHillsBackdrop } from './verdant-hills-backdrop.js';
import { VerdantHillsFxDirector } from './verdant-hills-fx-director.js';
import { VerdantHillsHomestead } from './verdant-hills-homestead.js';
import { VerdantHillsKites } from './verdant-hills-kites.js';
import { VerdantHillsLife } from './verdant-hills-life.js';
import { VerdantHillsLight } from './verdant-hills-light.js';
import { VerdantHillsMeadow } from './verdant-hills-meadow.js';
import { verdantHillsTier } from './verdant-hills-quality.js';
import { VerdantHillsRibbons } from './verdant-hills-ribbons.js';
import { VerdantHillsSeeds } from './verdant-hills-seeds.js';
import { VerdantHillsSky } from './verdant-hills-sky.js';
import { VerdantHillsStage } from './verdant-hills-stage.js';
import { VERDANT_HILLS_PLACES, VerdantHillsTerrain, verdantHillsGroundHeight } from './verdant-hills-terrain.js';
import { VerdantHillsTrees } from './verdant-hills-trees.js';

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
    }

    build() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed VerdantHillsWorld.');
        if (this.built) return this;
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
        this.terrain.build();
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
            this.backdrop = new VerdantHillsBackdrop({
                light, impostors: this.assets.impostors, tier, rng,
            });
            this.group.add(this.backdrop.group);
            this.backdrop.build();
            this.homestead = new VerdantHillsHomestead({
                light, props: this.assets.props, tier, rng, oak: this.assets.trees?.['oak-hero'] || null,
            });
            this.group.add(this.homestead.group);
            this.homestead.build();
        }
        this.meadow = new VerdantHillsMeadow({ light, tier, rng });
        this.group.add(this.meadow.group);
        this.meadow.build();
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
        return this;
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

    /** Put the wind and the clouds back where a session starts (a replay begins from one place). */
    rewind() {
        this.resetEffects();
        this.light?.rewind();
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
        const env = this.director.apply(frame, dt, { x: direction.x, z: direction.z, strength: light.uWind.value });
        light.update(time, { ...frame, front: env.front, pool: env.pool });
        light.step(dt);
        this.ribbons.update(dt);
        this.life.update(frame);
        this.homestead?.update(time, dt, frame);
        this.kites.update(time, dt, frame);
        this.seeds.update(dt, env);
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            ...(this.meadow?.stats || {}),
            ...(this.trees?.stats || {}),
            ...(this.backdrop?.stats || {}),
            ...(this.homestead?.stats || {}),
            ...(this.sky?.getDiagnostics() || {}),
            groundTriangles: this.terrain?.triangles || 0,
            butterflies: this.life?.butterflies || 0,
            swallows: this.life?.swallows || 0,
            kites: this.kites?.aloft || 0,
            ribbons: this.ribbons?.active() || 0,
            seeds: this.seeds?.sim?.counts() || null,
            waves: this.light?.waves.active() || 0,
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
