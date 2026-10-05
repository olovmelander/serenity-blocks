/**
 * Sakura Twilight — a moonlit cherry garden, shared by the isolated playground and both
 * player backends.
 *
 * SakuraWorld is the composition root: it decides where the trees and lanterns stand,
 * owns the light rig, the lake, the garden and the sky, frames the camera, and forwards
 * gameplay envelopes to them each frame.
 */
import * as THREE from 'three/webgpu';
import { SakuraBackdrop } from './sakura-backdrop.js';
import {
    planPaperLanterns, sakuraLampList, sakuraPlacements, sakuraViewFor,
} from './sakura-composition.js';
import { SakuraForest } from './sakura-forest.js';
import { SakuraFoxes } from './sakura-foxes.js';
import { SakuraGarden } from './sakura-garden.js';
import { SakuraLight } from './sakura-light.js';
import { SakuraPetalDirector } from './sakura-petal-director.js';
import { SakuraPetals } from './sakura-petals.js';
import { sakuraTier } from './sakura-quality.js';
import { SakuraSky } from './sakura-sky.js';
import { SakuraSpirits } from './sakura-spirits.js';
import { SAKURA_STAGE_DEPTH, SakuraStage } from './sakura-stage.js';
import { SakuraTerrain, sakuraLand, sakuraSurfaceHeight } from './sakura-terrain.js';
import { SAKURA_UNMIRRORED_LAYER, SakuraWater } from './sakura-water.js';

const UNMIRRORED = /^Sakura(SpringGrass|Fireflies|Foxfire|PetalFlashes|MistBank|PetalsInTheAir)/;

export class SakuraWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = sakuraTier(quality);
        this.rng = rng;
        this.assets = assets;
        this.group = new THREE.Group();
        this.group.name = 'Sakura Twilight — moonlit garden';
        this.disposed = false;
        this.built = false;
        this.view = null;
        this.scratch = new THREE.Vector3();
        this.scratchRight = new THREE.Vector3();
        this.scratchUp = new THREE.Vector3();
    }

    build() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed SakuraWorld.');
        if (this.built) return this;
        if (!this.assets) throw new Error('[Sakura] SakuraWorld needs its loaded assets before it can build.');
        this.built = true;
        this.scene.add(this.group);
        const { tier, rng, assets } = this;
        // Where things stand is decided first: the lanterns' light is part of the rig.
        this.placements = sakuraPlacements(rng, tier.groveTrees);
        this.paperLanterns = planPaperLanterns(this.placements, assets.trees, tier.paperLanterns, rng);
        this.lanterns = sakuraLampList(this.paperLanterns);
        this.light = new SakuraLight({ tier, rng, lamps: this.lanterns });
        this.light.addTo(this.group);
        const { light } = this;
        // Each part is owned before it builds: if one throws halfway, dispose() still
        // reaches whatever it had already made.
        this.terrain = new SakuraTerrain({ light, rng });
        this.group.add(this.terrain.group);
        this.terrain.build();
        this.sky = new SakuraSky({ light, tier, rng });
        this.group.add(this.sky.group);
        this.sky.build();
        this.backdrop = new SakuraBackdrop({
            light, fuji: assets.fuji, impostors: assets.impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        this.forest = new SakuraForest({
            light, assets, tier, placements: this.placements, lanterns: this.lanterns, rng,
        });
        this.group.add(this.forest.group);
        this.forest.build();
        this.garden = new SakuraGarden({
            light, props: assets.props, tier, paperLanterns: this.paperLanterns, rng,
        });
        this.group.add(this.garden.group);
        this.garden.build();
        this.foxes = new SakuraFoxes({ light, fox: assets.fox, rng });
        this.group.add(this.foxes.group);
        this.foxes.build();
        this.water = new SakuraWater({ light, sky: this.sky, tier });
        this.group.add(this.water.group);
        this.water.build();
        this.spirits = new SakuraSpirits({
            light, props: assets.props, tier, rng,
        });
        this.group.add(this.spirits.group);
        this.spirits.build();
        const crownPoints = this.forest.sampleCrownPoints(Math.min(1200, tier.petals));
        this.petals = new SakuraPetals({
            light, blossoms: assets.blossoms, tier, rng, crownPoints,
        });
        this.group.add(this.petals.group);
        this.petals.build();
        this.excludeFromMirror();
        this.prepareCamera(this.camera.aspect);
        this.director = new SakuraPetalDirector({
            stage: this.stage,
            sim: this.petals.sim,
            tier,
            rng,
            crownPoints,
            surface: sakuraSurfaceHeight,
            effects: {
                ring: (x, z, strength) => this.light?.ring(x, z, strength),
                flash: (x, y, z, strength) => this.spirits?.flash(x, y, z, strength),
                star: (strength) => this.sky?.shoot(strength),
                floatLantern: (x, z, vx, vz, power) => this.floatLantern(x, z, vx, vz, power),
                skyLantern: (x, y, z, delay) => this.spirits?.releaseSky(x, y, z, delay),
            },
        });
        return this;
    }

    /** Keep the near, small things the lake never shows out of its reflection pass. */
    excludeFromMirror() {
        const unmirror = (object) => object.layers.set(SAKURA_UNMIRRORED_LAYER);
        this.group.traverse((object) => {
            if (object.isMesh && UNMIRRORED.test(object.name)) unmirror(object);
        });
        this.foxes.group.traverse(unmirror);
        this.camera.layers.enable(SAKURA_UNMIRRORED_LAYER);
        this.water.bindCamera(this.camera);
    }

    /**
     * Build the moon's shadow rig with one cheap direct render: only the ground is drawn,
     * so the rest of the garden is not compiled a second time for the canvas.
     */
    primeShadows(renderer) {
        const hidden = this.group.children.filter((child) => child !== this.terrain.group && !child.isLight
            && child.visible);
        hidden.forEach((child) => Object.assign(child, { visible: false }));
        try {
            renderer.render(this.scene, this.camera);
        } finally {
            hidden.forEach((child) => Object.assign(child, { visible: true }));
        }
    }

    /** Set a lantern afloat at (x, z), or on the nearest open water beyond it. */
    floatLantern(x, z, vx, vz, power) {
        let lakeZ = z;
        for (let step = 0; step < 8 && sakuraLand(x, lakeZ) > -0.8; step += 1) lakeZ -= 2.5;
        if (sakuraLand(x, lakeZ) > -0.8) return false;
        return this.spirits?.launchWater(x, lakeZ, vx, vz, power) ?? false;
    }

    /** The measured board card in screen fractions (y down), or null for the default. */
    setBoard(rect) {
        if (!this.stage) return;
        this.stage.setBoard(rect);
        this.placeFoxfire();
    }

    /** Stand the spirit flames either side of the board card. */
    placeFoxfire() {
        const { stage, spirits } = this;
        if (!stage || !spirits) return;
        const { board } = stage;
        const halfWidth = (board.x1 - board.x0) * SAKURA_STAGE_DEPTH * stage.tanH;
        const halfHeight = (board.y1 - board.y0) * SAKURA_STAGE_DEPTH * stage.tanV;
        spirits.setRing(
            stage.centre(SAKURA_STAGE_DEPTH, this.scratch),
            this.scratchRight.copy(stage.right).multiplyScalar(halfWidth + 0.55),
            this.scratchUp.copy(stage.up).multiplyScalar(halfHeight),
        );
    }

    /** Forget every effect in flight (new session, settings off). */
    resetEffects() {
        this.director?.reset();
        this.petals?.reset();
        this.spirits?.reset();
        this.foxes?.reset();
        this.light?.resetRings();
        this.sky?.reset();
    }

    prepareCamera(aspect) {
        const view = sakuraViewFor(Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9);
        const { camera } = this;
        camera.fov = view.fov;
        camera.near = 0.3;
        camera.far = 4000;
        camera.position.set(view.position[0], view.position[1], view.position[2]);
        camera.lookAt(view.target[0], view.target[1], view.target[2]);
        camera.updateProjectionMatrix();
        if (this.view !== view) {
            // Each framing keeps the moon in its own corner of the sky.
            this.view = view;
            this.light?.setMoon(view.moon[0], view.moon[1]);
        }
        if (!this.stage) this.stage = new SakuraStage(camera);
        else this.stage.refresh();
        this.placeFoxfire();
    }

    update(time, dt, frame = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const { light } = this;
        const direction = light.uWindDir.value;
        const env = this.director.apply(frame, dt, { x: direction.x, z: direction.z, strength: light.uWind.value });
        light.update(time, { ...frame, front: env.front });
        this.petals.update(dt, env, frame.heat);
        this.sky.update(frame);
        this.spirits.update(time, frame);
        this.foxes.update(dt, frame);
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            ...(this.forest?.stats || {}),
            ...(this.garden?.stats || {}),
            ...(this.water?.getDiagnostics() || {}),
            farTrees: this.backdrop?.count || 0,
            lanterns: this.lanterns?.length || 0,
            lamps: this.light?.lampCount || 0,
            petals: this.petals?.sim?.counts() || null,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.petals?.dispose();
        this.spirits?.dispose();
        this.water?.dispose();
        this.foxes?.dispose();
        this.garden?.dispose();
        this.forest?.dispose();
        this.backdrop?.dispose();
        this.sky?.dispose();
        this.terrain?.dispose();
        this.light?.dispose();
        this.petals = null;
        this.spirits = null;
        this.foxes = null;
        this.director = null;
        this.stage = null;
        this.water = null;
        this.garden = null;
        this.forest = null;
        this.backdrop = null;
        this.sky = null;
        this.terrain = null;
        this.light = null;
        this.camera?.layers.disable(SAKURA_UNMIRRORED_LAYER);
        this.group.removeFromParent();
        this.group.clear();
    }
}
