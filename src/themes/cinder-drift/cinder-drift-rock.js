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
    fwidth,
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
    SKYLIGHT, STREAM_SLOTS, TAU, cdAtmosphere, cdClear, cdCurtain, cdGlowGain, cdHash11, cdHash21, cdHeatColor, cdPart, cdRings,
} from './cinder-drift-tsl.js';
import { COLUMN_STRIDE, packColumns, roofOpening } from './cinder-drift-layout.js';

/** The unit prism: radius 1, y from 0 (root) to 1 (free end), six flat sides and a cap. */
function prismGeometry(bevel) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const index = [];
    const bands = bevel ? 2 : 1;
    for (let k = 0; k < 6; k++) {
        const a0 = (k / 6) * TAU;
        const a1 = ((k + 1) / 6) * TAU;
        const am = (a0 + a1) * 0.5;
        // The shoulder marks the beginning of the broken face; the vertex shader sizes the
        // chip in metres so a forty-metre column has the same kind of fracture as a boulder.
        for (let band = 0; band < bands; band++) {
            const base = positions.length / 3;
            const low = band / bands;
            const high = (band + 1) / bands;
            positions.push(Math.cos(a0), low, Math.sin(a0), Math.cos(a1), low, Math.sin(a1));
            positions.push(Math.cos(a1), high, Math.sin(a1), Math.cos(a0), high, Math.sin(a0));
            for (let v = 0; v < 4; v++) normals.push(Math.cos(am), band * 0.5, Math.sin(am));
            uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
            index.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
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
 * @param {boolean} bevel  cut an extra row of facets into each column's shoulder
 */
export function createColumns(u, plan, bevel = true) {
    const prism = prismGeometry(bevel);
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
    const corner = positionGeometry.x.mul(cr).sub(positionGeometry.z.mul(sr));
    const crossCorner = positionGeometry.x.mul(sr).add(positionGeometry.z.mul(cr));
    const tiltAngle = shape.z.mul(TAU * 3.7);
    const lean = vec2(cos(tiltAngle), sin(tiltAngle));
    const tilt = lean.mul(shape.z.mul(0.42).add(0.1));
    const down = shape.w.mul(-2.0).add(1.0); // +1 standing, −1 hanging
    const isCap = step(1.5, uv().y);
    const ringHeight = positionGeometry.y;
    const rimVertex = step(0.8, ringHeight);
    const forward = dot(vec2(corner, crossCorner), lean);
    const fractured = smoothstep(-0.45, 0.88, forward).mul(shape.z.mul(0.73).add(0.27));
    const cornerRadius = shape.x.mul(corner.mul(crossCorner).mul(0.22).add(1.0))
        .mul(float(1.0).sub(fractured.mul(bevel ? 0.57 : 0.18).add(0.065).mul(rimVertex)));
    const offset = lean.mul(shape.x).mul(shape.z.mul(0.52).sub(0.2)).mul(step(0.25, ringHeight));
    const lx = corner.mul(cornerRadius).add(offset.x);
    const lz = crossCorner.mul(cornerRadius).add(offset.y);
    const dish = isCap.mul(float(1.0).sub(uv().x)).mul(shape.x).mul(0.11);
    const free = col.w.add(lx.mul(tilt.x).add(lz.mul(tilt.y)).mul(0.9)).sub(dish.mul(down));
    const chipDepth = min(col.w.sub(col.z).abs().mul(0.48), shape.x.mul(fractured.mul(1.36).add(0.21)));
    // A single side band must stay broad at its end. Lower one side of its cap instead of
    // tapering the full length of a tall column into the silhouette of a spike.
    const shoulderY = bevel
        ? free.sub(chipDepth.mul(down).mul(float(1.0).sub(rimVertex)))
        : free.sub(chipDepth.mul(0.38).mul(down));
    material.positionNode = vec3(col.x.add(lx), mix(col.z, shoulderY, step(0.25, ringHeight)), col.y.add(lz));

    const sideNormal = attribute('normal', 'vec3');
    const nSide = vec3(sideNormal.x.mul(cr).sub(sideNormal.z.mul(sr)), sideNormal.y.mul(down), sideNormal.x.mul(sr).add(sideNormal.z.mul(cr)));
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
        const actual = normalize(cross(dFdx(p), dFdy(p)));
        const oriented = actual.mul(dot(actual, vNormal).sign());
        const flat = normalize(mix(vNormal, oriented, 0.79));
        const roll = vFace.x.sub(0.5).mul(2.0);
        // (Only a little: basalt breaks into flat faces with sharp arrises.)
        const N = normalize(flat.add(vec3(flat.z.negate(), 0.0, flat.x).mul(roll.mul(roll.abs()).mul(0.07)).mul(float(1.0).sub(cap)))).toVar();
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
        const weather = u.noise(vec2(p.x.add(p.z).mul(0.19), p.y.mul(0.11).add(p.x.sub(p.z).mul(0.07)))).rg.toVar();
        const along = p.y.div(pieceLength).add(cdHash11(seed).mul(7.0))
            .add(vFace.x.mul(cdHash11(seed.add(9.0)).sub(0.5)).mul(0.7)).add(weather.g.sub(0.5).mul(0.21));
        const piece = cdHash11(floor(along).add(seed.mul(1.7)));
        const jf = fract(along);
        const joint = float(1.0).sub(smoothstep(0.0, 0.022, min(jf, float(1.0).sub(jf)).mul(pieceLength)))
            .mul(float(1.0).sub(cap));
        // The dark between two columns (a narrow seam, not a rounded face), the chipped bright edge
        // beside it, and the dished heart of a cap.
        const edgeK = across.div(radius);
        const crevice = float(1.0).sub(smoothstep(0.0, 0.05, edgeK));
        const chip = smoothstep(0.03, 0.07, edgeK).mul(float(1.0).sub(smoothstep(0.07, 0.13, edgeK))).mul(float(1.0).sub(cap));
        const streaks = u.noise(vec2(p.x.add(p.z).mul(0.9), p.y.mul(0.045))).b;
        // Close up, basalt is rough: a fine grain, and the pits gas bubbles left in it.
        const faceU = p.x.mul(N.z).sub(p.z.mul(N.x));
        const nearby = float(1.0).sub(smoothstep(38.0, 138.0, length(rel)));
        const grainFine = u.noise(vec2(faceU.mul(1.05), p.y.mul(1.48)).add(seed.mul(0.013))).r.sub(0.5).mul(nearby);
        const pits = smoothstep(0.74, 0.86, u.noise(vec2(faceU.mul(7.0), p.y.mul(7.0)).add(seed.mul(0.029))).g).mul(nearby);
        // Rust weathering groups neighbouring faces. The rest is fresh, blue-grey fracture.
        const iron = smoothstep(0.34, 0.74, weather.r.mul(0.65).add(piece.mul(0.35)));
        const stone = u.rock.mul(mix(vec3(0.67, 0.80, 1.04), vec3(1.12, 0.75, 0.63), iron));
        const albedo = stone.mul(piece.mul(0.58).add(0.78)).mul(weather.r.mul(0.92).add(0.53)).mul(streaks.mul(0.8).add(0.63))
            .mul(grainFine.mul(1.22).add(1.0))
            .mul(float(1.0).sub(pits.mul(0.4)))
            .mul(float(1.0).sub(joint.mul(0.82)))
            .mul(float(1.0).sub(crevice.mul(mix(float(0.75), float(0.25), cap))))
            .mul(chip.mul(0.6).add(1.0))
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
        // Steep: the lava lights the feet of the cliffs and leaves the roof to the dark.
        const falloff = exp(h.div(-7.0)).mul(0.94).add(float(0.06).div(h.div(22.0).add(1.0)));
        const seen = mix(smoothstep(vLit.x.sub(0.5), vLit.x.add(1.6), p.y), float(1.0), hang);
        // The lava out in front of this face: what the lake remembers there, and the fall.
        const out = p.xz.add(openDir.mul(5.0));
        const toFall = length(out.sub(u.fallFoot.xz));
        const lakeHeat = float(0.5).add(u.memory(u.plateSpace(out)).mul(1.1))
            .add(exp(toFall.div(-30.0)).mul(0.9).mul(u.fallGain))
            .add(afterglow.mul(0.6))
            .mul(cdGlowGain(u));
        // Hot and orange just over the lava, deep red as it climbs.
        const lakeCol = mix(u.mid.mul(0.86).add(u.hot.mul(0.14)), u.deep.mul(1.2).add(u.mid.mul(0.18)), smoothstep(1.5, 16.0, h));
        const lake = lakeCol.mul(lakeHeat).mul(under).mul(facing.mul(0.8).add(0.2)).mul(falloff)
            .mul(seen)
            .mul(arris.mul(0.9).add(1.0))
            .mul(2.4);
        // Basalt is glassy: a face that looks down at the lava mirrors its glow.
        const Rl = reflect(V.negate(), N);
        const toLava = smoothstep(-0.05, -0.55, Rl.y);
        const glance = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
        const g2 = glance.mul(glance);
        const sheen = lakeCol.mul(lakeHeat).mul(toLava).mul(g2.mul(g2).mul(0.55).add(0.05)).mul(falloff.mul(0.85).add(0.15))
            .mul(seen)
            .mul(arris.mul(1.5).add(1.0))
            .mul(float(1.0).sub(cap.mul(0.7)));

        // ── The great fall ──
        const toKey = u.fallPos.sub(p);
        const keyDist2 = dot(toKey, toKey);
        const L = toKey.div(keyDist2.sqrt()).toVar();
        const lambert = max(dot(N, L).add(0.12), 0.0).div(1.12);
        const keyShadow = mix(smoothstep(vLit.y.sub(0.5), vLit.y.add(2.2), p.y), float(1.0), hang);
        const keyCol = u.mid.mul(0.78).add(u.hot.mul(0.22)).mul(u.fallGain).mul(u.breath);
        // Close to an inverse square: the fall lights its own corner, not the whole chamber.
        const keyReach = float(2000.0).div(keyDist2.add(250.0));
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
        const skyDir = u.skyTop.sub(p);
        const skyDist = max(length(skyDir), 0.01);
        // The opening also rakes the broken sides facing it, outside the air shaft's footprint.
        const blueBounce = max(dot(N, skyDir.div(skyDist)), 0.0)
            .mul(float(1.0).div(skyDist.mul(0.016).add(1.0))).mul(0.82);
        const night = u.cool.mul(spot.mul(max(dot(N, axis.negate()), 0.0)).mul(3.0)
            .add(blueBounce).add(up.mul(up).mul(0.18)));

        // ── A four-line clear's shock, running out through the rock ──
        const shockAge = max(u.time.sub(u.shock.x), 0.0);
        const shockAt = length(p.sub(vec3(u.heart.x, 0.0, u.heart.y))).sub(shockAge.mul(150.0));
        const shock = exp(shockAt.mul(shockAt).div(-260.0)).mul(exp(shockAge.div(-1.1))).mul(u.shock.y)
            .mul(step(0.0, u.time.sub(u.shock.x)));

        const ao = vLit.z;
        const openFace = max(dot(N, vec3(-0.63, -0.55, 0.55)), 0.0);
        const bounced = mix(u.mid, u.hot, 0.29).mul(openFace.mul(openFace))
            .mul(exp(h.div(-22.0)).mul(1.25).add(0.21)).mul(seen.mul(0.67).add(0.33));
        const rake = max(dot(N, vec3(0.64, 0.51, 0.57)), 0.0);
        const exfoliated = smoothstep(0.42, 0.70, weather.g.add(grainFine.mul(0.63)));
        const slate = vec3(0.25, 0.29, 0.36).mul(rake.mul(0.84).add(0.20))
            .mul(exfoliated.mul(1.05).add(0.42)).mul(ao);
        const light = lake.add(key).add(bounced).add(slate).add(night.mul(ao))
            .add(cdCurtain(u, p, N))
            .add(ringFlash.mul(2.6))
            .add(ringPass.add(wave).mul(under.mul(1.2).add(0.2)).mul(exp(h.div(-6.0))).mul(1.4))
            .add(u.hot.mul(shock.mul(1.2)));

        // ── The seams fill with light ──
        const seam = float(1.0).sub(smoothstep(0.0, 0.05, across)).mul(float(1.0).sub(cap)).toVar();
        // Lava rises between the columns with the chamber's pressure.
        const level = u.power.mul(4.5).add(u.surge.mul(3.5)).add(afterglow.mul(2.0)).add(u.rise);
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

        const splinter = smoothstep(0.0, 0.023, jf).mul(float(1.0).sub(smoothstep(0.023, 0.073, jf)))
            .mul(float(1.0).sub(cap)).mul(exfoliated)
            .mul(rake.add(openFace))
            .mul(nearby);
        const litRock = albedo.mul(light).add(emission).add(sheen.mul(0.08))
            .add(vec3(0.041, 0.031, 0.028).mul(splinter))
            .toVar();
        const pulseAge = u.time.sub(u.bankPulse.x);
        If(u.bankPulse.y.greaterThan(0.0).and(pulseAge.greaterThanEqual(0.0)).and(pulseAge.lessThan(4.5)), () => {
            // A packet climbs each vertical joint and crosses into the next column through
            // its own transverse breaks. The hot tip leaves a low red trail in the stone.
            const bankX = p.x.mul(u.bankPulse.z);
            const bank = smoothstep(3.0, 13.0, bankX)
                .mul(mix(float(1.0), smoothstep(21.0, 39.0, bankX), hang));
            const arrival = max(p.z.negate().sub(11.0), 0.0).mul(0.0175)
                .add(h.mul(0.052)).add(max(bankX.sub(15.0), 0.0).mul(0.013))
                .add(weather.r.mul(0.072));
            const local = pulseAge.sub(arrival).toVar();
            const hotTip = float(1.0).sub(smoothstep(0.035, 0.18, local.sub(0.12).abs()));
            const cooling = smoothstep(-0.055, 0.12, local).mul(exp(max(local.sub(0.12), 0.0).mul(-2.1)));
            const crossGap = min(jf, float(1.0).sub(jf)).mul(pieceLength);
            const width = max(fwidth(across).mul(0.72), 0.061);
            const gap = min(across, crossGap.add(float(1.0).sub(exfoliated).mul(0.055)));
            const whiteLine = float(1.0).sub(smoothstep(width.mul(0.32), width.mul(1.55), gap));
            const bankGlow = exp(gap.div(-0.23)).mul(cooling);
            const vermilion = mix(vec3(1.0, 0.052, 0.012), u.mid, 0.24);
            const gain = bank.mul(float(1.0).sub(smoothstep(3.7, 4.5, pulseAge))).mul(u.bankPulse.y)
                .mul(float(1.0).sub(cap.mul(0.88)));
            litRock.addAssign(cdHeatColor(u, float(0.77).add(hotTip.mul(0.71)))
                .mul(whiteLine.mul(hotTip).mul(1.45)).add(vermilion.mul(bankGlow.mul(1.14)))
                .mul(gain));
        });
        return cdAtmosphere(u, litRock, p);
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
    const positions = [];
    const surfaces = [];
    const opening = [];
    const mainBreach = (x, z) => Math.abs(x - SKYLIGHT.top[0]) < 21 && Math.abs(z - SKYLIGHT.top[2]) < 29;
    const put = (x, y, z, surface = 0) => {
        positions.push(x, y, z);
        surfaces.push(surface);
        return surfaces.length - 1;
    };
    const roofPoint = (x, y, z) => {
        const near = mainBreach(x, z);
        const chips = near ? 0.045 * Math.sin(x * 1.43 + z * 1.21) + 0.030 * Math.sin(z * 2.35 - x * 0.93) : 0;
        const distance = roofOpening(x, z) + chips;
        const apron = near ? 0.53 * Math.max(0, 1 - Math.abs(distance) / 0.71) : 0;
        const i = put(x, y, z, apron);
        opening[i] = distance;
        return i;
    };
    for (let j = 0; j <= nz; j++) {
        for (let i = 0; i <= nx; i++) {
            const x = x0 + ((x1 - x0) * i) / nx;
            const z = z0 + ((z1 - z0) * j) / nz;
            const rough = Math.sin(x * 0.61 + z * 0.37) * Math.cos(z * 0.53 - x * 0.29);
            const roof = plan.ceilingAt(x, z) + 1.6 + rough * 1.4;
            const dw = plan.wallDepth(x, z);
            const y = dw > 2.2 ? Math.max(-3, roof - (dw - 2.2) * 9) : roof;
            const px = x + rough * 0.8;
            const pz = z - rough * 0.8;
            roofPoint(px, y, pz);
        }
    }
    const index = [];
    // Clip just the triangles that meet a breach. Their cut edges turn upwards into a dark
    // lip, so perspective reveals the thickness of the roof against the distant sky.
    const cut = (a, b, c) => {
        if (opening[a] >= 0 && opening[b] >= 0 && opening[c] >= 0) {
            index.push(a, b, c);
            return;
        }
        const face = [];
        const lip = [];
        let prev = c;
        for (const next of [a, b, c]) {
            if ((opening[next] >= 0) !== (opening[prev] >= 0)) {
                const k = opening[prev] / (opening[prev] - opening[next]);
                const from = prev * 3;
                const at = (axis) => positions[from + axis] * (1 - k) + positions[next * 3 + axis] * k;
                const x = at(0);
                const y = at(1);
                const z = at(2);
                if (mainBreach(x, z)) {
                    // Broken plates expose three planes. The lowest tooth is shared with the
                    // ceiling, while the back of the fracture sees the exterior light.
                    const tooth = Math.max(0, Math.sin(x * 1.13 + z * 0.64) + 0.45 * Math.sin(z * 1.56 - x * 0.80));
                    const tornY = y - 0.32 - 1.35 * tooth;
                    const dx = SKYLIGHT.top[0] - x;
                    const dz = SKYLIGHT.top[2] - z;
                    const inset = (0.38 + tooth * 0.60) / Math.max(Math.hypot(dx, dz), 1);
                    face.push(put(x, tornY, z, 0.59));
                    lip.push(
                        put(x, tornY, z, 0.72),
                        put(x + dx * inset + 0.3, y + 1.06, z + dz * inset - 0.5, 0.98),
                        put(x + 1.03, y + 3.46 + Math.sin(x * 0.63 + z * 0.34), z - 2.7, 1.22),
                    );
                } else {
                    const lower = put(x, y, z);
                    face.push(lower);
                    lip.push(lower, put(x + 0.5, y + 2.1 + Math.sin(x * 0.4 + z * 0.3) * 0.7, z - 1.2, 1));
                }
            }
            if (opening[next] >= 0) face.push(next);
            prev = next;
        }
        for (let n = 1; n < face.length - 1; n++) index.push(face[0], face[n], face[n + 1]);
        const layers = lip.length / 2;
        for (let n = 0; n < layers - 1; n++) {
            index.push(lip[n], lip[n + 1], lip[n + layers], lip[n + 1], lip[n + 1 + layers], lip[n + layers]);
        }
    };
    const midpoint = (a, b) => roofPoint(
        (positions[a * 3] + positions[b * 3]) * 0.5,
        (positions[a * 3 + 1] + positions[b * 3 + 1]) * 0.5,
        (positions[a * 3 + 2] + positions[b * 3 + 2]) * 0.5,
    );
    // Subdivide only at the fault. Midpoints stay on the original facets where this small
    // patch meets the coarse roof; the silhouette gains ~1 m chips without a denser chamber.
    const refine = (a, b, c, depth = 2) => {
        const atRim = depth > 0 && mainBreach(positions[a * 3], positions[a * 3 + 2])
            && Math.min(opening[a], opening[b], opening[c]) < 0.86
            && Math.max(opening[a], opening[b], opening[c]) > -0.58;
        if (!atRim) {
            cut(a, b, c);
            return;
        }
        const ab = midpoint(a, b);
        const bc = midpoint(b, c);
        const ca = midpoint(c, a);
        refine(a, ab, ca, depth - 1);
        refine(ab, b, bc, depth - 1);
        refine(ca, bc, c, depth - 1);
        refine(ab, bc, ca, depth - 1);
    };
    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            const a = j * (nx + 1) + i;
            const b = a + 1;
            const c = a + nx + 1;
            const d = c + 1;
            if ((i + j) % 2) {
                refine(a, b, d);
                refine(a, d, c);
            } else {
                refine(a, b, c);
                refine(b, d, c);
            }
        }
    }
    const sky = put(-370, 105, -510, 2);
    put(370, 105, -510, 2);
    put(370, 105, 36, 2);
    put(-370, 105, 36, 2);
    index.push(sky, sky + 1, sky + 2, sky, sky + 2, sky + 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aSurface', new THREE.Float32BufferAttribute(surfaces, 1));
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
        const weather = u.noise(p.xz.mul(0.032)).rg.toVar();
        const eroded = smoothstep(0.36, 0.68, weather.r.add(N.z.mul(0.16)));
        const albedo = u.rock.mul(mix(vec3(0.63, 0.81, 1.02), vec3(1.15, 0.86, 0.77), eroded))
            .mul(weather.g.mul(0.94).add(0.48));
        // The same steep reach as on the columns: the dark mass behind them stays dark overhead.
        const lakeFall = exp(h.div(-8.0)).mul(0.9).add(float(0.07).div(h.div(22.0).add(1.0)));
        const lake = mix(u.mid.mul(0.86).add(u.hot.mul(0.14)), u.deep.mul(1.2).add(u.mid.mul(0.18)), smoothstep(1.5, 16.0, h))
            .mul(under.mul(0.8).add(0.2)).mul(lakeFall)
            .mul(cdGlowGain(u));
        const toKey = u.fallPos.sub(p);
        const keyDist2 = dot(toKey, toKey);
        const key = u.mid.mul(0.78).add(u.hot.mul(0.22)).mul(u.fallGain).mul(u.breath)
            .mul(float(2000.0).div(keyDist2.add(250.0)))
            .mul(max(dot(N, toKey.div(keyDist2.sqrt())), 0.0));
        const hole = length(p.xz.sub(u.skyTop.xz));
        const surface = attribute('aSurface', 'float');
        const night = u.cool.mul(exp(hole.div(-27.0))).mul(smoothstep(22.0, 36.0, p.y))
            .mul(N.x.mul(-0.32).add(0.68)).mul(surface.min(1.0).mul(0.14).add(0.065));
        const stone = albedo.mul(lake.add(key)).add(night).toVar();
        If(surface.greaterThan(0.025).and(surface.lessThan(1.5)).and(p.z.lessThan(-65.0)), () => {
            const bed = u.noise(vec2(p.x.mul(0.115).add(p.z.mul(0.057)), p.y.mul(0.31).sub(p.z.mul(0.082)))).level(1).rg;
            const cutFace = smoothstep(0.56, 1.12, surface);
            const rake = max(dot(N, vec3(-0.59, 0.20, 0.78)), 0.0).mul(0.87).add(0.20);
            const split = smoothstep(0.10, 0.43, fract(p.y.mul(0.72).add(p.x.mul(0.08)).add(bed.r.mul(1.8))));
            const weathered = mix(vec3(0.069, 0.095, 0.14), vec3(0.19, 0.28, 0.39), bed.g);
            stone.addAssign(weathered.mul(rake).mul(split.mul(0.57).add(0.43))
                .mul(surface.mul(surface)).mul(cutFace.mul(0.66).add(0.64)));
        });
        const result = cdAtmosphere(u, stone, p).toVar();
        If(surface.greaterThan(1.5), () => {
            // The clouds belong to the exterior, so a camera sway uncovers them behind the lip.
            const sight = V.xy.div(min(V.z.negate(), -0.2)).toVar();
            const drift = u.flow.mul(0.0017);
            const bank = u.noise(sight.mul(vec2(1.7, 5.6)).add(vec2(drift, 0.16))).level(1).rg.toVar();
            const cloud = smoothstep(0.32, 0.72, bank.r.mul(0.74).add(bank.g.mul(0.26)));
            const blue = mix(vec3(0.14, 0.29, 0.50), vec3(0.027, 0.074, 0.17), smoothstep(0.29, 0.63, sight.y));
            const moonDist = length(sight.sub(vec2(0.403, 0.423))).toVar();
            const moon = float(1.0).sub(smoothstep(0.010, 0.013, moonDist));
            const halo = exp(moonDist.div(-0.055));
            const starGrid = sight.mul(80.0).add(127.0).toVar();
            const cell = floor(starGrid);
            const starDist = length(fract(starGrid).sub(vec2(cdHash21(cell), cdHash21(cell.add(13.0))).mul(0.62).add(0.19)));
            const star = float(1.0).sub(smoothstep(0.024, max(fwidth(starGrid.x), 0.08), starDist))
                .mul(smoothstep(0.90, 0.99, cdHash21(cell.add(37.0))));
            const clear = blue.add(vec3(0.54, 0.76, 0.90).mul(moon.mul(1.2).add(halo.mul(0.24)).add(star.mul(0.72))));
            const overcast = vec3(0.024, 0.063, 0.12).add(vec3(0.14, 0.21, 0.28).mul(bank.g));
            const far = sin(sight.x.mul(74.0)).mul(0.009).add(sin(sight.x.mul(177.0)).mul(0.004))
                .add(sin(sight.x.mul(31.0)).abs().mul(0.028))
                .add(0.365);
            const near = sin(sight.x.mul(58.0).add(0.7)).mul(0.014).add(sin(sight.x.mul(151.0)).mul(0.005))
                .add(sin(sight.x.mul(23.0)).abs().mul(0.014))
                .add(0.339);
            const openSky = mix(clear, overcast, cloud.mul(0.91));
            const range = mix(vec3(0.062, 0.115, 0.193), openSky, smoothstep(far.sub(0.0015), far.add(0.0015), sight.y));
            result.assign(mix(vec3(0.021, 0.046, 0.092), range, smoothstep(near.sub(0.0015), near.add(0.0015), sight.y)));
        });
        return result;
    })();
    return cdPart('CinderShell', geometry, material, 3);
}
