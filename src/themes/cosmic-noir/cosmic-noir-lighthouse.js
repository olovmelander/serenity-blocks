/**
 * Cosmic Noir — the lighthouse and its rock.
 *
 * One distance field, walked along the view ray inside its bounds only (an upright cylinder round
 * the tower and a ball round the rock): the rock is a skerry of bedded stone, shaped on the CPU
 * (cosmic-noir-rock.js) and read here from a small volume; the tower stands on a plinth of dressed
 * stone, a flared, banded shaft with a door and one lit window, then a corbel, the gallery and its
 * railing, the lantern room (a low wall, the ring of shutter slats that turn and open, the lens
 * blazing inside), the roof's dome, its ball and its rod.
 *
 * It is lit as a silhouette is: the lamp lights what looks at it from outside the lantern's own
 * shadow (the railing, the eave's underside, the slats' inner faces across the room), the galaxy
 * rims the side that faces it, an echo's shell flashes down the tower as it passes, and the rest
 * is a shape against the lit smoke. Edges are anti-aliased by how near the ray came, in pixels.
 */

import {
    Break,
    Fn,
    If,
    Loop,
    abs,
    atan,
    clamp,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    pow,
    reflect,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CAGE, PULSAR, SEA, TAU, TOWER, cnBall, cnBeam, cnCage, cnUpright,
} from './cosmic-noir-tsl.js';
import { ROCK_BEDS, ROCK_BOX } from './cosmic-noir-rock.js';
import { GALAXY_DIR } from './cosmic-noir-sky.js';

/** Heights from the lamp (the field's own frame: the lamp at the origin, y up). */
const Y_FOOT = SEA.level + TOWER.footLift - PULSAR.height;
const Y_SEA = SEA.level - PULSAR.height;
const Y_NECK = -TOWER.neckDrop;
const Y_FLOOR = -TOWER.galleryDrop;
const Y_EAVE = CAGE.halfHeight + 0.05;
const Y_BALL = Y_EAVE + TOWER.domeRise + 0.1;
const RAIL_R = TOWER.galleryRadius - 0.06;
const SLAT_THICK = 0.035;
/** The lit window: its bearing round the tower (toward the eye and a little right) and its height. */
const WINDOW = Object.freeze({
    bearing: 1.22, y: Y_NECK - 2.1, half: 0.3, wide: 0.17,
});

/** The galaxy's light on the lighthouse and the rock: their key light, low and from behind. */
const GALAXY_KEY = 0.2;
/** What the lantern and the gallery let fall on the rock under them (a share of the lamp's own light). */
const FALL_LIGHT = 0.42;
/** How white the water running off the rock is. */
const ROCK_FOAM = 2.4;
/** The door at the tower's foot: its bearing (toward the eye), its sill over the foot, its height and half its width. */
const DOOR = Object.freeze({
    bearing: 1.78, sill: 0.46, height: 0.95, half: 0.2,
});
/** The rock's normal is read no finer than this (about a cell of its volume), then roughened by this much. */
const ROCK_SOFT = 0.06;
const ROCK_BUMP = 0.55;

/** What the field says a point belongs to. */
const ROCK = 0;
const SHAFT = 1;
const IRON = 2;
const WALL = 3;
const LENS = 4;

/** The plinth the tower stands on: dressed stone, two courses. */
const PLINTH = Object.freeze({ radius: TOWER.footRadius + 0.3, height: 0.5 });

/** The bounds the field is walked inside (the same frame). */
export const TOWER_BOUNDS = Object.freeze({
    radius: TOWER.galleryRadius + 0.2,
    y0: Y_FOOT - 0.6,
    y1: TOWER.rodTop + 0.1,
    rock: Object.freeze([0.9, Y_SEA + 0.2, 0.2]),
    rockRadius: 5.6,
});

/** The rock's volume: its middle, its size, and how short the walk steps on what it reads (it is carved: not a true distance). */
const BOX_MID = ROCK_BOX.min.map((lo, k) => (lo + ROCK_BOX.max[k]) * 0.5);
const BOX_SIZE = ROCK_BOX.min.map((lo, k) => ROCK_BOX.max[k] - lo);
const ROCK_RELAX = 0.72;

/**
 * The rock's distance at a point `q` in the lamp's frame: its baked volume inside its box, and
 * the way to the box outside it. Inline (it reads a texture).
 */
export function cnRockDist(u, q) {
    const local = q.sub(vec3(BOX_MID[0], BOX_MID[1], BOX_MID[2]));
    const half = vec3(BOX_SIZE[0] * 0.5, BOX_SIZE[1] * 0.5, BOX_SIZE[2] * 0.5);
    const outside = length(max(abs(local).sub(half), 0.0));
    const at = clamp(local.div(vec3(BOX_SIZE[0], BOX_SIZE[1], BOX_SIZE[2])).add(0.5), 0.004, 0.996);
    return u.rock(at).mul(ROCK_RELAX).add(outside);
}

/**
 * The tower's field: vec2(distance, what it is) at a point `q` in the lamp's frame. `turn` = the
 * slats' turn (radians), `fill` = the share of a pitch a slat covers. Pure (no uniforms): one
 * function in the shader, called by the walk and by the normal.
 */
export const cnTowerField = /* @__PURE__ */ Fn(([q, turn, fill]) => {
    const rho = length(q.xz).toVar();
    const { y } = q;
    const bearing = atan(q.z, q.x).toVar();
    const dist = float(1e3).toVar();
    const what = float(IRON).toVar();
    const take = (d, id) => {
        If(d.lessThan(dist), () => {
            dist.assign(d);
            what.assign(id);
        });
    };

    // ── The plinth: two courses of dressed stone under the tower ──
    const course1 = max(rho.sub(PLINTH.radius), abs(y.sub(Y_FOOT - 0.05)).sub(PLINTH.height * 0.5));
    const course2 = max(
        rho.sub(PLINTH.radius - 0.16),
        abs(y.sub(Y_FOOT + PLINTH.height * 0.5 + 0.05)).sub(PLINTH.height * 0.3),
    );
    take(min(course1, course2), WALL);

    // ── The shaft: flared at its foot, and the corbel that carries the gallery ──
    const up = clamp(y.sub(Y_FOOT).div(Y_NECK - Y_FOOT), 0.0, 1.0);
    const down = float(1.0).sub(up);
    const shaftR = float(TOWER.neckRadius).add(down.mul(down.mul(0.45).add(0.55)).mul(TOWER.footRadius - TOWER.neckRadius));
    take(max(rho.sub(shaftR).mul(0.96), max(y.sub(Y_NECK), float(Y_FOOT - 0.6).sub(y))), SHAFT);
    const rise = clamp(y.sub(Y_NECK).div(Y_FLOOR - 0.12 - Y_NECK), 0.0, 1.0);
    const corbelR = float(TOWER.neckRadius).add(rise.mul(rise).mul(TOWER.galleryRadius - 0.14 - TOWER.neckRadius));
    take(max(rho.sub(corbelR).mul(0.62), max(y.sub(Y_FLOOR - 0.1), float(Y_NECK).sub(y))), IRON);

    // ── The gallery: its floor, the railing's posts and two rails ──
    take(max(rho.sub(TOWER.galleryRadius), abs(y.sub(Y_FLOOR - 0.06)).sub(0.06)), IRON);
    const railTop = Y_FLOOR + TOWER.railHeight;
    take(length(vec2(rho.sub(RAIL_R), y.sub(railTop))).sub(0.034), IRON);
    take(length(vec2(rho.sub(RAIL_R), y.sub(Y_FLOOR + TOWER.railHeight * 0.5))).sub(0.02), IRON);
    const postArc = fract(bearing.mul(TOWER.railPosts / TAU)).sub(0.5).mul(rho.mul(TAU / TOWER.railPosts));
    take(max(
        length(vec2(postArc, rho.sub(RAIL_R))).sub(0.026),
        abs(y.sub(Y_FLOOR + TOWER.railHeight * 0.5)).sub(TOWER.railHeight * 0.5),
    ), IRON);

    // ── The lantern room: a low wall, the slats, a ring at their head and foot ──
    take(max(rho.sub(CAGE.radius + 0.05), max(y.add(CAGE.halfHeight), float(Y_FLOOR).sub(y))), WALL);
    const across = fract(bearing.add(turn).mul(CAGE.slats / TAU).sub(fill.mul(0.5)).add(0.5)).sub(0.5);
    const slatArc = abs(across).sub(fill.mul(0.5)).mul(rho.mul(TAU / CAGE.slats));
    take(max(max(slatArc, abs(rho.sub(CAGE.radius)).sub(SLAT_THICK)), abs(y).sub(CAGE.halfHeight)), IRON);
    take(max(abs(rho.sub(CAGE.radius)).sub(0.065), abs(abs(y).sub(CAGE.halfHeight)).sub(0.07)), IRON);

    // ── The roof: an eave, the dome, the ball and the rod ──
    take(max(rho.sub(TOWER.eaveRadius), abs(y.sub(Y_EAVE)).sub(0.05)), IRON);
    const domeR = TOWER.eaveRadius - 0.1;
    const e0 = length(vec2(rho.div(domeR), y.sub(Y_EAVE).div(TOWER.domeRise)));
    const e1 = length(vec2(rho.div(domeR * domeR), y.sub(Y_EAVE).div(TOWER.domeRise * TOWER.domeRise)));
    take(max(e0.mul(e0.sub(1.0)).div(max(e1, 1e-4)), float(Y_EAVE).sub(y)), IRON);
    take(length(vec2(rho, y.sub(Y_BALL))).sub(0.17), IRON);
    take(length(vec2(rho, y.sub(clamp(y, Y_BALL, TOWER.rodTop)))).sub(0.024), IRON);

    // ── The lens, blazing ──
    take(length(q.div(vec3(0.4, 0.62, 0.4))).sub(1.0).mul(0.4), LENS);

    return vec2(dist, what);
}).setLayout({
    name: 'cn_towerField',
    type: 'vec2',
    inputs: [{ name: 'q', type: 'vec3' }, { name: 'turn', type: 'float' }, { name: 'fill', type: 'float' }],
});

/**
 * Walk the view ray to the lighthouse. Call inside a Fn.
 * @returns {{ t: object, cover: object, light: object }}  vars: the distance to it (−1: none), how
 *   much of the pixel it covers, and its light
 */
export function cnLighthouse(u, o, ray, { steps = 64, detail = true } = {}) {
    const hitT = float(-1.0).toVar();
    const cover = float(0.0).toVar();
    const light = float(0.0).toVar();

    const rel = o.sub(u.pulsar).toVar();
    const B = TOWER_BOUNDS;
    const body = cnUpright(rel, ray, float(B.radius), float(B.y0), float(B.y1)).toVar();
    const lump = cnBall(rel.sub(vec3(B.rock[0], B.rock[1], B.rock[2])), ray, float(B.rockRadius)).toVar();
    const tFrom = min(
        body.z.greaterThan(0.5).select(body.x, 1e6),
        lump.z.greaterThan(0.5).select(lump.x, 1e6),
    ).toVar();
    const tTo = max(
        body.z.greaterThan(0.5).select(body.y, -1.0),
        lump.z.greaterThan(0.5).select(lump.y, -1.0),
    ).toVar();

    If(tTo.greaterThan(max(tFrom, 0.0)), () => {
        const t = max(tFrom, 0.0).toVar();
        const found = float(0.0).toVar();
        // The nearest the ray came, in pixels, and where: the soft edge of a miss.
        const nearest = float(1e3).toVar();
        const tNearest = t.toVar();
        Loop(steps, () => {
            const at = rel.add(ray.mul(t)).toVar();
            const f = min(cnTowerField(at, u.cageTurn, u.cageFill).x, cnRockDist(u, at)).toVar();
            const px = f.div(t.mul(u.pixelAngle));
            If(px.lessThan(nearest), () => {
                nearest.assign(px);
                tNearest.assign(t);
            });
            If(f.lessThan(t.mul(u.pixelAngle).mul(0.5)), () => {
                found.assign(1.0);
                Break();
            });
            t.addAssign(f.mul(0.94));
            If(t.greaterThan(tTo), () => {
                Break();
            });
        });
        const tAt = found.greaterThan(0.5).select(t, tNearest).toVar();
        cover.assign(found.greaterThan(0.5).select(1.0, clamp(float(1.3).sub(nearest), 0.0, 1.0)));

        If(cover.greaterThan(0.02), () => {
            hitT.assign(tAt);
            const q = rel.add(ray.mul(tAt)).toVar();
            const here = cnTowerField(q, u.cageTurn, u.cageFill).toVar();
            const isRock = cnRockDist(u, q).lessThan(here.x).toVar();
            const what = isRock.select(float(ROCK), here.y).toVar();
            // The normal, from four reads round the point: of the rock's volume (no finer than
            // its cells: a mirror shows a volume's every cell) or of the tower's field.
            const k1 = vec3(1.0, -1.0, -1.0);
            const k2 = vec3(-1.0, -1.0, 1.0);
            const k3 = vec3(-1.0, 1.0, -1.0);
            const k4 = vec3(1.0, 1.0, 1.0);
            const n = vec3(0.0, 1.0, 0.0).toVar();
            const rho = length(q.xz).toVar();
            const bearing = atan(q.z, q.x).toVar();
            const grain = vec4(0.5, 0.5, 0.5, 0.5).toVar();
            If(isRock, () => {
                const eps = max(tAt.mul(u.pixelAngle).mul(0.75), ROCK_SOFT).toVar();
                n.assign(normalize(
                    k1.mul(cnRockDist(u, q.add(k1.mul(eps))))
                        .add(k2.mul(cnRockDist(u, q.add(k2.mul(eps)))))
                        .add(k3.mul(cnRockDist(u, q.add(k3.mul(eps)))))
                        .add(k4.mul(cnRockDist(u, q.add(k4.mul(eps)))))
                        .add(vec3(1e-6, 2e-6, 0.0)),
                ));
                if (detail) {
                    // Its grain, read in the stone's own space, and the roughness finer than a cell.
                    grain.assign(u.smoke(q.mul(vec3(0.21, 0.42, 0.21))));
                    const fine = u.smoke(q.mul(0.83).add(vec3(0.37, 0.11, 0.59)));
                    const bump = vec3(grain.g.sub(fine.r), fine.g.sub(0.25).mul(0.5), fine.b.sub(grain.r));
                    n.assign(normalize(n.add(bump.mul(ROCK_BUMP))));
                }
            }).Else(() => {
                const eps = max(tAt.mul(u.pixelAngle).mul(0.75), 0.0025).toVar();
                n.assign(normalize(
                    k1.mul(cnTowerField(q.add(k1.mul(eps)), u.cageTurn, u.cageFill).x)
                        .add(k2.mul(cnTowerField(q.add(k2.mul(eps)), u.cageTurn, u.cageFill).x))
                        .add(k3.mul(cnTowerField(q.add(k3.mul(eps)), u.cageTurn, u.cageFill).x))
                        .add(k4.mul(cnTowerField(q.add(k4.mul(eps)), u.cageTurn, u.cageFill).x))
                        .add(vec3(1e-6, 2e-6, 0.0)),
                ));
                if (detail) grain.assign(u.smoke(vec3(bearing.mul(0.9), q.y.mul(0.11), rho.mul(0.3))));
            });

            // ── What it is made of ──
            const tone = float(0.07).toVar(); // iron, in shadow most of its life
            // How wet it is: the rock is washed as high as the last wave ran up it.
            const washed = float(1.0).sub(smoothstep(0.3, u.seaRoll.w.mul(2.4).add(1.5), q.y.sub(Y_SEA))).toVar();
            const gloss = float(0.12).toVar();
            If(what.lessThan(ROCK + 0.5), () => {
                // Bedded stone, each bed its own grey, streaked; dark where it is wet.
                const bed = q.y.add(q.x.mul(ROCK_BEDS.dip[0])).add(q.z.mul(ROCK_BEDS.dip[1]))
                    .add(grain.r.sub(0.5).mul(0.5)).div(ROCK_BEDS.thick);
                const bedTone = sin(bed.mul(3.7)).mul(sin(bed.mul(1.3).add(1.0))).mul(0.22).add(0.9);
                tone.assign(float(0.3).mul(grain.r.mul(0.6).add(grain.g.mul(0.5)).add(0.4)).mul(bedTone)
                    .mul(mix(1.0, 0.5, washed)));
                gloss.assign(mix(0.22, 1.0, washed));
            }).ElseIf(what.lessThan(SHAFT + 0.5), () => {
                // The shaft: painted in bands, pale and dark, weathered where the rain ran.
                const band = fract(q.y.sub(Y_FOOT).div(Y_NECK - Y_FOOT).mul(TOWER.bands * 0.5));
                const edge = max(tAt.mul(u.pixelAngle).mul(1.2), 0.004).div((Y_NECK - Y_FOOT) / (TOWER.bands * 0.5));
                const pale = smoothstep(float(0.5).sub(edge), float(0.5).add(edge), band)
                    .mul(float(1.0).sub(smoothstep(float(1.0).sub(edge), 1.0, band)))
                    .add(float(1.0).sub(smoothstep(0.0, edge, band)));
                const weather = grain.g.mul(0.5).add(grain.r.mul(0.5)).mul(0.55).add(0.6);
                tone.assign(mix(0.045, 0.6, clamp(pale, 0.0, 1.0)).mul(weather));
                // A door at its foot, round-headed, in a pale frame.
                const aside = abs(bearing.sub(DOOR.bearing)).mul(rho);
                const up = q.y.sub(Y_FOOT + DOOR.sill).toVar();
                const head = max(up.sub(DOOR.height - DOOR.half), 0.0);
                const edge2 = length(vec2(aside, head)).sub(DOOR.half);
                const standing = step(0.0, up);
                tone.assign(mix(tone, 0.5, float(1.0).sub(smoothstep(0.035, 0.06, abs(edge2))).mul(standing)));
                tone.assign(mix(tone, 0.018, float(1.0).sub(smoothstep(-0.012, 0.012, edge2)).mul(standing)));
            }).ElseIf(what.greaterThan(WALL - 0.5).and(what.lessThan(WALL + 0.5)), () => {
                tone.assign(grain.r.mul(0.2).add(0.42));
                gloss.assign(0.3);
            });

            // ── The lamp's light on it ──
            const r = max(length(q), 0.05).toVar();
            const d = q.div(r).toVar(); // from the lamp to here
            const l = d.negate();
            // Inside the lantern nothing stands between the lamp and a face; outside, the slats,
            // the roof and the gallery do.
            const outside = smoothstep(CAGE.radius - 0.03, CAGE.radius + 0.08, rho)
                .add(smoothstep(CAGE.halfHeight - 0.02, CAGE.halfHeight + 0.1, abs(q.y)));
            const gate = mix(1.0, cnCage(d, u.spin, u.spinE1, u.spinE2, u.cageTurn, u.cageFill, float(0.05)), clamp(outside, 0.0, 1.0));
            const lamp = u.coreGain.add(cnBeam(d, u.beam).mul(u.beamGain).mul(0.5))
                .mul(gate).div(r.mul(r).add(0.3)).mul(1.15);
            const facing = dot(n, l);
            const direct = lamp.mul(clamp(facing.mul(0.85).add(0.15), 0.0, 1.0));

            // ── An echo's shell flashes down the tower as it passes ──
            const flash = float(0.0).toVar();
            Loop({
                start: int(0), end: u.echoCount, type: 'int', condition: '<', name: 'e',
            }, ({ e }) => {
                const a = u.echoes.element(e);
                const x = r.sub(a.x).div(a.y.mul(2.6));
                flash.addAssign(a.z.mul(exp(x.mul(x).negate())));
            });
            const flashed = flash.mul(clamp(facing.mul(0.6).add(0.4), 0.0, 1.0)).mul(0.6);

            // ── The galaxy rims it, the sky and the lit smoke below fill it faintly ──
            const lg = vec3(GALAXY_DIR[0], GALAXY_DIR[1], GALAXY_DIR[2]);
            const toG = dot(n, lg);
            const edgeOn = float(1.0).sub(clamp(dot(n, ray.negate()), 0.0, 1.0));
            const rim = u.galaxy.mul(clamp(toG.mul(0.8).add(0.2), 0.0, 1.0).mul(GALAXY_KEY)
                .add(pow(edgeOn, 3.0).mul(clamp(toG.add(0.4), 0.0, 1.0)).mul(GALAXY_KEY * 0.5)));
            // What the gallery's grating lets fall lights the head of the shaft; the lit smoke below
            // lifts what looks down at it.
            const spill = u.coreGain.mul(0.05).mul(exp(max(float(Y_FLOOR).sub(q.y), 0.0).mul(-0.55)))
                .mul(float(1.0).sub(smoothstep(Y_FLOOR - 0.3, Y_FLOOR + 0.2, q.y)));
            const fill = u.ambient.mul(n.y.mul(0.35).add(0.65))
                .add(spill)
                .add(u.coreGain.mul(0.004).mul(clamp(float(0.55).sub(n.y.mul(0.45)), 0.0, 1.0)));
            // What the lantern and the gallery let fall lies on whatever looks up at them: the
            // rock's ledges, the plinth's top.
            const below = smoothstep(Y_FLOOR - 0.2, Y_FLOOR - 1.6, q.y);
            const fallen = u.coreGain.mul(FALL_LIGHT).div(r.mul(r).mul(0.035).add(1.0))
                .mul(clamp(facing.mul(0.75).add(0.25), 0.0, 1.0)).mul(below);
            // Wet stone and paint mirror: the lamp as a glint, the sky along every edge.
            const back = reflect(ray, n);
            const shine = pow(clamp(dot(back, l), 0.0, 1.0), 14.0).mul(u.coreGain.mul(FALL_LIGHT * 3.0))
                .div(r.mul(r).mul(0.035).add(1.0)).mul(below)
                .add(pow(edgeOn, 4.0).mul(u.skyGlow).mul(1.6))
                .add(pow(clamp(dot(back, lg), 0.0, 1.0), 9.0).mul(u.galaxy).mul(0.1))
                .mul(gloss);

            const shade = direct.add(flashed).add(rim).add(fill).add(fallen)
                .mul(tone)
                .add(shine)
                .toVar();

            // ── White water on the rock: what the last wave left, running off it ──
            If(what.lessThan(ROCK + 0.5), () => {
                const lift = q.y.sub(Y_SEA).add(grain.g.sub(0.5).mul(0.7));
                const ran = u.seaRoll.w.mul(2.0).add(0.4).toVar();
                const band = float(1.0).sub(smoothstep(ran.mul(0.25), ran, lift));
                // (It drains in threads, drawn out down the stone.)
                const runs = detail
                    ? smoothstep(0.4, 0.74, u.smoke(vec3(q.x.mul(0.9), q.y.mul(0.14), q.z.mul(0.9))).g.add(grain.b.mul(0.3)))
                    : float(0.55);
                const white = band.mul(mix(runs, float(1.0), u.seaRoll.w.mul(0.55))).mul(n.y.mul(0.3).add(0.7));
                const foam = direct.add(flashed).add(rim).add(fill).add(fallen)
                    .add(u.skyGlow.mul(0.5))
                    .mul(ROCK_FOAM);
                shade.assign(mix(shade, foam, clamp(white, 0.0, 1.0).mul(0.92)));
            });

            // ── The window: someone keeps the light ──
            const turnTo = abs(bearing.sub(WINDOW.bearing)).mul(rho);
            const inWindow = float(1.0).sub(smoothstep(WINDOW.wide - 0.02, WINDOW.wide + 0.02, turnTo))
                .mul(float(1.0).sub(smoothstep(WINDOW.half - 0.02, WINDOW.half + 0.02, abs(q.y.sub(WINDOW.y)))))
                .mul(what.greaterThan(SHAFT - 0.5).and(what.lessThan(SHAFT + 0.5)).select(1.0, 0.0));
            // A cross of glazing bars.
            const bars = smoothstep(0.012, 0.03, turnTo).mul(smoothstep(0.012, 0.03, abs(q.y.sub(WINDOW.y))));
            shade.assign(mix(shade, bars.mul(0.85).add(0.03), inWindow));

            // ── The lens: the brightest thing in the picture, brighter still where a beam leaves it ──
            If(what.greaterThan(LENS - 0.5), () => {
                const rings = fract(q.y.mul(9.0)).sub(0.5).abs().mul(0.5)
                    .add(0.75);
                const toEye = normalize(rel.negate());
                shade.assign(u.coreGain.mul(3.2).mul(rings).mul(cnBeam(toEye, u.beam).mul(4.0).add(1.0)));
            });
            light.assign(shade.mul(u.breath));
        });
    });
    return { t: hitT, cover, light };
}
