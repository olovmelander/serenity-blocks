/**
 * Sunfall — the world: the authored doline drawn with the theme's node materials.
 *
 * Nine parts (`SUNFALL_PARTS`):
 * - `sky`: the tropical sky outside, seen through the oculus and the far doline.
 * - `cave`: the chamber shell (Blender-authored, Cycles-baked light per vertex).
 * - `jungle`: the canopy of instanced crowns on the doline floor, and the surface forest
 *   leaning over the oculus rim.
 * - `beam`: dust in the sunfall (the column itself is integrated in the post, with depth).
 * - `mist`: the Exhale cloud and the cataract's spray shell (the deck and the valley mist
 *   are integrated in the post).
 * - `water`: the cataract, the flood threads and the rain that glitters only in the light.
 * - `roots`: strands of aerial roots either side of the card, with the young leaves of locks.
 * - `birds`: cave swiftlets crossing the chamber.
 * - `gours`: the rimstone ledge the eye stands on.
 *
 * `SunfallWorld.prepare()` loads the authored assets; a world built without them (unit tests)
 * has every part but the authored ones empty.
 */
import * as THREE from 'three/webgpu';
import {
    CANOPY_LEVEL,
    SUNFALL_CLEAR,
    SUNFALL_LAYOUT,
    SUNFALL_PARTS,
    SUNFALL_SEED,
    footFor,
    mulberry32,
    planDoline,
    solveBowSun,
} from './sunfall-core.js';
import { applyCameraBreath } from '../shared/camera-breath.js';
import { resolveSunfallQuality } from './sunfall-quality.js';
import { bakeAllSunfallTextures } from './sunfall-bake.js';
import { disposeSunfallAssets, loadSunfallAssets } from './sunfall-assets.js';
import { cameraRigFor } from './sunfall-composition.js';
import {
    createCrownMaterial,
    createShellMaterial,
    createSkyMaterial,
    createSunfallUniforms,
} from './sunfall-tsl.js';
import { buildSunfallLife } from './sunfall-life.js';

const DEG = Math.PI / 180;

export class SunfallWorld {
    /** Load the authored assets (resolves to null if `isCurrent` turns false meanwhile). */
    static prepare(options = {}) {
        return loadSunfallAssets(options);
    }

    /**
     * The same, never throwing: without the authored geometry (a failed load) the world still
     * has its sky, its light and its life, so the theme never blocks the game.
     */
    static disposeAssets(assets) {
        disposeSunfallAssets(assets);
    }

    static async prepareSafely(options = {}) {
        try {
            return await loadSunfallAssets(options);
        } catch (error) {
            console.warn('[Sunfall] Authored assets failed to load; the doline is drawn without them.', error);
            return null;
        }
    }

    constructor({
        scene = null,
        camera = null,
        quality = 'High',
        seed = SUNFALL_SEED,
        parts = null,
        assets = null,
    } = {}) {
        this.preset = resolveSunfallQuality(quality);
        this.seed = seed >>> 0;
        this.plan = planDoline(this.seed, this.preset);
        this.assets = assets;

        this.scene = scene || new THREE.Scene();
        this.scene.background = new THREE.Color(SUNFALL_CLEAR);
        this.camera = camera || new THREE.PerspectiveCamera(52, 16 / 9, 0.5, 4000);
        this.camera.near = 0.5;
        this.camera.far = 4000;
        this.aspect = 16 / 9;
        this.rig = cameraRigFor(this.aspect);
        this.restCamera();

        this.pointerX = 0;
        this.pointerY = 0;
        this.customCameraOverride = false;

        this.textures = bakeAllSunfallTextures(this.seed, assets);
        this.u = createSunfallUniforms(this.textures, assets?.manifest);
        this.u.eye = new THREE.Vector3();

        this.partGroups = new Map();
        for (const partName of SUNFALL_PARTS) {
            const g = new THREE.Group();
            g.name = `sunfall-${partName}`;
            this.scene.add(g);
            this.partGroups.set(partName, g);
        }
        this.disposables = [];
        this.visibleParts = new Set(SUNFALL_PARTS);

        this._buildSky();
        if (assets) {
            this._buildCave();
            this._buildJungle();
            this._buildGours();
        }
        this.life = buildSunfallLife(this);
        if (parts) this.setParts(parts);
    }

    _track(resource) {
        if (resource && typeof resource.dispose === 'function') this.disposables.push(resource);
        return resource;
    }

    setParts(partsFilter = null) {
        const list = !partsFilter ? SUNFALL_PARTS : (Array.isArray(partsFilter)
            ? partsFilter
            : String(partsFilter).split(',').map((s) => s.trim()).filter(Boolean));
        this.visibleParts = new Set(list);
        for (const [name, g] of this.partGroups.entries()) g.visible = this.visibleParts.has(name);
    }

    isPartVisible(name) {
        return this.visibleParts.has(name);
    }

    setPointer(px = 0, py = 0) {
        this.pointerX = Number.isFinite(px) ? Math.max(-1, Math.min(1, px)) : 0;
        this.pointerY = Number.isFinite(py) ? Math.max(-1, Math.min(1, py)) : 0;
    }

    restCamera() {
        const { rig } = this;
        this.camera.fov = rig.fov;
        this.camera.position.set(...rig.position);
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(rig.pitch * DEG, rig.yaw * DEG, 0);
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld(true);
    }

    _buildSky() {
        const group = this.partGroups.get('sky');
        const material = this._track(createSkyMaterial(this.u));
        const geometry = this._track(new THREE.SphereGeometry(3600, 48, 24));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 100;
        mesh.frustumCulled = false;
        group.add(mesh);
    }

    _buildCave() {
        const group = this.partGroups.get('cave');
        const material = this._track(createShellMaterial(this.u, { kind: 'shell' }));
        this.assets.shell.forEach((geometry) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.renderOrder = 20;
            group.add(mesh);
        });
    }

    _buildGours() {
        const group = this.partGroups.get('gours');
        const material = this._track(createShellMaterial(this.u, { kind: 'ledge' }));
        this.assets.ledge.forEach((geometry) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.renderOrder = 0;
            group.add(mesh);
        });
    }

    _buildJungle() {
        const group = this.partGroups.get('jungle');
        const { plan, crowns, manifest } = this.assets;
        const [vs0, vs1] = manifest?.crownVerticalScale || [0.92, 0.26];
        const share = Math.max(0.15, Math.min(1, this.preset.crownShare ?? 1));
        const rng = mulberry32(this.seed ^ 0xc0c0);
        const material = this._track(createCrownMaterial(this.u));
        const byVariant = crowns.map(() => []);
        for (let i = 0; i < plan.count; i += 1) {
            const packed = plan.crown[i * 4 + 2];
            const variant = Math.min(crowns.length - 1, Math.max(0, Math.floor(packed)));
            const radius = plan.crown[i * 4];
            const keep = radius > 7 || rng() < share;
            if (keep) byVariant[variant].push(i);
        }
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        const p = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);
        crowns.forEach((geometry, variant) => {
            const ids = byVariant[variant];
            if (!ids.length) return;
            const mesh = new THREE.InstancedMesh(geometry, material, ids.length);
            const data = new Float32Array(ids.length * 4);
            ids.forEach((i, k) => {
                const radius = plan.crown[i * 4];
                const packed = plan.crown[i * 4 + 2];
                const tone = packed - Math.floor(packed);
                const kind = plan.crown[i * 4 + 3];
                const vs = radius * (vs0 + vs1 * tone);
                p.set(plan.position[i * 3], plan.position[i * 3 + 1], plan.position[i * 3 + 2]);
                q.setFromAxisAngle(up, rng() * Math.PI * 2);
                s.set(radius, vs, radius);
                m.compose(p, q, s);
                mesh.setMatrixAt(k, m);
                data[k * 4] = tone;
                data[k * 4 + 1] = radius;
                data[k * 4 + 2] = rng();
                // Class: 1 for an emergent, +2 for a crown in natural flush (about 3 %).
                data[k * 4 + 3] = (kind > 0.5 ? 1 : 0) + (rng() < 0.03 ? 2 : 0);
            });
            geometry.setAttribute('aCrown', new THREE.InstancedBufferAttribute(data, 4));
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.renderOrder = 10;
            group.add(mesh);
        });
    }

    applySnapshot(snap) {
        if (!snap) return;
        const { u } = this;
        const st = snap.station;
        const wt = snap.weather;
        u.time.value = snap.time;
        u.sunDir.value.set(snap.sunDir[0], snap.sunDir[1], snap.sunDir[2]);
        u.fringeAngle.value = snap.fringeAngle;
        u.cloudHoleOpen.value = snap.cloudHoleOpen;
        u.beamWarmth.value = st.beamWarmth;
        u.cloudFloor.value = st.cloudFloor;
        // The bakes of the two stations the sun is between.
        const w = [0, 0, 0, 0, 0];
        w[st.index] += 1 - st.mix;
        w[st.nextIndex] += st.mix;
        u.stationW.value.set(w[0], w[1], w[2], w[3]);
        u.stationW4.value = w[4];
        const foot = footFor(snap.sunDir, CANOPY_LEVEL);
        u.foot.value.set(foot[0], foot[1], foot[2]);

        ['skyZenith', 'skyRim', 'beamCore', 'beamScatter', 'poolSun', 'bounceVault', 'caveShadow', 'mistTint',
            'gourBlue'].forEach((key) => u[key].value.set(...st[key]));
        u.dripScale.value = wt.dripScale;
        u.mistScale.value = wt.mistScale;
        u.cloudOpacity.value = wt.cloudOpacity;
        u.sprayRate.value = wt.sprayRate;

        // The sun's strength: a closing cloud over the oculus at game over, a lift at zenith.
        u.sunGain.value = (1 - snap.overCloudClose * 0.82) * (1 + snap.zenithPulse * 0.35);
        u.skyGain.value = 1 - snap.overCloudClose * 0.5;

        u.flushPulse.value = snap.flushPulse;
        u.flushU.value = snap.flushU ?? 0.5;
        u.flushColor.value.set(...snap.flushColor);
        u.flushWorldPos.value.set(...snap.flushWorldPos);
        u.snapPulse.value = snap.snapPulse;
        u.snapU.value = snap.snapU;
        u.snapColor.value.set(...snap.snapColor);
        u.showerPulse.value = snap.showerPulse;
        u.ripenPulse.value = snap.ripenPulse;
        u.ripenRow.value = snap.ripenRow;
        u.ripenCodesPacked.value = snap.ripenCodesPacked;
        u.cataractPulse.value = snap.cataractPulse;
        u.cataractAge.value = snap.cataractAge ?? 99;
        u.rainbowStrength.value = snap.rainbowStrength;
        u.comboLift.value = snap.comboLift;
        u.comboColumns.value = snap.comboColumns;
        u.sevenfoldPulse.value = snap.sevenfoldPulse;
        u.exhalePulse.value = snap.exhalePulse;
        u.exhaleAge.value = snap.exhaleAge ?? 99;
        u.floodThreads.value = snap.floodThreads;
        u.echoBoost.value = snap.echoBoost;
        u.turningPulse.value = snap.turningPulse;
        u.zenithPulse.value = snap.zenithPulse;
        u.overCloudClose.value = snap.overCloudClose;
        u.wet.value = Math.max(u.wet.value * 0.995, snap.cataractPulse, snap.showerPulse * 0.6);

        if (!this.customCameraOverride) this._driveCamera(snap);
        this.camera.updateMatrixWorld(true);
        this.u.eye.copy(this.camera.position);

        // The one bow: always 41.3° off the direction from the eye to the cataract's spray.
        const spray = this.life?.sprayCentre;
        if (spray) {
            const bowSun = solveBowSun([
                spray.x - this.camera.position.x,
                spray.y - this.camera.position.y,
                spray.z - this.camera.position.z,
            ]);
            u.bowSun.value.set(bowSun[0], bowSun[1], bowSun[2]);
        }
        this.life?.update(snap);
    }

    _driveCamera(snap) {
        const motion = snap.reducedMotion ? 0 : 1;
        const t = snap.time;
        const { rig } = this;
        const drift = [Math.sin(t * 0.157) * 0.6, Math.cos(t * 0.123) * 0.35];
        this.camera.position.set(
            rig.position[0] + (drift[0] + this.pointerX * 1.6) * motion,
            rig.position[1] + (drift[1] + this.pointerY * 0.9) * motion,
            rig.position[2],
        );
        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.set(
            (rig.pitch + Math.sin(t * 0.091) * 0.25 * motion - this.pointerY * 0.6 * motion) * DEG,
            (rig.yaw + Math.sin(t * 0.071) * 0.3 * motion - this.pointerX * 0.8 * motion) * DEG,
            0,
        );
        this.camera.updateMatrixWorld(true);
        // The shared breath every theme carries: it leans toward the doline and back.
        applyCameraBreath(this.camera, t, { distance: 260, scale: motion });
    }

    /** The drawing buffer's height in pixels (sizes that must stay a pixel or two wide). */
    setViewportHeight(pixels) {
        if (pixels > 0) this.u.pixelAngle.value = (2 * Math.tan(((this.camera.fov || 52) * Math.PI) / 360)) / pixels;
    }

    /** The board's rectangle in NDC (the leaves of a lock open at its rows' heights). */
    setBoardViewport(viewport) {
        this.boardViewport = viewport || null;
    }

    setAspect(width, height) {
        if (width > 0 && height > 0) {
            this.aspect = width / height;
            this.camera.aspect = this.aspect;
            this.rig = cameraRigFor(this.aspect);
            if (!this.customCameraOverride) this.restCamera();
            this.camera.updateProjectionMatrix();
        }
    }

    getState() {
        return {
            parts: [...this.visibleParts],
            crowns: this.assets?.plan?.count ?? 0,
            rig: this.rig.name,
        };
    }

    dispose() {
        this.life?.dispose();
        for (const g of this.partGroups.values()) this.scene?.remove(g);
        this.partGroups.clear();
        for (const item of this.disposables) {
            try {
                item.dispose();
            } catch {
                // already released
            }
        }
        this.disposables.length = 0;
        this.textures?.dispose();
        disposeSunfallAssets(this.assets);
        this.assets = null;
    }
}

export const SUNFALL_REST_EYE = SUNFALL_LAYOUT.eye;
