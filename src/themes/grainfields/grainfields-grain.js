/**
 * Grainfields — the barley round the eye, as real plants.
 *
 * A clump is a template of stalks (six near the eye, three farther out); every vertex carries only
 * where it lies on its part (s along it, w across), which part it is (stem or ear) and which stalk.
 * The vertex stage builds the plant from the instance (root, scale, seed) and the scene's state:
 * each stalk stands at its own offset in the clump, bends with the wind's gusts and a clear's trail
 * (the same fields the land's carpet reads, so the near plants and the far sheen move together),
 * and its ripe ear nods over on a curved neck. Stems and ears are ribbons turned to face the eye,
 * never thinner than about a pixel (so the far ones fill in rather than shimmer).
 *
 * The ear is a spindle of grains with its brush of awns: the ribbon is as wide as the brush, the
 * fragment draws the spindle solid and the awns as fine strands that fade to their mean coverage
 * where they are finer than a pixel. Under a multisampled pass that coverage is alpha-to-coverage
 * (the brush is a haze of light round each head); without it, the brush is cut at half.
 *
 * Unlit: the plot's crop colour (the land's own patchwork, so a plant matches the carpet it stands
 * in), drifting through amber and pale ripeness in patches across the field; dark deep in the
 * stand; the sun through the deck's gaps (read once per vertex at the root); and when the sun is
 * ahead the awns blaze with the light through them, the ears' edges after them. A gust lays the
 * stand over and shows its paler sides: the waves running over the field. Then the air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fwidth,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    select,
    sin,
    smoothstep,
    sqrt,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { aerial } from './grainfields-light.js';
import { deckShadow, gfHash21 } from './grainfields-tsl.js';
import {
    cropColour, gustAt, plotOf, pulsesAt, trailsAt,
} from './grainfields-land.js';
import { PLACES } from './grainfields-core.js';

const STEM = 0;
const EAR = 1;
/** Parts per stalk in the template's z (z = part + stalk · PARTS). */
const PARTS = 4;

/**
 * The ear (metres, times the instance's scale): the spindle's length and half-width, the brush's
 * reach past the spindle's tip (a share of the spindle's length) and its half-width, and the share
 * of the ribbon's length the spindle fills.
 */
export const EAR_SHAPE = Object.freeze({
    length: [0.075, 0.105], core: 0.0052, brush: 0.0135, reach: 0.9,
});
const CORE_SHARE = 1 / (1 + EAR_SHAPE.reach);

/** A clump's template: `stalks` stalks, each a stem of `stemRows` rows and an ear of `earRows`. */
export function grainTemplate(stalks, stemRows, earRows) {
    const position = [];
    const index = [];
    const strip = (part, rows, stalk) => {
        const base = position.length / 3;
        for (let r = 0; r <= rows; r++) {
            const s = r / rows;
            position.push(s, -1, part + stalk * PARTS, s, 1, part + stalk * PARTS);
        }
        for (let r = 0; r < rows; r++) {
            const a = base + r * 2;
            index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    };
    for (let k = 0; k < stalks; k++) {
        strip(STEM, stemRows, k);
        strip(EAR, earRows, k);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    return { geometry, triangles: index.length / 3 };
}

/** The spindle's outline along the ribbon (0..1 of the core's half-width; 0 past its tip). */
const spindle = (a) => {
    const k = clamp(a.div(CORE_SHARE), 0.0, 1.0);
    return pow(sin(k.mul(3.1416)).max(0.001), 0.5).mul(select(a.lessThan(CORE_SHARE), float(1.0), float(0.0)));
};
/** The brush's outline along the ribbon (0..1 of its half-width): from the grains out to the tips. */
const brushReach = (a) => smoothstep(0.04, 0.5, a).mul(float(1.0).sub(smoothstep(0.82, 1.0, a).mul(0.7)));

function grainMaterial(u, t, coverage) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsBarley';
    material.side = THREE.DoubleSide;
    material.fog = false;
    const iA = attribute('iA', 'vec4'); // x, ground y, z, scale
    const iB = attribute('iB', 'vec4'); // seed, yaw, plot id (CPU), fade
    const vInfo = varying(vec4(0.0), 'gfGrainInfo'); // part, s, w, shade in the stand (0..1)
    const vShape = varying(vec4(0.0), 'gfGrainShape'); // ribbon half-width, floored share, ear scale, seed
    const vNormal = varying(vec3(0.0, 1.0, 0.0), 'gfGrainNormal');
    const vLight = varying(vec4(0.0), 'gfGrainLight'); // sunlit, plot id, laid, brightness
    const vTone = varying(vec2(0.0), 'gfGrainTone'); // ripeness patches: amber .. pale, green
    const vEvent = varying(vec4(0.0), 'gfGrainEvent'); // a trail's chaff colour, the four-line front
    material.positionNode = Fn(() => {
        const s = positionGeometry.x;
        const w = positionGeometry.y;
        const code = positionGeometry.z;
        const stalk = floor(code.div(PARTS).add(0.01));
        const part = code.sub(stalk.mul(PARTS));
        const isEar = part.greaterThan(0.5);
        // This stalk's own numbers.
        const h1 = gfHash21(vec2(iB.x.mul(977.0), stalk.add(1.0)));
        const h2 = gfHash21(vec2(stalk.add(3.0), iB.x.mul(613.0)));
        const h3 = gfHash21(vec2(iB.x.mul(331.0).add(stalk), 7.0));
        const h4 = gfHash21(vec2(stalk.add(11.0), iB.x.mul(197.0)));
        const angle = iB.y.add(stalk.mul(2.3999));
        const radius = sqrt(h1).mul(0.13);
        // Farther out only the top of the stand shows over the canopy (the land's carpet is the
        // canopy there): a stalk is shortened from the foot and stands on the canopy's height.
        const away = length(iA.xz.sub(u.eye.xz));
        const farness = smoothstep(22.0, 70.0, away).toVar();
        const fullH = mix(float(0.7), float(1.04), h2).mul(iA.w);
        const H = fullH.mul(float(1.0).sub(farness.mul(0.62))).mul(mix(float(0.45), float(1.0), iB.w));
        const root = vec3(iA.x, iA.y.sub(0.05).add(fullH.mul(farness).mul(0.55)), iA.z)
            .add(vec3(sin(angle).mul(radius), 0.0, sin(angle.add(1.5708)).mul(radius)));
        // The wind: the gusts and a clear's trail at the clump's root, a flutter of its own.
        const gust = gustAt(u, t.noise, iA.xz, true);
        const trail = trailsAt(u, iA.xz);
        const pulse = pulsesAt(u, iA.xz);
        const flutter = sin(u.time.mul(3.1).add(h3.mul(40.0)).add(iA.x.mul(0.6))).mul(0.06);
        const bendWind = clamp(float(0.1).add(gust.mul(0.42)).add(flutter), 0.0, 1.3);
        const stray = h3.sub(0.5).mul(0.8);
        const windD = normalize(vec2(u.windDir.x.add(stray), u.windDir.y.sub(stray.mul(0.6))));
        // A pulse pushes the stalks its own way (out from a hard drop, round a T-spin's whirl).
        const pushed = windD.mul(bendWind).add(pulse.push.mul(1.7)).add(trail.push.mul(1.3)).toVar();
        const bend = clamp(length(pushed), 0.0, 1.35).toVar();
        const D = pushed.div(max(length(pushed), 1e-4)).toVar();
        // The stem: up and over with the wind (a quadratic bend).
        const stemAt = (k) => root.add(vec3(D.x.mul(bend).mul(H).mul(k.mul(k)).mul(0.5), H.mul(k).mul(float(1.0).sub(bend.mul(bend).mul(k).mul(0.18))), D.y.mul(bend).mul(H).mul(k.mul(k)).mul(0.5)));
        const top = stemAt(float(1.0)).toVar();
        const tangent = normalize(vec3(D.x.mul(bend), float(1.0).sub(bend.mul(bend).mul(0.36)), D.y.mul(bend))).toVar();
        // The ear leans off its neck toward its own side and the wind's (a heavy one leans more).
        const nodDir = normalize(vec3(D.x.add(sin(angle).mul(0.7)), 0.0, D.y.add(sin(angle.add(1.5708)).mul(0.7))));
        const nod = mix(float(0.12), float(0.62), h1.mul(h1)).add(bend.mul(0.35));
        const earAxis = normalize(tangent.mul(cos(nod)).add(nodDir.mul(sin(nod)))).toVar();
        const earScale = iA.w.mul(mix(float(0.9), float(1.1), h3));
        const earLen = mix(float(EAR_SHAPE.length[0]), float(EAR_SHAPE.length[1]), h3).mul(iA.w).mul(1 + EAR_SHAPE.reach);
        const along = select(isEar, top.add(earAxis.mul(earLen.mul(s))), stemAt(s)).toVar();
        const axis = select(isEar, earAxis, normalize(vec3(D.x.mul(bend).mul(s), float(1.0), D.y.mul(bend).mul(s)))).toVar();
        // Facing the eye, never under about a pixel wide.
        const toEye = normalize(u.eye.sub(along)).toVar();
        const across = normalize(cross(axis, toEye).add(vec3(1e-5, 0.0, 0.0))).toVar();
        const dist = length(u.eye.sub(along));
        const pixel = dist.mul(u.pixelAngle);
        // The ear's ribbon spans its brush of awns; farther out the heads widen a little to keep
        // the canopy full.
        const grow = farness.mul(0.5).add(1.0);
        const earTrue = max(spindle(s).mul(EAR_SHAPE.core), brushReach(s).mul(EAR_SHAPE.brush)).mul(earScale).mul(grow).add(0.0015);
        const stemTrue = float(0.0024).sub(s.mul(0.0008));
        const trueHalf = select(isEar, earTrue, stemTrue);
        const half = max(trueHalf, pixel.mul(select(isEar, float(0.9), float(0.38))));
        vNormal.assign(normalize(across.mul(w.mul(0.8)).add(toEye.mul(sqrt(float(1.0).sub(w.mul(w).mul(0.64)))))));
        // How deep in the stand the point lies: the foot of a stem is in the dark, the ears of
        // shorter stalks stand inside the canopy of their taller neighbours.
        const inStand = select(isEar, mix(float(0.55), float(1.0), h2), smoothstep(0.0, 1.0, s).mul(0.75));
        vInfo.assign(vec4(part, s, w, inStand));
        vShape.assign(vec4(half, smoothstep(1.05, 2.0, half.div(trueHalf)), earScale.mul(grow), h4));
        // The sun reaches the clump through the deck's gaps (once per vertex, at the root).
        const sunlit = deckShadow(u, t.noise, vec3(iA.x, iA.y.add(0.8), iA.z)).mul(u.sunUp);
        vLight.assign(vec4(sunlit, plotOf(iA.xz).id, gust.add(trail.lay).add(pulse.lay), mix(float(0.72), float(1.12), h4)));
        // Four lines: the front of light from the gate passing the clump (0..1).
        const fd = length(iA.xz.sub(vec2(PLACES.gate.x, PLACES.gate.z))).sub(u.flareFront).div(700.0);
        vEvent.assign(vec4(trail.tint, exp(fd.mul(fd).negate()).mul(u.flare)));
        // Ripeness drifts across the field in patches tens of metres wide, and a few metres.
        const patch = texture(t.noise, iA.xz.div(230.0)).level(1);
        vTone.assign(vec2(patch.r.mul(0.6).add(patch.b.mul(0.4)), patch.g));
        return along.add(across.mul(w.mul(half)));
    })();
    // The ear's coverage of a pixel: the spindle solid (its edge ragged with grains), the awns as
    // strands, their mean where they are finer than a pixel; a floored ribbon is filled.
    const earCoverage = Fn(() => {
        const s = vInfo.y;
        const half = vShape.x;
        const floored = vShape.y;
        const scale = vShape.z;
        const m = abs(vInfo.z).mul(half);
        const px = max(fwidth(m), 1e-5);
        const coreR = spindle(s).mul(EAR_SHAPE.core).mul(scale).mul(sin(s.mul(41.0).add(vShape.w.mul(9.0))).mul(0.1).add(0.92));
        const core = clamp(coreR.sub(m).div(px).add(0.5), 0.0, 1.0);
        const brushR = brushReach(s).mul(EAR_SHAPE.brush).mul(scale);
        const inBrush = float(1.0).sub(smoothstep(brushR.mul(0.55), brushR, m)).mul(smoothstep(0.04, 0.2, s));
        // The awns run out along the ear past its tip, parting a little: strands across the brush.
        const q = m.div(brushR.max(1e-4)).mul(4.5).add(vShape.w.mul(7.0)).add(s.mul(0.6));
        const strand = smoothstep(0.62, 0.9, sin(q.mul(6.2832)).mul(0.5).add(0.5));
        const fine = float(1.0).sub(smoothstep(0.35, 0.8, fwidth(q)));
        const brush = inBrush.mul(mix(float(0.38), strand, fine));
        const cover = max(core, brush).toVar();
        return mix(cover, max(cover, float(0.9).mul(float(1.0).sub(smoothstep(0.65, 1.0, abs(vInfo.z))))), floored);
    });
    const coverageNode = Fn(() => select(vInfo.x.greaterThan(0.5), earCoverage(), float(1.0).sub(smoothstep(0.85, 1.0, abs(vInfo.z)))))();
    if (coverage) {
        material.alphaTest = 0.5;
        material.alphaToCoverage = true;
    } else {
        material.maskNode = coverageNode.greaterThan(0.5);
    }
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const V = normalize(P.sub(u.eye)).toVar();
        const isEar = vInfo.x.greaterThan(0.5);
        const s = vInfo.y;
        const inStand = vInfo.w;
        const N0 = normalize(vNormal);
        const N = select(dot(N0, V).greaterThan(0.0), N0.negate(), N0).toVar();
        // The crop's colour, drifting in patches: deeper amber where the field ripened first,
        // paler toward straw, a breath of green in the late corners.
        const crop = cropColour(vLight.y).toVar();
        const amber = crop.mul(vec3(1.06, 0.86, 0.58));
        const pale = crop.mul(vec3(1.06, 1.08, 1.5));
        const tone = mix(amber, crop, smoothstep(0.32, 0.5, vTone.x)).toVar();
        tone.assign(mix(tone, pale, smoothstep(0.55, 0.75, vTone.x)));
        tone.assign(mix(tone, crop.mul(vec3(0.74, 1.0, 0.62)), smoothstep(0.62, 0.82, vTone.y).mul(0.6)));
        tone.mulAssign(vLight.w);
        // The spindle the gold of the crop, the awns paler and finer, the stem straw going green
        // toward its foot.
        const m = abs(vInfo.z).mul(vShape.x);
        const coreR = spindle(s).mul(EAR_SHAPE.core).mul(vShape.z);
        const awn = smoothstep(coreR.mul(0.8), coreR.add(0.002), m).max(select(s.greaterThan(CORE_SHARE), float(1.0), float(0.0)));
        const earCol = mix(tone.mul(sin(s.mul(41.0)).mul(0.07).add(1.04)), tone.mul(vec3(1.12, 1.1, 1.05)).add(vec3(0.03, 0.025, 0.01)), awn);
        const stemCol = tone.mul(mix(vec3(0.42, 0.55, 0.28), vec3(0.85, 0.82, 0.68), smoothstep(0.15, 0.6, s)));
        const albedo = select(isEar, earCol, stemCol).toVar();
        const shade = mix(float(0.16), float(1.0), inStand).toVar();
        // Laid over by a gust, the stand shows its paler sides.
        const laid = clamp(vLight.z, 0.0, 1.2);
        albedo.mulAssign(float(1.0).add(laid.mul(0.5)));
        const sunlit = vLight.x;
        const L = u.sunDir;
        // The spindle is round (a wrapped diffuse); a thin awn or stem is lit from either side.
        // Lit from behind, a plant passes some of the light (the spindle less than an awn).
        const thin = select(isEar, awn, float(1.0));
        const nl = dot(N, L);
        const round = clamp(nl.mul(0.6).add(0.4), 0.0, 1.0);
        const leaf = abs(nl).mul(0.55).add(0.3);
        const diffuse = mix(round, leaf, thin);
        const passed = clamp(nl.negate(), 0.0, 1.0).mul(mix(float(0.4), float(0.62), thin));
        // Under the deck the overcast sky is a broad soft light: the stand keeps its gold in the shade.
        const sky = u.fill.mul(N.y.mul(0.35).add(0.65)).mul(shade).mul(1.9);
        const deepened = albedo.mul(vec3(1.12, 1.0, 0.6));
        const col = albedo.mul(u.sun.mul(diffuse).mul(sunlit).mul(shade).add(sky)
            .add(u.bounce.mul(shade.mul(0.5)))).toVar();
        col.addAssign(deepened.mul(u.sun).mul(passed).mul(sunlit).mul(shade));
        // The sun ahead: light through the awns (a blaze), the spindle's edges, the stems' least.
        const ahead = clamp(dot(V, L), 0.0, 1.0);
        const a2 = ahead.mul(ahead);
        const a4 = a2.mul(a2);
        const a16 = a4.mul(a4).mul(a4).mul(a4);
        const through = a4.mul(0.5).add(a16.mul(1.35)).add(a2.mul(0.12));
        const rim = smoothstep(0.35, 1.0, abs(vInfo.z));
        const passes = select(isEar, mix(rim.mul(0.5).add(0.2), float(1.0), awn), float(0.22)).mul(mix(float(1.0), float(0.55), vShape.y));
        const warm = albedo.mul(vec3(1.45, 1.15, 0.6));
        col.addAssign(warm.mul(u.sun).mul(through).mul(passes).mul(sunlit)
            .mul(shade.mul(shade)));
        // After sunset the ears keep a rose-gold glow toward the afterglow in the west.
        col.addAssign(warm.mul(u.glow).mul(u.day.oneMinus()).mul(a4.mul(0.22).add(0.035)).mul(passes)
            .mul(shade));
        // The sun behind the eye: the stand's sunlit faces brighten (the field's opposition glow).
        const behind = clamp(dot(V, L).negate(), 0.0, 1.0);
        col.addAssign(albedo.mul(u.sun).mul(pow(behind, 6.0).mul(0.35)).mul(sunlit).mul(shade));
        // A clear's trail glints with its rows' colours; the four-line front runs through as gold.
        col.addAssign(vEvent.xyz.mul(0.5).mul(sunlit.mul(0.6).add(0.4)).mul(select(isEar, float(1.0), float(0.2))));
        col.addAssign(warm.mul(u.sun).mul(vEvent.w).mul(0.7).mul(shade));
        // A gust's sheen: the laid stand's backs catch the sky.
        col.addAssign(u.fill.mul(laid.mul(0.55)).mul(shade).mul(select(isEar, float(1.0), float(0.3))));
        // The blaze stays gold: a hue-preserving cap below the tone map's path to white, so a backlit
        // awn never turns into a white speck.
        const peak = max(max(col.x, col.y), max(col.z, 1e-4));
        col.mulAssign(min(float(1.0), float(2.1).div(peak)));
        return vec4(aerial(u, P, col), coverage ? coverageNode : 1.0);
    })();
    return material;
}

/**
 * The barley round the eye: one instanced mesh per detail (`near` six stalks a clump, `far` three),
 * the instances from grainfields-plan grainSites. `coverage` when the scene pass is multisampled
 * (the awns as alpha-to-coverage).
 */
export function createGrain(u, t, sites, { coverage = false } = {}) {
    const meshes = [];
    const parts = [];
    [['near', 6, 4, 4], ['far', 3, 2, 2]].forEach(([name, stalks, stemRows, earRows]) => {
        const field = sites[name];
        const { geometry, triangles } = grainTemplate(stalks, stemRows, earRows);
        const count = field?.count || 0;
        const data = new Float32Array(Math.max(1, count) * 8);
        if (count) data.set(field.data.subarray(0, count * 8));
        const buffer = new THREE.InstancedInterleavedBuffer(data, 8);
        geometry.setAttribute('iA', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
        geometry.setAttribute('iB', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
        geometry.instanceCount = count;
        const material = grainMaterial(u, t, coverage);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `GrainfieldsBarley-${name}`;
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        meshes.push(mesh);
        parts.push({
            geometry, material, count, triangles: triangles * count,
        });
    });
    return {
        mesh: meshes[0],
        meshes,
        counts: { near: parts[0].count, far: parts[1].count },
        triangles: parts[0].triangles + parts[1].triangles,
        update() {},
        dispose() {
            parts.forEach(({ geometry, material }) => {
                geometry.dispose();
                material.dispose();
            });
        },
    };
}
