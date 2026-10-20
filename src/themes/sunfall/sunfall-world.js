/**
 * Sunfall Theme — 3D World Builder & Frame Updater
 *
 * Constructs the 9 named parts of the Hang Sơn Đoòng doline chamber:
 * - `sky`: continuous exterior sky domes behind the primary oculus & far doline
 * - `cave`: seamless 360° sculpted karst limestone vault, walls & terraced floor
 *   with shader-feathered oculus and second-doline openings (zero seam or polygon edges)
 * - `jungle`: terraced breakdown cone + dense multi-layered banana/tree-fern/taro
 *   foliage with live delayed-greening `aShootMeta` attribute updates
 * - `beam`: concentric volumetric Sunfall Pillar cylinder tilting with `sunDir`
 * - `mist`: inversion-layer cave-cloud deck (`y = 26 m`), Exhale ring (`y = 22 m`),
 *   and the Cataract spray sheet (`createCataractSprayMaterial` with `dlBowNode`)
 * - `water`: oculus waterfall threads (B2B Flood Threads + Rim Shower) and
 *   sunlit spore motes / golden drip beads
 * - `roots`: slender catenary aerial root & liana curtains around the oculus rim
 * - `birds`: cave swifts (`Aerodramus`) orbiting the upper sunlit shaft
 * - `gours`: multi-tiered scalloped foreground travertine rimstone terraces with
 *   iridescent blue Peacock Spikemoss (`Selaginella willdenowii`)
 */

import * as THREE from 'three/webgpu';
import {
    SUNFALL_CLEAR,
    SUNFALL_PARTS,
    SUNFALL_SEED,
    clamp01,
    greeningTau,
    lerp,
    mulberry32,
    planDoline,
    solveBowSun,
} from './sunfall-core.js';
import { SUNFALL_COMPOSITION } from './sunfall-composition.js';
import { resolveSunfallQuality } from './sunfall-quality.js';
import { bakeAllSunfallTextures } from './sunfall-bake.js';
import {
    createCataractSprayMaterial,
    createCaveCloudMaterial,
    createCaveVaultMaterial,
    createGourTerraceMaterial,
    createJungleFoliageMaterial,
    createJungleMoundMaterial,
    createMotesMaterial,
    createRootCurtainMaterial,
    createSkyOculusMaterial,
    createSunbeamMaterial,
    createSunfallUniforms,
    createSwiftBirdsMaterial,
    createWaterfallThreadMaterial,
} from './sunfall-tsl.js';

export class SunfallWorld {
    constructor({
        scene = null,
        camera = null,
        quality = 'High',
        seed = SUNFALL_SEED,
        parts = null,
    } = {}) {
        this.preset = resolveSunfallQuality(quality);
        this.seed = seed >>> 0;
        this.plan = planDoline(this.seed, this.preset);

        this.scene = scene || new THREE.Scene();
        this.scene.background = new THREE.Color(SUNFALL_CLEAR);

        const camCfg = SUNFALL_COMPOSITION.camera;
        if (camera) {
            this.camera = camera;
            this.camera.fov = camCfg.fov;
            this.camera.near = 0.5;
            this.camera.far = 900;
            this.camera.updateProjectionMatrix();
        } else {
            this.camera = new THREE.PerspectiveCamera(camCfg.fov, camCfg.aspect, 0.5, 900);
        }
        this.baseCamPos = new THREE.Vector3(...camCfg.pos);
        this.baseLookAt = new THREE.Vector3(...camCfg.lookAt);
        this.camera.position.copy(this.baseCamPos);
        this.camera.lookAt(this.baseLookAt);

        this.pointerX = 0;
        this.pointerY = 0;
        this.customCameraOverride = false;

        this.textures = bakeAllSunfallTextures(this.seed);
        this.u = createSunfallUniforms();

        this.partGroups = new Map();
        for (const partName of SUNFALL_PARTS) {
            const g = new THREE.Group();
            g.name = `sunfall-${partName}`;
            this.scene.add(g);
            this.partGroups.set(partName, g);
        }

        this.disposables = [];
        this.beamPivot = null;
        this.shootMetaAttr = null;
        this.shootClusterSize = 1;
        this.cataractSheetCenter = new THREE.Vector3(18, -2, -86);

        this._buildSky();
        this._buildCave();
        this._buildJungle();
        this._buildBeam();
        this._buildMist();
        this._buildWater();
        this._buildRoots();
        this._buildBirds();
        this._buildGours();

        if (parts) {
            this.setParts(parts);
        }
    }

    _track(resource) {
        if (resource && typeof resource.dispose === 'function') {
            this.disposables.push(resource);
        }
        return resource;
    }

    setParts(partsFilter = null) {
        if (!partsFilter) {
            for (const g of this.partGroups.values()) {
                g.visible = true;
            }
            return;
        }
        const list = Array.isArray(partsFilter)
            ? partsFilter
            : String(partsFilter)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        const allow = new Set(list);
        for (const [name, g] of this.partGroups.entries()) {
            g.visible = allow.has(name);
        }
    }

    setPointer(px = 0, py = 0) {
        this.pointerX = Number.isFinite(px) ? Math.max(-1, Math.min(1, px)) : 0;
        this.pointerY = Number.isFinite(py) ? Math.max(-1, Math.min(1, py)) : 0;
    }

    /**
     * 1. `sky`: Exterior sky backdrops completely covering the primary oculus & far doline openings
     */
    _buildSky() {
        const group = this.partGroups.get('sky');
        const mat = this._track(createSkyOculusMaterial(this.u, this.textures));

        // Large exterior sky canopy above the primary oculus mouth (24, 62, -108)
        const skyGeo = this._track(new THREE.PlaneGeometry(140, 110, 1, 1));
        const skyMesh = new THREE.Mesh(skyGeo, mat);
        skyMesh.position.set(24, 66, -110);
        skyMesh.lookAt(0, -10, 22);
        group.add(skyMesh);

        // Full exterior sky backdrop behind the distant second doline (-32, 18, -285)
        if (this.preset.farDoline) {
            const farGeo = this._track(new THREE.PlaneGeometry(160, 130, 1, 1));
            const farMesh = new THREE.Mesh(farGeo, mat);
            farMesh.position.set(-32, 22, -295);
            farMesh.lookAt(0, 6, 22);
            group.add(farMesh);
        }
    }

    /**
     * 2. `cave`: Seamless 360° Hang Sơn Đoòng limestone cavern tube with periodic
     * angular displacement (zero floor seam!) and shader-feathered oculus/far-doline openings.
     */
    _buildCave() {
        const group = this.partGroups.get('cave');
        const mat = this._track(createCaveVaultMaterial(this.u, this.textures));

        const segU = Math.max(48, Math.min(96, Math.round(Math.sqrt(this.preset.caveTris || 16000) * 0.65)));
        const segV = Math.max(36, Math.min(72, Math.round(segU * 0.78)));
        const positions = [];
        const uvs = [];
        const indices = [];

        for (let iv = 0; iv <= segV; iv += 1) {
            const v = iv / segV; // 0 = behind camera (z=+28), 1 = far doline end-wall (z=-278)
            const z = lerp(28, -278, v);
            const centerX = lerp(4, -32, v ** 1.38);
            const floorY = lerp(-24, -10, v * 0.65);
            const crownY = lerp(64, 48, v * 0.50);
            const halfWidth = lerp(64, 48, v * 0.45);

            // At the very far end (`v > 0.85`), pinch the tube slightly toward the second doline window
            const endPinch = v > 0.85 ? 1.0 - ((v - 0.85) / 0.15) ** 1.6 * 0.45 : 1.0;

            for (let iu = 0; iu <= segU; iu += 1) {
                const u = iu / segU;
                const theta = u * Math.PI * 2 - Math.PI * 0.5; // -pi/2 = bottom floor, +pi/2 = vault crown
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);

                const ySpan = (sinT >= 0 ? (crownY - floorY) * 0.68 : (crownY - floorY) * 0.32) * endPinch;
                const midY = floorY + (crownY - floorY) * 0.32;

                let x = centerX + cosT * halfWidth * endPinch;
                let y = midY + sinT * ySpan;

                // Strictly periodic in `theta` (integer multiples of theta) so iu=0 and iu=segU match identically!
                const n1 = Math.sin(v * 18.0 + Math.sin(theta * 3.0) * 2.2)
                    * Math.cos(v * 9.0 - Math.cos(theta * 2.0) * 1.8);
                const n2 = Math.sin(v * 31.0 + theta * 5.0) * 0.5 + Math.cos(v * 14.0 - theta * 4.0) * 0.5;
                const ribButtress = Math.abs(cosT) ** 1.4 * (
                    Math.sin(v * Math.PI * 5.0 + cosT * 1.2) * 6.5
                    + Math.cos(v * Math.PI * 9.0 - sinT * 2.0) * 3.2
                );
                const relief = (n1 * 3.8 + n2 * 2.2) * (0.35 + 0.65 * Math.abs(cosT)) + ribButtress;

                x -= cosT * relief;
                y -= sinT * (relief * 0.42);

                positions.push(x, y, z);
                uvs.push(u * 4, v * 6);
            }
        }

        const stride = segU + 1;
        for (let iv = 0; iv < segV; iv += 1) {
            for (let iu = 0; iu < segU; iu += 1) {
                const i0 = iv * stride + iu;
                const i1 = i0 + 1;
                const i2 = i0 + stride;
                const i3 = i2 + 1;
                indices.push(i0, i1, i2, i1, i3, i2);
            }
        }

        const vaultGeo = this._track(new THREE.BufferGeometry());
        vaultGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        vaultGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        vaultGeo.setIndex(indices);
        vaultGeo.computeVertexNormals();

        const vaultMesh = new THREE.Mesh(vaultGeo, mat);
        group.add(vaultMesh);
    }

    /**
     * 3. `jungle`: Sculpted rocky breakdown cone mound at `(18, -22, -94)` + dense
     * multi-species banana/tree-fern/taro canopy concealing the mound silhouette.
     */
    _buildJungle() {
        const group = this.partGroups.get('jungle');
        const rng = mulberry32(this.seed ^ 0x2222);

        const coneX = 15.5;
        const coneY = -22;
        const coneZ = -93;

        // Rugged rocky breakdown cone mound with terraced karst boulder steps & wide talus skirt
        const moundMat = this._track(createJungleMoundMaterial(this.u, this.textures));
        const moundGeo = this._track(new THREE.ConeGeometry(38, 23, 56, 18, false));
        const posAttr = moundGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i += 1) {
            const vx = posAttr.getX(i);
            const vy = posAttr.getY(i);
            const vz = posAttr.getZ(i);
            const r = Math.hypot(vx, vz);
            const angle = Math.atan2(vz, vx);
            const boulderStep = Math.sin(r * 0.55 + Math.sin(angle * 4.0) * 1.4) * 1.65
                + Math.cos(r * 0.9 - angle * 6.0) * 0.85;
            const cragR = 1.0 + 0.12 * Math.sin(angle * 5.0 + vy * 0.35) + 0.07 * Math.cos(angle * 9.0 - vy * 0.5);
            const crown = vy > 3 ? (vy - 3) * 0.38 + 3 : vy;
            posAttr.setXYZ(i, vx * cragR, crown + boulderStep, vz * cragR);
        }
        moundGeo.computeVertexNormals();
        const moundMesh = new THREE.Mesh(moundGeo, moundMat);
        moundMesh.position.set(coneX, coneY + 3.0, coneZ);
        group.add(moundMesh);

        // Instanced tropical canopy fronds arranged in dense overlapping rosettes across the entire mound
        const leafCount = Math.max(64, this.preset.leafInstances || 3200);
        const leafMat = this._track(createJungleFoliageMaterial(this.u, this.textures));

        const bladeGeo = this._track(new THREE.PlaneGeometry(2.5, 5.6, 3, 6));
        bladeGeo.translate(0, 2.8, 0);
        const bPos = bladeGeo.attributes.position;
        for (let i = 0; i < bPos.count; i += 1) {
            const bx = bPos.getX(i);
            const by = bPos.getY(i);
            const t = by / 5.6;
            const droopZ = t * t * 2.4;
            const droopY = -t * t * t * 0.95;
            const vFold = Math.abs(bx) * 0.24;
            bPos.setY(i, by + droopY);
            bPos.setZ(i, droopZ + vFold);
        }
        bladeGeo.computeVertexNormals();

        const instMesh = new THREE.InstancedMesh(bladeGeo, leafMat, leafCount);
        instMesh.frustumCulled = false;

        const shootMetaArray = new Float32Array(leafCount * 4);
        const dummy = new THREE.Object3D();

        const slotCount = Math.max(8, this.preset.newGrowthSlots || 36);
        this.shootClusterSize = Math.max(4, Math.floor((leafCount * 0.30) / slotCount));

        // 72 rosettes blanketing the apex, mid-slopes, and lower skirt of the breakdown cone
        const rosetteCount = 72;
        const rosettes = [];
        for (let r = 0; r < rosetteCount; r += 1) {
            const frac = r / rosetteCount;
            const rad = frac ** 0.56 * 31.0;
            const ang = r * 2.39996 + (rng() - 0.5) * 0.25;
            const rx = coneX + Math.cos(ang) * rad;
            const rz = coneZ + Math.sin(ang) * rad * 0.85;
            const rh = Math.max(0, 1 - rad / 34.0) * 15.5;
            const ry = coneY - 3.6 + rh + (r < 16 ? 2.4 : 0);
            rosettes.push({
                x: rx, y: ry, z: rz, scale: 0.84 + rng() * 0.74,
            });
        }

        for (let i = 0; i < leafCount; i += 1) {
            const ros = rosettes[i % rosetteCount];
            const frondAzimuth = ((i / rosetteCount) * 2.39996) + (rng() - 0.5) * 0.35;
            const jitterR = rng() * 1.8;
            const lx = ros.x + Math.cos(frondAzimuth) * jitterR;
            const lz = ros.z + Math.sin(frondAzimuth) * jitterR;
            const ly = ros.y + (rng() - 0.5) * 1.2;

            dummy.position.set(lx, ly, lz);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.set(
                0.40 + rng() * 0.76,
                frondAzimuth,
                (rng() - 0.5) * 0.28,
            );
            const s = ros.scale * (0.74 + rng() * 0.82);
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            instMesh.setMatrixAt(i, dummy.matrix);

            const codeIdx = i % 7;
            const isYoung = i < slotCount * this.shootClusterSize && (i % 4 === 0);
            const birthTime = isYoung ? -rng() * 15.0 : -180.0;
            const tau = greeningTau(rng());
            const rowNorm = clamp01((lz - (coneZ - 26)) / 52);

            shootMetaArray[i * 4] = codeIdx;
            shootMetaArray[i * 4 + 1] = birthTime;
            shootMetaArray[i * 4 + 2] = tau;
            shootMetaArray[i * 4 + 3] = rowNorm;
        }

        instMesh.instanceMatrix.needsUpdate = true;
        this.shootMetaAttr = new THREE.InstancedBufferAttribute(shootMetaArray, 4);
        bladeGeo.setAttribute('aShootMeta', this.shootMetaAttr);
        group.add(instMesh);
    }

    /**
     * 4. `beam`: The Volumetric Sunfall Pillar anchored directly at the oculus `(24, 56, -108)`
     * and pouring downward along `-sunDir` onto the jungle cone `(15.5, -21, -93)`,
     * plus the distant second doline shaft.
     */
    _buildBeam() {
        const group = this.partGroups.get('beam');
        const mat = this._track(createSunbeamMaterial(this.u, this.textures, this.preset));

        this.beamPivot = new THREE.Group();
        this.beamPivot.position.set(24, 56, -108);
        group.add(this.beamPivot);

        const shaftHeight = 82;
        const shells = [
            {
                rTop: 21.0, rBot: 26.5, segs: 36, order: 2,
            },
            {
                rTop: 15.0, rBot: 19.5, segs: 32, order: 3,
            },
            {
                rTop: 9.5, rBot: 13.0, segs: 24, order: 3,
            },
        ];
        for (const sh of shells) {
            const cylGeo = this._track(new THREE.CylinderGeometry(sh.rTop, sh.rBot, shaftHeight, sh.segs, 1, true));
            cylGeo.translate(0, -shaftHeight * 0.5, 0);
            const cylMesh = new THREE.Mesh(cylGeo, mat);
            cylMesh.renderOrder = sh.order;
            this.beamPivot.add(cylMesh);
        }

        if (this.preset.farDoline) {
            const farShaftGeo = this._track(new THREE.CylinderGeometry(11, 16, 56, 20, 1, true));
            const farShaftMesh = new THREE.Mesh(farShaftGeo, mat);
            farShaftMesh.position.set(-32, 2, -268);
            farShaftMesh.rotation.z = -0.14;
            farShaftMesh.renderOrder = 2;
            group.add(farShaftMesh);
        }
    }

    /**
     * 5. `mist`: Billowing cave-cloud strata around `y = 26 m` (strictly inside chamber walls),
     * Exhale ring at `y = 22 m`, and the Cataract spray sheet where `dlBowNode` paints the 4-line double rainbow.
     */
    _buildMist() {
        const group = this.partGroups.get('mist');

        if (this.preset.cloudSheet) {
            const cloudMat = this._track(createCaveCloudMaterial(this.u, this.textures, { isExhaleRing: false }));
            const strataHeights = [25.0, 27.5];
            for (let s = 0; s < strataHeights.length; s += 1) {
                const cloudGeo = this._track(new THREE.PlaneGeometry(96, 86, 20, 20));
                cloudGeo.rotateX(-Math.PI * 0.5);
                const cPos = cloudGeo.attributes.position;
                for (let i = 0; i < cPos.count; i += 1) {
                    const cx = cPos.getX(i);
                    const cz = cPos.getZ(i);
                    const undulate = Math.sin(cx * 0.09 + s * 1.5) * 1.8 + Math.cos(cz * 0.11 - s) * 1.5;
                    cPos.setY(i, cPos.getY(i) + undulate);
                }
                cloudGeo.computeVertexNormals();
                const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
                cloudMesh.position.set(14, strataHeights[s], -102);
                cloudMesh.renderOrder = 4;
                group.add(cloudMesh);
            }

            const exhaleMat = this._track(createCaveCloudMaterial(this.u, this.textures, { isExhaleRing: true }));
            const exhaleGeo = this._track(new THREE.RingGeometry(11, 38, 32, 2));
            exhaleGeo.rotateX(-Math.PI * 0.5);
            const exhaleMesh = new THREE.Mesh(exhaleGeo, exhaleMat);
            exhaleMesh.position.set(16, 22, -98);
            exhaleMesh.renderOrder = 5;
            group.add(exhaleMesh);
        }

        const sprayMat = this._track(createCataractSprayMaterial(this.u, this.textures));
        const sprayGeo = this._track(new THREE.PlaneGeometry(52, 36, 16, 12));
        const sprayMesh = new THREE.Mesh(sprayGeo, sprayMat);
        sprayMesh.position.copy(this.cataractSheetCenter);
        sprayMesh.lookAt(this.baseCamPos);
        sprayMesh.renderOrder = 6;
        group.add(sprayMesh);
    }

    /**
     * 6. `water`: Oculus waterfall threads (B2B Flood Threads + Rim Shower)
     * and sunlit spore motes / falling golden drip beads.
     */
    _buildWater() {
        const group = this.partGroups.get('water');
        const rng = mulberry32(this.seed ^ 0x3333);

        const dripCount = Math.max(0, this.preset.dripStreams || 0);
        if (dripCount > 0) {
            const threadMat = this._track(createWaterfallThreadMaterial(this.u, this.textures));
            const ribbonCount = Math.min(16, Math.max(6, Math.floor(dripCount * 0.35)));
            const ribbonGeo = this._track(new THREE.PlaneGeometry(1.1, 74, 1, 8));
            const instRibbon = new THREE.InstancedMesh(ribbonGeo, threadMat, ribbonCount);
            instRibbon.frustumCulled = false;
            instRibbon.renderOrder = 5;

            const threadIdxArray = new Float32Array(ribbonCount);
            const dummy = new THREE.Object3D();

            for (let i = 0; i < ribbonCount; i += 1) {
                const drip = this.plan.drips[i % this.plan.drips.length];
                dummy.position.set(drip.x - 4, 20, drip.z + 12);
                dummy.rotation.y = (rng() - 0.5) * 0.6;
                dummy.scale.set(i < 3 ? 1.45 : 0.85, 1.0, 1.0);
                dummy.updateMatrix();
                instRibbon.setMatrixAt(i, dummy.matrix);
                threadIdxArray[i] = i < 3 ? i : 3;
            }
            instRibbon.instanceMatrix.needsUpdate = true;
            ribbonGeo.setAttribute('aThreadIdx', new THREE.InstancedBufferAttribute(threadIdxArray, 1));
            group.add(instRibbon);
        }

        const moteCount = Math.max(32, this.preset.moteCount || 700);
        const moteMat = this._track(createMotesMaterial(this.u, this.textures));
        const moteGeo = this._track(new THREE.PlaneGeometry(0.42, 0.42, 1, 1));
        const moteInst = new THREE.InstancedMesh(moteGeo, moteMat, moteCount);
        moteInst.frustumCulled = false;
        moteInst.renderOrder = 7;

        const moteSeeds = new Float32Array(moteCount * 4);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < moteCount; i += 1) {
            dummy.position.set(0, 0, 0);
            const s = 0.42 + rng() * 0.82;
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            moteInst.setMatrixAt(i, dummy.matrix);

            moteSeeds[i * 4] = rng();
            moteSeeds[i * 4 + 1] = rng();
            moteSeeds[i * 4 + 2] = 0.4 + rng() * 0.9;
            moteSeeds[i * 4 + 3] = i % 7;
        }
        moteInst.instanceMatrix.needsUpdate = true;
        moteGeo.setAttribute('aMoteSeed', new THREE.InstancedBufferAttribute(moteSeeds, 4));
        group.add(moteInst);
    }

    /**
     * 7. `roots`: Sinuous aerial root & liana curtains draped around the 360° oculus rim
     */
    _buildRoots() {
        const group = this.partGroups.get('roots');
        const tendrilCount = Math.max(0, this.preset.rootTendrils || 0);
        if (tendrilCount <= 0 || this.plan.curtains.length === 0) return;

        const rng = mulberry32(this.seed ^ 0x4444);
        const rootMat = this._track(createRootCurtainMaterial(this.u, this.textures));

        const strandGeo = this._track(new THREE.CylinderGeometry(0.065, 0.018, 1.0, 5, 10, false));
        strandGeo.translate(0, -0.5, 0);
        const sPos = strandGeo.attributes.position;
        for (let i = 0; i < sPos.count; i += 1) {
            const sy = sPos.getY(i);
            const wave = Math.sin(sy * Math.PI * 2.5) * 0.22;
            sPos.setX(i, sPos.getX(i) + wave);
        }
        strandGeo.computeVertexNormals();

        const instRoots = new THREE.InstancedMesh(strandGeo, rootMat, tendrilCount);
        instRoots.frustumCulled = false;
        instRoots.renderOrder = 4;

        const rootMeta = new Float32Array(tendrilCount * 4);
        const dummy = new THREE.Object3D();

        for (let i = 0; i < tendrilCount; i += 1) {
            const c = this.plan.curtains[i % this.plan.curtains.length];
            // Distribute roots along the outer limestone lip of the oculus (rimR >= 1.0)
            const angle = (i / tendrilCount) * Math.PI * 2.0 + (rng() - 0.5) * 0.16;
            const rimR = 1.00 + rng() * 0.18;
            const rx = 24 + Math.cos(angle) * 24.0 * rimR;
            const rz = -108 + Math.sin(angle) * 18.2 * rimR;
            const vaultSlopeY = 50.5 - (rx - 24.0) * 0.26 + (rz + 108.0) * 0.12;
            const topY = vaultSlopeY + 2.2 - rng() * 1.8;
            const isFrontLip = Math.sin(angle) > 0.15;
            const len = isFrontLip ? (3.5 + rng() * 4.8) : (7.5 + rng() * 11.5);

            dummy.position.set(rx, topY, rz);
            dummy.rotation.set((rng() - 0.5) * 0.18, rng() * Math.PI * 2, (rng() - 0.5) * 0.18);
            dummy.scale.set(0.75 + rng() * 0.55, len, 0.75 + rng() * 0.55);
            dummy.updateMatrix();
            instRoots.setMatrixAt(i, dummy.matrix);

            const uNorm = clamp01((rx + 10) / 68);
            rootMeta[i * 4] = uNorm;
            rootMeta[i * 4 + 1] = c.codeIndex;
            rootMeta[i * 4 + 2] = c.tau;
            rootMeta[i * 4 + 3] = c.swayPhase + rng() * 2.0;
        }
        instRoots.instanceMatrix.needsUpdate = true;
        strandGeo.setAttribute('aRootMeta', new THREE.InstancedBufferAttribute(rootMeta, 4));
        group.add(instRoots);
    }

    /**
     * 8. `birds`: Cave swifts (`Aerodramus`) orbiting the upper sunlit shaft
     */
    _buildBirds() {
        const group = this.partGroups.get('birds');
        const count = this.plan.swifts.length;
        if (count <= 0) return;

        const mat = this._track(createSwiftBirdsMaterial(this.u, this.textures));

        const geo = this._track(new THREE.BufferGeometry());
        const verts = new Float32Array([
            0.0, 0.0, 0.38,
            -1.15, 0.10, -0.12,
            0.0, 0.0, -0.28,
            0.0, 0.0, 0.38,
            0.0, 0.0, -0.28,
            1.15, 0.10, -0.12,
        ]);
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.computeVertexNormals();

        const inst = new THREE.InstancedMesh(geo, mat, count);
        inst.frustumCulled = false;

        const meta = new Float32Array(count * 4);
        const identityMatrix = new THREE.Matrix4();

        for (let i = 0; i < count; i += 1) {
            const s = this.plan.swifts[i];
            inst.setMatrixAt(i, identityMatrix);
            meta[i * 4] = s.orbitR;
            meta[i * 4 + 1] = 22 + (s.orbitY - 32) * 0.65;
            meta[i * 4 + 2] = s.speed;
            meta[i * 4 + 3] = s.phase;
        }
        inst.instanceMatrix.needsUpdate = true;
        geo.setAttribute('aSwiftMeta', new THREE.InstancedBufferAttribute(meta, 4));
        group.add(inst);
    }

    /**
     * 9. `gours`: High-resolution scalloped foreground travertine rimstone terraces
     * with Peacock Spikemoss (`Selaginella willdenowii`)
     */
    _buildGours() {
        const group = this.partGroups.get('gours');
        if (this.plan.gours.length === 0) return;

        const mat = this._track(createGourTerraceMaterial(this.u, this.textures));

        // High-subdivision scalloped rimstone dam geometry (smooth organic curves)
        const rimGeo = this._track(new THREE.CylinderGeometry(1.0, 1.38, 2.4, 56, 12, false));
        const rPos = rimGeo.attributes.position;
        for (let i = 0; i < rPos.count; i += 1) {
            const vx = rPos.getX(i);
            const vy = rPos.getY(i);
            const vz = rPos.getZ(i);
            const rad = Math.hypot(vx, vz);
            const ang = Math.atan2(vz, vx);
            const scallop = 1.0 + 0.12 * Math.sin(ang * 5.0) + 0.06 * Math.cos(ang * 8.0);
            const terraceStep = Math.sin(vy * 4.5) * 0.08;
            const dish = (vy > 0.4 && rad < 0.84) ? -0.55 * (0.88 - rad) : 0.16 * Math.sin(ang * 4.0);
            rPos.setXYZ(i, vx * (scallop + terraceStep), vy + dish, vz * (scallop + terraceStep));
        }
        rimGeo.computeVertexNormals();

        for (const g of this.plan.gours) {
            const mesh = new THREE.Mesh(rimGeo, mat);
            mesh.position.set(g.x, g.y - 2.4, g.z - 4.0);
            mesh.scale.set(g.rx * 1.15, 1.15, g.rz * 1.15);
            mesh.rotation.y = g.yaw;
            group.add(mesh);
        }
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

        u.skyZenith.value.set(...st.skyZenith);
        u.skyRim.value.set(...st.skyRim);
        u.beamCore.value.set(...st.beamCore);
        u.beamScatter.value.set(...st.beamScatter);
        u.poolSun.value.set(...st.poolSun);
        u.bounceVault.value.set(...st.bounceVault);
        u.caveShadow.value.set(...st.caveShadow);
        u.mistTint.value.set(...st.mistTint);
        u.gourBlue.value.set(...st.gourBlue);

        u.dripScale.value = wt.dripScale;
        u.mistScale.value = wt.mistScale;
        u.cloudOpacity.value = wt.cloudOpacity;
        u.sprayRate.value = wt.sprayRate;

        u.flushPulse.value = snap.flushPulse;
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
        u.rainbowStrength.value = snap.rainbowStrength;

        u.comboLift.value = snap.comboLift;
        u.comboColumns.value = snap.comboColumns;
        u.sevenfoldPulse.value = snap.sevenfoldPulse;
        u.exhalePulse.value = snap.exhalePulse;

        u.floodThreads.value = snap.floodThreads;
        u.echoBoost.value = snap.echoBoost;
        u.turningPulse.value = snap.turningPulse;
        u.zenithPulse.value = snap.zenithPulse;
        u.overCloudClose.value = snap.overCloudClose;

        if (this.beamPivot) {
            const upVec = new THREE.Vector3(0, 1, 0);
            const targetDir = new THREE.Vector3(snap.sunDir[0], snap.sunDir[1], snap.sunDir[2]).normalize();
            this.beamPivot.quaternion.setFromUnitVectors(upVec, targetDir);
        }

        const camToSheet = [
            this.cataractSheetCenter.x - this.camera.position.x,
            this.cataractSheetCenter.y - this.camera.position.y,
            this.cataractSheetCenter.z - this.camera.position.z,
        ];
        const bowSun = solveBowSun(camToSheet);
        u.bowSun.value.set(bowSun[0], bowSun[1], bowSun[2]);

        if (this.shootMetaAttr && Array.isArray(snap.newGrowthShoots)) {
            const arr = this.shootMetaAttr.array;
            const cluster = this.shootClusterSize;
            const maxIdx = arr.length / 4;
            for (const shoot of snap.newGrowthShoots) {
                const base = (shoot.slot * cluster) % maxIdx;
                for (let k = 0; k < cluster; k += 1) {
                    const idx = (base + k) % maxIdx;
                    arr[idx * 4] = shoot.codeIndex;
                    arr[idx * 4 + 1] = shoot.birthTime;
                    arr[idx * 4 + 2] = shoot.tau;
                    arr[idx * 4 + 3] = clamp01(shoot.row / 19);
                }
            }
            this.shootMetaAttr.needsUpdate = true;
        }

        if (!this.customCameraOverride) {
            const motionScale = snap.reducedMotion ? 0 : 1;
            const t = snap.time;
            const breathX = Math.sin(t * 0.28) * 0.55 * motionScale + this.pointerX * 2.2 * motionScale;
            const breathY = Math.cos(t * 0.22) * 0.35 * motionScale + this.pointerY * 1.4 * motionScale;

            this.camera.position.set(
                this.baseCamPos.x + breathX,
                this.baseCamPos.y + breathY,
                this.baseCamPos.z,
            );
            this.camera.lookAt(
                this.baseLookAt.x + breathX * 0.35,
                this.baseLookAt.y + breathY * 0.35,
                this.baseLookAt.z,
            );
        }
    }

    setAspect(width, height) {
        if (width > 0 && height > 0) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
    }

    dispose() {
        for (const g of this.partGroups.values()) {
            this.scene?.remove(g);
        }
        this.partGroups.clear();
        for (const item of this.disposables) {
            try {
                item.dispose();
            } catch {
                // ignore disposal errors on already-released resources
            }
        }
        this.disposables.length = 0;
        this.textures?.dispose();
    }
}
