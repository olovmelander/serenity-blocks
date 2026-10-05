/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Solar Flare — a colossal living star, seen close.
 * Inhale: the corona streams out, the prominences climb and brighten, the surface runs hotter.
 * Exhale: the corona draws back in and the loops settle onto the limb.
 *
 * The photosphere is a real rotating ball: each point of the disc becomes a normal
 * (x, y, sqrt(1 - r²)), turned into the star's own frame (a tipped axis and a slow spin) and
 * textured there. Granulation, sunspot groups and faculae therefore ride across the disc and
 * foreshorten into the limb with no seam, and limb darkening cools the edge to deep orange.
 * Over the spot groups stand coronal loops (true 3D arcs that turn with the star) and, on each
 * in-breath, twin flare ribbons. Above the limb: a chromosphere fringed with spicules,
 * prominences painted as loops of twisting plasma threads anchored at the limb (one of them
 * slowly erupts and drifts off), a hedgerow curtain, coronal streamers combed into fine rays that
 * narrow as they climb, glints of solar wind streaming out on a nearer layer, and a soft glow over
 * deep space. A small planet crosses the disc every few minutes, a black dot for scale.
 */
import {
    Fn, If, cos, dot, exp, float, floor, fract, length, log, min, mix, select, sin, smoothstep, sqrt, step, vec2,
    vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, gnoise, gnoise3, hash21, hash33, layer, starfield, turn,
} from '../stage/breath-tsl.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** One turn of the star takes this long (seconds): features drift across the disc, never spin. */
const ROTATION_PERIOD = 420;
/** The spin axis tips toward the viewer and leans a little (radians), so the star reads as a ball. */
const AXIS_TIP = 0.3;
const AXIS_LEAN = -0.22;
/** Granules per star radius at disc centre. */
const GRANULES = 44;
/** The planet in transit: radius (hero units), parallax depth, seconds to cross the screen. */
const PLANET = { radius: 0.016, k: 1.12, period: 240 };

const SPACE = vec3(0.0032, 0.0012, 0.0018);
const NEBULA = vec3(0.03, 0.006, 0.012);
const CHROMOSPHERE = vec3(1.0, 0.3, 0.12);
const INNER_CORONA = vec3(1.0, 0.64, 0.32);
const GLARE = vec3(1.0, 0.42, 0.14);
const LOOP_LIGHT = vec3(1.0, 0.78, 0.5);
const FLARE = vec3(1.0, 0.85, 0.6);

/** T = Rz(lean) · Rx(tip): the star's frame as the viewer sees it (row-major). */
const T = (() => {
    const ca = Math.cos(AXIS_TIP);
    const sa = Math.sin(AXIS_TIP);
    const cb = Math.cos(AXIS_LEAN);
    const sb = Math.sin(AXIS_LEAN);
    return [[cb, -sb * ca, sb * sa], [sb, cb * ca, -cb * sa], [0, sa, ca]];
})();
/** The equator's direction on screen: the big helmet streamers favour it. */
const EQUATOR = [Math.cos(AXIS_LEAN), Math.sin(AXIS_LEAN)];

/** A point on the star (latitude, longitude in degrees) with its east and north directions. */
function surfaceFrame(latDeg, lonDeg) {
    const lat = latDeg * DEG;
    const lon = lonDeg * DEG;
    return {
        c: [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)],
        east: [Math.cos(lon), 0, -Math.sin(lon)],
        north: [-Math.sin(lat) * Math.sin(lon), Math.cos(lat), -Math.sin(lat) * Math.cos(lon)],
    };
}

/**
 * Sunspot groups in the active belts: a big leading spot, a following one and a few pores.
 * Offsets are degrees of arc from the group's centre (lat, lon); radius is in star radii.
 * Spots keep clear of each other so each penumbra belongs to one spot.
 */
const SPOT_GROUPS = [
    {
        lat: 15,
        lon: -26,
        spots: [[0, 5, 0.1], [2, -6, 0.066], [-3.5, -1, 0.018], [3.5, -0.5, 0.015], [0.5, -2, 0.013]],
    },
    { lat: -12, lon: 38, spots: [[0, 4, 0.085], [-2, -5, 0.055], [2.5, -1, 0.016]] },
    { lat: 21, lon: 150, spots: [[0, 4, 0.11], [3, -8, 0.07]] },
    { lat: -19, lon: -116, spots: [[0, 3, 0.08], [-1, -5, 0.052], [3.5, -1, 0.015]] },
];
const SPOTS = SPOT_GROUPS.flatMap((group, g) => group.spots.map(([dLat, dLon, radius], s) => ({
    ...surfaceFrame(group.lat + dLat, group.lon + dLon / Math.cos(group.lat * DEG)),
    radius,
    seed: g * 7.31 + s * 1.93,
})));

/**
 * Coronal loops over each spot group, rooted around its two poles (the leading and following
 * spots), in the star's frame. A point on a loop is m + e·cos(t) + lift·sin(t) for t in 0..π.
 */
const ARCADES = SPOT_GROUPS.map((group) => {
    const pole = ([dLat, dLon]) => surfaceFrame(group.lat + dLat, group.lon + dLon / Math.cos(group.lat * DEG)).c;
    const a = pole(group.spots[0]);
    const b = pole(group.spots[1]);
    const m = a.map((v, i) => (v + b[i]) / 2);
    const e = a.map((v, i) => (b[i] - v) / 2);
    const size = Math.hypot(...m);
    const n = m.map((v) => v / size);
    const cross = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
    const side = cross.map((v) => v / Math.hypot(...cross));
    // Loops lean to either side, so even seen from straight above they part into arcs.
    const loops = [[0.05, 0.003, 1.0, 0.9], [0.075, -0.004, 1.2, -0.6], [0.1, 0.0, 1.4, 0.25]].map(
        ([height, shift, stretch, lean]) => ({
            m: m.map((v, k) => v + side[k] * shift),
            e: e.map((v) => v * stretch),
            lift: n.map((v, k) => (v + side[k] * lean) * height),
        }),
    );
    return {
        centre: n,
        // The polarity line between the two poles: flare ribbons run along it.
        middle: m,
        axis: e.map((v) => v / Math.hypot(...e)),
        side,
        loops,
        // Every loop of the group lies within this distance of its middle (star units).
        reach: Math.max(...loops.map((loop) => Math.hypot(...loop.e) + Math.hypot(...loop.lift))) + 0.03,
    };
});
/** Solar wind: angular cells around the star (an integer, so the atan seam is a cell wall), parallax depth. */
const WIND = { cells: 96, k: 1.35 };

/**
 * Prominence loops anchored at the limb: angle (degrees, 0 = right, 90 = up), half-span and
 * height (star radii), lean (degrees), tube width (star radii), seed, brightness. `core` loops stay on the
 * lightest tier. The diagonals fit both landscape and portrait; the side and bottom ones fill
 * whichever room the screen has.
 */
const LOOPS = [
    // The hero complex, upper right: a great arch with a smaller one nested at its foot.
    {
        angle: 38, span: 0.17, height: 0.42, lean: 12, width: 0.06, seed: 1.3, gain: 1.15, core: true,
    },
    {
        angle: 27, span: 0.085, height: 0.17, lean: -8, width: 0.034, seed: 6.2, gain: 0.8,
    },
    // A tall twisted loop, lower right.
    {
        angle: -28, span: 0.14, height: 0.36, lean: -22, width: 0.054, seed: 4.7, gain: 1.0, core: true,
    },
    // The quieter left: one low arch beside the hedgerow.
    {
        angle: 192, span: 0.09, height: 0.15, lean: 10, width: 0.034, seed: 2.9, gain: 0.7, core: true,
    },
    // At the bottom (it fills a portrait screen).
    {
        angle: 284, span: 0.1, height: 0.2, lean: 16, width: 0.04, seed: 5.6, gain: 0.85,
    },
];
/**
 * A loop that slowly lifts off, lets go of the limb and fades into the corona, then forms again.
 * Upper left, where both landscape and portrait leave it room to climb.
 */
const ERUPTION = {
    angle: 126, span: 0.12, height: 0.2, lean: 10, width: 0.042, seed: 3.3, gain: 1.0, period: 46, offset: 0.35,
};
/** A quiescent hedgerow prominence: a curtain of fine vertical threads along the limb. */
const HEDGEROW = { angle: 160, span: 0.2, height: 0.12 };

/** x² of a noise that may dip a hair below zero, without pow(). */
const square = (x) => {
    const c = x.max(0).toVar();
    return c.mul(c);
};

/**
 * 3D cellular noise: (F1, F2, cell id). F2 - F1 is ~0 on a cell wall: the dark lanes between
 * granules. `t` swings each seed around its slot so the cells boil in place.
 */
const voronoi3 = /* @__PURE__ */ Fn(([p, t]) => {
    const n = floor(p).toVar();
    const f = fract(p).toVar();
    const f1 = float(8).toVar();
    const f2 = float(8).toVar();
    const id = float(0).toVar();
    for (let k = -1; k <= 1; k++) {
        for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
                const seed = hash33(n.add(vec3(i, j, k))).toVar();
                const offset = sin(seed.mul(TAU).add(t)).mul(0.36).add(0.5);
                const r = vec3(i, j, k).add(offset).sub(f);
                const d = dot(r, r).toVar();
                const closer = d.lessThan(f1);
                f2.assign(select(closer, f1, min(f2, d)));
                id.assign(select(closer, seed.z, id));
                f1.assign(min(f1, d));
            }
        }
    }
    return vec3(sqrt(f1), sqrt(f2), id);
}).setLayout({
    name: 'solar_voronoi3', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }, { name: 't', type: 'float' }],
});

/** The photosphere's colour by heat 0..1: deep red at the limb, through orange, to pale gold. */
function sunTint(heat) {
    const t = heat.toVar();
    const red = mix(vec3(0.3, 0.02, 0.003), vec3(0.8, 0.12, 0.012), smoothstep(0.0, 0.36, t));
    const orange = mix(red, vec3(1.0, 0.33, 0.045), smoothstep(0.3, 0.62, t));
    const gold = mix(orange, vec3(1.0, 0.52, 0.14), smoothstep(0.56, 0.86, t));
    return mix(gold, vec3(1.0, 0.7, 0.32), smoothstep(0.84, 1.1, t));
}

/** Prominence plasma by density 0..1: thin crimson veils, H-alpha red, dense orange, gold cores. */
function plasmaTint(density) {
    const t = density.toVar();
    const veil = mix(vec3(0.55, 0.045, 0.055), vec3(1.0, 0.2, 0.08), smoothstep(0.0, 0.4, t));
    const dense = mix(veil, vec3(1.0, 0.48, 0.13), smoothstep(0.35, 0.75, t));
    return mix(dense, vec3(1.0, 0.78, 0.45), smoothstep(0.72, 1.1, t));
}

/** The corona by height above the limb (star radii): gold-white low, amber, then ember red. */
function coronaTint(height) {
    const low = mix(vec3(1.0, 0.68, 0.36), vec3(1.0, 0.36, 0.08), smoothstep(0.0, 0.4, height));
    const mid = mix(low, vec3(0.62, 0.1, 0.04), smoothstep(0.35, 1.5, height));
    return mix(mid, vec3(0.25, 0.03, 0.05), smoothstep(1.3, 3.0, height));
}

/** A view-space point on the unit ball, in the star's turning frame. */
function toBody(n, spin) {
    const m = vec3(
        dot(vec3(T[0][0], T[1][0], T[2][0]), n),
        dot(vec3(T[0][1], T[1][1], T[2][1]), n),
        dot(vec3(T[0][2], T[1][2], T[2][2]), n),
    ).toVar();
    const c = cos(spin).toVar();
    const s = sin(spin).toVar();
    return vec3(m.x.mul(c).sub(m.z.mul(s)), m.y, m.x.mul(s).add(m.z.mul(c)));
}

/** A constant direction in the star's frame, seen from the viewer: Ry(spin), then the tilt. */
function bodyToView(v, c, s) {
    const x = c.mul(v[0]).add(s.mul(v[2]));
    const z = c.mul(v[2]).sub(s.mul(v[0]));
    return vec3(
        x.mul(T[0][0]).add(T[0][1] * v[1]).add(z.mul(T[0][2])),
        x.mul(T[1][0]).add(T[1][1] * v[1]).add(z.mul(T[1][2])),
        x.mul(T[2][0]).add(T[2][1] * v[1]).add(z.mul(T[2][2])),
    );
}

/** Distance from p to the segment a..b (2D). */
function segmentDistance(p, a, b) {
    const ab = b.sub(a).toVar();
    const ap = p.sub(a).toVar();
    const along = dot(ap, ab).div(dot(ab, ab).max(1e-8)).saturate();
    return length(ap.sub(ab.mul(along)));
}

/**
 * Coronal loops: thin arcs of hot plasma standing over the spot groups, true 3D curves that turn
 * with the star, so near the centre of the disc they are seen from above as short bright threads
 * and near the limb in profile as full arches. Parts behind the star are hidden. Returns light.
 */
function coronalLoops(q, spin, pixel, steps) {
    const c = cos(spin).toVar();
    const s = sin(spin).toVar();
    const light = float(0).toVar();
    ARCADES.forEach((arcade) => {
        // The whole group behind the star: skip it (the same branch for every pixel); and only
        // pixels near the group pay for its loops.
        const hub = bodyToView(arcade.middle, c, s).toVar();
        If(hub.z.greaterThan(-0.35).and(length(q.sub(hub.xy)).lessThan(arcade.reach)), () => {
            arcade.loops.forEach((loop) => {
                const m = bodyToView(loop.m, c, s).toVar();
                const e = bodyToView(loop.e, c, s).toVar();
                const lift = bodyToView(loop.lift, c, s).toVar();
                const thread = float(0).toVar();
                let previous = m.add(e);
                for (let k = 1; k <= steps; k++) {
                    const t = (Math.PI * k) / steps;
                    const point = m.add(e.mul(Math.cos(t))).add(lift.mul(Math.sin(t))).toVar();
                    const middle = previous.add(point).mul(0.5);
                    // Hidden where it is behind the star and inside its outline; dim at the feet.
                    const shown = step(0.0, middle.z).max(step(1.0, length(middle.xy)));
                    const feet = Math.sin((Math.PI * (k - 0.5)) / steps) * 0.7 + 0.3;
                    const gap = segmentDistance(q, previous.xy, point.xy).div(pixel.mul(1.3));
                    thread.assign(thread.max(exp(gap.mul(gap).negate()).mul(shown).mul(feet)));
                    previous = point;
                }
                light.addAssign(thread.mul(0.42));
            });
        });
    });
    return light;
}

/**
 * One prominence: a loop of plasma rising from two footpoints just behind the limb. The loop is
 * an ellipse in a leaning frame at the limb; the pixel's distance to it gives the tube, the angle
 * around it (0 at the apex, ±π/2 at the feet) the position along it. Inside the tube threads twist
 * around the axis, wisps fray off them and knots of dense plasma drain down the legs; the tube
 * swells and thins along its length. The expensive part runs only near the loop. Adds HDR light
 * to `out`.
 */
function prominence(w, loop, {
    rise, glow, time, out, lift = null,
}) {
    const phi = loop.angle * DEG;
    const o = [Math.cos(phi), Math.sin(phi)];
    const t = [-o[1], o[0]];
    const lean = loop.lean * DEG;
    const up = [o[0] * Math.cos(lean) + t[0] * Math.sin(lean), o[1] * Math.cos(lean) + t[1] * Math.sin(lean)];
    const det = t[0] * up[1] - t[1] * up[0];
    // Sink the base so both feet stand just inside the limb.
    const sink = (loop.span * loop.span) / 2 + 0.02;
    const breathe = sin(time.mul(0.17).add(loop.seed * 3)).mul(0.06).add(1);
    let height = rise.mul(loop.height).mul(breathe);
    let base = vec2(o[0] * (1 - sink), o[1] * (1 - sink));
    if (lift) {
        height = height.mul(lift.mul(3.2).add(1));
        base = base.add(vec2(o[0], o[1]).mul(lift.mul(0.25)));
    }
    const h = height.toVar();
    const rel = w.sub(base).toVar();
    const along = rel.x.mul(up[1]).sub(rel.y.mul(up[0])).div(det * loop.span).toVar();
    const lifted = rel.y.mul(t[0]).sub(rel.x.mul(t[1])).div(det).div(h)
        .toVar();
    const rho = sqrt(along.mul(along).add(lifted.mul(lifted))).toVar();
    const bound = (5 * loop.width) / Math.min(loop.span, loop.height * 0.5);
    // (Away from the ellipse's centre, deep in the disc, where the angle around it is undefined.)
    If(rho.sub(1).abs().lessThan(bound).and(lifted.greaterThan(-0.6))
        .and(rho.greaterThan(0.25)), () => {
        const gx = along.div(loop.span);
        const gy = lifted.div(h);
        const gradient = sqrt(gx.mul(gx).add(gy.mul(gy))).div(rho.max(1e-3)).max(1e-3);
        const across = rho.sub(1).div(gradient).div(loop.width).toVar();
        // 0 at the apex, ±π/2 at the feet; the seam (straight down) lies deep inside the disc.
        const arc = along.atan(lifted).toVar();
        const legs = fadeOut(1.7, 2.0, arc.abs());
        // The tube swells and thins along its length, so no two loops share a profile.
        const swell = gnoise(vec2(arc.mul(2.2).add(loop.seed), time.mul(0.05).add(loop.seed)));
        const fray = across.div(swell.mul(0.7).add(0.65)).toVar();
        // Threads twist around the loop's axis; fine wisps fray off them; knots of dense plasma
        // drain from the apex down both legs.
        const twist = fray.add(sin(arc.mul(4).add(time.mul(0.25)).add(loop.seed)).mul(0.35));
        const threads = gnoise(vec2(twist.mul(2.6), arc.mul(1.6).sub(time.mul(0.05)).add(loop.seed * 3.1)));
        const wisps = gnoise(vec2(fray.mul(6).add(loop.seed), arc.mul(9).sub(time.mul(0.12))));
        const fromApex = sqrt(arc.mul(arc).add(0.03));
        const knots = gnoise(vec2(fromApex.mul(4).sub(time.mul(0.4)).add(loop.seed), fray.mul(0.5).add(loop.seed)));
        const body = exp(fray.mul(fray).mul(-0.6));
        const halo = exp(across.mul(across).mul(-0.12));
        // One leg often outshines the other.
        const favour = sin(arc.add(loop.seed * 2.3)).mul(0.3).add(0.8);
        const density = body.mul(square(threads).mul(1.5).add(wisps.mul(0.35)).add(0.18))
            .mul(knots.mul(0.9).add(0.45))
            .mul(favour)
            .toVar();
        let light = plasmaTint(density.mul(0.9)).mul(density.mul(1.8).add(halo.mul(0.2))).mul(legs).mul(glow)
            .mul(loop.gain);
        if (lift) {
            // Lifting off: the feet let go first, then the whole arch fades into the corona.
            const feet = fadeOut(mix(float(1.95), float(0.8), smoothstep(0.2, 0.7, lift)), float(2.1), arc.abs());
            light = light.mul(feet).mul(smoothstep(0.0, 0.12, lift)).mul(fadeOut(0.45, 0.95, lift));
        }
        out.addAssign(light);
    });
}

/** The hedgerow: a curtain of vertical threads standing on the limb. Adds HDR light to `out`. */
function hedgerow(w, {
    rise, glow, time, out,
}) {
    const wr = length(w).toVar();
    const wd = w.div(wr.max(1e-4));
    const hc = [Math.cos(HEDGEROW.angle * DEG), Math.sin(HEDGEROW.angle * DEG)];
    // Signed angle from the curtain's centre; its seam lies on the far side of the star, masked out.
    const offAxis = wd.x.mul(hc[1]).sub(wd.y.mul(hc[0])).atan(dot(wd, vec2(hc[0], hc[1]))).toVar();
    const curtain = fadeOut(HEDGEROW.span * 0.55, HEDGEROW.span, offAxis.abs()).toVar();
    const climb = wr.sub(1).toVar();
    If(curtain.greaterThan(0.001).and(climb.lessThan(HEDGEROW.height * 2.2)), () => {
        const crest = gnoise(vec2(offAxis.mul(9).add(2.1), time.mul(0.03))).mul(0.6).add(0.25)
            .add(gnoise(vec2(offAxis.mul(31).add(7.7), time.mul(0.05))).mul(0.35))
            .mul(HEDGEROW.height)
            .mul(rise);
        const sheet = fadeOut(crest.mul(0.35), crest, climb).mul(smoothstep(-0.02, 0.0, climb));
        // Threads lean as they climb and gather in clumps; none of them is a straight slat.
        const threads = gnoise(vec2(offAxis.mul(44).add(climb.mul(7)), climb.mul(3).sub(time.mul(0.04))));
        const clumps = gnoise(vec2(offAxis.mul(8).add(5.3), climb.mul(5).sub(time.mul(0.03))));
        const density = sheet.mul(curtain).mul(square(threads).mul(1.4).add(0.25)).mul(clumps.mul(1.1).add(0.2))
            .toVar();
        out.addAssign(plasmaTint(density).mul(density).mul(1.8).mul(glow));
    });
}

export function createSolarWorld({ u, quality }) {
    const { detail } = quality;
    // The lightest tier draws with no post pipeline, so no grade: the world warms itself instead.
    const bare = !(quality.bloom > 0);
    const loops = detail >= 0.5 ? LOOPS : LOOPS.filter((loop) => loop.core);
    const loopSteps = detail >= 0.7 ? 7 : 5;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const breath = u.breathSoft.toVar();
        // Tall screens get a bigger star: it spans most of the width and the corona fills the height.
        const tall = u.ext.y.sub(1).div(1.16).saturate().toVar();
        const radius = mix(float(0.7), float(0.76), tall).toVar();
        // Star units: the limb at |q| = 1. Wide screens set the star a little low, so the
        // prominences on its crown have room under the top of the frame.
        const centre = vec2(0, mix(float(-0.05), float(0), tall));
        const q = layer(p, u, 1).sub(centre).div(radius).toVar();
        const r = length(q).toVar();
        const dir = q.div(r.max(1e-4)).toVar();
        const above = r.sub(1).max(0).toVar();
        const pixel = u.px.div(radius).toVar();

        // Deep space: warm black, faint far dust, stars the glare drowns near the star.
        const sky = layer(p, u, 0.05).toVar();
        const dust = fbm(sky.mul(0.8).add(vec2(4.1, 1.3)), 2);
        const col = SPACE.add(NEBULA.mul(smoothstep(0.45, 0.9, dust))).toVar();
        col.addAssign(starfield(p, u, 0.8).mul(smoothstep(0.35, 2.2, above)));

        // The corona, by direction (vec2 noise, so no angle seam), bending a little as it climbs.
        // Streamers reach farther on tall screens, which have more sky above and below the star.
        const reach = mix(float(0.22), float(1.15), breath).mul(tall.mul(0.45).add(1)).toVar();
        const swirl = turn(dir, above.mul(0.1).add(u.time.mul(0.003))).toVar();
        // Helmet streamers: a few broad petals, favouring the equator, that narrow as they climb.
        const broad = gnoise(swirl.mul(1.7).add(vec2(3.1, 7.7)));
        // Wide screens favour the equatorial streamers, tall ones the polar plumes: both fill the frame.
        const tilt = dot(dir, vec2(EQUATOR[0], EQUATOR[1]));
        const equatorial = tilt.mul(tilt);
        const favoured = mix(equatorial, float(1).sub(equatorial), tall);
        const petals = broad.sub(0.5).mul(3.2).add(favoured.mul(0.35)).toVar();
        const narrow = above.mul(0.25).min(0.7).toVar();
        const helmets = smoothstep(narrow.sub(0.15), narrow.add(0.38), petals);
        // Fine rays and plumes everywhere: the corona is combed, never smooth.
        const rayA = gnoise(swirl.mul(9).add(vec2(9.2, 1.4)));
        const rayB = gnoise(swirl.mul(23).add(vec2(2.6, 5.3))).toVar();
        const combed = rayA.sub(0.5).mul(1.3).add(rayB.sub(0.5).mul(0.9)).add(0.6)
            .max(0.05)
            .toVar();
        // Plasma streams outward along the rays, quickening on the in-breath.
        const outward = log(r.max(1)).mul(6).sub(u.breathInt.mul(0.6)).sub(u.time.mul(0.05));
        const flow = gnoise3(vec3(swirl.mul(6), outward));
        const diffuse = exp(above.div(reach.mul(0.45)).negate());
        // Long faint streamers stay out at the edge of sight even with empty lungs.
        const streamers = exp(above.div(reach).negate()).add(exp(above.mul(-0.75)).mul(0.07)).mul(helmets);
        const inner = exp(above.mul(-11));
        col.addAssign(INNER_CORONA.mul(inner).mul(rayB.mul(0.5).add(0.75)).mul(u.breath.mul(0.35).add(0.65)).mul(0.18));
        col.addAssign(coronaTint(above).mul(diffuse.mul(0.2).add(streamers.mul(0.95))).mul(combed)
            .mul(flow.mul(0.9).add(0.55))
            .mul(0.6));
        col.addAssign(GLARE.div(above.mul(above).mul(7).add(1)).mul(breath.mul(0.04).add(0.05)));

        // Solar wind: sparse glints streaming outward on a nearer layer, quickening on the in-breath.
        // Cells in (angle, log radius) scroll outward, so each glint accelerates as it leaves. Only
        // where glints live (which also keeps atan away from the layer's centre).
        const gust = layer(p, u, WIND.k).sub(centre).div(radius).toVar();
        const gustR = length(gust).toVar();
        If(gustR.greaterThan(1.12).and(gustR.lessThan(3.3)), () => {
            const spoke = gust.y.atan(gust.x).div(TAU).add(0.5).mul(WIND.cells)
                .toVar();
            const outflow = log(gustR).mul(7).sub(u.breathInt.mul(1.1)).sub(u.time.mul(0.12))
                .toVar();
            const lane = spoke.floor();
            const slot = outflow.floor();
            const pick = hash21(vec2(lane, slot));
            const shade = hash21(vec2(lane.add(5.1), slot));
            const sideways = spoke.fract().sub(hash21(vec2(slot, lane.add(17))).mul(0.6).add(0.2))
                .mul(gustR.mul(TAU / WIND.cells).div(0.0035));
            const lengthwise = outflow.fract().sub(0.5).div(0.16);
            const glint = exp(sideways.mul(sideways).add(lengthwise.mul(lengthwise)).negate())
                .mul(smoothstep(0.88, 0.97, pick).mul(shade.mul(0.8).add(0.2)))
                .mul(smoothstep(1.15, 1.4, gustR).mul(fadeOut(1.9, 3.2, gustR)));
            col.addAssign(coronaTint(gustR.sub(1)).mul(glint).mul(breath.mul(0.5).add(0.25)).mul(0.9));
        });

        // Prominences and the chromosphere, in the ring around the limb.
        const plasma = vec3(0).toVar();
        const rise = breath.mul(0.6).add(0.72).toVar();
        const glow = breath.mul(0.7).add(0.55).toVar();
        If(r.greaterThan(0.86).and(r.lessThan(2.4)), () => {
            // Turbulence: every loop and curtain wanders and frays instead of tracing a clean curve.
            const warp = vec2(
                gnoise(q.mul(4).add(vec2(u.time.mul(0.04), 1.7))),
                gnoise(q.mul(4).add(vec2(6.1, u.time.mul(-0.04)))),
            ).sub(0.5).mul(0.1);
            const w = q.add(warp).toVar();
            // Spicules: a fringe of tiny jets, so the limb is a living edge rather than a line.
            const grass = gnoise(dir.mul(64).add(vec2(0, u.time.mul(0.2)))).toVar();
            // A thin bright line hugging the limb, and the fainter fringe of jets standing on it.
            const crest = grass.mul(0.02).add(1.01).add(breath.mul(0.006));
            const line = r.sub(1.002).div(0.0045);
            const fringe = smoothstep(0.997, 1.004, r).mul(fadeOut(crest.sub(0.012), crest, r)).mul(grass);
            const chromosphere = exp(line.mul(line).negate()).mul(0.75).add(fringe.mul(0.45));
            plasma.addAssign(CHROMOSPHERE.mul(chromosphere).mul(breath.mul(0.3).add(0.85)));
            const flare = {
                rise, glow, time: u.time, out: plasma,
            };
            loops.forEach((loop) => prominence(w, loop, flare));
            if (detail >= 0.5) {
                const cycle = fract(u.time.div(ERUPTION.period).add(ERUPTION.offset)).toVar();
                prominence(w, ERUPTION, { ...flare, lift: cycle.mul(cycle) });
            }
            hedgerow(w, flare);
        });
        col.addAssign(plasma);

        // The photosphere, shaded only where the disc is.
        const surface = vec3(0).toVar();
        If(r.lessThan(pixel.mul(2).add(1)), () => {
            const mu = sqrt(float(1).sub(r.mul(r)).max(0)).toVar();
            const spin = u.time.mul(TAU / ROTATION_PERIOD).toVar();
            const body = toBody(vec3(q.x, q.y, mu), spin).toVar();

            // Sunspots: the nearest spot, and where around it this point lies.
            const nearest = float(9).toVar();
            const aroundX = float(1).toVar();
            const aroundY = float(0).toVar();
            const spotSeed = float(0).toVar();
            SPOTS.forEach((spot) => {
                const offset = body.sub(vec3(...spot.c)).toVar();
                const distance = length(offset).div(spot.radius).toVar();
                const closer = distance.lessThan(nearest);
                aroundX.assign(select(closer, dot(offset, vec3(...spot.east)), aroundX));
                aroundY.assign(select(closer, dot(offset, vec3(...spot.north)), aroundY));
                spotSeed.assign(select(closer, float(spot.seed), spotSeed));
                nearest.assign(min(nearest, distance));
            });
            const around = vec2(aroundX, aroundY);
            const angle = around.div(length(around).max(1e-6)).toVar();
            // An irregular outline from a few harmonics of the angle around the spot (integer multiples,
            // so the atan seam never shows).
            const theta = angle.y.atan(angle.x.add(1e-6));
            const outline = sin(theta.mul(2).add(spotSeed)).mul(0.1)
                .add(sin(theta.mul(3).add(spotSeed.mul(1.7))).mul(0.07))
                .add(sin(theta.mul(5).add(spotSeed.mul(2.3))).mul(0.04));
            const ragged = gnoise3(body.mul(70)).toVar();
            const f = nearest.mul(outline.add(1)).add(ragged.sub(0.5).mul(0.06)).toVar();
            const umbra = fadeOut(0.37, 0.47, f).toVar();
            const penumbra = fadeOut(0.9, 1.0, f).toVar();
            // Penumbral filaments radiate from the umbra: fine bright and dark spokes.
            const filaments = gnoise(angle.mul(8).add(vec2(f.mul(0.6), spotSeed.mul(3.1))));

            // Granulation: bright cells parted by dark lanes. The mesogranulation bends the cell walls
            // so granules come out rounded and uneven; where cells shrink below a few pixels (the limb,
            // small screens) they fade to an even glow instead of shimmering.
            const meso = gnoise3(body.mul(7.5).add(vec3(0, 0, u.time.mul(0.02)))).toVar();
            const network = gnoise3(body.mul(2.8).add(3.3)).toVar();
            const cells = voronoi3(body.mul(GRANULES).add(meso.mul(2.4)).add(ragged.mul(0.9)), u.time.mul(0.3)).toVar();
            const walls = smoothstep(0.0, 0.5, cells.y.sub(cells.x));
            const dome = float(1.25).sub(cells.x.mul(0.9));
            const granule = walls.mul(dome).mul(cells.z.mul(0.5).add(0.75));
            const sharp = smoothstep(1.5, 4.0, mu.max(0.02).div(pixel.mul(GRANULES))).mul(meso.mul(0.8).add(0.6));
            const grain = granule.sub(0.62).mul(0.26).mul(sharp)
                .add(meso.sub(0.5).mul(0.5))
                .add(network.sub(0.5).mul(0.4))
                .toVar();

            // Faculae: bright magnetic patches in the active belts and around spots, seen near the limb.
            const limb = float(1).sub(mu).toVar();
            const latitude = body.y.abs();
            const belt = smoothstep(0.07, 0.2, latitude).mul(fadeOut(0.42, 0.62, latitude));
            const plage = fadeOut(1.3, 4.5, nearest);
            const faculae = smoothstep(0.5, 0.74, gnoise3(body.mul(26).add(8.1))).mul(granule.mul(0.6).add(0.5))
                .mul(belt.mul(0.8).add(plage)).mul(smoothstep(0.36, 0.62, network))
                .mul(limb.mul(limb.sqrt()).mul(3))
                .toVar();

            // Flare ribbons: on the in-breath, twin bright ribbons light up along each group's polarity
            // line, between its leading and following spots, and fade as the breath leaves.
            const flare = float(0).toVar();
            ARCADES.forEach((arcade) => {
                const offset = body.sub(vec3(...arcade.middle)).toVar();
                const across = dot(offset, vec3(...arcade.side)).toVar();
                const along = dot(offset, vec3(...arcade.axis)).abs().sub(across.mul(across).mul(6)).sub(0.03)
                    .div(0.009);
                // Only on the group's own face of the star (not at its antipode).
                const near = smoothstep(0.988, 0.994, dot(body, vec3(...arcade.centre)));
                flare.addAssign(exp(along.mul(along).negate()).mul(fadeOut(0.04, 0.085, across.abs())).mul(near));
            });
            flare.mulAssign(ragged.mul(1.2).add(0.4).mul(smoothstep(0.3, 1.0, breath)));

            // Strong limb darkening (linear in mu) with the colour shift that goes with it: a
            // white-gold core cooling through orange to a deep red edge.
            const darkening = mu.mul(0.96).add(0.04);
            const core = mu.mul(mu).mul(0.4).add(0.95);
            const heat = mu.sqrt().mul(0.7).add(0.28).add(grain.mul(0.5))
                .add(breath.mul(0.07))
                .add(faculae.mul(0.1))
                .add(flare.mul(0.4))
                .sub(penumbra.mul(0.2))
                .sub(umbra.mul(0.28));
            const light = darkening.mul(core).mul(grain.add(1)).mul(faculae.mul(0.8).add(1))
                .mul(mix(float(1), filaments.mul(0.42).add(0.3), penumbra))
                .mul(mix(float(1), float(0.16), umbra))
                .mul(breath.mul(0.14).add(0.94));
            // The flare's light lies over the spots rather than under them.
            surface.assign(sunTint(heat).mul(light).mul(1.05).add(FLARE.mul(flare).mul(darkening.mul(1.3))));
        });
        const disc = fadeOut(float(1).sub(pixel.mul(1.2)), pixel.mul(1.2).add(1), r).toVar();
        col.assign(mix(col, surface, disc));
        // The prominences' feet glow over the very edge of the disc.
        col.addAssign(plasma.mul(disc).mul(smoothstep(0.97, 1.0, r)).mul(0.3));
        // Coronal loops arch over the spot groups, in front of the disc and above the limb.
        If(r.lessThan(1.15), () => {
            const arcs = coronalLoops(q, u.time.mul(TAU / ROTATION_PERIOD), pixel, loopSteps);
            col.addAssign(LOOP_LIGHT.mul(arcs).mul(glow));
        });

        // A planet in transit: a crisp black dot, nearer than the star, its thin air lit from behind.
        const planetAt = layer(p, u, PLANET.k);
        const span = u.ext.x.add(0.2);
        const travel = fract(u.time.div(PLANET.period).add(0.43)).mul(2).sub(1).mul(span);
        const toPlanet = length(planetAt.sub(vec2(travel, radius.mul(0.5)).add(centre))).toVar();
        const planet = fadeOut(float(PLANET.radius).sub(u.px), u.px.add(PLANET.radius), toPlanet);
        const air = toPlanet.sub(PLANET.radius).div(u.px.mul(1.6));
        col.assign(mix(col, vec3(0.0015, 0.0006, 0.0005), planet));
        col.addAssign(vec3(1.0, 0.62, 0.36).mul(exp(air.mul(air).negate())).mul(disc).mul(0.35));
        if (bare) {
            // Stand in for the grade (fitted to what the post pipeline does to this palette).
            const luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col.assign(mix(vec3(luma), col, 1.15).max(0).mul(vec3(1.125, 0.925, 0.825)));
        }
        return col;
    })();

    // Light streams from the star's centre, which sits a little low on wide screens.
    const shafts = {
        source: [0, 0, 1],
        radius: 0.4,
        strength: 0.3,
        threshold: 0.8,
        decay: 0.95,
        length: 0.5,
        tint: [1.0, 0.7, 0.4],
        breath: 0.6,
    };
    return {
        backdrop,
        shafts,
        bloom: {
            strength: 0.4, radius: 0.7, threshold: 1.0, breath: 0.8,
        },
        grade: {
            shadows: [1.1, 0.9, 0.86], highlights: [1.04, 0.98, 0.9], saturation: 1.06, contrast: 1.06, vignette: 0.42,
        },
        camera: { dolly: 0.05, drift: [0.03, 0.016], period: 60 },
        exposure: 0.9,
        update({ ext }) {
            const tall = Math.min(Math.max((ext.y - 1) / 1.16, 0), 1);
            shafts.source[1] = -0.05 * (1 - tall);
        },
    };
}
