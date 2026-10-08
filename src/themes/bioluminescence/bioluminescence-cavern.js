/**
 * Bioluminescence — the rock: floor and banks, the vault, stalactites and columns, and the plug
 * of mist that closes the far gallery.
 *
 * The rock has no light of its own to speak of. What shows it is the grotto's flora: the lamps
 * (evaluated per fragment, so a cap that flares in play flares on the stone round it), the glow
 * of the lesser mushrooms (gathered per vertex when the cave is built, three numbers, one per
 * family of light), the mycelium that veins the floor and the low walls and carries the light of
 * a lock or a clear, and the pool's caustics on whatever stands near the water. Wet stone
 * mirrors the far chamber's glow at grazing angles.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    reflect,
    sin,
    smoothstep,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TERRAIN,
    blAtmosphere,
    blBell,
    blClearLight,
    blFogColor,
    blLamps,
    blLockLight,
    blPart,
    blPulseAt,
} from './bioluminescence-tsl.js';
import { ISLETS, VAULT, capCentre } from './bioluminescence-layout.js';

/** Everything the rock's fragment needs; `bake` = (occlusion, primary, secondary, accent glow). */
function rockColor(u, {
    normalNode, bake, wetBias = 0, veins = true,
}) {
    return Fn(() => {
        const p = positionWorld;
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const N0 = normalize(normalNode).toVar();
        // One mapping for floor and wall alike: the rock's grain leans with its height.
        const q = vec2(p.x.add(p.y.mul(0.37)), p.z.add(p.y.mul(0.29))).toVar();
        const big = u.noise(q.mul(0.021)).toVar();
        const mid = u.noise(q.mul(0.093).add(vec2(0.31, 0.72))).toVar();
        const fine = u.noise(q.mul(0.41)).toVar();
        // Relief: the noise's own channels stand in for its slope.
        const tilt = vec3(mid.r.sub(0.5), 0.0, mid.g.sub(0.5)).mul(1.5)
            .add(vec3(fine.b.sub(0.5), 0.0, fine.a.sub(0.5)).mul(0.7));
        const N = normalize(N0.add(tilt.mul(1.0))).toVar();
        const up = clamp(N0.y, 0.0, 1.0);

        // Strata and damp: bedded stone, darker where the water has been.
        const strata = sin(p.y.mul(2.6).add(big.r.mul(9.0))).mul(0.5).add(0.5);
        const stone = mix(vec3(0.014, 0.018, 0.022), vec3(0.075, 0.08, 0.086), mid.b.mul(mid.b).mul(0.9).add(strata.mul(0.18)));
        // Moss on what faces up near the water.
        const mossy = smoothstep(0.52, 0.72, big.g.add(up.mul(0.25))).mul(up).mul(float(1.0).sub(smoothstep(1.5, 9.0, p.y)));
        // Cracks: where the grain folds, the stone is dark.
        const crack = blBell(mid.r.sub(0.5).mul(9.0)).mul(0.7).add(blBell(fine.b.sub(0.5).mul(7.0)).mul(0.35));
        const albedo = mix(stone, vec3(0.016, 0.06, 0.034), mossy.mul(0.5)).mul(float(1.0).sub(crack.mul(0.75))).toVar();
        const wet = clamp(float(1.0).sub(smoothstep(0.0, 3.2, p.y)).mul(0.75).add(wetBias)
            .add(fine.r.mul(0.2)), 0.0, 1.0);

        const ao = bake.x;
        const lamps = blLamps(u, p, N).toVar();
        const lesser = u.primary.mul(bake.y).add(u.secondary.mul(bake.z)).add(u.accent.mul(bake.w));
        const beat = blPulseAt(u, p).mul(u.power).mul(0.5).add(1.0);
        const sky = u.ambient.mul(N.y.mul(0.4).add(0.8)).mul(u.breath.mul(0.8).add(0.2));
        const col = albedo.mul(sky.add(lamps.mul(1.25)).add(lesser.mul(beat).mul(u.breath))).mul(ao).toVar();

        // Wet stone mirrors the far glow at a grazing angle, and takes a glint from the lamps.
        const R = reflect(toCam.negate(), N);
        const graze = float(1.0).sub(clamp(dot(N, toCam), 0.0, 1.0));
        const fres = graze.mul(graze).mul(graze).mul(0.85).add(0.03);
        col.addAssign(blFogColor(u, R).mul(fres).mul(wet).mul(ao)
            .mul(2.6));
        col.addAssign(blLamps(u, p, R).mul(fres).mul(wet).mul(ao)
            .mul(0.6));

        if (veins) {
            // ── Mycelium: threads of light in the floor and the low walls ──
            const reach = float(1.0).sub(smoothstep(2.0, 13.0, p.y));
            const v1 = u.noise(q.mul(0.047)).r;
            const v2 = u.noise(q.mul(0.163).add(vec2(0.3, 0.6))).g;
            const thread = blBell(v1.sub(0.5).mul(17.0)).add(blBell(v2.sub(0.5).mul(26.0)).mul(0.55)).mul(reach).toVar();
            const throb = sin(u.time.mul(0.7).add(v1.mul(26.0))).mul(0.3).add(0.7);
            const ring = vec3(0.0).toVar();
            const clear = vec4(0.0).toVar();
            If(u.ringsLive.greaterThan(0.5), () => {
                ring.assign(blLockLight(u, p));
            });
            If(u.clearLive.greaterThan(0.5), () => {
                clear.assign(blClearLight(u, p));
            });
            const wake = u.power.mul(0.55).add(clear.w.mul(0.5)).add(u.surge.mul(0.4)).add(0.07);
            col.addAssign(u.vein.mul(thread).mul(throb).mul(wake).mul(u.breath)
                .mul(ao.mul(0.6).add(0.4)));
            col.addAssign(ring.mul(thread.mul(2.2).add(0.12)).add(clear.rgb.mul(thread.mul(1.6).add(0.1))));

            // ── The pool's caustics on whatever stands near the water ──
            const near = exp(max(p.y, 0.0).mul(-0.8)).mul(smoothstep(-0.2, 0.25, p.y));
            const c1 = u.noise(q.mul(0.27).add(vec2(u.time.mul(0.021), u.time.mul(0.013)))).r;
            const c2 = u.noise(q.mul(0.31).sub(vec2(u.time.mul(0.017), u.time.mul(-0.011)))).g;
            const net = blBell(c1.add(c2).sub(1.0).mul(7.0));
            col.addAssign(u.plankton.mul(net).mul(near).mul(u.power.mul(0.7).add(clear.w.mul(0.6)).add(0.2)).mul(0.22)
                .mul(u.breath));

            // ── Specks of glowing moss ──
            const speck = smoothstep(0.78, 0.9, fine.g).mul(mossy)
                .mul(sin(u.time.mul(1.3).add(fine.b.mul(40.0))).mul(0.4).add(0.6));
            col.addAssign(u.secondary.mul(speck).mul(u.power.add(0.5)).mul(0.5).mul(u.breath));
        }
        return blAtmosphere(u, col, p);
    })();
}

/** Occlusion from the lie of a height field: how far its neighbours stand above a vertex. */
function concavity(field, gx, gz, i, j, cell, sign) {
    let occl = 0;
    const h = field[j * gx + i];
    for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        for (let r = 2; r <= 5; r += 3) {
            const ii = Math.max(0, Math.min(gx - 1, Math.round(i + Math.cos(a) * r)));
            const jj = Math.max(0, Math.min(gz - 1, Math.round(j + Math.sin(a) * r)));
            const rise = (sign * (field[jj * gx + ii] - h)) / (r * cell);
            occl += Math.max(0, rise - 0.08) * (r === 2 ? 0.6 : 0.4);
        }
    }
    return 1 / (1 + occl * 0.42);
}

/**
 * Build a height-field mesh over the plan's extent.
 * @param {Float32Array} field   gx × gz heights
 * @param {number} sign          +1 = a floor (faces up), −1 = a vault (faces down)
 * @param {(i: number, j: number) => boolean} keep  whether a vertex is worth drawing
 */
function fieldGeometry(field, gx, gz, sign, keep) {
    const {
        x0, x1, z0, z1,
    } = TERRAIN;
    const dx = (x1 - x0) / (gx - 1);
    const dz = (z1 - z0) / (gz - 1);
    const position = new Float32Array(gx * gz * 3);
    const normal = new Float32Array(gx * gz * 3);
    const bake = new Float32Array(gx * gz * 4);
    const at = (i, j) => field[Math.max(0, Math.min(gz - 1, j)) * gx + Math.max(0, Math.min(gx - 1, i))];
    for (let j = 0; j < gz; j++) {
        for (let i = 0; i < gx; i++) {
            const o = j * gx + i;
            position[o * 3] = x0 + i * dx;
            position[o * 3 + 1] = field[o];
            position[o * 3 + 2] = z0 + j * dz;
            const sx = (at(i + 1, j) - at(i - 1, j)) / (2 * dx);
            const sz = (at(i, j + 1) - at(i, j - 1)) / (2 * dz);
            const len = Math.hypot(sx, 1, sz);
            normal[o * 3] = (-sx * sign) / len;
            normal[o * 3 + 1] = sign / len;
            normal[o * 3 + 2] = (-sz * sign) / len;
            bake[o * 4] = concavity(field, gx, gz, i, j, dx, sign);
        }
    }
    const index = [];
    for (let j = 0; j < gz - 1; j++) {
        for (let i = 0; i < gx - 1; i++) {
            if (!(keep(i, j) || keep(i + 1, j) || keep(i, j + 1) || keep(i + 1, j + 1))) continue;
            const a = j * gx + i;
            const b = a + 1;
            const c = a + gx;
            const d = c + 1;
            if (sign > 0) index.push(a, c, b, b, c, d);
            else index.push(a, b, c, b, d, c);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aNormal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aBake', new THREE.BufferAttribute(bake, 4));
    geometry.setIndex(index);
    return { geometry, bake, position };
}

/** Gather the glow of the lesser mushrooms into the vertices near them: one number per family. */
function bakeLesserGlow(plan, position, bake, gx, gz) {
    const {
        x0, x1, z0, z1,
    } = TERRAIN;
    const centre = [0, 0, 0];
    for (let m = plan.heroCount; m < plan.mushrooms.length; m++) {
        const shroom = plan.mushrooms[m];
        capCentre(shroom, centre);
        const power = shroom.capR * shroom.capR * 1.5;
        const reach = shroom.capR * 5 + 1.5;
        const i0 = Math.max(0, Math.floor(((centre[0] - reach - x0) / (x1 - x0)) * (gx - 1)));
        const i1 = Math.min(gx - 1, Math.ceil(((centre[0] + reach - x0) / (x1 - x0)) * (gx - 1)));
        const j0 = Math.max(0, Math.floor(((centre[2] - reach - z0) / (z1 - z0)) * (gz - 1)));
        const j1 = Math.min(gz - 1, Math.ceil(((centre[2] + reach - z0) / (z1 - z0)) * (gz - 1)));
        const soft = shroom.capR * shroom.capR * 0.6 + 0.02;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const o = j * gx + i;
                const ddx = position[o * 3] - centre[0];
                const ddy = position[o * 3 + 1] - centre[1];
                const ddz = position[o * 3 + 2] - centre[2];
                const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                const edge = Math.max(0, 1 - Math.sqrt(d2) / reach);
                bake[o * 4 + 1 + Math.min(2, shroom.family)] += (power / (d2 + soft)) * edge * edge;
            }
        }
    }
}

/** The floor and banks. */
export function createFloor(u, plan) {
    const { nx, nz } = TERRAIN;
    const gridFloor = (i, j) => plan.ground[j * nx + i];
    const vaultOver = (i, j) => {
        const x = TERRAIN.x0 + ((TERRAIN.x1 - TERRAIN.x0) * i) / (nx - 1);
        const z = TERRAIN.z0 + ((TERRAIN.z1 - TERRAIN.z0) * j) / (nz - 1);
        return plan.vaultAt(x, z);
    };
    // Not what lies well under the water, nor what is buried in the vault.
    const keep = (i, j) => gridFloor(i, j) > -0.45 && gridFloor(i, j) < vaultOver(i, j) + 2.5;
    const { geometry, bake, position } = fieldGeometry(plan.ground, nx, nz, 1, keep);
    bakeLesserGlow(plan, position, bake, nx, nz);
    geometry.getAttribute('aBake').needsUpdate = true;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'BioluminescenceFloor';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const vNormal = varying(attribute('aNormal', 'vec3'), 'blFloorN');
    const vBake = varying(attribute('aBake', 'vec4'), 'blFloorBake');
    material.colorNode = rockColor(u, { normalNode: vNormal, bake: vBake });
    return blPart('BioluminescenceFloor', geometry, material, -27);
}

const ISLET_RINGS = 12;
const ISLET_SIDES = 36;

/**
 * The outcrops in the shallows. They stand at the viewer's feet, so each is its own fine mesh
 * (a polar grid over the plan's exact floor) rather than a few cells of the floor's.
 */
export function createIslets(u, plan) {
    const position = [];
    const normal = [];
    const bake = [];
    const index = [];
    const centre = [0, 0, 0];
    const lesser = plan.mushrooms.slice(plan.heroCount);
    ISLETS.forEach(([ix, iz, r]) => {
        const base = position.length / 3;
        const reach = r * 1.28;
        for (let k = 0; k <= ISLET_RINGS; k++) {
            const d = reach * (k / ISLET_RINGS) ** 0.8;
            for (let i = 0; i <= ISLET_SIDES; i++) {
                const a = (i / ISLET_SIDES) * Math.PI * 2;
                const x = ix + Math.cos(a) * d;
                const z = iz + Math.sin(a) * d;
                const h = plan.floorAt(x, z);
                const e = 0.07;
                const sx = (plan.floorAt(x + e, z) - plan.floorAt(x - e, z)) / (2 * e);
                const sz = (plan.floorAt(x, z + e) - plan.floorAt(x, z - e)) / (2 * e);
                const len = Math.hypot(sx, 1, sz);
                position.push(x, h, z);
                normal.push(-sx / len, 1 / len, -sz / len);
                // Darker at the waterline, where the stone is undercut.
                const ao = 0.5 + 0.5 * Math.min(1, Math.max(0, (h + 0.05) / 0.3));
                const glow = [0, 0, 0];
                for (let m = 0; m < lesser.length; m++) {
                    const shroom = lesser[m];
                    if (Math.abs(shroom.x - x) > 6 || Math.abs(shroom.z - z) > 6) continue;
                    capCentre(shroom, centre);
                    const d2 = (x - centre[0]) ** 2 + (h - centre[1]) ** 2 + (z - centre[2]) ** 2;
                    const far = Math.max(0, 1 - Math.sqrt(d2) / (shroom.capR * 5 + 1.5));
                    glow[Math.min(2, shroom.family)] += ((shroom.capR * shroom.capR * 1.5) / (d2 + shroom.capR * shroom.capR * 0.6 + 0.02)) * far * far;
                }
                bake.push(ao, glow[0], glow[1], glow[2]);
            }
        }
        const row = ISLET_SIDES + 1;
        for (let k = 0; k < ISLET_RINGS; k++) {
            for (let i = 0; i < ISLET_SIDES; i++) {
                const a = base + k * row + i;
                index.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('aNormal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('aBake', new THREE.Float32BufferAttribute(bake, 4));
    geometry.setIndex(index);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'BioluminescenceIslets';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const vNormal = varying(attribute('aNormal', 'vec3'), 'blIsletN');
    const vBake = varying(attribute('aBake', 'vec4'), 'blIsletBake');
    material.colorNode = rockColor(u, { normalNode: vNormal, bake: vBake, wetBias: 0.3 });
    return blPart('BioluminescenceIslets', geometry, material, -27);
}

/** The vault. */
export function createVault(u, plan) {
    const gx = VAULT.nx;
    const gz = VAULT.nz;
    const floorUnder = (i, j) => {
        const x = TERRAIN.x0 + ((TERRAIN.x1 - TERRAIN.x0) * i) / (gx - 1);
        const z = TERRAIN.z0 + ((TERRAIN.z1 - TERRAIN.z0) * j) / (gz - 1);
        return plan.floorAt(x, z);
    };
    const keep = (i, j) => plan.vault[j * gx + i] > floorUnder(i, j) - 3;
    const { geometry } = fieldGeometry(plan.vault, gx, gz, -1, keep);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'BioluminescenceVault';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const vNormal = varying(attribute('aNormal', 'vec3'), 'blVaultN');
    const vBake = varying(attribute('aBake', 'vec4'), 'blVaultBake');
    material.colorNode = rockColor(u, {
        normalNode: vNormal, bake: vBake, wetBias: 0.35, veins: false,
    });
    return blPart('BioluminescenceVault', geometry, material, -25);
}

const SPIKE_RINGS = 8;
const SPIKE_SIDES = 9;

/** A unit spike: y 0 (root) to 1 (tip), radius 1 at the root; `aRing` = (angle 0..1, height). */
function unitSpike() {
    const position = [];
    const ring = [];
    const index = [];
    for (let j = 0; j <= SPIKE_RINGS; j++) {
        const t = j / SPIKE_RINGS;
        for (let i = 0; i <= SPIKE_SIDES; i++) {
            const a = (i / SPIKE_SIDES) * Math.PI * 2;
            position.push(Math.cos(a), t, Math.sin(a));
            ring.push(i / SPIKE_SIDES, t);
        }
    }
    const row = SPIKE_SIDES + 1;
    for (let j = 0; j < SPIKE_RINGS; j++) {
        for (let i = 0; i < SPIKE_SIDES; i++) {
            const a = j * row + i;
            index.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
        }
    }
    return { position, ring, index };
}

/**
 * Stalactites, stalagmites and columns: one instanced draw of a lathe that the vertex stage
 * tapers and roughens. `aRoot` = (x, y, z, signed length), `aForm` = (radius, seed, column, _).
 * @param {number} count  spikes drawn (the plan's first N; the columns come first)
 */
export function createSpikes(u, plan, count) {
    const n = Math.min(count, plan.spikes.length);
    const aRoot = new Float32Array(Math.max(1, n) * 4);
    const aForm = new Float32Array(Math.max(1, n) * 4);
    for (let i = 0; i < n; i++) {
        const s = plan.spikes[i];
        aRoot.set([s.x, s.y, s.z, s.length], i * 4);
        aForm.set([s.radius, s.seed, s.column ? 1 : 0, 0], i * 4);
    }
    const unit = unitSpike();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(unit.position, 3));
    geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(unit.ring, 2));
    geometry.setIndex(unit.index);
    geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(aRoot, 4));
    geometry.setAttribute('aForm', new THREE.InstancedBufferAttribute(aForm, 4));
    geometry.instanceCount = n;

    const root = attribute('aRoot', 'vec4');
    const form = attribute('aForm', 'vec4');
    const ring = attribute('aRing', 'vec2');
    const t = ring.y;
    const seed = form.y;
    // A spike tapers to its point; a column is waisted, wide where it joins floor and vault.
    const taper = mix(
        float(1.0).sub(t).pow(0.72).mul(sin(t.mul(11.0).add(seed)).mul(0.08).add(1.0)),
        t.mul(2.0).sub(1.0).mul(t.mul(2.0).sub(1.0)).mul(0.7)
            .add(0.62),
        form.z,
    );
    const lump = sin(ring.x.mul(Math.PI * 2 * 3).add(seed.mul(1.7)).add(t.mul(5.0))).mul(0.16)
        .add(sin(ring.x.mul(Math.PI * 2 * 5).add(seed.mul(0.9))).mul(0.08))
        .add(1.0);
    const r = form.x.mul(taper).mul(lump);
    const bend = sin(seed.mul(2.3)).mul(0.05).mul(root.w).mul(t)
        .mul(t);
    const local = vec3(
        positionGeometry.x.mul(r).add(bend),
        t.mul(root.w),
        positionGeometry.z.mul(r).add(cos(seed.mul(1.3)).mul(0.05).mul(root.w).mul(t)
            .mul(t)),
    );
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'BioluminescenceSpikes';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.positionNode = root.xyz.add(local);
    // Outward, leaning toward the point; a hanging spike's flanks face down.
    const lean = root.w.sign().mul(mix(float(0.42), float(0.0), form.z));
    const vNormal = varying(normalize(vec3(positionGeometry.x, lean, positionGeometry.z)), 'blSpikeN');
    material.colorNode = rockColor(u, {
        normalNode: vNormal, bake: vec4(0.85, 0.0, 0.0, 0.0), wetBias: 0.4, veins: false,
    });
    const part = blPart('BioluminescenceSpikes', geometry, material, -28);
    part.count = n;
    return part;
}

/** A sheet of the cave's own mist behind everything: the far gallery never shows the void. */
export function createBackdrop(u) {
    const geometry = new THREE.PlaneGeometry(520, 260, 1, 1);
    geometry.translate(0, 60, TERRAIN.z0 - 4);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'BioluminescenceBackdrop';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.colorNode = blAtmosphere(u, vec3(0.0), positionWorld);
    return blPart('BioluminescenceBackdrop', geometry, material, -24);
}
