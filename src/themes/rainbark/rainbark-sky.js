/**
 * Rainbark — the backdrop: the air of the grove, painted along every view ray where no trunk
 * stands in front of it.
 *
 *  - The haze: blue-violet shade, warming to sunlit vapour toward the sun on the right
 *    (Henyey–Greenstein forward scatter, and broadly on the sun's side) and to the sun's gold
 *    toward its azimuth, with one luminous core between the aisle and Sister One (the picture's
 *    light source); darker upward, and indigo on the shade side; glowing with the mist's light on
 *    rays that meet the mist's top near (rbInscatter).
 *  - Above, the canopy plane (yC, rbCanopy): foliage seen from below, dark clumps of leaves (a
 *    signed field of round clumps in leaf masses ragged by pointed sprays, the crowns 15–25 m
 *    with the channels of crown shyness between them) against the sky, crisp at any distance,
 *    the crown tile bombed in turned and mirrored cells; dark in a mass's heart, a fringe of lit
 *    leaves at its rim toward the sun, single leaves ragging the edges near, the crowns' limbs
 *    dark lines across the openings, no opening narrower than a few pixels (never a scatter of
 *    chips nor a hairline vein), the openings Skylight rising to the zenith's azure and only those
 *    toward the sun whitening, and the crown gap above the card on an upright screen ringed by
 *    clump silhouettes. Far along the ray it melts into the air's own light (thin on rays that
 *    climb steeply, AIR_UPWARD): at the Bole it is a dark band along the top edge, its crowns
 *    parted by rivers of light; from the Limb Storey up it fills the top of the frame; in a
 *    pearly zone it is a faint shadow in the pearl.
 *  - Below, the mist floor's top (rbMistField, rbMistTop): cream, brighter toward the sun,
 *    rippled into soft billows (two octaves of lattice noise drifting and boiling; one on Low and
 *    Minimal) shaded by their slope to the sun (lit fronts, lees in the skylight's blue: warm on
 *    cool), broad pools of sun lying
 *    on it, faintly tinted by the bark above, seen through the haze, which glows with the mist's
 *    light only where the mist is near (the bottom of the frame: the band from the horizon down
 *    stays blue air) and carries the billows' and pools' light (rbMistAir); its light never far
 *    over the air's in front of it. Breaking out on top of it (the eye within a few metres of the
 *    tide, MIST_BREAKOUT) the vapour toward the horizon melts into the haze itself, so no open sea
 *    of cloud runs out to a horizon line, the top stays under the haze's light with its lees
 *    diffuse, and an eye skimming the top sees its pattern softened by its own thin vapour
 *    (MIST_SKIM). A pale, neutral top leans to the sun's cream on its lit side (MIST_WARM). From inside the mist, the vapour's interior (rbMistInterior):
 *    a cool, high-key pearl, cream toward the sun, glowing toward its lit top, its density
 *    varying slowly.
 *  - The impostor ranks: the endless grove beyond the trunks, as faint vertical stripes at 300,
 *    420 and 600 m (one per rank's spacing, jittered and thinned per stripe, thinner and fainter
 *    toward the sun), from down in the mist (their feet plunge on into the vapour and fade with
 *    its transmittance, so many faint verticals break the far band over the mist) up to the
 *    canopy (each top dissolving into it in a band of its own). Each is shaded as the far group's
 *    mean bark, lit on its sun side and by the mist's bounce (the trunks' own, rbBounce), down in
 *    the mist by the vapour's light (rbDrown), and put through the air at its distance; edges
 *    anti-aliased by the pixel's angle. Low paints two ranks, Minimal one.
 * Both planes and every rank are reached with the same closed-form air (rbAir), so the frame is
 * continuous at the horizon: a ray that grazes a plane has crossed so much air it shows only haze.
 * The floor comes with a later stage.
 *
 * One far-plane triangle (vertexNode at z = w), drawn after the solids with the depth test on, so
 * it is shaded only where it shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    clamp,
    cos,
    dot,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    screenUV,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    MIST_DROWN_LIGHT,
    MIST_SEEN_DEPTH,
    PALETTE_ROWS,
    rbAir,
    rbBounce,
    rbCanopy,
    rbDrown,
    rbHash21,
    rbInscatter,
    rbMistField,
    rbMistFlat,
    rbPart,
    rbSkyFill,
    rbVapour,
    rbViewRay,
} from './rainbark-tsl.js';

/** The bounce's facing term (rbBounce) on upright bark: N.y = 0 in §2.4's 0.45 + 0.55·max(0, 0.3 − N.y). */
const UPRIGHT_FACING = 0.45 + 0.55 * 0.3;

/**
 * The impostor ranks (§4.4): distance D and stripe spacing S (metres), a phase per rank. Low keeps
 * the first two, Minimal the first.
 */
export const IMPOSTOR_RANKS = Object.freeze([
    Object.freeze({ distance: 300, spacing: 11, phase: 0.37 }),
    Object.freeze({ distance: 420, spacing: 13, phase: 0.71 }),
    Object.freeze({ distance: 600, spacing: 15, phase: 0.13 }),
]);
/**
 * The share of a rank's stripe places left empty (so the ranks never read as a fence): `shade`
 * looking away from the sun, `sun` toward it (the grove thins out into the luminous air on the
 * sun's side, the diagonal recession of §2.1), where a stripe also shows `fade` of its contrast.
 * The weight follows the cosine between a stripe's azimuth and the sun's, from `from` to `to`.
 */
export const IMPOSTOR_GAPS = Object.freeze({
    shade: 0.15, sun: 0.55, from: -0.1, to: 0.7, fade: 0.6,
});

/**
 * A stripe's foot plunges on into the mist: the vapour's own transmittance along its ray fades it
 * (rbAir, as it does a trunk's), so the far band over the mist is broken by many faint verticals
 * and never reads as an open sea of cloud (§9 #4: the ranks always occlude the far mist). Under
 * `deep` metres below the tide, less up to `spread` per stripe, nothing of it is left to paint
 * (the mask stops there, softly over `soft` metres).
 */
export const IMPOSTOR_FEET = Object.freeze({ deep: 26, spread: 10, soft: 8 });
/**
 * Where a stripe's top dissolves into the canopy: from `from` to `to` metres round the canopy
 * plane, moved up or down by up to `spread` metres per stripe (the ghost grove's tops never line
 * up into one fringe under the canopy).
 */
export const IMPOSTOR_TOPS = Object.freeze({ from: -34, to: 2, spread: 12 });

/**
 * The impostor ranks over `col` (farthest first): each stripe the far group's mean bark, lit on
 * its sun side, through the air at its distance (the air's light along the ray is the same for
 * every rank: only the transmittance is each rank's own). A stripe's foot plunges into the mist
 * and fades with the vapour's transmittance (IMPOSTOR_FEET), its top dissolves into the canopy in
 * a band of its own (a fifth hash), so the ranks never end on one line; toward the sun more
 * stripe places stand empty and the rest show fainter (IMPOSTOR_GAPS).
 */
function impostorRanks(u, dir, col, ranks, pre) {
    const horiz = max(length(dir.xz), 1e-3).toVar();
    const az = atan(dir.x, dir.z.negate()).toVar();
    const facing = dir.xz.div(horiz).toVar();
    const sunRight = dot(vec2(facing.y.negate(), facing.x), u.sunDir.xz).toVar();
    const sunToward = dot(facing.negate(), u.sunDir.xz).toVar();
    const mean = u.palette.element(int(PALETTE_ROWS.groupMean + 3)).xyz;
    const sunFlat = normalize(u.sunDir.xz).toVar();
    for (let k = ranks - 1; k >= 0; k--) {
        const { distance: D, spacing: S, phase } = IMPOSTOR_RANKS[k];
        const t = float(D).div(horiz);
        const P = u.camPos.add(dir.mul(t)).toVar();
        const coord = az.mul(D / S).add(phase);
        const cell = floor(coord);
        const h1 = rbHash21(vec2(cell, 17.3 + k * 5.0));
        const h2 = rbHash21(vec2(cell.add(91.7), 3.1 + k * 5.0));
        const h3 = rbHash21(vec2(cell.add(37.9), 11.9 + k * 5.0));
        const h4 = rbHash21(vec2(cell.add(53.3), 7.7 + k * 5.0));
        const h5 = rbHash21(vec2(cell.add(19.1), 13.3 + k * 5.0));
        // The stripe's own azimuth (its cell's centre), and how far it looks toward the sun.
        const azCell = cell.add(0.5 - phase).mul(S / D);
        const toSun = sin(azCell).mul(sunFlat.x).sub(cos(azCell).mul(sunFlat.y));
        const sunSide = smoothstep(IMPOSTOR_GAPS.from, IMPOSTOR_GAPS.to, toSun);
        const gaps = mix(float(IMPOSTOR_GAPS.shade), float(IMPOSTOR_GAPS.sun), sunSide);
        const loc = fract(coord).sub(0.5).sub(h1.sub(0.5).mul(0.25));
        const halfW = h2.mul(0.6).add(1.1).div(S);
        // One pixel, in stripe units (an azimuth step shrinks on screen as the ray climbs).
        const aa = u.pixelAngle.mul(D / S).div(horiz);
        const stripe = float(1.0).sub(smoothstep(halfW.sub(aa), halfW.add(aa), abs(loc)));
        // From down in the mist (the vapour fades its foot, rbAir) to the canopy (dissolving into
        // the lace).
        const foot = u.tide.sub(h4.mul(IMPOSTOR_FEET.spread).add(IMPOSTOR_FEET.deep));
        const rise = smoothstep(foot, foot.add(IMPOSTOR_FEET.soft), P.y);
        const top = u.canopyY.add(h5.sub(0.5).mul(2 * IMPOSTOR_TOPS.spread));
        const fade = float(1.0).sub(smoothstep(top.add(IMPOSTOR_TOPS.from), top.add(IMPOSTOR_TOPS.to), P.y));
        const faint = mix(float(1.0), float(IMPOSTOR_GAPS.fade), sunSide);
        const m = stripe.mul(step(gaps, h3)).mul(rise).mul(fade).mul(faint);
        // A round trunk: lit across its width on the sun's side, the sky above, the mist's bounce
        // (the trunks' own, rbBounce, on upright bark).
        const across = clamp(loc.div(halfW), -1.0, 1.0);
        const nl = across.mul(sunRight).add(sqrt(float(1.0).sub(across.mul(across))).mul(sunToward)).toVar();
        const away = float(1.0).sub(smoothstep(-0.2, 0.2, nl));
        const bounce = rbBounce(u, P.y, float(UPRIGHT_FACING), away);
        const sky = u.col.sky.mul(rbSkyFill(u, P.y).mul(0.26));
        const shone = mean.mul(sky.add(bounce).add(u.sunCol.mul(max(nl, 0.0).mul(u.fleckMean).mul(u.fleckLight))));
        // (Down in the mist, the vapour's light instead, as on the trunks: rbDrown.)
        const lit = mix(shone, mean.mul(u.col.mistTop).mul(MIST_DROWN_LIGHT), rbDrown(u, P.y));
        col.assign(mix(col, rbAir(u, lit, P, pre), m));
    }
    return col;
}

/**
 * The backdrop's light along a view direction. The canopy and the mist are branches (a coherent
 * half of the frame skips the other's texture reads and air); the air's light along the ray is
 * found once and shared by both and by every impostor rank.
 * @param {object} u    the shared uniforms
 * @param {object} dir  unit direction (vec3 node, pinned with toVar)
 * @param {object} [options]
 * @param {number} [options.impostors]  impostor ranks to paint (the tier's)
 * @param {number} [options.billows]  octaves of the mist top's billows (the tier's)
 * @param {boolean} [options.lite]  the canopy's Low and Minimal path (the tier's, CANOPY)
 * @returns {object} vec3 node (scene-linear HDR)
 */
export function rbBackdrop(u, dir, { impostors = IMPOSTOR_RANKS.length, billows = 2, lite = false } = {}) {
    const inscatter = rbInscatter(u, dir).toVar();
    // The mist's light along the ray: on a ray down its top, shaded by its field (the billows' lit
    // fronts and blue lees, the sun's pools), which impostor feet sinking into it melt into too
    // (rbAir), so they are the pixels round them; on a ray up the flat top, the veil in front of
    // anything inside the mist (from inside, the interior either way).
    const field = vec3(rbMistFlat()).toVar();
    If(dir.y.lessThan(0.0), () => {
        field.assign(rbMistField(u, dir, { billows }));
    });
    const vapour = rbVapour(u, dir, field, inscatter).toVar();
    const pre = { inscatter, vapour, field };
    const col = vec3(0.0).toVar();
    If(dir.y.greaterThan(0.0), () => {
        // Above: the canopy plane, its crowns and lace over the sky, through the air.
        col.assign(rbCanopy(u, dir, pre, { lite }));
    }).Else(() => {
        // Below: the mist floor's top seen through the haze: cream billows drifting, lit on their
        // fronts toward the sun and blue in their lees, broad pools of sun, the haze over them
        // carrying their light. Inside the mist (Mistfall, the Fog Line) there is no top to look
        // down on: the vapour is its interior, darker and cooler with depth, matching the air at
        // the horizon. (The vapour a ray sees lies MIST_SEEN_DEPTH into the mist, where its density
        // has built up, not on the tide's plane: the haze in front of a trunk's foot sunk past it
        // runs to the same plane, so the foot melts into the very pixel painted round it.)
        const downY = min(dir.y, -1e-3);
        const tDown = max(u.camPos.y.sub(u.tide).add(MIST_SEEN_DEPTH), 0.5).div(downY.negate());
        const atMist = u.camPos.add(dir.mul(tDown));
        col.assign(rbAir(u, vapour, atMist, pre, { opaque: true }));
    });
    if (impostors > 0) impostorRanks(u, dir, col, Math.min(impostors, IMPOSTOR_RANKS.length), pre);
    return col;
}

/**
 * The backdrop part.
 * @param {object} u     the shared uniforms
 * @param {object} tier  the content tier (its impostor ranks, billow octaves and canopy reads)
 */
export function createSky(u, tier = {}) {
    const impostors = Number.isFinite(tier.impostors) ? tier.impostors : IMPOSTOR_RANKS.length;
    const billows = Number.isFinite(tier.billows) ? tier.billows : 2;
    const lite = tier.canopy === 'lite';
    const backdropFn = Fn(() => {
        const d = rbViewRay(u, screenUV).toVar();
        return vec4(max(rbBackdrop(u, d, { impostors, billows, lite }), vec3(0.0)), 1.0);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: false });
    material.name = 'RainbarkSky';
    material.fog = false;
    material.depthFunc = THREE.LessEqualDepth;
    // At the far plane: anything solid in front of it keeps its pixels.
    material.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    material.colorNode = backdropFn();
    // Drawn after the solids among the opaque parts, so it is shaded only where it shows.
    const part = rbPart('RainbarkSky', geometry, material, 50);
    part.impostors = impostors;
    return part;
}
