/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE FOLD — chapter 7's other dimension (2026-10-26).
 *
 * Olov: "I want it to feel like we are in another dimension within this chapter. Visually
 * stunning, trippy and an amazing feeling travelling through this chapter." Past the horizon the
 * black hole is a door, not a tunnel: the warp's streaks carry the eye through the fall, and then
 * it comes out into a space with rules of its own.
 *
 * WHAT IT IS. A corridor you fly down, made of light:
 *  - TESSERACTS: four-dimensional cubes, drawn the way they are usually drawn (a cube within a
 *    cube, corners joined), turning inside out: the inner cube grows through the outer while the
 *    outer shrinks, as a hypercube does when it turns through the fourth dimension. They tumble in
 *    this one too, and their faces are tinted glass.
 *  - THE KALEIDOSCOPE: the space round the axis is folded into `sectors` mirrored wedges, so every
 *    tesseract is met in a ring of mirror images, and the whole corridor twists slowly with depth.
 *  - GATES: beaded rings of light round the axis between the rings of tesseracts.
 *  - WALLS of dark glass panes far beyond, a nebula in the depths, and soft beams round the light
 *    at the far end (the light the space streams out of, which becomes the city's sun).
 * The axis is kept clear: the path, its orbs and the light at the end stay in the open.
 *
 * HOW. Everything is a function of the view ray in the hole's frame (the window shader's ray; the
 * eye sits on the corridor's axis). The tesseracts are MARCHED (glow only: everything is light,
 * nothing is hit or occludes; each step adds the light of whatever is near, its falloff an angle,
 * so a crystal passing close stays crisp). The eye is on the axis, so a ray's distance from it
 * grows as t sin(theta): only the stretch through the tesseracts' shell is marched, and a ray
 * toward the light is not marched at all. The gates and the walls are axisymmetric and are met
 * ANALYTICALLY (no march). Travel moves the eye down the axis by the warp drive's phase.
 *
 * Inline TSL (call inside a Fn): the walls take a screen derivative (fwidth), so it must stay in
 * uniform control flow (a uniform `If`, never a per-pixel one).
 */
import {
    Break,
    If,
    Loop,
    abs,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fwidth,
    int,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    round,
    select,
    sin,
    smoothstep,
    vec2,
    vec3,
} from 'three/tsl';
import { hash21 } from './shared/odyssey-tsl-noise.js';
import { latticeNoise3 } from './shared/odyssey-lattice-noise.js';

const TAU = Math.PI * 2;
const SQRT3 = Math.sqrt(3);

export const CH7_FOLD = Object.freeze({
    /** March steps per pixel (the quality tiers pass their own: CH7_QUALITY_TIERS.foldSteps). */
    steps: 32,
    /** Where the march may start (just ahead of the eye) and how far it may go. */
    start: 0.35,
    reach: 30,
    /** The tesseracts lie between these radii from the axis: only that stretch of a ray is marched. */
    shellIn: 1.45,
    shellOut: 3.9,
    /** One ring of tesseracts every `period` down the corridor, `sectors` mirrored wedges round it. */
    period: 3.4,
    sectors: 6,
    /** The tesseracts stand this far off the axis, this big (outer half-size), edges this thick. */
    ringRadius: 2.7,
    size: 0.62,
    edge: 0.018,
    /** Their turn through the fourth dimension (rad/s) and their own tumble (rad/s). */
    fourth: 0.45,
    tumble: 0.22,
    /** The tinted glass of their faces (per unit of path inside them). */
    glassGain: 0.035,
    /** The gates: radius, ring and bead thickness, and their light (met once, not summed). */
    gateRadius: 3.9,
    gate: 0.026,
    bead: 0.075,
    gateGain: 0.16,
    /** The walls: a cylinder of glass panes this far from the axis, this many panes round it; a
     * quiet backdrop (faint edges, a few panes glowing like lanterns, darker with depth). */
    wallRadius: 5.6,
    wallPanes: 22,
    wallLine: 0.07,
    wallLit: 0.12,
    wallFog: 1.6,
    /** World units travelled per unit of the warp drive's phase. */
    travel: 0.85,
    /** The corridor's twist with depth (rad per unit) and with the clock (rad/s). */
    twist: 0.07,
    spin: 0.05,
    /** The glow: falloff (per angle squared) and gain; the depth fog. */
    glowK: 60000,
    glowGain: 0.030,
    fog: 0.075,
    /** The light at the end seen again round itself: an Einstein ring of this angular radius
     * (sine) and width, and four images of the light on it turning at `turn` rad/s. */
    einstein: Object.freeze({
        radius: 0.16, ring: 0.004, ringGain: 0.2, image: 0.010, imageGain: 0.8, turn: 0.08,
    }),
    /** The nebula in the depths and the beams round the light at the end. */
    nebula: 0.045,
    beams: 0.22,
});

// A squared falloff, written as a product (pow of a negative base is NaN in WGSL).
const gauss = (x) => exp(x.mul(x).negate());

/** The soap film: hue `t` (turns) to a thin-film colour, magenta through gold, green and cyan to
 * violet; squared, the jewel tones (deeper and more saturated). */
const film = (t) => vec3(0.55).add(vec3(0.45).mul(cos(vec3(t).add(vec3(0.0, 0.27, 0.58)).mul(TAU))));
const jewel = (t) => {
    const f = film(t);
    return f.mul(f);
};

const rot2 = (v, a) => {
    const c = cos(a);
    const s = sin(a);
    return vec2(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)));
};

/** Fold an angle into one mirrored wedge of width `sector`: 0 on the wedge's middle line,
 * sector / 2 on its mirrors. */
const foldAngle = (ang, sector) => abs(ang.sub(floor(ang.div(sector)).mul(sector)).sub(sector / 2));

/** The hexagonal cell round plane point `p` (centres on the lattice e1 = (1, 0), e2 = (1/2, sqrt3/2)):
 * `gv` the point relative to its centre, `id` the centre. */
function hexCell(p) {
    const r = vec2(1, SQRT3);
    const h = r.mul(0.5);
    const modv = (x, y) => x.sub(y.mul(floor(x.div(y))));
    const a = modv(p, r).sub(h);
    const b = modv(p.sub(h), r).sub(h);
    const gv = select(dot(a, a).lessThan(dot(b, b)), a, b).toVar();
    return { gv, id: p.sub(gv) };
}

/** Distance to the edges of a box of half-size `b` with edge radius `e`. Inigo Quilez's box frame
 * (https://iquilezles.org/articles/distfunctions), MIT; see THIRD_PARTY_NOTICES.md. */
function boxFrame(p, b, e) {
    const q = abs(p).sub(b);
    const w = abs(q.add(e)).sub(e);
    const a = length(max(vec3(q.x, w.y, w.z), 0)).add(min(max(q.x, max(w.y, w.z)), 0));
    const bb = length(max(vec3(w.x, q.y, w.z), 0)).add(min(max(w.x, max(q.y, w.z)), 0));
    const c = length(max(vec3(w.x, w.y, q.z), 0)).add(min(max(w.x, max(w.y, q.z)), 0));
    return min(min(a, bb), c);
}

/** Signed distance to a solid box of half-size `b`. */
function box(p, b) {
    const q = abs(p).sub(b);
    return length(max(q, 0)).add(min(max(q.x, max(q.y, q.z)), 0));
}

/** Distance from p to the segment a-b. */
function segment(p, a, b) {
    const pa = p.sub(a);
    const ba = b.sub(a);
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1);
    return length(pa.sub(ba.mul(h)));
}

/** A smooth union (Inigo Quilez's polynomial smooth minimum, blend width k;
 * https://iquilezles.org/articles/smin), MIT; see THIRD_PARTY_NOTICES.md. */
function smin(a, b, k) {
    const h = max(float(k).sub(abs(a.sub(b))), 0).div(k);
    return min(a, b).sub(h.mul(h).mul(k * 0.25));
}

/** The edges of an octahedron of radius `s` (by its symmetry: three segments in one octant). */
function octahedronEdges(p, s) {
    const q = abs(p);
    return min(min(
        segment(q, vec3(s, 0, 0), vec3(0, s, 0)),
        segment(q, vec3(0, s, 0), vec3(0, 0, s)),
    ), segment(q, vec3(0, 0, s), vec3(s, 0, 0)));
}

/**
 * THE CRYSTALS (step 3: a room per orb, odyssey-fold-rooms.js). In the crystal's own tumbling
 * frame `c`, its distance (light gathers where it is small) and how deep inside its glass the
 * point is (tinted fill). `kind` is a uniform, so only one shape is ever evaluated.
 *  0 TESSERACT  a cube within a cube, turning inside out through the fourth dimension
 *  1 DIAMOND    an octahedron's edges round a smaller one turning inside it (Chiral Gold)
 *  2 TETROMINO  one solid glass piece, a T, L, I or S, never four cells (Serenity Warp)
 *  3 ORBS       three liquid bubbles flowing into one another, thin-skinned like soap
 *               (Fluid Dreams, Chromatic Impasto)
 *  4 SWARM      motes of light inside a wheeling ring (Murmuration)
 */
function crystal(kind, cIn, cell, seed, tm) {
    const V = CH7_FOLD;
    // ROOT-PINNED before the branches: a node shared by them is assigned where first built, so
    // built first inside one branch it reads as zero in the others.
    const c = cIn.toVar();
    const d = float(1e3).toVar();
    const fill = float(0).toVar();
    // A hue that varies over the crystal's own surface (the bubbles' thin film).
    const sheen = float(0).toVar();
    const w = sin(tm.mul(V.fourth).add(cell.mul(0.9))).mul(0.5).add(0.5).toVar();
    If(kind.lessThan(0.5), () => {
        const sIn = mix(float(V.size * 0.42), float(V.size), w);
        const sOut = mix(float(V.size), float(V.size * 0.42), w);
        d.assign(min(
            min(boxFrame(c, vec3(sIn), V.edge), boxFrame(c, vec3(sOut), V.edge)),
            segment(abs(c), vec3(sIn), vec3(sOut)).sub(V.edge),
        ));
        fill.assign(float(1).sub(smoothstep(-0.08, 0.02, min(box(c, vec3(sOut)), box(c, vec3(sIn))))));
    }).ElseIf(kind.lessThan(1.5), () => {
        const s1 = V.size * 1.3;
        const inner = rot2(c.xz, tm.mul(V.fourth).add(cell));
        const ci = vec3(inner.x, c.y, inner.y);
        d.assign(min(octahedronEdges(c, s1), octahedronEdges(ci, mix(float(V.size * 0.45), float(V.size * 0.8), w)))
            .sub(V.edge));
        const q = abs(c);
        fill.assign(float(1).sub(smoothstep(-0.08, 0.02, q.x.add(q.y).add(q.z).sub(s1).mul(0.577))));
    }).ElseIf(kind.lessThan(2.5), () => {
        // Four cells of `u` each, one solid: a bar of three with one more under its middle (T)
        // or its end (L), a bar of four (I), or two bars of two side by side, offset (S).
        const u = 0.22;
        const bar3 = box(c.sub(vec3(0, u, 0)), vec3(3 * u, u, u));
        const tee = min(bar3, box(c.sub(vec3(0, -u, 0)), vec3(u, u, u)));
        const ell = min(bar3, box(c.sub(vec3(2 * u, -u, 0)), vec3(u, u, u)));
        const eye = box(c, vec3(4 * u, u, u));
        const ess = min(box(c.sub(vec3(u, u, 0)), vec3(2 * u, u, u)), box(c.sub(vec3(-u, -u, 0)), vec3(2 * u, u, u)));
        const solid = select(seed.lessThan(0.25), tee, select(seed.lessThan(0.5), ell, select(seed.lessThan(0.75), eye, ess)));
        // Light from its outer skin only: inside, the two blocks' shared face would glow and
        // show the cells (a piece is one solid shape).
        d.assign(select(solid.greaterThan(0), solid.sub(V.edge * 0.5), float(0.12)));
        fill.assign(float(1).sub(smoothstep(-0.06, 0.01, solid)).mul(1.6));
    }).ElseIf(kind.lessThan(3.5), () => {
        const ph = tm.mul(0.7).add(cell.mul(2.3));
        const R = 0.3;
        const s1 = length(c.sub(vec3(cos(ph).mul(R), sin(ph).mul(R), 0))).sub(0.3);
        const s2 = length(c.sub(vec3(cos(ph.add(2.1)).mul(R), 0, sin(ph.add(2.1)).mul(R)))).sub(0.27);
        const s3 = length(c.sub(vec3(0, cos(ph.add(4.2)).mul(R), sin(ph.add(4.2)).mul(R)))).sub(0.24);
        const solid = smin(smin(s1, s2, 0.22), s3, 0.22);
        // A thin skin: the light gathers where the eye grazes it (a bubble's bright rim), its
        // colour swirling over the surface like a soap film's.
        d.assign(abs(solid).sub(0.004));
        fill.assign(float(1).sub(smoothstep(-0.06, 0.01, solid)).mul(0.45));
        sheen.assign(c.y.mul(1.4).add(length(c).mul(0.9)).add(sin(c.x.mul(7.0).add(ph)).mul(0.12)));
    })
        .Else(() => {
        // A ring wheeling through itself, and the motes of light that make it.
            const wheel = rot2(c.yz, tm.mul(0.5).add(cell));
            const cw = vec3(c.x, wheel.x, wheel.y);
            const ring = length(vec2(length(cw.xz).sub(0.6), cw.y)).sub(0.3);
            const spacing = 0.27;
            // (each mote nudged off its lattice point, so the swarm never lines up into rows)
            const site = round(c.div(spacing));
            const nudge = vec3(
                hash21(site.xy.add(site.z.mul(7.1))),
                hash21(site.yz.add(site.x.mul(3.7))),
                hash21(site.zx.add(site.y.mul(5.3))),
            ).sub(0.5).mul(spacing * 0.55);
            const m = c.sub(site.mul(spacing)).sub(nudge);
            d.assign(max(length(m).sub(0.045), ring));
        });
    return { d, fill, sheen };
}

/**
 * THE FOLD's colour for one view ray (linear; call inside a Fn, in uniform control flow).
 * @param {object} o
 * @param {*} o.ray the view ray in the hole's frame (+Z toward the eye, so forward is -Z)
 * @param {*} o.time seconds
 * @param {*} o.phase the warp drive's travelled distance
 * @param {*} [o.motion] 0 under reduced motion (nothing turns or drifts by the clock)
 * @param {number} [o.steps] march steps
 * @param {object} [o.room] the room's nodes (odyssey-fold-rooms.js resolveFoldRoom, as uniforms):
 *   shapeA, shapeB, morph, hue, spread, tint (vec3), tintMix, nebula, nebulaHue
 * @returns {*} vec3 node
 */
export function foldSpaceColour({
    ray, time, phase, motion = float(1), steps = CH7_FOLD.steps, room = null,
}) {
    const R = {
        shapeA: room?.shapeA ?? float(0),
        shapeB: room?.shapeB ?? float(0),
        morph: room?.morph ?? float(0),
        hue: room?.hue ?? float(0),
        spread: room?.spread ?? float(0.11),
        tint: room?.tint ?? vec3(1),
        tintMix: room?.tintMix ?? float(0),
        nebula: room?.nebula ?? float(1),
        nebulaHue: room?.nebulaHue ?? float(0.7),
        crackle: room?.crackle ?? float(0),
        grid: room?.grid ?? float(0),
    };
    // The room's film: the soap film's hue for it, pulled toward the room's own colour.
    const roomFilm = (h) => mix(film(h), R.tint, R.tintMix);
    const V = CH7_FOLD;
    const rd = normalize(vec3(ray.x, ray.y, ray.z.negate())).toVar('fvRd');
    const tm = time.mul(motion).toVar('fvTime');
    const zEye = phase.mul(V.travel).toVar('fvEye');
    const sinT = max(length(rd.xy), 1e-4).toVar('fvSinT');
    const phiV = atan(rd.y, rd.x).toVar('fvPhi');
    const sector = TAU / V.sectors;

    // ── THE TESSERACTS, marched through their shell ──
    const acc = vec3(0).toVar('fvAcc');
    // Each ray starts a fixed random fraction of a step in (by its direction, so the pattern
    // holds still on the scene, not on the screen): regular steps through a glowing surface
    // print bands; staggered, they average out.
    const jitter = hash21(vec2(phiV.mul(731.7), sinT.mul(1931.3))).mul(0.05);
    const t = max(float(V.start), float(V.shellIn).div(sinT)).add(jitter).toVar('fvT');
    const tEnd = min(float(V.reach), float(V.shellOut).div(sinT)).toVar('fvTEnd');
    Loop({
        start: int(0), end: int(steps), type: 'int', condition: '<',
    }, () => {
        If(t.greaterThan(tEnd), () => {
            Break();
        });
        const p = vec3(rd.x.mul(t), rd.y.mul(t), rd.z.mul(t).add(zEye)).toVar('fvP');
        // The corridor twists with depth and with the clock; the kaleidoscope folds it.
        const r = length(p.xy).toVar('fvR');
        const a = foldAngle(atan(p.y, p.x).add(p.z.mul(V.twist)).add(tm.mul(V.spin)), sector);
        const cell = floor(p.z.div(V.period)).toVar('fvCell');
        const q = vec3(r.mul(cos(a)), r.mul(sin(a)), p.z.sub(cell.add(0.5).mul(V.period)));
        // Far from its tesseract, the bounding sphere stands in (most steps): the frames are
        // built only near it.
        const c0 = q.sub(vec3(V.ringRadius, 0, 0)).toVar('fvC0');
        const d = length(c0).sub(V.size * 1.75).toVar('fvD');
        const inGlass = float(0).toVar('fvInGlass');
        const dB = d.toVar('fvDB');
        const sheen = float(0).toVar('fvSheen');
        If(d.lessThan(0.3), () => {
            const tumble = tm.mul(V.tumble).add(cell.mul(1.7));
            const cxy = rot2(c0.xy, tumble);
            const c1 = vec3(cxy.x, cxy.y, c0.z);
            const cyz = rot2(c1.yz, tumble.mul(0.7).add(0.6));
            const c = vec3(c1.x, cyz.x, cyz.y).toVar('fvC');
            const seed = hash21(vec2(cell, 7.3)).toVar('fvSeed');
            // The room's crystal; while the space morphs into the next room, it shrinks away
            // inside the next one's, which grows out of it (their light crossfades: blending
            // the distances themselves dimmed both).
            const sizeA = float(1).sub(R.morph.mul(0.6));
            const shapeA = crystal(R.shapeA, c.div(sizeA), cell, seed, tm);
            d.assign(shapeA.d.mul(sizeA));
            dB.assign(d);
            inGlass.assign(shapeA.fill);
            sheen.assign(shapeA.sheen);
            If(R.morph.greaterThan(0.001), () => {
                const sizeB = R.morph.mul(0.6).add(0.4);
                const shapeB = crystal(R.shapeB, c.div(sizeB), cell, seed, tm);
                dB.assign(shapeB.d.mul(sizeB));
                inGlass.assign(mix(shapeA.fill, shapeB.fill, R.morph));
                sheen.assign(mix(shapeA.sheen, shapeB.sheen, R.morph));
            });
        });
        // Light: a hot core and a soft halo whose width is an ANGLE (d / t).
        const glowAt = (dist) => {
            const da = dist.div(t);
            return float(1).div(float(1).add(da.mul(da).mul(V.glowK)));
        };
        const glow = mix(glowAt(d), glowAt(dB), R.morph).toVar('fvGlow');
        const fog = exp(t.mul(-V.fog));
        const hue = R.hue.add(cell.mul(R.spread)).add(tm.mul(0.015)).add(sheen);
        acc.addAssign(mix(roomFilm(hue), vec3(1.0, 0.97, 0.95), glow.mul(glow).mul(0.5))
            .mul(glow).mul(fog).mul(V.glowGain));
        const stepLen = max(min(d, dB).mul(0.6), float(0.05)).toVar('fvStep');
        const glassCol = mix(jewel(hue.add(0.2)), R.tint.mul(R.tint), R.tintMix);
        acc.addAssign(glassCol.mul(inGlass).mul(fog).mul(stepLen).mul(V.glassGain));
        t.addAssign(stepLen);
    });

    // ── THE GATES, met analytically ──
    // Beaded rings round the axis, half a period off the tesseracts' rings. The ray crosses the
    // gates' radius once (at tG); in the (radius, depth) half-plane a ring is a point and the ray a
    // unit line, so the ray passes it at |dz| sin(theta) exactly. The beads sit between the
    // tesseracts (on the wedge's mirrors).
    const tG = float(V.gateRadius).div(sinT).toVar('fvTG');
    const zG = rd.z.mul(tG).add(zEye).toVar('fvZG');
    const gIndex = round(zG.div(V.period));
    const angG = phiV.add(zG.mul(V.twist)).add(tm.mul(V.spin)).toVar('fvAngG');
    // (In the Voltage Storm's room the rings break into arcs of light crawling round them.)
    const jq = vec3(cos(angG).mul(5.0), sin(angG).mul(5.0), tm.mul(1.2).add(gIndex.mul(3.1)));
    const jag = latticeNoise3(jq).sub(0.5)
        .add(latticeNoise3(jq.mul(3.3).add(vec3(7.1, 2.9, 4.4))).sub(0.5).mul(0.45))
        .mul(R.crackle.mul(0.5));
    const dz = abs(zG.sub(gIndex.mul(V.period)).sub(jag));
    const aG = foldAngle(angG, sector);
    const ringA = max(dz.mul(sinT).sub(V.gate), 0).div(tG);
    const beadA = max(length(vec2(float(sector / 2).sub(aG).mul(V.gateRadius), dz.mul(sinT))).sub(V.bead), 0).div(tG);
    const gateGlow = float(1).div(float(1).add(ringA.mul(ringA).mul(V.glowK)))
        .add(float(1).div(float(1).add(beadA.mul(beadA).mul(V.glowK))).mul(1.4));
    const gateHue = R.hue.add(gIndex.mul(R.spread)).add(tm.mul(0.015)).add(0.45);
    const gates = mix(roomFilm(gateHue), vec3(1.0, 0.97, 0.95), gateGlow.mul(0.3))
        .mul(gateGlow).mul(exp(tG.mul(-V.fog * 1.6))).mul(R.crackle.mul(1.5).add(1).mul(V.gateGain))
        // (Clear of the centre, where the far rings would crowd into a target.)
        .mul(smoothstep(float(0.03), float(0.14), sinT));

    // ── THE WALLS, met analytically ──
    // One hexagonal grid on a cylinder round the axis, twisting with the corridor. `wallPanes`
    // panes round the turn, so atan's cut moves the grid by a whole lattice step (wallPanes e1):
    // panes are named by their place round the turn reduced by it, the same on either side.
    const tW = float(V.wallRadius).div(sinT).toVar('fvTW');
    const zW = rd.z.mul(tW).add(zEye).toVar('fvZW');
    // (On the way out the walls stop twisting: their lines straighten toward the city's.)
    const angW = phiV.add(zW.mul(V.twist).add(tm.mul(V.spin * 0.5)).mul(float(1).sub(R.grid))).toVar('fvAngW');
    const perZ = V.wallPanes / (TAU * V.wallRadius);
    const { gv: wgv, id: wid } = hexCell(vec2(angW.mul(V.wallPanes / TAU), zW.mul(perZ)));
    const wb = round(wid.y.div(SQRT3 / 2));
    const wa = round(wid.x.sub(wb.mul(0.5)));
    const wh = hash21(vec2(wa.sub(floor(wa.div(V.wallPanes)).mul(V.wallPanes)), wb).add(23.1));
    const wax = abs(wgv.x);
    const hexEdge = float(0.5).sub(max(wax, wax.mul(0.5).add(abs(wgv.y).mul(SQRT3 / 2))));
    // THE WAY OUT (step 5): the hexagons straighten into squares, the city's neon grid.
    const sq = vec2(angW.mul(V.wallPanes / TAU), zW.mul(perZ));
    const su = abs(sq.x.sub(floor(sq.x)).sub(0.5));
    const sv = abs(sq.y.sub(floor(sq.y)).sub(0.5));
    const wEdge = mix(hexEdge, float(0.5).sub(max(su, sv)), R.grid);
    // The pixel's footprint from the depth (continuous across atan's cut, unlike the angle); edges
    // fade to their mean where panes shrink under a few pixels.
    const wfw = fwidth(zW).mul(perZ).toVar('fvWallFw');
    const ww = max(float(0.02), wfw.mul(0.8));
    const wLine = mix(gauss(wEdge.div(ww)).mul(float(0.02).div(ww)), float(0.1), smoothstep(0.15, 0.45, wfw));
    const wRho = length(wgv).mul(2.0);
    const wLit = smoothstep(0.86, 0.98, wh).mul(sin(tm.mul(0.25).add(wh.mul(TAU))).mul(0.3).add(0.7))
        .mul(float(1).sub(wRho.mul(wRho).mul(0.7)));
    const wHue = wh.mul(0.4).add(zW.mul(0.02)).add(tm.mul(0.01)).add(0.55);
    // Neon on the way out: magenta round the turn, cyan along the way.
    const neon = mix(vec3(1.0, 0.22, 0.78), vec3(0.25, 0.85, 1.0), smoothstep(-0.05, 0.05, su.sub(sv)));
    const wallLight = mix(mix(vec3(0.5, 0.55, 1.0), film(wHue), 0.5), neon, R.grid)
        .mul(wLine.mul(mix(float(V.wallLine), float(V.wallLine * 5), R.grid)));
    const wall = wallLight
        .add(jewel(wHue).mul(wLit).mul(float(1).sub(R.grid)).mul(V.wallLit))
        .add(vec3(0.008, 0.005, 0.018))
        .mul(exp(tW.mul(R.grid.mul(-0.5).add(1).mul(-V.fog * V.wallFog))));

    // ── THE DEPTHS AND THE LIGHT AT THE END ──
    // A faint iridescent nebula streaming out of the far end (on log depth, so it crosses the
    // frame evenly), and soft beams turning slowly round the light (the window adds its core).
    const sV = log(sinT.div(max(rd.z, 1e-3)));
    const nq = vec3(cos(phiV).mul(1.6), sin(phiV).mul(1.6), sV.mul(0.9).sub(zEye.mul(0.05)).add(tm.mul(0.02)));
    const neb = latticeNoise3(nq).mul(0.65).add(latticeNoise3(nq.mul(2.1).add(vec3(5.3, 1.7, 8.2))).mul(0.35));
    const nebula = jewel(neb.mul(0.8).add(sV.mul(0.04)).add(tm.mul(0.008)).add(R.nebulaHue))
        .mul(smoothstep(0.42, 0.78, neb)).mul(R.nebula.mul(V.nebula));
    const beamN = latticeNoise3(vec3(cos(phiV).mul(2.4), sin(phiV).mul(2.4), tm.mul(0.04)));
    const beams = vec3(1.0, 0.86, 0.66).mul(smoothstep(0.5, 0.95, beamN).mul(exp(sinT.mul(-7.0))).mul(V.beams));

    // ── THE LIGHT SEEN MANY TIMES (step 4) ──
    // Bent round the hole, the light at the end is seen again on a thin ring round it (an
    // Einstein ring), four times over, the images turning slowly round the ring.
    const E = V.einstein;
    const ringOff = sinT.sub(E.radius).div(E.ring);
    const einsteinRing = exp(ringOff.mul(ringOff).negate()).mul(E.ringGain);
    const quarter = Math.PI / 2;
    const phiE = phiV.sub(tm.mul(E.turn));
    const phiF = phiE.sub(floor(phiE.div(quarter)).mul(quarter)).sub(quarter / 2);
    const toImage = length(vec2(sinT.mul(cos(phiF)).sub(E.radius), sinT.mul(sin(phiF)))).div(E.image);
    const images = exp(toImage.mul(toImage).negate()).mul(E.imageGain);
    const lensed = vec3(1.0, 0.88, 0.68).mul(einsteinRing.add(images));

    return acc.add(gates).add(wall).add(nebula).add(beams)
        .add(lensed);
}

export default foldSpaceColour;
