/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Volcanic Fire — an erupting caldera at night. A lava fountain leaps from the middle of a lava
 * lake with every in-breath and drops back to a churning boil on the release.
 *
 * Painted in depth, far to near: a night sky under an ash ceiling the eruption lights from below
 * (a few stars in its gaps); distant volcanic slopes in silhouette with thin lava rivers threading
 * down them; the caldera's far wall, lit red at its foot by the lake; the plume of fume and ash that
 * rises off the lake behind the fountain, lit orange-red from below and darkening into the night;
 * the lava lake in perspective, its cooling black crust broken into drifting plates with
 * incandescent seams, thin molten patches and a glowing pool where the fountain stands; then the
 * fountain itself, a turbulent column of spray with a white-hot core that tears into tongues.
 * Clots fly from it in arcs and sparks leave its crown (real sprites, volcanic-spatter.js), embers
 * drift and cool everywhere, and hot air shimmers over the lake.
 *
 * The rhythm is quick (3 s in, 2 s out), so every phase has to hold up on its own: empty lungs
 * leave a low, churning fountain over a glowing lake, full lungs a tall column with its plume and
 * the lake's seams lit. Surges ramp with the breath; nothing flashes.
 */
import {
    Fn, If, exp, float, log, max, mix, smoothstep, sqrt, vec2, vec3, vec4,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fbm3, gnoise, hash21, hash22, heatColor, layer, ridged, softStep, starfield,
    voronoi,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';
import { createSpatter } from './volcanic-spatter.js';

/** The vent sits on the screen's centre line. */
const VENT_X = 0;
/** Lake crust: plate cells per unit of lake plane (the vent sits at depth 1, where 1 unit = 1 hero unit). */
const PLATES = 8;
/** The plume rises off the lake a little behind the vent, drifting downwind as it climbs. */
const PLUME_X = 0.06;
const NIGHT = vec3(0.0032, 0.0034, 0.0085);
const SKY_GLOW = vec3(0.03, 0.0075, 0.004);
const ASH = vec3(0.016, 0.013, 0.013);
const FIRELIGHT = vec3(1.0, 0.3, 0.07);
const EMBER = vec3(0.85, 0.14, 0.03);
const BASALT = vec3(0.014, 0.0105, 0.0098);
const HAZE = vec3(0.075, 0.017, 0.0075);
const SEAM_TINT = vec3(0.92, 0.7, 0.6);

/**
 * Where things sit, in hero units (plain JS numbers or uniform nodes). Tall screens sink the lake and
 * stretch the fountain and the plume, so the sky never stands empty above a small fire.
 *   horizon: the lake plane's vanishing line (hidden behind the far wall)
 *   base:    the vent, where the fountain meets the lake
 *   camH:    the eye's height above the lake, chosen so the vent sits at depth 1 (parallax k = 1)
 *   shore:   the lake's far shore at the foot of the far wall
 *   reach:   how much taller the fountain and the plume stand on tall screens
 */
function calderaLayout(tall) {
    const t = float(tall);
    const horizon = t.mul(-0.22).add(0.12);
    const base = t.mul(-0.3).sub(0.25);
    return {
        horizon,
        base,
        camH: horizon.sub(base),
        shore: base.add(0.19).add(t.mul(0.05)),
        reach: t.mul(0.45).add(1),
    };
}

/** The fountain's height: a low boil at empty lungs, a tall column at full ones. */
const fountainHeight = (surge, reach) => surge.mul(0.7).add(0.28).mul(reach);

/** The far wall's skyline in its own layer: a bowl that climbs toward the frame, crags on top. */
function wallSkyline(x, u, L) {
    const e = x.div(u.ext.x);
    const crags = ridged(vec2(x.mul(1.6), 4.2), 4).sub(0.45).mul(0.12);
    const notch = gnoise(vec2(x.mul(8.5), 1.3)).sub(0.5).mul(0.03);
    return L.shore.add(0.13).add(e.mul(e).mul(0.16)).add(crags).add(notch);
}

/** The distant volcano's skyline: a broad cone off to one side, a long shoulder on the other. */
function slopeSkyline(x, u, L) {
    const peakX = u.ext.x.mul(-0.55).toVar();
    const dx = x.sub(peakX).toVar();
    const cone = L.shore.add(0.5).sub(sqrt(dx.mul(dx).add(0.006)).mul(0.5))
        .sub(exp(dx.mul(dx).mul(-900)).mul(0.025));
    const shoulderX = u.ext.x.mul(0.62);
    const sx = x.sub(shoulderX).toVar();
    const shoulder = L.shore.add(0.27).sub(sqrt(sx.mul(sx).add(0.03)).mul(0.22));
    const rough = ridged(vec2(x.mul(2.6), 9.1), 3).sub(0.5).mul(0.05);
    return max(cone, shoulder).add(rough);
}

/** A seam of width `width` (cell units) seen through a pixel `footprint` wide: far seams widen and dim. */
const seamGlow = (seam, width, footprint) => {
    const spread = width.mul(width).add(footprint.mul(footprint)).toVar();
    return exp(seam.mul(seam).div(spread).negate()).mul(width.div(sqrt(spread)));
};

/**
 * A gentle, drifting warp for smoke: fbm sampled through it rolls rather than marbles (the shared
 * warpedFbm pushes hard enough to marble).
 */
function billowRoll(p, drift) {
    const q = p.mul(0.8);
    return vec2(fbm(q.add(vec2(0, drift)), 2), fbm(q.add(vec2(5.2, 1.3)).sub(vec2(drift, 0)), 2)).mul(0.9);
}

/** Lava rivers on the distant slopes: vent offset from the summit, downhill lean, meander, seed. */
const RIVERS = [[-0.015, 0.16, 0.34, 1.3], [0.03, -0.2, 0.3, 4.1], [0.005, -0.02, 0.4, 7.7], [0.6, -0.12, 0.26, 2.9]];

/** Night sky, the ash ceiling and the distant slopes, far to near. */
function paintSky(c) {
    const {
        ps, u, L, fire, octaves, detail,
    } = c;
    const sq = layer(ps, u, 0.06).toVar();
    const alt = sq.y.sub(L.shore).toVar();
    // The low sky glows with the eruption's light; above, the night closes in.
    const dx = sq.x.sub(PLUME_X).toVar();
    const plumeGlow = exp(dx.mul(dx).mul(-0.9)).toVar();
    const sky = mix(SKY_GLOW, NIGHT, smoothstep(-0.1, 1.3, alt.sub(plumeGlow.mul(0.3)))).toVar();
    sky.addAssign(EMBER.mul(plumeGlow).mul(exp(alt.max(0).mul(-1.8))).mul(0.035).mul(fire));
    // The ash ceiling: a high, broken deck of cloud. Its ragged edges catch the eruption's light from
    // below, brightest toward the fire; night and a few stars show through the gaps.
    const vq = layer(ps, u, 0.1).toVar();
    const drift = u.time.mul(0.008);
    const deckAt = vec2(vq.x.mul(0.85).add(drift), vq.y.mul(1.9).sub(drift.mul(0.5))).add(vec2(3.3, 1.1));
    const deck = fbm(deckAt, octaves).toVar();
    const ceiling = smoothstep(0.44, 0.6, deck.add(smoothstep(0.1, 1.1, alt).mul(0.3)).sub(0.06)).toVar();
    const vx = vq.x.sub(PLUME_X);
    const underlit = exp(vx.mul(vx).mul(-0.28)).mul(exp(alt.max(0).mul(-0.7))).mul(fire).toVar();
    const edge = ceiling.mul(float(1).sub(ceiling)).mul(4);
    const ash = ASH.mul(deck.mul(0.6).add(0.25)).add(EMBER.mul(underlit).mul(edge.mul(0.13).add(ceiling.mul(0.025))));
    // Stars only where the deck breaks, and only high above the glow.
    const stars = starfield(layer(ps, u, 0), u, 0.7).mul(float(1).sub(ceiling)).mul(smoothstep(0.35, 1.0, alt));
    sky.assign(mix(sky.add(stars), ash, ceiling.mul(0.9)));

    // Distant volcanic slopes in silhouette, thin lava rivers threading down their flanks.
    const mq = layer(ps, u, 0.16).toVar();
    const ridge = slopeSkyline(mq.x, u, L).toVar();
    const below = ridge.sub(mq.y).toVar();
    const peakX = u.ext.x.mul(-0.55).toVar();
    // The far cone smoulders too: a thin plume trails downwind from its summit, lit from the crater.
    const summitY = L.shore.add(0.49).toVar();
    const above = mq.y.sub(summitY).max(0).toVar();
    const trail = mq.x.sub(peakX).sub(above.mul(above).mul(0.9)).sub(above.mul(0.15))
        .div(above.mul(0.3).add(0.025))
        .toVar();
    If(trail.abs().lessThan(3.5).and(mq.y.greaterThan(summitY.sub(0.03))), () => {
        const wisp = fbm(vec2(trail.mul(0.9), above.mul(4).sub(u.time.mul(0.05))), 3);
        const smoulder = smoothstep(0.35, 0.75, wisp.add(exp(trail.mul(trail).mul(-1.2)).mul(0.45)).sub(0.25))
            .mul(smoothstep(0.0, 0.03, above)).mul(fadeOut(0.3, 1.2, above))
            .mul(fadeOut(2.5, 3.4, trail.abs()));
        const smoke = ASH.mul(1.3).add(EMBER.mul(exp(above.mul(-3.5))).mul(0.07).mul(fire));
        sky.assign(mix(sky, smoke, smoulder.mul(0.85)));
    });
    const cdx = mq.x.sub(peakX);
    const cdy = mq.y.sub(summitY);
    sky.addAssign(EMBER.mul(exp(cdx.mul(cdx).mul(-260).sub(cdy.mul(cdy).mul(500)))).mul(0.05).mul(fire));
    If(below.greaterThan(u.px.mul(-3)), () => {
        const fall = below.max(0).toVar();
        // Aerial perspective: the far flanks melt into the glowing haze that fills the valleys at
        // their feet, and the air just behind their skyline is lit by the eruption.
        const valley = exp(mq.y.sub(L.shore).max(0).mul(-5));
        const haze = SKY_GLOW.mul(1.6).add(EMBER.mul(0.012).mul(fire));
        const rock = mix(vec3(0.004, 0.003, 0.0035), haze, valley.mul(0.75))
            .add(EMBER.mul(exp(fall.mul(-30))).mul(0.006))
            .toVar();
        const rivers = float(0).toVar();
        RIVERS.slice(0, detail >= 0.6 ? 4 : 2).forEach(([x0, lean, wiggle, seed], i) => {
            // Each river leaves a vent near a summit and wanders downhill, widening a little.
            const start = i < 3 ? peakX.add(x0) : u.ext.x.mul(x0);
            const meander = gnoise(vec2(fall.mul(2.2), seed)).sub(0.5).mul(wiggle);
            const path = start.add(fall.mul(lean)).add(meander.mul(fall.mul(6).min(1)));
            const off = mq.x.sub(path);
            // Flows crust over in places: a slow pulse runs down each, fat and bright where it is fresh.
            const pulse = gnoise(vec2(fall.mul(5).sub(u.time.mul(0.1)), seed + 3)).mul(1.9).sub(0.55).saturate()
                .toVar();
            const width = u.px.mul(0.9).add(fall.mul(0.002).mul(pulse.add(0.4)));
            const w2 = width.mul(width).toVar();
            const thread = exp(off.mul(off).div(w2).negate()).add(exp(off.mul(off).div(w2.mul(20)).negate()).mul(0.22));
            rivers.addAssign(thread.mul(pulse).mul(smoothstep(0.01, 0.05, fall)).mul(fadeOut(0.18, 0.5, fall)));
        });
        const flank = rock.add(heatColor(rivers.mul(0.2).add(0.34).min(0.55)).mul(rivers.min(1.2)).mul(0.32));
        sky.assign(mix(sky, flank, softStep(0, below, u)));
    });
    return sky;
}

/** The caldera's far wall: a dark, ragged silhouette whose rocky foot glows red with the lake's light. */
function paintWall(c) {
    const {
        wq, L, fire,
    } = c;
    const h = wq.y.sub(L.shore).max(0).toVar();
    // Crags and ledges: ridged noise, a little taller than wide, so the cliff reads as broken rock.
    const bend = gnoise(vec2(wq.x.mul(3.1), h.mul(3.1).add(1.9))).sub(0.5);
    const crags = ridged(vec2(wq.x.mul(9).add(bend.mul(1.5)), h.mul(13)), 3).toVar();
    const albedo = crags.mul(1.2).add(0.15).toVar();
    // The lake lights the cliff's foot all along the shore, the fountain most of all near it.
    const wx = wq.x.sub(VENT_X);
    const nearFire = exp(wx.mul(wx).mul(-1.4));
    const fromLake = exp(h.mul(-14)).mul(fire).mul(nearFire.mul(0.7).add(0.16)).toVar();
    const lit = FIRELIGHT.mul(fromLake).mul(albedo.mul(albedo)).mul(0.5);
    const wall = BASALT.mul(albedo).mul(0.55).add(lit).toVar();
    // Fume hangs at the cliff's foot.
    return mix(wall, HAZE.mul(fire).mul(1.1), exp(h.mul(-30)).mul(0.55));
}

/**
 * The plume of fume and ash boiling up off the lake behind the fountain. It is lit from below, so
 * it reads as scattered firelight: bright orange-red at its foot and over the fire, deepening to
 * red, then to dark ash as it climbs into the night. Billow undersides catch the light, tops shade.
 */
function paintPlume(c) {
    const {
        u, across, climb, fire, surge, plumeOctaves,
    } = c;
    const drift = u.time.mul(0.045).add(u.breathInt.mul(0.012)).toVar();
    // Billows grow as they climb: height runs on a log scale through the noise.
    const v = log(climb.add(0.28)).mul(1.7).toVar();
    const coord = vec2(across.mul(1.4), v.sub(drift)).toVar();
    const rolled = coord.add(billowRoll(coord, drift)).toVar();
    const smoke = fbm(rolled, plumeOctaves).toVar();
    // Round puffs with soft creases between them ride on the smoke's own roll.
    const puffs = float(1).sub(ridged(coord.mul(1.8).add(smoke.mul(1.1)), 3));
    const billow = smoke.mul(0.65).add(puffs.mul(0.35)).toVar();
    const lower = fbm(rolled.sub(vec2(0, 0.16)), 3);
    // A defined column with a billowing silhouette, inside a wider, softer veil of fume.
    const body = exp(across.mul(across).mul(-1.6)).toVar();
    const column = smoothstep(0.42, 0.58, billow.add(body.sub(0.6)));
    const veil = smoothstep(0.3, 0.75, billow.add(exp(across.mul(across).mul(-0.5)).sub(0.75))).mul(0.45);
    const density = max(column, veil).mul(smoothstep(0.0, 0.12, climb)).mul(fadeOut(1.9, 2.5, across.abs()))
        .toVar();
    // Light from below: strongest low down and over the fire, gone by the top of the column.
    const light = exp(climb.mul(-1.6)).mul(body.mul(0.6).add(0.4)).mul(fire).mul(surge.mul(0.35).add(0.8))
        .toVar();
    // Undersides that face the fire catch it; the tops of billows fall into their own shadow.
    const facing = smoke.sub(lower).mul(5).add(0.5).saturate();
    const tint = mix(FIRELIGHT, EMBER, smoothstep(0.1, 0.9, climb));
    const lit = tint.mul(light).mul(facing.mul(facing).mul(0.95).add(0.3)).mul(billow.add(0.3));
    const glowing = ASH.mul(billow.mul(0.8).add(0.3)).add(lit).add(EMBER.mul(exp(climb.mul(-0.6))).mul(0.02).mul(fire));
    return vec4(glowing, density.mul(0.94));
}

/** The lava lake in perspective: drifting crust plates, open and closed seams, molten patches, the vent's pool. */
function paintLake(c) {
    const {
        ps, u, L, fire, surge, height, fine,
    } = c;
    // Depth by one fixed-point step through the parallax (k = 1 at the vent's depth).
    const v0 = L.horizon.sub(ps.y).max(0.01);
    const lq = layer(ps, u, v0.div(L.camH).min(4)).toVar();
    const depth = L.camH.div(L.horizon.sub(lq.y).max(0.02)).toVar();
    // Lake plane coordinates around the vent: x across, z away from the eye.
    const lx = lq.x.mul(depth).sub(VENT_X).toVar();
    const lz = depth.sub(1).toVar();
    const ventDist2 = lx.mul(lx).add(lz.mul(lz).mul(0.7)).toVar();
    const nearVent = exp(ventDist2.mul(-7)).toVar();

    // Crust plates: irregular cells drifting with the lake's slow current. Two octaves of warp bend
    // their edges, so no two plates share a shape and the net never reads as a tiling.
    const flow = u.time.mul(0.016).add(u.breathInt.mul(0.008)).toVar();
    const P = vec2(lx.mul(0.85), lz.mul(1.15)).mul(PLATES).toVar();
    const broad = vec2(
        fbm(P.mul(0.25).add(vec2(flow.mul(2), 1.7)), 2),
        fbm(P.mul(0.25).add(vec2(4.1, flow.mul(-2))), 2),
    ).sub(0.5);
    const Pw = P.add(broad.mul(2.2)).toVar();
    const ripple = vec2(gnoise(Pw.mul(1.1).add(3.3)), gnoise(Pw.mul(1.1).add(8.8))).sub(0.5);
    const cellP = Pw.add(ripple.mul(0.5)).add(vec2(flow.mul(0.7), flow.mul(-1.1))).toVar();
    if (fine) {
        // Crust tears rather than parts along smooth arcs: a fine warp makes every seam jagged.
        cellP.addAssign(vec2(gnoise(cellP.mul(4.3).add(1.7)), gnoise(cellP.mul(4.3).add(6.1))).sub(0.5).mul(0.1));
    }
    const cells = voronoi(cellP, u.time.mul(0.05)).toVar();
    const seam = cells.y.sub(cells.x).toVar();
    // A pixel's footprint in cell units: far seams widen and dim into a glow instead of shimmering.
    const footprint = u.px.mul(PLATES).mul(depth).mul(depth.div(L.camH).add(1)).mul(0.85)
        .toVar();
    // Most joints are closed, dark lines. A slow field across the lake opens a few into hot rifts,
    // and each seam opens and closes along its own length.
    const opening = gnoise(cellP.mul(0.4).add(vec2(3.1, flow.mul(1.5)))).toVar();
    const along = gnoise(cellP.mul(1.7).add(5.1));
    const open = smoothstep(0.45, 0.8, opening.add(along.sub(0.5).mul(0.5)).add(nearVent.mul(0.3)).add(surge.mul(0.05)))
        .toVar();
    // Where the field peaks, a rift has pulled wide open into a molten channel.
    const channel = smoothstep(0.74, 0.92, opening.add(along.sub(0.5).mul(0.3))).toVar();
    const joint = open.mul(0.024).add(0.007).add(nearVent.mul(0.008)).toVar();
    const width = joint.add(channel.mul(0.035)).toVar();
    const crack = seamGlow(seam, width, footprint).toVar();
    const ropes = fbm(P.mul(vec2(2.2, 3.4)).add(cells.z.mul(19)), 3).toVar();
    // Heat bleeds out of an open seam into the ropy skin of the plates around it.
    const bleed = seamGlow(seam, joint.mul(5), footprint).mul(open).mul(ropes.add(0.4)).toVar();
    // The crust cools away from the vent: far from it a closed joint is only a dull red line.
    const cooling = smoothstep(0.35, 2.6, ventDist2.sqrt()).toVar();
    const seamHeat = open.mul(0.22).add(0.22).add(surge.mul(0.06)).add(nearVent.mul(0.24))
        .add(channel.mul(0.1))
        .sub(cooling.mul(float(1).sub(open)).mul(0.07))
        .toVar();
    // Seams stay a deeper orange than the fountain: white-yellow belongs to the hero alone.
    const glow = heatColor(seamHeat).mul(SEAM_TINT).mul(crack.mul(open.mul(0.88).add(0.12)).add(bleed.mul(0.12))).toVar();
    if (fine) {
        // Where the crust is shattered, a finer craquelure splits the plates.
        const shattered = smoothstep(0.52, 0.72, gnoise(cellP.mul(0.23).add(9.1)).add(nearVent.mul(0.5)));
        const cells2 = voronoi(cellP.mul(2.4).add(vec2(13.1, 5.7)), u.time.mul(0.07));
        const crack2 = seamGlow(cells2.y.sub(cells2.x), width.mul(0.7), footprint.mul(2.4))
            .mul(hash21(vec2(cells2.z.mul(37), 1.3)).mul(0.8).add(0.2));
        glow.addAssign(heatColor(seamHeat.mul(0.85)).mul(crack2).mul(shattered).mul(0.6));
    }
    // The crust: dark basalt with ropy texture; each plate its own age and tone.
    const tone = hash22(vec2(cells.z.mul(71), 3.3)).toVar();
    const crust = BASALT.mul(ropes.mul(0.9).add(0.45)).mul(tone.x.mul(0.6).add(0.7)).toVar();
    // The ropy skin catches the red light of the rifts beside it.
    const nearRift = exp(seam.mul(seam).mul(-14)).mul(open.mul(0.8).add(0.2));
    crust.addAssign(EMBER.mul(ropes.mul(ropes)).mul(nearRift).mul(0.06));
    // Glassy skin: the fountain's light pools on the plates near it, and the lit fume shines on far ones.
    const gloss = ropes.mul(1.3).sub(0.25).saturate().mul(tone.y.mul(0.6).add(0.4))
        .toVar();
    const lightPool = fire.mul(height.add(0.3)).div(ventDist2.mul(22).add(1));
    crust.addAssign(FIRELIGHT.mul(lightPool).mul(0.025).mul(ropes.add(0.2)));
    crust.addAssign(HAZE.mul(fire).mul(gloss).mul(smoothstep(0.6, 2.0, depth)).mul(0.5));
    // Reflection: the fountain mirrored about the vent line, smeared down the lake toward the eye.
    const mirror = L.base.sub(lq.y).max(0).toVar();
    const rx = lq.x.sub(VENT_X).toVar();
    const reflWidth = height.mul(0.05).add(0.025).add(mirror.mul(0.08));
    const reflection = exp(rx.mul(rx).div(reflWidth.mul(reflWidth)).negate())
        .mul(fadeOut(0.0, height.mul(1.1).add(0.1), mirror))
        .mul(smoothstep(-0.02, 0.02, L.base.sub(lq.y)));
    crust.addAssign(vec3(1.0, 0.45, 0.13).mul(reflection).mul(gloss).mul(fire)
        .mul(0.3));
    const lake = crust.add(glow).toVar();
    // Molten patches where the crust has thinned (out in the lake, never under the lens), and the
    // vent's own boil, where crust never forms.
    const thin = fbm(vec2(lx.mul(1.5).add(flow.mul(0.6)), lz.mul(1.9).sub(flow.mul(0.9))), 3).toVar();
    const boil = exp(ventDist2.mul(-38)).toVar();
    const molten = smoothstep(0.64, 0.68, thin.add(boil.mul(0.6))).mul(smoothstep(0.75, 1.0, depth).max(boil)).toVar();
    If(molten.greaterThan(0.001), () => {
        const swirl = fbm3(vec3(lx.mul(7), lz.mul(8), u.time.mul(0.15)), 2);
        const lava = heatColor(swirl.mul(0.3).add(0.36).add(boil.mul(0.24)).add(surge.mul(0.05)));
        // Crust fragments float in the melt, pushed away from the vent.
        const floating = smoothstep(0.03, 0.16, seam).mul(fadeOut(0.5, 1.0, boil));
        lake.assign(mix(lake, lava, molten.mul(float(1).sub(floating.mul(0.75)))));
    });
    const pool = exp(ventDist2.mul(-260)).toVar();
    lake.addAssign(heatColor(pool.mul(0.35).add(0.55)).mul(pool).mul(fire));
    // Aerial perspective: fume over the lake swallows the far shore in lit haze.
    const fog = smoothstep(0.8, 2.3, depth).mul(0.6);
    lake.assign(mix(lake, HAZE.mul(fire), fog));
    return vec4(lake, softStep(lq.y, L.shore, u));
}

/** The fountain: a turbulent column that fans open toward its crown, white-hot in its throat. */
function paintFountain(c) {
    const {
        fq, s, u, height, rise, fire, octaves,
    } = c;
    const up = s.max(0).toVar();
    // The jet sways as it climbs; its crown leans with the wind that takes the plume.
    const sway = gnoise(vec2(fq.y.mul(1.5).sub(rise.mul(0.3)), 3.7)).sub(0.5).mul(0.16).mul(up)
        .mul(height)
        .add(up.mul(up).mul(height).mul(0.05));
    const x = fq.x.sub(sway).toVar();
    // A narrow throat at the vent that fans open toward the crown.
    const half = height.mul(up.mul(up).mul(0.2).add(up.mul(0.08)).add(0.06)).add(0.03).toVar();
    // Turbulence shoves the column about, harder toward the crown.
    const turb = fbm3(vec3(x.mul(5.5), fq.y.mul(3.4).sub(rise.mul(1.4)), u.time.mul(0.4)), 3).sub(0.5);
    const span = x.add(turb.mul(half).mul(up.mul(1.4).add(0.8))).div(half).toVar();
    // Tongues: noise rising through the column. It decides where the crown ends.
    const tongueAt = vec3(span.mul(1.5), fq.y.mul(3.4).sub(rise.mul(2.1)), u.time.mul(0.3).add(5));
    const tongues = fbm3(tongueAt, Math.max(3, octaves - 1))
        .sub(0.5)
        .toVar();
    // Spray: thin jets of molten droplets racing up the column, coarse and fine.
    const jets = gnoise(vec2(span.mul(6.5), fq.y.div(height.add(0.2)).mul(1.8).sub(rise.mul(3.2))))
        .mul(0.6)
        .add(gnoise(vec2(span.mul(15).add(3.1), fq.y.div(height.add(0.2)).mul(3.4).sub(rise.mul(4.6)))).mul(0.4))
        .toVar();
    // A flat-topped cross-section: the column is full of spray right out to its torn edge.
    const span2 = span.mul(span).toVar();
    const profile = float(1).sub(span2.mul(span2)).max(0).toVar();
    const crown = fadeOut(0.72, 1.14, up.add(tongues.mul(1.6)));
    // Tongues lick only from the column's own edge, never out of thin air beside it.
    const reachOut = fadeOut(1.0, 1.7, span.abs());
    const heat = profile.mul(float(0.72).sub(up.mul(0.2))).mul(jets.mul(0.8).add(0.6))
        .add(tongues.mul(up.mul(1.6).add(0.55)).mul(reachOut))
        .mul(crown)
        .mul(smoothstep(-0.03, 0.03, fq.y))
        .toVar();
    // The throat is white-hot.
    const core = float(1).sub(span2).max(0).mul(fadeOut(0.0, 0.45, up))
        .mul(0.24);
    // The boil: a dome of molten lava heaving up where the jet leaves the lake, swallowing its foot.
    const domeW = height.mul(0.1).add(0.07);
    const domeH = height.mul(0.04).add(0.035);
    const heave = gnoise(vec2(fq.x.mul(26), fq.y.mul(14).sub(rise.mul(2.2)))).sub(0.5);
    const dome = exp(fq.x.mul(fq.x).div(domeW.mul(domeW)).add(fq.y.mul(fq.y).div(domeH.mul(domeH))).negate())
        .mul(heave.mul(0.5).add(0.85));
    heat.assign(max(heat, dome.mul(0.95)));
    const flame = heatColor(heat.add(core)).mul(fire.mul(0.3).add(0.8));
    return vec4(flame, smoothstep(0.06, 0.3, heat).mul(0.88));
}

export function createVolcanicWorld({ u, quality, random }) {
    const { octaves, detail } = quality;
    const fine = detail >= 0.6;
    const plumeOctaves = Math.max(3, octaves - 1);

    // Shared by the backdrop and the sprites. The breath drives two things: `surge` (the leap,
    // lung fill with a little follow-through) and `clock` (flow that quickens on the in-breath).
    const surgeOf = () => u.breath.mul(0.55).add(u.breathSoft.mul(0.45));
    const layoutOf = () => calderaLayout(u.ext.y.sub(1).max(0));

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        // Root-pin everything the regions share before the first If (see the TSL skill's gotchas).
        const lay = layoutOf();
        const L = {
            horizon: lay.horizon.toVar(),
            base: lay.base.toVar(),
            camH: lay.camH.toVar(),
            shore: lay.shore.toVar(),
            reach: lay.reach.toVar(),
        };
        const surge = surgeOf().toVar();
        const fire = u.breathSoft.mul(0.4).add(0.68).toVar();
        const height = fountainHeight(surge, L.reach).toVar();
        const rise = u.time.mul(0.9).add(u.breathInt.mul(1.3)).toVar();
        const margin = u.px.mul(4).toVar();

        // Hot air over the lake and above the fountain bends the light from what lies behind it.
        const fq = layer(p, u, 1).sub(vec2(VENT_X, L.base)).toVar();
        const s = fq.y.div(height).toVar();
        const overLake = exp(p.y.sub(L.shore).mul(p.y.sub(L.shore)).mul(-30));
        const overFire = exp(fq.x.mul(fq.x).mul(-14)).mul(smoothstep(-0.1, 0.2, fq.y)).mul(fadeOut(0.2, 1.4, s));
        const shimmerAmp = overLake.mul(0.0035).add(overFire.mul(0.006)).mul(fire).toVar();
        const shimmer = vec2(
            gnoise(vec2(p.x.mul(17), p.y.mul(9).sub(u.time.mul(2.1)))),
            gnoise(vec2(p.x.mul(15).add(7.7), p.y.mul(8).sub(u.time.mul(1.7)))),
        ).sub(0.5).mul(shimmerAmp).toVar();
        const ps = p.add(shimmer).toVar();

        // The far wall's layer decides the regions: sky above its skyline, lake below its foot.
        const kWall = L.horizon.sub(L.shore).div(L.camH).toVar();
        const wq = layer(ps, u, kWall).toVar();
        const skyline = wallSkyline(wq.x, u, L).toVar();
        const pq = layer(ps, u, 0.62).toVar();
        const climb = pq.y.sub(L.base.add(0.05)).max(0).toVar();
        const plumeWidth = climb.mul(0.58).add(0.24).mul(L.reach.mul(0.5).add(0.5)).toVar();
        const across = pq.x.sub(climb.mul(climb).mul(0.11).add(PLUME_X)).div(plumeWidth).toVar();
        const c = {
            p, ps, u, L, fire, surge, height, rise, fq, s, wq, across, climb, octaves, detail, fine, plumeOctaves,
        };
        const col = vec3(0).toVar();
        If(wq.y.greaterThan(skyline.sub(margin)), () => {
            col.assign(paintSky(c));
        });
        If(wq.y.lessThan(skyline.add(margin)).and(wq.y.greaterThan(L.shore.sub(margin))), () => {
            col.assign(mix(col, paintWall(c), fadeOut(skyline.sub(u.px.mul(1.2)), skyline.add(u.px.mul(1.2)), wq.y)));
        });
        If(across.abs().lessThan(2.6).and(pq.y.greaterThan(L.base.sub(0.05))), () => {
            const plume = paintPlume(c).toVar();
            col.assign(mix(col, plume.rgb, plume.a));
        });
        If(wq.y.lessThan(L.shore.add(margin)), () => {
            const lake = paintLake(c).toVar();
            col.assign(mix(col, lake.rgb, lake.a));
        });

        // Fume drifting low over the far lake and the foot of the wall, lit from below.
        const fromShore = ps.y.sub(L.shore).toVar();
        If(fromShore.abs().lessThan(0.2), () => {
            const mist = fbm3(vec3(pq.x.mul(1.6).add(u.time.mul(0.03)), ps.y.mul(5), u.time.mul(0.05)), 2);
            const band = exp(fromShore.mul(fromShore).mul(-160));
            col.addAssign(HAZE.mul(band).mul(mist.mul(1.2).add(0.1)).mul(fire).mul(0.6));
        });

        // Wide enough for the crown's outermost tongues and its sway: no tongue is ever clipped by the test.
        If(fq.x.abs().lessThan(height.mul(0.9).add(0.16)).and(fq.y.greaterThan(-0.06)).and(s.lessThan(1.45)), () => {
            const flame = paintFountain(c).toVar();
            col.assign(col.mul(float(1).sub(flame.a)).add(flame.rgb));
        });

        // Painted glow (the lightest tier has no bloom): a halo around the column and the vent.
        const glowX = fq.x.mul(fq.x).toVar();
        const mid = fq.y.sub(height.mul(0.35));
        const halo = exp(glowX.mul(-6).sub(mid.mul(mid).div(height.mul(height).mul(0.6).add(0.02))));
        col.addAssign(FIRELIGHT.mul(halo).mul(0.1).mul(fire));
        col.addAssign(vec3(1.0, 0.55, 0.2).mul(exp(glowX.mul(-60).sub(fq.y.mul(fq.y).mul(400)))).mul(0.3).mul(fire));
        return col;
    })();

    // The sprites read the same fountain the backdrop paints.
    const lay = layoutOf();
    const spatterScene = {
        vent: [float(VENT_X), lay.base],
        height: fountainHeight(surgeOf(), lay.reach),
        clock: u.time.mul(0.7).add(u.breathInt.mul(0.8)),
        share: u.breathSoft.mul(0.6).add(0.4),
    };
    const objects = [
        createSpatter(u, spatterScene, {
            kind: 'clots', count: 80, size: 0.008, gain: 1.3, scale: quality.motes, random,
        }),
        createSpatter(u, spatterScene, {
            kind: 'sparks', count: 70, size: 0.005, gain: 0.85, scale: quality.motes, random,
        }),
    ];

    return {
        backdrop,
        objects,
        motes: [
            {
                // Embers drifting up out of the caldera everywhere, cooling as they climb.
                motion: MOTE_MOTION.ember,
                count: 150,
                size: 0.016,
                speed: 0.55,
                spread: 1,
                depth: 2.2,
                bokeh: 0.09,
                colorA: [1.0, 0.5, 0.12],
                colorB: [0.55, 0.06, 0.015],
                gain: 1.1,
            },
        ],
        bloom: {
            strength: 0.36, radius: 0.62, threshold: 0.8, breath: 0.45,
        },
        grade: {
            shadows: [0.98, 0.93, 1.02], highlights: [1.05, 0.98, 0.9], saturation: 1.1, contrast: 1.08, vignette: 0.5,
        },
        camera: { dolly: 0.04, drift: [0.03, 0.012], period: 50 },
        exposure: 1.0,
    };
}
