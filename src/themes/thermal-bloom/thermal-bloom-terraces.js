/**
 * Thermal Bloom — the Stair: travertine terraces stepping down from the Chalice's mound toward
 * the bottom-right corner (iris-springs.md §1.2, §3.6.3, §3.15).
 *
 * The generator is the Stage A0 lab's "s4", ported three-free to thermal-bloom-bake.js: scalloped
 * rims (lower envelopes of lobes convex downhill, never crossing), each scallop holding its own
 * flat pool at the height of its lowest rim point, risers dropping from each white lip in two to
 * four micro-steps onto the next tier's floor, which rises gently uphill so the water fills only a
 * band behind each rim. Heights are baked into the mesh (no vertex texture fetch on either
 * backend); a layout texture read only in the fragment stage at level 0 says, per texel, how far
 * the downhill rim is, the tier (read NEAREST: a filtered id is garbage), how far down a riser
 * the point is, and whether it is under water.
 *
 * The look, against the neighbours (§3.15, not halcyon-apex): cream and apricot dominate; the
 * pools are milky and opaque, lit from within (colloidal silica scatters sunlight inside the
 * water: albedo × sun × (1 − e^(−σd))), never mirrors; turquoise only where a pool is deep; the
 * risers streaked apricot and chocolate where runoff flows, hung with dripstone curtains (their
 * folds tilt the normal across the slope), darker in the cavity under each lip; the tiers follow
 * a natural slope with no axis of symmetry. Wrap lighting gives the travertine a subsurface feel;
 * aerial perspective as everywhere. The footprint's rim fades into pale sinter and is discarded
 * in its last sliver, so it never fights the basin's ground.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    normalWorld,
    positionWorld,
    reflect,
    sign,
    smoothstep,
    step,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    RECORD_ROWS,
    createThermalBloomTexture,
    tbAerial,
    tbBlooms,
    tbBounce,
    tbFills,
    tbGlint,
    tbHash21,
    tbLuma,
    tbPart,
    tbSchlick,
    tbSky,
    tbSteamVeil,
} from './thermal-bloom-tsl.js';
import { STAIR, bakeStair } from './thermal-bloom-bake.js';

/** The Stair's bake arguments for a tier (the world's bake loader asks for the same). */
export function stairBakeArgs(tier) {
    const { rows, columns } = gridFor(tier);
    return {
        tiers: tier.stairTiers, rows, columns, layoutSize: tier.stairBake,
    };
}

/** Grid rows (along) and columns (across) of the Stair's mesh per tier's layout size. */
function gridFor(tier) {
    // Rows a few to every steep face (about 0.2–0.3 m along the slope).
    if (tier.stairBake <= 384) return { rows: 460, columns: 150 };
    if (tier.stairBake <= 512) return { rows: 600, columns: 200 };
    return { rows: 720, columns: 240 };
}

/** The Stair's colours (linear). */
const C = Object.freeze({
    cream: vec3(0.84, 0.79, 0.64),
    lip: vec3(0.9, 0.88, 0.83),
    apricot: vec3(0.77, 0.36, 0.13),
    chocolate: vec3(0.25, 0.1, 0.045),
    rust: vec3(0.52, 0.12, 0.024),
    milky: vec3(0.42, 0.76, 0.76),
    turquoise: vec3(0.1, 0.58, 0.66),
    /** The bright milky band behind a lip, where the water is shallowest and most lit. */
    milkyLip: vec3(0.66, 0.9, 0.88),
    sinter: vec3(0.72, 0.68, 0.6),
    /** Old travertine on the outer flanks: grey-brown, stained, long dry. */
    old: vec3(0.31, 0.27, 0.22),
    /** The mats the Stair stands in, for its footprint's last fade. */
    mats: vec3(0.3, 0.26, 0.22),
    /** Fresh crust where the water has just laid it: near white. */
    white: vec3(0.9, 0.88, 0.82),
    /** The mats living in the overflow's washes. */
    orange: vec3(0.82, 0.33, 0.07),
    /** Long-dry travertine: grey with a little warmth. */
    grey: vec3(0.5, 0.48, 0.44),
    /** The Iris's bands, as the cooling overflow carries them down the faces. */
    lemon: vec3(0.8, 0.6, 0.08),
    olive: vec3(0.17, 0.21, 0.05),
    /** A cool pool's water: milky jade (algae where the water has cooled). */
    jade: vec3(0.3, 0.58, 0.4),
});

/**
 * The Stair part.
 * @param {object} u     the shared uniforms
 * @param {object} tier  the quality tier
 * @param {object} tex   the world's baked textures (the noise atlas)
 */
export function createTerraces(u, tier, tex) {
    const { columns } = gridFor(tier);
    // Shared and read-only (the bake cache keeps it for the next build).
    const bake = bakeStair(stairBakeArgs(tier));
    const geometry = new THREE.BufferGeometry();
    // Lifted a hand's breadth so the Stair always stands on the ground, never in it (a copy: the
    // baked positions stay as baked).
    const positions = bake.positions.slice();
    for (let i = 1; i < positions.length; i += 3) positions[i] += 0.12;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(bake.uvs, 2));
    geometry.setAttribute('edge', new THREE.BufferAttribute(bake.edges, 1));
    geometry.setIndex(new THREE.BufferAttribute(bake.indices, 1));
    geometry.computeVertexNormals();
    // One typed array, two views: linear for the distances, nearest for the tier id.
    const layoutLinear = createThermalBloomTexture(bake.layout, bake.layoutSize, bake.layoutSize, {
        name: 'thermal-bloom-stair-layout', filter: 'linear', wrap: 'clamp',
    });
    const layoutNearest = createThermalBloomTexture(bake.layout, bake.layoutSize, bake.layoutSize, {
        name: 'thermal-bloom-stair-tiers', filter: 'nearest', wrap: 'clamp',
    });

    const stairFn = Fn(() => {
        const st = clamp(uv(), 0.0, 1.0).toVar();
        const lay = texture(layoutLinear, st).level(0).toVar();
        const layN = texture(layoutNearest, st).level(0).toVar();
        const tierId = layN.y.mul(255.0 / 16.0).add(0.5).floor().toVar();
        const rimDist = lay.x.mul(24.0).toVar();
        const riser = lay.z.toVar();
        // The water's depth is continuous in the layout (0.5 at the shore): a crisp, smooth shore.
        const shoreW = max(fwidth(lay.w), 0.004);
        const water = smoothstep(float(0.5).sub(shoreW), float(0.5).add(shoreW), lay.w).toVar();
        const edge = attribute('edge', 'float').toVar();
        edge.lessThan(0.12).discard();

        const P = positionWorld.toVar();
        // The footprint's last, nearly flat sliver lies on the basin's own ground: drop it, so the
        // Stair rises straight out of the mats instead of standing on a pale skirt.
        P.y.lessThan(0.4).and(edge.lessThan(0.5)).discard();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        // Metres along the slope (downhill) and across it: the streaks run down the slope.
        const along = st.y.mul((STAIR.sMax - STAIR.sMin) * STAIR.length);
        const across = st.x.sub(0.5).mul(STAIR.halfWidth * 2);
        // Runoff fans: wide washes running down several tiers (each 10–30 m across, widening
        // downhill), apricot where the mats live in the outflow, fresh white where it is new.
        const fanX = across.div(along.mul(0.006).add(0.6));
        const streakA = texture(tex.noise, vec2(fanX.mul(0.07 / 4), along.mul(0.006 / 4))).x
            .mul(0.75).add(texture(tex.noise, vec2(across.mul(0.4 / 8), along.mul(0.05 / 8))).y.mul(0.25));
        const freshN = texture(tex.noise, vec2(fanX.mul(0.05 / 4).add(0.5), along.mul(0.005 / 4))).y;
        const fresher = smoothstep(0.62, 0.8, freshN);
        const streakB = texture(tex.noise, vec2(across.mul(0.05 / 4), along.mul(0.3 / 4))).x;
        const onRiser = float(1.0).sub(water).mul(smoothstep(0.995, 0.97, riser)).mul(smoothstep(0.5, 1.5, tierId))
            .toVar();
        const lip = exp(riser.div(0.12).mul(riser.div(0.12)).negate()).mul(onRiser).toVar();
        // ── The Seal (§1.5, §3.8), as a fill row's timeline lands on this tier: a fill's index is
        // the tier whose riser drops from the new lip, so the pool behind that lip is the tier above
        // (index − 1) and the stripe fixes into the riser below it (record row index − 1) ──
        const perpW = vec2(u.stairDown.y, u.stairDown.x.negate());
        const onTier = (index) => step(abs(tierId.sub(index)), 0.5);
        // Pixels down the face from its lip (a riser runs about 3 m of slope).
        const riserPx = riser.mul(3.0).div(max(fwidth(along), 1e-4));
        const ragN = texture(tex.noise, vec2(across.div(3.0), along.div(5.0)).div(16.0)).y.sub(0.5);
        // Frost sparkle on a lip as it sinters: cells of the rim that flash in turn.
        const frost = smoothstep(0.84, 0.96, tbHash21(floor(vec2(across, along).div(0.45))
            .add(floor(u.time.mul(7.0)).mul(vec2(3.1, 1.7)))));
        const fills = tbFills(u, 1, (index, A, e) => {
            // Metres along the rim from where the row was aimed; the lip reaches 70 m in 0.4 s.
            const d = abs(dot(P.xz.sub(A.xy), perpW));
            const reach = e.draw.mul(70.0);
            const drawn = float(1.0).sub(smoothstep(reach.sub(1.5), reach, d.add(ragN.mul(2.0))));
            // A crisp white sinter lip, about five pixels down the face from the crest. The linear
            // riser blends with the pool's 1 across the crest's half texel: the nearest read
            // covers that sliver.
            const band = onTier(index).mul(onRiser)
                .mul(max(float(1.0).sub(smoothstep(3.5, 6.0, riserPx)), step(layN.z.mul(3.0), 0.4)));
            const tipD = d.sub(reach).div(2.5);
            const slideD = riser.sub(e.slide).div(0.07);
            const under = onTier(index).mul(onRiser).mul(smoothstep(4.5, 6.0, riserPx))
                .mul(float(1.0).sub(smoothstep(7.5, 10.0, riserPx)));
            return {
                lip: band.mul(drawn).mul(e.lipOn),
                shade: under.mul(drawn).mul(e.lipOn),
                // The pool behind the lip (the tier above) rises and glows.
                pool: onTier(index.sub(1.0)).mul(drawn).mul(e.fill),
                // The sheet slides down the face below the lip.
                sheet: onTier(index).mul(onRiser).mul(step(riser, e.slide)).mul(e.sheetOn)
                    .mul(drawn),
                // The stripe under the aim fixes into the stone as the lip sets.
                unfixed: onTier(index).mul(float(1.0).sub(e.fixed)).mul(float(1.0).sub(smoothstep(8.0, 12.0, d))),
                glint: max(
                    max(exp(tipD.mul(tipD).negate()).mul(e.tip), frost.mul(float(1.0).sub(smoothstep(0.5, 1.6, e.age))))
                        .mul(band).mul(drawn.max(e.tip)),
                    exp(slideD.mul(slideD).negate()).mul(onTier(index)).mul(onRiser).mul(e.sheetOn)
                        .mul(drawn)
                        .mul(0.5),
                ),
            };
        });
        // The level rises: the shore of the filling pool creeps up its floor.
        const risen = smoothstep(float(0.5).sub(fills.pool.mul(0.09)).sub(shoreW), float(0.5).sub(fills.pool.mul(0.09))
            .add(shoreW), lay.w).mul(step(0.001, fills.pool));
        water.assign(max(water, risen));
        // The overflow's washes: where water runs down the faces the mats live in it (orange,
        // apricot, chocolate toward the foot); between them the faces are cream and white.
        const stain = smoothstep(0.48, 0.66, streakA).mul(smoothstep(0.1, 0.5, streakB)).mul(float(1.0).sub(fresher))
            .toVar();
        const dark = smoothstep(0.55, 0.9, streakA).mul(smoothstep(0.3, 1.0, riser));
        // Dripstone: vertical flutes down every face (two octaves, long along the fall line), the
        // grooves darker; the relief below lights them.
        const fluteA = texture(tex.noise, vec2(across.mul(2.6 / 16), along.mul(0.09 / 16))).z;
        const fluteB = texture(tex.noise, vec2(across.mul(7.0 / 16), along.mul(0.24 / 16))).w;
        const grooves = fluteA.mul(0.65).add(fluteB.mul(0.35)).sub(0.5).toVar();
        // The water cools as it steps down, and the faces take the Iris's own bands with it: hot
        // white and lemon by the head, orange through the middle, rust and olive toward the foot.
        const cool = clamp(tierId.sub(1.0).div(Math.max(1, bake.tiers - 1)).add(streakB.sub(0.5).mul(0.35)), 0.0, 1.0)
            .toVar();
        const band = mix(
            mix(C.lemon, C.orange, smoothstep(0.12, 0.45, cool)),
            mix(C.rust, C.olive, smoothstep(0.78, 1.0, cool)),
            smoothstep(0.5, 0.82, cool),
        );
        const living = mix(band, C.chocolate, dark.mul(0.6).mul(smoothstep(0.3, 0.9, riser)));
        // The washes carry the mats down the faces; between them, the stone is cream.
        const washes = max(stain, smoothstep(0.36, 0.6, streakA).mul(smoothstep(0.0, 0.4, streakB)).mul(0.6))
            .mul(smoothstep(0.05, 0.25, cool).mul(0.75).add(0.25))
            .toVar();
        const riserCol = mix(mix(C.cream, C.white, fresher.mul(0.6)), living, washes.mul(0.95))
            .mul(float(1.0).add(grooves.mul(0.5)))
            .mul(float(1.0).sub(smoothstep(0.55, 1.0, riser).mul(0.12)));
        const riserLit = mix(riserCol, C.white, lip);
        // Tier tops above the water: wet cream travertine, faintly stained.
        const fresh = mix(mix(C.cream.mul(0.95), C.sinter, streakB.mul(0.6)), band, washes.mul(0.6));
        // Travertine is fresh white only where water flows: far from the active rim, and toward
        // the Stair's sides, a tier's surface is old, grey-brown and stained.
        const sideways = smoothstep(0.55, 0.95, st.x.mul(2.0).sub(1.0).abs());
        // The head stays fresh: the cone's runoff feeds the top tier in cream and apricot.
        const age = max(smoothstep(9.0, 20.0, rimDist).mul(0.6), sideways).mul(0.85).mul(smoothstep(0.03, 0.14, st.y));
        const topCol = mix(fresh, mix(C.old, C.apricot.mul(0.55), stain.mul(0.4)), age.mul(float(1.0).sub(fresher)))
            .toVar();
        // Below the last rim the runoff spreads over the Stair's foot: an apron of wet travertine
        // washed apricot and brown by the mats that live in the outflow.
        const foot = smoothstep(bake.tiers - 0.5, bake.tiers, tierId).mul(0.85);
        const runoff = mix(C.apricot.mul(0.85), C.chocolate.mul(1.6), streakB.mul(0.7)).mul(0.9);
        topCol.assign(mix(topCol, mix(runoff, C.sinter.mul(0.8), streakA.mul(0.5)), foot));
        // Pools: milky, turquoise only where deep; rust-stained at their uphill margins.
        const depth = clamp(float(1.0).sub(rimDist.div(3.5)), 0.0, 1.0);
        const knobsBase = texture(tex.noise, vec2(across, along).mul(0.9 / 16)).w;
        const margin = smoothstep(0.55, 0.85, texture(tex.noise, vec2(across.mul(0.12 / 4), along.mul(0.6 / 4))).y)
            .mul(smoothstep(3.0, 5.5, rimDist));
        const behindLip = smoothstep(1.4, 0.25, rimDist);
        const poolCol = mix(
            mix(mix(C.milky, C.turquoise, depth.mul(0.75)), C.milkyLip, behindLip.mul(0.55)),
            C.rust,
            margin.mul(0.18),
        ).toVar();
        // A pool deepens toward its back wall (the floor falls away under the face above): a
        // richer turquoise-blue there, bright aqua over the shallow shelf behind its lip.
        const backWall = smoothstep(1.2, 9.0, rimDist).mul(float(1.0).sub(cool.mul(0.5)));
        poolCol.assign(mix(poolCol, vec3(0.02, 0.36, 0.58), backWall.mul(0.78)));
        // No two pools alike: along each tier the water runs deeper blue in some, milkier in others.
        const tone = texture(tex.noise, vec2(across.div(160.0), tierId.mul(0.37).add(0.13))).x;
        poolCol.assign(mix(poolCol, vec3(0.03, 0.3, 0.55), smoothstep(0.55, 0.85, tone).mul(depth.mul(0.5).add(0.3))));
        poolCol.assign(mix(poolCol, C.milky, smoothstep(0.4, 0.15, tone).mul(0.35)));
        // The cooler pools down the Stair turn milky jade (algae live where the water has cooled).
        const jadeCol = mix(C.jade, C.milkyLip, behindLip.mul(0.4));
        poolCol.assign(mix(poolCol, jadeCol, smoothstep(0.45, 0.95, cool).mul(0.7)));
        const solid = mix(topCol, riserLit, onRiser).toVar();
        // The locks' blooms on this side: the brimming terrace's sheet scours the riser below to
        // wet cream, then streamers in the piece's colour grow down it and bleach (§3.7).
        // The world anchors the fan on the brimming lip and heads it down the slope.
        const bloom = tbBlooms(u, P, 1, tex);
        solid.assign(mix(solid, vec3(0.76, 0.72, 0.6), bloom.scour.mul(0.92)));
        solid.assign(mix(solid, bloom.tint, bloom.cover));
        // The seasons on the dry travertine: rime in First Frost, snow in Deep Cold on the old,
        // long-dry flanks and tier tops away from the flow; the running water keeps its own.
        const coldStone = smoothstep(0.1, 0.6, age).mul(float(1.0).sub(water)).mul(float(1.0).sub(lip));
        const driftN = smoothstep(0.4, 0.7, streakB.add(knobsBase.mul(0.6)));
        solid.assign(mix(solid, vec3(0.8, 0.82, 0.84), u.frost.mul(coldStone).mul(driftN).mul(0.35)));
        solid.assign(mix(solid, vec3(0.78, 0.81, 0.86), u.snow.mul(coldStone).mul(driftN.mul(0.5).add(0.4))));
        // Rough travertine: a blistered, knobbly surface, fading to its mean under a pixel.
        const knobs = knobsBase.sub(0.5);
        solid.mulAssign(float(1.0).add(knobs.mul(0.16).mul(float(1.0).sub(smoothstep(0.08, 0.3, fwidth(along))))));

        // ── Light ──
        // Relief: popcorn knobs over all the stone, and the flutes down the faces, as a bump
        // normal from screen derivatives (fading out where a pixel covers more than the relief).
        const reliefFade = float(1.0).sub(smoothstep(0.06, 0.3, fwidth(along))).toVar();
        const knob = texture(tex.cellular, vec2(across, along).div(1.7)).w;
        const bump = knob.mul(0.06).mul(float(1.0).sub(onRiser.mul(0.5)))
            .add(grooves.mul(0.16).mul(onRiser))
            .mul(reliefFade)
            .mul(float(1.0).sub(water))
            .toVar();
        const Nbase = normalize(normalWorld).toVar();
        const dpdx = dFdx(P);
        const dpdy = dFdy(P);
        const r1 = cross(dpdy, Nbase);
        const r2 = cross(Nbase, dpdx);
        const det = dot(dpdx, r1);
        const grad = sign(det).mul(dFdx(bump)).mul(r1).add(sign(det).mul(dFdy(bump)).mul(r2));
        const Nb = normalize(abs(det).mul(Nbase).sub(grad));
        const N = normalize(mix(Nbase, Nb, step(1e-9, abs(det)))).toVar();
        const ndl = dot(N, u.sunDir);
        const wrapLit = clamp(ndl.add(0.25).div(1.25), 0.0, 1.0);
        const skyAmb = mix(u.haze, u.zenith, 0.55).mul(N.y.mul(0.25).add(0.28)).add(tbBounce(u, N));
        // Cavities: the shade under each lip (the crest overhangs its face), the grooves, the foot
        // of each riser.
        const underLip = smoothstep(0.02, 0.07, riser).mul(float(1.0).sub(smoothstep(0.1, 0.32, riser))).mul(onRiser);
        const ao = float(1.0).sub(smoothstep(0.6, 1.0, riser).mul(onRiser).mul(0.45))
            .mul(float(1.0).sub(underLip.mul(0.5)))
            .mul(float(1.0).sub(clamp(grooves.negate().mul(1.6), 0.0, 1.0).mul(onRiser).mul(0.4).mul(reliefFade)));
        const solidLit = solid.mul(u.sunColor.mul(wrapLit.mul(1.12)).add(skyAmb)).mul(ao).toVar();
        // The overflow's film on the faces: a wet darkening and a gloss that slides down the fall
        // line in the washes (and a little everywhere just under the lips).
        const filmN = texture(tex.noise, vec2(across.mul(1.2 / 16), along.mul(0.18 / 16).sub(u.time.mul(0.045)))).y;
        const film = onRiser.mul(max(stain.mul(0.85), lip.mul(0.7))).mul(smoothstep(0.35, 0.7, filmN).mul(0.6).add(0.4))
            .toVar();
        solidLit.mulAssign(float(1.0).sub(film.mul(0.22)));
        // The pools: milky, lit from within, and glassy: under a light breeze their surface sends
        // the sky to the eye (deep blue where a ripple tilts it up, haze toward the horizon).
        const inScatter = float(1.0).sub(exp(depth.mul(-2.0).sub(0.6)));
        const poolLit = poolCol.mul(u.sunColor.mul(max(u.sunDir.y, 0.0).mul(1.5).mul(inScatter).add(0.45))
            .add(u.zenith.mul(0.3)));
        const ripDrift = vec2(u.time.mul(0.004), u.time.mul(-0.003));
        const rip = texture(tex.noise, vec2(across, along).div(5.0).div(16.0).add(ripDrift));
        const Nw = normalize(vec3(rip.z.sub(0.5).mul(0.16), 1.0, rip.w.sub(0.5).mul(0.16)));
        const skyR = tbSky(u, reflect(V.negate(), Nw));
        const fres = tbSchlick(max(dot(Nw, V), 0.0), float(0.02)).mul(0.95).add(bloom.front.mul(0.25));
        // (the water's own colour richer; the sky's mirror low, or the pools read matte grey)
        const poolRich = mix(vec3(tbLuma(poolLit)), poolLit, 1.3).max(0.0);
        const poolOut = mix(poolRich, skyR, clamp(fres, 0.0, 0.4)).toVar();
        // Bubble trains: in some 2 m cells of the pools a bead rises every few seconds — a
        // bright point just before it breaks, then a ring spreading from where it broke — gone
        // where a pixel is wider than a bead.
        const bc = vec2(across, along).div(2.2);
        const cell = floor(bc);
        const hb = tbHash21(cell.add(vec2(3.1, 7.7)));
        const site = cell.add(vec2(tbHash21(cell.add(1.3)), tbHash21(cell.add(5.9))).mul(0.6).add(0.2));
        const period = hb.mul(4.0).add(2.5);
        const bAge = fract(u.time.div(period).add(hb.mul(13.0))).mul(period);
        const rd = length(bc.sub(site)).mul(2.2);
        const bPx = max(fwidth(along), 1e-3);
        const ringW = max(bPx.mul(1.2), 0.04);
        const ringD = rd.sub(bAge.mul(0.8)).div(ringW);
        // A bright crest with a faint dark trough just inside it.
        const ring = exp(ringD.mul(ringD).negate()).sub(exp(ringD.add(1.4).mul(ringD.add(1.4)).negate()).mul(0.4))
            .mul(exp(bAge.mul(-1.8)));
        const bead = smoothstep(bPx.add(0.06), 0.0, rd).mul(smoothstep(period.sub(0.7), period, bAge));
        const bubbleGate = step(hb, 0.22).mul(smoothstep(0.6, 1.2, rimDist))
            .mul(float(1.0).sub(smoothstep(0.12, 0.35, bPx)));
        // The ring a faint brightening; the bead at its break a glint above the bloom's knee.
        poolOut.addAssign(u.sunColor.mul(ring.mul(0.18).add(bead.mul(2.4)).mul(bubbleGate)));
        // ── The Seal (§3.8): the record's stripes fixed into each riser under its lip (a band a
        // third of the face), in the cleared rows' colours along the rim; the new lip, the pool
        // behind it lit from within, and the sheet spilling down the face below ──
        const rec = texture(tex.record, vec2(st.x, tierId.sub(0.5).div(RECORD_ROWS))).level(0);
        // (a stain in the stone: soft-edged, streaked down the face, the sinter showing through)
        const recStain = smoothstep(0.25, 0.75, streakB).mul(0.5).add(0.5);
        const stripeBand = smoothstep(0.16, 0.26, riser).mul(float(1.0).sub(smoothstep(0.48, 0.6, riser)))
            .mul(onRiser).mul(rec.w)
            .mul(float(1.0).sub(fills.unfixed))
            .mul(recStain);
        const recCol = mix(rec.xyz, vec3(0.78, 0.7, 0.56), 0.6);
        const recLit = recCol.mul(u.sunColor.mul(wrapLit.mul(1.02)).add(skyAmb)).mul(ao);
        solidLit.assign(mix(solidLit, recLit, stripeBand.mul(0.12)));
        // The sheet: the face darkens wet under a gloss that catches the sky.
        const sheetSheen = mix(u.haze, u.zenith, 0.5).mul(0.55);
        solidLit.assign(mix(solidLit, solidLit.mul(0.8).add(sheetSheen.mul(0.18)), fills.sheet.mul(0.8)));
        // A crisp dark line under the new lip, so it stands off the face as a fresh rim.
        solidLit.mulAssign(float(1.0).sub(fills.shade.mul(0.5)));
        // The new lip: crisp white sinter, bright even where the face turns from the sun.
        // The new lip: fresh white sinter, whiter and brighter than the old rims' cream, lit even
        // where the face turns from the sun.
        const lipLit = vec3(1.0, 0.99, 0.96).mul(u.sunColor.mul(max(wrapLit, 0.8).mul(1.3)).add(skyAmb.mul(1.2)));
        solidLit.assign(mix(solidLit, lipLit, fills.lip.mul(0.97)));
        // The new lip glows as it sets (the Seal's light), turquoise-white.
        solidLit.addAssign(vec3(0.55, 0.95, 1.0).mul(fills.lip.mul(0.9)));
        solidLit.addAssign(u.sunColor.mul(fills.glint.mul(2.6)));
        // The filling pool lights from within as it rises (turquoise-white, the Seal's light).
        const fillLit = poolOut.mul(1.45).add(vec3(0.35, 0.95, 1.0).mul(u.sunColor).mul(0.55));
        poolOut.assign(mix(poolOut, fillLit, fills.pool));
        // A game over drains the Chalice: the pools sink to wet, dull travertine (§1.5).
        poolOut.assign(mix(poolOut, solidLit.mul(0.78), u.drain.mul(0.65)));
        const col = mix(solidLit, poolOut, water).toVar();
        // Glints where the overflow sheets slide over the lips and down the risers' wet faces.
        // The pools' surfaces glint where a ripple sends the sun back to the eye.
        col.addAssign(tbGlint(u, P, Nw, V, water.mul(0.7), 0.3, 0.5));
        const filmFres = tbSchlick(max(dot(N, V), 0.0), float(0.02));
        col.addAssign(tbSky(u, reflect(V.negate(), N)).mul(filmFres.mul(film).mul(0.9)));
        const sheetWet = lip.add(water.mul(behindLip).mul(0.6)).add(film.mul(0.8))
            .add(fills.sheet.mul(0.8)).add(bloom.front.mul(0.6))
            .add(bloom.wet.mul(0.9))
            .add(bloom.pool.mul(0.8));
        col.addAssign(tbGlint(u, P, N, V, clamp(sheetWet, 0.0, 1.0), 0.22, 0.6));
        // The new springs' own light (their hot cores, the ripple at their birth).
        col.addAssign(bloom.glow);
        // Low, dry ground (the foot and the outer flanks) fades through old, stained travertine
        // into the mats around the Stair; the pools keep their water.
        const light = u.sunColor.mul(wrapLit.mul(1.1)).add(skyAmb);
        const low = smoothstep(0.3, 0.7, P.y).max(smoothstep(0.35, 0.7, edge)).mul(smoothstep(0.03, 0.4, edge));
        const flankCol = mix(C.mats, mix(C.old, C.apricot.mul(0.6), stain.mul(0.5)), smoothstep(0.05, 0.6, low))
            .toVar();
        // In Deep Cold the Stair's foot meets snow, as the basin round it does.
        flankCol.assign(mix(flankCol, vec3(0.6, 0.63, 0.68), u.snow.mul(0.85)));
        const keep = max(smoothstep(0.35, 0.9, low), water.mul(smoothstep(0.03, 0.2, edge)));
        col.assign(mix(flankCol.mul(light), col, keep));
        const outCol = tbAerial(u, tbSteamVeil(u, col, P), dist, V.negate());
        return vec4(max(outCol, vec3(0.0)), 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = 'ThermalBloomStair';
    material.fog = false;
    material.colorNode = stairFn();
    const part = tbPart('ThermalBloomStair', geometry, material, 8);
    part.textures = [layoutLinear, layoutNearest];
    part.tiers = bake.tiers;
    /**
     * Lay the Stair from the Chalice's flank (`top`, world xz) down toward the bottom-right
     * corner (`toward`, world xz). Its local +z (downhill) turns onto that direction.
     */
    const at = { x: 0, z: 0, angle: 0 };
    const probe = {};
    part.place = (top, toward) => {
        const dx = toward[0] - top[0];
        const dz = toward[1] - top[1];
        at.x = top[0];
        at.z = top[1];
        at.angle = Math.atan2(dx, dz);
        part.mesh.position.set(top[0], 0, top[1]);
        part.mesh.rotation.set(0, at.angle, 0);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
        u.stairDown.value.set(Math.sin(at.angle), Math.cos(at.angle));
        u.stairTop.value.set(top[0], top[1]);
    };
    /** The Stair's surface height (metres) under a world point (0 off its footprint). */
    part.heightAt = (x, z) => {
        const dx = x - at.x;
        const dz = z - at.z;
        const c = Math.cos(at.angle);
        const s = Math.sin(at.angle);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        bake.gen.sample(lz / STAIR.length, lx, probe);
        return Math.max(0, probe.height + 0.12);
    };
    /** How far the mesh's across axis reaches past the generator's width (the bake's footprint). */
    const footprint = Math.abs(positions[(columns - 1) * 3]) / Math.max(1e-3, bake.gen.widthAt(STAIR.sMin));
    /**
     * The lip nearest a world point, where a lock's water brims over and a clear lays its new rim:
     * on a riser, its crest uphill; on a floor or in a pool, the rim that holds it downhill. Returns
     * the lip (world x, z), its index (the tier id of the riser that drops from it, which the
     * shader matches: the pool behind it is index − 1, the record row index − 1) and its layout
     * coordinate across (0..1, the record's axis), or null off the footprint.
     */
    part.lipNear = (x, z) => {
        const c = Math.cos(at.angle);
        const s = Math.sin(at.angle);
        const dx = x - at.x;
        const dz = z - at.z;
        const lx = dx * c - dz * s;
        let lz = dx * s + dz * c;
        const L = STAIR.length;
        bake.gen.sample(lz / L, lx, probe);
        if (!(probe.edge > 0.3)) return null;
        const stride = 0.25;
        if (probe.tier >= 1 && probe.riser < 1) {
            // On a riser: walk up the face while it stays this tier's riser.
            const k = probe.tier;
            for (let i = 0; i < 24; i++) {
                bake.gen.sample((lz - stride) / L, lx, probe);
                if (probe.tier !== k || probe.riser >= 1) break;
                lz -= stride;
            }
        } else {
            // On a floor or in a pool: walk down to the rim that holds it (the next riser's top).
            const k = probe.tier;
            for (let i = 0; i < 120; i++) {
                lz += stride;
                bake.gen.sample(lz / L, lx, probe);
                if (probe.tier !== k) break;
            }
        }
        bake.gen.sample(lz / L, lx, probe);
        if (probe.tier < 1 || probe.tier > bake.tiers) return null;
        const width = bake.gen.widthAt(lz / L);
        return {
            x: at.x + lx * c + lz * s,
            z: at.z - lx * s + lz * c,
            index: probe.tier,
            across: Math.max(0, Math.min(1, (lx / (width * footprint) + 1) / 2)),
        };
    };
    part.dispose = () => {
        layoutLinear.dispose();
        layoutNearest.dispose();
    };
    return part;
}
