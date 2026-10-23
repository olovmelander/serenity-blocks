/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Electric Storm — a plasma globe in a dark room, shot close, like a macro photograph.
 *
 * Inhale: a dozen filaments reach out from the electrode, fork near their tips and touch the
 * glass, where each one blooms and spreads a small fern of discharge over the inner surface.
 * Hold: they keep their charge, crawling. Exhale (a little longer): they withdraw to the core,
 * which glows on alone through the empty hold. Nothing flashes: every change of light is as slow
 * as the breath that drives it.
 *
 * The globe is painted in its own units (glass radius 1, centred on the hero). Each filament is a
 * radial thread in 3D that leans toward or away from the lens, so its projection is shorter than
 * the radius and its contact on the glass is foreshortened: those aimed at us end inside the disc
 * in a face-on fern, those aimed sideways end on the rim in a thin crescent, those aimed away pass
 * behind the electrode. The glass mirrors a painted studio (a large window, strip lights behind)
 * with a Fresnel rim, bends the room behind it near the edge, and carries dust and smudges.
 *
 * The globe stands on a flared black base on a polished table. The table does not paint the globe
 * twice: each table pixel folds its coordinate about the contact line and the globe is painted
 * once, at the folded point, a little blurred (the analytic glow widths just widen) and dimmed by
 * the table's Fresnel. Behind it all: blue-black air with a faint haze lit by the globe, and the
 * soft bokeh of distant lights. Dust motes drift through the violet light in front, the nearer
 * ones catching the globe's glow.
 *
 * Moods (MOODS): the violet globe in a dark studio (the poster); the same night with rain running
 * down a tall window onto a city out of focus; a teal-cyan globe in a smoky room; an amber and
 * neon-pink globe under neon signs. Rare events, gentle and seeded per visit: a fingertip on the
 * glass (one filament reaches out, holds a spot for seconds, lets go) and a spark of static that
 * drifts up off the glass.
 */
import { Vector4 } from 'three/webgpu';
import {
    Fn, If, Loop, cos, exp, float, floor, fract, length, max, min, mix, pow, select, sin, smoothstep, sqrt, step,
    uniformArray, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, eventWindow, fadeOut, fbm, fresnel, gnoise, gnoise3, hash21, hash22, layer,
} from '../stage/breath-tsl.js';
import { MOTE_MOTION } from '../stage/breath-motes.js';

const TAU = Math.PI * 2;
/** Glass radius in hero units: on a landscape screen, and on a tall phone (as wide as it allows). */
const RADIUS = [0.72, 0.88];
// Everything below is in the globe's own units: glass radius 1, centre on the hero.
/** The central electrode's radius. */
const ELECTRODE = 0.17;
/** The plane where the glass sinks into the base's collar, and the glass's radius at that plane. */
const COLLAR = -0.86;
const HOLE = Math.sqrt(1 - COLLAR * COLLAR);
/** The collar ring's outer radius, the base's radius on the table, and the table under its centre. */
const RING = 0.6;
const FOOT = 0.82;
const FOOT_Y = COLLAR - 0.34;
/** Seen from a little above, circles flatten into ellipses this flat. */
const TILT = 0.14;
/**
 * The globe's reflection folds about the table line under the glass's front. (The base folds about
 * its own front edge, nearer the lens: each thing mirrors about the table at its own depth.)
 */
const MIRROR = FOOT_Y - TILT * 0.7;
/** Where the table fades into the dark of the room. */
const HORIZON = -0.6;

const DAYLIGHT = vec3(0.78, 0.85, 1.0);

/**
 * A mood's colours as nodes (linear RGB). HOT is the white-hot core, MAGENTA and VIOLET the gas's
 * two glows, BLUE the room's own tint, NIGHT its air. Filament glow runs from PINK_GLOW to
 * BLUE_GLOW, one hue per filament (their outer haze likewise), cooling to TIP at the glass.
 */
function paletteOf(mood) {
    const c = mood.colors;
    return {
        HOT: vec3(...c.hot),
        MAGENTA: vec3(...c.magenta),
        VIOLET: vec3(...c.violet),
        BLUE: vec3(...c.blue),
        NIGHT: vec3(...c.night),
        PINK_GLOW: vec3(...c.pinkGlow),
        BLUE_GLOW: vec3(...c.blueGlow),
        PINK_HAZE: vec3(...c.pinkHaze),
        BLUE_HAZE: vec3(...c.blueHaze),
        TIP: vec3(...c.tip),
    };
}
const normal3 = (v) => {
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
};

/**
 * A rectangular light in the studio the glass reflects: the direction to its centre and the two
 * axes of its face. A reflected ray is projected onto that face (a gnomonic projection), so the
 * panel keeps its straight edges wherever the sphere bends its reflection.
 */
function panel(direction) {
    const w = normal3(direction);
    const across = normal3([w[2], 0, -w[0]]);
    const up = [
        w[1] * across[2] - w[2] * across[1], w[2] * across[0] - w[0] * across[2], w[0] * across[1] - w[1] * across[0],
    ];
    return { w: vec3(...w), across: vec3(...across), up: vec3(...up) };
}
/** A tall window up and to the left of the globe; strip lights behind it, right and left. */
const WINDOW = panel([-0.74, 0.67, 0.1]);
const STRIP_RIGHT = panel([0.78, 0.08, -0.62]);
const STRIP_LEFT = panel([-0.82, -0.1, -0.56]);

/** A deterministic 0..1 for layout decisions (the shader's hashes are for per-pixel work). */
const rand = (i, k) => {
    const x = Math.sin(i * 127.1 + k * 311.7 + 1.3) * 43758.5453;
    return x - Math.floor(x);
};

/**
 * The filaments: evenly spread bearings with a little jitter, and leans toward or away from the
 * lens that step by the golden angle, so any count mixes short face-on threads with long side-on
 * ones and a few that pass behind the electrode.
 */
function filamentLayout(count) {
    return Array.from({ length: count }, (_, i) => {
        const lean = 0.84 * Math.sin(i * 2.39996 + 0.7);
        const front = lean > -0.2;
        const hue = rand(i, 1);
        return {
            bearing: ((i + (rand(i, 2) - 0.5) * 0.55) / count) * TAU,
            // The projected length of a radius along this filament, and how much its patch of
            // glass is foreshortened (never fully edge-on: the bloom would vanish into a line).
            length: Math.sqrt(1 - lean * lean),
            squash: Math.max(Math.abs(lean), 0.24),
            front,
            seed: Math.floor(rand(i, 3) * 50) + 0.37 * i,
            drift: 0.025 + 0.03 * rand(i, 4),
            phase: rand(i, 5) * TAU,
            // Some filaments carry more of the current: brighter, with brighter contacts.
            gain: (0.55 + 0.45 * rand(i, 6)) * (front ? 1 : 0.5),
            // Behind the electrode, out of the lens's narrow focus: softer threads.
            focus: front ? 1 : 1.6,
            weight: 0.8 + 0.5 * rand(i, 12),
            own: 0.95 + 0.08 * rand(i, 7),
            hue,
            forkAt: 0.48 + 0.24 * rand(i, 8),
            side: rand(i, 9) > 0.5 ? 1 : -1,
            spread: 0.3 + 0.22 * rand(i, 10),
            twist: 14 + 9 * rand(i, 11),
        };
    });
}

/**
 * The layout as shader data: four vec4 rows per filament, read by index inside one shader loop.
 * The loop body compiles once instead of once per filament, a fraction of the code (and of the
 * pipeline's compile time) of the unrolled form, with exactly the same arrangement.
 */
function filamentData(layout) {
    const rows = [[], [], [], []];
    layout.forEach((f) => {
        rows[0].push(new Vector4(f.bearing, f.length, f.squash, f.seed));
        rows[1].push(new Vector4(f.drift, f.phase, f.gain, f.focus));
        rows[2].push(new Vector4(f.weight, f.own, f.forkAt, f.side));
        rows[3].push(new Vector4(f.spread, f.twist, f.front ? 1 : 0, f.hue));
    });
    return rows.map((row) => uniformArray(row, 'vec4'));
}

/**
 * Lights across the room, out of focus: x as a fraction of the half-width, y from the horizon to
 * the top. Most are far (small, crisp-edged discs that barely move); every fourth hangs nearer the
 * lens: larger, softer, dimmer, and sliding further as the camera breathes.
 */
function bokehLayout(count, tints, gainScale = 1) {
    return Array.from({ length: count }, (_, i) => {
        const near = i % 4 === 3;
        const glow = rand(i, 25) ** 2;
        return {
            near,
            x: (rand(i, 21) * 2 - 1) * 1.02,
            y: rand(i, 22),
            size: near ? 0.15 + 0.1 * rand(i, 23) : 0.04 + 0.06 * rand(i, 23),
            soft: near ? 0.4 : 0.2,
            tint: tints[Math.floor(rand(i, 24) * tints.length)],
            gain: (near ? 0.01 + 0.016 * glow : 0.02 + 0.05 * glow) * gainScale,
        };
    });
}

/** The city's lights: sodium most of all, warm white windows, a few tail lights, the odd teal sign. */
const SODIUM = vec3(1.0, 0.5, 0.16);
const WARM_WHITE = vec3(1.0, 0.82, 0.6);
const TAIL_LIGHT = vec3(1.0, 0.1, 0.05);
const TEAL_SIGN = vec3(0.15, 0.8, 0.7);

/**
 * One row of a night city's lights seen far out of focus: at most one disc per cell along x, at
 * `y0` (give or take `spread`) above the sill, each with its own size, colour and brightness. A slow
 * noise along the row gathers the lights into clusters with dark gaps between them. Every disc fits
 * inside its cell (size < 0.2 / cells), so no cell edge ever cuts one.
 */
const cityRow = /* @__PURE__ */ Fn(([p, up, y0, spread, cells, size, density, salt]) => {
    const q = p.x.mul(cells).add(salt.mul(17.3)).toVar();
    const cell = floor(q).toVar();
    const h = hash22(vec2(cell, salt)).toVar();
    const k = hash22(vec2(cell, salt.add(5.1))).toVar();
    // Many small lights, a few large ones.
    const r = size.mul(h.x.mul(h.x).mul(1.2).add(0.5)).toVar();
    const cx = fract(q).sub(0.5).sub(h.y.sub(0.5).mul(0.3)).div(cells);
    const cy = up.sub(y0.add(k.x.sub(0.5).mul(spread)));
    const d = length(vec2(cx, cy)).toVar();
    const cluster = smoothstep(0.36, 0.6, gnoise(vec2(cell.mul(0.23), salt.mul(3.7))));
    const on = step(k.y, density.mul(cluster));
    // Lens bokeh: a soft disc with a faint brighter rim.
    const disc = fadeOut(r.mul(0.6), r, d).mul(smoothstep(r.mul(0.4), r.mul(0.9), d).mul(0.3).add(0.72));
    const kind = hash21(vec2(cell.add(3.3), salt)).toVar();
    const tint = mix(
        mix(SODIUM, WARM_WHITE, step(0.6, kind)),
        mix(TAIL_LIGHT, TEAL_SIGN, step(0.975, kind)),
        step(0.93, kind),
    );
    const gain = hash21(vec2(cell.add(9.9), salt)).toVar();
    return tint.mul(disc).mul(on).mul(gain.mul(gain).mul(0.7).add(0.3));
}).setLayout({
    name: 'storm_cityRow',
    type: 'vec3',
    inputs: [
        { name: 'p', type: 'vec2' }, { name: 'up', type: 'float' }, { name: 'y0', type: 'float' },
        { name: 'spread', type: 'float' }, { name: 'cells', type: 'float' }, { name: 'size', type: 'float' },
        { name: 'density', type: 'float' }, { name: 'salt', type: 'float' },
    ],
});

/**
 * The night city through the window, far out of focus: dark sky above, the faint sodium haze of the
 * streets near the bottom, a soft skyline of dark blocks, and its lights in a few clustered rows,
 * streets low down, lit floors on the blocks, and a few large, dim discs nearer the lens.
 * `up` is the height above the sill.
 */
function cityAt(q, up) {
    const haze = vec3(0.04, 0.017, 0.007).mul(exp(up.max(0).mul(-2.6)));
    const sky = vec3(0.0018, 0.0024, 0.0075).add(haze);
    // Blocks of different heights; the defocus softens their roofs and corners.
    const bx = q.x.mul(2.4).add(0.3);
    const block = floor(bx);
    const heightOf = (b) => {
        const hh = hash21(vec2(b, 7.7));
        return hh.mul(hh).mul(0.8).add(0.3);
    };
    const roof = mix(heightOf(block), heightOf(block.add(1)), smoothstep(0.86, 1.0, fract(bx)));
    const mass = fadeOut(roof.sub(0.03), roof.add(0.03), up).toVar();
    const building = vec3(0.0016, 0.0015, 0.0019).add(haze.mul(0.35));
    const row = (y0, spread, cells, size, density, salt) => {
        const args = [y0, spread, cells, size, density, salt].map((v) => float(v));
        return cityRow(q, up, ...args);
    };
    const streets = row(0.07, 0.05, 5, 0.036, 0.9, 1).mul(0.14).add(row(0.17, 0.05, 8, 0.022, 0.75, 2).mul(0.1));
    const floors = row(0.36, 0.05, 6, 0.026, 0.6, 3).mul(0.075)
        .add(row(0.58, 0.04, 6, 0.024, 0.5, 4).mul(0.06))
        .add(row(0.82, 0.04, 6, 0.022, 0.45, 6).mul(0.05));
    const nearer = row(0.3, 0.45, 1.4, 0.12, 0.65, 5).mul(0.06).add(row(0.75, 0.5, 1.1, 0.16, 0.5, 7).mul(0.04));
    return mix(sky, building, mass).add(streets).add(floors.mul(mass)).add(nearer);
}

/**
 * Runnels on the pane: in a handful of columns a drop slides slowly down at its own pace, trailing
 * a wet line; drop and trail catch a glint on their side toward the globe (`toward`, a unit vector).
 * Returns (wet coverage, glint, dark rim).
 */
const runnels = /* @__PURE__ */ Fn(([p, t, toward]) => {
    const x = p.x.mul(3).toVar();
    const column = floor(x).toVar();
    const pick = hash21(vec2(column, 3.7)).toVar();
    // A gentle meander, not a wave: water finds its way down the glass.
    const wiggle = sin(p.y.mul(3.5).add(pick.mul(40))).mul(0.035).add(sin(p.y.mul(9).add(pick.mul(13))).mul(0.008));
    const dx = fract(x).sub(0.5).sub(pick.sub(0.5).mul(0.5)).sub(wiggle)
        .div(3)
        .toVar();
    const pace = pick.mul(0.016).add(0.012);
    const head = float(1.3).sub(fract(hash21(vec2(column, 9.1)).add(t.mul(pace))).mul(2.6)).toVar();
    const dy = p.y.sub(head).toVar();
    const dropR = vec2(dx.div(0.017), dy.div(0.024)).toVar();
    const reach = dropR.length().toVar();
    const drop = fadeOut(0.72, 1, reach).toVar();
    const dropG = dropR.sub(toward.mul(0.42));
    const along = smoothstep(0, 0.02, dy).mul(fadeOut(0.1, 1.1, dy)).toVar();
    const trail = fadeOut(0.0035, 0.006, dx.abs()).mul(along);
    // The trail's edge toward the globe holds a thin line of its light.
    const edge = fadeOut(0.002, 0.0045, dx.sub(toward.x.mul(0.003)).abs()).mul(along);
    const running = step(0.4, pick).toVar();
    const wet = drop.add(trail.mul(0.85)).min(1).mul(running);
    const shine = exp(dropG.dot(dropG).mul(-9)).mul(drop).add(trail.mul(0.35)).add(edge.mul(0.9))
        .mul(running);
    return vec3(wet, shine, smoothstep(0.45, 1, reach).mul(drop).mul(running));
}).setLayout({
    name: 'storm_runnels',
    type: 'vec3',
    inputs: [{ name: 'p', type: 'vec2' }, { name: 't', type: 'float' }, { name: 'toward', type: 'vec2' }],
});

/**
 * A tall window behind the globe on a rainy night: the city out of focus (cityAt), mullions, and rain
 * on the pane. Each bead is a tiny wide-angle lens: it shows the city small and upside down inside a
 * dark rim, and holds a glint of the globe's violet on the side that faces it.
 */
function paintWindow(rp, u, horizonY, K) {
    const w = layer(rp, u, 0.2).toVar();
    const sill = horizonY.add(0.035);
    const up = w.y.sub(sill).toVar();
    const pane = smoothstep(-0.004, 0.004, up).toVar();
    const city = cityAt(w, up).toVar();
    // The globe stands at the origin: every drop catches its light on the side facing it.
    const toward = w.negate().div(w.length().max(1e-3)).toVar();
    const near = float(1).div(w.dot(w).mul(1.2).add(1)).toVar();
    // Beads of all sizes, anywhere in their cell, in about a quarter of the cells.
    const rq = w.add(vec2(0, u.seed.mul(3))).mul(7).toVar();
    const cell = floor(rq).toVar();
    const r = pow(hash21(cell.add(7.3)), float(1.5)).mul(0.26).add(0.1).toVar();
    const o = fract(rq).sub(0.5).sub(hash22(cell.add(3.1)).sub(0.5).mul(float(0.9).sub(r.mul(2)))).toVar();
    const d = length(vec2(o.x, o.y.mul(1.12))).toVar();
    const bead = fadeOut(r.mul(0.8), r, d).mul(step(0.74, hash21(cell.add(41.7)))).toVar();
    const rim = smoothstep(r.mul(0.55), r, d).mul(bead);
    const g = o.sub(toward.mul(r.mul(0.4)));
    const glint = exp(g.dot(g).div(r.mul(r).mul(0.11)).negate()).mul(bead);
    const view = city.toVar();
    If(bead.greaterThan(0.001), () => {
        // Seen through the bead, the city is inverted and drawn in from far around it.
        const seen = w.sub(o.div(7).mul(8)).toVar();
        view.assign(mix(view, cityAt(seen, seen.y.sub(sill)).mul(1.7), bead.mul(0.9)));
    });
    const run = runnels(w.add(vec2(0, u.seed.mul(3))), u.time, toward).toVar();
    view.assign(mix(view, city.mul(1.7), run.x));
    view.mulAssign(float(1).sub(rim.add(run.z).min(1).mul(0.7)));
    // Beads and runnels hold the globe's violet: a glint on the near side, a faint glow through them.
    const lit = glint.add(run.y).add(bead.add(run.x).min(1).mul(0.06));
    view.addAssign(mix(K.MAGENTA, K.VIOLET, 0.4).mul(lit.mul(near.mul(0.7).add(0.15)).mul(0.6)));
    // Mullions and a transom high up (a tall screen sees it), lit along their edges by the globe.
    const mx = min(w.x.abs().sub(1.12).abs(), up.sub(1.25).abs()).toVar();
    const bar = fadeOut(0.03, 0.036, mx);
    const lip = mx.sub(0.033).div(0.004);
    view.assign(mix(view, vec3(0.0014, 0.0014, 0.002).add(K.VIOLET.mul(exp(lip.mul(lip).negate()).mul(0.012))), bar));
    // Below the pane: the sill, its top edge catching the globe's light.
    const edge = up.div(0.005);
    return mix(vec3(0.0012, 0.0012, 0.0018), view, pane).add(K.VIOLET.mul(exp(edge.mul(edge).negate()).mul(0.02)));
}

/** The dark room: blue-black air, a faint haze drifting through it, distant lights out of focus. */
function paintRoom(rp, u, {
    bokeh, octaves, horizonY, K, M,
}) {
    const { NIGHT, BLUE } = K;
    const air = layer(rp, u, 0.3).add(vec2(u.seed.mul(11.3), u.seed.mul(4.7))).toVar();
    const drift = u.time.mul(0.012 * M.smoke.speed);
    const haze = fbm(air.mul(vec2(0.7, 1.25)).add(vec2(drift, drift.mul(0.4).add(3.1))), octaves).toVar();
    const col = NIGHT.mul(haze.mul(0.9).add(0.55)).toVar();
    col.addAssign(BLUE.mul(haze.sub(0.4).max(0).mul(0.012)));
    // Smoke hanging in still air settles into strata; the broad haze bends them (a cheap warp).
    const strata = fbm(air.mul(vec2(1.3, 3.2)).add(vec2(drift.mul(1.6), haze.mul(1.4))), octaves).toVar();
    const smoke = smoothstep(0.46, 0.78, strata).toVar();
    col.addAssign(BLUE.mul(smoke.mul(0.003 * M.smoke.gain)));
    if (M.window) col.addAssign(paintWindow(rp, u, horizonY, K));
    const far = layer(rp, u, 0.12).toVar();
    const near = layer(rp, u, 0.45).toVar();
    const top = u.ext.y.sub(u.focus);
    bokeh.forEach((b) => {
        const centre = vec2(u.ext.x.mul(b.x), mix(horizonY.add(0.08), top.sub(0.05), b.y));
        const o = (b.near ? near : far).sub(centre).toVar();
        // A six-bladed aperture rounds every point of light into a soft hexagon.
        const hex = max(o.x.abs().mul(0.866).add(o.y.abs().mul(0.5)), o.y.abs());
        const dist = mix(length(o), hex.mul(1.06), 0.35);
        const disc = fadeOut(b.size * (1 - b.soft), b.size, dist);
        // Out of focus, a point of light becomes a disc with a slightly brighter rim.
        const rim = smoothstep(b.size * 0.5, b.size * 0.97, dist).mul(0.4).add(0.7);
        col.addAssign(vec3(...b.tint).mul(disc.mul(rim).mul(b.gain)));
    });
    if (M.neon) {
        // Neon signs on the far wall, far out of focus: a pink ring and an amber bar, each a soft
        // tube of light with a wide glow round it.
        const ringO = far.sub(vec2(u.ext.x.mul(-0.74), top.mul(0.55).add(0.1)));
        const ringD = length(ringO).sub(0.15).abs();
        const barX = far.x.sub(u.ext.x.mul(0.7)).abs().sub(u.ext.x.mul(0.13)).max(0);
        const barD = length(vec2(barX, far.y.sub(top.mul(0.62).add(0.08))));
        const tube = (dist, tint) => {
            const d2 = dist.mul(dist);
            return vec3(...tint).mul(exp(d2.mul(-520)).mul(0.06).add(exp(d2.mul(-40)).mul(0.012)));
        };
        col.addAssign(tube(ringD, [1.0, 0.25, 0.55]).add(tube(barD, [1.0, 0.55, 0.15])));
    }
    return { col, smoke };
}

/**
 * The polished table: black lacquer that mirrors the room more and more toward the horizon (where
 * it meets the room without a seam), lit round the base by the globe in table coordinates, so the
 * pool of light lies flat and fades into the distance.
 */
function paintTable(g, charge, K, M) {
    const { VIOLET, MAGENTA } = K;
    const below = float(HORIZON).sub(g.y).max(1e-3).toVar();
    // Perspective: the table's depth behind each pixel, 1 under the base; and the point it shows.
    const depth = float(HORIZON - FOOT_Y).div(below).min(30).toVar();
    const tx = g.x.mul(depth).toVar();
    const tz = depth.sub(1).toVar();
    const reflect = mix(float(0.38), float(1), exp(below.mul(-3))).toVar();
    const grain = gnoise(vec2(tx.mul(1.3), depth.mul(5.5)));
    const diffuse = vec3(...M.lacquer).mul(grain.mul(0.5).add(0.75)).toVar();
    const pool = exp(tx.mul(tx).mul(-0.45).sub(tz.mul(tz).mul(10)));
    // The lacquer's soft gloss lobe: a tighter sheen of the globe's light right round the foot.
    const sheen = exp(tx.mul(tx).mul(-1.4).sub(tz.mul(tz).mul(40)));
    diffuse.addAssign(VIOLET.mul(pool.mul(0.06)).add(MAGENTA.mul(sheen.mul(0.06))).mul(charge));
    // What the lacquer reflects it does not scatter: at the horizon it is all mirror.
    return { diffuse: diffuse.mul(float(1).sub(reflect).mul(1.6).min(1)), reflect };
}

/**
 * The base: a flared black cone under a collar ring. Its gloss mirrors the globe's light in the
 * upper flare; a studio streak runs down its front and a blue rim lines its edges.
 */
function paintBase(gb, pxg, glow, K) {
    const {
        MAGENTA, VIOLET, HOT, BLUE,
    } = K;
    const { x, y } = gb;
    const edge = pxg.mul(1.5).toVar();
    const f = float(COLLAR).sub(y).div(COLLAR - FOOT_Y).clamp(0, 1)
        .toVar();
    const half = mix(float(RING), float(FOOT), f.mul(f).mul(0.6).add(f.mul(0.4))).toVar();
    const across = x.div(RING);
    const topFront = float(COLLAR).sub(sqrt(float(1).sub(across.mul(across)).max(0)).mul(RING * TILT))
        .toVar();
    const out = x.div(FOOT);
    const footFront = float(FOOT_Y).sub(sqrt(float(1).sub(out.mul(out)).max(0)).mul(FOOT * TILT));
    const body = fadeOut(half.sub(edge), half.add(edge), x.abs())
        .mul(fadeOut(topFront.sub(edge), topFront.add(edge), y))
        .mul(smoothstep(footFront.sub(edge), footFront.add(edge), y))
        .toVar();
    // The ring the glass sits in: inside the collar's outer ellipse, outside the glass.
    const flat = length(vec2(x, y.sub(COLLAR).div(TILT))).toVar();
    const ring = fadeOut(RING * 0.985, RING, flat).mul(smoothstep(HOLE, HOLE * 1.03, flat)).toVar();
    // Black like the rest, but where the glass enters the collar the shell's light gathers in a line.
    // Its back half is seen through the glass's foot, dimmer.
    const lipGlow = flat.sub(HOLE).div(0.02);
    const far = smoothstep(COLLAR - 0.01, COLLAR + 0.03, y).mul(0.65);
    const ringCol = MAGENTA.mul(0.035).add(HOT.mul(exp(lipGlow.mul(lipGlow).negate()).mul(0.35)))
        .mul(float(1).sub(far)).mul(glow);

    const nx = x.div(half).clamp(-1, 1).toVar();
    const facing = sqrt(float(1).sub(nx.mul(nx)).max(0)).toVar();
    const col = vec3(0.0022, 0.0024, 0.005).toVar();
    // The upper flare faces the globe: the black gloss mirrors its light in a band under the collar.
    const band = f.sub(0.12).div(0.1);
    col.addAssign(MAGENTA.mul(exp(band.mul(band).negate()).mul(facing).mul(0.16).mul(glow)));
    col.addAssign(VIOLET.mul(exp(f.mul(-3)).mul(0.03).mul(glow)));
    // A bevel just under the ring catches the light hardest.
    const lip = topFront.sub(y).div(0.018);
    col.addAssign(HOT.mul(exp(lip.mul(lip).negate()).mul(facing).mul(0.25).mul(glow)));
    // The studio window as a narrow streak down the front; the strip lights along the edges.
    const streak = nx.add(0.42);
    col.addAssign(DAYLIGHT.mul(exp(streak.mul(streak).mul(-160)).mul(fadeOut(0.8, 1.0, f)).mul(0.06)));
    const right = smoothstep(0.55, 0.95, nx);
    const left = smoothstep(0.6, 0.95, nx.negate());
    col.addAssign(BLUE.mul(right.mul(right).mul(0.12)).add(MAGENTA.mul(left.mul(left).mul(0.05))));
    // A machined groove, and the foot a little darker where it meets the table.
    const groove = f.sub(0.58).div(0.012);
    col.mulAssign(float(1).sub(exp(groove.mul(groove).negate()).mul(0.6)));
    col.mulAssign(fadeOut(0.82, 1.0, f).mul(0.5).add(0.5));
    return {
        col, body, ring, ringCol,
    };
}

/** A reflected ray's coordinates on a studio panel's face, and how squarely it faces the panel. */
function onPanel(ray, light) {
    const facing = ray.dot(light.w).toVar();
    const lean = facing.max(0.05);
    return { a: ray.dot(light.across).div(lean), b: ray.dot(light.up).div(lean), facing };
}

/**
 * The studio the glass reflects, by reflected direction (an orthographic view down -z): a tall
 * window up and to the left with glazing bars, two strip lights behind the globe that draw thin
 * crescents along its rim, and the table below glowing faintly violet.
 */
function studio(n, nz, charge, K) {
    const { MAGENTA, VIOLET } = K;
    const ray = vec3(n.x.mul(nz).mul(2), n.y.mul(nz).mul(2), nz.mul(nz).mul(2).sub(1)).toVar();
    const win = onPanel(ray, WINDOW);
    const wa = win.a.toVar();
    const wb = win.b.toVar();
    const pane = fadeOut(0.22, 0.38, wa.abs()).mul(fadeOut(0.3, 0.5, wb.abs())).mul(smoothstep(0.2, 0.4, win.facing));
    const bars = float(1).sub(exp(wa.mul(wa).mul(-5000)).mul(0.6))
        .mul(float(1).sub(exp(wb.sub(0.08).mul(wb.sub(0.08)).mul(-5000)).mul(0.6)));
    // Daylight is brighter toward the window's top and fades toward its sill.
    const window = pane.mul(bars).mul(smoothstep(-0.48, 0.4, wb).mul(0.7).add(0.3));
    const right = onPanel(ray, STRIP_RIGHT);
    const strip = fadeOut(0.07, 0.14, right.a.abs()).mul(fadeOut(0.6, 0.85, right.b.abs()))
        .mul(smoothstep(0.2, 0.4, right.facing));
    const left = onPanel(ray, STRIP_LEFT);
    const kicker = fadeOut(0.05, 0.1, left.a.abs()).mul(fadeOut(0.35, 0.55, left.b.abs()))
        .mul(smoothstep(0.2, 0.4, left.facing));
    const below = smoothstep(0.2, 0.7, ray.y.negate());
    return DAYLIGHT.mul(window.mul(4.2)).add(vec3(0.5, 0.64, 1.0).mul(strip.mul(4.5))).add(MAGENTA.mul(kicker.mul(2)))
        .add(VIOLET.mul(below.mul(0.08).mul(charge)));
}

/** The electrode: a frosted ball glowing white-hot at its heart, and the lit gas its filaments root in. */
function paintElectrode(ctx) {
    const {
        u, gq, rq, pxg, light, glow, blur, K,
    } = ctx;
    const {
        MAGENTA, VIOLET, HOT,
    } = K;
    const er = rq.div(ELECTRODE).toVar();
    const enz = sqrt(float(1).sub(er.mul(er)).max(0));
    const soft = pxg.mul(1.5 / ELECTRODE).mul(blur.mul(4).add(1));
    const ball = fadeOut(float(0.985).sub(soft), float(1), er);
    const mottle = gnoise(gq.mul(11).add(vec2(u.time.mul(0.07), 4.2)));
    // Hot at the heart, cooler toward the limb, with a bright rim where the glass ball turns away.
    const limb = float(1).sub(er).div(0.09);
    const surface = mix(MAGENTA.mul(0.4), HOT.mul(1.2), enz.mul(enz)).mul(mottle.mul(0.9).add(0.55))
        .add(HOT.mul(exp(limb.mul(limb).negate()).mul(0.4)));
    // The studio window caught on the ball: the one cue that it is round, not a flat disc.
    const glint = gq.div(ELECTRODE).sub(vec2(-0.42, 0.45));
    const spec = DAYLIGHT.mul(exp(glint.dot(glint).mul(-40)).mul(0.5));
    // The lit gas round it, painted (the lightest tier has no bloom to supply it).
    const shell = rq.sub(ELECTRODE).div(0.026);
    const halo = rq.sub(ELECTRODE).max(0).div(0.09);
    const corona = MAGENTA.mul(exp(shell.mul(shell).negate()).mul(0.6))
        .add(MAGENTA.mul(exp(halo.mul(halo).negate()).mul(0.2)))
        .add(VIOLET.mul(exp(rq.mul(rq).mul(-14)).mul(0.1)));
    light.addAssign(surface.add(spec).mul(ball).add(corona).mul(glow));
}

/**
 * One filament and its forks, in its own frame: `along` out from the electrode, `across` to the
 * side. The thread is the graph of a slowly morphing noise along its length; forks split off at a
 * hashed point and curve away; every branch that reaches the glass blooms there. The main branch's
 * contact is offered to the fern (only the nearest contact gets one: the fern costs noise).
 * `rows` are this filament's four rows of layout data (see filamentData).
 */
function paintFilament(rows, forks, ctx) {
    const {
        u, gq, rq, light, reach, flow, coreWidth, minWidth, glowK, tailK, contact, charge, sharp, K,
    } = ctx;
    const {
        HOT, PINK_GLOW, BLUE_GLOW, PINK_HAZE, BLUE_HAZE, TIP,
    } = K;
    const shape = rows[0].toVar();
    const motion = rows[1].toVar();
    const build = rows[2].toVar();
    const branch = rows[3].toVar();
    const seed = shape.w;
    const phase = motion.y;
    const gain = motion.z;
    const focus = motion.w;
    const twist = branch.y;
    const side = build.w;
    const t = u.time;
    // The bearing wanders slowly: filaments drift round the electrode like smoke.
    const bearing = shape.x.add(sin(t.mul(motion.x).add(phase)).mul(0.3))
        .add(sin(t.mul(motion.x.mul(2.6)).add(phase.mul(1.9))).mul(0.08)).toVar();
    const c = cos(bearing).toVar();
    const s = sin(bearing).toVar();
    const along = gq.x.mul(c).add(gq.y.mul(s)).toVar();
    const across = gq.y.mul(c).sub(gq.x.mul(s)).toVar();
    // How far out this pixel is along the filament's own (3D) radius: 1 at the glass.
    const k = along.div(shape.y).toVar();
    const kc = k.clamp(0, 1).toVar();
    // Free to wander soon after leaving the electrode, so even the empty-lung stubs curl.
    const loose = smoothstep(ELECTRODE, ELECTRODE + 0.3, kc);
    const wander = gnoise(vec2(kc.mul(2.2).add(seed), flow.add(seed.mul(0.61)))).sub(0.5).mul(0.5)
        .add(sin(kc.mul(twist).add(t.mul(0.45)).add(phase)).mul(0.013))
        .add(sin(kc.mul(twist.mul(2.3)).sub(t.mul(0.33)).add(phase.mul(2.3))).mul(0.004))
        .mul(loose)
        .toVar();
    // Each reaches at its own pace (they don't all arrive together), and never past the glass.
    const raw = reach.mul(build.y).add(sin(t.mul(0.37).add(phase)).mul(0.012)).toVar();
    const tip = raw.min(1).toVar();
    // The contact blooms in over the last stretch of the reach (about a second: never a flash).
    const touch = smoothstep(0.86, 1.06, raw).mul(gain).toVar();
    // Offset from the contact point along the glass, undoing the foreshortening.
    const cu = along.sub(shape.y).div(shape.z).toVar();
    const cu2 = cu.mul(cu).toVar();
    const out = vec3(0).toVar();
    // Charge travels outward along the thread in slow swells (quicker while the lungs fill): about
    // four seconds from bright to dim at any point, so the plasma lives without ever flickering.
    const swell = sin(k.mul(8).sub(flow.mul(14)).add(phase)).mul(0.15).add(1).toVar();
    // Pink-white at the root, cooling toward blue-violet where it reaches the glass.
    const glowTint = mix(mix(PINK_GLOW, BLUE_GLOW, branch.w), TIP, kc.mul(kc).mul(0.55)).toVar();
    const hazeTint = mix(PINK_HAZE, BLUE_HAZE, branch.w).toVar();
    // Behind the electrode the lens's narrow focus softens the threads (focus > 1 there).
    const coreScale = coreWidth.mul(build.x).mul(focus).mul(float(1.3).sub(kc.mul(0.5))).toVar();
    const glowFocus = glowK.div(focus).toVar();
    // Some filaments carry more of the current; those behind the electrode shine through more gas.
    const current = gain.mul(0.6).add(0.4).mul(swell).toVar();

    const thread = (lateral, from, scale, weight, rootBoost = 0) => {
        const d = across.sub(lateral).toVar();
        const d2 = d.mul(d).toVar();
        // A thread finer than a pixel is drawn a pixel wide and dimmed to match (no dotted lines).
        const fine = coreScale.mul(scale).toVar();
        const w = max(fine, minWidth).toVar();
        const start = float(from);
        const span = smoothstep(start, start.add(0.04), k).mul(fadeOut(tip.sub(0.14), tip, k));
        const aura = smoothstep(start, start.add(0.06), k).mul(fadeOut(tip.sub(0.05), tip.add(0.04), k));
        let core = exp(d2.div(w.mul(w)).negate()).mul(span).mul(fine.div(w)).mul(sharp);
        if (rootBoost) {
            const root = k.sub(ELECTRODE).mul(7);
            core = core.mul(exp(root.mul(root).negate()).mul(rootBoost).add(1));
        }
        const glow = exp(d2.mul(glowFocus).negate()).mul(aura);
        const tail = float(1).div(d2.mul(tailK).add(1)).mul(aura);
        out.addAssign(HOT.mul(core.mul(2.2)).add(glowTint.mul(glow.mul(0.45))).add(hazeTint.mul(tail.mul(0.012)))
            .mul(current.mul(weight)));
        // Where it meets the glass: a hot spot and a soft bloom, flattened as the glass turns away.
        const rho2 = cu2.add(d2).toVar();
        out.addAssign(HOT.mul(exp(rho2.mul(-1400)).mul(2.4)).add(glowTint.mul(exp(rho2.mul(-110)).mul(0.4)))
            .mul(touch.mul(weight)));
        return rho2;
    };

    const rho2 = thread(wander, ELECTRODE - 0.03, 1, 1, 0.9);
    // Offer this contact to the fern if it is the nearest so far.
    const closer = rho2.lessThan(contact.d);
    contact.at.assign(select(closer, vec2(cu, across.sub(wander)), contact.at));
    contact.gain.assign(select(closer, touch, contact.gain));
    contact.seed.assign(select(closer, seed, contact.seed));
    contact.d.assign(min(contact.d, rho2));

    // Forks split off and curve away; each starts tangent to its parent so the branching reads.
    const jitter = (kk, rate, offset) => sin(k.mul(twist.mul(kk)).add(t.mul(rate)).add(phase.mul(offset)));
    const spread = branch.x.mul(side).toVar();
    const forkAt = build.z.toVar();
    const da = k.sub(forkAt).max(0).toVar();
    const forkA = wander.add(da.mul(smoothstep(0, 0.2, da)).mul(spread))
        .add(jitter(1.7, 0.5, 3.1).mul(da).mul(0.05)).toVar();
    thread(forkA, forkAt, 0.72, 0.62);
    const forkBAt = forkAt.add(0.12).toVar();
    const db = k.sub(forkBAt).max(0).toVar();
    const forkB = wander.sub(db.mul(smoothstep(0, 0.18, db)).mul(spread.mul(0.85)))
        .add(jitter(2.1, -0.42, 1.3).mul(db).mul(0.05));
    thread(forkB, forkBAt, 0.62, 0.5);
    if (forks > 2) {
        const forkCAt = forkAt.add(0.22).toVar();
        const dc = k.sub(forkCAt).max(0).toVar();
        const forkC = forkA.add(dc.mul(smoothstep(0, 0.14, dc)).mul(side.mul(0.26)))
            .add(jitter(2.9, 0.6, 0.7).mul(dc).mul(0.04));
        thread(forkC, forkCAt, 0.5, 0.38);
    }
    // Filaments aimed away from the lens pass behind the electrode.
    const shown = mix(smoothstep(ELECTRODE * 0.9, ELECTRODE * 1.12, rq), float(1), branch.z);
    light.addAssign(out.mul(shown).mul(charge));
}

/**
 * The fern: where the nearest filament touches the glass, the discharge spreads over the inner
 * surface in fine branching veins. Veins are the zero crossings of a noise sampled by direction
 * from the contact (no angle seam) and pushed along as the radius grows, so they wander and split.
 */
function paintFern(ctx) {
    const {
        u, contact, light, charge, K,
    } = ctx;
    const { MAGENTA, HOT } = K;
    const o = contact.at;
    const rho = length(o).toVar();
    const dir = o.div(rho.max(1e-4)).toVar();
    const t = u.time;
    const n1 = gnoise(dir.mul(1.3).add(vec2(contact.seed, rho.mul(7).sub(t.mul(0.05)))));
    const n2 = gnoise(dir.mul(2.9).add(vec2(contact.seed.add(7.7), rho.mul(14).add(t.mul(0.04)))));
    const vein = (n) => {
        const v = float(1).sub(n.sub(0.5).abs().mul(2)).max(0).toVar();
        const v2 = v.mul(v);
        const v4 = v2.mul(v2);
        return v4.mul(v4).mul(v2);
    };
    const lines = vein(n1).add(vein(n2).mul(0.3)).toVar();
    // The fern spreads further as the contact settles in.
    const size = contact.gain.mul(0.06).add(0.045).toVar();
    const spread = exp(rho.mul(rho).div(size.mul(size)).negate()).mul(smoothstep(0.006, 0.035, rho));
    light.addAssign(mix(MAGENTA, HOT, lines.mul(0.6)).mul(lines.mul(spread).mul(contact.gain).mul(1.3).mul(charge)));
}

/**
 * The glass itself: the studio reflected with Schlick's Fresnel (stronger in the smudges), the
 * shell's thickness seen edge-on at the silhouette, the discharge's light gathered near the rim,
 * and dust specks lit by whatever shines near them.
 */
function paintGlass(ctx) {
    const {
        gq, rq, nz, F, pxg, blur, light, charge, K,
    } = ctx;
    const { BLUE, VIOLET } = K;
    const env = studio(gq, nz, charge, K).toVar();
    const smudge = smoothstep(0.5, 0.78, fbm(gq.mul(2.8).add(vec2(7.1, 2.3)), 2)).toVar();
    const shine = env.mul(F).toVar();
    const surface = shine.mul(smudge.mul(0.9).add(0.7)).toVar();
    // Smudges scatter a little of the discharge's light across the glass.
    surface.addAssign(light.mul(smudge).mul(0.05));
    const w = max(float(0.0065), pxg.mul(1.4)).mul(blur.mul(2).add(1));
    const outer = float(1).sub(rq).div(w);
    const inner = float(0.966).sub(rq).div(w);
    surface.addAssign(mix(BLUE, DAYLIGHT, 0.5).mul(exp(outer.mul(outer).negate()).mul(0.4))
        .add(VIOLET.mul(exp(inner.mul(inner).negate()).mul(0.12))));
    const shell = float(1).sub(rq).div(0.05);
    surface.addAssign(VIOLET.mul(exp(shell.mul(shell).negate()).mul(0.05).mul(charge)));
    const dq = gq.mul(36).toVar();
    const cell = floor(dq).toVar();
    const spot = hash22(cell.add(1.7)).mul(0.8).add(0.1);
    const dd = length(fract(dq).sub(spot)).div(36);
    const size = max(float(0.0026), pxg.mul(0.9));
    const speck = exp(dd.mul(dd).div(size.mul(size)).negate()).mul(step(0.9, hash21(cell.add(5.3))));
    surface.addAssign(speck.mul(shine.mul(2).add(light.mul(0.12)).add(0.006)));
    return surface;
}

/**
 * A fingertip on the glass: now and then one filament reaches slowly out to a single spot on the
 * front of the globe, as if someone had laid a finger there. It thickens and holds on for a few
 * seconds, the spot glowing in a soft pad with a fern of discharge round it, while the other
 * filaments give up a little of their light; then it lets go and withdraws. Every change ramps over
 * a second or more.
 */
function paintTouch(ctx, ev, on) {
    const {
        gq, light, coreWidth, minWidth, glowK, tailK, contact, flow, K,
    } = ctx;
    const {
        HOT, PINK_GLOW, BLUE_GLOW, PINK_HAZE,
    } = K;
    const id = ev.z;
    // Anywhere on the glass's front face but low down, where the base would hide it.
    const bearing = id.mul(Math.PI * 1.5).sub(Math.PI * 0.25).toVar();
    const dir = vec2(cos(bearing), sin(bearing)).toVar();
    const rho = mix(float(0.45), float(0.76), hash21(vec2(id, 3.3))).toVar();
    const across = gq.y.mul(dir.x).sub(gq.x.mul(dir.y)).toVar();
    const k = gq.dot(dir).div(rho).toVar();
    const kc = k.clamp(0, 1);
    // It reaches out slowly, holds on, then lets go and withdraws.
    const tip = smoothstep(0.0, 0.3, ev.y).mul(fadeOut(0.74, 1.0, ev.y)).mul(1 - ELECTRODE).add(ELECTRODE)
        .toVar();
    // Pinned at the electrode and at the fingertip, free to wander between.
    const wander = gnoise(vec2(kc.mul(2.6).add(id.mul(13)), flow.mul(1.4).add(id.mul(5)))).sub(0.5).mul(0.16)
        .mul(sin(kc.mul(Math.PI)));
    const d = across.sub(wander);
    const d2 = d.mul(d).toVar();
    const fine = coreWidth.mul(1.6).toVar();
    const w = max(fine, minWidth);
    const span = smoothstep(ELECTRODE - 0.02, ELECTRODE + 0.03, k).mul(fadeOut(tip.sub(0.08), tip.add(0.005), k))
        .toVar();
    const core = exp(d2.div(w.mul(w)).negate()).mul(span).mul(fine.div(w));
    const glowT = exp(d2.mul(glowK).mul(0.5).negate()).mul(span);
    const tail = float(1).div(d2.mul(tailK).mul(0.6).add(1)).mul(span);
    const tint = mix(PINK_GLOW, BLUE_GLOW, 0.35).toVar();
    light.addAssign(HOT.mul(core.mul(2.4)).add(tint.mul(glowT.mul(0.7))).add(PINK_HAZE.mul(tail.mul(0.025))).mul(on));
    // The fingertip: a pad of light where the thread holds the glass, foreshortened as the glass turns.
    const stick = smoothstep(0.24, 0.38, ev.y).mul(fadeOut(0.68, 0.8, ev.y)).mul(on).toVar();
    const nzT = sqrt(float(1).sub(rho.mul(rho))).max(0.3);
    const ou = gq.dot(dir).sub(rho).div(nzT).toVar();
    const rr2 = ou.mul(ou).add(across.mul(across)).toVar();
    const pad = exp(rr2.div(0.0055).negate());
    const ring = rr2.sqrt().sub(0.07).div(0.013);
    light.addAssign(HOT.mul(exp(rr2.mul(-1600)).mul(2.2))
        .add(tint.mul(pad.mul(0.5).add(exp(ring.mul(ring).negate()).mul(0.28))))
        .mul(stick));
    // The fern spreads over the glass round the fingertip.
    const closer = rr2.lessThan(contact.d).and(stick.greaterThan(0.01));
    contact.at.assign(select(closer, vec2(ou, across), contact.at));
    contact.gain.assign(select(closer, stick, contact.gain));
    contact.seed.assign(select(closer, id.mul(50), contact.seed));
    contact.d.assign(select(closer, rr2, contact.d));
}

/** A spark of static: a speck of light that leaves the top of the glass and drifts up, fading. */
function paintSpark(g, ev, pxg, K) {
    const id = ev.z;
    const t = ev.y;
    // It leaves the glass's upper flank, left or right, and climbs a little way.
    const side = hash21(vec2(id, 1.9)).sub(0.5).sign();
    const a = float(Math.PI / 2).add(side.mul(mix(float(0.45), float(1.1), hash21(vec2(id, 2.6)))));
    const start = vec2(cos(a), sin(a)).mul(1.02);
    const pos = start.add(vec2(
        sin(t.mul(6).add(id.mul(30))).mul(0.025).add(cos(a).mul(0.12).mul(t)),
        t.mul(0.3),
    ));
    const o = g.sub(pos);
    const d2 = o.dot(o).toVar();
    const w = pxg.mul(1.4).add(0.004);
    const glint = exp(d2.div(w.mul(w)).negate()).mul(2).add(exp(d2.mul(-900)).mul(0.14));
    const fade = smoothstep(0, 0.08, t).mul(fadeOut(0.35, 1, t));
    return mix(K.HOT, K.PINK_GLOW, 0.3).mul(glint).mul(fade);
}

/**
 * The versions of this world a visit can show (stage/breath-moods.js); the first is the poster's.
 * Colours are linear RGB (see paletteOf). `bokeh` the room's distant lights; `window` swaps them
 * for a rainy window onto a city; `neon` hangs two signs on the far wall; `smoke` how much the
 * hanging smoke shows and how fast it moves; `lacquer` the table's own colour; `dust` the motes';
 * `touch`/`spark` the rare events (period s, chance per period).
 */
const VIOLET_COLORS = {
    hot: [1.0, 0.82, 1.0],
    magenta: [0.78, 0.26, 1.0],
    violet: [0.46, 0.28, 1.0],
    blue: [0.22, 0.36, 1.0],
    night: [0.0026, 0.003, 0.0068],
    pinkGlow: [1.0, 0.2, 0.78],
    blueGlow: [0.38, 0.26, 1.0],
    pinkHaze: [0.5, 0.22, 1.0],
    blueHaze: [0.2, 0.3, 1.0],
    tip: [0.32, 0.34, 1.0],
};
const VIOLET_GRADE = {
    shadows: [0.94, 0.94, 1.06], highlights: [1.04, 0.96, 1.04], saturation: 1.05, contrast: 1.06, vignette: 0.5,
};
export const MOODS = Object.freeze([
    {
        id: 'violet-studio',
        name: 'Violet Studio',
        colors: VIOLET_COLORS,
        bokeh: { tints: [[0.26, 0.4, 1.0], [0.5, 0.36, 1.0], [0.36, 0.3, 0.95], [0.3, 0.58, 1.0]], gain: 1 },
        window: false,
        smoke: { gain: 1, speed: 1 },
        lacquer: [0.0024, 0.0022, 0.0052],
        dust: [[0.72, 0.56, 1.0], [0.46, 0.56, 1.0]],
        shaftTint: [0.85, 0.7, 1.0],
        grade: VIOLET_GRADE,
        touch: { period: 30, chance: 0.6 },
        spark: { period: 15, chance: 0.55 },
    },
    {
        id: 'rainy-window',
        name: 'Rain on the Window',
        colors: {
            ...VIOLET_COLORS,
            magenta: [0.62, 0.3, 1.0],
            pinkGlow: [0.85, 0.3, 1.0],
            blueGlow: [0.3, 0.38, 1.0],
            tip: [0.3, 0.45, 1.0],
        },
        bokeh: { tints: [], gain: 0 },
        window: true,
        smoke: { gain: 0.6, speed: 1 },
        lacquer: [0.002, 0.002, 0.0035],
        dust: [[0.7, 0.62, 1.0], [0.5, 0.6, 1.0]],
        shaftTint: [0.8, 0.75, 1.0],
        grade: {
            shadows: [0.96, 0.95, 1.05], highlights: [1.04, 0.98, 1.0], saturation: 1.05, contrast: 1.06, vignette: 0.5,
        },
        touch: { period: 30, chance: 0.6 },
        spark: { period: 18, chance: 0.5 },
    },
    {
        id: 'teal-smoke',
        name: 'Teal Smoke',
        colors: {
            hot: [0.82, 1.0, 0.98],
            magenta: [0.2, 0.85, 0.95],
            violet: [0.12, 0.6, 0.9],
            blue: [0.1, 0.5, 0.8],
            night: [0.0018, 0.0036, 0.0046],
            pinkGlow: [0.25, 1.0, 0.9],
            blueGlow: [0.15, 0.55, 1.0],
            pinkHaze: [0.15, 0.75, 0.9],
            blueHaze: [0.12, 0.4, 1.0],
            tip: [0.2, 0.55, 1.0],
        },
        bokeh: { tints: [[0.2, 0.75, 0.85], [0.25, 0.5, 1.0], [1.0, 0.6, 0.3], [0.3, 0.85, 0.7]], gain: 0.9 },
        window: false,
        smoke: { gain: 2.4, speed: 1.6 },
        lacquer: [0.0018, 0.0032, 0.0036],
        dust: [[0.5, 0.95, 1.0], [0.4, 0.7, 1.0]],
        shaftTint: [0.7, 1.0, 1.0],
        grade: {
            shadows: [0.94, 1.0, 1.04], highlights: [1.0, 1.02, 1.0], saturation: 1.05, contrast: 1.06, vignette: 0.5,
        },
        touch: { period: 30, chance: 0.6 },
        spark: { period: 15, chance: 0.55 },
    },
    {
        id: 'amber-neon',
        name: 'Amber Neon',
        colors: {
            hot: [1.0, 0.9, 0.8],
            magenta: [1.0, 0.32, 0.55],
            violet: [1.0, 0.42, 0.22],
            blue: [0.7, 0.25, 0.35],
            night: [0.0052, 0.003, 0.0034],
            pinkGlow: [1.0, 0.22, 0.62],
            blueGlow: [1.0, 0.52, 0.14],
            pinkHaze: [1.0, 0.3, 0.45],
            blueHaze: [1.0, 0.45, 0.15],
            tip: [1.0, 0.3, 0.3],
        },
        bokeh: { tints: [[1.0, 0.3, 0.6], [1.0, 0.6, 0.2], [0.2, 0.8, 0.8], [1.0, 0.85, 0.6]], gain: 1.4 },
        window: false,
        neon: true,
        smoke: { gain: 1.5, speed: 1 },
        lacquer: [0.0045, 0.0026, 0.002],
        dust: [[1.0, 0.7, 0.45], [1.0, 0.45, 0.6]],
        shaftTint: [1.0, 0.75, 0.6],
        grade: {
            shadows: [1.02, 0.95, 0.96],
            highlights: [1.04, 0.98, 0.94],
            saturation: 1.05,
            contrast: 1.06,
            vignette: 0.5,
        },
        touch: { period: 30, chance: 0.6 },
        spark: { period: 15, chance: 0.55 },
    },
]);

export function createStormWorld({ u, quality, mood = MOODS[0] }) {
    const { octaves, detail } = quality;
    const M = mood;
    const K = paletteOf(M);
    // Phones keep eight filaments: fewer and the globe reads as a sparse star.
    const count = Math.max(8, Math.round(14 * detail));
    const filaments = filamentData(filamentLayout(count));
    const forks = detail >= 0.6 ? 3 : 2;
    const bokeh = M.window ? [] : bokehLayout(Math.round(6 + 8 * detail), M.bokeh.tints, M.bokeh.gain);
    const hazeOctaves = Math.max(2, octaves - 2);

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        // As large as the short axis allows: a landscape screen's height, a phone's width.
        const R = mix(float(RADIUS[0]), float(RADIUS[1]), smoothstep(1.2, 2.0, u.ext.y)).toVar();
        const pxg = u.px.div(R).toVar();
        const b = u.breathSoft.toVar();
        const ease = b.mul(b).mul(float(3).sub(b.mul(2))).toVar();
        const charge = b.mul(0.7).add(0.35).toVar();
        const glow = b.mul(0.45).add(0.75).toVar();
        // Empty lungs: short stubs round the core. Full: every filament on the glass.
        const reach = mix(float(0.3), float(1.08), ease).toVar();
        // Breath-paced crawl: the filaments' shapes evolve a little faster while the lungs fill.
        const flow = u.time.mul(0.06).add(u.breathInt.mul(0.05)).toVar();

        const g = layer(p, u, 1).div(R).toVar();
        const r = length(g).toVar();
        // Table pixels fold about the contact line: the globe is painted once, at the folded point.
        const belowG = step(g.y, MIRROR).toVar();
        const gq = vec2(g.x, mix(g.y, float(2 * MIRROR).sub(g.y), belowG)).toVar();
        const rq = length(gq).toVar();
        const sunk = float(MIRROR).sub(g.y).max(0).toVar();
        const blur = sunk.mul(1.5).min(1.8).toVar();
        const nz = sqrt(float(1).sub(rq.mul(rq)).max(0)).toVar();
        const F = fresnel(nz, 0.04).toVar();
        // The base folds about its own front edge.
        const out = g.x.div(FOOT);
        const footFront = float(FOOT_Y).sub(sqrt(float(1).sub(out.mul(out)).max(0)).mul(FOOT * TILT)).toVar();
        const belowB = step(g.y, footFront).toVar();
        const gb = vec2(g.x, mix(g.y, footFront.mul(2).sub(g.y), belowB)).toVar();

        // The room: seen directly, through the glass (a little magnified near the rim), or in the table.
        const refract = p.sub(gq.mul(R).mul(float(1).sub(nz)).mul(0.07)).toVar();
        const behind = mix(p, refract, step(rq, 1)).toVar();
        // The mirror point, taken back through the camera rig: the reflection meets the room exactly.
        const mirrored = vec2(g.x, float(2 * HORIZON).sub(g.y)).mul(R).sub(u.pan).mul(u.zoom)
            .toVar();
        const roomP = mix(behind, mirrored, step(g.y, HORIZON)).toVar();
        const room = paintRoom(roomP, u, {
            bokeh, octaves: hazeOctaves, horizonY: R.mul(HORIZON), K, M,
        });

        // The globe's interior and its glass, only where the (folded) pixel is inside the glass.
        const light = vec3(0).toVar();
        const surface = vec3(0).toVar();
        const contact = {
            at: vec2(9, 9).toVar(), gain: float(0).toVar(), seed: float(0).toVar(), d: float(100).toVar(),
        };
        // In the table's reflection the glow widens and dims: a soft mirror.
        const coreWidth = blur.mul(2.5).add(1).mul(0.0052).toVar();
        const minWidth = pxg.mul(0.9).mul(blur.mul(2.5).add(1)).toVar();
        const glowW = float(0.022).mul(blur.add(1));
        const glowK = float(1).div(glowW.mul(glowW)).toVar();
        const tailW = float(0.07).mul(blur.mul(0.6).add(1));
        const tailK = float(1).div(tailW.mul(tailW)).toVar();
        // Near empty, the stubs round the core are soft tendrils of glow rather than hard pins.
        const sharp = smoothstep(0.3, 0.7, reach).mul(0.65).add(0.35).toVar();
        const widths = {
            coreWidth, minWidth, glowK, tailK,
        };
        const ctx = {
            u, gq, rq, nz, F, pxg, blur, light, charge, glow, reach, flow, contact, sharp, K, ...widths,
        };
        // A fingertip on the glass, now and then (paintTouch); the visit's seed sets the timetable.
        const touchSalt = u.seed.mul(37.1).add(2.3);
        const touchEv = eventWindow(u.time, float(M.touch.period), float(11), float(M.touch.chance), touchSalt)
            .toVar();
        const touchOn = touchEv.x.mul(u.life).toVar();
        If(rq.lessThan(1.02), () => {
            paintElectrode(ctx);
            // Thin luminous gas between the filaments, stirring slowly.
            const wisps = gnoise3(vec3(gq.mul(2.6), u.time.mul(0.05))).toVar();
            light.addAssign(K.VIOLET.mul(wisps.mul(wisps).mul(0.035).mul(float(1).sub(rq.mul(rq)).max(0)).mul(charge)));
            // While a finger holds the glass it draws the current: the others give up a little light.
            const shared = { ...ctx, charge: charge.mul(float(1).sub(touchOn.mul(0.3))).toVar() };
            Loop(count, ({ i }) => {
                paintFilament(filaments.map((row) => row.element(i)), forks, shared);
            });
            If(touchOn.greaterThan(0.001), () => {
                paintTouch(ctx, touchEv, touchOn);
            });
            paintFern(ctx);
            surface.assign(paintGlass(ctx));
        });

        const edge = pxg.mul(1.5).mul(blur.mul(3).add(1)).toVar();
        const hx = gq.x.div(HOLE);
        const holeFront = float(COLLAR).sub(sqrt(float(1).sub(hx.mul(hx)).max(0)).mul(HOLE * TILT));
        const glass = fadeOut(float(1).sub(edge.mul(2)), float(1), rq)
            .mul(smoothstep(holeFront.sub(edge), holeFront.add(edge), gq.y)).toVar();
        const transmit = float(1).sub(F).mul(0.88).toVar();
        const base = paintBase(gb, pxg, glow, K);
        const table = paintTable(g, charge, K, M);
        const globeLight = light.add(surface).toVar();
        const airGlow = (radius) => {
            const away = radius.sub(0.92).max(0);
            return float(1).div(away.mul(away).mul(6).add(1));
        };

        // What the table mirrors: the room, the folded globe and base, fading with distance.
        const glassM = glass.mul(belowG).toVar();
        const image = room.col.mul(float(1).sub(glassM.mul(float(1).sub(transmit))))
            .add(globeLight.mul(glassM).div(blur.mul(1.3).add(1))).toVar();
        image.assign(mix(image, base.col, base.body.mul(belowB)));
        image.addAssign(K.VIOLET.mul(airGlow(rq).mul(0.04).mul(charge).mul(belowG)));
        const tableColor = table.diffuse.add(image.mul(table.reflect).mul(exp(sunk.mul(-0.5))));

        // The scene in front: room or table, then the collar ring, the glass, the base.
        const onTable = fadeOut(HORIZON - 0.004, HORIZON + 0.004, g.y);
        const col = mix(room.col, tableColor, onTable).toVar();
        col.assign(mix(col, base.ringCol, base.ring.mul(float(1).sub(belowB))));
        const glassD = glass.mul(float(1).sub(belowG)).toVar();
        col.assign(col.mul(float(1).sub(glassD.mul(float(1).sub(transmit)))).add(globeLight.mul(glassD)));
        col.assign(mix(col, base.col, base.body.mul(float(1).sub(belowB))));
        // The globe's light in the air between us and it, brightest where the haze is thick.
        const wisp = room.smoke.mul(2.6 * M.smoke.gain).add(0.3);
        col.addAssign(K.VIOLET.mul(airGlow(r).mul(0.03).mul(charge).mul(wisp)
            .mul(float(1).sub(glassD.mul(0.6)))));
        // Now and then a spark of static leaves the top of the glass and drifts up.
        const sparkSalt = u.seed.mul(23.9).add(7.7);
        const sparkEv = eventWindow(u.time, float(M.spark.period), float(5), float(M.spark.chance), sparkSalt)
            .toVar();
        If(sparkEv.x.mul(u.life).greaterThan(0.0005), () => {
            col.addAssign(paintSpark(g, sparkEv, pxg, K).mul(sparkEv.x.mul(40).min(1)).mul(u.life));
        });
        return col;
    })();

    return {
        backdrop,
        motes: [
            {
                // Dust hanging in the light.
                motion: MOTE_MOTION.wander,
                count: 140,
                size: 0.009,
                speed: 0.3,
                spread: 0.92,
                band: [-1.1, 1.2],
                depth: 2.4,
                bokeh: 0.2,
                colorA: M.dust[0],
                colorB: M.dust[1],
                gain: 0.55,
            },
            {
                // Closer to the globe the dust catches its glow: finer, brighter specks.
                motion: MOTE_MOTION.wander,
                count: 60,
                size: 0.0055,
                speed: 0.22,
                spread: 0.5,
                band: [-0.55, 0.8],
                depth: 1.4,
                bokeh: 0.05,
                colorA: M.dust[0],
                colorB: [1.0, 0.95, 1.0],
                gain: 1.0,
            },
        ],
        bloom: {
            strength: 0.3, radius: 0.5, threshold: 0.9, breath: 0.6,
        },
        shafts: {
            source: [0, 0, 1],
            radius: 0.22,
            strength: 0.2,
            threshold: 1.6,
            decay: 0.95,
            length: 0.4,
            tint: M.shaftTint,
            breath: 0.75,
        },
        grade: M.grade,
        camera: { dolly: 0.04, drift: [0.025, 0.012], period: 60 },
        exposure: 1.0,
    };
}
