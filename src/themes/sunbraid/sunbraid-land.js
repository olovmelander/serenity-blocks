/**
 * Sunbraid — the land: one fan of ground round the eye (rows crowd near the lens), white gypsum
 * with warm patches, polygon crusts, drifts of pale scrub and selenite glitter, lit by the three
 * suns and shadowed by every tower and glider.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, dFdx, dFdy, dot, float, floor, fract, fwidth, int, length, max, min, mix, normalize,
    normalWorld, positionWorld, reflect, select, smoothstep, step, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { groundHeight } from './sunbraid-plan.js';
import { drainSteps, stepClock } from '../shared/build-steps.js';
import {
    DEG, crustPulses, haze, landSuns, leanSky, mist, sbCellEdge, sbCylinderVis, sbHash21, skyColor, sunLight,
    sunVisibility,
} from './sunbraid-tsl.js';

/** The fan's reach (metres) and bearing span (degrees either side of the view axis). */
export const FAN = Object.freeze({ near: 6, far: 18000, span: 100 });

/**
 * The salt crust: polygon cells `cell` metres across (centres jittered by `jitter`), their edge
 * ridges reaching `ridge` cell units either side of the border and up to `height` metres high
 * (from `lift[0]` of it, in stretches `lift[1]`/32 metres long); the borders wander by up to
 * `wander[0]` cells in bends `wander[1]`/32 metres long and merge in knots (a smooth minimum, `knot`
 * cells soft) where they meet; a
 * face turned from the suns keeps `bounce` of the flat floor's light; each cell's tone varies by
 * ±`tone`/2; the fine grain's relief (metres). Ridge, slope and tone are box-filtered over
 * `filter` pixels across the border. Ridges and tones are drawn while a cell is wider than
 * 1/`fade[1]` pixels, fully from 1/`fade[0]`; the bump itself is gone by `far` metres.
 */
export const FLOOR_CRUST = Object.freeze({
    cell: 24,
    jitter: 0.85,
    ridge: 0.06,
    height: 0.22,
    lift: Object.freeze([0.35, 1280]),
    wander: Object.freeze([0.12, 384]),
    knot: 0.018,
    bounce: 0.3,
    tone: 0.07,
    bright: 0.09,
    grain: 0.03,
    filter: 1.5,
    fade: Object.freeze([0.1, 0.3]),
    near: 700,
    far: 3200,
});

/**
 * A ridge's cross-section at `x` ridge half-widths from its border (x ≥ 0): 1 on the border,
 * easing to 0 at x = 1 with level ends.
 */
const ridgeAt = (x) => {
    const u = float(1.0).sub(min(x, 1.0));
    return u.mul(u).mul(float(3.0).sub(u.mul(2.0)));
};
/** The cross-section's integral from the far foot to signed `x` (½ on the border, 1 past it). */
const ridgeRise = (x) => {
    const u = float(1.0).sub(min(abs(x), 1.0));
    const tail = u.mul(u).mul(u).mul(float(1.0).sub(u.mul(0.5)));
    return select(x.greaterThanEqual(0.0), float(1.0).sub(tail), tail);
};
/**
 * The film of water a shower leaves on the plain. It gathers in the broad lows first (`lows`:
 * metres across one read of the noise) and the crust's ridges stand out of it; under it the gypsum
 * is `dark` as bright; its ripples tilt the mirror by up to `ripple` (a slope): the baked noise
 * laid `wave` metres across, so a ripple is some five metres long (ripples smaller than a pixel
 * were a grainy speckle in the suns' images, not glitter); `shore` how far the damp runs ahead of
 * the water (in the same units as the level); what it mirrors of a tower is `tower` of the dome's
 * dusk; from `far` metres out the whole plain is wet.
 */
export const FLOOR_WATER = Object.freeze({
    lows: 2100, dark: 0.7, ripple: 0.09, wave: 150, shore: 0.12, tower: 0.4, far: Object.freeze([700, 2200]),
});

/**
 * The dust the ground wind drives over the crust: streamers `broad` then `fine` metres across and
 * `long`/`short` metres long, the fine ones running `lead` times as fast; how much of the floor
 * under a full streamer they hide; nearer than `near` metres they thin out (the lens is above them);
 * `glow` how much brighter than the floor the dust stands (the suns are in front of the eye: it
 * scatters their light on toward the lens), `relief` how far its sunward side out-shines its lee,
 * read `step` metres toward the suns.
 */
export const FLOOR_DUST = Object.freeze({
    broad: 150,
    long: 1700,
    fine: 46,
    short: 520,
    lead: 1.6,
    cover: 0.62,
    near: Object.freeze([40, 170]),
    glow: 1.16,
    relief: 0.34,
    step: 14,
});

/**
 * A pulse of light in the crust: a lit tile keeps `keep` of its own colour under the light and
 * takes `fill` of the pulse over its face; a ridge gives up `ridge` of its own and takes `edge` of
 * the pulse (a lock's ripple lights the ridges alone: light along the cracks, never a flood of
 * colour beside the board).
 */
export const FLOOR_PULSE = Object.freeze({
    keep: 0.45, fill: 0.42, edge: 1.5, ridge: 0.85,
});

/** The selenite: the share of the glitter's cells that hold a crystal, and how bright its glint is. */
export const SELENITE = Object.freeze({ share: 0.018, gain: 3.6 });

/**
 * How long a slice of the fan's vertices runs before it yields to the page (ms). In one step the
 * fan held Sunbraid's first-visit switch ~37 ms (2026-10-31).
 */
const FAN_SLICE_MS = 8;

/** The fan's vertices, normals and indices (CPU). */
export function buildFan(cols, rows) {
    return drainSteps(buildFanSteps(cols, rows));
}

/** `buildFan` as steps (the world's build breathes between them): the same rows, yielding every FAN_SLICE_MS. */
export function* buildFanSteps(cols, rows) {
    const clock = stepClock(FAN_SLICE_MS);
    const count = cols * rows;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const ratio = FAN.far / FAN.near;
    const e = 0.75;
    for (let j = 0; j < rows; j++) {
        const f = j / (rows - 1);
        const d = FAN.near * ratio ** f;
        for (let i = 0; i < cols; i++) {
            const bearing = (-FAN.span + (2 * FAN.span * i) / (cols - 1)) * DEG;
            const x = Math.sin(bearing) * d;
            const z = -Math.cos(bearing) * d;
            const y = groundHeight(x, z);
            const k = (j * cols + i) * 3;
            position[k] = x;
            position[k + 1] = y;
            position[k + 2] = z;
            // The slope from the height function itself (a step that grows with distance).
            const h = Math.max(e, d * 0.004);
            const dx = (groundHeight(x + h, z) - groundHeight(x - h, z)) / (2 * h);
            const dz = (groundHeight(x, z + h) - groundHeight(x, z - h)) / (2 * h);
            const len = Math.hypot(dx, 1, dz);
            normal[k] = -dx / len;
            normal[k + 1] = 1 / len;
            normal[k + 2] = -dz / len;
        }
        if (clock.due()) {
            yield 'fan rows';
            clock.restart();
        }
    }
    const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
    let n = 0;
    for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
            const a = j * cols + i;
            const b = a + 1;
            const c = a + cols;
            const d = c + 1;
            // Wound so the faces look up: (b − a) × (c − a) points along +y.
            index[n++] = a;
            index[n++] = b;
            index[n++] = c;
            index[n++] = b;
            index[n++] = d;
            index[n++] = c;
        }
    }
    return { position, normal, index };
}

export function createLand(u, t, tier) {
    return drainSteps(createLandSteps(u, t, tier));
}

/** `createLand` as steps: the fan in slices (buildFanSteps), then the geometry, material and mesh. */
export function* createLandSteps(u, t, tier) {
    const fan = yield* buildFanSteps(tier.fan.cols, tier.fan.rows);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(fan.normal, 3));
    geometry.setIndex(new THREE.BufferAttribute(fan.index, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld).toVar();
        // White gypsum, crusted into great polygons whose raised rims catch the light, with drifts
        // of pale scrub: the suns give the colour.
        const patch = texture(t.noise, P.xz.div(2600.0)).g;
        const fine = texture(t.noise, P.xz.div(70.0)).b;
        const grain = texture(t.noise, P.xz.div(9.0)).a;
        const crustA = texture(t.noise, P.xz.div(1400.0).add(vec2(0.13, 0.71))).b;
        const crustB = texture(t.noise, P.xz.div(610.0).add(vec2(0.57, 0.29))).b;
        const rimA = float(1.0).sub(abs(crustA.mul(2.0).sub(1.0)));
        const rimB = float(1.0).sub(abs(crustB.mul(2.0).sub(1.0)));
        const rims = smoothstep(0.9, 0.985, rimA).max(smoothstep(0.9, 0.98, rimB).mul(0.7));
        const gypsum = vec3(0.95, 0.94, 0.91);
        const warm = vec3(0.95, 0.9, 0.84);
        const scrub = vec3(0.72, 0.76, 0.7);
        const ground = mix(gypsum, warm, smoothstep(0.35, 0.75, patch).mul(0.6));
        const scrubby = smoothstep(0.55, 0.75, patch.add(fine.sub(0.5).mul(0.5))).mul(smoothstep(0.45, 0.7, grain));
        // The salt crust: polygons a couple of dozen metres across whose edges stand up in ridges a
        // hand's breadth high. With the suns this low a ridge's face toward them catches the light and
        // its back falls into shade, so the polygons tile away to the horizon; each polygon is its own
        // shade of white. Ridges and tones fade to their mean where a cell shrinks toward a pixel.
        //
        // Everything that changes across a border (the ridge's white, its slope, the step from one
        // cell's tone to the next) is worked out exactly from the distance to that border and
        // averaged over the pixel's own width across it, so a ridge stays a clean line at any
        // range. (Its slope once came from screen derivatives, which GPUs take per 2 × 2 pixels:
        // the ridges broke into dotted, stair-stepped lines.)
        const C = FLOOR_CRUST;
        const cp = P.xz.div(C.cell).toVar();
        // The borders wander a little (no ruled lines in a salt pan).
        const wanderAt = P.xz.div(C.wander[1]);
        const wander = vec2(texture(t.noise, wanderAt).b, texture(t.noise, wanderAt.add(vec2(0.37, 0.61))).b);
        // Where borders meet, their ridges merge in a rounded knot: the ridge follows a smooth
        // minimum of the distances to them all, rising along its gradient.
        const crust = sbCellEdge(cp.add(wander.sub(0.5).mul(C.wander[0])).toVar(), float(C.jitter), float(C.knot));
        const edge = crust.soft.max(0.0).toVar();
        const toward = crust.lean.toVar();
        const cellPx = fwidth(cp).length().toVar();
        const crustSeen = float(1.0).sub(smoothstep(C.fade[0], C.fade[1], cellPx)).toVar();
        // The ridges stand higher in some stretches than others. (A height drawn for each border
        // jumped where three cells meet, each seeing its own pair of borders: the junctions
        // flickered as the eye moved.)
        const stand = mix(float(C.lift[0]), 1.0, smoothstep(0.3, 0.7, texture(t.noise, P.xz.div(C.lift[1])).b))
            .toVar();
        // The pixel's width across the border (cell units): its square's shadow on the gradient.
        const across = abs(dot(dFdx(cp), toward)).add(abs(dot(dFdy(cp), toward)))
            .mul(C.filter).max(1e-4)
            .toVar();
        const at = edge.div(C.ridge);
        const span = across.div(C.ridge);
        const lo = at.sub(span.mul(0.5)).toVar();
        const hi = at.add(span.mul(0.5)).toVar();
        // Far off, the mean: about two cell widths of border per cell, a ridge's worth across each.
        const ridge = mix(
            float(2.0 * C.ridge * (1 + C.lift[0]) * 0.5),
            ridgeRise(hi).sub(ridgeRise(lo)).div(span).mul(stand),
            crustSeen,
        ).toVar();
        const crossing = across.mul(0.5).sub(crust.edge).div(across).clamp(0.0, 0.5);
        const cellTone = mix(crust.id, crust.other, crossing).sub(0.5).mul(C.tone).mul(crustSeen);
        // The salt heaps up white along the ridges.
        const shade = float(0.94).add(grain.mul(0.08)).sub(rims.mul(0.035)).add(cellTone)
            .add(ridge.mul(C.bright));
        const albedo = mix(ground, scrub, scrubby.mul(0.7)).mul(shade).toVar();
        // The ridge's mean slope over the pixel (metres per metre, rising toward the border).
        const rake = ridgeAt(abs(lo)).sub(ridgeAt(hi)).div(across).mul(stand)
            .mul(C.height / C.cell);
        // The grain's slope from two more reads a pixel's width away (mip-filtered alike).
        const reach = fwidth(P.xz).length().max(0.02).toVar();
        const grainX = texture(t.noise, P.xz.add(vec2(reach, 0.0)).div(9.0)).a;
        const grainZ = texture(t.noise, P.xz.add(vec2(0.0, reach)).div(9.0)).a;
        const near = smoothstep(C.far, C.near, length(P.sub(u.eye)));
        const slope = toward.mul(rake.mul(crustSeen))
            .add(vec2(grainX, grainZ).sub(grain).mul(C.grain).div(reach))
            .mul(near);
        const Nb = normalize(N.sub(vec3(slope.x, 0.0, slope.y))).toVar();
        const vis = sunVisibility(u, P, t.noise).toVar();
        // The suns' light here: in colour, or the one white sun's ahead of the colour's front.
        const suns = landSuns(u, P);
        // A face turned from the suns still takes the glare off the white floor round it.
        const flatLit = sunLight(u, N, vis, 0, suns).toVar();
        const lit = max(sunLight(u, Nb, vis, 0, suns), flatLit.mul(C.bounce));
        // (At dusk the afterglow comes from where the suns set: a ridge's face toward it catches
        // it, so the crust is still a crust when the suns are gone, not a flat field.)
        const afterDir = normalize(vec3(u.centre.x, 0.14, u.centre.z));
        const ambient = mix(u.horizon, u.zenith, 0.55).mul(N.y.mul(0.35).add(0.65)).mul(0.07)
            .add(u.afterglow.mul(max(dot(Nb, afterDir), 0.0).mul(2.6).add(0.3)))
            .toVar();
        // Selenite: a crystal now and then, each turned its own way, catching a sun's glint (the
        // glints of a sun hidden by a shadow go out with it, so the fans show in the sparkle too).
        // Cells are laid out in the coordinates the eye projects along (a few pixels at any range).
        const rel = P.xz.sub(u.eye.xz);
        const dist = length(rel).toVar();
        const lift = u.eye.y.sub(u.groundY);
        const gridUv = vec2(rel.x.div(max(dist, 1.0)), lift.div(max(dist, 1.0))).mul(vec2(720.0, 900.0));
        const cell = floor(gridUv);
        const f = fract(gridUv).sub(0.5);
        const h1 = sbHash21(cell);
        const h2 = sbHash21(cell.add(vec2(17.3, 41.7)));
        // (Sparse and bright: a crystal in seven cells read as static over the whole floor.)
        const crystal = smoothstep(0.42, 0.08, length(f)).mul(step(h1, SELENITE.share));
        const tilt = vec3(h1.sub(SELENITE.share * 0.5).mul(9.0 * (0.07 / SELENITE.share)), 1.0, h2.sub(0.5).mul(0.7));
        const facet = normalize(tilt);
        const view = normalize(P.sub(u.eye)).toVar();
        const mirror = reflect(view, facet);
        const glintOf = (S) => {
            const m = max(dot(mirror, S), 0.0);
            const m2 = m.mul(m);
            const m4 = m2.mul(m2);
            const m8 = m4.mul(m4);
            return m8.mul(m8).mul(m8);
        };
        const glint = suns.c0.mul(glintOf(u.sun0).mul(vis.x))
            .add(suns.c1.mul(glintOf(u.sun1).mul(vis.y)))
            .add(suns.c2.mul(glintOf(u.sun2).mul(vis.z)))
            .mul(crystal.mul(SELENITE.gain).mul(smoothstep(3000.0, 700.0, dist)));
        const colour = albedo.mul(lit.add(ambient)).add(glint).toVar();
        const ridgeTop = ridge.clamp(0.0, 1.0).toVar();

        // ── The dust the ground wind drives over the crust: pale streamers, lit as the floor
        // under them is (in a shadow's band they are that band's colour) ──
        const D = FLOOR_DUST;
        const downwind = dot(P.xz, u.gustAlong).add(u.gustDrift).toVar();
        const crosswind = dot(P.xz, u.gustAcross).toVar();
        const dustAt = (cross, down) => {
            const sheet = texture(t.noise, vec2(cross.div(D.broad), down.div(D.long))).g;
            const strand = texture(t.noise, vec2(
                cross.div(D.fine).add(0.37),
                down.add(u.gustDrift.mul(D.lead - 1)).div(D.short),
            )).b;
            // A streamer is a sheet of dust with strands in it: no sheet, no strands (strands
            // everywhere were a hatching over the whole floor: scan lines, not dust).
            const body = smoothstep(0.5, 0.66, sheet.add(u.wind.mul(0.07)));
            return body.mul(strand.mul(0.9).add(0.3)).clamp(0.0, 1.0);
        };
        const streamer = dustAt(crosswind, downwind).toVar();
        // Its sunward side is the brighter (the same field read a step toward the suns: a low
        // gain round a mid value, so a streamer has a lit flank and a lee, not a flat patch).
        const sunward = normalize(u.centre.xz.add(vec2(1e-4, 0.0))).mul(D.step);
        const lee = dustAt(crosswind.add(dot(sunward, u.gustAcross)), downwind.add(dot(sunward, u.gustAlong)));
        const flank = streamer.sub(lee).mul(2.4).add(0.5).clamp(0.0, 1.0);
        const dusty = streamer.mul(u.wind.min(1.0)).mul(D.cover).mul(smoothstep(D.near[0], D.near[1], dist)).toVar();
        const dustLit = flatLit.mul(D.glow).add(ambient).mul(flank.sub(0.5).mul(D.relief).add(1.0))
            .mul(vec3(0.99, 0.975, 0.95))
            .toVar();

        // ── The film of water a shower leaves: it lies in the broad lows first and the ridges
        // stand out of it; it mirrors the sky, the suns and the towers, more the lower the eye
        // looks along it (near the lens the crust and its coloured shadows show through) ──
        const W = FLOOR_WATER;
        If(u.wet.greaterThan(0.002), () => {
            // (Far out the plain is wet as one: a dry patch there is a flat rectangle of some
            // shadow's colour set in the mirror.)
            const level = u.wet.mul(smoothstep(W.far[0], W.far[1], dist).mul(0.7).add(1.4))
                .sub(texture(t.noise, P.xz.div(W.lows)).r)
                .toVar();
            const pool = smoothstep(0.0, 0.1, level).mul(float(1.0).sub(ridgeTop.mul(0.9))).toVar();
            // The damp runs a little ahead of the water (dark, not yet a mirror).
            const damp = smoothstep(-W.shore, 0.0, level);
            colour.mulAssign(float(1.0).sub(damp.mul(1 - W.dark)));
            // Ripples: two reads of the grain crossing one another, gone to their mean far off (the
            // mirror is glass at the horizon and broken near the lens).
            const wave = P.xz.div(W.wave).toVar();
            const ripA = texture(t.noise, wave.add(u.rippleDrift)).b;
            const ripB = texture(t.noise, wave.mul(1.7).sub(u.rippleDrift.mul(1.3))).b;
            const Nw = normalize(vec3(ripA.sub(0.5).mul(W.ripple), 1.0, ripB.sub(0.5).mul(W.ripple))).toVar();
            const bounce = reflect(view, Nw).toVar();
            const R = normalize(vec3(bounce.x, max(bounce.y, 0.004), bounce.z)).toVar();
            // What stands in the mirror: the dome and the suns, or a tower's dusk where the
            // mirrored sight line meets one (the same cylinders that cast the shadows).
            const open = float(1.0).toVar();
            Loop({
                start: int(0), end: u.solidCount, type: 'int', condition: '<', name: 'mir',
            }, ({ mir }) => {
                const ra = u.casters.element(mir.mul(2)).toVar();
                const rb = u.casters.element(mir.mul(2).add(1)).toVar();
                open.assign(min(open, sbCylinderVis(P, R, ra, rb.x, float(0.004))));
            });
            const dome = tier.mirror === 'lean' ? leanSky(u, R) : skyColor(u, R, { discs: true });
            const seen = mix(mix(u.horizon, u.zenith, 0.4).mul(W.tower), dome, open);
            // Fresnel on water: little looking down on it, nearly all at a grazing sight line.
            const facing = max(dot(view.negate(), Nw), 0.0);
            const g = float(1.0).sub(facing).toVar();
            const g2 = g.mul(g);
            const fresnel = g2.mul(g2).mul(g).mul(0.98).add(0.02);
            colour.assign(mix(colour, mix(colour, seen, fresnel), pool));
            dusty.mulAssign(float(1.0).sub(pool.mul(0.9)));
        });
        colour.assign(mix(colour, dustLit, dusty));

        // ── Pulses of light in the crust: a struck tile lights whole, its ridges brightest ──
        const K = FLOOR_PULSE;
        const tile = P.xz.add(crust.centre.mul(crustSeen).mul(C.cell)).toVar();
        const pulse = crustPulses(u, tile);
        const takenFace = pulse.coverFill.clamp(0.0, 1.0).mul(1 - K.keep);
        const takenRidge = pulse.coverEdge.clamp(0.0, 1.0).mul(ridgeTop).mul(K.ridge);
        colour.assign(colour.mul(float(1.0).sub(max(takenFace, takenRidge)))
            .add(pulse.fill.mul(K.fill))
            .add(pulse.edge.mul(ridgeTop.mul(K.edge))));
        return vec4(haze(u, mist(u, colour, P, vis), P), 1.0);
    })();
    material.fog = false;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Sunbraid land';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {
        mesh,
        material,
        geometry,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
