/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Ancient Forest — a cathedral of old trunks at dawn, the sun breaking through a clearing.
 * Inhale: light pours between the trunks and the mist glows. Exhale: the forest dims and settles.
 *
 * Painted in perspective: rows of trunks stand on one ground plane, each row a step deeper into
 * the mist (aerial perspective dissolves the far trunks into the haze). Trunks are backlit
 * cylinders: dark faces, a gold rim on the sunward edge, bark furrows and moss. The canopy is
 * clumped foliage with holes the sun glints through, so the post pipeline's light shafts fan out
 * from the clearing and every trunk and leaf cuts the beams; painted rays underneath keep the light
 * alive on the lightest tier. Ferns frame the bottom corners, out of focus.
 */
import {
    Fn, exp, float, mix, sin, smoothstep, sqrt, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fbm3, gnoise, hash21, layer, softStep, turn, voronoi,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

/** The sun hangs in the canopy's clearing: x in hero units, and how far below the screen's top. */
const SUN = [-0.1, 0.44];
/** Light streams from the canopy band: this far below the screen's top and up. */
const RAY_REGION = 0.5;
const GOLD = vec3(1.0, 0.72, 0.36);
const SUNLIGHT = vec3(1.0, 0.92, 0.7);
const MIST = vec3(0.18, 0.31, 0.3);
const SHADE = vec3(0.005, 0.014, 0.016);
const BARK = vec3(0.014, 0.014, 0.012);
const MOSS = vec3(0.045, 0.085, 0.022);
/** Far to near: depth, cell width (world units), trunk half-width (fraction of a cell), seed. */
const ROWS = [
    {
        d: 9.5, cell: 0.38, width: 0.13, seed: 1.7,
    },
    {
        d: 5.8, cell: 0.5, width: 0.15, seed: 5.3,
    },
    {
        d: 3.6, cell: 0.68, width: 0.17, seed: 9.1, clear: 0.12,
    },
    {
        d: 2.25, cell: 0.92, width: 0.19, seed: 13.9, clear: 0.22,
    },
    {
        d: 1.4, cell: 1.3, width: 0.21, seed: 21.4, edges: true,
    },
];
/** The hero plane (k = 1) sits at this depth: nearer rows slide past farther ones. */
const HERO_DEPTH = 2.6;
/** Ferns at the frame's edge: side, base x (fraction of the half-width), angle, length, droop. */
const FRONDS = [
    [-1, 1.02, 1.05, 0.62, 0.55], [-1, 0.86, 1.28, 0.5, 0.75], [-1, 0.98, 0.72, 0.58, 0.35],
    [-1, 0.7, 1.5, 0.4, 0.9], [1, 1.0, 1.1, 0.6, 0.5], [1, 0.84, 1.36, 0.46, 0.8], [1, 0.95, 0.78, 0.55, 0.4],
];

/** x³ of a noise that may dip a hair below zero: pow() of a negative base is NaN. */
const cube = (x) => {
    const c = x.max(0).toVar();
    return c.mul(c).mul(c);
};

/**
 * One fern frond as a soft mask: a drooping spine with slanted leaflets that shorten toward the
 * tip. `soft` is the edge width (wide: out of focus). Returns the mask and the distance inside.
 */
function frond(p, base, angle, length, droop, soft) {
    const local = turn(p.sub(base), float(angle).negate()).toVar();
    const s = local.x;
    const along = s.div(length).toVar();
    // The spine droops as it reaches out.
    const t = local.y.add(along.mul(along).mul(droop).mul(length)).toVar();
    const span = smoothstep(0.0, 0.06, along).mul(fadeOut(0.92, 1.0, along));
    const taper = float(1).sub(along).max(0).pow(0.7)
        .mul(smoothstep(0.0, 0.2, along).mul(0.6).add(0.4))
        .mul(length)
        .mul(0.2);
    // Leaflets lean toward the tip; each one is a pointed blade.
    const slant = s.sub(t.abs().mul(0.9)).div(length).mul(17);
    const blade = sin(slant.fract().mul(Math.PI)).max(0).sqrt();
    const reach = taper.mul(blade).add(length * 0.008);
    const inside = reach.sub(t.abs());
    return smoothstep(float(-soft), float(soft), inside).mul(span);
}

export function createForestWorld({ u, quality }) {
    const { octaves } = quality;
    const rows = quality.detail >= 0.5 ? ROWS : ROWS.filter((_, index) => index !== 1);
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const glow = u.breathSoft.mul(0.75).add(0.45).toVar();
        // Tall screens see more floor and more canopy: the horizon sinks with the extra height.
        const horizon = float(-0.14).sub(u.ext.y.sub(1).mul(0.32)).toVar();
        const ground = float(0.58).add(u.ext.y.sub(1).mul(0.3)).toVar();
        const top = u.ext.y.sub(u.focus).toVar();
        const sky = layer(p, u, 0.15).toVar();
        const toSun = sky.sub(vec2(SUN[0], top.sub(SUN[1]))).toVar();
        const sunDistance = toSun.length().toVar();

        // The haze: deep blue-green shade, a band of mist at eye level, light scattered near the sun.
        const drift = u.time.mul(0.015);
        const haze = fbm3(vec3(sky.x.mul(0.9).add(drift), sky.y.mul(1.7), u.time.mul(0.02)), 3).toVar();
        const eyeLevel = exp(sky.y.sub(horizon).sub(0.2).abs().mul(-2.0));
        const mist = SHADE.add(MIST.mul(eyeLevel.mul(haze.mul(0.7).add(0.45)).mul(0.26))).toVar();
        mist.addAssign(MIST.mul(exp(sunDistance.mul(-1.6))).mul(haze.mul(0.6).add(0.7)).mul(0.5).mul(glow));
        mist.addAssign(GOLD.mul(exp(sunDistance.mul(-3.6))).mul(0.45).mul(glow));
        // Away from the sun the haze cools toward blue, as distance does: warm light, cool depth.
        mist.mulAssign(mix(vec3(1.0), vec3(0.78, 0.94, 1.3), float(1).sub(exp(sunDistance.mul(-1.1)))));
        // What trunks dissolve into: the haze, never the sun's core (that would light them up).
        const fogColor = mist.toVar();
        const air = mist.add(SUNLIGHT.mul(exp(sunDistance.mul(-13))).mul(1.4).mul(glow)).toVar();
        // The sun itself, a white-gold core the shafts are drawn from.
        air.addAssign(SUNLIGHT.mul(exp(sunDistance.mul(sunDistance).mul(-2600))).mul(7).mul(glow));
        // Painted beams under the post shafts: they fan down from the sun, broken by slow noise.
        const angle = toSun.y.atan(toSun.x);
        const beams = cube(gnoise(vec2(angle.mul(7), u.time.mul(0.02)))).mul(2.0)
            .add(cube(gnoise(vec2(angle.mul(19).add(4), u.time.mul(0.03)))).mul(0.8));
        const shafts = beams.mul(exp(sunDistance.mul(-1.15))).mul(smoothstep(0.03, 0.3, sunDistance)).mul(glow)
            .mul(smoothstep(-0.1, 0.4, toSun.y.negate()))
            .toVar();
        const col = air.add(SUNLIGHT.mul(shafts).mul(0.08)).toVar();

        // The forest floor: moss and litter in perspective, with pools of light and a path.
        const below = horizon.sub(p.y).max(1e-3).toVar();
        const groundDepth = ground.div(below).min(60).toVar();
        const groundK = float(HERO_DEPTH).div(groundDepth).min(2.2);
        const gq = layer(p, u, groundK);
        const gx = gq.x.mul(groundDepth).toVar();
        const gz = groundDepth.toVar();
        const litter = fbm(vec2(gx.mul(1.4), gz.mul(1.4)), Math.max(3, octaves - 1)).toVar();
        const fleck = gnoise(vec2(gx.mul(9), gz.mul(9)));
        // Moss in the hollows, russet leaf litter on the rises.
        const russet = smoothstep(0.45, 0.75, fbm(vec2(gx.mul(0.8), gz.mul(0.8)).add(9.3), 3));
        const floorBase = mix(vec3(0.012, 0.013, 0.008), MOSS, litter.mul(1.4).sub(0.35).saturate())
            .mul(fleck.mul(0.5).add(0.75)).toVar();
        floorBase.assign(mix(floorBase.mul(1.4), vec3(0.09, 0.05, 0.018).mul(fleck.mul(0.6).add(0.7)), russet.mul(0.7)));
        // Dapples: light that slipped between trunks and leaves, stretched by the low angle.
        const dapple = voronoi(vec2(gx.mul(2.6), gz.mul(1.1)).add(vec2(drift.mul(4), 0)), u.time.mul(0.08));
        const broken = gnoise(vec2(gx.mul(7), gz.mul(3))).mul(0.18);
        const spots = fadeOut(0.05, 0.22, dapple.x.add(broken)).mul(hash21(vec2(dapple.z.mul(91), 3.1)).mul(0.8).add(0.2));
        const pathX = gx.sub(float(SUN[0]).mul(gz)).sub(sin(gz.mul(0.7)).mul(0.3)).abs();
        const path = fadeOut(0.2, 0.9, pathX);
        const sunDx = gq.x.sub(SUN[0]).toVar();
        const sunward = exp(sunDx.mul(sunDx).mul(-1.8)).mul(exp(groundDepth.mul(-0.1)));
        floorBase.addAssign(GOLD.mul(spots.mul(sunward).mul(path.mul(0.7).add(0.3)).mul(0.8)).mul(glow));
        floorBase.addAssign(vec3(0.025, 0.04, 0.016).mul(path).mul(glow));
        // Aerial perspective on the floor too: it melts into the haze toward the horizon.
        const floorFog = float(1).sub(exp(groundDepth.mul(-0.12)));
        const floorColor = mix(floorBase, fogColor.mul(0.75), floorFog.mul(0.9));
        col.assign(mix(col, floorColor, fadeOut(horizon.sub(u.px.mul(1.5)), horizon.add(u.px.mul(1.5)), p.y)));

        // Rows of trunks, far to near. Each row stands on its own ground line and has its own parallax.
        rows.forEach((row, index) => {
            const k = HERO_DEPTH / row.d;
            const q = layer(p, u, k).toVar();
            const groundLine = horizon.sub(ground.div(row.d)).toVar();
            const worldX = q.x.mul(row.d).div(row.cell).add(row.seed).toVar();
            const id = worldX.floor().toVar();
            const rand = hash21(vec2(id, row.seed)).toVar();
            // Height above this row's ground; never negative, so no term below the ground can blow up.
            const height = q.y.sub(groundLine).max(0).toVar();
            const lean = rand.sub(0.5).mul(0.08);
            const bend = gnoise(vec2(q.y.mul(1.1).add(id.mul(3.1)), row.seed + 2)).sub(0.5).mul(0.1);
            const centre = hash21(vec2(id.mul(1.37), row.seed + 11)).sub(0.5).mul(0.5).add(0.5);
            const across = worldX.fract().sub(centre).sub(height.mul(lean)).sub(bend)
                .toVar();
            // Roots: the trunk flares where it meets the ground.
            const flare = exp(height.mul(row.d).mul(-2.6)).mul(0.85).add(1);
            const size = hash21(vec2(id.mul(2.3), row.seed + 7)).toVar();
            const girth = size.mul(size).mul(0.9).add(0.55).mul(row.width)
                .mul(flare)
                .toVar();
            const o = across.div(girth).toVar();
            // Edge softness: about a pixel on screen whatever the depth.
            const edgePx = u.px.mul(1.5).div(girth.mul(row.cell).div(row.d)).toVar();
            let mask = fadeOut(float(1).sub(edgePx).max(0), float(1).add(edgePx), o.abs())
                .mul(softStep(groundLine, q.y, u));
            // Some cells stand empty: a forest, not a fence (the far rows more so: no picket wall).
            // Nearer rows leave the clearing open.
            const empty = index < 2 ? 0.38 : 0.12;
            mask = mask.mul(smoothstep(empty, empty + 0.08, rand));
            if (row.clear) mask = mask.mul(smoothstep(row.clear * 0.6, row.clear, q.x.sub(SUN[0]).abs()));
            if (row.edges) mask = mask.mul(smoothstep(0.42, 0.7, q.x.abs().div(u.ext.x)));
            // Far trunks dissolve into the sunlit haze before they reach the canopy.
            if (index < 2) mask = mask.mul(fadeOut(top.sub(0.95 - index * 0.15), top.sub(0.45 - index * 0.1), q.y));
            // Backlit cylinder: faces in shadow, a thin gold rim on the sunward edge.
            const sunSide = float(SUN[0]).sub(q.x).sign();
            // Backlight is strongest straight in front of the sun and falls away in every direction.
            const dx = q.x.sub(SUN[0]).toVar();
            const dy = q.y.sub(top.sub(SUN[1])).toVar();
            const near = exp(dx.mul(dx).mul(-1.6).sub(dy.mul(dy).mul(0.7))).toVar();
            const edge = o.mul(sunSide).max(0).toVar();
            const edge2 = edge.mul(edge);
            const rim = edge2.mul(edge2).mul(edge2).mul(edge);
            const roundness = sqrt(float(1).sub(o.mul(o)).max(0));
            // Bark: deep vertical furrows, broken into plates.
            const furrows = gnoise(vec2(o.mul(4.2).add(id.mul(7.7)), q.y.mul(row.d).mul(0.9))).toVar();
            const plates = gnoise(vec2(o.mul(9).add(id.mul(3.3)), q.y.mul(row.d).mul(4)));
            const moss = smoothstep(0.5, 0.85, fbm(vec2(o.mul(2).add(id), q.y.mul(row.d).mul(2.2)), 3)
                .add(exp(height.mul(row.d).mul(-1.4)).mul(0.45)).add(o.mul(sunSide).mul(-0.15)));
            const tone = hash21(vec2(id.mul(5.1), row.seed + 3)).mul(0.5).add(0.75);
            const bark = mix(BARK.mul(tone), MOSS, moss.mul(0.75))
                .mul(smoothstep(0.25, 0.75, furrows).mul(0.9).add(0.35)).mul(plates.mul(0.4).add(0.8))
                .mul(roundness.mul(0.5).add(0.5))
                .toVar();
            // A little of the haze wraps into each trunk; the rim is the sun itself.
            bark.addAssign(fogColor.mul(0.1).mul(roundness));
            // Far trunks keep only a whisper of rim: the haze between eats it.
            const rimGain = 2.4 / (1 + row.d * 0.6);
            bark.addAssign(GOLD.mul(rim).mul(near.mul(rimGain).add(0.1)).mul(glow).mul(float(1).sub(moss.mul(0.6))));
            // The farther the row, the more of the air in front of it is lit by the sun's halo too.
            const fog = 1 - Math.exp(-row.d * 0.14);
            const trunk = mix(bark, mix(fogColor, air, fog * fog * 0.85), fog);
            col.assign(mix(col, trunk, mask));
            // Mist pooled at the foot of each row, drifting.
            const pool = exp(q.y.sub(groundLine).abs().mul(-3.2 * Math.min(row.d, 4)))
                .mul(fbm3(vec3(q.x.mul(1.4).add(drift.mul(index + 1)), q.y.mul(3), u.time.mul(0.03).add(index)), 2)
                    .mul(0.8).add(0.2));
            col.addAssign(MIST.mul(pool).mul(0.18 / (index + 1)).mul(glow));
            if (index < 3) col.addAssign(SUNLIGHT.mul(shafts).mul(0.03 * (3 - index)));
            // Undergrowth between the two nearest rows: low leafy mounds, rimmed where the sun is behind.
            if (index === 3) {
                const depth = 1.75;
                const bq = layer(p, u, HERO_DEPTH / depth).toVar();
                const baseLine = horizon.sub(ground.div(depth)).toVar();
                const mounds = fbm(vec2(bq.x.mul(2.4), 7.1), 3).sub(0.4).mul(0.32).max(0);
                const leafy = gnoise(bq.mul(vec2(46, 34))).sub(0.5).mul(0.03);
                const crest = baseLine.add(mounds).add(leafy).toVar();
                // Clumps with forest floor between them, not a hedge.
                const clumps = smoothstep(0.46, 0.58, fbm(vec2(bq.x.mul(1.3), 3.3), 3));
                const bush = softStep(0, crest.sub(bq.y), u).mul(smoothstep(baseLine.sub(0.05), baseLine.sub(0.01), bq.y))
                    .mul(clumps);
                const bdx = bq.x.sub(SUN[0]).toVar();
                const bushRim = exp(crest.sub(bq.y).max(0).mul(-220)).mul(exp(bdx.mul(bdx).mul(-2.5)));
                const leaves = gnoise(bq.mul(vec2(55, 48))).mul(0.6).add(0.6);
                const bushColor = mix(MOSS.mul(0.45).mul(leaves), fogColor.mul(0.6), 0.3).add(GOLD.mul(bushRim).mul(0.35).mul(glow));
                col.assign(mix(col, mix(bushColor, fogColor, 1 - Math.exp(-depth * 0.14)), bush));
            }
        });

        // The canopy: hanging clumps of leaves. Deep in a clump the leaves overlap into shade; toward
        // its edge they thin out into single leaves against the light, and the gaps between them are
        // where the sun glints through (and where the post shafts are born).
        [[0.55, 0.0, 0.0], [1.0, 3.7, 1.0]].forEach(([k, seed, nearness]) => {
            const cq = layer(p, u, k).toVar();
            const sway = u.time.mul(0.03).add(seed);
            const warp = vec2(fbm(cq.mul(1.2).add(vec2(sway, 2.1 + seed)), 3), fbm(cq.mul(1.2).add(vec2(7.3, sway)), 3));
            const clumps = fbm(cq.mul(vec2(1.5, 1.9)).add(warp.mul(1.1)).add(seed), Math.max(4, octaves)).toVar();
            const cdx = cq.x.sub(SUN[0]).toVar();
            const clearing = exp(cdx.mul(cdx).mul(-2.4)).toVar();
            // A gentle ramp keeps the canopy overhead; the clumps decide where it actually hangs.
            const ceiling = cq.y.sub(top).add(0.7 - 0.14 * nearness).sub(clearing.mul(0.28)).mul(0.9);
            const density = clumps.sub(0.5).mul(1.9).add(0.5).add(ceiling)
                .toVar();
            const open = float(0.5).add(u.breathSoft.mul(0.04));
            const cover = smoothstep(open.sub(0.07), open.add(0.12), density).toVar();
            // One leaf per small cell, larger where the foliage is dense; they flutter a little.
            const cells = 30 - nearness * 8;
            // A little domain warp makes every leaf its own irregular shape instead of a round cell.
            const lq = cq.mul(vec2(cells, cells * 1.35)).add(seed * 11).toVar();
            const bent = vec2(gnoise(lq.mul(0.55)), gnoise(lq.mul(0.55).add(5.2))).sub(0.5).mul(0.7);
            const leafCell = voronoi(lq.add(bent), u.time.mul(0.35).add(seed));
            const radius = cover.mul(0.95);
            const leafEdge = u.px.mul(cells * 1.6);
            const leafMask = fadeOut(radius.sub(leafEdge), radius.add(leafEdge), leafCell.x).mul(smoothstep(0.02, 0.1, cover));
            // Backlit leaves near the sun let light through: gold-green at the thin edges, dark in the mass.
            const shine = exp(sunDistance.mul(sunDistance).mul(-3.2)).mul(float(1).sub(cover.mul(0.75))).toVar();
            const tint = hash21(vec2(leafCell.z.mul(53), seed)).mul(0.5).add(0.75);
            const leaf = mix(vec3(0.004, 0.01, 0.006), vec3(0.3, 0.42, 0.06), shine.mul(glow)).mul(tint).toVar();
            leaf.addAssign(vec3(0.8, 0.75, 0.3).mul(shine.mul(shine)).mul(glow).mul(0.8));
            // The far canopy sits in the haze.
            if (nearness < 1) leaf.assign(mix(leaf, fogColor, 0.45));
            col.assign(mix(col, leaf, leafMask));
        });

        // Ferns at the frame's bottom corners, close to the lens and out of focus.
        const fq = layer(p, u, 2.4).toVar();
        const bottom = u.ext.y.negate().sub(u.focus);
        const fern = float(0).toVar();
        FRONDS.forEach(([side, baseX, tilt, length, droop], index) => {
            const base = vec2(u.ext.x.mul(side * baseX), bottom.sub(0.06));
            const turnBy = side < 0 ? tilt : Math.PI - tilt;
            const wave = sin(u.time.mul(0.4).add(index * 1.7)).mul(0.015);
            fern.assign(fern.max(frond(fq, base, float(turnBy).add(wave), length, side < 0 ? droop : -droop, 0.012)));
        });
        const fernDx = fq.x.sub(SUN[0]).toVar();
        const fernLit = exp(fernDx.mul(fernDx).mul(-0.8)).mul(0.08).mul(glow);
        col.assign(mix(col, vec3(0.004, 0.012, 0.006).add(GOLD.mul(fernLit)), fern.mul(0.96)));
        // The whole forest breathes a little brighter on the in-breath.
        return col.mul(u.breathSoft.mul(0.14).add(0.93));
    })();

    // The light's screen position follows the top of the screen (portrait puts it higher).
    const shafts = {
        source: [SUN[0], 0.42, 0.15],
        region: 0.2,
        radius: 0.4,
        strength: 1.15,
        threshold: 0.8,
        decay: 0.975,
        length: 0.7,
        tint: [1.0, 0.86, 0.62],
        breath: 0.75,
    };
    return {
        backdrop,
        motes: [
            {
                // Dust and pollen hanging in the light.
                motion: MOTE_MOTION.wander,
                count: 130,
                size: 0.011,
                speed: 0.35,
                spread: 0.85,
                band: [-0.5, 0.8],
                depth: 2.4,
                bokeh: 0.14,
                colorA: [1.0, 0.88, 0.58],
                colorB: [0.86, 1.0, 0.7],
                gain: 0.5,
            },
        ],
        shafts,
        bloom: {
            strength: 0.3, radius: 0.75, threshold: 0.75, breath: 0.4,
        },
        grade: {
            shadows: [0.86, 0.98, 1.04], highlights: [1.06, 1.0, 0.86], saturation: 1.08, contrast: 1.06, vignette: 0.45,
        },
        camera: { dolly: 0.045, drift: [0.035, 0.012], period: 64 },
        exposure: 1.0,
        update({ ext }) {
            const top = ext.y - u.focus.value;
            shafts.source[1] = top - SUN[1];
            shafts.region = top - RAY_REGION;
        },
    };
}
