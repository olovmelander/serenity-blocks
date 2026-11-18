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
 *  - The Floor (a perfect clear, u.drain): with the mist drained the rays down meet the forest
 *    floor at y = 0 (FLOOR): moss and fern broken by drifts of litter and wet earth, a river
 *    winding through it that mirrors the gold air and glitters where the flecks reach it, the
 *    session's shed curls as a carpet of bark colours, broad pools of sun; the impostor feet
 *    stop at it. Read only while it shows.
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
    FLOOR,
    MIST_DROWN_LIGHT,
    MIST_SEEN_DEPTH,
    PALETTE_ROWS,
    hexToLinear,
    rbAir,
    rbFleck,
    rbLuma,
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

/** The floor's colours (linear): moss, sunlit fern, leaf litter, wet earth, the river's glint. */
const MOSS = hexToLinear(FLOOR.moss);
const FERN = hexToLinear(FLOOR.fern);
const LITTER = hexToLinear(FLOOR.litter);
const EARTH = hexToLinear(FLOOR.earth);
const GLINT = hexToLinear(FLOOR.glint);

/**
 * The forest floor along a ray down (the Floor): a rainforest's floor seen from the walkway, so
 * what reads is its large shapes. A carpet of moss and fern (deep green, lime where the canopy's
 * light pools on it) broken by drifts of leaf litter and bare wet earth; one river winding through
 * it with a tributary, wide enough to read as water, mirroring the gold air toward the sun and the
 * blue away from it, glittering where a fleck lands on it, its banks dark and wet, a breath of
 * mist lying along it; the session's shed bark as a carpet of colour where the eye is near enough
 * to resolve it; all of it through the thinned air. Nothing here is finer than a pixel: every
 * pattern melts into its mean as its footprint grows.
 */
function rbFloor(u, dir) {
    const t = u.camPos.y.div(max(dir.y.negate(), 1e-3));
    const F = u.camPos.add(dir.mul(t)).toVar();
    // (Metres of floor a pixel covers along the ray, as a share of a pattern's size.)
    const foot = t.mul(u.pixelAngle).div(max(dir.y.negate(), 0.05)).toVar();
    const fine = u.fbm(F.xz.div(9.0)).toVar();
    const broad = u.fbm(F.xz.div(64.0).add(vec2(0.31, 0.77))).toVar();
    // The ground: moss and fern, drifts of litter, bare earth; mottled where it resolves.
    const mottle = mix(float(1.0), fine.g.mul(0.7).add(0.65), float(1.0).sub(smoothstep(0.4, 2.2, foot)));
    const litterK = smoothstep(0.56, 0.72, broad.g).mul(0.7);
    const earthK = smoothstep(0.64, 0.76, broad.b).mul(0.6);
    const green = mix(vec3(...MOSS), vec3(...FERN), smoothstep(0.35, 0.75, broad.a));
    const ground = mix(mix(green, vec3(...LITTER), litterK), vec3(...EARTH), earthK).mul(mottle).toVar();
    // The river: one water running away through the grove on the sun's side, swinging from side to
    // side as it goes (two waves along its course), its width swelling and narrowing; the distance
    // to its middle is measured square to its course. Never a contour drawn on the floor: a river
    // has one course and no rings.
    const R = FLOOR.river;
    const { z } = F;
    const a1 = z.div(R.wave[0]).add(1.0);
    const a2 = z.div(R.wave[1]).add(2.3);
    const course = sin(a1).mul(R.swing[0]).add(sin(a2).mul(R.swing[1])).add(R.offset);
    const slope = cos(a1).mul(R.swing[0] / R.wave[0]).add(cos(a2).mul(R.swing[1] / R.wave[1]));
    const off = abs(F.x.sub(course)).div(sqrt(slope.mul(slope).add(1.0))).toVar();
    const half = mix(float(R.width[0]), float(R.width[1]), broad.r).toVar();
    const aa = max(foot.mul(R.aa), 0.3);
    const water = float(1.0).sub(smoothstep(half, half.add(aa), off)).toVar();
    // (Its banks wet and dark a little way out from the water: a river lies in the floor.)
    const bank = float(1.0).sub(smoothstep(half, half.mul(R.bank), off)).toVar();
    // The carpet of shed curls, where a strip resolves; its mean tint beyond.
    const cellA = floor(F.xz.mul(vec2(1.4, 5.5)));
    const cellB = floor(F.xz.mul(vec2(5.5, 1.4)).add(vec2(0.5, 0.5)));
    const h = min(rbHash21(cellA), rbHash21(cellB.add(vec2(41.0, 7.0))));
    const h2 = rbHash21(cellA.add(vec2(17.1, 3.3)));
    const resolve = float(1.0).sub(smoothstep(0.05, 0.16, foot));
    const curl = step(h, u.carpet.mul(0.32)).mul(resolve).add(u.carpet.mul(0.32 * 0.6).mul(float(1.0).sub(resolve)));
    const bark = mix(vec3(rbLuma(u.ramp(h2.mul(0.97)))), u.ramp(h2.mul(0.97)), 0.7).mul(0.5);
    const meanBark = vec3(0.32, 0.2, 0.14).mul(0.6);
    const albedo = mix(ground, mix(meanBark, bark, resolve), curl.mul(float(1.0).sub(water)))
        .mul(float(1.0).sub(bank.mul(R.wet)))
        .toVar();
    // Light: the canopy's flecks (from this far down, broad soft pools), the sky through the crowns.
    const fl = rbFleck(u, F, { lod: 'fixed', foot }).mul(u.fleckLight).toVar();
    const sun = u.sunCol.mul(max(fl, u.fleckMean.mul(u.fleckLight).mul(0.7))).mul(u.sunDir.y).mul(FLOOR.sun);
    const sky = u.col.sky.mul(0.3);
    // The water mirrors the gold air toward the sun and the blue away from it (a mirror of the
    // sky, so darker than the lit air itself), and glitters where a fleck lands on it (broad
    // glitter: its ripples are far finer than a pixel).
    const sunward = dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(u.sunDir.x, 0.0, u.sunDir.z)));
    const mirror = mix(u.col.sky.mul(R.mirror[0]), u.col.hazeSun.mul(R.mirror[1]), smoothstep(-0.3, 0.8, sunward));
    const glitter = vec3(...GLINT).mul(min(fl, 1.4).mul(smoothstep(0.45, 0.8, fine.a)).mul(R.glitter));
    const wet = mirror.add(glitter).mul(u.iris);
    // (A breath of mist along the river: what is left of the drained floor's vapour.)
    const breath = smoothstep(0.35, 0.8, broad.r.mul(0.5).add(fine.r.mul(0.5))).mul(bank).mul(R.breath);
    const lit = mix(albedo.mul(sun.add(sky)), wet, water).toVar();
    lit.assign(mix(lit, u.col.mistTop.mul(0.8), breath));
    return rbAir(u, lit, F, null, { billows: 0 });
}

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
        // (With the floor showing, a stripe stands on it: nothing of it below y = 0.)
        const onFloor = float(1.0).sub(u.drain.mul(step(P.y, 0.0)));
        const m = stripe.mul(step(gaps, h3)).mul(rise).mul(fade).mul(faint)
            .mul(onFloor);
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
        // The Floor: with the mist drained, the forest floor far below.
        If(u.drain.greaterThan(0.001), () => {
            col.assign(mix(col, rbFloor(u, dir), u.drain));
        });
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
