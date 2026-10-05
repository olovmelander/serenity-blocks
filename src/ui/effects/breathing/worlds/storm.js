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
 * soft bokeh of distant lights. Dust motes drift through the violet light in front.
 */
import { Vector4 } from 'three/webgpu';
import {
    Fn, If, Loop, cos, exp, float, floor, fract, length, max, min, mix, select, sin, smoothstep, sqrt, step,
    uniformArray, vec2, vec3,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fresnel, gnoise, gnoise3, hash21, hash22, layer,
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

const HOT = vec3(1.0, 0.82, 1.0);
const MAGENTA = vec3(0.78, 0.26, 1.0);
const VIOLET = vec3(0.46, 0.28, 1.0);
const BLUE = vec3(0.22, 0.36, 1.0);
const NIGHT = vec3(0.0026, 0.003, 0.0068);
const DAYLIGHT = vec3(0.78, 0.85, 1.0);
/** Filament glow runs from hot pink to blue-violet, one hue per filament; its outer haze likewise. */
const PINK_GLOW = vec3(1.0, 0.2, 0.78);
const BLUE_GLOW = vec3(0.38, 0.26, 1.0);
const PINK_HAZE = vec3(0.5, 0.22, 1.0);
const BLUE_HAZE = vec3(0.2, 0.3, 1.0);
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
function bokehLayout(count) {
    const tints = [[0.26, 0.4, 1.0], [0.5, 0.36, 1.0], [0.36, 0.3, 0.95], [0.3, 0.58, 1.0]];
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
            gain: near ? 0.01 + 0.016 * glow : 0.02 + 0.05 * glow,
        };
    });
}

/** The dark room: blue-black air, a faint haze drifting through it, distant lights out of focus. */
function paintRoom(rp, u, { bokeh, octaves, horizonY }) {
    const air = layer(rp, u, 0.3).toVar();
    const drift = u.time.mul(0.012);
    const haze = fbm(air.mul(vec2(0.7, 1.25)).add(vec2(drift, drift.mul(0.4).add(3.1))), octaves).toVar();
    const col = NIGHT.mul(haze.mul(0.9).add(0.55)).toVar();
    col.addAssign(BLUE.mul(haze.sub(0.4).max(0).mul(0.012)));
    // Smoke hanging in still air settles into strata; the broad haze bends them (a cheap warp).
    const strata = fbm(air.mul(vec2(1.3, 3.2)).add(vec2(drift.mul(1.6), haze.mul(1.4))), octaves).toVar();
    const smoke = smoothstep(0.46, 0.78, strata).toVar();
    col.addAssign(BLUE.mul(smoke.mul(0.003)));
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
    return { col, smoke };
}

/**
 * The polished table: black lacquer that mirrors the room more and more toward the horizon (where
 * it meets the room without a seam), lit round the base by the globe in table coordinates, so the
 * pool of light lies flat and fades into the distance.
 */
function paintTable(g, charge) {
    const below = float(HORIZON).sub(g.y).max(1e-3).toVar();
    // Perspective: the table's depth behind each pixel, 1 under the base; and the point it shows.
    const depth = float(HORIZON - FOOT_Y).div(below).min(30).toVar();
    const tx = g.x.mul(depth).toVar();
    const tz = depth.sub(1).toVar();
    const reflect = mix(float(0.38), float(1), exp(below.mul(-3))).toVar();
    const grain = gnoise(vec2(tx.mul(1.3), depth.mul(5.5)));
    const diffuse = vec3(0.0024, 0.0022, 0.0052).mul(grain.mul(0.5).add(0.75)).toVar();
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
function paintBase(gb, pxg, glow) {
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
function studio(n, nz, charge) {
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
        u, gq, rq, pxg, light, glow, blur,
    } = ctx;
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
        u, gq, rq, light, reach, flow, coreWidth, minWidth, glowK, tailK, contact, charge, sharp,
    } = ctx;
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
    const glowTint = mix(mix(PINK_GLOW, BLUE_GLOW, branch.w), vec3(0.32, 0.34, 1.0), kc.mul(kc).mul(0.55)).toVar();
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
        u, contact, light, charge,
    } = ctx;
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
        gq, rq, nz, F, pxg, blur, light, charge,
    } = ctx;
    const env = studio(gq, nz, charge).toVar();
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

export function createStormWorld({ u, quality }) {
    const { octaves, detail } = quality;
    // Phones keep eight filaments: fewer and the globe reads as a sparse star.
    const count = Math.max(8, Math.round(14 * detail));
    const filaments = filamentData(filamentLayout(count));
    const forks = detail >= 0.6 ? 3 : 2;
    const bokeh = bokehLayout(Math.round(6 + 8 * detail));
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
        const room = paintRoom(roomP, u, { bokeh, octaves: hazeOctaves, horizonY: R.mul(HORIZON) });

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
            u, gq, rq, nz, F, pxg, blur, light, charge, glow, reach, flow, contact, sharp, ...widths,
        };
        If(rq.lessThan(1.02), () => {
            paintElectrode(ctx);
            // Thin luminous gas between the filaments, stirring slowly.
            const wisps = gnoise3(vec3(gq.mul(2.6), u.time.mul(0.05))).toVar();
            light.addAssign(VIOLET.mul(wisps.mul(wisps).mul(0.035).mul(float(1).sub(rq.mul(rq)).max(0)).mul(charge)));
            Loop(count, ({ i }) => {
                paintFilament(filaments.map((row) => row.element(i)), forks, ctx);
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
        const base = paintBase(gb, pxg, glow);
        const table = paintTable(g, charge);
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
        image.addAssign(VIOLET.mul(airGlow(rq).mul(0.04).mul(charge).mul(belowG)));
        const tableColor = table.diffuse.add(image.mul(table.reflect).mul(exp(sunk.mul(-0.5))));

        // The scene in front: room or table, then the collar ring, the glass, the base.
        const onTable = fadeOut(HORIZON - 0.004, HORIZON + 0.004, g.y);
        const col = mix(room.col, tableColor, onTable).toVar();
        col.assign(mix(col, base.ringCol, base.ring.mul(float(1).sub(belowB))));
        const glassD = glass.mul(float(1).sub(belowG)).toVar();
        col.assign(col.mul(float(1).sub(glassD.mul(float(1).sub(transmit)))).add(globeLight.mul(glassD)));
        col.assign(mix(col, base.col, base.body.mul(float(1).sub(belowB))));
        // The globe's light in the air between us and it, brightest where the haze is thick.
        const wisp = room.smoke.mul(2.6).add(0.3);
        col.addAssign(VIOLET.mul(airGlow(r).mul(0.03).mul(charge).mul(wisp)
            .mul(float(1).sub(glassD.mul(0.6)))));
        return col;
    })();

    return {
        backdrop,
        motes: {
            // Dust hanging in the violet light.
            motion: MOTE_MOTION.wander,
            count: 140,
            size: 0.009,
            speed: 0.3,
            spread: 0.92,
            band: [-1.1, 1.2],
            depth: 2.4,
            bokeh: 0.2,
            colorA: [0.72, 0.56, 1.0],
            colorB: [0.46, 0.56, 1.0],
            gain: 0.55,
        },
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
            tint: [0.85, 0.7, 1.0],
            breath: 0.75,
        },
        grade: {
            shadows: [0.94, 0.94, 1.06],
            highlights: [1.04, 0.96, 1.04],
            saturation: 1.05,
            contrast: 1.06,
            vignette: 0.5,
        },
        camera: { dolly: 0.04, drift: [0.025, 0.012], period: 60 },
        exposure: 1.0,
    };
}
