/**
 * Halcyon Apex — everything built of stone, and the ley lines inlaid in it.
 *
 * The plan lists the masonry as flat triangles with their own baked occlusion; this module wraps
 * them and shades them. Nothing here is lit by a light: sandstone gathers the sun where the one
 * shadow map says it arrives, the sky from the side each face looks at, and the lagoon's bounce
 * on everything that leans over the water — a turquoise light that ripples up the lowest walls.
 * Courses, slabs and joints are drawn from each face's own metres, so every block is a block.
 *
 * The masonry casts the sanctuary's shadows, so its shading is a `fragmentNode` (a caster's
 * colour graph also runs in the shadow pass, where it may not read the map it is drawing).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    mod,
    normalWorld,
    normalize,
    positionWorld,
    reflect,
    sin,
    smoothstep,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    LEY_A,
    SITE,
    haAtmosphere,
    haBell,
    haClearLight,
    haFresnel,
    haHash21,
    haLockLight,
    haPart,
    haPulseLight,
    haSkyBase,
    haSkyLight,
} from './halcyon-apex-tsl.js';

/** Per stone kind: how its colour departs from the palette's sandstone. */
const KIND_TINT = [
    [1.0, 1.0, 1.0], // wall
    [1.14, 1.11, 1.05], // paving
    [1.46, 1.42, 1.34], // trim
    [2.2, 1.5, 0.52], // gold
    [0.7, 0.71, 0.68], // footing
    [0.56, 0.64, 0.74], // monolith
];
/** Per stone kind: (course height, block length, how dark its joints are, metal 0..1). */
const KIND_PATTERN = [
    [1.3, 2.7, 0.5, 0],
    [2.3, 2.3, 0.42, 0],
    [0.76, 4.4, 0.28, 0],
    [60, 60, 0, 1],
    [1.7, 3.4, 0.36, 0],
    [60, 60, 0, 0.12],
];

function stoneGeometry(tris) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(tris.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(tris.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(tris.uvs, 2));
    geometry.setAttribute('aStone', new THREE.BufferAttribute(tris.data, 4));
    return geometry;
}

/**
 * The sandstone material, shared by the site and the dial.
 * @param {object} u  shared sanctuary uniforms
 * @param {object} [opts]
 * @param {boolean} [opts.shimmer=true]  the lagoon's light rippling on the lowest walls
 */
export function createStoneMaterial(u, opts = {}) {
    const shimmer = opts.shimmer !== false;
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexStone';
    material.fog = false;
    const tints = uniformArray(KIND_TINT.map((t) => new THREE.Vector3(t[0], t[1], t[2])));
    const patterns = uniformArray(KIND_PATTERN.map((t) => new THREE.Vector4(t[0], t[1], t[2], t[3])));

    material.fragmentNode = Fn(() => {
        const p = positionWorld;
        const n = normalize(normalWorld).toVar();
        const data = attribute('aStone', 'vec4');
        const kind = int(floor(data.y.add(0.5)));
        const tint = tints.element(kind);
        const pattern = patterns.element(kind).toVar();
        const st = uv();

        // ── Courses and blocks, from the face's own metres ──
        const row = floor(st.y.div(pattern.x).add(0.001));
        const along = st.x.add(mod(row, 2.0).mul(pattern.y.mul(0.5))).div(pattern.y);
        const col = floor(along.add(0.001));
        const inRow = fract(st.y.div(pattern.x));
        const inCol = fract(along);
        // Distance (metres) to the nearest joint.
        const joint = min(min(inRow, float(1.0).sub(inRow)).mul(pattern.x), min(inCol, float(1.0).sub(inCol)).mul(pattern.y));
        const groove = float(1.0).sub(smoothstep(0.012, 0.075, joint)).mul(pattern.z);
        const block = haHash21(vec2(col.add(data.z.mul(37.0)), row.add(data.z.mul(91.0))));
        // Weather: broad blotches, and streaks that run down a wall.
        const blotch = u.noise(p.xz.mul(0.011).add(vec2(p.y.mul(0.013), 0.0))).r;
        const streak = u.noise(vec2(st.x.mul(0.23), st.y.mul(0.021).add(data.z))).g;
        const wall = float(1.0).sub(abs(n.y));
        const tone = float(0.86).add(block.mul(0.22)).add(blotch.sub(0.5).mul(0.3))
            .sub(streak.mul(wall).mul(0.18));
        // Some blocks are a warmer stone, some a greyer.
        const hue = mix(vec3(1.06, 0.99, 0.9), vec3(0.94, 0.99, 1.06), haHash21(vec2(row.mul(3.1), col.mul(7.7))));
        const albedo = u.stone.mul(tint).mul(tone).mul(hue).mul(float(1.0).sub(groove))
            .toVar();
        // The lagoon keeps the lowest courses wet and green.
        const wet = float(1.0).sub(smoothstep(0.1, 1.05, p.y));
        albedo.assign(mix(albedo, albedo.mul(vec3(0.56, 0.66, 0.58)), wet.mul(0.8)));

        // ── Light ──
        const ao = data.x;
        const facing = max(dot(n, u.sunDir), 0.0);
        const sun = u.sun.mul(facing).mul(u.sunLit);
        const sky = haSkyLight(u, n).mul(1.2).add(u.horizon.mul(0.14)).mul(ao.mul(0.88).add(0.12));
        // The lagoon's bounce: on whatever looks down or sideways, strongest near the water.
        const reach = exp(max(p.y, 0.0).mul(-0.15));
        const down = float(1.0).sub(n.y).mul(0.5);
        const bounce = u.shallow.mul(down).mul(reach).mul(ao.mul(0.6).add(0.4)).toVar();
        if (shimmer) {
            const across = p.x.mul(0.6).add(p.z.mul(0.8));
            const c1 = u.noise(vec2(across.mul(0.06).add(u.time.mul(0.021)), p.y.mul(0.085).sub(u.time.mul(0.034)))).r;
            const c2 = u.noise(vec2(across.mul(0.097).sub(u.time.mul(0.027)), p.y.mul(0.13).add(u.time.mul(0.019)))).g;
            const ripple = haBell(c1.sub(c2).mul(7.0));
            bounce.mulAssign(ripple.mul(1.5).add(0.6));
        }
        // ── The sanctuary's own light: the heart gate, the Apex, the Halcyon, every ley shard ──
        const lamp = (at, radius) => {
            const to = at.sub(p);
            const d = length(to);
            const k = float(1.0).div(d.div(radius).mul(d.div(radius)).add(1.0));
            return k.mul(k).mul(max(dot(n, to.div(max(d, 1e-3))), 0.0).mul(0.75).add(0.25));
        };
        const warmth = haPulseLight(u, float(0.0), u.gate.w).mul(u.pulsesLive);
        const awake = u.power.mul(1.6).add(1.0);
        const own = u.ley.mul(lamp(u.gate.xyz, 15.0)).mul(awake.mul(1.5).add(warmth.w.mul(2.0))).add(warmth.rgb.mul(lamp(u.gate.xyz, 15.0)).mul(3.0))
            .add(u.crystal.mul(awake).add(u.heldA.mul(u.held.x).mul(0.4)).mul(lamp(u.apexPos, 26.0)).mul(1.7))
            .add(u.crystal.mul(awake).add(u.heldB.mul(u.held.y).mul(0.4)).mul(lamp(u.halcyonPos, 30.0)).mul(1.1))
            .toVar();
        // The shards stand in pairs along the causeway: the nearest one's pool of light.
        const rel = p.xz.sub(vec2(SITE.pyramid.x, SITE.pyramid.z));
        const sx = rel.x.mul(SITE.right[0]).add(rel.y.mul(SITE.right[1]));
        const sz = rel.x.mul(SITE.front[0]).add(rel.y.mul(SITE.front[1]));
        const { pitch } = SITE.causeway;
        const onDeck = smoothstep(SITE.causeway.near - 3, SITE.causeway.near + 3, sz).mul(float(1.0).sub(smoothstep(LEY_A.head + 4, LEY_A.head + 7, sz)));
        const cell = mod(sz.sub(LEY_A.head).add(pitch * 0.5), pitch).sub(pitch * 0.5);
        const toShard = vec3(abs(sx).sub(SITE.causeway.shardAt), p.y.sub(SITE.causeway.deck + 2.4), cell);
        const sd = length(toShard).div(2.6);
        const pool = float(1.0).div(sd.mul(sd).add(1.0));
        const run = haPulseLight(u, float(0.0), float(LEY_A.head).sub(sz)).mul(u.pulsesLive);
        own.addAssign(u.ley.mul(awake.mul(0.6).add(run.w.mul(1.6))).add(run.rgb.mul(2.6)).mul(pool.mul(pool)).mul(onDeck));
        const lit = sun.add(sky.mul(0.95)).add(bounce.mul(1.5)).add(own.mul(u.breath)).mul(albedo)
            .toVar();

        // Gold and polished stone answer the sky and the sun.
        const V = normalize(p.sub(cameraPosition));
        const R = reflect(V, n);
        const fres = haFresnel(dot(V, n).negate(), 0.3);
        const mirror = haSkyBase(u, vec3(R.x, abs(R.y), R.z)).mul(ao);
        const rs = max(dot(R, u.sunDir), 0.0);
        const rs8 = rs.mul(rs).mul(rs).mul(rs);
        const glint = u.sun.mul(rs8.mul(rs8).mul(rs8)).mul(u.sunLit).mul(2.2);
        lit.assign(mix(lit, tint.mul(mirror.add(glint)).mul(fres.mul(0.7).add(0.5)).mul(0.62), pattern.w));
        lit.addAssign(mirror.mul(wet).mul(haFresnel(dot(V, n).negate(), 0.03)).mul(0.6));

        // ── Gameplay light passing over the stone ──
        const clear = haClearLight(u, p).mul(u.clearLive);
        lit.addAssign(clear.rgb.mul(albedo).mul(0.7).add(albedo.mul(clear.w).mul(u.ley).mul(0.09)));
        lit.addAssign(haLockLight(u, p).mul(albedo).mul(u.ringsLive).mul(exp(max(p.y, 0.0).mul(-0.4)))
            .mul(1.2));
        return vec4(haAtmosphere(u, lit, p), 1.0);
    })();
    return material;
}

/**
 * The ley lines: strips of light inlaid in the stone. Each vertex knows how far along its line
 * it lies, so a pulse is a packet that runs the length of the line.
 * @param {object} u
 */
export function createLeyMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexLey';
    material.fog = false;
    material.side = THREE.DoubleSide;
    // Lifted off the stone by a few centimetres: keep it clear of the far masonry's depth.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -4;

    material.fragmentNode = Fn(() => {
        const p = positionWorld;
        const ley = attribute('aLey', 'vec4');
        const st = uv();
        const s = ley.x;
        const kind = floor(ley.z.add(0.5));
        const isVeil = float(1.0).sub(abs(kind.sub(1.0)).clamp(0.0, 1.0));
        const isRune = float(1.0).sub(abs(kind.sub(2.0)).clamp(0.0, 1.0));
        const pulse = haPulseLight(u, ley.y, s).mul(u.pulsesLive).toVar();
        const across = clamp(float(1.0).sub(abs(st.x.sub(0.5)).mul(2.0)), 0.0, 1.0);
        const core = across.mul(across.oneMinus().mul(1.4).add(0.6));
        // The light creeps up the line toward its crystal.
        const creep = sin(s.mul(0.21).sub(u.time.mul(1.7))).mul(0.5).add(0.5);
        const idle = mix(float(0.55), float(1.5), creep.mul(creep)).mul(u.power.mul(1.6).add(1.0));
        const clear = haClearLight(u, p).mul(u.clearLive);
        const line = u.ley.mul(idle.add(pulse.w.mul(2.2)).add(clear.w.mul(0.8))).add(pulse.rgb.mul(7.0)).add(clear.rgb.mul(2.0))
            .mul(core);
        // A rune sleeps until a pulse crosses it.
        const rune = u.ley.mul(float(0.1).add(pulse.w.mul(2.6)).add(u.power.mul(0.5))).add(pulse.rgb.mul(6.0)).add(clear.rgb.mul(1.6))
            .mul(core);
        // The heart gate's veil: light rising in a doorway, brightest at the sill.
        const rise = u.noise(vec2(st.x.mul(0.9), st.y.mul(0.5).sub(u.time.mul(0.11)))).r;
        const fine = u.noise(vec2(st.x.mul(3.1), st.y.mul(1.4).sub(u.time.mul(0.23)))).g;
        const sill = exp(st.y.mul(-2.6));
        const frame = smoothstep(0.0, 0.07, across.mul(0.5)).mul(smoothstep(0.0, 0.05, float(1.0).sub(st.y)));
        const veilGain = float(0.5).add(sill.mul(1.6)).add(rise.mul(fine).mul(2.4)).mul(u.power.mul(1.3).add(1.0))
            .add(pulse.w.mul(2.0))
            .add(clear.w.mul(0.8));
        const veil = mix(u.ley, vec3(1.0), sill.mul(0.3)).mul(veilGain).add(pulse.rgb.mul(5.0)).add(clear.rgb.mul(1.5))
            .mul(frame.mul(0.85).add(0.15));
        const col = mix(mix(line, veil, isVeil), rune, isRune).mul(u.breath);
        return vec4(haAtmosphere(u, col, p), 1.0);
    })();
    return material;
}

function leyGeometry(tris) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(tris.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(tris.uvs, 2));
    geometry.setAttribute('aLey', new THREE.BufferAttribute(tris.ley, 4));
    return geometry;
}

/**
 * The site's masonry and ley lines, and the dial's (the world places the dial under the Halcyon).
 * @param {object} u
 * @param {object} plan
 * @param {object} [opts]
 */
export function createStone(u, plan, opts = {}) {
    const stoneMaterial = createStoneMaterial(u, opts);
    const leyMaterial = createLeyMaterial(u);
    const site = haPart('HalcyonApexSite', stoneGeometry(plan.stone), stoneMaterial, -40);
    const siteLey = haPart('HalcyonApexSiteLey', leyGeometry(plan.ley), leyMaterial, -38);
    const dial = haPart('HalcyonApexDial', stoneGeometry(plan.dialStone), stoneMaterial, -39);
    const dialLey = haPart('HalcyonApexDialLey', leyGeometry(plan.dialLey), leyMaterial, -37);
    site.mesh.castShadow = true;
    dial.mesh.castShadow = true;
    // The second user of each material must not dispose it twice.
    dial.material = null;
    dialLey.material = null;
    /** Stand the dial at (x, z), turned so its first stone faces `yaw`. */
    const placeDial = (x, z, yaw) => {
        [dial.mesh, dialLey.mesh].forEach((mesh) => {
            mesh.position.set(x, 0, z);
            mesh.rotation.set(0, yaw, 0);
            mesh.updateMatrix();
            mesh.updateMatrixWorld(true);
        });
    };
    return {
        site, siteLey, dial, dialLey, placeDial, triangles: (plan.stone.count + plan.dialStone.count) / 3,
    };
}
