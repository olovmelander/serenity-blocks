/**
 * Shared Aurora artwork: the playground and the production theme build exactly this.
 * The world owns every scene object, the curtain buffer, the event director and the camera
 * framing; its owner supplies simulation seconds, a renderer, and gameplay events through
 * `director`.
 */
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { flashScale } from '../../utils/photosensitivity.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { ThemeCameraRig } from '../shared/camera-rig.js';
import { AuroraAir } from './aurora-air.js';
import { AuroraAtmosphere } from './aurora-atmosphere.js';
import { AuroraCurtains } from './aurora-curtains.js';
import { AuroraDirector } from './aurora-director.js';
import { ExcitationMap } from './aurora-field.js';
import { AuroraLandscape } from './aurora-landscape.js';
import { bakeAuroraNoise, createRandom } from './aurora-noise.js';
import { resolveAuroraQuality } from './aurora-quality.js';
import { AuroraSky } from './aurora-sky.js';

/** The artwork is authored for this seed: the massifs, the saddle and the star field. */
export const AURORA_SEED = 20261005;
const NOISE_SIZE = 256;
/** Eye height above the lake, world units. High enough that ripples read as rings. */
const EYE_HEIGHT = 8;
/** The rig turns screen-fraction motion into translation over this distance. */
const FOCUS_DISTANCE = 60;
/** Rings land on the lake between these distances from the eye. */
const RIPPLE_NEAR = 44;
const RIPPLE_FAR = 200;
/** Meteors waiting their turn for a free slot: a fever's volleys become a shower. */
const METEOR_QUEUE = 16;
/** Seconds between the meteors of one volley, so they never start on the same frame. */
const VOLLEY_GAP = 0.13;
/** A meteor waits at most this long for a free slot, then takes the one furthest on. */
const METEOR_PATIENCE = 1.5;

export class AuroraWorld {
    constructor({
        scene, camera, quality = 'High', seed = AURORA_SEED,
    }) {
        if (!scene?.add) throw new TypeError('AuroraWorld requires a Three.js scene');
        this.scene = scene;
        this.camera = camera;
        this.quality = resolveAuroraQuality(quality);
        this.preset = this.quality.preset;
        this.seed = seed;
        this.disposed = false;
        this.time = 0;
        this.reducedMotion = false;
        this.group = new THREE.Group();
        this.group.name = 'Aurora — world';
        scene.add(this.group);

        this.uniforms = {
            time: uniform(0),
            activity: uniform(0),
            viewHeight: uniform(1080),
            aspect: uniform(16 / 9),
            auroraLight: uniform(new THREE.Vector3(0.03, 0.105, 0.07)),
        };

        this.noiseTexture = new THREE.DataTexture(
            bakeAuroraNoise(NOISE_SIZE, seed % 65521),
            NOISE_SIZE,
            NOISE_SIZE,
            THREE.RGBAFormat,
            THREE.UnsignedByteType,
        );
        this.noiseTexture.name = 'Aurora — shared noise tile';
        this.noiseTexture.wrapS = THREE.RepeatWrapping;
        this.noiseTexture.wrapT = THREE.RepeatWrapping;
        this.noiseTexture.magFilter = THREE.LinearFilter;
        this.noiseTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.noiseTexture.generateMipmaps = true;
        this.noiseTexture.colorSpace = THREE.NoColorSpace;
        this.noiseTexture.needsUpdate = true;

        this.excitation = new ExcitationMap();
        this.director = new AuroraDirector({ excitation: this.excitation, seed: seed ^ 0x2b7e15 });
        this.curtains = new AuroraCurtains({
            preset: this.preset, noiseTexture: this.noiseTexture, excitation: this.excitation,
        });
        this.atmosphere = new AuroraAtmosphere({
            uniforms: this.uniforms, noiseTexture: this.noiseTexture, curtains: this.curtains,
        });
        this.sky = new AuroraSky({
            parent: this.group,
            preset: this.preset,
            curtains: this.curtains,
            atmosphere: this.atmosphere,
            noiseTexture: this.noiseTexture,
            uniforms: this.uniforms,
            random: createRandom(seed ^ 0x51f15e),
        });
        this.landscape = new AuroraLandscape({
            parent: this.group,
            preset: this.preset,
            curtains: this.curtains,
            atmosphere: this.atmosphere,
            noiseTexture: this.noiseTexture,
            uniforms: this.uniforms,
            random: createRandom(seed ^ 0x7a11e5),
            seed: seed % 9973,
            eyeHeight: EYE_HEIGHT,
        });
        this.air = new AuroraAir({
            parent: this.group,
            preset: this.preset,
            uniforms: this.uniforms,
            atmosphere: this.atmosphere,
            random: createRandom(seed ^ 0xd157),
            eye: [0, EYE_HEIGHT, 0],
        });

        this.rest = new THREE.Vector3(0, EYE_HEIGHT, 0);
        this.focus = new THREE.Vector3(0, EYE_HEIGHT, -FOCUS_DISTANCE);
        this.rig = new ThemeCameraRig(camera, {
            focus: this.focus,
            rest: this.rest,
            breatheScale: 0.3,
            pointerScale: 0.2,
            idlePhase: 1.3,
        });
        this.meteorQueue = Array.from({ length: METEOR_QUEUE }, () => ({
            at: Infinity, from: [0, 1, 0], to: [0, 1, 0], duration: 1, brightness: 1, warmth: 0,
        }));
        this.lastMeteorAt = -Infinity;
        this.tangentX = 1;
        this.prepareCamera(camera.aspect || 16 / 9);
        this.applyDirector();
    }

    /** Frame the scene for an aspect ratio: the horizon sinks as the frame grows taller. */
    prepareCamera(aspect) {
        if (!this.camera || !Number.isFinite(aspect) || aspect <= 0) return;
        const portrait = aspect < 0.9;
        const { camera } = this;
        camera.fov = portrait ? 68 : 55;
        camera.aspect = aspect;
        camera.near = 0.5;
        camera.far = 12000;
        camera.updateProjectionMatrix();
        // Horizon height above the bottom edge, as a fraction of the frame.
        const horizon = portrait ? 0.15 : 0.27;
        const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
        this.pitch = Math.atan((1 - 2 * horizon) * Math.tan(halfFov));
        this.tangentX = Math.tan(halfFov) * aspect;
        this.focus.set(0, EYE_HEIGHT + Math.sin(this.pitch) * FOCUS_DISTANCE, -Math.cos(this.pitch) * FOCUS_DISTANCE);
        this.rig.setFocus(this.focus.x, this.focus.y, this.focus.z);
        this.uniforms.aspect.value = aspect;
        // Until the owner reports real board rectangles, assume one centred board.
        this.director.setBoard(0, 0, Math.atan(this.tangentX * (portrait ? 0.8 : 0.19)));
        this.rig.apply(0, this.rest);
    }

    /**
     * Report where a board sits on screen (fractions of the viewport width, 0 left … 1
     * right), so its events land in the sky above it. Slot 0 is the lone board.
     */
    setBoardSpan(index, left, right) {
        if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return;
        const leftAzimuth = Math.atan((left * 2 - 1) * this.tangentX);
        const rightAzimuth = Math.atan((right * 2 - 1) * this.tangentX);
        this.director.setBoard(index, (leftAzimuth + rightAzimuth) / 2, (rightAzimuth - leftAzimuth) / 2);
    }

    /** Drawing-buffer size in device pixels: sizes the curtain buffer and the stars. */
    setViewport(width, height) {
        if (!(width > 0) || !(height > 0)) return;
        this.uniforms.viewHeight.value = height;
        this.curtains.setSize(width, height);
    }

    /** Reduced motion keeps every event but holds the camera still and softens the sky. */
    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
        this.director.setReducedMotion(this.reducedMotion);
        this.rig.breathe = !this.reducedMotion;
        this.rig.pointer = !this.reducedMotion;
    }

    /** Copy the director's state into the uniforms the shaders read. */
    applyDirector() {
        const { director } = this;
        const curtain = this.curtains.uniforms;
        curtain.tau.value = director.tau;
        curtain.rayPhase.value = director.rayPhase;
        curtain.sway.value = director.sway;
        curtain.height.value = director.height;
        curtain.crown.value = director.crown;
        curtain.fringe.value = director.fringe;
        curtain.violet.value = director.violet;
        curtain.surge.value = director.surge;
        curtain.diffuse.value = director.diffuse;
        curtain.compress.value = director.compress;
        const bands = director.sweepBands;
        for (let i = 0; i < curtain.sweep.array.length; i += 1) {
            curtain.sweep.array[i].set(bands[i * 4], bands[i * 4 + 1], bands[i * 4 + 2], 0);
        }
        curtain.tint.value.set(director.tint[0], director.tint[1], director.tint[2], director.tint[3]);
        for (let i = 0; i < director.arcGain.length; i += 1) curtain.arcGain.array[i] = director.arcGain[i];
        for (let i = 0; i < curtain.billow.array.length; i += 1) {
            curtain.billow.array[i].set(
                director.billows[i * 4],
                director.billows[i * 4 + 1],
                director.billows[i * 4 + 2],
                0,
            );
        }
        this.uniforms.activity.value = director.activity;
        this.uniforms.auroraLight.value.set(director.light[0], director.light[1], director.light[2]);
    }

    /** Hand the director's queued one-shots to the layers that draw them. */
    drainDirector() {
        const { director, time } = this;
        for (let i = 0; i < director.rippleCount; i += 1) {
            const ripple = director.ripples[i];
            const reach = RIPPLE_NEAR + (RIPPLE_FAR - RIPPLE_NEAR) * ripple.range;
            this.landscape.ripple(
                time,
                Math.sin(ripple.azimuth) * reach,
                -Math.cos(ripple.azimuth) * reach,
                ripple.strength,
                ripple.color,
                ripple.speed,
            );
        }
        for (let i = 0; i < director.meteorCount; i += 1) this.queueMeteor(director.meteors[i], time);
        this.launchDueMeteors(time);
        if (director.shakeAmount > 0) this.rig.shake(director.shakeAmount, director.shakeDuration);
    }

    /**
     * Queue one of the director's meteors, a volley gap after the last one queued. A full
     * queue launches its earliest meteor now to make room: no meteor is ever dropped.
     */
    queueMeteor(meteor, time) {
        let entry = null;
        for (const waiting of this.meteorQueue) {
            if (waiting.at === Infinity) {
                entry = waiting;
                break;
            }
        }
        if (!entry) {
            entry = this.earliestMeteor();
            this.launchQueued(entry, time);
        }
        // A clock that went back (a seek) starts the queue afresh.
        const after = this.lastMeteorAt + VOLLEY_GAP;
        entry.at = after > time && after < time + METEOR_QUEUE * VOLLEY_GAP * 2 ? after : time;
        this.lastMeteorAt = entry.at;
        const { from, to } = entry;
        from[0] = Math.cos(meteor.fromElevation) * Math.sin(meteor.fromAzimuth);
        from[1] = Math.sin(meteor.fromElevation);
        from[2] = -Math.cos(meteor.fromElevation) * Math.cos(meteor.fromAzimuth);
        to[0] = Math.cos(meteor.toElevation) * Math.sin(meteor.toAzimuth);
        to[1] = Math.sin(meteor.toElevation);
        to[2] = -Math.cos(meteor.toElevation) * Math.cos(meteor.toAzimuth);
        entry.duration = meteor.duration;
        entry.brightness = meteor.brightness;
        entry.warmth = meteor.warmth;
    }

    earliestMeteor() {
        let first = this.meteorQueue[0];
        for (const waiting of this.meteorQueue) if (waiting.at < first.at) first = waiting;
        return first;
    }

    launchQueued(entry, time) {
        this.sky.launchMeteor(time, entry.from, entry.to, {
            duration: entry.duration, brightness: entry.brightness, warmth: entry.warmth,
        });
        entry.at = Infinity;
    }

    /** Start the meteors that are due, each as a slot comes free (or once it has waited long enough). */
    launchDueMeteors(time) {
        for (;;) {
            const entry = this.earliestMeteor();
            if (!(entry.at <= time)) return;
            if (!this.sky.hasFreeMeteorSlot(time) && time - entry.at < METEOR_PATIENCE) return;
            this.launchQueued(entry, time);
        }
    }

    update(time, dt = 0, pointer = null) {
        if (this.disposed || !Number.isFinite(time) || !Number.isFinite(dt)) return;
        this.time = time;
        this.uniforms.time.value = time;
        // Reduce flashing (ADR-0021) quiets the curtains pulsing in the rhythm of a quick hand.
        this.director.flashing = flashScale();
        this.director.update(dt);
        this.drainDirector();
        this.applyDirector();
        if (pointer && !this.reducedMotion) this.rig.setPointer(pointer.x, pointer.y);
        this.rig.apply(dt, this.rest);
        // The shared breath (shared/camera-breath.js) on top of the rig: an eye-level view up
        // into the sky, so it only turns. Off under reduced motion.
        applyCameraBreath(this.camera, time, { scale: this.reducedMotion ? 0 : 1 });
        this.sky.update(this.camera);
    }

    /** Offscreen work that must precede the scene render. */
    renderBuffers(renderer) {
        if (this.disposed || !this.curtains.due(this.time)) return;
        this.curtains.render(renderer, this.camera, this.time);
    }

    /** Rewind every stateful layer; replaying the same events then reproduces the frame. */
    reset() {
        if (this.disposed) return;
        this.time = 0;
        this.director.reset();
        for (const waiting of this.meteorQueue) waiting.at = Infinity;
        this.lastMeteorAt = -Infinity;
        this.sky.resetMeteors();
        this.landscape.resetRipples();
        this.rig.reset();
        this.curtains.lastRefresh = -Infinity;
        this.applyDirector();
    }

    getDiagnostics() {
        return {
            quality: this.quality.name,
            director: this.director.getDiagnostics(),
            curtains: this.curtains.getDiagnostics(),
            sky: this.sky.getDiagnostics(),
            landscape: this.landscape.getDiagnostics(),
            air: this.air.getDiagnostics(),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.air.dispose();
        this.landscape.dispose();
        this.sky.dispose();
        this.curtains.dispose();
        this.noiseTexture.dispose();
        this.group.removeFromParent();
        this.group.clear();
    }
}
