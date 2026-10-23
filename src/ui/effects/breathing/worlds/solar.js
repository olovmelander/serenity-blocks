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
 *
 * Everything that repeats (sunspots, prominences, coronal loops and their segments, flare ribbons,
 * the cells of the granulation) is one shader loop over constant data rather than JS-unrolled
 * copies: the fragment shader stays small, so its pipeline compiles quickly on every driver.
 *
 * Moods: the golden star; a red giant rising like a horizon, its surface a few huge boiling
 * convection cells, wrapped in the dust it sheds; a blue-white hot star with a violet corona and a
 * ringed planet crossing its limb. Behind every star lies the band of its galaxy. Now and then a
 * coronal mass ejection blooms off the limb over several seconds, and a comet crosses with its
 * tails streaming away from the star.
 */
import { Vector4 } from 'three/webgpu';
import {
    Fn, If, Loop, cos, dot, exp, float, floor, fract, length, log, min, mix, select, sin, smoothstep, sqrt, step,
    uniformArray, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, eventWindow, fadeOut, fbm, gnoise, gnoise3, hash21, hash33, layer, ridged, starfield, turn,
} from '../stage/breath-tsl.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** The spin axis tips toward the viewer and leans a little (radians), so the star reads as a ball. */
const AXIS_TIP = 0.3;
const AXIS_LEAN = -0.22;
/** The planet in transit: radius (hero units), parallax depth, seconds to cross the screen. */
const PLANET = { radius: 0.016, k: 1.12, period: 240 };

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
/** Every coronal loop, carrying its group's middle and reach for the cheap "is it near" test. */
const ARCS = ARCADES.flatMap((arcade) => arcade.loops.map((loop) => ({
    ...loop, hub: [...arcade.middle, arcade.reach],
})));
/** Solar wind: angular cells around the star (an integer, so the atan seam is a cell wall), parallax depth. */
const WIND = { cells: 96, k: 1.35 };

/**
 * Prominence loops anchored at the limb: angle (degrees, 0 = right, 90 = up), half-span and
 * height (star radii), lean (degrees), tube width (star radii), seed, brightness. `core` loops stay
 * on the lightest tier. The diagonals fit both landscape and portrait; the side and bottom ones fill
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
    angle: 126,
    span: 0.12,
    height: 0.2,
    lean: 10,
    width: 0.042,
    seed: 3.3,
    gain: 1.0,
    erupts: true,
    // One rise and fade takes this long (seconds), starting this far into the cycle.
    period: 46,
    offset: 0.35,
};
/** A quiescent hedgerow prominence: a curtain of fine vertical threads along the limb. */
const HEDGEROW = { angle: 160, span: 0.2, height: 0.12 };

/**
 * The red giant rises from the bottom of the screen: only its crown is seen, so its prominences
 * all stand on the upper limb (90 = straight up), sized for a star twice as large on screen.
 */
const RISING_LOOPS = [
    {
        angle: 63, span: 0.085, height: 0.26, lean: 10, width: 0.034, seed: 1.3, gain: 1.1, core: true,
    },
    {
        angle: 72, span: 0.04, height: 0.1, lean: -8, width: 0.018, seed: 6.2, gain: 0.8,
    },
    {
        angle: 113, span: 0.07, height: 0.2, lean: -16, width: 0.03, seed: 4.7, gain: 1.0, core: true,
    },
    {
        angle: 131, span: 0.045, height: 0.11, lean: 12, width: 0.02, seed: 5.6, gain: 0.75,
    },
];
const RISING_ERUPTION = {
    ...ERUPTION, angle: 84, span: 0.06, height: 0.12, width: 0.026,
};
const RISING_HEDGEROW = { angle: 97, span: 0.1, height: 0.06 };

/**
 * A prominence's fixed frame at the limb, packed for the shader: its base (sunk so both feet stand
 * just inside the limb) and outward direction; the inverse of its leaning frame (pixel offset to
 * position along the span and up the loop); size and seed; brightness, the reach of its tube in
 * loop units (the expensive part runs only inside it) and whether it erupts.
 */
function archFrame(loop) {
    const phi = loop.angle * DEG;
    const o = [Math.cos(phi), Math.sin(phi)];
    const t = [-o[1], o[0]];
    const lean = loop.lean * DEG;
    const up = [o[0] * Math.cos(lean) + t[0] * Math.sin(lean), o[1] * Math.cos(lean) + t[1] * Math.sin(lean)];
    const det = t[0] * up[1] - t[1] * up[0];
    const sink = (loop.span * loop.span) / 2 + 0.02;
    return {
        base: [o[0] * (1 - sink), o[1] * (1 - sink), o[0], o[1]],
        frame: [up[1] / (det * loop.span), -up[0] / (det * loop.span), -t[1] / det, t[0] / det],
        size: [loop.span, loop.height, loop.width, loop.seed],
        look: [loop.gain, (5 * loop.width) / Math.min(loop.span, loop.height * 0.5), loop.erupts ? 1 : 0, 0],
    };
}

/**
 * All the constant data the shader loops read, in ONE uniform array (each array is a uniform
 * buffer, and a stage may bind only a few): blocks of vec4 rows, one block per feature, `stride`
 * rows per item. `row(block, i, k)` reads row k of item i.
 */
function createTables(arches, active = true) {
    const rows = [];
    const block = (items, ...pack) => {
        const offset = rows.length;
        items.forEach((item) => pack.forEach((fn) => rows.push(new Vector4(...fn(item)))));
        return { offset, stride: pack.length, count: items.length };
    };
    const spots = block(
        active ? SPOTS : [],
        (spot) => [...spot.c, spot.radius],
        (spot) => [...spot.east, spot.seed],
        (spot) => [...spot.north, 0],
    );
    const ribbons = block(
        active ? ARCADES : [],
        (a) => [...a.middle, 0],
        (a) => [...a.side, 0],
        (a) => [...a.axis, 0],
        (a) => [...a.centre, 0],
    );
    const arcs = block(
        active ? ARCS : [],
        (arc) => arc.hub,
        (arc) => [...arc.m, 0],
        (arc) => [...arc.e, 0],
        (arc) => [...arc.lift, 0],
    );
    const prominence = block(arches.map(archFrame), (a) => a.base, (a) => a.frame, (a) => a.size, (a) => a.look);
    const data = uniformArray(rows, 'vec4');
    return {
        spots, ribbons, arcs, prominence, row: (at, i, k) => data.element(i.mul(at.stride).add(at.offset + k)),
    };
}

/** x² of a noise that may dip a hair below zero, without pow(). */
const square = (x) => {
    const c = x.max(0).toVar();
    return c.mul(c);
};

/** A loop over -1, 0, 1 with its own index name (nested loops must not share one). */
const neighbours = (name, body) => Loop({
    start: -1, end: 2, type: 'int', condition: '<', name,
}, (index) => body(float(index[name])));

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
    neighbours('cz', (k) => neighbours('cy', (j) => neighbours('cx', (i) => {
        const cell = vec3(i, j, k).toVar();
        const seed = hash33(n.add(cell)).toVar();
        const offset = sin(seed.mul(TAU).add(t)).mul(0.36).add(0.5);
        const r = cell.add(offset).sub(f);
        const d = dot(r, r).toVar();
        const closer = d.lessThan(f1);
        f2.assign(select(closer, f1, min(f2, d)));
        id.assign(select(closer, seed.z, id));
        f1.assign(min(f1, d));
    })));
    return vec3(sqrt(f1), sqrt(f2), id);
}).setLayout({
    name: 'solar_voronoi3', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }, { name: 't', type: 'float' }],
});

/**
 * A mood's three colour ramps, one layout function each (named per mood, so two moods never share
 * a function name): the photosphere by heat 0..1 (limb to core), prominence plasma by density
 * (veils, H-alpha, dense, cores) and the corona by height above the limb (star radii).
 */
const tintCache = new Map();
function tintsFor(mood) {
    if (tintCache.has(mood.id)) return tintCache.get(mood.id);
    const key = mood.id.replace(/-/g, '_');
    const ramp = (stops) => stops.map((c) => vec3(...c));
    const [s0, s1, s2, s3, s4] = ramp(mood.photosphere);
    const [p0, p1, p2, p3] = ramp(mood.plasma);
    const [c0, c1, c2, c3] = ramp(mood.corona);
    const one = (name, input) => ({ name: `solar_${name}_${key}`, type: 'vec3', inputs: [{ name: input, type: 'float' }] });
    const tints = {
        sunTint: Fn(([t]) => {
            const red = mix(s0, s1, smoothstep(0.0, 0.36, t));
            const orange = mix(red, s2, smoothstep(0.3, 0.62, t));
            const gold = mix(orange, s3, smoothstep(0.56, 0.86, t));
            return mix(gold, s4, smoothstep(0.84, 1.1, t));
        }).setLayout(one('sunTint', 't')),
        plasmaTint: Fn(([t]) => {
            const veil = mix(p0, p1, smoothstep(0.0, 0.4, t));
            const dense = mix(veil, p2, smoothstep(0.35, 0.75, t));
            return mix(dense, p3, smoothstep(0.72, 1.1, t));
        }).setLayout(one('plasmaTint', 't')),
        coronaTint: Fn(([height]) => {
            const low = mix(c0, c1, smoothstep(0.0, 0.4, height));
            const mid = mix(low, c2, smoothstep(0.35, 1.5, height));
            return mix(mid, c3, smoothstep(1.3, 3.0, height));
        }).setLayout(one('coronaTint', 'height')),
    };
    tintCache.set(mood.id, tints);
    return tints;
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

/** A direction in the star's frame, seen from the viewer: Ry(spin) (as its cosine and sine), then the tilt. */
const bodyToView = /* @__PURE__ */ Fn(([v, c, s]) => {
    const turned = vec3(c.mul(v.x).add(s.mul(v.z)), v.y, c.mul(v.z).sub(s.mul(v.x)));
    return vec3(dot(vec3(...T[0]), turned), dot(vec3(...T[1]), turned), dot(vec3(...T[2]), turned));
}).setLayout({
    name: 'solar_bodyToView',
    type: 'vec3',
    inputs: [{ name: 'v', type: 'vec3' }, { name: 'c', type: 'float' }, { name: 's', type: 'float' }],
});

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
function coronalLoops(q, spin, pixel, steps, { arcs, row }) {
    const c = cos(spin).toVar();
    const s = sin(spin).toVar();
    const light = float(0).toVar();
    Loop({
        start: 0, end: arcs.count, type: 'int', condition: '<', name: 'arc',
    }, ({ arc }) => {
        // A group behind the star is skipped (the same branch for every pixel), and only pixels
        // near a group pay for its loops.
        const hub = row(arcs, arc, 0).toVar();
        const centre = bodyToView(hub.xyz, c, s).toVar();
        If(centre.z.greaterThan(-0.35).and(length(q.sub(centre.xy)).lessThan(hub.w)), () => {
            const m = bodyToView(row(arcs, arc, 1).xyz, c, s).toVar();
            const e = bodyToView(row(arcs, arc, 2).xyz, c, s).toVar();
            const lift = bodyToView(row(arcs, arc, 3).xyz, c, s).toVar();
            const thread = float(0).toVar();
            const previous = m.add(e).toVar();
            Loop({
                start: 1, end: steps + 1, type: 'int', condition: '<', name: 'seg',
            }, ({ seg }) => {
                const k = float(seg).toVar();
                const t = k.mul(Math.PI / steps);
                const point = m.add(e.mul(cos(t))).add(lift.mul(sin(t))).toVar();
                const middle = previous.add(point).mul(0.5);
                // Hidden where it is behind the star and inside its outline; dim at the feet.
                const shown = step(0.0, middle.z).max(step(1.0, length(middle.xy)));
                const feet = sin(k.sub(0.5).mul(Math.PI / steps)).mul(0.7).add(0.3);
                const gap = segmentDistance(q, previous.xy, point.xy).div(pixel.mul(1.3));
                thread.assign(thread.max(exp(gap.mul(gap).negate()).mul(shown).mul(feet)));
                previous.assign(point);
            });
            light.addAssign(thread.mul(0.42));
        });
    });
    return light;
}

/**
 * The prominences: loops of plasma rising from two footpoints just behind the limb, one shader
 * loop over their frames. Each loop is an ellipse in a leaning frame at the limb; the pixel's
 * distance to it gives the tube, the angle around it (0 at the apex, ±π/2 at the feet) the position
 * along it. Inside the tube threads twist around the axis, wisps fray off them and knots of dense
 * plasma drain down the legs; the tube swells and thins along its length. The expensive part runs
 * only near each loop. The erupting one lifts, lets go of its feet and fades. Adds HDR light to `out`.
 */
function prominences(w, { prominence, row }, {
    rise, glow, time, out, plasmaTint, eruption,
}) {
    const cycle = fract(time.div(eruption.period).add(eruption.offset)).toVar();
    Loop({
        start: 0, end: prominence.count, type: 'int', condition: '<', name: 'arch',
    }, ({ arch }) => {
        const base = row(prominence, arch, 0).toVar();
        const frame = row(prominence, arch, 1).toVar();
        const size = row(prominence, arch, 2).toVar();
        const look = row(prominence, arch, 3).toVar();
        const seed = size.w;
        const lift = cycle.mul(cycle).mul(look.z).toVar();
        const breathe = sin(time.mul(0.17).add(seed.mul(3))).mul(0.06).add(1);
        const h = rise.mul(size.y).mul(breathe).mul(lift.mul(3.2).add(1)).toVar();
        const rel = w.sub(base.xy.add(base.zw.mul(lift.mul(0.25)))).toVar();
        const along = rel.x.mul(frame.x).add(rel.y.mul(frame.y)).toVar();
        const lifted = rel.x.mul(frame.z).add(rel.y.mul(frame.w)).div(h).toVar();
        const rho = sqrt(along.mul(along).add(lifted.mul(lifted))).toVar();
        // (Away from the ellipse's centre, deep in the disc, where the angle around it is undefined.)
        If(rho.sub(1).abs().lessThan(look.y).and(lifted.greaterThan(-0.6))
            .and(rho.greaterThan(0.25)), () => {
            const gx = along.div(size.x);
            const gy = lifted.div(h);
            const gradient = sqrt(gx.mul(gx).add(gy.mul(gy))).div(rho.max(1e-3)).max(1e-3);
            const across = rho.sub(1).div(gradient).div(size.z).toVar();
            // 0 at the apex, ±π/2 at the feet; the seam (straight down) lies deep inside the disc.
            const arc = along.atan(lifted).toVar();
            const legs = fadeOut(1.7, 2.0, arc.abs());
            // The tube swells and thins along its length, so no two loops share a profile.
            const swell = gnoise(vec2(arc.mul(2.2).add(seed), time.mul(0.05).add(seed)));
            const fray = across.div(swell.mul(0.7).add(0.65)).toVar();
            // Threads twist around the loop's axis; fine wisps fray off them; knots of dense plasma
            // drain from the apex down both legs.
            const twist = fray.add(sin(arc.mul(4).add(time.mul(0.25)).add(seed)).mul(0.35));
            const threads = gnoise(vec2(twist.mul(2.6), arc.mul(1.6).sub(time.mul(0.05)).add(seed.mul(3.1))));
            const wisps = gnoise(vec2(fray.mul(6).add(seed), arc.mul(9).sub(time.mul(0.12))));
            const fromApex = sqrt(arc.mul(arc).add(0.03));
            const knots = gnoise(vec2(fromApex.mul(4).sub(time.mul(0.4)).add(seed), fray.mul(0.5).add(seed)));
            const body = exp(fray.mul(fray).mul(-0.6));
            const halo = exp(across.mul(across).mul(-0.12));
            // One leg often outshines the other.
            const favour = sin(arc.add(seed.mul(2.3))).mul(0.3).add(0.8);
            const density = body.mul(square(threads).mul(1.5).add(wisps.mul(0.35)).add(0.18))
                .mul(knots.mul(0.9).add(0.45))
                .mul(favour)
                .toVar();
            // Lifting off: the feet let go first, then the whole arch fades into the corona.
            const feet = fadeOut(mix(float(1.95), float(0.8), smoothstep(0.2, 0.7, lift)), float(2.1), arc.abs());
            const leaving = feet.mul(smoothstep(0.0, 0.12, lift)).mul(fadeOut(0.45, 0.95, lift));
            out.addAssign(plasmaTint(density.mul(0.9)).mul(density.mul(1.8).add(halo.mul(0.2))).mul(legs).mul(glow)
                .mul(look.x)
                .mul(mix(float(1), leaving, look.z)));
        });
    });
}

/** The hedgerow: a curtain of vertical threads standing on the limb. Adds HDR light to `out`. */
function hedgerow(w, {
    rise, glow, time, out, plasmaTint, curtainAt,
}) {
    const wr = length(w).toVar();
    const wd = w.div(wr.max(1e-4));
    const hc = [Math.cos(curtainAt.angle * DEG), Math.sin(curtainAt.angle * DEG)];
    // Signed angle from the curtain's centre; its seam lies on the far side of the star, masked out.
    const offAxis = wd.x.mul(hc[1]).sub(wd.y.mul(hc[0])).atan(dot(wd, vec2(hc[0], hc[1]))).toVar();
    const curtain = fadeOut(curtainAt.span * 0.55, curtainAt.span, offAxis.abs()).toVar();
    const climb = wr.sub(1).toVar();
    If(curtain.greaterThan(0.001).and(climb.lessThan(curtainAt.height * 2.2)), () => {
        const crest = gnoise(vec2(offAxis.mul(9).add(2.1), time.mul(0.03))).mul(0.6).add(0.25)
            .add(gnoise(vec2(offAxis.mul(31).add(7.7), time.mul(0.05))).mul(0.35))
            .mul(curtainAt.height)
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

/**
 * Sunspots around a point on the star (`body`, in the star's frame): the nearest spot by its own
 * size, and where around that spot the point lies. One loop over the spot table.
 */
function nearestSpot(body, { spots, row }) {
    const nearest = float(9).toVar();
    const aroundX = float(1).toVar();
    const aroundY = float(0).toVar();
    const seed = float(0).toVar();
    Loop(spots.count, ({ i }) => {
        const centre = row(spots, i, 0).toVar();
        const east = row(spots, i, 1).toVar();
        const offset = body.sub(centre.xyz).toVar();
        const distance = length(offset).div(centre.w).toVar();
        const closer = distance.lessThan(nearest);
        aroundX.assign(select(closer, dot(offset, east.xyz), aroundX));
        aroundY.assign(select(closer, dot(offset, row(spots, i, 2).xyz), aroundY));
        seed.assign(select(closer, east.w, seed));
        nearest.assign(min(nearest, distance));
    });
    return {
        nearest, around: vec2(aroundX, aroundY), seed,
    };
}

/**
 * Flare ribbons: twin bright ribbons along each group's polarity line, between its leading and
 * following spots. One loop over the groups; returns their strength at `body`.
 */
function flareRibbons(body, { ribbons, row }) {
    const flare = float(0).toVar();
    Loop(ribbons.count, ({ i }) => {
        const offset = body.sub(row(ribbons, i, 0).xyz).toVar();
        const across = dot(offset, row(ribbons, i, 1).xyz).toVar();
        const along = dot(offset, row(ribbons, i, 2).xyz).abs().sub(across.mul(across).mul(6)).sub(0.03)
            .div(0.009);
        // Only on the group's own face of the star (not at its antipode).
        const near = smoothstep(0.988, 0.994, dot(body, row(ribbons, i, 3).xyz));
        flare.addAssign(exp(along.mul(along).negate()).mul(fadeOut(0.04, 0.085, across.abs())).mul(near));
    });
    return flare;
}

/**
 * The band of the star's galaxy, far behind it: clouds of faint stars along a soft spine split by
 * a dark rift, and the denser starlight that lives in it. Additive light; the visit's seed moves
 * its clouds.
 */
function galaxyBand(p, u, {
    angle, offset, tint, gain,
}) {
    const sky = layer(p, u, 0.03).toVar();
    const across = dot(sky, vec2(-Math.sin(angle), Math.cos(angle))).sub(offset).toVar();
    const drift = sky.add(u.seed.mul(vec2(17.3, 9.1))).toVar();
    const width = gnoise(drift.mul(0.9).add(3.7)).mul(0.16).add(0.24).toVar();
    const spineAt = across.div(width);
    const spine = exp(spineAt.mul(spineAt).negate()).toVar();
    const clouds = fbm(drift.mul(2.2).add(1.3), 3);
    const riftAt = across.div(width.mul(0.42));
    const rift = smoothstep(0.47, 0.64, fbm(drift.mul(vec2(3.4, 2.6)).add(8.4), 3)).mul(exp(riftAt.mul(riftAt).negate())).toVar();
    const glow = spine.mul(smoothstep(0.3, 0.78, clouds).mul(0.8).add(0.2)).mul(float(1).sub(rift.mul(0.85)));
    const stars = starfield(drift.add(11.3), u, 1.5).mul(spine.mul(0.45).add(0.05)).mul(float(1).sub(rift.mul(0.7)));
    return vec3(...tint).mul(glow).mul(gain).add(stars.mul(0.6));
}

/** The versions of this world a visit can show (stage/breath-moods.js); the first is the poster's. */
export const MOODS = Object.freeze([
    {
        id: 'golden-star',
        name: 'Golden Star',
        photosphere: [[0.3, 0.02, 0.003], [0.8, 0.12, 0.012], [1.0, 0.33, 0.045], [1.0, 0.52, 0.14], [1.0, 0.7, 0.32]],
        plasma: [[0.55, 0.045, 0.055], [1.0, 0.2, 0.08], [1.0, 0.48, 0.13], [1.0, 0.78, 0.45]],
        corona: [[1.0, 0.68, 0.36], [1.0, 0.36, 0.08], [0.62, 0.1, 0.04], [0.25, 0.03, 0.05]],
        chromosphere: [1.0, 0.3, 0.12],
        innerCorona: [1.0, 0.64, 0.32],
        glare: [1.0, 0.42, 0.14],
        loopLight: [1.0, 0.78, 0.5],
        flare: [1.0, 0.85, 0.6],
        space: [0.0032, 0.0012, 0.0018],
        galaxy: {
            angle: 0.5, offset: 0.1, tint: [0.05, 0.026, 0.022], gain: 3,
        },
        comet: { head: [0.9, 0.96, 1.0], ion: [0.45, 0.68, 1.0], dust: [1.0, 0.86, 0.62] },
        size: 1,
        offset: [0, 0],
        granules: 44,
        meso: 7.5,
        lanes: 0.5,
        grain: 0.26,
        ragged: 0.9,
        boil: 0.3,
        rotation: 420,
        spots: true,
        transit: true,
        combing: 1,
        reach: 1,
        coronaGain: 1,
        prominence: 1,
        bare: [1.125, 0.925, 0.825],
        shaftTint: [1.0, 0.7, 0.4],
        bloom: {
            strength: 0.4, radius: 0.7, threshold: 1.0, breath: 0.8,
        },
        grade: {
            shadows: [1.1, 0.9, 0.86], highlights: [1.04, 0.98, 0.9], saturation: 1.06, contrast: 1.06, vignette: 0.42,
        },
        exposure: 0.9,
    },
    {
        // A cool giant near the end of its life, so large only its crown fits on the screen: a few
        // huge convection cells boil slowly across it, its corona is soft and low, and the dust it
        // sheds hangs around it in dim, lit wisps.
        id: 'red-giant',
        name: 'Red Giant',
        photosphere: [[0.16, 0.01, 0.004], [0.5, 0.045, 0.008], [0.88, 0.15, 0.02], [1.0, 0.3, 0.06], [1.0, 0.46, 0.16]],
        plasma: [[0.42, 0.028, 0.04], [0.92, 0.12, 0.05], [1.0, 0.3, 0.08], [1.0, 0.56, 0.26]],
        corona: [[1.0, 0.46, 0.2], [0.86, 0.18, 0.05], [0.42, 0.05, 0.03], [0.15, 0.02, 0.03]],
        chromosphere: [1.0, 0.18, 0.07],
        innerCorona: [1.0, 0.42, 0.18],
        glare: [1.0, 0.26, 0.08],
        loopLight: [1.0, 0.6, 0.35],
        flare: [1.0, 0.7, 0.45],
        space: [0.0026, 0.0008, 0.0012],
        galaxy: {
            angle: -0.32, offset: 0.62, tint: [0.045, 0.024, 0.026], gain: 3,
        },
        comet: { head: [0.92, 0.95, 1.0], ion: [0.42, 0.62, 1.0], dust: [1.0, 0.78, 0.55] },
        rising: true,
        shell: [0.5, 0.16, 0.07],
        granules: 5.5,
        meso: 2.2,
        lanes: 1.2,
        grain: 0.45,
        ragged: 0.2,
        boil: 0.07,
        rotation: 1100,
        spots: false,
        transit: false,
        combing: 0.45,
        reach: 1.25,
        coronaGain: 0.72,
        prominence: 0.85,
        bare: [1.15, 0.9, 0.8],
        shaftTint: [1.0, 0.5, 0.28],
        bloom: {
            strength: 0.42, radius: 0.75, threshold: 0.95, breath: 0.7,
        },
        grade: {
            shadows: [1.14, 0.88, 0.86], highlights: [1.06, 0.95, 0.86], saturation: 1.05, contrast: 1.07, vignette: 0.45,
        },
        exposure: 0.95,
    },
    {
        // A young blue-white star, hotter and smaller on the screen: fine granulation, a violet
        // corona combed into sharper rays, pink prominences, a reflection nebula glowing blue around
        // it, and a ringed planet crossing its limb (its rings dark against the disc, lit where
        // they hang against the corona).
        id: 'blue-star',
        name: 'Blue Star',
        photosphere: [[0.04, 0.05, 0.26], [0.15, 0.21, 0.68], [0.34, 0.46, 0.94], [0.52, 0.65, 1.0], [0.74, 0.83, 1.0]],
        plasma: [[0.32, 0.05, 0.3], [0.86, 0.24, 0.72], [1.0, 0.55, 0.95], [0.96, 0.86, 1.0]],
        corona: [[0.78, 0.84, 1.0], [0.46, 0.5, 1.0], [0.26, 0.17, 0.68], [0.08, 0.04, 0.22]],
        chromosphere: [0.92, 0.32, 0.82],
        innerCorona: [0.72, 0.82, 1.0],
        glare: [0.42, 0.48, 1.0],
        loopLight: [0.8, 0.86, 1.0],
        flare: [0.9, 0.94, 1.0],
        space: [0.0012, 0.0016, 0.0042],
        galaxy: {
            angle: 0.95, offset: -0.2, tint: [0.026, 0.032, 0.06], gain: 3,
        },
        comet: { head: [0.95, 0.98, 1.0], ion: [0.4, 0.75, 1.0], dust: [0.95, 0.9, 0.8] },
        reflection: [0.2, 0.36, 1.0],
        rings: {
            radius: 0.46, wide: [-1.12, -0.7], tall: [-0.78, -1.05], tilt: 0.32, ratio: 0.28, k: 1.25,
        },
        size: 0.8,
        offset: [0.32, 0.02],
        granules: 66,
        meso: 9,
        lanes: 0.45,
        grain: 0.32,
        ragged: 0.9,
        boil: 0.45,
        rotation: 300,
        spots: false,
        transit: false,
        combing: 1.25,
        reach: 1.1,
        coronaGain: 0.95,
        prominence: 0.75,
        bare: [0.92, 0.98, 1.12],
        shaftTint: [0.6, 0.7, 1.0],
        bloom: {
            strength: 0.44, radius: 0.7, threshold: 0.95, breath: 0.8,
        },
        grade: {
            shadows: [0.92, 0.94, 1.14], highlights: [0.98, 0.99, 1.04], saturation: 1.04, contrast: 1.06, vignette: 0.42,
        },
        exposure: 0.8,
    },
]);

export function createSolarWorld({ u, quality, mood = MOODS[0] }) {
    const { detail } = quality;
    // The lightest tier draws with no post pipeline, so no grade: the world warms itself instead.
    const bare = !(quality.bloom > 0);
    const { sunTint, plasmaTint, coronaTint } = tintsFor(mood);
    const rising = Boolean(mood.rising);
    const loops = rising ? RISING_LOOPS : LOOPS;
    const eruption = rising ? RISING_ERUPTION : ERUPTION;
    const arches = detail >= 0.5 ? [...loops, eruption] : loops.filter((loop) => loop.core);
    const loopSteps = detail >= 0.7 ? 7 : 5;
    const tables = createTables(arches, mood.spots);
    const color = (c) => vec3(...c);
    const SPACE = color(mood.space);
    const CHROMOSPHERE = color(mood.chromosphere);
    const INNER_CORONA = color(mood.innerCorona);
    const GLARE = color(mood.glare);
    const LOOP_LIGHT = color(mood.loopLight);
    const FLARE = color(mood.flare);
    const { granules } = mood;
    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const breath = u.breathSoft.toVar();
        // Tall screens get a bigger star: it spans most of the width and the corona fills the height.
        const tall = u.ext.y.sub(1).div(1.16).saturate().toVar();
        let radius;
        let centre;
        if (rising) {
            // The giant rises from below the frame: its crown fills the lower part of the screen
            // (more of it on a tall one, which has the height to spare).
            radius = mix(float(1.25), float(1.32), tall).toVar();
            const floorY = u.ext.y.negate().sub(u.focus);
            centre = vec2(0, floorY.add(radius.mul(mix(float(0.8), float(1.25), tall))).sub(radius)).toVar();
        } else {
            radius = mix(float(0.7), float(0.76), tall).mul(mood.size).toVar();
            // Star units: the limb at |q| = 1. Wide screens set the star a little low, so the
            // prominences on its crown have room under the top of the frame.
            centre = vec2(mix(float(mood.offset[0]), float(0), tall), mix(float(mood.offset[1] - 0.05), float(0), tall)).toVar();
        }
        const q = layer(p, u, 1).sub(centre).div(radius).toVar();
        const r = length(q).toVar();
        const dir = q.div(r.max(1e-4)).toVar();
        const above = r.sub(1).max(0).toVar();
        const pixel = u.px.div(radius).toVar();

        // Deep space: the band of the galaxy far behind, and stars the glare drowns near the star.
        const col = SPACE.toVar();
        const clearSky = smoothstep(0.12, 1.5, above).toVar();
        If(clearSky.greaterThan(0.001), () => {
            col.addAssign(galaxyBand(p, u, mood.galaxy).mul(clearSky));
        });
        col.addAssign(starfield(p, u, 0.8).mul(smoothstep(0.35, 2.2, above)));
        if (mood.reflection) {
            // A reflection nebula: blue fibres of dust lit by the star, brightest near it.
            const rq = layer(p, u, 0.12).add(u.seed.mul(vec2(5.3, 11.9))).toVar();
            const fibres = ridged(turn(rq, 0.6).mul(vec2(1.1, 3.4)).add(2.2), 4);
            const mass = smoothstep(0.38, 0.78, fbm(rq.mul(0.8).add(6.1), 3));
            const lit = float(1).div(dot(q, q).mul(0.18).add(1)).add(0.25);
            col.addAssign(color(mood.reflection).mul(fibres.mul(fibres)).mul(mass).mul(lit)
                .mul(0.07));
        }

        // The corona, by direction (vec2 noise, so no angle seam), bending a little as it climbs.
        // Streamers reach farther on tall screens, which have more sky above and below the star.
        const reach = mix(float(0.22), float(1.15), breath).mul(tall.mul(0.45).add(1)).mul(mood.reach).toVar();
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
        const combed = rayA.sub(0.5).mul(1.3 * mood.combing).add(rayB.sub(0.5).mul(0.9 * mood.combing)).add(0.6)
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
            .mul(0.6 * mood.coronaGain));
        col.addAssign(GLARE.div(above.mul(above).mul(7).add(1)).mul(breath.mul(0.04).add(0.05)));

        if (mood.shell) {
            // The dust a giant sheds: dim wisps lit by the star around it, and darker knots that
            // stand in front of its corona.
            If(r.greaterThan(1.2).and(r.lessThan(4.6)), () => {
                const s = q.mul(1.1).add(u.seed.mul(vec2(7.7, 3.1))).add(vec2(u.time.mul(0.003), 0)).toVar();
                const veil = fbm(s, 4).toVar();
                const knots = fbm(s.mul(2.3).add(5.5), 3);
                const ring = smoothstep(1.25, 1.85, r).mul(fadeOut(2.6, 4.4, r)).toVar();
                const lit = float(1).div(above.mul(above).mul(0.9).add(1));
                const wisps = smoothstep(0.46, 0.8, veil).mul(ring);
                const clumps = smoothstep(0.55, 0.76, knots).mul(smoothstep(0.42, 0.62, veil)).mul(ring);
                col.mulAssign(float(1).sub(clumps.mul(0.45)));
                col.addAssign(color(mood.shell).mul(wisps.mul(lit).mul(0.45)));
            });
        }

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
                rise,
                glow: glow.mul(mood.prominence),
                time: u.time,
                out: plasma,
                plasmaTint,
                eruption,
                curtainAt: rising ? RISING_HEDGEROW : HEDGEROW,
            };
            prominences(w, tables, flare);
            hedgerow(w, flare);
        });
        col.addAssign(plasma);

        // The photosphere, shaded only where the disc is.
        const surface = vec3(0).toVar();
        If(r.lessThan(pixel.mul(2).add(1)), () => {
            const mu = sqrt(float(1).sub(r.mul(r)).max(0)).toVar();
            const spin = u.time.mul(TAU / mood.rotation).toVar();
            const body = toBody(vec3(q.x, q.y, mu), spin).toVar();
            const ragged = gnoise3(body.mul(70)).toVar();

            // Sunspots (dark umbra, filamentary penumbra) and the flare ribbons between them: only
            // stars with spot groups pay for them.
            let umbra = float(0);
            let penumbra = float(0);
            let filaments = float(1);
            let plage = float(0);
            let flare = float(0);
            if (mood.spots) {
                const { nearest, around, seed: spotSeed } = nearestSpot(body, tables);
                const angle = around.div(length(around).max(1e-6)).toVar();
                // An irregular outline from a few harmonics of the angle around the spot (integer
                // multiples, so the atan seam never shows).
                const theta = angle.y.atan(angle.x.add(1e-6));
                const outline = sin(theta.mul(2).add(spotSeed)).mul(0.1)
                    .add(sin(theta.mul(3).add(spotSeed.mul(1.7))).mul(0.07))
                    .add(sin(theta.mul(5).add(spotSeed.mul(2.3))).mul(0.04));
                const f = nearest.mul(outline.add(1)).add(ragged.sub(0.5).mul(0.06)).toVar();
                umbra = fadeOut(0.37, 0.47, f).toVar();
                penumbra = fadeOut(0.9, 1.0, f).toVar();
                // Penumbral filaments radiate from the umbra: fine bright and dark spokes.
                filaments = gnoise(angle.mul(8).add(vec2(f.mul(0.6), spotSeed.mul(3.1))));
                plage = fadeOut(1.3, 4.5, nearest);
                // Flare ribbons light up on the in-breath and fade as the breath leaves.
                flare = flareRibbons(body, tables).mul(ragged.mul(1.2).add(0.4)).mul(smoothstep(0.3, 1.0, breath))
                    .toVar();
            }

            // Granulation: bright cells parted by dark lanes. The mesogranulation bends the cell walls
            // so granules come out rounded and uneven; where cells shrink below a few pixels (the limb,
            // small screens) they fade to an even glow instead of shimmering.
            const meso = gnoise3(body.mul(mood.meso).add(vec3(0, 0, u.time.mul(0.02)))).toVar();
            const network = gnoise3(body.mul(2.8).add(3.3)).toVar();
            const cells = voronoi3(body.mul(granules).add(meso.mul(2.4)).add(ragged.mul(mood.ragged)), u.time.mul(mood.boil))
                .toVar();
            const walls = smoothstep(0.0, mood.lanes, cells.y.sub(cells.x));
            const dome = float(1.25).sub(cells.x.mul(0.9));
            const granule = walls.mul(dome).mul(cells.z.mul(0.5).add(0.75)).toVar();
            const sharp = smoothstep(1.5, 4.0, mu.max(0.02).div(pixel.mul(granules))).mul(meso.mul(0.8).add(0.6));
            const grain = granule.sub(0.62).mul(mood.grain).mul(sharp)
                .add(meso.sub(0.5).mul(0.5))
                .add(network.sub(0.5).mul(0.4))
                .toVar();

            // Faculae: bright magnetic patches in the active belts and around spots, seen near the limb.
            const limb = float(1).sub(mu).toVar();
            const latitude = body.y.abs();
            const belt = smoothstep(0.07, 0.2, latitude).mul(fadeOut(0.42, 0.62, latitude));
            const faculae = smoothstep(0.5, 0.74, gnoise3(body.mul(26).add(8.1))).mul(granule.mul(0.6).add(0.5))
                .mul(belt.mul(0.8).add(plage)).mul(smoothstep(0.36, 0.62, network))
                .mul(limb.mul(limb.sqrt()).mul(3))
                .toVar();

            // Strong limb darkening (linear in mu) with the colour shift that goes with it: a
            // white-gold core cooling through orange to a deep red edge.
            const darkening = mu.mul(0.96).add(0.04).toVar();
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
        if (mood.spots) {
            // Coronal loops arch over the spot groups, in front of the disc and above the limb.
            If(r.lessThan(1.15), () => {
                const arcs = coronalLoops(q, u.time.mul(TAU / mood.rotation), pixel, loopSteps, tables);
                col.addAssign(LOOP_LIGHT.mul(arcs).mul(glow));
            });
        }

        // A coronal mass ejection, now and then: a bubble of plasma blooms off the limb over
        // several seconds (a bright looped front, a darker cavity, a twisted core) and fades as it
        // expands. Toward the room the screen has: the sides of a wide one, up or down on a tall
        // one, always up from a rising star. The branch is the same for every pixel.
        const cme = eventWindow(u.time, float(54), float(15), float(0.8), u.seed.mul(31.7).add(2.3)).toVar();
        If(cme.x.mul(u.life).greaterThan(0.002), () => {
            const pick = cme.z;
            const heading = rising
                ? pick.sub(0.5).mul(1.3).add(Math.PI / 2)
                : step(0.5, pick).mul(Math.PI).add(hash21(vec2(pick, 7.7)).sub(0.5).mul(1.1)).add(tall.mul(Math.PI / 2));
            const toward = vec2(cos(heading), sin(heading)).toVar();
            const grow = float(1).sub(float(1).sub(cme.y).mul(float(1).sub(cme.y))).toVar();
            const bubble = grow.mul(0.85).add(0.14).toVar();
            // A light bulb rather than a ring: stretched along its path, its legs still on the limb.
            const reachOut = bubble.mul(1.2).add(1).add(grow.mul(0.2)).toVar();
            const rel = q.sub(toward.mul(reachOut)).toVar();
            const radial = dot(rel, toward).toVar();
            const dist = length(vec2(radial.div(1.35), rel.x.mul(toward.y).sub(rel.y.mul(toward.x)))).toVar();
            const facing = radial.div(length(rel).max(1e-3));
            const texture = gnoise(rel.div(bubble).mul(2.5).add(vec2(pick.mul(37), u.time.mul(0.05))))
                .mul(gnoise(rel.div(bubble).mul(vec2(7, 9)).add(vec2(u.time.mul(0.08), pick.mul(11)))).mul(0.9).add(0.3));
            const front = dist.sub(bubble).div(bubble.mul(0.12).add(0.025));
            const shell = exp(front.mul(front).negate()).mul(smoothstep(-0.98, 0.1, facing)).mul(texture.mul(1.5).add(0.15));
            const coreAt = q.sub(toward.mul(reachOut.sub(bubble.mul(0.42)))).div(bubble).toVar();
            const coreD = length(coreAt).div(0.26);
            const strands = gnoise(coreAt.mul(7).add(pick.mul(19)));
            const knot = exp(coreD.mul(coreD).negate()).mul(strands.mul(1.4).add(0.2));
            const cavity = fadeOut(bubble.mul(0.55), bubble.mul(0.95), dist);
            const fade = cme.x.mul(u.life).div(grow.mul(1.6).add(1)).mul(float(1).sub(disc)).toVar();
            col.mulAssign(float(1).sub(cavity.mul(fade).mul(0.3)));
            col.addAssign(coronaTint(float(0.12)).mul(shell.mul(1.4)).add(plasmaTint(float(0.7)).mul(knot.mul(0.9))).mul(fade));
        });

        // A comet, now and then: a slow crossing beside the star, its blue ion tail straight away
        // from the star and its pale dust tail curving back along its path.
        const comet = eventWindow(u.time, float(80), float(32), float(0.75), u.seed.mul(23.9).add(5.4)).toVar();
        If(comet.x.mul(u.life).greaterThan(0.002), () => {
            const pick = comet.z;
            const side = step(0.5, hash21(vec2(pick, 3.3))).mul(2).sub(1).toVar();
            const sense = step(0.5, hash21(vec2(pick, 8.1))).mul(2).sub(1).toVar();
            const lane = hash21(vec2(pick, 5.9));
            const travel = comet.y.mul(2).sub(1).mul(sense).toVar();
            const across = rising ? lane.mul(0.3).add(1.22) : lane.mul(0.4).add(1.5);
            const overhead = vec2(travel.mul(1.75), (rising ? float(1) : side).mul(across.sub(travel.mul(travel).mul(0.12))));
            const sideways = vec2(side.mul(across.sub(travel.mul(travel).mul(0.15))), travel.mul(1.55));
            const upright = rising ? float(1) : step(0.5, tall);
            const head = mix(sideways, overhead, upright).toVar();
            const motion = mix(vec2(0, sense), vec2(sense, 0), upright);
            const at = layer(p, u, 1.1).sub(centre).div(radius).toVar();
            const away = head.div(length(head).max(1e-3)).toVar();
            const rel = at.sub(head).toVar();
            const along = dot(rel, away).toVar();
            const ahead = along.max(0).toVar();
            const aside = rel.x.mul(away.y).sub(rel.y.mul(away.x)).toVar();
            const ionWidth = pixel.mul(1.3).add(ahead.mul(0.025));
            const ionAt = aside.div(ionWidth);
            const ion = exp(ionAt.mul(ionAt).negate()).mul(smoothstep(-0.01, 0.03, along)).mul(exp(ahead.mul(-2.6)));
            const lag = dot(motion, vec2(away.y, away.x.negate()));
            const bent = aside.add(lag.mul(ahead.mul(ahead)).mul(0.9));
            const dustAt = bent.div(pixel.mul(2.5).add(ahead.mul(0.09)));
            const dust = exp(dustAt.mul(dustAt).negate()).mul(smoothstep(-0.01, 0.05, along)).mul(exp(ahead.mul(-3.2)));
            const d2 = dot(rel, rel);
            const coma = exp(d2.div(pixel.mul(pixel).mul(4)).negate()).mul(2.5).add(float(1).div(d2.mul(7000).add(1)).mul(0.25));
            const c = mood.comet;
            col.addAssign(color(c.head).mul(coma).add(color(c.ion).mul(ion.mul(0.55))).add(color(c.dust).mul(dust.mul(0.4)))
                .mul(comet.x.mul(u.life)));
        });

        if (mood.transit) {
            // A planet in transit: a crisp black dot, nearer than the star, its thin air lit from behind.
            const planetAt = layer(p, u, PLANET.k);
            const span = u.ext.x.add(0.2);
            const travel = fract(u.time.div(PLANET.period).add(0.43)).mul(2).sub(1).mul(span);
            const toPlanet = length(planetAt.sub(vec2(travel, radius.mul(0.5)).add(centre))).toVar();
            const planet = fadeOut(float(PLANET.radius).sub(u.px), u.px.add(PLANET.radius), toPlanet);
            const air = toPlanet.sub(PLANET.radius).div(u.px.mul(1.6));
            col.assign(mix(col, vec3(0.0015, 0.0006, 0.0005), planet));
            col.addAssign(vec3(1.0, 0.62, 0.36).mul(exp(air.mul(air).negate())).mul(disc).mul(0.35));
        }

        if (mood.rings) {
            // A ringed planet on a nearer layer, crossing the limb: its night side towards us, a thin
            // crescent of lit air on the side that faces the star, and rings that darken the disc
            // where they cross it and glow faintly (forward scattering) against the corona.
            const ring = mood.rings;
            const at = layer(p, u, ring.k).sub(centre).div(radius).toVar();
            const planetC = mix(vec2(...ring.wide), vec2(...ring.tall), tall).toVar();
            const rel = at.sub(planetC).toVar();
            const d = length(rel).toVar();
            const body = fadeOut(float(ring.radius).sub(pixel.mul(1.2)), pixel.mul(1.2).add(ring.radius), d).toVar();
            const sunward = planetC.negate().div(length(planetC)).toVar();
            const facing = dot(rel.div(d.max(1e-4)), sunward).toVar();
            const limbAt = d.sub(ring.radius).div(pixel.mul(2.4));
            const air = exp(limbAt.mul(limbAt).negate()).mul(smoothstep(-0.35, 0.9, facing));
            const halo = exp(d.sub(ring.radius).max(0).mul(-30)).mul(smoothstep(0.1, 1.0, facing)).mul(float(1).sub(body));
            const night = vec3(0.003, 0.004, 0.009).mul(facing.max(0).mul(2).add(1));
            const turned = turn(rel, -ring.tilt).toVar();
            const e = length(vec2(turned.x, turned.y.div(ring.ratio))).div(ring.radius).toVar();
            const soft = pixel.div(ring.radius * ring.ratio).mul(0.7).toVar();
            const edge = (from) => smoothstep(soft.negate().add(from), soft.add(from), e);
            const sheet = edge(1.34).mul(float(1).sub(edge(2.24)));
            const ringlets = sin(e.mul(23)).mul(0.18).add(gnoise(vec2(e.mul(9), 2.7)).mul(0.5)).add(0.55);
            const gap = edge(1.8).mul(float(1).sub(edge(1.88)));
            const density = sheet.mul(ringlets).mul(float(1).sub(gap.mul(0.9))).saturate().toVar();
            // The far half of the rings passes behind the planet, the near half in front of it.
            const shown = density.mul(mix(float(1).sub(body), float(1), step(turned.y, 0))).toVar();
            col.assign(mix(col, night, body));
            col.addAssign(INNER_CORONA.mul(air.mul(1.4).add(halo.mul(0.18))).mul(glow));
            const scatter = exp(above.mul(-1.8)).mul(0.22).add(0.035).mul(float(1).sub(disc.mul(0.8)));
            col.assign(col.mul(float(1).sub(shown.mul(0.82))).add(INNER_CORONA.mul(shown.mul(scatter)).mul(glow)));
        }

        if (bare) {
            // Stand in for the grade (fitted to what the post pipeline does to this palette).
            const luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col.assign(mix(vec3(luma), col, 1.15).max(0).mul(color(mood.bare)));
        }
        return col;
    })();

    // Light streams from the star's centre, which sits a little low on wide screens (or from the
    // crown of a rising star).
    const shafts = {
        source: [0, 0, 1],
        radius: 0.4,
        strength: 0.3,
        threshold: 0.8,
        decay: 0.95,
        length: 0.5,
        tint: mood.shaftTint,
        breath: 0.6,
    };
    return {
        backdrop,
        shafts,
        bloom: { ...mood.bloom },
        grade: { ...mood.grade },
        camera: { dolly: 0.05, drift: [0.03, 0.016], period: 60 },
        exposure: mood.exposure,
        update({ ext }) {
            const tall = Math.min(Math.max((ext.y - 1) / 1.16, 0), 1);
            if (rising) {
                const radius = 1.25 + 0.07 * tall;
                const floorY = -ext.y - u.focus.value;
                shafts.source[0] = 0;
                shafts.source[1] = floorY + radius * (0.8 + 0.45 * tall) - radius * 0.15;
            } else {
                shafts.source[0] = mood.offset[0] * (1 - tall);
                shafts.source[1] = (mood.offset[1] - 0.05) * (1 - tall);
            }
        },
    };
}
