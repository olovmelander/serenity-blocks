/**
 * Forest — the old wood at night, shared by the isolated playground and both player
 * backends.
 *
 * ForestWorld is the composition root: it owns the light rig, the floor, the trees, the
 * undergrowth, the sky and the fireflies, frames the camera, and forwards gameplay
 * envelopes to them each frame.
 */
import * as THREE from 'three/webgpu';
import { ForestBackdrop } from './forest-backdrop.js';
import { forestEye, forestViewFor } from './forest-composition.js';
import { ForestFireflies } from './forest-fireflies.js';
import { ForestFireflyDirector } from './forest-firefly-director.js';
import { forestHourDrift, forestHourName, forestNearestTurn } from './forest-hours.js';
import { ForestLight } from './forest-light.js';
import { FOREST_EYE } from './forest-plan.js';
import { forestTier } from './forest-quality.js';
import { ForestSky } from './forest-sky.js';
import { ForestStage } from './forest-stage.js';
import { FOREST_HEARTH, ForestTerrain, forestGroundHeight } from './forest-terrain.js';
import { ForestTrees } from './forest-trees.js';
import { FOREST_FIGURE_STAND, ForestUnderstory } from './forest-understory.js';

/** Half the angle a firefly figure fills at its usual range, with a margin; ranges to try. */
const FIGURE_HALF_VIEW = THREE.MathUtils.degToRad(8);
const FIGURE_RANGES = [21, 23.5, 26, 18.5, 28.5];
/** How quickly the night takes a level's step, per second: most of the way in four seconds. */
const HOUR_FOLLOW = 0.6;

export class ForestWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = forestTier(quality);
        this.rng = rng;
        this.assets = assets;
        this.group = new THREE.Group();
        this.group.name = 'Forest — the firefly night';
        this.disposed = false;
        this.built = false;
        // The hour of the night: the clock turns it, and every level is one hour on.
        // `nightStart` is the night already lived before this world's clock began, in
        // seconds: a forest built again takes the night up where the last one left it.
        this.level = 1;
        this.hourStep = 0;
        this.nightStart = 0;
    }

    build() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed ForestWorld.');
        if (this.built) return this;
        if (!this.assets) throw new Error('[Forest] The world needs its loaded assets before it can build.');
        this.built = true;
        this.scene.add(this.group);
        this.light = new ForestLight({ tier: this.tier, rng: this.rng });
        this.light.addTo(this.group);
        this.light.frameShadows();
        // Each part is owned before it builds: if one throws halfway, dispose() still
        // reaches whatever it had already made.
        const { light, tier, rng } = this;
        this.terrain = new ForestTerrain({ light, tier });
        this.group.add(this.terrain.group);
        this.terrain.build();
        this.trees = new ForestTrees({
            light, assets: this.assets, tier, rng,
        });
        this.group.add(this.trees.group);
        this.trees.build();
        const trunks = this.trees.trunks();
        this.understory = new ForestUnderstory({
            light, assets: this.assets, tier, rng, trunks,
        });
        this.group.add(this.understory.group);
        this.understory.build();
        this.backdrop = new ForestBackdrop({
            light, impostors: this.assets.impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        this.sky = new ForestSky({
            light, tier, rng, moonMap: this.assets.moon,
        });
        this.group.add(this.sky.group);
        this.sky.build();
        const boughs = this.lowBoughs(320);
        this.fireflies = new ForestFireflies({
            light,
            tier,
            rng,
            homes: this.fireflyHomes(boughs),
            groundHeight: forestGroundHeight,
            hearth: FOREST_HEARTH,
        });
        this.group.add(this.fireflies.group);
        this.fireflies.build();
        this.prepareCamera(this.camera.aspect);
        this.director = new ForestFireflyDirector({
            stage: this.stage,
            sim: this.fireflies.sim,
            pulses: light.pulses,
            tier,
            rng,
            groundHeight: forestGroundHeight,
            trunks,
            boughs,
            figureAnchor: this.figureAnchor(),
            eye: FOREST_EYE,
        });
        return this;
    }

    /** Points on the lower boughs of the near trees: dew falls from them, fireflies hang by them. */
    lowBoughs(count) {
        const points = this.trees.sampleCrownPoints(count);
        const kept = [];
        for (let i = 0; i < points.length; i += 3) {
            const above = points[i + 1] - forestGroundHeight(points[i], points[i + 2]);
            if (above > 2.5 && above < 15 && points[i + 2] < FOREST_EYE.z - 1 && points[i + 2] > -60) {
                kept.push(points[i], points[i + 1], points[i + 2]);
            }
        }
        return new Float32Array(kept);
    }

    /** Where fireflies keep house: over the ferns, and under the lower boughs. */
    fireflyHomes(boughs) {
        const homes = this.understory.fireflyHomes(520);
        for (let i = 0; i < boughs.length; i += 3) {
            if (boughs[i + 1] - forestGroundHeight(boughs[i], boughs[i + 2]) < 8) {
                homes.push(boughs[i], boughs[i + 1] - 0.6, boughs[i + 2]);
            }
        }
        return new Float32Array(homes);
    }

    /**
     * Where a firefly figure stands, side on to the eye and facing the moon: its usual place in
     * front of the knoll when the whole figure fits in the view, otherwise as far to the
     * right as the view allows (a narrow or upright screen), on ground clear of every trunk.
     */
    figureAnchor() {
        let { x, z } = FOREST_FIGURE_STAND;
        const { stage } = this;
        if (stage) {
            const bearing = Math.atan2(x - FOREST_EYE.x, FOREST_EYE.z - z);
            const axis = Math.atan2(stage.forward.x, -stage.forward.z);
            const limit = Math.atan(stage.tanH) - FIGURE_HALF_VIEW;
            if (bearing - axis > limit) {
                const turned = axis + Math.max(limit, FIGURE_HALF_VIEW);
                const trunks = this.trees?.trunks() || [];
                const spots = FIGURE_RANGES.map((range) => ({
                    x: FOREST_EYE.x + Math.sin(turned) * range,
                    z: FOREST_EYE.z - Math.cos(turned) * range,
                }));
                const open = (spot) => trunks.every((trunk) => (
                    Math.hypot(trunk.x - spot.x, trunk.z - spot.z) > trunk.radius + 2.4));
                ({ x, z } = spots.find(open) || spots[0]);
            }
        }
        const away = new THREE.Vector3(x - FOREST_EYE.x, 0, z - FOREST_EYE.z).normalize();
        const right = new THREE.Vector3().crossVectors(away, new THREE.Vector3(0, 1, 0)).normalize();
        return {
            x, y: forestGroundHeight(x, z), z, facing: { x: -right.x, z: -right.z }, depth: { x: away.x, z: away.z },
        };
    }

    /**
     * A new level: the night turns one hour on from wherever the clock has brought it. Aloud
     * it eases there (see `update`); `silent` (a rebuilt world, a capture) is there at once.
     * A new run goes back to the first level's hour the short way round the night.
     */
    setLevel(level, { silent = false } = {}) {
        const wanted = Number(level);
        this.level = Number.isFinite(wanted) ? Math.max(1, Math.min(9999, Math.round(wanted))) : this.level;
        if (silent) this.hourStep = forestNearestTurn(this.hourStep, this.level - 1);
        return this.level;
    }

    /** Seconds of night lived at `time` on this world's clock, with what came before it. */
    nightLived(time = this.light?.uTime.value ?? 0) {
        const before = Number.isFinite(this.nightStart) ? Math.max(0, this.nightStart) : 0;
        return before + (Number.isFinite(time) ? Math.max(0, time) : 0);
    }

    /** How many hours into the night it is at `time`: the level's step and the clock's turn. */
    hourPhase(time = this.light?.uTime.value ?? 0) {
        return this.hourStep + forestHourDrift(this.nightLived(time));
    }

    /** The measured board card in screen fractions (y down), or null for the default. */
    setBoard(rect) {
        this.stage?.setBoard(rect);
    }

    /** Forget every effect in flight (new session, settings off). */
    resetEffects() {
        this.director?.reset();
        this.fireflies?.reset();
        this.light?.reset();
        this.sky?.resetEffects();
    }

    prepareCamera(aspect) {
        const view = forestViewFor(Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9);
        const { camera } = this;
        camera.fov = view.fov;
        camera.near = 0.3;
        camera.far = 3400;
        camera.position.set(...forestEye(view));
        camera.lookAt(view.target[0], view.target[1], view.target[2]);
        camera.updateProjectionMatrix();
        if (!this.stage) this.stage = new ForestStage(camera, forestGroundHeight);
        else this.stage.refresh();
        if (this.director) this.director.figureAnchor = this.figureAnchor();
    }

    update(rawTime, rawStep, frame = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const { light } = this;
        const time = Number.isFinite(rawTime) ? Math.max(0, rawTime) : light.uTime.value;
        const dt = Number.isFinite(rawStep) ? Math.max(0, rawStep) : 0;
        const direction = light.uWindDir.value;
        const env = this.director.apply(frame, dt, { x: direction.x, z: direction.z });
        // The hour: the clock turns it by itself (a function of the time alone, so a seek and
        // a night lived through agree); a level's step eases in on top, the short way round.
        // A slow change of colour is not motion: reduced motion does not slow it.
        const turned = forestNearestTurn(this.hourStep, this.level - 1);
        this.hourStep += (turned - this.hourStep) * (1 - Math.exp(-dt * HOUR_FOLLOW));
        light.setHour(this.hourPhase(time));
        light.update(time, dt, { ...frame, front: env.front });
        this.fireflies.update(dt, env);
        this.terrain.update(frame);
        this.sky.update(dt, frame);
        light.commitField();
    }

    getDiagnostics() {
        return {
            quality: this.quality,
            ...(this.trees?.stats || {}),
            ...(this.understory?.stats || {}),
            farTrees: this.backdrop?.count || 0,
            fireflies: this.fireflies?.sim?.counts() || null,
            pulses: this.light?.pulses.active() || 0,
            level: this.level,
            // The hour the night is turning to, and how far round it is.
            hour: forestHourName(forestNearestTurn(this.hourStep, this.level - 1)
                + forestHourDrift(this.nightLived())),
            hourPhase: this.light?.hourPhase ?? 0,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.fireflies?.dispose();
        this.sky?.dispose();
        this.backdrop?.dispose();
        this.understory?.dispose();
        this.trees?.dispose();
        this.terrain?.dispose();
        this.light?.dispose();
        this.fireflies = null;
        this.director = null;
        this.stage = null;
        this.sky = null;
        this.backdrop = null;
        this.understory = null;
        this.trees = null;
        this.terrain = null;
        this.light = null;
        this.group.removeFromParent();
        this.group.clear();
    }
}
