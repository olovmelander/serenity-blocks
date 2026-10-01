/**
 * Synthwave Sunset — gameplay FX: neon cells on the grid, spark bursts, drifting motes.
 *
 * All motion is analytic in the vertex stage (spawn state + age), so there is no compute pass
 * and no per-frame upload: a spawn writes one instance's attributes as a ranged upload. The same
 * code runs on both WebGPURenderer backends. Sparks and motes are instanced Sprites — the old
 * theme drew them as THREE.Points, which WebGPU renders 1 pixel wide whatever the sizeNode says.
 *
 * Additive materials write premultiplied colour with alpha 1 (r185 AdditiveBlending is
 * SrcAlpha, One).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    modelViewMatrix,
    positionLocal,
    pow,
    screenSize,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { SCROLL_SPEED, GRID_SPACING } from './synthwave-sunset-tsl.js';
import { FLOOR_FOG_DENSITY } from './synthwave-sunset-floor.js';

/** Cells fade out as they reach the camera (rest z = 20) and are recycled soon after. */
const CELL_FADE_START_Z = 6;
const CELL_FADE_END_Z = 24;

function instanced(count, itemSize) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
}

/** Mark one instance dirty (ranged upload; ranges merge per frame in three). */
function touch(attr, index) {
    attr.addUpdateRange(index * attr.itemSize, attr.itemSize);
    attr.needsUpdate = true;
}

function createCells(u, count) {
    const geometry = new THREE.PlaneGeometry(GRID_SPACING, GRID_SPACING);
    geometry.rotateX(-Math.PI / 2);
    const iCell = instanced(count, 4); // x, z0, t0, intensity (0 = free)
    const iCellCol = instanced(count, 3);
    geometry.setAttribute('iCell', iCell);
    geometry.setAttribute('iCellCol', iCellCol);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveCells';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.fog = false;

    const cell = attribute('iCell', 'vec4');
    const tint = attribute('iCellCol', 'vec3');
    const age = u.time.sub(cell.z);
    const z = cell.y.add(age.mul(SCROLL_SPEED));
    const alive = step(1e-3, cell.w);
    material.positionNode = positionLocal.mul(alive).add(vec3(cell.x, 0.03, z));

    material.colorNode = Fn(() => {
        const c = uv().sub(0.5);
        const edge = max(abs(c.x), abs(c.y));
        const rim = smoothstep(0.33, 0.46, edge).mul(float(1.0).sub(smoothstep(0.46, 0.5, edge)));
        const fill = float(1.0).sub(smoothstep(0.0, 0.46, edge));
        const flash = exp(age.mul(-6.0));
        const fadeIn = smoothstep(0.0, 0.12, age);
        const fadeOut = float(1.0).sub(smoothstep(CELL_FADE_START_Z, CELL_FADE_END_Z, z));
        const twinkle = sin(u.time.mul(30.0).add(cell.x.mul(3.1)).add(cell.y.mul(1.7)))
            .mul(u.cellTwinkle).mul(0.5).add(1.0);
        const dist = length(vec2(cell.x.sub(cameraPosition.x), z.sub(cameraPosition.z)));
        const fog = exp(dist.mul(-FLOOR_FOG_DENSITY));
        const energy = rim.mul(2.3).add(fill.mul(0.42)).add(flash.mul(2.0));
        return tint.mul(energy.mul(cell.w).mul(fadeIn).mul(fadeOut).mul(twinkle)
            .mul(fog));
    })();
    material.opacityNode = float(1.0);

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'SynthwaveCells';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return { mesh, iCell, iCellCol };
}

function createSparks(u, count) {
    const material = new THREE.PointsNodeMaterial();
    material.name = 'SynthwaveSparks';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.sizeAttenuation = false;
    material.fog = false;

    const spawn = attribute('iSpawn', 'vec4'); // x, y, z, t0
    const vel = attribute('iVel', 'vec4'); // vx, vy, vz, life
    const look = attribute('iLook', 'vec4'); // r, g, b, size px
    const motion = attribute('iMotion', 'vec4'); // drag, gravity, streak gain, 0
    const age = u.time.sub(spawn.w);
    const life = max(vel.w, 1e-3);
    const alive = step(0.0, age).mul(step(age, life));
    const lifeT = clamp(age.div(life), 0.0, 1.0);

    // Decelerating flight (exponential drag) under a gentle world-down gravity; both per spark.
    const drag = max(motion.x, 1e-3);
    const decay = exp(age.mul(drag).negate());
    const travel = float(1.0).sub(decay).div(drag);
    const gravity = motion.y;
    const pos = spawn.xyz.add(vel.xyz.mul(travel)).add(vec3(0.0, gravity.mul(age).mul(age).mul(-0.5), 0.0));
    const velNow = vel.xyz.mul(decay).sub(vec3(0.0, gravity.mul(age), 0.0));

    // Screen-space velocity (px/s): sparks stretch into streaks along their on-screen motion.
    // The quad is square (PointsNodeMaterial rotates BEFORE its non-uniform size, which would
    // shear a rotated streak), sized to the streak length; the fragment draws the streak in it.
    const dt = 0.02;
    const clip0 = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(pos, 1.0)));
    const clip1 = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(pos.add(velNow.mul(dt)), 1.0)));
    const pxVel = clip1.xy.div(clip1.w).sub(clip0.xy.div(clip0.w)).mul(screenSize.mul(0.5)).div(dt);
    const speedPx = length(pxVel);
    const stretch = float(1.0).add(clamp(speedPx.mul(motion.z).mul(0.011), 0.0, 5.0));
    const vDir = varying(pxVel.div(max(speedPx, 1e-3)), 'vSparkDir');
    const vStretch = varying(stretch, 'vSparkStretch');

    material.positionNode = pos;
    material.sizeNode = look.w.mul(stretch).mul(pow(float(1.0).sub(lifeT), 0.3)).mul(alive);
    material.colorNode = Fn(() => {
        // Streak frame: `along` runs with the motion (head at +1), `across` in streak widths.
        const local = uv().sub(0.5).mul(2.0);
        const along = dot(local, vDir);
        const across = dot(local, vec2(vDir.y.negate(), vDir.x)).mul(vStretch);
        const shape = exp(across.mul(across).mul(-3.2)).mul(exp(along.mul(along).mul(-2.2)))
            .mul(mix(float(0.3), float(1.0), smoothstep(-1.0, 0.5, along)));
        return look.xyz.mul(shape.mul(pow(float(1.0).sub(lifeT), 0.85)).mul(2.6));
    })();
    material.opacityNode = float(1.0);

    const sprite = new THREE.Sprite(material);
    sprite.name = 'SynthwaveSparks';
    sprite.geometry = sprite.geometry.clone();
    const iSpawn = instanced(count, 4);
    const iVel = instanced(count, 4);
    const iLook = instanced(count, 4);
    const iMotion = instanced(count, 4);
    // Park every slot as already dead.
    for (let i = 0; i < count; i += 1) iSpawn.array[i * 4 + 3] = -1e6;
    sprite.geometry.setAttribute('iSpawn', iSpawn);
    sprite.geometry.setAttribute('iVel', iVel);
    sprite.geometry.setAttribute('iLook', iLook);
    sprite.geometry.setAttribute('iMotion', iMotion);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 3;
    return {
        sprite, iSpawn, iVel, iLook, iMotion,
    };
}

function createMotes(u, count, rand) {
    const material = new THREE.PointsNodeMaterial();
    material.name = 'SynthwaveMotes';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.sizeAttenuation = false;
    material.fog = false;

    const mote = attribute('iMote', 'vec4'); // x, y, z, phase
    const look = attribute('iMoteLook', 'vec4'); // r, g, b, size
    const t = u.time;
    const ph = mote.w;
    const pos = mote.xyz.add(vec3(
        sin(t.mul(0.07).add(ph)).mul(6.0),
        sin(t.mul(0.11).add(ph.mul(1.7))).mul(1.2),
        sin(t.mul(0.05).add(ph.mul(0.6))).mul(4.0),
    ));
    const dist = length(pos.sub(cameraPosition));
    material.positionNode = pos;
    material.sizeNode = look.w.mul(clamp(float(55.0).div(dist), 0.6, 2.2));
    material.colorNode = Fn(() => {
        const d = length(uv().sub(0.5)).mul(2.0);
        const core = exp(d.mul(d).mul(-4.0));
        const pulse = sin(t.mul(0.6).add(ph.mul(3.0))).mul(0.5).add(0.5);
        const fog = exp(dist.mul(-FLOOR_FOG_DENSITY));
        return look.xyz.mul(core.mul(pulse.mul(0.7).add(0.3)).mul(0.55).mul(fog));
    })();
    material.opacityNode = float(1.0);

    const sprite = new THREE.Sprite(material);
    sprite.name = 'SynthwaveMotes';
    sprite.geometry = sprite.geometry.clone();
    const iMote = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const iMoteLook = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const palette = [0xffc2a0, 0xff9ccf, 0xfff0e6, 0xff8a70].map((h) => new THREE.Color(h));
    for (let i = 0; i < count; i += 1) {
        // A wedge of air in front of the camera, beyond the near palms.
        const phi = (rand() * 2 - 1) * 1.45;
        const d = 30 + rand() * 150;
        iMote.array.set([Math.sin(phi) * d, 2 + rand() * 26, 20 - Math.cos(phi) * d, rand() * 6.28], i * 4);
        const c = palette[Math.floor(rand() * palette.length)];
        iMoteLook.array.set([c.r, c.g, c.b, 1.6 + rand() * 2.4], i * 4);
    }
    sprite.geometry.setAttribute('iMote', iMote);
    sprite.geometry.setAttribute('iMoteLook', iMoteLook);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 1;
    return { sprite };
}

export class SynthwaveFx {
    /**
     * @param {object} u  shared world uniforms
     * @param {object} opts
     * @param {number} opts.cells   highlight cell pool
     * @param {number} opts.sparks  spark pool
     * @param {number} opts.motes   drifting motes (0 = none)
     * @param {() => number} opts.rand
     */
    constructor(u, {
        cells, sparks, motes, rand,
    }) {
        this.u = u;
        this.group = new THREE.Group();
        this.group.name = 'SynthwaveFx';
        this.cells = createCells(u, Math.max(1, cells));
        this.cellExpiry = new Float64Array(Math.max(1, cells)).fill(-Infinity);
        this.cellCursor = 0;
        this.sparks = createSparks(u, Math.max(1, sparks));
        this.sparkCursor = 0;
        this.motes = motes > 0 ? createMotes(u, motes, rand) : null;
        this.group.add(this.cells.mesh, this.sparks.sprite);
        if (this.motes) this.group.add(this.motes.sprite);
    }

    /** Light one grid cell (world x = cell centre, z0 = cell centre at time t0). */
    spawnCell(x, z0, t0, color, intensity) {
        const n = this.cellExpiry.length;
        // Prefer a free slot; otherwise recycle the one that expires soonest.
        let slot = -1;
        let soonest = Infinity;
        for (let k = 0; k < n; k += 1) {
            const i = (this.cellCursor + k) % n;
            if (this.cellExpiry[i] <= t0) {
                slot = i;
                break;
            }
            if (this.cellExpiry[i] < soonest) {
                soonest = this.cellExpiry[i];
                slot = i;
            }
        }
        this.cellCursor = (slot + 1) % n;
        this.cellExpiry[slot] = t0 + (CELL_FADE_END_Z - z0) / SCROLL_SPEED + 0.5;
        const { iCell, iCellCol } = this.cells;
        iCell.array.set([x, z0, t0, intensity], slot * 4);
        iCellCol.array.set([color.r, color.g, color.b], slot * 3);
        touch(iCell, slot);
        touch(iCellCol, slot);
    }

    /**
     * Emit one spark: world position/velocity, life (s), THREE.Color, size (px), and its motion
     * (`drag` 1/s, `gravity` units/s², `streak` gain on the motion stretch; defaults: the classic
     * burst — drag 1.4 and a gravity that scales with the speed, so near and far bursts arc alike).
     */
    spawnSpark(t0, px, py, pz, vx, vy, vz, life, color, sizePx, motion = {}) {
        const {
            iSpawn, iVel, iLook, iMotion,
        } = this.sparks;
        const i = this.sparkCursor;
        this.sparkCursor = (i + 1) % (iSpawn.count);
        const drag = motion.drag ?? 1.4;
        const gravity = motion.gravity ?? Math.hypot(vx, vy, vz) * 0.3;
        iSpawn.array.set([px, py, pz, t0], i * 4);
        iVel.array.set([vx, vy, vz, life], i * 4);
        iLook.array.set([color.r, color.g, color.b, sizePx], i * 4);
        iMotion.array.set([drag, gravity, motion.streak ?? 1, 0], i * 4);
        touch(iSpawn, i);
        touch(iVel, i);
        touch(iLook, i);
        touch(iMotion, i);
    }

    /** Spark pool size (callers scale bursts to it). */
    get sparkCapacity() {
        return this.sparks.iSpawn.count;
    }

    /** Drop every live cell and spark (seek / restart). */
    clear() {
        this.cellExpiry.fill(-Infinity);
        const { iCell } = this.cells;
        iCell.array.fill(0);
        iCell.clearUpdateRanges();
        iCell.needsUpdate = true;
        const { iSpawn } = this.sparks;
        for (let i = 0; i < iSpawn.count; i += 1) iSpawn.array[i * 4 + 3] = -1e6;
        iSpawn.clearUpdateRanges();
        iSpawn.needsUpdate = true;
    }

    dispose() {
        this.group.removeFromParent();
        this.cells.mesh.geometry.dispose();
        this.cells.mesh.material.dispose();
        this.cells.mesh.dispose?.();
        this.sparks.sprite.geometry.dispose();
        this.sparks.sprite.material.dispose();
        if (this.motes) {
            this.motes.sprite.geometry.dispose();
            this.motes.sprite.material.dispose();
        }
    }
}
