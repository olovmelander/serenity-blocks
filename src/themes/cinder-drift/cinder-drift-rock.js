/**
 * Cinder Drift — the rock: columnar basalt and the shell of the chamber behind it.
 *
 * Every column is one instance of a six-sided prism rooted under the lake (or in the roof, for
 * the organ pipes that hang from it) with a tilted, broken cap. Nothing is lit by a light: a
 * column shades itself from
 *
 *   the lake    its glow from below, on the sides that face the open lava, above whatever
 *               stands in front (a height the plan worked out per column), brighter where the
 *               lake remembers a lock, and as a clear's wave passes its foot;
 *   the fall    a point of light a third of the way up the cascade, shadowed the same way;
 *   the night   a cold spot under the hole in the roof, and a breath of it on every cap;
 *   the board   the flash of a lock where it struck, and a four-line clear's shock;
 *   itself      the seams between columns fill with light: lava rises in them with the
 *               chamber's pressure, and veins spread from every fissure a chain of clears opens.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dFdx,
    dFdy,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    reflect,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import {
    STREAM_SLOTS, TAU, cdAtmosphere, cdClear, cdCurtain, cdGlowGain, cdHash11, cdHeatColor, cdPart, cdRings,
} from './cinder-drift-tsl.js';
import { COLUMN_STRIDE, packColumns } from './cinder-drift-layout.js';

/** The unit prism: radius 1, y from 0 (root) to 1 (free end), six flat sides and a cap. */
function prismGeometry() {
    const positions = [];
    const normals = [];
    const uvs = [];
    const index = [];
    for (let k = 0; k < 6; k++) {
        const a0 = (k / 6) * TAU;
        const a1 = ((k + 1) / 6) * TAU;
        const am = (a0 + a1) * 0.5;
        const base = positions.length / 3;
        positions.push(
            Math.cos(a0),
            0,
            Math.sin(a0),
            Math.cos(a1),
            0,
            Math.sin(a1),
            Math.cos(a1),
            1,
            Math.sin(a1),
            Math.cos(a0),
            1,
            Math.sin(a0),
        );
        for (let v = 0; v < 4; v++) normals.push(Math.cos(am), 0, Math.sin(am));
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    // The cap: uv.y = 2 marks it, uv.x runs from its heart (0) to its rim (1).
    const centre = positions.length / 3;
    positions.push(0, 1, 0);
    normals.push(0, 1, 0);
    uvs.push(0, 2);
    for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        positions.push(Math.cos(a), 1, Math.sin(a));
        normals.push(0, 1, 0);
        uvs.push(1, 2);
    }
    for (let k = 0; k < 6; k++) index.push(centre, centre + 1 + ((k + 1) % 6), centre + 1 + k);
    return {
        positions, normals, uvs, index,
    };
}

/**
 * @param {object} u     shared uniforms
 * @param {object} plan  the chamber's plan
 */
export function createColumns(u, plan) {
    const prism = prismGeometry();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(prism.index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(prism.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(prism.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(prism.uvs, 2));
    // One interleaved buffer for everything per column (WebGPU binds at most eight).
    const packed = new THREE.InstancedInterleavedBuffer(packColumns(plan), COLUMN_STRIDE);
    geometry.setAttribute('aCol', new THREE.InterleavedBufferAttribute(packed, 4, 0));
    geometry.setAttribute('aShape', new THREE.InterleavedBufferAttribute(packed, 4, 4));
    geometry.setAttribute('aLit', new THREE.InterleavedBufferAttribute(packed, 4, 8));
    geometry.instanceCount = plan.columns.length;

    const col = attribute('aCol', 'vec4');
    const shape = attribute('aShape', 'vec4');
    const lit = attribute('aLit', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'CinderColumns';
    material.fog = false;

    // ── Vertex: stand the prism up, turn it, break its cap ──
    const cr = cos(shape.y);
    const sr = sin(shape.y);
    const lx = positionGeometry.x.mul(cr).sub(positionGeometry.z.mul(sr)).mul(shape.x);
    const lz = positionGeometry.x.mul(sr).add(positionGeometry.z.mul(cr)).mul(shape.x);
    const tiltAngle = shape.z.mul(TAU * 3.7);
    const tilt = vec2(cos(tiltAngle), sin(tiltAngle)).mul(shape.z.mul(0.34).add(0.06));
    const down = shape.w.mul(-2.0).add(1.0); // +1 standing, −1 hanging
    const isCap = step(1.5, uv().y);
    // A cap is dished: its heart sits a little lower than its rim.
    const dish = isCap.mul(float(1.0).sub(uv().x)).mul(shape.x).mul(0.11);
    const free = col.w.add(lx.mul(tilt.x).add(lz.mul(tilt.y)).mul(0.9)).sub(dish.mul(down));
    material.positionNode = vec3(col.x.add(lx), mix(col.z, free, positionGeometry.y), col.y.add(lz));

    const sideNormal = attribute('normal', 'vec3');
    const nSide = vec3(sideNormal.x.mul(cr).sub(sideNormal.z.mul(sr)), 0.0, sideNormal.x.mul(sr).add(sideNormal.z.mul(cr)));
    const nCap = normalize(vec3(tilt.x.mul(-0.9), 1.0, tilt.y.mul(-0.9))).mul(down);
    const vNormal = varying(mix(nSide, nCap, isCap), 'cdColN');
    const vFace = varying(vec3(uv().x, isCap, shape.x), 'cdColF');
    const vLit = varying(lit, 'cdColL');
    const vSeed = varying(vec2(floor(shape.z.mul(1024.0)), shape.w), 'cdColS');

    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        const cap = vFace.y;
        const radius = vFace.z;
        // A worn column is not a box: each face rolls away toward its edges.
        const flat = normalize(vNormal);
        const roll = vFace.x.sub(0.5).mul(2.0);
        const N = normalize(flat.add(vec3(flat.z.negate(), 0.0, flat.x).mul(roll.mul(roll.abs()).mul(0.6)).mul(float(1.0).sub(cap)))).toVar();
        const rel = cameraPosition.sub(p);
        const V = normalize(rel).toVar();
        const seed = floor(vSeed.x.add(0.5));
        const hang = step(0.5, vSeed.y);
        const h = max(p.y, 0.0).toVar();

        // ── The stone ──
        // Metres from the nearest arris (a side) or from the rim (a cap).
        const across = mix(min(vFace.x, float(1.0).sub(vFace.x)), float(1.0).sub(vFace.x), cap).mul(radius).toVar();
        // Columns break across at their own heights: every piece weathers a little differently.
        const pieceLength = cdHash11(seed.mul(0.37).add(3.0)).mul(1.5).add(0.8);
        const along = p.y.div(pieceLength).add(cdHash11(seed).mul(7.0));
        const piece = cdHash11(floor(along).add(seed.mul(1.7)));
        const jf = fract(along);
        const joint = float(1.0).sub(smoothstep(0.0, 0.035, min(jf, float(1.0).sub(jf)).mul(pieceLength)))
            .mul(float(1.0).sub(cap));
        const weather = u.noise(vec2(p.x.add(p.z).mul(0.19), p.y.mul(0.11).add(p.x.sub(p.z).mul(0.07)))).r;
        // The dark between two columns, and the dished heart of a cap.
        const crevice = float(1.0).sub(smoothstep(0.0, 0.17, across.div(radius)));
        const streaks = u.noise(vec2(p.x.add(p.z).mul(0.9), p.y.mul(0.045))).b;
        const albedo = u.rock.mul(piece.mul(0.8).add(0.6)).mul(weather.mul(1.0).add(0.45)).mul(streaks.mul(0.6).add(0.7))
            .mul(float(1.0).sub(joint.mul(0.7)))
            .mul(float(1.0).sub(crevice.mul(mix(float(0.6), float(0.25), cap))))
            .mul(mix(float(1.0), vFace.x.mul(0.5).add(0.6), cap));
        // The worn edge of every face catches light the flat of it does not.
        const arris = float(1.0).sub(smoothstep(0.0, 0.05, across)).toVar();

        // ── The board's light ──
        const ringFlash = vec3(0.0).toVar();
        const ringPass = vec3(0.0).toVar();
        If(u.ringsLive.greaterThan(0.5), () => {
            const rings = cdRings(u, p);
            ringFlash.assign(rings.flash);
            ringPass.assign(rings.tint);
        });
        const wave = vec3(0.0).toVar();
        const afterglow = float(0.0).toVar();
        If(u.clearLive.greaterThan(0.5), () => {
            const c = cdClear(u, p);
            wave.assign(c.xyz);
            afterglow.assign(c.w);
        });

        // ── The lake, from below ──
        const openDir = vec2(cos(vLit.w), sin(vLit.w));
        const facing = dot(N.xz, openDir).mul(0.5).add(0.5);
        // (A pipe's end faces the lake squarely, but it is small: it does not out-shine its sides.)
        const under = float(0.5).sub(N.y.mul(0.5)).mul(mix(float(1.0), float(0.62), cap));
        const falloff = exp(h.div(-9.0)).mul(0.84).add(float(0.16).div(h.div(30.0).add(1.0)));
        const seen = mix(smoothstep(vLit.x.sub(0.5), vLit.x.add(1.6), p.y), float(1.0), hang);
        // The lava out in front of this face: what the lake remembers there, and the fall.
        const out = p.xz.add(openDir.mul(5.0));
        const toFall = length(out.sub(u.fallFoot.xz));
        const lakeHeat = float(0.5).add(u.memory(u.plateSpace(out)).mul(1.1))
            .add(exp(toFall.div(-30.0)).mul(0.9).mul(u.fallGain))
            .add(afterglow.mul(0.6))
            .mul(cdGlowGain(u));
        const lakeCol = u.mid.mul(0.95).add(u.hot.mul(0.05));
        const lake = lakeCol.mul(lakeHeat).mul(under).mul(facing.mul(0.72).add(0.28)).mul(falloff)
            .mul(seen)
            .mul(1.5);

        // ── The great fall ──
        const toKey = u.fallPos.sub(p);
        const keyDist2 = dot(toKey, toKey);
        const L = toKey.div(keyDist2.sqrt()).toVar();
        const lambert = max(dot(N, L).add(0.12), 0.0).div(1.12);
        const keyShadow = mix(smoothstep(vLit.y.sub(0.5), vLit.y.add(2.2), p.y), float(1.0), hang);
        const keyCol = u.mid.mul(0.72).add(u.hot.mul(0.28)).mul(u.fallGain).mul(u.breath);
        const keyReach = float(9000.0).div(keyDist2.add(900.0));
        const R = reflect(V.negate(), N);
        const rl = clamp(dot(R, L), 0.0, 1.0);
        const rl4 = rl.mul(rl).mul(rl).mul(rl);
        const gloss = rl4.mul(rl4).mul(rl4).mul(arris.mul(1.6).add(0.25));
        const key = keyCol.mul(keyReach).mul(keyShadow).mul(lambert.add(gloss.mul(2.2)));

        // ── The night through the roof ──
        const axis = normalize(u.skyFoot.sub(u.skyTop));
        const fromTop = p.sub(u.skyTop);
        const sunk = dot(fromTop, axis);
        const off = length(fromTop.sub(axis.mul(sunk)));
        const beam = sunk.mul(0.085).add(7.0);
        const spot = float(1.0).sub(smoothstep(beam.mul(0.55), beam.mul(1.45), off));
        const up = N.y.mul(0.5).add(0.5);
        const night = u.cool.mul(spot.mul(max(dot(N, axis.negate()), 0.0)).mul(3.0).add(up.mul(up).mul(0.16)));

        // ── A four-line clear's shock, running out through the rock ──
        const shockAge = max(u.time.sub(u.shock.x), 0.0);
        const shockAt = length(p.sub(vec3(u.heart.x, 0.0, u.heart.y))).sub(shockAge.mul(150.0));
        const shock = exp(shockAt.mul(shockAt).div(-260.0)).mul(exp(shockAge.div(-1.1))).mul(u.shock.y)
            .mul(step(0.0, u.time.sub(u.shock.x)));

        const ao = vLit.z;
        const light = lake.add(key).add(night.mul(ao))
            .add(cdCurtain(u, p, N))
            .add(ringFlash.mul(2.6))
            .add(ringPass.add(wave).mul(under.mul(1.2).add(0.2)).mul(exp(h.div(-6.0))).mul(1.4))
            .add(u.hot.mul(shock.mul(1.2)));

        // ── The seams fill with light ──
        const seam = float(1.0).sub(smoothstep(0.0, 0.05, across)).mul(float(1.0).sub(cap)).toVar();
        // Lava rises between the columns with the chamber's pressure.
        const level = u.power.mul(4.5).add(u.surge.mul(3.5)).add(afterglow.mul(2.0));
        const risen = float(1.0).sub(smoothstep(level.mul(0.35), level.add(0.4), h)).mul(step(0.01, level))
            .mul(float(1.0).sub(hang));
        const veins = float(0.0).toVar();
        for (let i = 0; i < STREAM_SLOTS; i++) {
            const F = u.fissureAt[i];
            const on = clamp(u.fissures.sub(i), 0.0, 1.0);
            const d = length(p.sub(F.xyz).mul(vec3(1.0, 0.55, 1.0)));
            veins.addAssign(on.mul(exp(d.div(on.mul(9.0).add(2.0)).negate())));
        }
        // Light in a seam runs: it is never still.
        const run = u.noise(vec2(p.x.add(p.z).mul(0.31), p.y.mul(0.16).add(u.flow.mul(0.11)))).g;
        const broken = smoothstep(0.3, 0.62, run);
        const nearEnough = float(1.0).sub(smoothstep(60.0, 150.0, length(rel)));
        const fire = risen.mul(0.9).add(veins.mul(1.5)).mul(seam).mul(broken.mul(1.15).add(0.1))
            .mul(nearEnough.mul(0.85).add(0.15));
        const emission = cdHeatColor(u, fire.mul(1.05).add(0.22)).mul(clamp(fire, 0.0, 1.0)).mul(u.breath);

        return cdAtmosphere(u, albedo.mul(light).add(emission), p);
    })();

    const part = cdPart('CinderColumns', geometry, material, 0);
    part.count = plan.columns.length;
    return part;
}

/**
 * The shell: the roof, and the mass of rock that closes behind the cliffs, as one coarse sheet
 * cut into facets. Mostly it is the dark the columns stand against.
 * @param {object} u
 * @param {object} plan
 */
export function createShell(u, plan) {
    const x0 = -112;
    const x1 = 112;
    const z0 = -268;
    const z1 = 24;
    const step5 = 5.5;
    const nx = Math.ceil((x1 - x0) / step5);
    const nz = Math.ceil((z1 - z0) / step5);
    const positions = new Float32Array((nx + 1) * (nz + 1) * 3);
    for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
            const x = x0 + ((x1 - x0) * i) / nx;
            const z = z0 + ((z1 - z0) * j) / nz;
            const rough = Math.sin(x * 0.61 + z * 0.37) * Math.cos(z * 0.53 - x * 0.29);
            const roof = plan.ceilingAt(x, z) + 1.6 + rough * 1.4;
            const dw = plan.wallDepth(x, z);
            const y = dw > 2.2 ? Math.max(-3, roof - (dw - 2.2) * 9) : roof;
            positions.set([x + rough * 0.8, y, z - rough * 0.8], (j * (nx + 1) + i) * 3);
        }
    }
    const index = [];
    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            const a = j * (nx + 1) + i;
            const b = a + 1;
            const c = a + nx + 1;
            const d = c + 1;
            if ((i + j) % 2) index.push(a, b, d, a, d, c);
            else index.push(a, b, c, b, d, c);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(index);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'CinderShell';
    material.fog = false;
    material.colorNode = Fn(() => {
        const p = positionWorld.toVar();
        // Cut like rock: the facet's own normal, turned to face whoever is looking.
        const facet = normalize(cross(dFdx(p), dFdy(p)));
        const V = normalize(cameraPosition.sub(p));
        const N = facet.mul(dot(facet, V).sign()).toVar();
        const h = max(p.y, 0.0);
        const under = float(0.5).sub(N.y.mul(0.5));
        const weather = u.noise(p.xz.mul(0.043)).r;
        const albedo = u.rock.mul(weather.mul(0.8).add(0.5));
        const lake = u.mid.mul(0.86).add(u.hot.mul(0.14)).mul(under).mul(float(0.9).div(h.div(30.0).add(1.0)))
            .mul(cdGlowGain(u));
        const toKey = u.fallPos.sub(p);
        const keyDist2 = dot(toKey, toKey);
        const key = u.mid.mul(0.72).add(u.hot.mul(0.28)).mul(u.fallGain).mul(u.breath)
            .mul(float(9000.0).div(keyDist2.add(900.0)))
            .mul(max(dot(N, toKey.div(keyDist2.sqrt())), 0.0));
        // The hole in the roof: the night itself, and its light on the lip.
        const hole = length(p.xz.sub(u.skyTop.xz));
        const night = u.cool.mul(float(1.0).sub(smoothstep(3.0, 8.0, hole))).mul(smoothstep(30.0, 38.0, p.y)).mul(0.9);
        return cdAtmosphere(u, albedo.mul(lake.add(key)).add(night), p);
    })();
    return cdPart('CinderShell', geometry, material, 3);
}
