/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Crystal Prism — a quartz point floating in the heart of a misty crystal grotto, splitting one
 * beam of white light into a spectrum.
 * Inhale: the light fans into colour across the grotto. Exhale: the fan gathers back into white
 * light at the crystal. Empty: the crystal rests, slowly turning, a thin ray still leaving it.
 *
 * The crystal is real geometry with a traced material (crystal-gem.js): it refracts the grotto,
 * splits colours at its faces, reflects light inside itself and carries a glowing heart that
 * swells with the breath; splinters of the same quartz float around it at several depths. The
 * grotto is painted in depth: misty air that dissolves into a band of light along the far floor,
 * a distant field of crystals, druses on the floor (the nearest stands where the fan lands),
 * dark rock closing in at the top corners with druses hanging from it and a cleft where the beam
 * comes in, a wet stone floor that mirrors the light, and out-of-focus crystals close to the lens.
 * The beam and the fan are painted on the hero plane with the same functions the crystal's shader
 * sees (crystal-light.js), so stone and air always agree. Where the fan lands it paints moving
 * rainbow caustics; dust glints wherever light passes. Landscape lights the grotto from the upper
 * left and sweeps the fan to the right; a tall screen takes the light from above and pours it down.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, dot, exp, float, floor, fract, length, min, mix, sin, smoothstep, sqrt, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fbm3, gnoise, hash21, hash22, layer, ridged,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';
import {
    packBeam, packFan, packLook, packSky, prismBeam, prismFan,
} from './crystal-light.js';
import { createQuartzMaterial, createQuartzSolid } from './crystal-gem.js';

/** Beam travel angle (radians) on a wide screen and on a tall one; the fan bends further clockwise. */
const BEAM_ANGLE = [-0.26, -1.3];
const BEND = [0.2, 0.27];
/** The fan's half-angle and reach (hero units) at empty and at full lungs. */
const SPREAD = [0.028, 0.47];
const REACH = [1.0, 4.2];
/** Width of the light bands where they leave the crystal. */
const BAND = 0.05;
const WHITE = vec3(1.0, 0.97, 0.94);
const ICE = vec3(0.5, 0.86, 1.0);
const AIR_LOW = vec3(0.007, 0.022, 0.03);
const AIR_HIGH = vec3(0.003, 0.005, 0.016);
const GLASS = vec3(0.01, 0.026, 0.04);
const STONE = vec3(0.01, 0.013, 0.018);

/**
 * The distant crystal field along the floor line: depth (hero distances), cell width (world
 * units), height range (cells), where clusters thin out (`gap`) and how long they are (`clump`).
 */
const FAR_FIELD = {
    d: 4.2, cell: 0.16, height: [0.7, 3.2], gap: 0.44, clump: 0.21, seed: 3.1,
};
/**
 * Druses on the floor and hanging from the vault: x as a fraction of the screen's half-width (so
 * they frame any shape of screen), depth, the longest point (world units), the cluster's lean and
 * spread (radians), how many points, seed. The one on the right stands where the fan lands.
 */
const DRUSES = [
    {
        x: -0.74, d: 1.7, size: 0.6, lean: 0.14, spread: 1.5, count: 7, seed: 11,
    },
    {
        x: 0.66, d: 1.35, size: 0.66, lean: -0.12, spread: 1.6, count: 8, seed: 23,
    },
    {
        x: -0.2, d: 3.1, size: 0.75, lean: 0.06, spread: 1.3, count: 6, seed: 37,
    },
    {
        x: 1.0, d: 2.4, size: 0.6, lean: -0.32, spread: 1.2, count: 6, seed: 41,
    },
];
/** The rock frame sits a little in front of the hero plane. */
const ROCK_K = 1.25;
const VAULT_DRUSES = [
    {
        x: -0.5, size: 0.27, lean: -0.1, spread: 1.6, count: 7, seed: 53,
    },
    {
        x: 0.62, size: 0.23, lean: 0.16, spread: 1.4, count: 6, seed: 67,
    },
];
/**
 * Out-of-focus crystals close to the lens at the bottom corners: side, x (fraction of the
 * half-width), lean, length, width.
 */
const NEAR_POINTS = [
    [-1, 0.98, 0.42, 0.95, 0.12], [-1, 0.76, 0.18, 0.62, 0.09], [-1, 1.12, 0.74, 0.78, 0.11],
    [1, 0.96, -0.36, 0.85, 0.11], [1, 1.1, -0.68, 0.72, 0.1], [1, 0.79, -0.14, 0.5, 0.08],
];
/** Floating splinters: angle and radius around the crystal (ellipse units), depth z, size, spin. */
const SHARDS = [
    [0.5, 0.95, -0.9, 0.23, 0.1], [2.35, 0.9, 0.55, 0.2, -0.08], [3.4, 0.8, -1.4, 0.26, 0.06],
    [4.3, 1.0, 0.9, 0.15, -0.11], [5.5, 0.85, -0.4, 0.19, 0.09], [1.4, 1.05, 1.3, 0.12, -0.07],
];

/**
 * One quartz point as a painted silhouette: a hexagonal prism seen from the side (three faces)
 * closing to a point. `local` is (along the axis, across) in the crystal's own units.
 * Returns its coverage, where across it a pixel is (-1..1, for the three faces), how far up
 * (0 root … 1 tip), and the distance to the nearest face line (outline or face boundary).
 */
function quartzPoint(local, height, width, soft, root = -0.5) {
    const along = local.x;
    // Quartz closes in a short pyramid: about as long as the prism is wide.
    const tip = width.mul(1.15);
    const y = local.y.abs();
    // Inside the prism's sides and under the two faces that close to the apex (negative past it).
    const inside = min(width.sub(y), height.sub(along).mul(width).div(tip).sub(y)).toVar();
    const half = width.mul(height.sub(along).div(tip).clamp(0, 1)).max(1e-4).toVar();
    const across = local.y.div(half).toVar();
    const cover = smoothstep(float(soft).negate(), float(soft), inside)
        .mul(smoothstep(float(root).sub(0.1), float(root), along));
    const ridge = across.abs().sub(0.36).abs().mul(half);
    return {
        cover, across, rise: along.div(height).clamp(0, 1), lines: ridge.min(inside.abs()),
    };
}

/**
 * Light a painted quartz point. Its three faces see different things: the face toward the beam
 * catches white light and carries a specular streak, the far face takes the fan's colour, and the
 * face toward us shows the dark grotto through the glass. Dark at the root, clearer toward the
 * tip, and the termination catches the light.
 */
function shadeQuartz(point, beamSide, fanLight, glow, soft) {
    const face = point.across.mul(beamSide).toVar();
    const toBeam = smoothstep(0.3, 0.42, face);
    const toFan = smoothstep(0.3, 0.42, face.negate());
    const front = float(1).sub(toBeam).sub(toFan);
    const rise = point.rise.toVar();
    const lit = WHITE.mul(toBeam.mul(0.07).add(front.mul(0.012)).add(0.008)).mul(glow)
        .add(fanLight.mul(toFan.mul(0.75).add(front.mul(0.22)).add(toBeam.mul(0.08))));
    const body = GLASS.mul(rise.mul(rise).mul(1.4).add(0.35)).add(lit.mul(rise.mul(0.8).add(0.25)));
    const streak = exp(face.sub(0.72).pow2().mul(-70)).mul(rise.mul(0.6).add(0.3));
    const tipGlint = smoothstep(0.8, 0.97, rise);
    const edge = exp(point.lines.div(soft.mul(1.4)).pow2().negate());
    return body
        .add(WHITE.mul(streak.mul(0.05).add(tipGlint.mul(0.04))).mul(glow))
        .add(fanLight.mul(tipGlint.mul(0.6).add(streak.mul(0.3))))
        .add(ICE.mul(edge).mul(0.05).mul(glow))
        .add(fanLight.mul(edge).mul(0.5));
}

/**
 * One cell of a band of quartz points (a row on the floor, a fringe on the vault). Points grow
 * in clusters: a slow envelope along the band decides where a cluster stands and how tall it
 * grows, so the band reads as druses with gaps between them, never as a fence. Taller points lean
 * less, so every tip stays inside the two cells the caller draws. `wx` runs along the band in
 * cells; `wy` is the height above the band's root line in cells.
 */
function quartzCell(wx, wy, cell, spec, soft) {
    const c = cell.toVar();
    const r1 = hash21(vec2(c, spec.seed)).toVar();
    const r2 = hash21(vec2(c.mul(1.37), spec.seed + 4.1)).toVar();
    const r3 = hash21(vec2(c.mul(0.71), spec.seed + 8.3)).toVar();
    const cluster = smoothstep(spec.gap, spec.gap + 0.26, gnoise(vec2(c.mul(spec.clump), spec.seed))).toVar();
    const present = smoothstep(0.18, 0.24, r1).mul(smoothstep(0.02, 0.1, cluster));
    const giant = smoothstep(0.88, 0.92, r3).mul(0.7).add(1);
    const tall = mix(float(spec.height[0]), float(spec.height[1]), cluster.mul(r2.mul(0.6).add(0.4)))
        .mul(giant).toVar();
    const width = r3.mul(0.18).add(0.2);
    // Points in a druse fan out from its middle: lean away from where the envelope peaks.
    const slopeOut = gnoise(vec2(c.add(1).mul(spec.clump), spec.seed))
        .sub(gnoise(vec2(c.sub(1).mul(spec.clump), spec.seed)));
    const lean = slopeOut.mul(-2.2).add(r2.sub(0.5).mul(0.6));
    const tilt = lean.clamp(-1, 1).mul(float(0.42).div(tall.max(0.8)).min(0.55)).toVar();
    const rel = vec2(wx.sub(c.add(0.5).add(r1.sub(0.5).mul(0.3))), wy.add(0.15)).toVar();
    const axis = vec2(tilt.sin(), tilt.cos()).toVar();
    const local = vec2(dot(rel, axis), rel.x.mul(axis.y).sub(rel.y.mul(axis.x)));
    const point = quartzPoint(local, tall, width, soft);
    return { point, mask: point.cover.mul(present) };
}

/** A small deterministic generator, so a druse keeps its shape whatever else changes. */
function seeded(seed) {
    let state = seed * 0x9e3779b1;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The points of one druse, radiating from a shared root: the middle ones longest, the outer ones
 * shorter and leaning further out. Sorted longest first, so shorter points are drawn in front.
 */
function drusePoints({
    size, lean, spread, count, seed,
}) {
    const rand = seeded(seed);
    return Array.from({ length: count }, (_, index) => {
        const t = (index + 0.2 + rand() * 0.6) / count;
        const middle = 1 - Math.abs(t - 0.5) * 2;
        const reach = size * (0.38 + 0.62 * middle ** 0.8) * (0.72 + 0.5 * rand());
        return {
            angle: lean + (t - 0.5) * spread + (rand() - 0.5) * 0.18,
            reach,
            width: reach * (0.12 + 0.07 * rand()) + size * 0.02,
            offset: (t - 0.5) * size * 0.42 + (rand() - 0.5) * size * 0.08,
        };
    }).sort((a, b) => b.reach - a.reach);
}

/**
 * Paint one druse. `rel` is the pixel relative to its root in world units at its depth, with y
 * pointing the way the points grow. Returns nothing: it composites into `col`.
 */
function paintDruse(col, rel, spec, soft, shadeFor) {
    drusePoints(spec).forEach(({
        angle, reach: size, width, offset,
    }) => {
        const axisX = Math.sin(angle);
        const axisY = Math.cos(angle);
        const from = rel.sub(vec2(offset, -size * 0.08)).toVar();
        const local = vec2(from.x.mul(axisX).add(from.y.mul(axisY)), from.x.mul(axisY).sub(from.y.mul(axisX)));
        const point = quartzPoint(local, float(size), float(width), soft, 0);
        // Each point grows out of the floor (or the vault): nothing of it shows past its root line.
        col.assign(mix(col, shadeFor(point), point.cover.mul(smoothstep(soft.negate(), soft, rel.y))));
    });
}

export function createCrystalWorld({ u, quality }) {
    const { octaves } = quality;
    // Phones (Low) and the lightest tier take fewer octaves where the eye cannot tell.
    const light2 = quality.detail < 0.6;
    // The composition follows the screen's shape: set in update() from the extents.
    const beamDir = uniform(new THREE.Vector2(Math.cos(BEAM_ANGLE[0]), Math.sin(BEAM_ANGLE[0])));
    const fanDir = uniform(new THREE.Vector2(Math.cos(BEAM_ANGLE[0] - BEND[0]), Math.sin(BEAM_ANGLE[0] - BEND[0])));

    /** The light's packed parameters, as fresh nodes for each shader that asks. */
    const light = () => {
        const b = u.breathSoft;
        const spread = mix(float(SPREAD[0]), float(SPREAD[1]), b);
        const reach = mix(float(REACH[0]), float(REACH[1]), b);
        // Brighter as it fans: the in-breath feeds the light, the empty hold rests it.
        const gain = b.mul(1.05).add(0.32);
        return {
            fan: packFan(fanDir, spread, reach),
            look: packLook(float(BAND), float(0.012), gain),
            beam: packBeam(beamDir, float(0.011), float(0.075)),
            sky: packSky(b.mul(0.5).add(0.75), b.mul(0.8).add(0.3)),
        };
    };

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const glow = u.breathSoft.mul(0.75).add(0.35).toVar();
        const { fan, look, beam } = light();
        const fanV = fan.toVar();
        const lookV = look.toVar();
        const beamV = beam.toVar();
        const beamSide = beamV.x.sign().negate().toVar();
        // Tall screens see more floor and more vault: the floor line sinks with the extra height.
        const horizon = float(-0.42).sub(u.ext.y.sub(1).mul(0.5)).toVar();
        const ground = float(0.55).add(u.ext.y.sub(1).mul(0.25)).toVar();
        // Where the floor passes under the hero plane: the fan's light lands here.
        const contact = horizon.sub(ground).toVar();
        const top = u.ext.y.sub(u.focus).toVar();
        const bottom = u.ext.y.negate().sub(u.focus).toVar();
        const { time } = u;

        // The hero plane: the crystal, the beam and the fan live here.
        const q = layer(p, u, 1).toVar();
        const fanLight = prismFan(q, fanV, lookV).toVar();
        const rays = prismBeam(q, beamV).toVar();
        // Light scattered in the mist spreads the fan into a soft glow around its bands.
        const halo = prismFan(q, fanV, vec4(lookV.x.mul(6), lookV.y.mul(5), lookV.z, 0)).toVar();

        // The air: a cold teal haze down by the wet floor, deep indigo up in the vault.
        const sky = layer(p, u, 0.12).toVar();
        const lift = smoothstep(horizon.sub(0.3), top.add(0.3), sky.y).toVar();
        const haze = fbm3(vec3(sky.x.mul(0.8).add(time.mul(0.012)), sky.y.mul(1.5), time.mul(0.018)), 3).toVar();
        const air = mix(AIR_LOW, AIR_HIGH, lift).mul(haze.mul(1.3).add(0.28)).toVar();
        // Far off, the grotto dissolves into a band of misty light along the floor line: depth.
        const farGlow = exp(sky.y.sub(horizon).sub(0.12).div(0.32).pow2()
            .negate());
        air.addAssign(AIR_LOW.mul(farGlow).mul(haze.add(0.4)).mul(0.9));
        const nearCrystal = exp(dot(q, q).mul(-1.6)).toVar();
        air.addAssign(ICE.mul(nearCrystal).mul(0.05).mul(glow).mul(haze.add(0.5)));
        air.addAssign(WHITE.mul(rays.y).mul(0.035).mul(haze.mul(0.8).add(0.6)));
        air.addAssign(halo.mul(0.035).mul(haze.add(0.5)));
        // What distant things dissolve into.
        const fogColor = air.toVar();
        const col = air.toVar();

        // The floor: dark polished stone, wet in pools, seen in perspective.
        const below = horizon.sub(p.y).max(1e-3).toVar();
        const depth = ground.div(below).min(40).toVar();
        const fq = layer(p, u, float(1).div(depth).min(2.2)).toVar();
        const gx = fq.x.mul(depth).toVar();
        const tone = fbm(vec2(gx.mul(1.1), depth.mul(1.1)), Math.max(3, octaves - 1)).toVar();
        const veinNoise = gnoise(vec2(gx.mul(2.3), depth.mul(2.3)).add(tone.mul(1.4))).sub(0.5);
        // Pale mineral veins, broken: they come and go with the stone's tone.
        const vein = exp(veinNoise.mul(veinNoise).mul(-700)).mul(smoothstep(0.45, 0.7, tone));
        const wet = smoothstep(0.42, 0.6, fbm(vec2(gx.mul(0.45), depth.mul(0.6)).add(3.3), light2 ? 2 : 3)).toVar();
        // A wet floor is a mirror at grazing angles (far away) and only glossy underfoot.
        const graze = float(1).sub(below.div(sqrt(below.mul(below).add(1)))).toVar();
        const graze2 = graze.mul(graze);
        // Pools are mirrors (more so at grazing angles); the dry stone between them is only glossy.
        const fresnelFloor = graze2.mul(graze2).mul(graze).toVar();
        const shine = mix(fresnelFloor.mul(0.35).add(0.03), fresnelFloor.mul(0.7).add(0.3), wet).toVar();
        // Reflections: the hero plane's light mirrored about where the floor passes beneath it,
        // the air and its glows about the horizon; ripples in the pools break them up.
        const ripple = gnoise(vec2(gx.mul(4), depth.mul(9).add(time.mul(0.15)))).sub(0.5).mul(0.035)
            .mul(float(1).sub(wet.mul(0.6)));
        const mq = vec2(q.x.add(ripple), contact.mul(2).sub(q.y)).toVar();
        const mirrored = prismFan(mq, fanV, lookV).mul(0.8).add(WHITE.mul(prismBeam(mq, beamV).x).mul(1.2))
            .add(ICE.mul(exp(dot(mq, mq).mul(-1.6))).mul(0.1).mul(glow));
        const farMirror = vec2(q.x.add(ripple.mul(2)), horizon.mul(2).sub(q.y));
        const mirroredAir = mix(AIR_LOW, AIR_HIGH, smoothstep(horizon.sub(0.3), top.add(0.3), farMirror.y))
            .mul(haze.mul(1.3).add(0.28))
            .add(prismFan(farMirror, fanV, vec4(lookV.x.mul(6), lookV.y.mul(5), lookV.z, 0)).mul(0.1))
            .add(WHITE.mul(prismBeam(farMirror, beamV).y).mul(0.06));
        // Where the fan meets the floor it lands as moving rainbow caustics.
        const landing = exp(depth.sub(1).pow2().mul(-1.4)).mul(smoothstep(0.35, 0.7, depth)).toVar();
        // Light through a slowly turning crystal lands as a web of bright, shifting ridges.
        const cq = vec2(gx.mul(2.4), depth.mul(1.7)).toVar();
        const warp = vec2(
            gnoise(cq.mul(0.6).add(vec2(time.mul(0.05), 1.3))),
            gnoise(cq.mul(0.6).add(vec2(5.2, time.mul(0.04)))),
        ).sub(0.5).mul(1.4).toVar();
        const crestA = ridged(cq.add(warp).add(vec2(time.mul(0.06), 0)), 2).toVar();
        const crestB = ridged(cq.mul(1.6).sub(warp).add(vec2(3.3, time.mul(-0.05))), 2).toVar();
        const a2 = crestA.mul(crestA);
        const b2 = crestB.mul(crestB);
        const caustics = a2.mul(a2).mul(1.1).add(b2.mul(b2).mul(0.7)).add(a2.mul(b2).mul(1.4))
            .add(0.22)
            .toVar();
        const floorBase = STONE.mul(tone.mul(1.3).add(0.35)).add(vec3(0.02, 0.035, 0.045).mul(vein).mul(0.4))
            .mul(float(1).sub(wet.mul(0.6)))
            .add(AIR_LOW.mul(0.25));
        // The crystal's glow pools on the floor beneath it.
        const pool = exp(q.x.mul(q.x).mul(-2.5).sub(depth.sub(1).pow2().mul(1.5))).mul(glow).mul(0.06);
        const floorColor = floorBase.add(fanLight.mul(caustics).mul(landing).mul(1.3)).add(ICE.mul(pool))
            .add(mirrored.add(mirroredAir).mul(shine))
            .toVar();
        // Aerial perspective: the floor melts into the haze toward the horizon.
        floorColor.assign(mix(floorColor, fogColor, float(1).sub(exp(depth.mul(-0.16)))));
        col.assign(mix(col, floorColor, fadeOut(horizon.sub(u.px.mul(1.5)), horizon.add(u.px.mul(1.5)), p.y)));

        // The distant crystal field, dissolving into the haze.
        {
            const row = FAR_FIELD;
            const rq = layer(p, u, 1 / row.d).toVar();
            const groundLine = horizon.sub(ground.div(row.d)).toVar();
            const wx = rq.x.mul(row.d).div(row.cell).add(row.seed).toVar();
            const wy = rq.y.sub(groundLine).mul(row.d).div(row.cell).toVar();
            const id = floor(wx).toVar();
            // A crystal may lean over its neighbour's cell: draw the nearer neighbour, then this one.
            const side = fract(wx).lessThan(0.5).select(float(-1), float(1));
            const soft = u.px.mul(1.3).mul(row.d).div(row.cell).toVar();
            const fog = 1 - Math.exp(-row.d * 0.36);
            [id.add(side), id].forEach((cell) => {
                const { point, mask } = quartzCell(wx, wy, cell, row, soft);
                col.assign(mix(col, mix(shadeQuartz(point, beamSide, fanLight, glow, soft), fogColor, fog), mask));
            });
        }
        // Druses on the floor, far to near, each fading into the haze by its depth.
        [...DRUSES].sort((a, b) => b.d - a.d).forEach((spec) => {
            const dq = layer(p, u, 1 / spec.d).toVar();
            const root = vec2(u.ext.x.mul(spec.x), horizon.sub(ground.div(spec.d)));
            const rel = dq.sub(root).mul(spec.d).toVar();
            const soft = u.px.mul(1.3).mul(spec.d).toVar();
            const fog = 1 - Math.exp(-spec.d * 0.36);
            paintDruse(col, rel, spec, soft, (point) => mix(
                shadeQuartz(point, beamSide, fanLight, glow, soft),
                fogColor,
                fog,
            ));
        });

        // Mist drifting between the crystals, lit by whatever light passes through it.
        const wq = layer(p, u, 0.6).toVar();
        const wisps = fbm3(vec3(wq.x.mul(1.3).add(time.mul(0.02)), wq.y.mul(2.4), time.mul(0.025)), light2 ? 2 : 3);
        const veil = smoothstep(0.42, 0.78, wisps).toVar();
        col.addAssign(halo.mul(0.22).add(WHITE.mul(rays.y).mul(0.12)).add(ICE.mul(nearCrystal).mul(0.05).mul(glow))
            .add(AIR_LOW.mul(0.3))
            .mul(veil));

        // The beam and the fan in the dusty air of the hero plane. Dust streams along the rays.
        const along = dot(q, fanV.xy).toVar();
        const sideways = q.y.mul(fanV.x).sub(q.x.mul(fanV.y));
        const radius = length(q).toVar();
        const slope = sideways.div(along.max(0.05)).toVar();
        const dustAt = vec3(radius.mul(1.3).sub(time.mul(0.05)), slope.mul(9), time.mul(0.04));
        const dust = fbm3(dustAt, light2 ? 2 : 3).toVar();
        const streak = gnoise(vec2(slope.mul(48), radius.mul(0.35).sub(time.mul(0.02)))).toVar();
        const scatter = dust.mul(1.1).add(0.25).mul(streak.mul(0.7).add(0.65));
        // Below the line where the floor passes under the hero plane, the floor stands in front.
        const open = smoothstep(contact.sub(0.03), contact.add(0.03), q.y).toVar();
        col.addAssign(fanLight.mul(scatter).mul(0.62).mul(open));
        const beamAlong = dot(q, beamV.xy);
        const beamAcross = q.y.mul(beamV.x).sub(q.x.mul(beamV.y));
        const beamDust = gnoise(vec2(beamAlong.mul(2.6).sub(time.mul(0.12)), beamAcross.mul(38))).mul(0.7).add(0.55);
        const beamGlow = u.breathSoft.mul(0.35).add(0.75);
        col.addAssign(WHITE.mul(rays.x.mul(1.3).add(rays.y.mul(0.07))).mul(beamDust).mul(beamGlow));
        // The crystal's own glow on the air behind it (the bloom adds to this on tiers that have it).
        col.addAssign(ICE.mul(exp(dot(q, q).mul(-14))).mul(0.15).mul(glow));

        // Dust motes glinting wherever the light passes.
        const glints = (k, cells, seed) => {
            const gq = layer(p, u, k).mul(cells).toVar();
            const cell = floor(gq).toVar();
            const h = hash22(cell.add(seed)).toVar();
            const wander = vec2(sin(time.mul(0.21).add(h.x.mul(40))), sin(time.mul(0.17).add(h.y.mul(50)))).mul(0.12);
            const at = h.mul(0.5).add(0.25).add(wander);
            const d = length(fract(gq).sub(at)).div(u.px.mul(cells)).toVar();
            const pick = smoothstep(0.88, 0.92, hash21(cell.add(seed + 3)));
            const twinkle = sin(time.mul(h.x.mul(0.6).add(0.4)).add(h.y.mul(30))).mul(0.4).add(0.6);
            return exp(d.mul(d).mul(-0.45)).mul(pick).mul(twinkle);
        };
        const sparkle = glints(1.15, 24, 1.3).add(glints(0.85, 38, 7.1).mul(0.7));
        col.addAssign(fanLight.mul(1.6).add(WHITE.mul(rays.x.mul(1.2).add(rays.y.mul(0.4)))).mul(sparkle).mul(open));

        // The grotto's rock, close to the lens: two dark masses that come down at the top corners
        // like the lip of a cave mouth, ragged with stalactite crests, and a cleft in the rock where
        // the beam comes in. The middle stays open to the misty vault.
        const kq = layer(p, u, ROCK_K).toVar();
        const lipAt = (x) => float(0.04).add(smoothstep(0.32, 1.05, x.abs().div(u.ext.x)).pow(1.6).mul(0.78));
        const toEdge = kq.x.abs().div(u.ext.x).toVar();
        const crests = ridged(vec2(kq.x.mul(3.2), 0.7), 3).toVar();
        const lip = lipAt(kq.x).add(fbm(vec2(kq.x.mul(2.1), 3.1), light2 ? 3 : 4).mul(0.2))
            .add(crests.mul(crests).mul(crests).mul(0.16).mul(smoothstep(0.2, 0.6, toEdge)))
            .toVar();
        const intoRock = lip.sub(top.sub(kq.y)).toVar();
        const kAlong = dot(kq, beamV.xy);
        const kAcross = kq.y.mul(beamV.x).sub(kq.x.mul(beamV.y));
        const cleft = fadeOut(0.05, 0.13, kAcross.abs().add(gnoise(vec2(kAlong.mul(6), 1.7)).sub(0.5).mul(0.07)))
            .mul(smoothstep(0.3, 0.7, kAlong.negate())).toVar();
        const rock = smoothstep(-0.005, 0.005, intoRock).mul(float(1).sub(cleft)).toVar();

        // Druses hanging from the rock (drawn first: the rock hides their roots).
        VAULT_DRUSES.forEach((spec) => {
            const x0 = u.ext.x.mul(spec.x);
            const rel = vec2(kq.x.sub(x0), top.sub(lipAt(x0)).add(0.03).sub(kq.y)).mul(1 / ROCK_K).toVar();
            const soft = u.px.mul(1.3).div(ROCK_K).toVar();
            paintDruse(col, rel, spec, soft, (point) => shadeQuartz(point, beamSide, fanLight.mul(0.6), glow, soft)
                .mul(0.75)
                .add(ICE.mul(point.rise.pow2()).mul(nearCrystal.mul(0.3).add(0.02)).mul(glow)));
        });

        // Rock: near black, grained; its lip and the cleft's walls lit by the light that reaches them.
        const grain = fbm(kq.mul(5.5), light2 ? 2 : 3).toVar();
        const reaching = halo.mul(0.28).add(WHITE.mul(rays.y.mul(0.6).add(rays.x.mul(0.25))))
            .add(ICE.mul(nearCrystal).mul(0.08).mul(glow))
            .add(AIR_LOW.mul(0.5));
        // The lip is rough: light catches its bumps and misses the hollows between them.
        const rim = exp(intoRock.max(0).mul(-45)).mul(grain.mul(1.6).sub(0.25).saturate()).add(cleft.mul(0.7));
        const flecks = glints(ROCK_K, 64, 4.4).mul(exp(intoRock.max(0).mul(-12)));
        const rockColor = vec3(0.004, 0.006, 0.01).mul(grain.mul(0.9).add(0.5))
            .add(reaching.mul(rim.mul(0.8).add(flecks.mul(0.8)).add(0.015)));
        col.assign(mix(col, rockColor, rock));

        // Out-of-focus crystals close to the lens frame the bottom corners.
        const nq = layer(p, u, 2.2).toVar();
        NEAR_POINTS.forEach(([side, x, lean, size, width]) => {
            const base = vec2(u.ext.x.mul(side * x), bottom.sub(0.12));
            const rel = nq.sub(base).toVar();
            const axis = vec2(Math.sin(-lean), Math.cos(-lean));
            const local = vec2(rel.x.mul(axis.x).add(rel.y.mul(axis.y)), rel.x.mul(axis.y).sub(rel.y.mul(axis.x)));
            const point = quartzPoint(local, float(size), float(width), 0.018);
            const shade = shadeQuartz(point, beamSide, fanLight.mul(0.35), glow, float(0.02)).mul(0.6);
            col.assign(mix(col, shade, point.cover.mul(0.97)));
        });

        // The whole grotto breathes a little brighter on the in-breath.
        return col.mul(u.breathSoft.mul(0.12).add(0.94));
    })();

    // The crystal and its splinters share one solid; the splinters take a lighter trace.
    const solid = createQuartzSolid(undefined, 'prism_quartz');
    const crystalMaterial = createQuartzMaterial({
        u, solid, light, bounces: quality.detail >= 0.7 ? 3 : 2, dispersion: true, glow: 1, phantoms: true, exit: 0.3,
    });
    const shardMaterial = createQuartzMaterial({
        u, solid, light, bounces: 2, dispersion: quality.detail >= 0.5, glow: 0.35, lit: 0.35,
    });
    const crystal = new THREE.Mesh(solid.geometry, crystalMaterial);
    const pose = new THREE.Group();
    // Leaning toward the light, the tip a little toward the viewer so its facets show.
    pose.rotation.set(0.22, 0, 0.32);
    pose.add(crystal);
    const shards = SHARDS.map(([angle, reach, z, size], index) => {
        const shard = new THREE.Mesh(solid.geometry, shardMaterial);
        shard.scale.setScalar(size);
        shard.position.set(Math.cos(angle) * reach, Math.sin(angle) * reach, z);
        shard.rotation.set(index * 1.3, index * 0.7, index * 2.1);
        return shard;
    });
    const group = new THREE.Group();
    group.add(pose, ...shards);

    // Gentle rays from the crystal: the painted beam and fan carry the light; this only adds air.
    const shafts = {
        source: [0, 0, 1],
        radius: 0.3,
        strength: 0.3,
        threshold: 1.2,
        decay: 0.97,
        length: 0.7,
        tint: [1, 1, 1],
        breath: 0.6,
    };
    return {
        backdrop,
        objects: [group],
        motes: [
            {
                // Prismatic sparks around the stone: they fan out on the in-breath and gather back.
                motion: MOTE_MOTION.halo,
                count: 60,
                size: 0.014,
                spread: 0.9,
                depth: 1.6,
                bokeh: 0.12,
                colorA: [1.0, 0.55, 0.85],
                colorB: [0.45, 0.95, 1.0],
                gain: 0.55,
            },
        ],
        shafts,
        bloom: {
            strength: 0.3, radius: 0.65, threshold: 0.85, breath: 0.6,
        },
        grade: {
            shadows: [0.86, 0.96, 1.1], highlights: [1.03, 1.0, 0.98], saturation: 1.12, contrast: 1.06, vignette: 0.42,
        },
        camera: { dolly: 0.04, drift: [0.03, 0.014], period: 60 },
        exposure: 1.0,
        update({ time, ext, breathSoft }) {
            const tall = THREE.MathUtils.smoothstep(ext.y, 1.05, 1.9);
            const beam = THREE.MathUtils.lerp(BEAM_ANGLE[0], BEAM_ANGLE[1], tall);
            const out = beam - THREE.MathUtils.lerp(BEND[0], BEND[1], tall);
            beamDir.value.set(Math.cos(beam), Math.sin(beam));
            fanDir.value.set(Math.cos(out), Math.sin(out));
            // Slow enough that a facet takes more than a second to pass through the light.
            crystal.rotation.y = time * 0.07;
            // The splinters keep to a ring that is wide on a wide screen and tall on a tall one; it
            // opens a little on the in-breath, as the light fans out, and gathers back on the out-breath.
            const open = 0.9 + 0.16 * breathSoft;
            const rx = (0.62 + 0.35 * (1 - tall)) * open;
            const ry = (0.5 + 0.55 * tall) * open;
            shards.forEach((shard, index) => {
                const [angle, reach, z, , spin] = SHARDS[index];
                const a = angle + time * 0.012 * (index % 2 ? -1 : 1);
                const bob = Math.sin(time * 0.3 + index * 2) * 0.02;
                shard.position.set(Math.cos(a) * reach * rx, Math.sin(a) * reach * ry + bob, z);
                shard.rotation.y = time * spin + index;
            });
        },
    };
}
