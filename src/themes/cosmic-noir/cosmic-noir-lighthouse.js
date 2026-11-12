/**
 * Cosmic Noir — the lighthouse and its rock.
 *
 * One distance field, walked along the view ray inside its bounds only (an upright cylinder round
 * the tower and a ball round the rock): the rock is a clutch of basalt shards (each the meeting of
 * a handful of planes), the tower a flared, banded shaft with one lit window, then a corbel, the
 * gallery and its railing, the lantern room (a low wall, the ring of shutter slats that turn and
 * open, the lens blazing inside), the roof's dome, its ball and its rod.
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
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CAGE, PULSAR, SEA, TAU, TOWER, cnBall, cnBeam, cnCage, cnUpright, mulberry32,
} from './cosmic-noir-tsl.js';
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

/** What the field says a point belongs to. */
const ROCK = 0;
const SHAFT = 1;
const IRON = 2;
const WALL = 3;
const LENS = 4;

/** The bounds the field is walked inside (the same frame). */
export const TOWER_BOUNDS = Object.freeze({
    radius: TOWER.galleryRadius + 0.2,
    y0: Y_FOOT - 0.4,
    y1: TOWER.rodTop + 0.1,
    rock: Object.freeze([1.0, Y_SEA - 0.3, 0.6]),
    rockRadius: 5.6,
});

/**
 * The rock: shards of basalt, each the meeting of planes laid on an ellipsoid (so each is a
 * faceted lump of about that shape). Fixed by a seed: the same rock every visit.
 */
function rockShards() {
    const rand = mulberry32(1907);
    const lumps = [
        // The island the tower stands on (a level footing), a pinnacle beside it, lower rocks
        // round it and one fang standing off alone.
        {
            c: [0.2, Y_SEA + 0.1, 0.1], r: [2.5, 1.5, 2.2], sides: 9, bevels: 5, flat: true,
        },
        {
            c: [-2.35, Y_SEA + 0.1, 0.9], r: [0.95, 2.2, 0.9], sides: 6, bevels: 3,
        },
        {
            c: [2.3, Y_SEA - 0.45, 0.7], r: [1.4, 1.25, 1.25], sides: 7, bevels: 4,
        },
        {
            c: [0.8, Y_SEA - 0.55, 2.3], r: [1.3, 0.95, 1.0], sides: 6, bevels: 3,
        },
        {
            c: [-1.0, Y_SEA - 0.4, -2.2], r: [1.4, 1.45, 1.2], sides: 5, bevels: 2,
        },
        {
            c: [4.6, Y_SEA - 0.35, 1.2], r: [0.6, 1.2, 0.55], sides: 6, bevels: 2,
        },
    ];
    return lumps.map(({
        c, r, sides, bevels, flat,
    }) => {
        const list = [];
        const face = (n, cut) => {
            const l = Math.hypot(n[0], n[1], n[2]);
            const m = n.map((v) => v / l);
            // The ellipsoid's reach along this face's normal, cut a little short.
            const reach = Math.hypot(m[0] * r[0], m[1] * r[1], m[2] * r[2]) * cut;
            list.push({ n: m, d: reach + m[0] * c[0] + m[1] * c[1] + m[2] * c[2] });
        };
        // The top: level under the tower, tipped elsewhere.
        face(flat ? [0.02, 1, -0.03] : [rand() * 0.6 - 0.3, 1, rand() * 0.6 - 0.3], 1);
        // The flanks, all the way round (so the lump is closed), each leaning in as it rises.
        const turn = rand() * TAU;
        for (let i = 0; i < sides; i++) {
            const a = turn + ((i + rand() * 0.7) / sides) * TAU;
            face([Math.cos(a), rand() * 0.6 - 0.08, Math.sin(a)], 0.76 + rand() * 0.24);
        }
        // Bevels: the corners between top and flank struck off.
        for (let i = 0; i < bevels; i++) {
            const a = rand() * TAU;
            const lean = 0.55 + rand() * 0.9;
            face([Math.cos(a), lean, Math.sin(a)], 0.8 + rand() * 0.14);
        }
        return list;
    });
}
const SHARDS = rockShards();

/**
 * The field: vec2(distance, what it is) at a point `q` in the lamp's frame. `turn` = the slats'
 * turn (radians), `fill` = the share of a pitch a slat covers. Pure (no uniforms): one function in
 * the shader, called by the walk and by the normal.
 */
export const cnTowerField = /* @__PURE__ */ Fn(([q, turn, fill]) => {
    const rho = length(q.xz).toVar();
    const { y } = q;
    const bearing = atan(q.z, q.x).toVar();
    const dist = float(1e3).toVar();
    const what = float(ROCK).toVar();
    const take = (d, id) => {
        If(d.lessThan(dist), () => {
            dist.assign(d);
            what.assign(id);
        });
    };

    // ── The rock ──
    // Its space is bent a little, so no face is quite flat and no edge quite straight.
    const bent = q.add(sin(q.yzx.mul(1.9).add(vec3(0.7, 2.1, 4.3))).mul(0.17))
        .add(sin(q.zxy.mul(4.7).add(vec3(1.3, 0.2, 2.9))).mul(0.06)).toVar();
    SHARDS.forEach((planes) => {
        let d = null;
        planes.forEach(({ n, d: reach }) => {
            const side = dot(bent, vec3(n[0], n[1], n[2])).sub(reach);
            d = d ? max(d, side) : side;
        });
        take(d.mul(0.8), ROCK);
    });

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
            const f = cnTowerField(rel.add(ray.mul(t)), u.cageTurn, u.cageFill).toVar();
            const px = f.x.div(t.mul(u.pixelAngle));
            If(px.lessThan(nearest), () => {
                nearest.assign(px);
                tNearest.assign(t);
            });
            If(f.x.lessThan(t.mul(u.pixelAngle).mul(0.5)), () => {
                found.assign(1.0);
                Break();
            });
            t.addAssign(f.x.mul(0.94));
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
            // The normal, from four reads round the point.
            const eps = max(tAt.mul(u.pixelAngle).mul(0.75), 0.0025).toVar();
            const k1 = vec3(1.0, -1.0, -1.0);
            const k2 = vec3(-1.0, -1.0, 1.0);
            const k3 = vec3(-1.0, 1.0, -1.0);
            const k4 = vec3(1.0, 1.0, 1.0);
            const n = normalize(
                k1.mul(cnTowerField(q.add(k1.mul(eps)), u.cageTurn, u.cageFill).x)
                    .add(k2.mul(cnTowerField(q.add(k2.mul(eps)), u.cageTurn, u.cageFill).x))
                    .add(k3.mul(cnTowerField(q.add(k3.mul(eps)), u.cageTurn, u.cageFill).x))
                    .add(k4.mul(cnTowerField(q.add(k4.mul(eps)), u.cageTurn, u.cageFill).x))
                    .add(vec3(1e-6, 2e-6, 0.0)),
            ).toVar();
            const what = here.y.toVar();
            const rho = length(q.xz).toVar();
            const bearing = atan(q.z, q.x).toVar();

            // ── What it is made of ──
            const tone = float(0.07).toVar(); // iron, in shadow most of its life
            const grain = detail
                ? u.smoke(vec3(bearing.mul(0.9), q.y.mul(0.11), rho.mul(0.3))).toVar()
                : vec4(0.5, 0.5, 0.5, 0.5).toVar();
            If(what.lessThan(ROCK + 0.5), () => {
                // Basalt, streaked.
                tone.assign(float(0.17).mul(grain.r.mul(0.8).add(grain.g.mul(0.3)).add(0.5)));
            }).ElseIf(what.lessThan(SHAFT + 0.5), () => {
                // The shaft: painted in bands, pale and dark, weathered where the rain ran.
                const band = fract(q.y.sub(Y_FOOT).div(Y_NECK - Y_FOOT).mul(TOWER.bands * 0.5));
                const edge = max(tAt.mul(u.pixelAngle).mul(1.2), 0.004).div((Y_NECK - Y_FOOT) / (TOWER.bands * 0.5));
                const pale = smoothstep(float(0.5).sub(edge), float(0.5).add(edge), band)
                    .mul(float(1.0).sub(smoothstep(float(1.0).sub(edge), 1.0, band)))
                    .add(float(1.0).sub(smoothstep(0.0, edge, band)));
                const weather = grain.g.mul(0.5).add(grain.r.mul(0.5)).mul(0.55).add(0.6);
                tone.assign(mix(0.045, 0.6, clamp(pale, 0.0, 1.0)).mul(weather));
            }).ElseIf(what.greaterThan(WALL - 0.5).and(what.lessThan(WALL + 0.5)), () => {
                tone.assign(grain.r.mul(0.2).add(0.42));
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

            const shade = direct.add(flashed).add(rim).add(fill).mul(tone)
                .toVar();

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
