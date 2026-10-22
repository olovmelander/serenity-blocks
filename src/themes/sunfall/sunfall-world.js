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
import { bakeAllSunfallTextures, bakeUnderstoryGrid } from './sunfall-bake.js';
import { disposeSunfallAssets, loadSunfallAssets } from './sunfall-assets.js';
import { cameraRigFor } from './sunfall-composition.js';
import {
    createCrownMaterial,
    createTrunkMaterial,
    createUnderstoryMaterial,
    createShellMaterial,
    createSkyMaterial,
    createSunfallUniforms,
} from './sunfall-tsl.js';
import { buildSunfallLife } from './sunfall-life.js';

const DEG = Math.PI / 180;
/** The sunfall's gold in a fever (linear): a deep late-afternoon gold, never cream. */
const GILT_CORE = new THREE.Vector3(1.0, 0.62, 0.26);
const GILT_SCATTER = new THREE.Vector3(1.0, 0.66, 0.3);
const NO_HEAT = Object.freeze({
    punch: 0, level: 0, fever: 0, stage: 0,
});

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
        /** The post stack's inputs for this frame (see `_post`). */
        this.postState = {
            time: 0, exposure: 1, bloomBoost: 0, flash: 0, flashColour: null,
        };

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
        let list = SUNFALL_PARTS;
        if (Array.isArray(partsFilter)) list = partsFilter;
        else if (partsFilter) list = String(partsFilter).split(',').map((s) => s.trim()).filter(Boolean);
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

    /**
     * The canopy on the doline floor (the authored plan), and the surface forest leaning over
     * the oculus rim outside (seen from beneath against the sky, so its trees have trunks).
     */
    _buildJungle() {
        const group = this.partGroups.get('jungle');
        const { plan, crowns, manifest } = this.assets;
        const [vs0, vs1] = manifest?.crownVerticalScale || [0.92, 0.26];
        const share = Math.max(0.15, Math.min(1, this.preset.crownShare ?? 1));
        const rng = mulberry32(this.seed ^ 0xc0c0);
        const sites = [];
        for (let i = 0; i < plan.count; i += 1) {
            const radius = plan.crown[i * 4];
            if (!(radius > 7 || rng() < share)) continue;
            const packed = plan.crown[i * 4 + 2];
            sites.push({
                x: plan.position[i * 3],
                top: plan.position[i * 3 + 1],
                z: plan.position[i * 3 + 2],
                radius,
                variant: Math.floor(packed),
                tone: packed - Math.floor(packed),
                kind: plan.crown[i * 4 + 3],
                trunk: 0,
            });
        }
        const rim = SUNFALL_LAYOUT.oculus;
        const rimCount = 56;
        for (let i = 0; i < rimCount; i += 1) {
            const a = (i / rimCount) * Math.PI * 2 + (rng() - 0.5) * 0.12;
            const k = 1.12 + rng() * rng() * 0.9;
            const x = rim.center[0] + Math.cos(a) * rim.radii[0] * k;
            const z = rim.center[1] + Math.sin(a) * rim.radii[1] * k;
            const ground = rim.surface + (k - 1) * rim.radii[0] * 0.035 - 2;
            const height = 24 + rng() * 18;
            sites.push({
                x,
                top: ground + height,
                z,
                radius: 6 + rng() * 6,
                variant: Math.floor(rng() * crowns.length),
                tone: rng(),
                kind: 1,
                trunk: height,
            });
        }
        const material = this._track(createCrownMaterial(this.u));
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const sc = new THREE.Vector3();
        const p = new THREE.Vector3();
        const euler = new THREE.Euler();
        // New Growth: which crowns stand near a spot, so a shoot can flush the nearest few.
        this.crownIndex = new Map();
        this.growAttrs = [];
        crowns.forEach((geometry, variant) => {
            const mine = sites.filter((site) => Math.min(crowns.length - 1, Math.max(0, site.variant)) === variant);
            if (!mine.length) return;
            const mesh = new THREE.InstancedMesh(geometry, material, mine.length);
            const data = new Float32Array(mine.length * 4);
            const grow = new Float32Array(mine.length * 4);
            const growAttr = new THREE.InstancedBufferAttribute(grow, 4).setUsage(THREE.DynamicDrawUsage);
            this.growAttrs.push(growAttr);
            const meshIndex = this.growAttrs.length - 1;
            mine.forEach((site, k) => {
                const vs = site.radius * (vs0 + vs1 * site.tone);
                p.set(site.x, site.top, site.z);
                // Crowns are never round: an elliptical footprint and a small lean each.
                q.setFromEuler(euler.set((rng() - 0.5) * 0.14, rng() * Math.PI * 2, (rng() - 0.5) * 0.14, 'YXZ'));
                const stretch = 0.82 + rng() * 0.36;
                sc.set(site.radius * stretch, vs * (0.9 + rng() * 0.2), site.radius / Math.sqrt(stretch));
                m.compose(p, q, sc);
                mesh.setMatrixAt(k, m);
                data[k * 4] = site.tone;
                data[k * 4 + 1] = site.radius;
                data[k * 4 + 2] = rng();
                // Class: 1 for an emergent, +2 for a smaller crown in natural flush (about 3 %).
                data[k * 4 + 3] = (site.kind > 0.5 ? 1 : 0) + (site.radius < 8 && rng() < 0.035 ? 2 : 0);
                grow.set([-1, -100, 18, 0], k * 4);
                const cell = `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
                if (!this.crownIndex.has(cell)) this.crownIndex.set(cell, []);
                this.crownIndex.get(cell).push([meshIndex, k, p.x, p.z]);
            });
            geometry.setAttribute('aCrown', new THREE.InstancedBufferAttribute(data, 4));
            geometry.setAttribute('aGrow', growAttr);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.renderOrder = 10;
            group.add(mesh);
        });
        this._buildUnderstory(group);
        // Trunks for the trees seen against the sky.
        const trunks = sites.filter((site) => site.trunk > 0);
        if (trunks.length) {
            const geo = this._track(new THREE.CylinderGeometry(0.7, 1.0, 1, 7, 1, true));
            geo.translate(0, -0.5, 0);
            const mat = this._track(createTrunkMaterial(this.u));
            const mesh = new THREE.InstancedMesh(geo, mat, trunks.length);
            trunks.forEach((site, k) => {
                const vs = site.radius * (vs0 + vs1 * site.tone);
                p.set(site.x, site.top - vs * 0.5, site.z);
                q.setFromAxisAngle(new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize(), (rng() - 0.5) * 0.25);
                const r = 0.45 + site.radius * 0.05;
                sc.set(r, site.trunk - vs * 0.5, r);
                m.compose(p, q, sc);
                mesh.setMatrixAt(k, m);
            });
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.renderOrder = 11;
            group.add(mesh);
        }
    }

    /** The understory layer under the crowns: deep foliage in every gap of the canopy. */
    _buildUnderstory(group) {
        const floorGrid = this.assets.manifest?.floorGrid;
        if (!floorGrid || !this.textures.canopyHeights) return;
        const grid = bakeUnderstoryGrid(floorGrid, this.textures.canopyHeights);
        const geometry = this._track(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.BufferAttribute(grid.position, 3));
        geometry.setAttribute('aMask', new THREE.BufferAttribute(grid.mask, 1));
        geometry.setIndex(new THREE.BufferAttribute(grid.index, 1));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, this._track(createUnderstoryMaterial(this.u)));
        mesh.name = 'sunfall-understory';
        mesh.renderOrder = 9;
        group.add(mesh);
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
        // A fever (and the crown) gilds the sunfall: the column and its light burn gold.
        const gild = snap.gild ?? 0;
        if (gild > 0) {
            u.beamCore.value.lerp(GILT_CORE, gild);
            u.beamScatter.value.lerp(GILT_SCATTER, gild);
        }
        u.prism.value = snap.prism ?? 0;
        u.fingerFloor.value = snap.fingerFloor ?? 0.14;
        u.dripScale.value = wt.dripScale;
        u.mistScale.value = wt.mistScale;
        u.cloudOpacity.value = wt.cloudOpacity;
        u.sprayRate.value = wt.sprayRate;

        // The sun's strength: a closing cloud over the oculus at game over, a small lift at zenith
        // (the crown's light is the pool's colours and the bow, not a whiter column).
        const zenith = snap.zenithPulse;
        u.sunGain.value = (1 - snap.overCloudClose * 0.82) * (1 + zenith * 0.06);
        u.skyGain.value = 1 - snap.overCloudClose * 0.5;

        u.flushPulse.value = snap.flushPulse;
        u.flushU.value = snap.flushU ?? 0.5;
        u.flushColor.value.set(...snap.flushColor);
        u.flushWorldPos.value.set(...snap.flushWorldPos);
        u.snapPulse.value = snap.snapPulse;
        u.snapU.value = snap.snapU;
        u.snapColor.value.set(...snap.snapColor);
        u.kick.value.set(snap.kickL ?? 0, snap.kickR ?? 0);
        u.windClock.value = snap.windClock ?? snap.time;
        u.windGain.value = snap.windGain ?? 1;
        u.swiftClock.value = snap.swiftClock ?? snap.time;
        u.moteGain.value = snap.moteGain ?? 1 + snap.comboLift;
        u.showerPulse.value = snap.showerPulse;
        u.ripenPulse.value = snap.ripenPulse;
        u.ripenRow.value = snap.ripenRow;
        u.ripenCodesPacked.value = snap.ripenCodesPacked;
        u.cataractPulse.value = snap.cataractPulse;
        u.cataractAge.value = snap.cataractAge ?? 99;
        u.cataractHold.value = snap.cataractHold ?? 0;
        u.rainbowStrength.value = snap.rainbowStrength;
        u.comboLift.value = snap.comboLift;
        u.comboColumns.value = snap.comboShafts ?? snap.comboColumns;
        u.sevenfoldPulse.value = snap.sevenfoldPulse;
        u.exhalePulse.value = snap.exhalePulse;
        u.exhaleAge.value = snap.exhaleAge ?? 99;
        u.floodThreads.value = snap.floodThreads;
        u.echoBoost.value = snap.echoBoost;
        u.turningPulse.value = snap.turningPulse;
        // The crowns round the pool flush in every piece's pigment: the crown's zenith, and a
        // fever's new growth (it greens back slowly when the hands rest).
        u.zenithPulse.value = Math.min(1.2, zenith + (snap.poolFlush ?? 0));
        u.overCloudClose.value = snap.overCloudClose;
        u.wet.value = snap.wet ?? Math.max(snap.cataractPulse, snap.showerPulse * 0.6);
        this._post(snap);

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
        this._growShoots(snap);
    }

    /** Flush the crowns nearest each new shoot in its piece's colour (New Growth). */
    _growShoots(snap) {
        if (!this.growAttrs?.length) return;
        if (snap.sessionSerial !== this.growSession) {
            this.growSession = snap.sessionSerial;
            this.grownShoots = new Set();
            this.growAttrs.forEach((attr) => {
                for (let i = 0; i < attr.count; i += 1) attr.array[i * 4] = -1;
                attr.needsUpdate = true;
            });
        }
        for (const shoot of snap.newGrowthShoots || []) {
            const key = `${shoot.slot}:${shoot.birthTime}`;
            if (this.grownShoots.has(key)) continue;
            this.grownShoots.add(key);
            const [x, , z] = shoot.worldPos;
            const near = [];
            const cx = Math.floor(x / 16);
            const cz = Math.floor(z / 16);
            for (let dx = -1; dx <= 1; dx += 1) {
                for (let dz = -1; dz <= 1; dz += 1) {
                    for (const entry of this.crownIndex.get(`${cx + dx},${cz + dz}`) || []) {
                        near.push([Math.hypot(entry[2] - x, entry[3] - z), entry]);
                    }
                }
            }
            near.sort((a, b) => a[0] - b[0]);
            near.slice(0, 4).forEach(([, [meshIndex, k]], j) => {
                const attr = this.growAttrs[meshIndex];
                attr.array.set([shoot.codeIndex, shoot.birthTime + j * 0.12, shoot.tau, 1], k * 4);
                attr.needsUpdate = true;
            });
        }
    }

    /**
     * What the post stack wears this frame (the theme hands it to `SunfallPost.update`). The
     * light of a payoff lives in the world's own colours (the bow, the pool, the threads), so
     * the bloom and the exposure flash stay small, and the iris closes a little as play heats
     * and adds light to the column, keeping the colours saturated and the cave dark.
     */
    _post(snap) {
        const heat = snap.heat || NO_HEAT;
        const cataract = Math.min(1, snap.cataractPulse);
        const zenith = snap.zenithPulse;
        const post = this.postState;
        post.time = snap.time;
        post.exposure = 1 - heat.level * 0.04 - heat.fever * 0.06 - zenith * 0.1;
        post.bloomBoost = cataract * 0.22 + zenith * 0.12 + heat.fever * 0.06;
        post.flash = cataract * 0.12 + zenith * 0.1;
        post.flashColour = snap.station.beamCore;
    }

    _driveCamera(snap) {
        const motion = snap.reducedMotion ? 0 : 1;
        const t = snap.time;
        const { rig } = this;
        const heat = snap.heat || NO_HEAT;
        const drift = [Math.sin(t * 0.157) * 0.6, Math.cos(t * 0.123) * 0.35];
        this.camera.position.set(
            rig.position[0] + (drift[0] + this.pointerX * 1.6) * motion,
            rig.position[1] + (drift[1] + this.pointerY * 0.9) * motion,
            rig.position[2],
        );
        this.camera.rotation.order = 'YXZ';
        // Each event nods the eye toward the pool (riding on a floor under rapid play).
        this.camera.rotation.set(
            (rig.pitch + Math.sin(t * 0.091) * 0.25 * motion - this.pointerY * 0.6 * motion
                - heat.punch * 0.35 * motion) * DEG,
            (rig.yaw + Math.sin(t * 0.071) * 0.3 * motion - this.pointerX * 0.8 * motion) * DEG,
            0,
        );
        // The eye leans into the doline as play heats.
        this.camera.translateZ(-(heat.level * 2 + heat.fever * 3) * motion);
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
