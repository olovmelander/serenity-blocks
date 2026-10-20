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
    select,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CANOPY_LEVEL,
    OCULUS_CENTER,
    OCULUS_RX,
    OCULUS_RZ,
    PIECE_SWATCH_RGB,
    SUNFALL_STATIONS,
} from './sunfall-core.js';
import { LATTICE_SIZE, LATTICE_SLICE, OCULUS_TEX } from './sunfall-bake.js';

const TWO_PI = Math.PI * 2;

/** Light gains (HDR units per unit of Blender sun/sky in the bakes). */
export const SUNFALL_LIGHT = Object.freeze({
    sun: 13.0,          // direct sun irradiance: a lit crown of albedo 0.15 shows about 2
    bounce: 6.0,        // extra weight on the baked bounce (the vault's glow from below)
    sky: 6.0,           // sky radiance seen through the oculus
    fill: 0.0045,       // the cave's own darkness floor, times occlusion
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
        pixelAngle: uniform(2 * Math.tan((26 * Math.PI) / 180) / 1080),
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
 */
export const sfMaskAt = (u, q, along, { vines: withVines = true } = {}) => {
    const open = max(u.cloudHoleOpen, 0.2);
    const qq = q.div(open);
    const r = length(qq);
    const ang = atan(qq.y, qq.x).div(TWO_PI).add(0.5);
    const v = clamp(r.div(OCULUS_TEX.reach), 0.0, 1.0);
    // Penumbra: the sun disc (0.0093 rad) over the distance, in radial texels of the map.
    const texel = (OCULUS_TEX.reach * Math.min(OCULUS_RX, OCULUS_RZ)) / OCULUS_TEX.height;
    const lod = clamp(log2(max(along.mul(0.0093).div(texel), 1.0)), 0.0, 4.0);
    const rim = texture(u.oculusTex, vec2(ang, v)).level(lod).x;
    const vines = withVines ? texture(u.oculusTex, vec2(ang.add(u.fringeAngle.div(TWO_PI)), v)).level(lod).y : float(1.0);
    const base = rim.mul(mix(1.0, vines, 0.9));
    // Combo fingers: the vines close over the opening except for gaps on a ring, one per link.
    const n = u.comboColumns;
    let fingers = float(0.0);
    for (let k = 0; k < 7; k += 1) {
        const a = float(k).mul(TWO_PI).div(max(n, 1.0)).add(0.4);
        const c = vec2(cos(a), sin(a)).mul(select(n.greaterThan(1.5), float(0.52), float(0.0)));
        const live = clamp(n.sub(k), 0.0, 1.0);
        fingers = max(fingers, float(1.0).sub(smoothstep(0.13, 0.19, length(q.sub(c)))).mul(live));
    }
    const comboOn = smoothstep(0.12, 0.42, u.comboLift);
    return base.mul(mix(1.0, max(fingers, 0.14), comboOn));
};

/** The sunfall's mask at a world point (1 above the oculus plane: the open air outside). */
export const sfSunMask = (u, P) => {
    const along = max(float(OCULUS_CENTER[1]).sub(P.y), 0.0).div(max(u.sunDir.y, 0.15));
    const m = sfMaskAt(u, sfOculusCoord(u, P), along);
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
    Loop({ start: 0, end: steps, type: 'int', condition: '<', name: 'cs' }, ({ cs }) => {
        const t = float(cs).add(1.0).mul(stride);
        const q = P.add(u.sunDir.mul(t));
        const h = sfCanopyHeight(u, q.xz);
        occ.addAssign(smoothstep(q.y.sub(0.6), q.y.add(2.2), h).mul(0.5));
    });
    return clamp(float(1.0).sub(occ), 0.0, 1.0);
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
        const N = normalize(normalWorld).toVar();
        const C = attribute('color', 'vec4').toVar();
        const B = attribute('_bake', 'vec4').toVar();
        const ao = clamp(C.x, 0.0, 1.0).toVar();
        const sky = sfDecode(u, C.y, u.lightCeilSky).toVar();
        const sun = sfStationSun(u, C, B).toVar();
        const mask = clamp(B.w, 0.0, 1.0).toVar();

        // Bedded limestone: beds a few metres thick, each its own tone, warped.
        const broad = sfNoise3(u, P.mul(0.035)).toVar();
        const fine = sfNoise3(u, P.mul(vec3(0.42, 0.42, 0.42))).toVar();
        const bed = P.y.add(broad.x.sub(0.5).mul(18.0)).div(isLedge ? 1.1 : 7.5);
        const bedTone = sfHash11(floor(bed));
        const warmCool = sfHash11(floor(bed).add(17.0));
        const stone = mix(vec3(0.36, 0.39, 0.40), vec3(0.50, 0.46, 0.38), warmCool)
            .mul(mix(0.74, 1.12, bedTone)).mul(mix(0.82, 1.1, broad.y));
        // Dark wet seepage streaks down the walls.
        const steep = float(1.0).sub(smoothstep(0.45, 0.8, abs(N.y)));
        const seepN = sfNoise3(u, P.mul(vec3(0.13, 0.011, 0.13))).x;
        const seep = smoothstep(0.55, 0.85, seepN).mul(steep).mul(0.8);
        const albedo = stone.mul(mix(1.0, 0.6, seep)).mul(mix(0.85, 1.12, fine.x)).toVar();

        if (isLedge) {
            // Dry calcite dams: pale, warm, with popcorn crusts; spikemoss in the pool floors.
            const calcite = vec3(0.70, 0.64, 0.52).mul(mix(0.78, 1.08, fine.y));
            albedo.assign(mix(calcite, albedo, 0.25));
        } else {
            // Flowstone curtains: cream calcite, its ribs catching more light.
            const rib = sfNoise3(u, P.mul(vec3(0.9, 0.05, 0.9))).x;
            const cream = vec3(0.80, 0.71, 0.54).mul(mix(0.82, 1.08, rib));
            albedo.assign(mix(albedo, cream, smoothstep(0.15, 0.7, mask)));
            // The forest floor outside and the vegetated shaft walls of the collapse.
            const outside = smoothstep(150.0, 176.0, P.y);
            albedo.assign(mix(albedo, vec3(0.09, 0.13, 0.05).mul(mix(0.7, 1.2, fine.x)), outside.mul(0.85)));
        }
        // Under the canopy: the understory's deep shade (seen only through gaps in the crowns).
        // The jungle floor is understory everywhere, crown or gap; so is anything under a crown.
        const floorZone = smoothstep(float(CANOPY_LEVEL + 14.0), float(CANOPY_LEVEL + 4.0), P.y).mul(smoothstep(0.2, 0.55, N.y));
        const under = isLedge ? float(0.0) : max(smoothstep(1.5, 6.0, sfCanopyHeight(u, P.xz).sub(P.y)), floorZone).toVar();

        // Green on ledges that the light reaches (moss, ferns), more where it is wetter.
        const lightAvg = sun.mul(SUNFALL_LIGHT.sun).add(sky.mul(SUNFALL_LIGHT.sky));
        const upward = smoothstep(0.45, 0.85, N.y);
        const growth = upward.mul(smoothstep(0.02, 0.5, lightAvg)).mul(smoothstep(0.35, 0.65, fine.y));
        albedo.assign(mix(albedo, vec3(0.06, 0.15, 0.04), growth.mul(0.85)));

        // Light: the baked sun (direct where it faces the sun high up, otherwise bounced off
        // the canopy: green-gold), the sky through the skylights, a floor of darkness.
        const direct = smoothstep(0.05, 0.35, dot(N, u.sunDir)).mul(smoothstep(105.0, 145.0, P.y));
        const sunTint = mix(u.bounceVault.mul(SUNFALL_LIGHT.bounce), u.beamCore, direct);
        const irr = sun.mul(SUNFALL_LIGHT.sun).mul(u.sunGain).mul(sunTint)
            .add(sky.mul(SUNFALL_LIGHT.sky).mul(u.skyGain).mul(mix(u.skyZenith, u.skyRim, 0.35)))
            .add(u.caveShadow.mul(SUNFALL_LIGHT.fill * 20.0).mul(ao));
        // Relief the bake is too coarse to hold: crevices darker, bosses lighter.
        const relief = mix(0.72, 1.18, fine.x).mul(mix(0.55, 1.0, ao));
        const understory = vec3(0.014, 0.026, 0.010).mul(mix(0.6, 1.3, fine.x));
        const col = mix(albedo.mul(irr).mul(relief), understory.mul(irr).mul(0.25), under).toVar();

        if (isLedge) {
            // Peacock spikemoss: deep green face-on, electric blue at grazing angles.
            const V = normalize(cameraPosition.sub(P));
            const graze = clamp(float(1.0).sub(abs(dot(N, V))), 0.0, 1.0);
            const film = mix(vec3(0.02, 0.10, 0.06), u.gourBlue.mul(1.4), graze.mul(graze).mul(1.6).min(1.0));
            const patch = smoothstep(0.2, 0.6, mask).mul(smoothstep(0.3, 0.6, fine.y));
            col.assign(mix(col, film.mul(irr.mul(0.9).add(0.03)), patch));
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
            .mul(u.beamCore).mul(lit).mul(u.sunGain).mul(SUNFALL_LIGHT.sun);

        // Ambient: the oculus's sky, the lit pool's bounce, the cave's shade.
        const skyIrr = sfOculusSky(u, P, N).mul(SUNFALL_LIGHT.sky).mul(u.skyGain);
        const toFoot = P.xz.sub(u.foot.xz);
        const d2 = dot(toFoot, toFoot);
        const pool = exp(d2.div(-120.0 * 120.0)).mul(0.45).mul(u.sunGain);
        // The cave's own light on the canopy: the lit pool and the vault's bounce, falling away.
        const cave = u.mistTint.mul(float(0.28).add(exp(d2.div(-300.0 * 300.0)).mul(0.6))).mul(u.sunGain.mul(0.7).add(0.3));
        const shade = mix(0.3, 1.0, height).mul(ao).mul(mix(0.5, 1.0, h));
        const ambient = albedo.mul(
            u.skyZenith.mul(skyIrr).add(u.poolSun.mul(pool)).add(cave),
        ).mul(shade);
        return direct.add(ambient);
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
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
