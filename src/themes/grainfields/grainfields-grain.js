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
 *
 * What it costs (docs/GRAINFIELDS_PERF_2026-10.md): tens of thousands of clumps of ribbons a pixel
 * or two wide, so the GPU's time goes to pixels and thin triangles, not to the vertex stage.
 *  - Everything constant over a clump (its crop's tone, the gust's sheen, the sun through the deck,
 *    the events) or linear along a plant (the air in front of it) is worked out per vertex; a
 *    pixel only does what varies across a ribbon. A pixel the coverage drops is not lit at all.
 *  - The clumps are drawn nearest first, in bands by distance, so the depth test turns away most
 *    of the stand behind; farther bands bend their stems and outline their ears with fewer rows.
 *  - Under multisampling the stems are drawn apart from the ears and opaque: alpha-to-coverage
 *    on millions of thin stems was the stand's single largest cost. Their ribbon is cut to where the
 *    coverage used to keep them (its edge is now the multisampled edge), a little thinner still,
 *    as the coverage's soft edge left them.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
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
import { aerialParts } from './grainfields-light.js';
import { deckShadow, gfHash21 } from './grainfields-tsl.js';
import {
    cropColour, gustAt, plotOf, pulsesAt, trailsAt,
} from './grainfields-land.js';
import { EYE, PLACES } from './grainfields-core.js';
import { trampleAt } from './grainfields-trample.js';

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

/**
 * The stand's draws, nearest first: which planted field (grainSites' `near` or `far`), how many
 * stalks a clump, the rows of a stem and of an ear, and the distances (metres from the eye) the
 * band holds. Beyond a few metres a stem is a pixel or less wide and an ear a handful of pixels
 * long, so fewer rows draw the same plant.
 */
export const GRAIN_BANDS = Object.freeze([
    Object.freeze({
        field: 'near', stalks: 6, stemRows: 4, earRows: 4, from: 0, to: 8,
    }),
    Object.freeze({
        field: 'near', stalks: 6, stemRows: 3, earRows: 3, from: 8, to: 17,
    }),
    Object.freeze({
        field: 'near', stalks: 6, stemRows: 2, earRows: 2, from: 17, to: Infinity,
    }),
    Object.freeze({
        field: 'far', stalks: 3, stemRows: 2, earRows: 2, from: 0, to: Infinity,
    }),
]);

/**
 * An opaque stem's ribbon: the share of its width the coverage kept (|w| below which it held more
 * than half), and how much thinner (pixels, from each side) its soft edge left it.
 */
export const STEM_CUT = Object.freeze({ keep: 0.925, trim: 0.2 });

/**
 * A clump's template: `stalks` stalks, each a stem of `stemRows` rows and an ear of `earRows`;
 * `only` 'stem' or 'ear' leaves the other part out.
 */
export function grainTemplate(stalks, stemRows, earRows, only = null) {
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
        if (only !== 'ear') strip(STEM, stemRows, k);
        if (only !== 'stem') strip(EAR, earRows, k);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    return { geometry, triangles: index.length / 3 };
}

/**
 * The clumps of a field between `from` and `to` metres from the eye, nearest first (the eye never
 * moves, so the order holds for every frame): an instance array of 8 floats a clump.
 */
export function bandSites(field, from, to) {
    const count = field?.count || 0;
    const src = field?.data;
    const picked = [];
    for (let i = 0; i < count; i++) {
        const r = Math.hypot(src[i * 8] - EYE.x, src[i * 8 + 2] - EYE.z);
        if (r >= from && r < to) picked.push({ i, r });
    }
    picked.sort((a, b) => a.r - b.r);
    const data = new Float32Array(Math.max(1, picked.length) * 8);
    picked.forEach(({ i }, k) => data.set(src.subarray(i * 8, i * 8 + 8), k * 8));
    return { data, count: picked.length };
}

/** The spindle's outline along the ribbon (0..1 of the core's half-width; 0 past its tip). */
const spindle = (a) => {
    const k = clamp(a.div(CORE_SHARE), 0.0, 1.0);
    return pow(sin(k.mul(3.1416)).max(0.001), 0.5).mul(select(a.lessThan(CORE_SHARE), float(1.0), float(0.0)));
};
/** The brush's outline along the ribbon (0..1 of its half-width): from the grains out to the tips. */
const brushReach = (a) => smoothstep(0.04, 0.5, a).mul(float(1.0).sub(smoothstep(0.82, 1.0, a).mul(0.7)));

/**
 * The barley's material. `coverage`: the pass is multisampled (the ears' awns as
 * alpha-to-coverage). `stems`: an opaque draw of the stems alone (cut as STEM_CUT says).
 */
function grainMaterial(u, t, { coverage = false, stems = false } = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = stems ? 'GrainfieldsBarleyStems' : 'GrainfieldsBarley';
    material.side = THREE.DoubleSide;
    material.fog = false;
    const iA = attribute('iA', 'vec4'); // x, ground y, z, scale
    const iB = attribute('iB', 'vec4'); // seed, yaw, plot id (CPU), fade
    const vInfo = varying(vec4(0.0), 'gfGrainInfo'); // part, s, w, shade in the stand (0..1)
    const vShape = varying(vec4(0.0), 'gfGrainShape'); // ribbon half-width, floored share, ear scale, seed
    const vNormal = varying(vec3(0.0, 1.0, 0.0), 'gfGrainNormal');
    const vTone = varying(vec4(0.0), 'gfGrainTone'); // the crop's tone rgb, the gust's lift of it
    const vLit = varying(vec4(0.0), 'gfGrainLit'); // the events' light rgb, sunlit
    const vAir = varying(vec4(0.0), 'gfGrainAir'); // the air in front: inscatter rgb, transmittance
    const vFlare = varying(float(0.0), 'gfGrainFlare'); // the four-line front's gold
    material.positionNode = Fn(() => {
        const s = positionGeometry.x;
        // A cut stem's ribbon spans only what the coverage kept of the full one.
        const w = stems ? positionGeometry.y.mul(STEM_CUT.keep) : positionGeometry.y;
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
        // Where the herd has gone through: parted, and laid over in its wake.
        const tramp = t.trample ? trampleAt(t, iA.xz) : { push: vec2(0.0), lay: float(0.0) };
        const flutter = sin(u.time.mul(3.1).add(h3.mul(40.0)).add(iA.x.mul(0.6))).mul(0.06);
        const bendWind = clamp(float(0.1).add(gust.mul(0.42)).add(flutter), 0.0, 1.3);
        const stray = h3.sub(0.5).mul(0.8);
        const windD = normalize(vec2(u.windDir.x.add(stray), u.windDir.y.sub(stray.mul(0.6))));
        // A pulse pushes the stalks its own way (out from a hard drop, round a T-spin's whirl).
        const pushed = windD.mul(bendWind).add(pulse.push.mul(1.7)).add(trail.push.mul(1.3)).add(tramp.push.mul(1.5))
            .toVar();
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
        // A cut stem stands as thin as the coverage's soft edge left it.
        const drawnHalf = stems ? max(half.sub(pixel.mul(STEM_CUT.trim)), half.mul(0.3)) : half;
        // A cut stem's edge carries the normal the full ribbon interpolated to there (unnormalised:
        // the fragment normalises it, as it did the blend of the full ribbon's unit edge normals).
        vNormal.assign(stems
            ? across.mul(w.mul(0.8)).add(toEye.mul(0.6))
            : normalize(across.mul(w.mul(0.8)).add(toEye.mul(sqrt(float(1.0).sub(w.mul(w).mul(0.64)))))));
        // How deep in the stand the point lies: the foot of a stem is in the dark, the ears of
        // shorter stalks stand inside the canopy of their taller neighbours.
        const inStand = select(isEar, mix(float(0.55), float(1.0), h2), smoothstep(0.0, 1.0, s).mul(0.75));
        vInfo.assign(vec4(part, s, w, inStand));
        vShape.assign(vec4(half, smoothstep(1.05, 2.0, half.div(trueHalf)), earScale.mul(grow), h4));
        const P = along.add(across.mul(w.mul(drawnHalf))).toVar();

        // ── What is constant over the clump, or linear along the plant: lit here, once ──
        // The sun reaches the clump through the deck's gaps (at the root).
        const sunlit = deckShadow(u, t.noise, vec3(iA.x, iA.y.add(0.8), iA.z)).mul(u.sunUp).toVar();
        // The crop's colour, drifting in patches: deeper amber where the field ripened first,
        // paler toward straw, a breath of green in the late corners.
        const patch = texture(t.noise, iA.xz.div(230.0)).level(1);
        const ripe = patch.r.mul(0.6).add(patch.b.mul(0.4));
        const crop = cropColour(plotOf(iA.xz).id).toVar();
        const tone = mix(crop.mul(vec3(1.06, 0.86, 0.58)), crop, smoothstep(0.32, 0.5, ripe)).toVar();
        tone.assign(mix(tone, crop.mul(vec3(1.06, 1.08, 1.5)), smoothstep(0.55, 0.75, ripe)));
        tone.assign(mix(tone, crop.mul(vec3(0.74, 1.0, 0.62)), smoothstep(0.62, 0.82, patch.g).mul(0.6)));
        tone.mulAssign(mix(float(0.72), float(1.12), h4));
        // Laid over by a gust, the stand shows its paler sides.
        const laid = clamp(gust.add(trail.lay).add(pulse.lay).add(tramp.lay.mul(0.6)), 0.0, 1.2);
        vTone.assign(vec4(tone, laid.mul(0.5).add(1.0)));
        const shade = mix(float(0.16), float(1.0), inStand);
        // A clear's trail glints with its rows' colours; a gust's sheen: the laid stand's backs
        // catch the sky.
        const events = trail.tint.mul(0.5).mul(sunlit.mul(0.6).add(0.4)).mul(select(isEar, float(1.0), float(0.2)))
            .add(u.fill.mul(laid.mul(0.55)).mul(shade).mul(select(isEar, float(1.0), float(0.3))));
        vLit.assign(vec4(events, sunlit));
        // Four lines: the front of light from the gate passing the clump (0..1).
        const fd = length(iA.xz.sub(vec2(PLACES.gate.x, PLACES.gate.z))).sub(u.flareFront).div(700.0);
        vFlare.assign(exp(fd.mul(fd).negate()).mul(u.flare).mul(0.7).mul(shade));
        // The air between the eye and the plant (a plant is a metre tall: per vertex is exact enough).
        const air = aerialParts(u, P);
        vAir.assign(vec4(air.inscatter, air.transmit));
        return P;
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
    if (stems) {
        // Opaque: every fragment of the cut ribbon is kept, its edge multisampled.
    } else if (coverage) {
        material.alphaTest = 0.5;
        material.alphaToCoverage = true;
    } else {
        material.maskNode = coverageNode.greaterThan(0.5);
    }
    // The light a pixel still has to work out: what varies across a ribbon (its normal, the
    // spindle against the awns, the view toward the sun).
    const colour = () => {
        const P = positionWorld;
        const V = normalize(P.sub(u.eye)).toVar();
        const isEar = vInfo.x.greaterThan(0.5);
        const s = vInfo.y;
        const N0 = normalize(vNormal);
        const N = select(dot(N0, V).greaterThan(0.0), N0.negate(), N0).toVar();
        const tone = vTone.xyz;
        // The spindle the gold of the crop, the awns paler and finer, the stem straw going green
        // toward its foot.
        const m = abs(vInfo.z).mul(vShape.x);
        const coreR = spindle(s).mul(EAR_SHAPE.core).mul(vShape.z);
        const awn = smoothstep(coreR.mul(0.8), coreR.add(0.002), m).max(select(s.greaterThan(CORE_SHARE), float(1.0), float(0.0)));
        const earCol = mix(tone.mul(sin(s.mul(41.0)).mul(0.07).add(1.04)), tone.mul(vec3(1.12, 1.1, 1.05)).add(vec3(0.03, 0.025, 0.01)), awn);
        const stemCol = tone.mul(mix(vec3(0.42, 0.55, 0.28), vec3(0.85, 0.82, 0.68), smoothstep(0.15, 0.6, s)));
        const albedo = select(isEar, earCol, stemCol).mul(vTone.w).toVar();
        const shade = mix(float(0.16), float(1.0), vInfo.w).toVar();
        const sunlit = vLit.w;
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
        // The events (worked out per vertex) and the four-line front running through as gold.
        col.addAssign(vLit.xyz);
        col.addAssign(warm.mul(u.sun).mul(vFlare));
        // The blaze stays gold: a hue-preserving cap below the tone map's path to white, so a backlit
        // awn never turns into a white speck.
        const peak = max(max(col.x, col.y), max(col.z, 1e-4));
        col.mulAssign(min(float(1.0), float(2.1).div(peak)));
        return col.mul(vAir.w).add(vAir.xyz);
    };
    if (stems) {
        material.colorNode = Fn(() => vec4(colour(), 1.0))();
    } else {
        // Light only what the coverage keeps (alpha-to-coverage and the mask keep a > 0.5).
        material.colorNode = Fn(() => {
            const cover = coverageNode.toVar();
            const lit = vec3(0.0).toVar();
            If(cover.greaterThan(0.5), () => {
                lit.assign(colour());
            });
            return vec4(lit, coverage ? cover : 1.0);
        })();
    }
    return material;
}

/**
 * The barley round the eye: per GRAIN_BANDS band one instanced draw (two under multisampling: the
 * stems opaque, then the ears), the instances from grainfields-plan grainSites, nearest first.
 * `coverage` when the scene pass is multisampled (the awns as alpha-to-coverage).
 */
export function createGrain(u, t, sites, { coverage = false } = {}) {
    const meshes = [];
    const parts = [];
    const counts = { near: 0, far: 0 };
    let triangles = 0;
    let order = 1;
    GRAIN_BANDS.forEach((band) => {
        const { data, count } = bandSites(sites?.[band.field], band.from, band.to);
        counts[band.field] += count;
        const buffer = new THREE.InstancedInterleavedBuffer(data, 8);
        (coverage ? ['stem', 'ear'] : [null]).forEach((only) => {
            const { geometry, triangles: perClump } = grainTemplate(band.stalks, band.stemRows, band.earRows, only);
            geometry.setAttribute('iA', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
            geometry.setAttribute('iB', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
            geometry.instanceCount = count;
            const material = grainMaterial(u, t, { coverage, stems: only === 'stem' });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `GrainfieldsBarley-${band.field}-${band.from}${only ? `-${only}s` : ''}`;
            mesh.frustumCulled = false;
            // Nearest first: the depth test then turns the stand behind away.
            mesh.renderOrder = order;
            order += 0.001;
            meshes.push(mesh);
            parts.push({ geometry, material });
            triangles += perClump * count;
        });
    });
    return {
        mesh: meshes[0],
        meshes,
        counts,
        triangles,
        update() {},
        dispose() {
            parts.forEach(({ geometry, material }) => {
                geometry.dispose();
                material.dispose();
            });
        },
    };
}
