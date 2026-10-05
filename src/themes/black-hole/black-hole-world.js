/**
 * Shared Black Hole artwork: the playground and the production theme build exactly this.
 * The world owns every scene object, the baked textures, the event director and the camera
 * choreography; its owner supplies simulation seconds, a renderer, and gameplay events
 * through `director`.
 */
import * as THREE from 'three/webgpu';
import { ThemeCameraRig } from '../shared/camera-rig.js';
import { BlackHoleDirector, DIRECTOR_LIMITS } from './black-hole-director.js';
import {
    HOLE, createLensMaterial, createLensMesh, createLensUniforms,
} from './black-hole-lens.js';
import { BlackHoleMatter } from './black-hole-matter.js';
import {
    bakeDiskTexture, bakeSkyRows, bakeSkyTexture, createRandom,
} from './black-hole-noise.js';
import { resolveBlackHoleQuality } from './black-hole-quality.js';

/** The artwork is authored for this seed: the galaxy, the gas and the camera's phases. */
export const BLACK_HOLE_SEED = 20261005;
const DISK_TEXTURE_SIZE = [512, 128];

/** The camera circles the hole at this distance and elevation before the slow wander. */
const ORBIT_RADIUS = Math.hypot(105, 1040);
const ORBIT_ELEVATION = Math.asin(105 / ORBIT_RADIUS);
/** Never let the camera inside the sphere the lens starts marching from. */
const MIN_ORBIT_RADIUS = HOLE.BOUND * HOLE.RS_WORLD * 1.12;
const BASE_FOV = 60;
/** Seconds for the gas at the inner edge to circle the hole when nothing is happening. */
const INNER_ORBIT_SECONDS = 13;
/** Turns of inner-edge rotation between two resets of the shear phases. */
const FLOW_PERIOD = 2.2;
const RIGID_RATE = 0.42;
/** A fed piece leaves the board this far toward the hole, as a fraction of the way there. */
const FEED_DEPTH = 0.6;
/** The hole rests in the free space beside the boards; a gap narrower than this is no rest. */
const MIN_GAP = 0.16;
/** Where it rests when there is no gap to speak of (portrait, a row of boards), in NDC. */
const FALLBACK_FRAME = 0.33;
/** Radians per second of the slow side-to-side wander, and how briskly it crosses the board. */
const FRAME_RATE = 0.03;
const FRAME_CROSSING = 0.012;

const bakeCache = new Map();
function cached(key, bake) {
    if (!bakeCache.has(key)) bakeCache.set(key, bake());
    return bakeCache.get(key);
}

/** CPU bakes for a tier, shared across worlds; `seed` and the sizes are the whole key. */
export function bakeBlackHoleTextures(preset, seed = BLACK_HOLE_SEED) {
    const [skyWidth, skyHeight] = preset.skySize;
    const [diskWidth, diskHeight] = DISK_TEXTURE_SIZE;
    return {
        disk: {
            data: cached(
                `disk:${seed}:${diskWidth}x${diskHeight}`,
                () => bakeDiskTexture(diskWidth, diskHeight, seed % 65521),
            ),
            width: diskWidth,
            height: diskHeight,
        },
        sky: {
            data: cached(
                `sky:${seed}:${skyWidth}x${skyHeight}`,
                () => bakeSkyTexture(skyWidth, skyHeight, seed % 9973),
            ),
            width: skyWidth,
            height: skyHeight,
        },
    };
}

/** Milliseconds of baking between yields to the event loop. */
const BAKE_SLICE_MS = 7;
const yieldToLoop = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * The same bakes as bakeBlackHoleTextures(), spread over short slices so a loading screen
 * keeps animating while the galaxy is painted.
 */
export async function bakeBlackHoleTexturesAsync(preset, seed = BLACK_HOLE_SEED) {
    const [width, height] = preset.skySize;
    const [diskWidth, diskHeight] = DISK_TEXTURE_SIZE;
    const skyKey = `sky:${seed}:${width}x${height}`;
    if (!bakeCache.has(skyKey)) {
        const data = new Uint8Array(width * height * 4);
        let row = 0;
        while (row < height) {
            const started = performance.now();
            while (row < height && performance.now() - started < BAKE_SLICE_MS) {
                const next = Math.min(height, row + 4);
                bakeSkyRows(data, width, height, seed % 9973, row, next);
                row = next;
            }
            // eslint-disable-next-line no-await-in-loop
            if (row < height) await yieldToLoop();
        }
        // A synchronous bake may have finished first; either result is the same bytes.
        if (!bakeCache.has(skyKey)) bakeCache.set(skyKey, data);
    }
    if (!bakeCache.has(`disk:${seed}:${diskWidth}x${diskHeight}`)) await yieldToLoop();
    return bakeBlackHoleTextures(preset, seed);
}

function dataTexture(bake, name, { srgb = false, mipmaps = false, repeatT = false } = {}) {
    const texture = new THREE.DataTexture(bake.data, bake.width, bake.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = name;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = repeatT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.generateMipmaps = mipmaps;
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
}

export class BlackHoleWorld {
    constructor({
        scene, camera, quality = 'High', seed = BLACK_HOLE_SEED, bakes = null,
    }) {
        if (!scene?.add) throw new TypeError('BlackHoleWorld requires a Three.js scene');
        this.scene = scene;
        this.camera = camera;
        this.quality = resolveBlackHoleQuality(quality);
        this.preset = this.quality.preset;
        this.seed = seed;
        this.disposed = false;
        this.time = 0;
        this.reducedMotion = false;
        this.group = new THREE.Group();
        this.group.name = 'Black Hole — world';
        scene.add(this.group);

        const textures = bakes ?? bakeBlackHoleTextures(this.preset, seed);
        this.diskTexture = dataTexture(textures.disk, 'Black Hole — accretion gas', { mipmaps: true, repeatT: true });
        this.skyTexture = dataTexture(textures.sky, 'Black Hole — galaxy', { srgb: true });

        this.uniforms = createLensUniforms();
        // The Milky Way crosses the disk plane steeply, so the two never read as one band.
        this.uniforms.diskToSky.value.setFromMatrix4(
            new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(1.02, 0.55, 0.38)),
        );
        this.lensMaterial = createLensMaterial({
            uniforms: this.uniforms,
            diskTexture: this.diskTexture,
            skyTexture: this.skyTexture,
            steps: this.preset.marchSteps,
            stepScale: this.preset.stepScale,
            starLayers: this.preset.starLayers,
            detail: this.preset.diskDetail,
            shadowAlpha: this.preset.enablePost === true,
        });
        this.lens = createLensMesh(this.lensMaterial);
        this.group.add(this.lens);

        this.director = new BlackHoleDirector({ seed: seed ^ 0x2b7e15 });
        this.matter = new BlackHoleMatter({
            parent: this.group, preset: this.preset, lens: this.uniforms, gasTexture: this.diskTexture,
        });
        /** Refraction rings for the post chain: centre (uv, y down), radius in screen heights. */
        this.ripples = Array.from({ length: DIRECTOR_LIMITS.ripples }, () => ({
            x: 0.5, y: 0.5, radius: 0, strength: 0,
        }));
        /** The hole on screen: uv (y down). */
        this.holeScreen = new THREE.Vector2(0.5, 0.5);
        this.scratch = {
            point: new THREE.Vector3(),
            origin: new THREE.Vector3(),
            right: new THREE.Vector3(),
            down: new THREE.Vector3(),
            forward: new THREE.Vector3(),
        };

        const random = createRandom(seed ^ 0x9e3779b9);
        this.phase = {
            driftX: random() * Math.PI * 2,
            driftY: random() * Math.PI * 2,
            swayX: random() * Math.PI * 2,
            swayY: random() * Math.PI * 2,
            swayZ: random() * Math.PI * 2,
            a: random() * Math.PI * 2,
            b: random() * Math.PI * 2,
            c: random() * Math.PI * 2,
            d: random() * Math.PI * 2,
        };
        this.hole = new THREE.Vector3();
        this.cameraTarget = new THREE.Vector3();
        this.cameraSmoothed = new THREE.Vector3();
        this.lookTarget = new THREE.Vector3();
        this.lookSmoothed = new THREE.Vector3();
        this.forward = new THREE.Vector3();
        this.right = new THREE.Vector3();
        this.up = new THREE.Vector3();
        this.worldUp = new THREE.Vector3(0, 1, 0);
        this.rollAxis = new THREE.Vector3(0, 0, 1);
        this.rollQuaternion = new THREE.Quaternion();
        this.roll = 0;
        this.pointer = { x: 0, y: 0 };
        this.energy = 0;
        /** Turns the inner edge has made; the gas pattern is a function of this alone. */
        this.diskTurns = 0;
        this.diskRate = 1;
        /**
         * Fixed framing for stills: { azimuth, elevation, radius } in radians / world units,
         * { frame } as the hole's horizontal place in NDC, { up } in world units, and
         * optionally { fov } in degrees and { roll } in radians.
         */
        this.pose = null;

        this.rig = new ThemeCameraRig(camera, {
            focus: { x: 0, y: 0, z: 0 },
            breathe: false, // the orbital float below is the breathing
            pointer: false, // and it applies its own parallax and bank
            idlePhase: 0,
        });
        this.viewHeight = 1080;
        this.prepareCamera(camera.aspect || 16 / 9);
        this.reset();
    }

    prepareCamera(aspect) {
        if (!this.camera || !Number.isFinite(aspect) || aspect <= 0) return;
        const { camera } = this;
        camera.fov = this.pose?.fov ?? BASE_FOV;
        camera.aspect = aspect;
        camera.near = 1;
        camera.far = 20000;
        camera.updateProjectionMatrix();
        this.updatePixelAngle();
    }

    /** Drawing-buffer size in device pixels: sizes the stars and motes and picks the gas mip. */
    setViewport(width, height) {
        if (!(width > 0) || !(height > 0)) return;
        this.viewHeight = height;
        this.matter.setViewport(width, height);
        this.updatePixelAngle();
    }

    /**
     * Report where a board sits on screen (fractions of the viewport, top-left origin), so a
     * locked piece leaves from where it landed. Slot 0 is the lone board.
     */
    setBoardRect(slot, rect) {
        this.director.setBoard(slot, rect);
    }

    updatePixelAngle() {
        const fov = THREE.MathUtils.degToRad(this.camera?.fov ?? BASE_FOV);
        this.uniforms.pixelAngle.value = (2 * Math.tan(fov / 2)) / Math.max(1, this.viewHeight);
    }

    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
        this.director.setReducedMotion(this.reducedMotion);
    }

    /** The hole floats a little, so the composition is never quite still. */
    holeDrift(time, out) {
        const t = time * 0.045;
        const { driftX, driftY } = this.phase;
        return out.set(
            (Math.sin(t + driftX) + Math.cos(t * 1.34 + driftX)) * 0.5 * 55,
            (Math.cos(t * 0.89 + driftY) + Math.sin(t * 1.67 + driftY)) * 0.5 * 32,
            (Math.sin(t * 0.73 + driftX) + Math.cos(t * 1.1 + driftY)) * 0.5 * 24,
        );
    }

    /**
     * Where the camera wants to be: a slow, complete orbit of the hole whose elevation
     * floats across the disk plane and whose radius dollies in and out.
     */
    orbitTarget(time, out) {
        const { phase, pose } = this;
        const azimuth = pose?.azimuth ?? time * 0.075
            + Math.sin(time * 0.021 + phase.a) * 0.3
            + Math.sin(time * 0.043 + phase.b) * 0.12;
        const elevation = pose?.elevation ?? ORBIT_ELEVATION + 0.1
            + Math.sin(time * 0.029 + phase.c) * 0.15
            + Math.sin(time * 0.017 + phase.d) * 0.06;
        const zoom = 1
            + Math.sin(time * 0.038 + phase.d) * 0.15
            + Math.sin(time * 0.013 + phase.a) * 0.06;
        const pushIn = this.reducedMotion ? 0 : this.energy * 24;
        const radius = Math.max(MIN_ORBIT_RADIUS, pose?.radius ?? ORBIT_RADIUS * zoom - pushIn);
        const flat = Math.cos(elevation) * radius;
        return out.set(Math.sin(azimuth) * flat, Math.sin(elevation) * radius, Math.cos(azimuth) * flat);
    }

    updateCamera(time, dt, snap = false) {
        const { camera, phase, pose } = this;
        if (!camera) return;
        const still = this.reducedMotion ? 0 : 1;
        const { energy } = this;
        this.orbitTarget(this.reducedMotion ? 0 : time, this.cameraTarget);
        if (!pose) {
            const sway = (0.5 + energy * 0.32) * still;
            const swayX = Math.sin(time * 0.22 + phase.swayX) * 8.5 + Math.cos(time * 0.09 + phase.swayY) * 5.2;
            const swayY = Math.cos(time * 0.18 + phase.swayY) * 5.8 + Math.sin(time * 0.11 + phase.swayZ) * 3.8;
            this.cameraTarget.x += swayX * sway + this.hole.x * 0.08 + this.pointer.x * 96;
            this.cameraTarget.y += swayY * sway + this.hole.y * 0.06 - this.pointer.y * 54;
            this.cameraTarget.z += this.hole.z * 0.15;
        }
        if (snap) this.cameraSmoothed.copy(this.cameraTarget);
        else this.cameraSmoothed.lerp(this.cameraTarget, Math.min(1, dt * (1.8 + energy * 0.9)));

        // The board fills the middle of the screen, so the hole is framed off-centre in the
        // camera's own axes and wanders slowly between the gaps at its sides.
        this.forward.copy(this.hole).sub(this.cameraSmoothed);
        const distance = this.forward.length() || 1;
        this.forward.divideScalar(distance);
        this.right.crossVectors(this.forward, this.worldUp).normalize();
        this.up.crossVectors(this.right, this.forward).normalize();
        const frameTime = this.reducedMotion ? 0 : time;
        // Looking to the right of the hole puts the hole left of centre, hence the sign.
        const halfWidth = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.aspect;
        let screenRight = -(pose?.frame ?? this.frameTarget(frameTime)) * halfWidth + this.pointer.x * 30.7;
        const screenUp = pose?.up ?? -50 + Math.sin(frameTime * 0.023 + phase.c) * 60 - this.pointer.y * 17.3;
        // A narrow portrait frame needs room for the shadow and its ring.
        const limit = camera.aspect < 1
            ? Math.max(0, distance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.aspect - 160)
            : Infinity;
        screenRight = THREE.MathUtils.clamp(screenRight, -limit, limit);
        this.lookTarget.copy(this.hole).addScaledVector(this.right, screenRight).addScaledVector(this.up, screenUp);
        if (snap) this.lookSmoothed.copy(this.lookTarget);
        else this.lookSmoothed.lerp(this.lookTarget, Math.min(1, dt * (2.4 + energy * 1.2)));
        if (Number.isFinite(limit)) {
            // Reframe an old landscape target immediately after rotation.
            const offset = this.scratch.point.copy(this.lookSmoothed).sub(this.hole).dot(this.right);
            this.lookSmoothed.addScaledVector(this.right, THREE.MathUtils.clamp(offset, -limit, limit) - offset);
        }

        this.rig.setFocus(this.lookSmoothed.x, this.lookSmoothed.y, this.lookSmoothed.z);
        this.rig.apply(dt, this.cameraSmoothed);

        const rollTarget = pose ? pose.roll ?? 0 : (
            Math.sin(time * 0.08 + phase.swayY) * 0.0022 + Math.cos(time * 0.13 + phase.swayZ) * 0.0016
        ) * (1 + energy * 0.3) * still - this.pointer.x * 0.016;
        this.roll = snap ? rollTarget : this.roll + (rollTarget - this.roll) * Math.min(1, dt * 2);
        this.rollQuaternion.setFromAxisAngle(this.rollAxis, this.roll);
        camera.quaternion.multiply(this.rollQuaternion);
        camera.updateMatrixWorld();
        this.lens.position.copy(camera.position);
    }

    /**
     * Where the hole sits across the frame, in NDC. It rests in the free space to one side of
     * the boards, drifts a little there, and now and then glides behind them to the other.
     */
    frameTarget(time) {
        const board = this.director.boards[0];
        const leftGap = board.left;
        const rightGap = 1 - board.right;
        const left = leftGap >= MIN_GAP ? board.left - 1 : -FALLBACK_FRAME;
        const right = rightGap >= MIN_GAP ? board.right : FALLBACK_FRAME;
        // Starts well into the left gap and stays for the first minute and a half.
        const swing = Math.sin(time * FRAME_RATE - 2.9);
        const side = swing / Math.sqrt(swing * swing + FRAME_CROSSING);
        const drift = Math.sin(time * 0.041 + this.phase.d) * 0.035;
        return left + (right - left) * (side * 0.5 + 0.5) + drift;
    }

    /** Advance the gas: one rigid turn count plus two shear phases that take turns resetting. */
    updateDisk(dt) {
        this.diskTurns += (dt / INNER_ORBIT_SECONDS) * this.diskRate;
        const cycle = this.diskTurns / FLOW_PERIOD;
        const a = cycle - Math.floor(cycle);
        const b = (cycle + 0.5) - Math.floor(cycle + 0.5);
        const u = this.uniforms;
        u.diskRigid.value = (this.diskTurns * RIGID_RATE) % 1;
        u.flowA.value = (a - 0.5) * FLOW_PERIOD;
        u.flowB.value = (b - 0.5) * FLOW_PERIOD;
        // Each phase is faded out while its shear is at its extreme and about to reset.
        u.flowMix.value = Math.abs(2 * a - 1);
    }

    /** World-space launch frame of a fed piece: where its centroid is and one cell each way. */
    resolveFeed(infall) {
        const { camera, scratch } = this;
        const {
            point, origin, right, down, forward,
        } = scratch;
        camera.getWorldDirection(forward);
        point.set(infall.u * 2 - 1, 1 - infall.v * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        const depth = camera.position.distanceTo(this.hole) * FEED_DEPTH;
        origin.copy(camera.position).addScaledVector(point, depth / Math.max(0.2, point.dot(forward)));
        const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth;
        right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(infall.cellWidth * span * camera.aspect);
        down.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-infall.cellHeight * span);
        // The stream sweeps round with the gas from wherever it starts on the disk's clock.
        point.copy(origin).sub(this.hole).applyMatrix3(this.uniforms.worldToDisk.value);
        const stream = infall;
        stream.landAzimuth = Math.atan2(point.z, point.x) + infall.swirl;
    }

    /** Copy the director's state into the uniforms the shaders read. */
    applyDirector() {
        const { director, uniforms: u, scratch } = this;
        this.energy = director.energy;
        this.diskRate = director.diskRate;
        u.diskHeat.value = director.diskHeat;
        u.diskGain.value = director.diskGain;
        u.ringGain.value = director.ringGain;
        for (let slot = 0; slot < director.hotspots.length; slot += 1) {
            const hotspot = director.hotspots[slot];
            const strength = hotspot.active ? hotspot.strength : 0;
            u.hotspot.array[slot].set(hotspot.azimuth, hotspot.radius, hotspot.width, strength);
            u.hotspotTint.array[slot].set(hotspot.color[0], hotspot.color[1], hotspot.color[2], 0);
        }
        for (let slot = 0; slot < director.waves.length; slot += 1) {
            const wave = director.waves[slot];
            u.wave.array[slot].set(wave.radius, wave.active ? wave.strength : 0, wave.width, 0);
        }
        for (let slot = 0; slot < director.infalls.length; slot += 1) {
            const infall = director.infalls[slot];
            if (infall.active && infall.fresh) {
                infall.fresh = false;
                this.resolveFeed(infall);
                this.matter.setInfall(slot, infall, scratch.origin, scratch.right, scratch.down);
            } else this.matter.setInfall(slot, infall, null);
        }
        scratch.point.copy(this.hole).project(this.camera);
        this.holeScreen.set(scratch.point.x * 0.5 + 0.5, 0.5 - scratch.point.y * 0.5);
        for (let slot = 0; slot < director.ripples.length; slot += 1) {
            const ripple = director.ripples[slot];
            const target = this.ripples[slot];
            target.x = ripple.fromHole ? this.holeScreen.x : ripple.x;
            target.y = ripple.fromHole ? this.holeScreen.y : ripple.y;
            target.radius = ripple.radius;
            target.strength = ripple.active ? ripple.strength : 0;
        }
        this.matter.update({ time: this.time, turns: this.diskTurns, director });
    }

    update(time, dt = 0, pointer = null) {
        if (this.disposed || !Number.isFinite(time) || !Number.isFinite(dt)) return;
        this.time = time;
        if (pointer && !this.reducedMotion) {
            const ease = Math.min(1, dt * 3.4);
            this.pointer.x += (pointer.x - this.pointer.x) * ease;
            this.pointer.y += (pointer.y - this.pointer.y) * ease;
        }
        this.director.update(dt);
        if (this.director.shakeAmount > 0) this.rig.shake(this.director.shakeAmount, this.director.shakeDuration);
        this.energy = this.director.energy;
        this.diskRate = this.director.diskRate;
        this.holeDrift(this.reducedMotion ? 0 : time, this.hole);
        this.uniforms.holePosition.value.copy(this.hole);
        this.updateDisk(dt);
        this.updateCamera(time, dt);
        this.applyDirector();
    }

    /** Rewind every stateful layer; replaying the same events then reproduces the frame. */
    reset() {
        if (this.disposed) return;
        this.time = 0;
        this.energy = 0;
        this.diskTurns = 0;
        this.diskRate = 1;
        this.roll = 0;
        this.pointer.x = 0;
        this.pointer.y = 0;
        this.rig.reset();
        this.director.reset();
        this.holeDrift(0, this.hole);
        this.uniforms.holePosition.value.copy(this.hole);
        this.updateDisk(0);
        this.updateCamera(0, 0, true);
        this.applyDirector();
    }

    getDiagnostics() {
        return {
            quality: this.quality.name,
            marchSteps: this.preset.marchSteps,
            diskTurns: this.diskTurns,
            cameraDistance: this.camera ? this.camera.position.distanceTo(this.hole) / HOLE.RS_WORLD : 0,
            director: this.director.getDiagnostics(),
            matter: this.matter.getDiagnostics(),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.matter.dispose();
        this.lens.geometry.dispose();
        this.lensMaterial.dispose();
        this.diskTexture.dispose();
        this.skyTexture.dispose();
        this.group.removeFromParent();
        this.group.clear();
    }
}
