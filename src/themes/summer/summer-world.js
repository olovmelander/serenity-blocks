/**
 * Summer — Midsummer's Eve by the lake, shared by the isolated playground and both player
 * backends.
 *
 * SummerWorld is the composition root: it owns the light rig, the land, the woods, the
 * meadow, the homestead, the lake and the air, frames the camera, and forwards gameplay
 * envelopes to them each frame — worn (wear()): what moves the scene eased, and how hot play
 * runs (the reactions' `surge`) spent on the evening, act by act:
 *   calm   the evening as it always is
 *   warm   the evening takes notice: the breeze freshens, the butterflies come out over the
 *          meadow, the sun's road on the lake starts to glitter, the light warms
 *   hot    the meadow is alive with the player: the swallows hunt faster and lower, the
 *          shafts thicken, petals drift off the meadow on the wind, the lanterns brighten
 *   fever  Midsummer's Eve at its height: the meadow rolls in waves of wind (the reactions'
 *          gale), breathes its petals and seed down into the golden air, every flower in it
 *          glows, the swallows tower and wheel over the cove, the sun's road blazes and the
 *          maypole's lanterns run round the wreaths like the ring dance round the pole
 * A perfect clear crowns it with a sunburst through the wreath and the bouquet thrown into
 * the sky; when the hands rest the evening breathes back to calm over a few seconds.
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
import { drainSteps } from '../shared/build-steps.js';

export class SummerWorld {
    constructor({
        scene, camera, quality = 'High', rng = Math.random, assets, samples = 0,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.tier = summerTier(quality);
        /** The scene pass's samples; the lake's mirror takes the same (shared/scene-antialias.js). */
        this.samples = samples;
        this.rng = rng;
        this.assets = assets;
        this.group = new THREE.Group();
        this.group.name = 'Summer — Midsummer\'s Eve by the lake';
        this.disposed = false;
        this.built = false;
        this.boardCentre = new THREE.Vector3();
        /** Reduce motion's share (setMotion), and the envelopes as worn (wear()). */
        this.motion = 1;
        this.worn = {
            gust: 0,
            gustSpeed: 0,
            flock: 0,
            flockSpeed: 0,
            flutter: 0,
            flutterSpeed: 0,
            warmth: 0,
            glow: 0,
            shimmer: 0,
            sunburst: 0,
            bloom: 0,
            level: 0,
            fever: 0,
            punch: 0,
            motion: 1,
        };
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /**
     * The build as steps, a part (or a half of the terrain or the meadow) to a step: run at once by
     * build(), or with a breath between steps while the theme comes in (shared/build-steps.js), so
     * no single task holds the page for the whole 0.4-0.5 s. The same parts in the same order,
     * drawing from the same random sequence.
     */
    * buildSteps() {
        if (this.disposed) throw new Error('Cannot rebuild a disposed SummerWorld.');
        if (this.built) return;
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
        yield 'light';
        yield* this.terrain.buildSteps();
        yield 'terrain';
        this.forest = new SummerForest({
            light, assets: this.assets, tier, rng,
        });
        this.group.add(this.forest.group);
        this.forest.build();
        yield 'forest';
        this.backdrop = new SummerBackdrop({
            light, impostors, tier, rng,
        });
        this.group.add(this.backdrop.group);
        this.backdrop.build();
        yield 'backdrop';
        this.atmosphere = new SummerAtmosphere({ light, tier, rng });
        this.group.add(this.atmosphere.group);
        this.atmosphere.build();
        this.homestead = new SummerHomestead({
            light, props, tier, rng,
        });
        this.group.add(this.homestead.group);
        this.homestead.build();
        yield 'homestead';
        this.meadow = new SummerMeadow({ light, tier, rng });
        this.group.add(this.meadow.group);
        yield* this.meadow.buildSteps();
        yield 'meadow';
        this.shore = new SummerShore({
            light, tier, rng, meadow: this.meadow,
        });
        this.group.add(this.shore.group);
        this.shore.build();
        yield 'shore';
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
        this.lake = new SummerLake({
            light, tier, lakeMap: this.terrain.lakeMap, samples: this.samples,
        });
        this.group.add(this.lake.group);
        this.lake.build();
        // The meadow lies behind its own crest as the lake sees it, so it is left out of the mirror.
        // So are the garlands and the drifting petals and down: they hang near the eye, and their
        // images would land on the meadow, not the water. Each one kept out is a draw (and its
        // pipelines) the mirror pass no longer pays for, every frame.
        this.reflect([this.terrain.group, this.forest.group, this.backdrop.group, this.atmosphere.group,
            this.homestead.group, this.shore.group, this.life.group]);
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
        this.life?.reset();
        Object.assign(this.worn, {
            gust: 0, gustSpeed: 0, flock: 0, flockSpeed: 0, flutter: 0, flutterSpeed: 0, warmth: 0, sunburst: 0,
        });
    }

    /**
     * Reduce motion: the wind, the fronts, the startled swallows, the butterflies' flight and the
     * hurry play puts into them are calmed to this share (1: all of it). The theme sets it from
     * Settings and the system preference.
     */
    setMotion(scale) {
        this.motion = Number.isFinite(scale) ? THREE.MathUtils.clamp(scale, 0, 1) : 1;
    }

    /**
     * The envelopes as the world wears them. What MOVES the scene (the gust bending every stem
     * and bough, the swallows towering, the butterflies lifting) follows its envelope through a
     * critically damped spring, and the warmth of the light and the sunburst ease in over a
     * moment, so a lock leans the meadow instead of jerking it and rapid locks raise the wind
     * instead of shaking it. A still frame (no time passing: the first frame, a seek) shows the
     * envelopes as they stand. How hot play runs (`surge`) raises floors under them: the evening
     * takes notice, comes alive, and in a fever sings.
     */
    wear(frame, dt) {
        const unit = (value, high = 1) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, high) : 0);
        const { worn } = this;
        const motion = this.motion ?? 1;
        const surge = frame.surge && typeof frame.surge === 'object' ? frame.surge : null;
        const level = unit(surge?.level);
        const fever = unit(surge?.fever);
        worn.level = level;
        worn.fever = fever;
        worn.punch = unit(surge?.punch);
        worn.motion = motion;
        const still = !(dt > 0);
        const step = Math.min(still ? 0 : dt, 0.05);
        const spring = (key, speed, target, omega) => {
            if (still) {
                worn[key] = target;
                worn[speed] = 0;
                return target;
            }
            const pull = omega * omega * (target - worn[key]) - 2 * omega * worn[speed];
            worn[speed] += pull * step;
            worn[key] += worn[speed] * step;
            if (!Number.isFinite(worn[key]) || !Number.isFinite(worn[speed])) {
                worn[key] = target;
                worn[speed] = 0;
            }
            return worn[key];
        };
        const ease = (key, target, rate) => {
            worn[key] = still ? target : worn[key] + (target - worn[key]) * (1 - Math.exp(-step * rate));
            return worn[key];
        };
        // A floor that play raises under an envelope: the two combined, never past full.
        const lift = (value, floor) => value + (1 - value) * floor;
        spring('gust', 'gustSpeed', unit(frame.gust), 7);
        // In a fever the swallows tower and wheel over the cove, and keep to it.
        spring('flock', 'flockSpeed', Math.max(unit(frame.flock), fever * 0.45), 3.5);
        // The butterflies come out over the meadow as play warms, and dance in a fever.
        spring('flutter', 'flutterSpeed', lift(unit(frame.flutter), level * 0.25 + fever * 0.3), 4);
        ease('warmth', lift(unit(frame.warmth), level * 0.16 + fever * 0.3), 9);
        ease('sunburst', unit(frame.sunburst), 7);
        worn.glow = lift(unit(frame.glow), level * 0.12 + fever * 0.22);
        // The sun's road on the lake glitters as play warms and blazes in a fever.
        worn.shimmer = lift(unit(frame.shimmer), level * 0.3 + fever * 0.45);
        // Every flower in the meadow glows a little in a fever, as if the whole field answered.
        worn.bloom = fever * 0.32;
        return worn;
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

    /** The theme is built hidden behind the one playing: the combo ribbons draw (unseen) meanwhile. */
    setWarming(on) {
        if (this.garlands) this.garlands.warming = on === true;
    }

    update(rawTime, rawStep, frame = {}) {
        if (!this.built || this.disposed || !this.director) return;
        const { light } = this;
        const time = Number.isFinite(rawTime) ? Math.max(0, rawTime) : light.uTime.value;
        const dt = Number.isFinite(rawStep) ? Math.max(0, rawStep) : 0;
        const direction = light.uWindDir.value;
        const worn = this.wear(frame || {}, dt);
        const env = this.director.apply(frame, dt, {
            x: direction.x, z: direction.z, strength: light.uWind.value,
        }, worn);
        light.update(time, { ...frame, front: env.front }, worn, env.fronts);
        light.step(dt);
        this.petals.update(dt, env);
        this.life.update(frame, dt, worn);
        this.garlands.update(frame, worn);
        const rocked = this.homestead.update(time, dt, frame, worn);
        if (rocked) this.lake.ripples.add(rocked.x, rocked.z, 0.2);
        this.lake.update(dt, frame, worn);
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
