/**
 * Sunfall — uniforms, shared light helpers and the world's node materials (three r186, TSL).
 *
 * The light model, shared by every material and by the post's volume integral:
 * - **The sun** reaches only what lies inside the oculus projected along the sun direction
 *   (`sfSunMask`): a ragged rock rim and a vine fringe, both read from one polar texture of
 *   the skylight, the fringe rotated by the Turning, the opening narrowed into fingers by a
 *   combo and widened by a perfect clear. Above the oculus plane is the open air outside.
 * - **The shell and the ledge** carry Cycles bakes per vertex (scripts/blender/sunfall_assets.py):
 *   occlusion, the sky light through both skylights, and the sunlight (direct and bounced off
 *   the canopy) for each of the five stations; `sfStationSun` blends the two stations the sun
 *   is between. The bounce is the vault's green-gold light from below.
 * - **The canopy** is lit analytically: the sun mask times a march through the canopy height
 *   map toward the sun (`sfCanopyShadow`: crowns shade each other and their own far sides),
 *   leaves lit through where the eye looks toward the sun, a sky term from the oculus's solid
 *   angle, and the pool's own bounce.
 *
 * Every light is in one HDR scale: 1 is paper white before exposure. Sizes and gains are
 * tuned in the playground (`effect=sunfall`).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    exp2,
    float,
    floor,
    fract,
    fwidth,
    length,
    log2,
    max,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    pow,
    reflect,
    select,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';
import {
    CANOPY_LEVEL,
    FAR_DOLINE_CENTER,
    OCULUS_CENTER,
    OCULUS_RX,
    OCULUS_RZ,
    PIECE_SWATCH_RGB,
    SUNFALL_LAYOUT,
    SUNFALL_STATIONS,
} from './sunfall-core.js';
import { LATTICE_SIZE, LATTICE_SLICE, OCULUS_TEX } from './sunfall-bake.js';

const TWO_PI = Math.PI * 2;
/** The order the oculus fingers open in, as homes on a ring of seven: two face each other. */
const FINGER_ORDER = Object.freeze([0, 4, 2, 6, 1, 5, 3]);

/** Light gains (HDR units per unit of Blender sun/sky in the bakes). */
export const SUNFALL_LIGHT = Object.freeze({
    sun: 13.0, // direct sun irradiance: a lit crown of albedo 0.15 shows about 2
    bounce: 3.5, // extra weight on the baked bounce (secondary light, with occlusion)
    sky: 4.0, // sky radiance seen through the oculus
    fill: 0.0045, // the cave's own darkness floor, times occlusion
    pool: 34.0, // art gain on the sunlit pool's light on the vault (sent upward: lobe^2.5)
    column: 0.85, // the column's own light (irradiance at its radius) on what stands round it
    farPool: 16.0, // art gain on the far doline's sunlit floor lighting the passage's end
});

/** Five crown greens and two natural flush colours (linear). */
export const CROWN_GREENS = Object.freeze([
    [0.085, 0.140, 0.040], // olive
    [0.040, 0.128, 0.042], // emerald
    [0.030, 0.096, 0.040], // deep green
    [0.120, 0.190, 0.040], // yellow-green
    [0.020, 0.060, 0.024], // dark
]);
export const NATURAL_FLUSH = Object.freeze([
    [0.200, 0.090, 0.040], // bronze
    [0.220, 0.075, 0.080], // rose
]);

export function createSunfallUniforms(textures = null, manifest = null) {
    const s1 = SUNFALL_STATIONS[1];
    const v3 = (a) => uniform(new THREE.Vector3(...a));
    const u = {
        time: uniform(0),
        sunDir: v3(s1.sunDir),
        bowSun: v3([-0.10, 0.78, 0.61]),
        fringeAngle: uniform(0),
        cloudHoleOpen: uniform(1.0),
        beamWarmth: uniform(s1.beamWarmth),
        cloudFloor: uniform(s1.cloudFloor),
        stationW: uniform(new THREE.Vector4(0, 1, 0, 0)),
        stationW4: uniform(0),
        foot: v3([-140, CANOPY_LEVEL, -350]),
        sunGain: uniform(1),
        skyGain: uniform(1),

        skyZenith: v3(s1.skyZenith),
        skyRim: v3(s1.skyRim),
        beamCore: v3(s1.beamCore),
        beamScatter: v3(s1.beamScatter),
        poolSun: v3(s1.poolSun),
        bounceVault: v3(s1.bounceVault),
        caveShadow: v3(s1.caveShadow),
        mistTint: v3(s1.mistTint),
        gourBlue: v3(s1.gourBlue),

        dripScale: uniform(0.75),
        mistScale: uniform(0.95),
        cloudOpacity: uniform(0.65),
        sprayRate: uniform(0.45),

        flushPulse: uniform(0),
        flushU: uniform(0.5),
        /** Each side's strand kick (left, right): every lock adds to its side's. */
        kick: uniform(new THREE.Vector2(0, 0)),
        /** The strands' wind and the swiftlets' flight run on clocks that quicken with play. */
        windClock: uniform(0),
        windGain: uniform(1),
        swiftClock: uniform(0),
        /** The motes' brightness: the chain, the heat of play, a glint on each event. */
        moteGain: uniform(1),
        /** The cataract curtain already standing while a new pour's front falls over it. */
        cataractHold: uniform(0),
        /** How much of a piece's pigment the rain and the motes in the light catch (heat). */
        prism: uniform(0),
        /** The light left between the oculus fingers (it floods back in a fever). */
        fingerFloor: uniform(0.14),
        pixelAngle: uniform((2 * Math.tan((26 * Math.PI) / 180)) / 1080),
        flushColor: v3(PIECE_SWATCH_RGB.T),
        flushWorldPos: v3([-140, CANOPY_LEVEL, -350]),
        snapPulse: uniform(0),
        snapU: uniform(0.5),
        snapColor: v3(PIECE_SWATCH_RGB.S),
        showerPulse: uniform(0),
        ripenPulse: uniform(0),
        ripenRow: uniform(12),
        ripenCodesPacked: uniform(0),
        cataractPulse: uniform(0),
        cataractAge: uniform(99),
        rainbowStrength: uniform(0),
        comboLift: uniform(0),
        comboColumns: uniform(1),
        sevenfoldPulse: uniform(0),
        exhalePulse: uniform(0),
        exhaleAge: uniform(99),
        floodThreads: uniform(0),
        echoBoost: uniform(0),
        turningPulse: uniform(0),
        zenithPulse: uniform(0),
        overCloudClose: uniform(0),
        wet: uniform(0),

        calmStrength: uniform(0.85),
        lightCeilSky: uniform(manifest?.light?.ceilings?.sky ?? 1.6),
        lightCeilSun: uniform(manifest?.light?.ceilings?.sun ?? 0.64),
        lightStops: manifest?.light?.stops ?? 12,
    };
    if (textures) {
        u.latticeTex = textures.lattice;
        u.fbmTex = textures.fbm;
        u.oculusTex = textures.oculus;
        u.canopyTex = textures.canopy;
        u.canopyMin = vec2(textures.canopyBounds.x[0], textures.canopyBounds.z[0]);
        u.canopySpan = vec2(
            textures.canopyBounds.x[1] - textures.canopyBounds.x[0],
            textures.canopyBounds.z[1] - textures.canopyBounds.z[0],
        );
    }
    return u;
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

export const sfHash11 = Fn(([p]) => fract(sin(p.mul(127.1).add(311.7)).mul(43758.5453)))
    .setLayout({ name: 'sf_hash11', type: 'float', inputs: [{ name: 'p', type: 'float' }] });

export const sfHash21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)))
    .setLayout({ name: 'sf_hash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/** Two-lobe Henyey-Greenstein phase (forward g, back 0.25), written without pow. */
export const sfPhase = Fn(([cosT, g]) => {
    const c = clamp(cosT, -1.0, 1.0);
    const hg = (gg) => {
        const x = max(float(1.0).add(gg * gg).sub(c.mul(2.0 * gg)), 1e-4);
        return float((1 - gg * gg) / (4 * Math.PI)).div(x.mul(x.sqrt()));
    };
    const gf = clamp(g, 0.0, 0.95);
    const xf = max(float(1.0).add(gf.mul(gf)).sub(c.mul(gf).mul(2.0)), 1e-4);
    const forward = float(1.0).sub(gf.mul(gf)).div(xf.mul(xf.sqrt())).mul(1 / (4 * Math.PI));
    return mix(hg(-0.25), forward, 0.82);
}).setLayout({
    name: 'sf_phase', type: 'float', inputs: [{ name: 'cosT', type: 'float' }, { name: 'g', type: 'float' }],
});

/**
 * Pure analytic primary + secondary double rainbow (Alexander's dark band between).
 * Takes the cosine to the antisolar direction; the caller computes it from `u.bowSun`.
 */
export const dlBowNode = Fn(([cosTheta]) => {
    const gauss = (mu, invSigma) => {
        const d = cosTheta.sub(float(mu)).mul(float(invSigma));
        return exp(d.mul(d).mul(-0.5));
    };
    const pR = gauss(0.742, 153.8);
    const pG = gauss(0.751, 166.7);
    const pB = gauss(0.760, 153.8);
    const sup1 = gauss(0.769, 263.0).mul(0.28);
    const sup2 = gauss(0.776, 285.0).mul(0.14);
    const sR = gauss(0.636, 105.0).mul(0.36);
    const sG = gauss(0.623, 111.0).mul(0.36);
    const sB = gauss(0.610, 105.0).mul(0.36);
    return vec3(
        pR.add(sup1.mul(0.45)).add(sR),
        pG.add(sup1.mul(0.85)).add(sup2.mul(0.55)).add(sG),
        pB.add(sup1.mul(0.95)).add(sup2.mul(0.90)).add(sB),
    );
}).setLayout({ name: 'sf_bow', type: 'vec3', inputs: [{ name: 'cosTheta', type: 'float' }] });

/** One of the seven piece swatches by index (an exact integer in a float). */
export const pieceSwatchNode = Fn(([codeIdx]) => {
    const idx = floor(codeIdx.add(0.5));
    const pick = (i) => float(1.0).sub(clamp(abs(idx.sub(i)), 0.0, 1.0));
    const codes = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
    let col = vec3(0.0);
    codes.forEach((code, i) => { col = col.add(vec3(...PIECE_SWATCH_RGB[code]).mul(pick(i))); });
    return col;
}).setLayout({ name: 'sf_swatch', type: 'vec3', inputs: [{ name: 'codeIdx', type: 'float' }] });

// ── Inline helpers (they read uniforms and textures) ────────────────────────────

/** 3D value noise, two independent fields in [0, 1], in one lattice fetch (unit = one cell). */
export const sfNoise3 = (u, at) => {
    const cell = floor(at);
    const f0 = fract(at);
    const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
    const st = cell.xy.add(vec2(LATTICE_SLICE[0], LATTICE_SLICE[1]).mul(cell.z)).add(f.xy).add(0.5).div(LATTICE_SIZE);
    const t = texture(u.latticeTex, st).level(0);
    return mix(t.xz, t.yw, f.z);
};

/** A baked light byte (0..1) back to light: log2 over `stops` stops below `ceiling`. */
export const sfDecode = (u, q, ceiling) => select(
    q.greaterThan(0.5 / 255),
    exp2(q.mul(u.lightStops).sub(u.lightStops)).mul(ceiling),
    float(0.0),
);

/** The baked sunlight of the two stations the sun is between. */
export const sfStationSun = (u, C, B) => {
    const c = u.lightCeilSun;
    return sfDecode(u, C.z, c).mul(u.stationW.x)
        .add(sfDecode(u, C.w, c).mul(u.stationW.y))
        .add(sfDecode(u, B.x, c).mul(u.stationW.z))
        .add(sfDecode(u, B.y, c).mul(u.stationW.w))
        .add(sfDecode(u, B.z, c).mul(u.stationW4));
};

/** Where `P`'s sun ray crosses the oculus plane, in oculus radii about its centre. */
export const sfOculusCoord = (u, P) => {
    const S = u.sunDir;
    const t = float(OCULUS_CENTER[1]).sub(P.y).div(max(S.y, 0.15));
    const hit = P.xz.add(S.xz.mul(t));
    return hit.sub(vec2(OCULUS_CENTER[0], OCULUS_CENTER[2])).div(vec2(OCULUS_RX, OCULUS_RZ));
};

/**
 * The sunfall's mask at `q` (oculus coordinates) for a point `along` metres below the plane:
 * the ragged rim and the vine fringe of the polar skylight texture, blurred by the sun disc's
 * penumbra with distance, narrowed into the combo's fingers and widened by a perfect clear.
 *
 * `dq` (optional): the stretch of the mask a march step covers (oculus coordinates). The fetch
 * then averages the mask along that segment (anisotropic, by explicit gradients) and keeps the
 * penumbra's width across it, so a march with few steps sees each streak it crosses instead of
 * hitting or missing it pixel by pixel (a static screen-door grain over the whole column).
 */
export const sfMaskAt = (u, q, along, { vines: withVines = true, dq = null } = {}) => {
    const open = max(u.cloudHoleOpen, 0.2);
    const qq = q.div(open);
    const r = length(qq);
    const ang = atan(qq.y, qq.x).div(TWO_PI).add(0.5);
    const v = clamp(r.div(OCULUS_TEX.reach), 0.0, 1.0);
    const turned = vec2(ang.add(u.fringeAngle.div(TWO_PI)), v);
    let rim;
    let vines;
    if (dq) {
        // The polar map's Jacobian at q: radial texels along e_r, angular ones along e_t / r.
        const rs = max(r, 0.08);
        const er = qq.div(rs);
        const et = vec2(er.y.negate(), er.x);
        const toUv = (d) => vec2(
            clamp(dot(d, et).div(rs.mul(TWO_PI)), -0.25, 0.25),
            dot(d, er).div(OCULUS_TEX.reach),
        );
        const along1 = dq.div(open);
        // The penumbra: the sun disc (0.0093 rad) over the distance, in oculus radii.
        const pen = along.mul(0.0093 / Math.min(OCULUS_RX, OCULUS_RZ)).div(open).add(1e-4);
        const len = length(along1);
        const major = along1.mul(max(len, pen).div(max(len, 1e-6)));
        const minor = vec2(along1.y.negate(), along1.x).div(max(len, 1e-6)).mul(pen);
        const gx = toUv(major).toVar();
        const gy = toUv(minor).toVar();
        rim = texture(u.oculusTex, vec2(ang, v)).grad(gx, gy).x;
        vines = withVines ? texture(u.oculusTex, turned).grad(gx, gy).y : float(1.0);
    } else {
        // Penumbra: the sun disc (0.0093 rad) over the distance, in radial texels of the map.
        const texel = (OCULUS_TEX.reach * Math.min(OCULUS_RX, OCULUS_RZ)) / OCULUS_TEX.height;
        const lod = clamp(log2(max(along.mul(0.0093).div(texel), 1.0)), 0.0, 4.0);
        rim = texture(u.oculusTex, vec2(ang, v)).level(lod).x;
        vines = withVines ? texture(u.oculusTex, turned).level(lod).y : float(1.0);
    }
    const base = rim.mul(mix(1.0, vines, 0.9));
    // Combo fingers: the vines close over the opening except for gaps on a ring, one per link.
    // `n` eases between counts: each gap has a fixed home on a ring of seven (in an order that
    // keeps the open ones spread) and fades in or out there, so no gap ever jumps; the ring
    // turns with the fringe. A lone gap sits at the centre and moves out as the second opens.
    const n = u.comboColumns;
    const ring = smoothstep(1.0, 2.0, n).mul(0.52);
    let fingers = float(0.0);
    FINGER_ORDER.forEach((home, k) => {
        const a = u.fringeAngle.add(home * (TWO_PI / 7) + 0.4);
        const c = vec2(cos(a), sin(a)).mul(ring);
        const live = clamp(n.sub(k), 0.0, 1.0);
        fingers = max(fingers, float(1.0).sub(smoothstep(0.13, 0.19, length(q.sub(c)))).mul(live));
    });
    // A chain of three hints at it; four and on the light is in blades.
    const comboOn = smoothstep(0.2, 0.55, u.comboLift);
    return base.mul(mix(1.0, max(fingers, u.fingerFloor), comboOn));
};

/**
 * The sunfall's mask at a world point (1 above the oculus plane: the open air outside).
 * `dq`: the march step's stretch of the mask (see `sfMaskAt`).
 */
export const sfSunMask = (u, P, dq = null) => {
    const along = max(float(OCULUS_CENTER[1]).sub(P.y), 0.0).div(max(u.sunDir.y, 0.15));
    const m = sfMaskAt(u, sfOculusCoord(u, P), along, { dq });
    return select(P.y.greaterThan(OCULUS_CENTER[1] - 2.0), float(1.0), m);
};

/** UV of a world (x, z) in the canopy height map. */
export const sfCanopyUv = (u, xz) => xz.sub(u.canopyMin).div(u.canopySpan);

/** The canopy's top height at (x, z). */
export const sfCanopyHeight = (u, xz) => texture(u.canopyTex, sfCanopyUv(u, xz)).level(0).x;

/**
 * Sun visibility through the canopy: march toward the sun through the height map. Crowns
 * shade the crowns beside them and their own far sides.
 */
export const sfCanopyShadow = (u, P, steps = 6, stride = 3.6) => {
    const occ = float(0.0).toVar();
    Loop({
        start: 0, end: steps, type: 'int', condition: '<', name: 'cs',
    }, ({ cs }) => {
        const t = float(cs).add(1.0).mul(stride);
        const q = P.add(u.sunDir.mul(t));
        const h = sfCanopyHeight(u, q.xz);
        occ.addAssign(smoothstep(q.y.sub(0.6), q.y.add(2.2), h).mul(0.5));
    });
    return clamp(float(1.0).sub(occ), 0.0, 1.0);
};

/**
 * Light from the sunfall itself: the lit column is a great luminous cylinder standing in the
 * chamber, so it lights everything round it as a line light along its axis (falling as 1/d).
 */
/** The nearest point of the column's axis (from the oculus down to the canopy) to `P`. */
export const sfColumnAxisPoint = (u, P) => {
    const S = u.sunDir;
    const A = vec3(OCULUS_CENTER[0], OCULUS_CENTER[1], OCULUS_CENTER[2]);
    const reach = float(OCULUS_CENTER[1] - CANOPY_LEVEL).div(max(S.y, 0.15));
    const t = clamp(dot(P.sub(A), S), reach.negate(), 0.0);
    return A.add(S.mul(t));
};

export const sfColumnLight = (u, P, N) => {
    const toAxis = sfColumnAxisPoint(u, P).sub(P);
    const d = max(length(toAxis), 1.0);
    const facing = clamp(dot(N, toAxis.div(d)).mul(0.6).add(0.4), 0.0, 1.0);
    // 1/d beside the column, 1/d² farther out (past the column's own length its light is a
    // point's): the walls across the chamber keep their dark.
    const falloff = float(50.0).div(max(d, 50.0)).div(d.div(150.0).add(1.0));
    return facing.mul(falloff.mul(SUNFALL_LIGHT.column * 1.4)).mul(u.sunGain).mul(u.mistScale);
};

/** Irradiance from the oculus's patch of sky at `P` with normal `N` (solid angle × cosine). */
export const sfOculusSky = (u, P, N) => {
    const toOc = vec3(OCULUS_CENTER[0], OCULUS_CENTER[1] + 20.0, OCULUS_CENTER[2]).sub(P);
    const d2 = max(dot(toOc, toOc), 400.0);
    const L = toOc.div(d2.sqrt());
    const area = Math.PI * OCULUS_RX * OCULUS_RZ;
    const facing = clamp(dot(N, L).mul(0.75).add(0.25), 0.0, 1.0).mul(clamp(L.y, 0.0, 1.0));
    return facing.mul(area / Math.PI).div(d2).mul(u.cloudHoleOpen);
};

// ── Materials ───────────────────────────────────────────────────────────────────

/**
 * The chamber (`kind = 'shell'`) and the eye's rimstone ledge (`kind = 'ledge'`), lit by
 * their bakes. Bedded limestone with wet seepage, cream flowstone, green on lit ledges;
 * the ledge's dry gours with peacock spikemoss in the damp pool floors.
 */
export function createShellMaterial(u, { kind = 'shell' } = {}) {
    const isLedge = kind === 'ledge';
    const colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N0 = normalize(normalWorld).toVar();
        const C = attribute('color', 'vec4').toVar();
        const B = attribute('_bake', 'vec4').toVar();
        const ao = clamp(C.x, 0.0, 1.0).toVar();
        const sky = sfDecode(u, C.y, u.lightCeilSky).toVar();
        const sun = sfStationSun(u, C, B).toVar();
        const mask = clamp(B.w, 0.0, 1.0).toVar();

        // Bedded limestone: the field's 9.5 m rhythm of beds, each its own tone, warped.
        const broad = sfNoise3(u, P.mul(0.035)).toVar();
        const fine = sfNoise3(u, P.mul(vec3(0.42, 0.42, 0.42))).toVar();
        const stain = sfNoise3(u, P.mul(vec3(0.07, 0.022, 0.07))).toVar();
        // Relief the mesh is too coarse to carry (blocks, pockets, flutes): a bump on the normal
        // from screen derivatives of a rock height, faded where its grain is under a pixel.
        const relief0 = sfNoise3(u, P.mul(isLedge ? 0.9 : 0.16)).toVar();
        const h = relief0.x.mul(0.65).add(fine.y.mul(0.35)).toVar();
        const dpdx = dFdx(P);
        const dpdy = dFdy(P);
        const r1 = cross(dpdy, N0);
        const r2 = cross(N0, dpdx);
        const det = dot(dpdx, r1);
        const grain = length(fwidth(P.mul(isLedge ? 0.9 : 0.16)));
        const room = float(1.0).sub(smoothstep(0.3, 0.8, grain));
        const grad = r1.mul(dFdx(h)).add(r2.mul(dFdy(h))).mul(select(det.lessThan(0.0), float(-1.0), float(1.0)));
        const N = normalize(abs(det).mul(N0).sub(grad.mul(room.mul(isLedge ? 1.2 : 1.6)))).toVar();
        // Beds of uneven thickness (about 9.5 m on the walls), warped.
        const y0 = P.y.add(broad.x.sub(0.5).mul(16.0));
        const bed = (isLedge ? y0.div(1.1) : y0.div(9.5)
            .add(sin(y0.mul(0.252).add(1.3)).mul(0.15))
            .add(sin(y0.mul(0.537)).mul(0.06))).toVar();
        const bedIdx = floor(bed);
        const bf = fract(bed).toVar();
        const bedTone = sfHash11(bedIdx);
        const warmCool = sfHash11(bedIdx.add(17.0));
        // How far each bed's soft layer has weathered back under the bed above it.
        const deep = mix(0.2, 1.0, sfHash11(bedIdx.add(31.0))).toVar();
        const stone = mix(vec3(0.33, 0.36, 0.37), vec3(0.50, 0.45, 0.36), warmCool)
            .mul(mix(0.68, 1.15, bedTone)).mul(mix(0.80, 1.10, broad.y));
        // Dark wet seepage streaks down the walls; black and tan drip stains; grey dry patches.
        const steep = float(1.0).sub(smoothstep(0.45, 0.8, abs(N0.y))).toVar();
        const seepN = sfNoise3(u, P.mul(vec3(0.13, 0.011, 0.13))).x;
        const seep = smoothstep(0.55, 0.85, seepN).mul(steep).mul(0.85).toVar();
        const albedo = stone.mul(mix(1.0, 0.55, seep)).mul(mix(0.92, 1.06, fine.x))
            .mul(mix(0.70, 1.12, smoothstep(0.25, 0.75, stain.x)))
            .toVar();
        // What the rock's own form does to the light it gets (recesses, partings, cracks).
        const shade = float(1.0).toVar();
        const ledgeTop = float(0.0).toVar();
        const flow = float(0.0).toVar();

        if (isLedge) {
            // Dry calcite dams: pale, warm, with popcorn crusts on their exposed crests; the
            // pool floors behind them darker, damp grey-brown silt; spikemoss in the floors.
            const calcite = vec3(0.70, 0.64, 0.52).mul(mix(0.78, 1.08, fine.y));
            const silt = vec3(0.26, 0.23, 0.19).mul(mix(0.8, 1.1, stain.x));
            const crest = smoothstep(0.72, 0.95, ao);
            albedo.assign(mix(silt, calcite, mix(0.25, 1.0, crest)));
        } else {
            // The soft layer in the top third of each bed weathers back under the hard bed above:
            // darker, darkest in the parting under the overhang, with a lit ledge at its foot.
            // Faded to its mean where a bed is only a few pixels tall.
            const bw = max(fwidth(bed), 1e-4);
            const resolve = float(1.0).sub(smoothstep(0.12, 0.4, bw)).toVar();
            const soft = smoothstep(0.62, 0.70, bf).mul(float(1.0).sub(smoothstep(0.93, 0.995, bf)));
            const overhang = smoothstep(0.80, 0.965, bf).mul(float(1.0).sub(smoothstep(0.965, 1.0, bf)));
            const parting = float(1.0).sub(soft.mul(0.24)).sub(overhang.mul(steep).mul(0.45)).mul(deep)
                .add(float(1.0).sub(deep));
            shade.assign(mix(0.88, parting, resolve));
            ledgeTop.assign(smoothstep(0.54, 0.6, bf).mul(float(1.0).sub(smoothstep(0.6, 0.66, bf))).mul(resolve)
                .mul(deep));
            // The two vertical joint sets (the field's rotated lattice). Each crack runs through
            // its own block rows only, with its own width, in a darker weathered margin.
            const row = floor(bed.div(3.0));
            const crack = (j, metres, salt) => {
                const w = max(fwidth(j), 1e-4);
                const cell = floor(j.add(0.5));
                const d = abs(j.sub(cell));
                const live = smoothstep(0.6, 0.7, sfHash11(cell.mul(7.13).add(row.mul(13.7)).add(salt)))
                    .mul(smoothstep(0.3, 0.55, stain.y));
                const half = mix(0.15, 0.55, sfHash11(cell.add(row.mul(3.1)).add(salt + 5.0))).div(metres);
                const line = float(1.0).sub(smoothstep(half, w.add(half), d))
                    .mul(clamp(half.mul(2.0).div(w).add(0.1), 0.0, 1.0));
                const margin = float(1.0).sub(smoothstep(0.0, w.add(2.2 / metres), d)).mul(0.22);
                return max(line, margin).mul(live);
            };
            const ca = Math.cos(0.47);
            const sa = Math.sin(0.47);
            const jx = P.x.mul(ca).sub(P.z.mul(sa)).div(27.0).add(sfHash11(row.add(3.0)));
            const jz = P.x.mul(sa).add(P.z.mul(ca)).div(21.0).add(sfHash11(row.add(9.0)));
            const joints = max(crack(jx, 27.0, 0.0), crack(jz, 21.0, 50.0)).mul(mix(0.4, 1.0, steep));
            shade.mulAssign(float(1.0).sub(joints.mul(0.55)));

            // Flowstone draperies on the far right wall: curtains about 22 m wide along the wall
            // (its run there, 34° off the x axis), each its own length with a lobed lower edge,
            // fluted every 3 m (the flutes fade where they are under a few pixels).
            const FL = SUNFALL_LAYOUT.flowstone;
            const rel = P.xz.sub(vec2(FL.center[0], FL.center[1]));
            const envelope = float(1.0).sub(smoothstep(0.4, 1.0, length(rel).div(FL.radius)));
            const run = dot(rel, vec2(0.83, 0.56)).toVar();
            const arc = run.div(22.0).add(stain.x.sub(0.5).mul(0.5)).toVar();
            const cIdx = floor(arc);
            const cf = fract(arc);
            const ch = sfHash11(cIdx.add(41.0));
            const ch2 = sfHash11(cIdx.add(43.0));
            const across = float(1.0).sub(smoothstep(0.3, 0.5, abs(cf.sub(0.5)).mul(mix(0.85, 1.25, ch2))));
            const top = mix(30.0, 110.0, ch);
            const foot = mix(-130.0, -50.0, ch2).add(sin(run.mul(0.9)).mul(3.0)).add(sin(run.mul(0.37)).mul(5.0));
            const along = smoothstep(foot, foot.add(5.0), P.y).mul(float(1.0).sub(smoothstep(top.sub(40.0), top, P.y)));
            flow.assign(envelope.mul(across).mul(along).mul(smoothstep(0.15, 0.25, ch)));
            const fluteU = run.div(3.0);
            const fluteRoom = float(1.0).sub(smoothstep(0.25, 0.6, fwidth(fluteU)));
            const rib = cos(fluteU.mul(Math.PI * 2.0)).mul(0.5).add(0.5).sub(0.5)
                .mul(fluteRoom)
                .add(0.5);
            const cream = vec3(0.62, 0.55, 0.42).mul(mix(0.82, 1.08, stain.y)).mul(mix(0.9, 1.06, rib));
            albedo.assign(mix(albedo, cream, flow));
            shade.assign(mix(shade, mix(0.9, 1.03, rib), flow));
            // The forest floor outside and the vegetated shaft walls of the collapse.
            const outside = smoothstep(150.0, 176.0, P.y);
            albedo.assign(mix(albedo, vec3(0.09, 0.13, 0.05).mul(mix(0.7, 1.2, fine.x)), outside.mul(0.85)));
        }
        // Under the canopy: the understory's deep shade (seen only through gaps in the crowns).
        // The jungle floor is understory everywhere, crown or gap; so is anything under a crown.
        const floorZone = smoothstep(float(CANOPY_LEVEL + 48.0), float(CANOPY_LEVEL + 36.0), P.y)
            .mul(smoothstep(0.25, 0.6, N0.y));
        const underCrown = smoothstep(1.5, 6.0, sfCanopyHeight(u, P.xz).sub(P.y));
        const under = isLedge ? float(0.0) : max(underCrown, floorZone).toVar();

        // Green where the light reaches: moss and ferns on ledges and bed tops, more where wetter.
        const lightAvg = sun.mul(SUNFALL_LIGHT.sun).add(sky.mul(SUNFALL_LIGHT.sky));
        const upward = max(smoothstep(0.45, 0.85, N0.y), ledgeTop.mul(0.8));
        const growth = upward.mul(smoothstep(0.02, 0.4, lightAvg)).mul(smoothstep(0.3, 0.6, fine.y));
        albedo.assign(mix(albedo, vec3(0.05, 0.14, 0.035), growth.mul(0.85)));

        // Light: the baked sun (direct where it faces the sun high up, otherwise bounced off
        // the canopy: green-gold), the sky through the skylights, a floor of darkness.
        // Direct sun, where the bake holds it, is an order brighter than anything bounced.
        const aoC = ao.mul(ao).toVar();
        const direct = smoothstep(0.05, 0.3, dot(N0, u.sunDir)).mul(smoothstep(0.02, 0.09, sun));
        const sunTint = mix(u.bounceVault.mul(SUNFALL_LIGHT.bounce), u.beamCore, direct);
        // The sunlit pool as an area light (art-directed: the bounce off a canopy this far
        // below is weak; the doline's signature is the vault glowing green-gold above it). The
        // canopy sends its light mostly upward: the vault over the pool gets it, not the far walls.
        const toFoot = u.foot.add(vec3(0.0, 6.0, 0.0)).sub(P);
        const fd2 = max(dot(toFoot, toFoot), 900.0);
        const Lf = toFoot.div(fd2.sqrt());
        const poolArea = Math.PI * 58 * 58;
        const lobe = clamp(Lf.y.negate(), 0.0, 1.0);
        const poolLight = clamp(dot(N, Lf), 0.0, 1.0).mul(lobe.mul(lobe).mul(lobe.sqrt()))
            .mul(poolArea / Math.PI).div(fd2)
            .mul(aoC.mul(0.85).add(0.15))
            .mul(u.sunGain)
            .mul((SUNFALL_LIGHT.sun * 0.15 * SUNFALL_LIGHT.pool) / Math.PI);
        const poolTint = mix(u.bounceVault, vec3(1.0, 0.86, 0.55), 0.45);
        const tPool = poolTint.mul(poolLight);
        const tCol = u.beamScatter.mul(sfColumnLight(u, P, N)).mul(aoC.mul(0.8).add(0.2));
        const tSun = sun.mul(SUNFALL_LIGHT.sun).mul(u.sunGain).mul(sunTint);
        const tSky = sky.mul(SUNFALL_LIGHT.sky * 1.5).mul(u.skyGain).mul(mix(u.skyZenith, u.skyRim, 0.35));
        const tFill = u.caveShadow.mul(SUNFALL_LIGHT.fill * 20.0).mul(aoC);
        // The far doline's sunlit floor at the passage's end lights the passage round it (art-
        // directed like the pool: its true bounce, a kilometre off, is lost in the dark).
        const farDrop = float(FAR_DOLINE_CENTER[1] + 152.0).div(max(u.sunDir.y, 0.15));
        const farFoot = vec3(FAR_DOLINE_CENTER[0], -152.0, FAR_DOLINE_CENTER[2])
            .sub(vec3(u.sunDir.x, 0.0, u.sunDir.z).mul(farDrop));
        const toFar = farFoot.sub(P);
        const ff2 = max(dot(toFar, toFar), 900.0);
        const Lff = toFar.div(ff2.sqrt());
        const farLight = clamp(dot(N, Lff), 0.0, 1.0).mul(clamp(Lff.y.negate().mul(0.7).add(0.3), 0.0, 1.0))
            .mul(float(32.0 * 32.0).div(ff2))
            .mul(aoC.mul(0.85).add(0.15))
            .mul(u.sunGain.mul(float(1.0).add(u.echoBoost.mul(1.5))))
            .mul((SUNFALL_LIGHT.sun * 0.3 * SUNFALL_LIGHT.farPool) / Math.PI);
        const tFar = mix(u.beamCore, u.skyRim, 0.4).mul(farLight);
        const irr = tPool.add(tCol).add(tSun).add(tSky).add(tFill)
            .add(tFar)
            .mul(shade)
            .toVar();
        // Relief the bake is too coarse to hold: crevices darker, bosses lighter.
        const relief = mix(0.88, 1.08, fine.x).mul(mix(0.6, 1.0, ao));
        const understory = vec3(0.022, 0.05, 0.016).mul(mix(0.55, 1.35, fine.x));
        const col = mix(albedo.mul(irr).mul(relief), understory.mul(irr).mul(0.5), under).toVar();

        // Wet rock catches the column: a sheen toward its nearest stretch, on the seeps most.
        const V = normalize(cameraPosition.sub(P)).toVar();
        const toAxis = sfColumnAxisPoint(u, P).sub(P);
        const Lc = normalize(toAxis);
        const Rv = reflect(V.negate(), N);
        const lobeC = pow(clamp(dot(Rv, Lc), 0.0, 1.0), 18.0);
        const wet = mix(0.18, 1.0, max(seep, flow.mul(0.7))).mul(float(1.0).sub(under)).mul(isLedge ? 0.4 : 1.0);
        const nearC = float(80.0).div(max(length(toAxis), 80.0));
        col.addAssign(u.beamCore.mul(lobeC.mul(wet).mul(nearC.mul(nearC)).mul(aoC).mul(u.sunGain)
            .mul(0.9)));

        if (isLedge) {
            // The eye's ledge is far from every light: a soft light from the column's side gives
            // the dams their shape (the faces turned toward it lighter), so the frame's corners
            // read as rimstone, not as dark lumps.
            const side = clamp(dot(N, Lc).mul(0.5).add(0.5), 0.0, 1.0);
            col.addAssign(albedo.mul(u.beamScatter).mul(side.mul(side).mul(0.05)).mul(u.sunGain)
                .mul(mix(0.5, 1.0, ao)));
            // Peacock spikemoss: deep green face-on, iridescent blue at grazing angles, in fronds.
            const graze = clamp(float(1.0).sub(abs(dot(N, V))), 0.0, 1.0);
            const frond = sfNoise3(u, P.mul(3.2)).x;
            const film = mix(vec3(0.02, 0.085, 0.05), u.gourBlue.mul(0.9), graze.mul(graze).mul(1.4).min(1.0))
                .mul(mix(0.45, 1.25, frond));
            const patch = smoothstep(0.2, 0.6, mask).mul(smoothstep(0.3, 0.6, fine.y));
            col.assign(mix(col, film.mul(irr.mul(0.9).add(side.mul(0.05).mul(u.sunGain)).add(0.004)), patch));
        }
        return col;
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;
    return material;
}

/**
 * The jungle's crowns (instanced). `aCrown` = (tone, radius, seed, class: 1 emergent, +2 a
 * crown in natural flush). Leaf clusters are read in the crown's own frame so they never swim:
 * their relief is a bump on the normal from screen derivatives, faded out where a cluster is
 * smaller than a pixel. Occlusion and height in the crown come from its bake.
 */
export function createCrownMaterial(u) {
    const aCrown = attribute('aCrown', 'vec4');
    const aGrow = attribute('aGrow', 'vec4'); // piece code (-1 none), birth, tau, strength
    const positionNode = Fn(() => {
        // A slow sway in the downdraft from the oculus, more at the crown's top.
        const P = positionLocal;
        const seed = aCrown.z;
        const top = clamp(positionGeometry.y.add(1.0), 0.0, 1.0);
        const sway = sin(u.time.mul(0.45).add(seed.mul(6.28))).mul(0.3).mul(top);
        return P.add(vec3(sway, 0.0, sway.mul(0.6)));
    })();
    const colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N0 = normalize(normalWorld).toVar();
        const G = positionGeometry;
        const C = attribute('color', 'vec4').toVar();
        const ao = clamp(C.x, 0.0, 1.0).toVar();
        const height = clamp(C.y, 0.0, 1.0);
        const tone = aCrown.x;
        const seed = aCrown.z;
        const cls = floor(aCrown.w.add(0.5));

        // Five greens by crown, a few crowns in a muted natural flush.
        const idx = floor(tone.mul(5.0));
        let base = vec3(0.0);
        CROWN_GREENS.forEach((g, i) => {
            base = base.add(vec3(...g).mul(float(1.0).sub(clamp(abs(idx.sub(i)), 0.0, 1.0))));
        });
        const flush = mix(vec3(...NATURAL_FLUSH[0]), vec3(...NATURAL_FLUSH[1]), fract(seed.mul(7.0)));
        const isFlush = step(1.5, cls);
        const albedo0 = mix(base.mul(mix(0.82, 1.18, fract(seed.mul(13.0)))), flush, isFlush);

        // Leaf clusters: two scales of lattice noise in the crown's frame.
        const Gs = G.mul(6.5).add(vec3(seed.mul(41.0), seed.mul(17.0), seed.mul(5.0)));
        const leaf = sfNoise3(u, Gs).toVar();
        const twig = sfNoise3(u, Gs.mul(2.7)).toVar();
        const h = leaf.x.mul(0.7).add(twig.y.mul(0.3)).toVar();
        // Bump from screen derivatives (perturbNormalArb), faded by the clusters' footprint.
        const dpdx = dFdx(P);
        const dpdy = dFdy(P);
        const dhdx = dFdx(h);
        const dhdy = dFdy(h);
        const r1 = cross(dpdy, N0);
        const r2 = cross(N0, dpdx);
        const det = dot(dpdx, r1);
        const footprint = length(fwidth(Gs));
        const room = float(1.0).sub(smoothstep(0.35, 0.9, footprint));
        const grad = r1.mul(dhdx).add(r2.mul(dhdy)).mul(select(det.lessThan(0.0), float(-1.0), float(1.0)));
        const N = normalize(abs(det).mul(N0).sub(grad.mul(room.mul(2.2)))).toVar();
        const cavity = mix(0.55, 1.15, smoothstep(0.2, 0.8, h));
        const albedo = albedo0.mul(mix(1.0, cavity, mix(0.45, 1.0, room))).mul(mix(0.88, 1.08, leaf.y)).toVar();
        // New Growth: young leaves in a piece's pigment break out over the crown's top and green
        // on the world's clock; a perfect clear flushes every crown round the pool.
        const age = u.time.sub(aGrow.y);
        const young = exp(max(age, 0.0).div(max(aGrow.z, 1.0)).negate()).mul(smoothstep(0.0, 0.8, age))
            .mul(step(-0.5, aGrow.x));
        const toFootZ = P.xz.sub(u.foot.xz);
        const zenith = u.zenithPulse.mul(exp(dot(toFootZ, toFootZ).div(-150.0 * 150.0)));
        const top = smoothstep(0.35, 0.85, height).mul(smoothstep(0.35, 0.65, h));
        const flushCode = select(young.greaterThan(zenith), aGrow.x, floor(seed.mul(7.0)));
        const flushAmt = max(young, zenith).mul(top).mul(0.9);
        albedo.assign(mix(albedo, pieceSwatchNode(flushCode).mul(0.55), flushAmt));

        // The sun: the mask, the canopy's shadows, the leaves' facing and their translucency.
        const S = u.sunDir;
        const lit = sfSunMask(u, P).mul(sfCanopyShadow(u, P)).toVar();
        const ndl = dot(N, S);
        const diffuse = clamp(ndl.mul(0.8).add(0.2), 0.0, 1.0).mul(mix(0.6, 1.0, ao));
        const V = normalize(cameraPosition.sub(P));
        const through = clamp(dot(V, S).negate(), 0.0, 1.0);
        const trans = through.mul(clamp(float(0.55).sub(ndl.mul(0.45)), 0.0, 1.0)).mul(smoothstep(0.3, 0.7, h));
        const transmit = vec3(0.34, 0.52, 0.05);
        // Wet leaves throw small, sparse specular stars.
        const Hh = normalize(V.add(S));
        const spark = smoothstep(0.86, 0.97, twig.x).mul(room);
        const ndh = clamp(dot(N, Hh), 0.0, 1.0);
        const n4 = ndh.mul(ndh).mul(ndh).mul(ndh);
        const glint = n4.mul(n4).mul(n4).mul(spark).mul(float(0.6).add(u.wet.mul(2.0)));
        const direct = albedo.mul(diffuse).add(transmit.mul(trans).mul(0.22)).add(vec3(glint))
            .mul(u.beamCore)
            .mul(lit)
            .mul(u.sunGain)
            .mul(SUNFALL_LIGHT.sun);

        // Ambient: the oculus's sky, the lit pool's bounce, the cave's shade.
        const skyIrr = sfOculusSky(u, P, N).mul(SUNFALL_LIGHT.sky).mul(u.skyGain);
        const toFoot = P.xz.sub(u.foot.xz);
        const d2 = dot(toFoot, toFoot);
        const pool = exp(d2.div(-120.0 * 120.0)).mul(0.45).mul(u.sunGain);
        // The cave's own light on the canopy: the lit pool and the vault's bounce, falling away.
        const cave = u.mistTint.mul(float(0.28).add(exp(d2.div(-300.0 * 300.0)).mul(0.6)))
            .mul(u.sunGain.mul(0.7).add(0.3));
        const shade = mix(0.3, 1.0, height).mul(ao).mul(mix(0.5, 1.0, h));
        const colLight = sfColumnLight(u, P, N).toVar();
        const ambient = albedo.mul(
            u.skyZenith.mul(skyIrr).add(u.poolSun.mul(pool)).add(cave)
                .add(u.beamScatter.mul(colLight).mul(1.1)),
        ).mul(shade);
        // A crown between the eye and the column glows through its leaves with the column's
        // light, brightest at its ragged edge: never a dark ball against the lit pool.
        const Lc = normalize(sfColumnAxisPoint(u, P).sub(P)).toVar();
        const behind = clamp(dot(V, Lc).negate(), 0.0, 1.0);
        const behind2 = behind.mul(behind);
        const rimV = float(1.0).sub(abs(dot(N0, V)));
        const back = behind2.mul(behind2).mul(sfColumnLight(u, P, Lc)).mul(mix(0.3, 1.0, rimV))
            .mul(mix(0.55, 1.0, h));
        return direct.add(ambient).add(transmit.mul(u.beamScatter).mul(back).mul(0.32));
    })();
    // A leafy edge: near the crown's silhouette the gaps between leaf clusters open, so a crown
    // is ragged against what lies behind it, never a smooth ball. Off where clusters are sub-pixel.
    const opacityNode = Fn(() => {
        const seed = aCrown.z;
        const Gs = positionGeometry.mul(6.5).add(vec3(seed.mul(41.0), seed.mul(17.0), seed.mul(5.0)));
        const leaf = sfNoise3(u, Gs);
        const N0 = normalize(normalWorld);
        const V = normalize(cameraPosition.sub(positionWorld));
        const edge = float(1.0).sub(abs(dot(N0, V)));
        const room = float(1.0).sub(smoothstep(0.35, 0.9, length(fwidth(Gs))));
        const underside = float(1.0).sub(smoothstep(-0.9, -0.55, positionGeometry.y));
        const cut = smoothstep(0.45, 0.95, edge).mul(0.62).add(underside.mul(0.3))
            .mul(room);
        return smoothstep(cut.sub(0.04), cut.add(0.04), leaf.x);
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.opacityNode = opacityNode;
    material.alphaTest = 0.5;
    return material;
}

/**
 * The understory: the dark foliage under the canopy, seen through its gaps. Leaf masses in
 * world space (a bump from screen derivatives, faded where they are sub-pixel), sunflecks
 * where the sunfall reaches through a gap, and the cave's light, dimmer than on the crowns.
 * `aMask` cuts the layer away where no crowns stand round it, with a leafy edge.
 */
export function createUnderstoryMaterial(u) {
    const aMask = attribute('aMask', 'float');
    const colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N0 = normalize(normalWorld).toVar();
        const n1 = sfNoise3(u, P.mul(0.22)).toVar();
        const n2 = sfNoise3(u, P.mul(0.75)).toVar();
        const h = n1.x.mul(0.65).add(n2.y.mul(0.35)).toVar();
        const dpdx = dFdx(P);
        const dpdy = dFdy(P);
        const r1 = cross(dpdy, N0);
        const r2 = cross(N0, dpdx);
        const det = dot(dpdx, r1);
        const room = float(1.0).sub(smoothstep(0.35, 0.9, length(fwidth(P.mul(0.22)))));
        const grad = r1.mul(dFdx(h)).add(r2.mul(dFdy(h))).mul(select(det.lessThan(0.0), float(-1.0), float(1.0)));
        const N = normalize(abs(det).mul(N0).sub(grad.mul(room.mul(2.0)))).toVar();
        const broad = sfNoise3(u, P.mul(0.03));
        const cavity = mix(0.45, 1.15, smoothstep(0.2, 0.8, h));
        const albedo = mix(vec3(0.026, 0.066, 0.024), vec3(0.058, 0.1, 0.03), broad.x).mul(cavity).toVar();
        const S = u.sunDir;
        const lit = sfSunMask(u, P).mul(sfCanopyShadow(u, P));
        const ndl = clamp(dot(N, S).mul(0.8).add(0.2), 0.0, 1.0);
        const direct = albedo.mul(ndl).mul(u.beamCore).mul(lit).mul(u.sunGain)
            .mul(SUNFALL_LIGHT.sun);
        const toFoot = P.xz.sub(u.foot.xz);
        const d2 = dot(toFoot, toFoot);
        const pool = exp(d2.div(-120.0 * 120.0)).mul(0.3).mul(u.sunGain);
        const cave = u.mistTint.mul(float(0.16).add(exp(d2.div(-300.0 * 300.0)).mul(0.36)))
            .mul(u.sunGain.mul(0.7).add(0.3));
        const ambient = albedo.mul(u.poolSun.mul(pool).add(cave)
            .add(u.beamScatter.mul(sfColumnLight(u, P, N)).mul(0.5)))
            .mul(mix(0.5, 1.0, h));
        return direct.add(ambient);
    })();
    const opacityNode = Fn(() => {
        const leaf = sfNoise3(u, positionWorld.mul(0.3)).x;
        return smoothstep(0.45, 0.55, aMask.add(leaf.sub(0.5).mul(0.5)));
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.opacityNode = opacityNode;
    material.alphaTest = 0.5;
    return material;
}

/** Trunks of the surface forest round the oculus: dark bark, lit by the sun outside. */
export function createTrunkMaterial(u) {
    const colorNode = Fn(() => {
        const N = normalize(normalWorld);
        const lit = clamp(dot(N, u.sunDir).mul(0.6).add(0.4), 0.0, 1.0);
        const bark = vec3(0.07, 0.06, 0.045);
        return bark.mul(u.beamCore.mul(lit.mul(SUNFALL_LIGHT.sun * 0.35)).add(u.skyZenith.mul(0.6))).mul(u.sunGain);
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    return material;
}

/**
 * The sky outside, seen through the oculus and the far doline: deep tropical blue overhead,
 * white toward the sun, drifting cumulus. Drawn last among the opaque parts, only where the
 * rock leaves it uncovered.
 */
export function createSkyMaterial(u) {
    const colorNode = Fn(() => {
        const D = normalize(positionWorld.sub(cameraPosition)).toVar();
        const S = u.sunDir;
        const up = clamp(D.y, 0.0, 1.0);
        const base = mix(u.skyRim, u.skyZenith, smoothstep(0.1, 0.9, up));
        const toward = clamp(dot(D, S), 0.0, 1.0);
        const glow = toward.mul(toward).mul(toward).mul(toward);
        // Cumulus on a plane far above: billows from the fBm, lit white, grey beneath.
        const plane = D.xz.div(max(D.y, 0.08)).mul(0.11).add(vec2(u.time.mul(0.0016), u.time.mul(0.0009)));
        const cloud = texture(u.fbmTex, plane).x;
        const cover = smoothstep(0.52, 0.72, cloud).mul(smoothstep(0.08, 0.35, D.y));
        const cloudCol = mix(vec3(0.72, 0.76, 0.82), vec3(1.25, 1.22, 1.15), smoothstep(0.55, 0.85, cloud));
        const sky = mix(base, cloudCol, cover.mul(0.85)).mul(SUNFALL_LIGHT.sky)
            .add(u.beamCore.mul(glow.mul(9.0)))
            .mul(float(1.0).sub(u.overCloudClose.mul(0.6)));
        return sky;
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    return material;
}
