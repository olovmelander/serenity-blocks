/**
 * Neon District — the small lights and what hangs between the buildings.
 *
 *  - Halos: the humid air glowing round every sign, shopfront and screen. Unlike bloom they are
 *    in the world, so they grow with distance — the depth cue of a wet night.
 *  - Street lamps: posts with a cool head, and the cone of rain-streaked air under each.
 *  - Cables sagging across the street (thin dark strips, never thinner than a pixel), three of
 *    them strung with paper lanterns.
 *  - Aviation beacons on the roofs and the megatowers.
 *  - Flying traffic: two lanes up the canyon over the street, and cross-town lanes far off
 *    between the megatowers — white coming, red going.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    STREET,
    mulberry32,
    ndAtmosphere,
    ndClearLight,
    ndFogAmount,
    ndFxMaterial,
    ndGlow,
    ndHash11,
    ndLockLight,
    ndQuadGeometry,
    ndWrapZ,
} from './neon-district-tsl.js';
import { BILLBOARD_CELLS, SHOPFRONT_CELLS } from './neon-district-atlas.js';

const finish = (name, geometry, material, renderOrder = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    return { mesh, material, geometry };
};

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** Clip position of a camera-facing quad corner: `sizeMetres` wide/high, never under `minPx`. */
function spriteClip(u, centre, sizeMetres, minPx = 0) {
    const clip = viewProjection(centre);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    const px = max(sizeMetres.mul(pxPerMetre), vec2(minPx, minPx));
    return vec4(clip.xy.add(positionGeometry.xy.mul(px).div(half).mul(clip.w)), clip.z, clip.w);
}

// ── Halos ───────────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {object} plan  the city plan (signs, shopfronts, screens, lamps)
 */
export function createHalos(u, plan) {
    const items = [];
    plan.signs.forEach((s) => {
        items.push({
            x: s.x - s.side * 0.2, y: s.y, z: s.z, w: s.w, h: s.h, rgb: s.rgb, k: s.style ? 0.8 : 1,
        });
    });
    plan.shopfronts.forEach((s) => {
        const cell = SHOPFRONT_CELLS[s.cell];
        items.push({
            x: s.side * (STREET.halfStreet - 0.7), y: s.h * 0.55, z: s.z, w: s.w * 0.8, h: s.h * 0.8, rgb: cell.glow, k: 0.9 + cell.luma * 6,
        });
    });
    plan.screens.forEach((s) => {
        items.push({
            x: s.x, y: s.y, z: s.z + 0.3, w: s.w, h: s.h, rgb: BILLBOARD_CELLS[s.cell].glow, k: 0.9,
        });
    });
    const count = items.length;
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    items.forEach((it, i) => {
        aPos.set([it.x, it.y, it.z, it.k], i * 4);
        aDim.set([it.w * 1.5 + 2.6, it.h * 1.5 + 2.6, 0, 0], i * 4);
    });
    const aCol = new Float32Array(count * 3);
    items.forEach((it, i) => aCol.set(it.rgb, i * 3));
    const geometry = ndQuadGeometry(count, { aPos: [aPos, 4], aDim: [aDim, 4], aCol: [aCol, 3] });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const col = attribute('aCol', 'vec3');

    const material = ndFxMaterial('NeonDistrictHalos');
    const centre = vec3(pos.x, pos.y, ndWrapZ(pos.z.add(u.scroll)));
    material.vertexNode = spriteClip(u, centre, vec2(dim.x, dim.y));
    const dist = length(centre.sub(cameraPosition));
    const fog = ndFogAmount(dist, centre.y);
    const clear = ndClearLight(u, centre.z);
    // Thin air near the camera shows little glow; the haze down the street shows a lot.
    const strength = fog.mul(0.5).add(0.03)
        .mul(float(1.0).sub(smoothstep(0.82, 1.0, fog)))
        .mul(pos.w)
        .mul(min(u.neon, 1.1))
        .mul(clear.w.mul(0.35).add(1.0));
    const vLight = varying(mix(col, vec3(1.0, 0.72, 0.26), u.heat.mul(0.6)).mul(strength), 'ndHalo');
    material.colorNode = Fn(() => {
        const d = uv().sub(0.5).mul(2.0);
        const r2 = d.dot(d);
        const g = exp(r2.mul(-3.6)).sub(0.027).max(0.0);
        return vec4(vLight.mul(g), 0.0);
    })();
    return finish('NeonDistrictHalos', geometry, material, 20);
}

// ── Street lamps ────────────────────────────────────────────────────────────────

function lampGeometry() {
    const parts = [];
    const add = (w, h, d, x, y, z, lens) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        const n = g.attributes.position.count;
        const flag = new Float32Array(n).fill(lens ? 1 : 0);
        g.setAttribute('aLens', new THREE.BufferAttribute(flag, 1));
        parts.push(g);
    };
    // Built for the LEFT kerb (the arm reaches +x, over the road); mirrored per instance.
    add(0.16, 7.2, 0.16, 0, 3.6, 0, false);
    add(0.34, 0.5, 0.34, 0, 0.25, 0, false);
    add(2.0, 0.1, 0.1, 0.95, 7.15, 0, false);
    add(0.72, 0.12, 0.3, 1.75, 7.06, 0, false);
    add(0.6, 0.05, 0.22, 1.75, 6.98, 0, true);
    const positions = [];
    const normals = [];
    const lens = [];
    const indices = [];
    let offset = 0;
    parts.forEach((g) => {
        positions.push(...g.attributes.position.array);
        normals.push(...g.attributes.normal.array);
        lens.push(...g.attributes.aLens.array);
        const idx = g.index.array;
        for (let i = 0; i < idx.length; i++) indices.push(idx[i] + offset);
        offset += g.attributes.position.count;
        g.dispose();
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aLens', new THREE.Float32BufferAttribute(lens, 1));
    return geometry;
}

/** The lamp posts (opaque) and their cones of lit rain (additive). */
export function createLamps(u, lamps) {
    const count = lamps.length;
    const aPos = new Float32Array(count * 4);
    lamps.forEach((l, i) => aPos.set([l.x, 0, l.z, l.side], i * 4));

    // Posts.
    const geometry = lampGeometry();
    geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 4));
    geometry.instanceCount = count;
    const pos = attribute('aPos', 'vec4');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDistrictLamps';
    material.fog = false;
    const zc = ndWrapZ(pos.z.add(u.scroll));
    // The arm reaches toward the road: +x on the left kerb, −x on the right.
    material.positionNode = vec3(
        pos.x.sub(positionGeometry.x.mul(pos.w)),
        positionGeometry.y,
        zc.add(positionGeometry.z),
    );
    const lampCol = vec3(0.62, 0.84, 1.0);
    material.colorNode = Fn(() => {
        const lens = attribute('aLens', 'float');
        const glow = ndGlow(u, positionWorld).mul(exp(max(positionWorld.y.sub(3.0), 0.0).mul(-0.1)));
        const metal = vec3(0.02, 0.022, 0.03).mul(glow.mul(1.1).add(0.06))
            .mul(normalGeometry.y.mul(0.25).add(0.75));
        const lit = lampCol.mul(4.2).mul(u.neon.mul(0.55).add(0.45));
        return ndAtmosphere(u, mix(metal, lit, step(0.5, lens)), positionWorld);
    })();
    const posts = finish('NeonDistrictLamps', geometry, material);

    // Cones.
    const cone = new THREE.CylinderGeometry(0.12, 3.5, 6.9, 20, 1, true);
    cone.translate(0, 3.5, 0);
    const coneGeometry = new THREE.InstancedBufferGeometry();
    coneGeometry.setIndex(cone.index);
    coneGeometry.setAttribute('position', cone.attributes.position);
    coneGeometry.setAttribute('normal', cone.attributes.normal);
    coneGeometry.setAttribute('uv', cone.attributes.uv);
    coneGeometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 4));
    coneGeometry.instanceCount = count;
    const coneMaterial = ndFxMaterial('NeonDistrictLampCones');
    const head = vec3(pos.x.sub(pos.w.mul(1.75)), 0.0, zc);
    const world = vec3(head.x.add(positionGeometry.x), positionGeometry.y, head.z.add(positionGeometry.z));
    coneMaterial.positionNode = world;
    const vNormal = varying(normalGeometry, 'ndConeN');
    coneMaterial.colorNode = Fn(() => {
        const pw = positionWorld;
        const V = normalize(pw.sub(cameraPosition));
        // A cone of lit air is brightest where the view ray crosses most of it: its silhouette
        // edges are thin, its middle is deep.
        const facing = abs(vNormal.dot(V));
        const body = pow(facing, 1.6);
        const h = pw.y.div(6.9);
        const rise = smoothstep(0.0, 0.2, h).mul(float(1.0).sub(smoothstep(0.82, 1.0, h)));
        // Rain falling through the light.
        const st = uv();
        const streaks = u.noise(vec2(st.x.mul(9.0), st.y.mul(0.7).add(u.time.mul(1.9)))).r;
        const rain = smoothstep(0.42, 0.9, streaks).mul(0.9).add(0.35);
        const dist = length(pw.sub(cameraPosition));
        const fog = ndFogAmount(dist, pw.y);
        const k = body.mul(rise).mul(h.mul(0.8).add(0.25)).mul(rain).mul(float(1.0).sub(fog))
            .mul(u.neon.mul(0.55).add(0.45))
            .mul(u.rain.mul(0.6).add(0.4));
        return vec4(lampCol.mul(k).mul(0.085), 0.0);
    })();
    const cones = finish('NeonDistrictLampCones', coneGeometry, coneMaterial, 18);
    cone.dispose();
    return { posts, cones };
}

// ── Cables and lanterns ─────────────────────────────────────────────────────────

const CABLE_SEGMENTS = 14;

export function createCables(u, cables) {
    const count = cables.length;
    const positions = [];
    const indices = [];
    for (let j = 0; j <= CABLE_SEGMENTS; j++) {
        const t = j / CABLE_SEGMENTS;
        positions.push(t, -1, 0, t, 1, 0);
        if (j < CABLE_SEGMENTS) {
            const a = j * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const aA = new Float32Array(count * 4);
    const aB = new Float32Array(count * 4);
    cables.forEach((c, i) => {
        aA.set([-STREET.halfStreet, c.y0, c.z0, c.sag], i * 4);
        aB.set([STREET.halfStreet, c.y1, c.z1, 0], i * 4);
    });
    geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(aA, 4));
    geometry.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
    geometry.instanceCount = count;
    const A = attribute('aA', 'vec4');
    const B = attribute('aB', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'NeonDistrictCables';
    material.fog = false;
    // The whole cable wraps as one (from its midpoint), so it never tears across the seam.
    const mid = A.z.add(B.z).mul(0.5);
    const shift = ndWrapZ(mid.add(u.scroll)).sub(mid);
    const curve = (t) => {
        const p = mix(A.xyz, B.xyz, t);
        return vec3(p.x, p.y.sub(A.w.mul(4.0).mul(t).mul(float(1.0).sub(t))), p.z.add(shift));
    };
    const t = positionGeometry.x;
    const p0 = curve(t);
    const c0 = viewProjection(p0);
    const c1 = viewProjection(curve(t.add(0.02)));
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(c0.w, 0.3));
    const widthPx = max(float(0.022).mul(pxPerMetre), 0.75);
    material.vertexNode = vec4(c0.xy.add(nrm.mul(positionGeometry.y.mul(widthPx)).div(half).mul(c0.w)), c0.z, c0.w);
    const vWorld = varying(p0, 'ndCableP');
    material.colorNode = Fn(() => {
        const glow = ndGlow(u, vWorld).mul(exp(max(vWorld.y.sub(3.0), 0.0).mul(-0.09)));
        return ndAtmosphere(u, vec3(0.006, 0.007, 0.01).add(glow.mul(0.012)), vWorld);
    })();
    return finish('NeonDistrictCables', geometry, material);
}

export function createLanterns(u, lanterns) {
    const count = lanterns.length;
    const aPos = new Float32Array(count * 4);
    lanterns.forEach((l, i) => aPos.set([l.x, l.y, l.z, l.seed], i * 4));
    const geometry = ndQuadGeometry(count, { aPos: [aPos, 4] });
    const pos = attribute('aPos', 'vec4');
    const material = ndFxMaterial('NeonDistrictLanterns');
    const seed = floor(pos.w.add(0.5));
    const sway = sin(u.time.mul(0.9).add(seed.mul(0.37))).mul(0.06);
    const centre = vec3(pos.x.add(sway), pos.y, ndWrapZ(pos.z.add(u.scroll)));
    // A 2.4 m card: the lantern's body in the middle, its glow in the rest.
    material.vertexNode = spriteClip(u, centre, vec2(2.4, 2.4));
    const dist = length(centre.sub(cameraPosition));
    const fog = ndFogAmount(dist, centre.y);
    const clear = ndClearLight(u, centre.z);
    const vFog = varying(fog, 'ndLanternFog');
    const vLift = varying(ndLockLight(u, centre).add(clear.rgb), 'ndLanternPulse');
    const vSeed = varying(ndHash11(seed.mul(0.71).add(3.0)), 'ndLanternSeed');
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.4);
        // Body: a paper drum 0.5 m wide, 0.62 m tall, ribbed.
        const q = vec2(p.x.div(0.25), p.y.div(0.31));
        const r = length(pow(abs(q), vec2(2.6, 2.6)));
        const body = float(1.0).sub(smoothstep(0.86, 1.0, r));
        const ribs = sin(p.y.mul(58.0)).mul(0.1).add(0.9);
        const round = float(1.0).sub(q.x.mul(q.x).mul(0.45));
        const cap = step(0.27, abs(p.y)).mul(step(abs(p.x), 0.16)).mul(step(abs(p.y), 0.35));
        const flicker = sin(u.time.mul(vSeed.mul(2.0).add(2.3)).add(vSeed.mul(40.0))).mul(0.07).add(0.93);
        const warm = mix(vec3(1.0, 0.3, 0.08), vec3(1.0, 0.52, 0.16), vSeed).mul(flicker).mul(u.neon.mul(0.7).add(0.3));
        const paper = warm.mul(ribs).mul(round).mul(2.4).add(vLift.mul(0.8));
        const clearAir = float(1.0).sub(vFog);
        const halo = exp(p.dot(p).mul(-3.2)).mul(vFog.mul(0.6).add(0.1));
        const rgb = paper.mul(body).mul(clearAir)
            .add(vec3(0.004).mul(cap).mul(clearAir))
            .add(warm.mul(halo).mul(float(1.0).sub(body)));
        const alpha = max(body, cap).mul(clearAir);
        return vec4(rgb, alpha);
    })();
    return finish('NeonDistrictLanterns', geometry, material, 22);
}

// ── Beacons ─────────────────────────────────────────────────────────────────────

export function createBeacons(u, beacons) {
    const count = beacons.length;
    const aPos = new Float32Array(count * 4);
    const aKind = new Float32Array(count * 2);
    beacons.forEach((b, i) => {
        aPos.set([b.x, b.y, b.z, b.phase], i * 4);
        aKind.set([b.scroll, i % 5 === 3 ? 1 : 0], i * 2);
    });
    const geometry = ndQuadGeometry(count, { aPos: [aPos, 4], aKind: [aKind, 2] });
    const pos = attribute('aPos', 'vec4');
    const kind = attribute('aKind', 'vec2');
    const material = ndFxMaterial('NeonDistrictBeacons');
    const z = mix(pos.z, ndWrapZ(pos.z.add(u.scroll)), kind.x);
    const centre = vec3(pos.x, pos.y, z);
    material.vertexNode = spriteClip(u, centre, vec2(1.3, 1.3), 4.0);
    const dist = length(centre.sub(cameraPosition));
    // Beacons are made to be seen through weather: the haze takes only part of them.
    const through = float(1.0).sub(ndFogAmount(dist, centre.y).mul(0.82));
    const cycle = fract(u.time.mul(0.62).add(pos.w));
    const slow = smoothstep(0.0, 0.08, cycle).mul(float(1.0).sub(smoothstep(0.3, 0.42, cycle)));
    const strobe = step(cycle, 0.035).add(step(0.12, cycle).mul(step(cycle, 0.155)));
    const red = vec3(1.0, 0.07, 0.05).mul(slow).mul(1.7);
    const white = vec3(0.8, 0.9, 1.0).mul(strobe).mul(3.2);
    const vLight = varying(mix(red, white, kind.y).mul(through), 'ndBeacon');
    material.colorNode = Fn(() => {
        const d = uv().sub(0.5).mul(2.0);
        const r2 = d.dot(d);
        const g = exp(r2.mul(-9.0)).add(exp(r2.mul(-2.4)).mul(0.16)).sub(0.014).max(0.0);
        return vec4(vLight.mul(g), 0.0);
    })();
    return finish('NeonDistrictBeacons', geometry, material, 24);
}

// ── Flying traffic ──────────────────────────────────────────────────────────────

/** Canyon lanes run z from CANYON_FAR to CANYON_NEAR; cross-town lanes x within ±CROSS_HALF. */
const CANYON_NEAR = 40;
const CANYON_FAR = -720;
const CROSS_HALF = 560;

export function createTraffic(u, count, opts = {}) {
    const rand = mulberry32(opts.seed ?? 0x7f1c);
    const aSeed = new Float32Array(count * 4);
    const aLane = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const canyon = i % 5 < 3;
        const dir = rand() < 0.5 ? -1 : 1;
        aSeed.set([rand(), rand(), rand(), rand()], i * 4);
        if (canyon) {
            // x by direction (keep right), two heights.
            const deck = rand() < 0.5 ? 0 : 1;
            aLane.set([0, dir, dir * (3.4 + rand() * 4.6), 30 + deck * 24 + rand() * 7], i * 4);
        } else {
            aLane.set([1, dir, -280 - rand() * 520, 70 + rand() * 210], i * 4);
        }
    }
    const geometry = ndQuadGeometry(count, { aSeed: [aSeed, 4], aLane: [aLane, 4] });
    const seed = attribute('aSeed', 'vec4');
    const lane = attribute('aLane', 'vec4');
    const material = ndFxMaterial('NeonDistrictTraffic');

    const cross = lane.x;
    const dir = lane.y;
    const speed = seed.y.mul(16.0).add(26.0).mul(u.power.mul(0.5).add(1.0));
    const canyonLen = CANYON_NEAR - CANYON_FAR;
    const zCanyon = fract(seed.x.add(u.time.mul(speed).mul(dir).div(canyonLen))).mul(canyonLen).add(CANYON_FAR);
    const xCross = fract(seed.x.add(u.time.mul(speed.mul(1.4)).mul(dir).div(CROSS_HALF * 2))).mul(CROSS_HALF * 2).sub(CROSS_HALF);
    const bob = sin(u.time.mul(0.7).add(seed.z.mul(40.0))).mul(0.5);
    const centre = vec3(
        mix(lane.z, xCross, cross),
        lane.w.add(bob),
        mix(zCanyon, lane.z, cross),
    );
    // Coming toward the camera: white. Going away: red. Cross-town: whichever side we see.
    const coming = mix(step(0.0, dir), step(0.5, seed.w), cross);
    const tint = mix(vec3(1.0, 0.12, 0.06), vec3(0.72, 0.86, 1.0), coming);
    const clip = viewProjection(centre);
    const half = u.viewport.mul(0.5);
    const pxPerMetre = u.viewport.y.mul(0.9).div(max(clip.w, 0.3));
    // A vehicle is a short streak along its travel: sideways for cross-town, a dot down the canyon.
    const sizePx = max(vec2(mix(float(2.2), float(7.0), cross), 1.5).mul(pxPerMetre), vec2(mix(float(2.4), float(5.5), cross), 2.2));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(sizePx).div(half).mul(clip.w)), clip.z, clip.w);
    const dist = length(centre.sub(cameraPosition));
    const through = float(1.0).sub(ndFogAmount(dist, centre.y).mul(0.9));
    const ends = mix(
        smoothstep(CANYON_FAR, CANYON_FAR + 90, centre.z).mul(smoothstep(CANYON_NEAR, CANYON_NEAR - 14, centre.z)),
        smoothstep(CROSS_HALF, CROSS_HALF - 80, abs(centre.x)),
        cross,
    );
    const blink = step(fract(u.time.mul(1.1).add(seed.z)), 0.9).mul(0.5).add(0.5);
    const vLight = varying(tint.mul(through).mul(ends).mul(blink).mul(u.neon.mul(0.4).add(0.6)), 'ndTraffic');
    material.colorNode = Fn(() => {
        const d = uv().sub(0.5).mul(2.0);
        const g = exp(d.x.mul(d.x).mul(-4.5)).mul(exp(d.y.mul(d.y).mul(-7.0)));
        const core = exp(d.dot(d).mul(-26.0));
        return vec4(vLight.mul(g.mul(1.5).add(core.mul(3.4)).sub(0.02).max(0.0)), 0.0);
    })();
    return finish('NeonDistrictTraffic', geometry, material, 23);
}
