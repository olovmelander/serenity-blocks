/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Cosmic Nebula — a grand-design spiral galaxy seen through a window in a star-forming nebula.
 * Inhale: the galaxy's arms unwind and open, its core brightens and the walls of gas around it
 * draw back and glow. Exhale: the arms wind and gather inward and the walls close in again.
 *
 * The nebula is painted as banks of dust and gas at several depths, each emission + absorption,
 * composited front to back so a layer is only shaded where it can be seen. Dense dust darkens
 * everything behind it; its faces toward the galaxy burn as ionisation fronts (white-gold skins
 * over amber dust), steam streams off the lit edges, and the open gas glows teal near the light and
 * rose farther out, gold where it is densest, in a Hubble palette. Cliffs rise along the floor and
 * pillars reach up toward the light (on tall screens walls and pillars also hang from above);
 * dark lanes cross the far glow with backlit rims, and young stars embedded in the gas light
 * pools of it around them. Layers sit at different parallax depths, so the breathing camera
 * slides near banks past far ones.
 *
 * The galaxy is real geometry on the hero plane: an inclined disc mesh paints the smooth light of
 * the disc, its spiral arms, pink HII knots and dark dust lanes (emission + absorption, so a lane
 * on the near side silhouettes against the bulge), and thousands of sprites add resolved stars,
 * blue clusters along the arms and HII knots. Both share one closed-form spiral, so the painted
 * arms and the stars unwind together with the breath. The pattern turns rigidly, like a density
 * wave: it never winds itself up, however long a session runs.
 *
 * A foreground overlay, drawn after the galaxy, holds the nearest dust (dark, out of focus, in the
 * bottom corners), the nearest stars, and a few bright stars with diffraction spikes.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, atan, attribute, cos, dot, exp, float, length, log, max, mix, positionGeometry, positionWorld, sin,
    smoothstep, step, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    backdropPoint, fadeOut, fbm, fbm3, gnoise, gnoise3, layer, ridged, smin, starfield, turn,
} from '../stage/breath-tsl.js';

const TAU = Math.PI * 2;

/** The galaxy. Disc-local units: the visible disc ends near radius 1. */
const ARMS = 2;
/** Tilt of the disc plane out of edge-on (pi/2 would be face-on) and the major axis's slant. */
const TILT = 0.5;
const ROLL = -0.26;
/** Log spiral: arms wind tightly inside CORE_R and open beyond it. WIND radians per e-fold. */
const CORE_R = 0.16;
const WIND = 2.5;
/** How much of the winding the in-breath releases: the arms visibly open. */
const UNWIND = 0.75;
/** Rigid pattern speed (rad/s). Negative: the arms trail the rotation. */
const SPIN = -0.012;
/** Dust lanes ride this far (rad) inside each arm's crest, on its concave side. */
const LANE = 0.3;
const STARS = 9000;
/** Half size of the painted disc's quad (disc-local units). */
const DISC_EXTENT = 1.6;
/** Galaxy scale on screen: capped on wide screens, the width of the screen on tall ones. */
const GALAXY_SCALE = 1.16;

/** Palette (linear). Hubble-style emission lines, dust, and the galaxy's star populations. */
const VOID = vec3(0.002, 0.003, 0.009);
const H_ALPHA = vec3(1.0, 0.18, 0.4);
const OIII = vec3(0.08, 0.62, 0.78);
const SII = vec3(1.0, 0.52, 0.16);
const FRONT = vec3(1.0, 0.86, 0.62);
const AMBER = vec3(0.62, 0.26, 0.08);
const MAROON = vec3(0.11, 0.028, 0.04);
const STEAM = vec3(0.55, 0.74, 0.92);
const DUST = vec3(0.011, 0.007, 0.013);
const OLD = vec3(1.0, 0.76, 0.5);
const YOUNG = vec3(0.52, 0.68, 1.0);
const HII = vec3(1.0, 0.42, 0.62);

/** Lung fill → galaxy size (the disc swells on the in-breath). */
const swellOf = (u) => u.breathSoft.mul(0.27).add(0.86);
/** Lung fill → arm winding (radians per e-fold of radius): the arms unwind on the in-breath. */
const windOf = (u) => float(WIND).sub(u.breathSoft.mul(UNWIND));
/** How far an arm has wound at unswelled radius r0. */
const woundAt = (r0, u) => windOf(u).mul(log(r0.div(CORE_R).add(1)));

/** A narrow, cusp-free crest profile from a cosine: c^8 blended with c^4 for soft shoulders. */
const crestProfile = (c) => {
    const s = c.mul(0.5).add(0.5).max(0);
    const s2 = s.mul(s);
    const s4 = s2.mul(s2);
    return s4.mul(0.45).add(s4.mul(s4).mul(0.55));
};

/** Smooth maximum (k in the arguments' units). */
const smax = (a, b, k) => smin(a.negate(), b.negate(), k).negate();

function gauss(random) {
    const a = Math.max(random(), 1e-6);
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(TAU * random());
}

/**
 * Star populations in seeds. aOrbit: (unswelled radius, angle — from the arm crest for arm
 * stars, absolute otherwise —, on-arm flag, height above the disc). aLook: (kind 0 old · 1 young
 * · 2 HII knot, brightness, size, phase).
 */
function starSeeds(count, random) {
    const orbit = new Float32Array(count * 4);
    const look = new Float32Array(count * 4);
    let i = 0;
    const put = (r0, angle, arm, height, kind, bright, size) => {
        if (i >= count) return;
        orbit.set([r0, angle, arm, height], i * 4);
        look.set([kind, bright, size, random()], i * 4);
        i += 1;
    };
    const share = (fraction) => Math.round(count * fraction);
    // The bulge: old, warm, crowded toward the centre and puffed up out of the plane.
    for (let n = share(0.05); n > 0; n--) {
        const r0 = 0.03 + 0.24 * random() ** 1.4;
        const height = gauss(random) * 0.05 * (1 - r0 / 0.3);
        put(r0, random() * TAU, 0, height, 0, 0.1 + 0.4 * random() ** 3, 0.007 + 0.006 * random());
    }
    // The old disc: an exponential spread, faint and even.
    for (let n = share(0.17); n > 0; n--) {
        const r0 = Math.min(1.05, 0.1 - 0.3 * Math.log(1 - 0.96 * random()));
        put(r0, random() * TAU, 0, gauss(random) * 0.012, 0, 0.08 + 0.35 * random() ** 4, 0.008 + 0.006 * random());
    }
    // Pink HII knots: small clumps strung along the crests.
    for (let n = share(0.04); n > 0;) {
        const arm = Math.floor(random() * ARMS) * (TAU / ARMS);
        const rc = 0.22 + 0.74 * random();
        const offset = gauss(random) * 0.04;
        for (let m = 2 + Math.floor(random() * 5); m > 0 && n > 0; m--, n--) {
            put(
                rc + gauss(random) * 0.012,
                arm + offset + gauss(random) * 0.03,
                1,
                gauss(random) * 0.004,
                2,
                0.2 + 0.5 * random() ** 2,
                0.009 + 0.01 * random(),
            );
        }
    }
    // A thin halo of field stars beyond the disc.
    for (let n = share(0.04); n > 0; n--) {
        put(0.5 + 0.75 * random(), random() * TAU, 0, gauss(random) * 0.08, 0, 0.1 + 0.35 * random() ** 3, 0.008);
    }
    // Young blue stars, born in clusters along the arms: everything that is left.
    while (i < count) {
        const arm = Math.floor(random() * ARMS) * (TAU / ARMS);
        const rc = 0.08 + 0.92 * random();
        // Most clusters hug the crest; some stray between the arms as spurs.
        const offset = gauss(random) * (random() < 0.8 ? 0.16 : 0.5);
        for (let m = 4 + Math.floor(random() * 18); m > 0; m--) {
            put(
                Math.max(0.05, rc + gauss(random) * 0.03),
                arm + offset + gauss(random) * 0.06,
                1,
                gauss(random) * 0.01,
                1,
                0.14 + 0.86 * random() ** 6,
                0.007 + 0.014 * random() ** 3,
            );
        }
    }
    return { orbit, look };
}

/** The galaxy's resolved stars: additive sprites on the shared spiral. */
function createStars(u, count, random) {
    const seeds = starSeeds(count, random);
    const material = new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const orbit = attribute('aOrbit', 'vec4');
    const look = attribute('aLook', 'vec4');
    // Each star wobbles a little along its orbit: life without winding the pattern up.
    const wobble = sin(u.time.mul(look.w.mul(0.07).add(0.03)).add(look.w.mul(TAU))).mul(0.018);
    const wound = woundAt(orbit.x, u).mul(orbit.z);
    material.positionNode = Fn(() => {
        const angle = orbit.y.add(wound).add(u.time.mul(SPIN)).add(wobble).toVar();
        const radius = orbit.x.mul(swellOf(u)).toVar();
        return vec3(cos(angle).mul(radius), orbit.w, sin(angle).mul(radius));
    })();
    material.scaleNode = look.z.mul(u.breathSoft.mul(0.2).add(0.9));
    material.colorNode = Fn(() => {
        const kind = look.x;
        const knot = step(1.5, kind).toVar();
        const young = step(0.5, kind).sub(knot).toVar();
        const old = float(1).sub(young).sub(knot);
        // A spread of temperatures within each population.
        const warm = look.w.mul(7.3).fract();
        const tint = OLD.mul(mix(float(0.75), float(1.15), warm)).mul(old)
            .add(mix(YOUNG, vec3(0.92, 0.95, 1.0), warm.mul(0.6)).mul(young))
            .add(HII.mul(knot));
        // Stars that sit in a dust lane are dimmed by it (the painted lanes are drawn beneath).
        const phase = orbit.y.add(woundAt(orbit.x, u).mul(orbit.z.sub(1))).add(wobble);
        const lane = crestProfile(cos(phase.sub(LANE).mul(ARMS)));
        const veiled = float(1).sub(lane.mul(lane).mul(0.7).mul(smoothstep(0.1, 0.25, orbit.x))
            .mul(float(1).sub(knot)));
        const r = length(uv().sub(0.5)).mul(2);
        const sharp = mix(float(11), float(5), knot);
        const shape = exp(r.mul(r).mul(sharp).negate()).mul(fadeOut(0.72, 1, r));
        const twinkle = sin(u.time.mul(look.w.mul(0.5).add(0.2)).add(look.w.mul(41))).mul(0.12).add(0.88);
        const glow = u.breathSoft.mul(0.45).add(0.75);
        return tint.mul(shape).mul(look.y).mul(twinkle).mul(glow)
            .mul(veiled)
            .mul(1.3);
    })();
    material.opacityNode = float(1);
    const sprite = new THREE.Sprite(material);
    sprite.geometry = sprite.geometry.clone();
    sprite.geometry.setAttribute('aOrbit', new THREE.InstancedBufferAttribute(seeds.orbit, 4));
    sprite.geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(seeds.look, 4));
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 3;
    return sprite;
}

/**
 * The disc's smooth light on a quad in the disc plane: old warm disc, blue arms, pink knots, a
 * faint outer glow, and dust lanes that absorb (premultiplied: rgb is added, alpha darkens).
 */
function createDisc(u) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, depthTest: false, premultipliedAlpha: true, side: THREE.DoubleSide,
    });
    material.outputNode = Fn(() => {
        const xz = positionGeometry.xy.toVar();
        const swell = swellOf(u).toVar();
        const r0 = length(xz).div(swell).toVar();
        const spin = u.time.mul(SPIN).toVar();
        // Texture rides on the turning, swelling disc.
        const tq = turn(xz.div(swell), spin.negate()).toVar();
        const feather = fbm(tq.mul(2.3).add(7.1), 3).sub(0.5).toVar();
        // Arm phase: cos(ARMS * phase) is periodic in the angle, so atan's seam never shows. The
        // nudge keeps atan away from (0, 0), where GLSL leaves it undefined (one NaN pixel would
        // spread through the bloom).
        const phase = atan(xz.y, xz.x.add(1e-5)).sub(woundAt(r0, u)).sub(spin).add(feather.mul(0.35))
            .toVar();
        const wave = cos(phase.mul(ARMS)).toVar();
        // A broad arm of light with a narrow crest of young stars down its middle.
        const broad = wave.mul(0.5).add(0.5).max(0).toVar();
        const arm = crestProfile(wave).toVar();
        const span = smoothstep(0.05, 0.2, r0).mul(fadeOut(0.72, 1.06, r0)).toVar();
        const clumps = gnoise(tq.mul(9.0).add(2.7)).toVar();
        const strands = smoothstep(0.36, 0.7, fbm(tq.mul(7.0).add(3.3), 3));
        const laneShape = crestProfile(cos(phase.sub(LANE).mul(ARMS)));
        const lane = laneShape.mul(laneShape).mul(strands).mul(span).toVar();
        // HII knots: small pink spots strung along the crests only.
        const knots = smoothstep(0.7, 0.84, gnoise(tq.mul(26.0).add(9.1))).mul(arm.mul(arm))
            .mul(smoothstep(0.2, 0.36, r0))
            .mul(fadeOut(0.8, 1.0, r0));
        const glow = u.breathSoft.mul(0.5).add(0.7);
        const light = OLD.mul(exp(r0.mul(-3.6)).mul(0.22))
            .add(YOUNG.mul(broad.mul(broad).mul(0.35).add(arm).mul(span)
                .mul(exp(r0.mul(-1.2)))
                .mul(clumps.mul(0.9).add(0.35))
                .mul(0.5)))
            .add(HII.mul(knots.mul(0.35)))
            .add(YOUNG.mul(fadeOut(0.45, 1.4, r0).mul(0.05)))
            .mul(glow);
        // Over the bulge, only the near half of the disc stands in front of it.
        const nearSide = smoothstep(-0.06, 0.1, positionWorld.z);
        const overBulge = fadeOut(0.14, 0.32, r0);
        // The disc itself dims the nebula behind it a little: the galaxy stands in front of the gas.
        const veil = smoothstep(0.12, 0.34, r0).mul(fadeOut(0.45, 1.1, r0)).mul(0.45);
        const absorb = lane.mul(0.85).mul(mix(float(1), nearSide, overBulge)).add(veil).min(0.92);
        return vec4(light.mul(float(1).sub(lane.mul(0.8))), absorb);
    })();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(DISC_EXTENT * 2, DISC_EXTENT * 2), material);
    // The plane's (x, y) become the disc's (x, z): the same frame the star sprites use.
    mesh.rotation.x = Math.PI / 2;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
}

/**
 * How deep a point stands inside the nebula's walls: > 0 below the floor line, above the ceiling
 * or beyond the sides (lines: x = sides, y = ceiling, z = floor; slopes per wall).
 */
const wallRamp = (q, lines, slopes) => {
    const floor = q.y.negate().sub(lines.z).mul(slopes.z);
    const ceiling = q.y.sub(lines.y).mul(slopes.y);
    const sides = q.x.abs().sub(lines.x).mul(slopes.x);
    return smax(smax(floor, ceiling, 0.3), sides, 0.3);
};

/** The galaxy's light on the nebula: a broad falloff from the hero. */
const keyLight = (q) => float(1).div(dot(q, q).mul(0.9).add(1));

/** A star with a pixel-stable core and a soft halo; returns the glow and the light it sheds on gas. */
function embedded(q, at, u, { core = 2.2, halo = 300, reach = 30 } = {}) {
    const d = q.sub(at);
    const d2 = dot(d, d).toVar();
    const glow = exp(d2.div(u.px.mul(u.px).mul(core)).negate()).mul(5).add(float(1).div(d2.mul(halo).add(1)).mul(0.2));
    return { glow, light: float(1).div(d2.mul(reach).add(1)) };
}

/** A young cluster: a few blue-white stars around `at`, as offsets in hero units and brightnesses. */
const CLUSTER = [
    [0, 0, 1.0], [0.035, 0.018, 0.55], [-0.028, 0.03, 0.45], [0.012, -0.04, 0.6], [-0.05, -0.012, 0.35],
    [0.06, -0.03, 0.3], [-0.016, 0.065, 0.28],
];
function cluster(q, at, u) {
    const sum = vec3(0).toVar();
    CLUSTER.forEach(([x, y, b]) => {
        const star = embedded(q, at.add(vec2(x, y)), u, { core: 1.4 + b * 1.6, halo: 1400 / b });
        sum.addAssign(vec3(0.72, 0.84, 1.0).mul(star.glow.mul(b)));
    });
    return sum;
}

/**
 * A pillar of dust from `base` up to `tip` as a signed width (> 0 inside): a tapering column
 * with a rounded head. It continues below its base, off the bottom of the screen.
 */
function pillar(q, base, tip, w0, w1, bend = 0.04) {
    const axis = tip.sub(base).toVar();
    const len = length(axis).toVar();
    const dir = axis.div(len).toVar();
    const rel = q.sub(base).toVar();
    const along = dot(rel, dir).div(len).toVar();
    const t = along.clamp(0, 1).toVar();
    // A gentle bow along the column.
    const across = rel.x.mul(dir.y).sub(rel.y.mul(dir.x)).sub(sin(t.mul(Math.PI)).mul(bend));
    const beyond = along.sub(1).max(0).mul(len);
    // A concave taper to a slender neck, then a head a little fuller than the neck.
    const rest = float(1).sub(t);
    const crown = t.sub(0.9).div(0.09);
    const width = float(w1).add(rest.mul(rest).mul(w0 - w1)).add(exp(crown.mul(crown).negate()).mul(w1 * 0.45));
    return width.sub(length(vec2(across, beyond)));
}

/** A thin bright band where `depth` crosses `level` (gaussian: no cusp, bounded everywhere). */
const ridgeAt = (depth, level, width) => {
    const x = depth.sub(level).div(width);
    return exp(x.mul(x).negate());
};

/**
 * A bank of gas and dust at one depth, lit by the galaxy and by embedded stars. `density`
 * passes `edge` at the dust's surface. `low` is the same field without its finest octaves and
 * `toward` that coarse field a step nearer the light: faces that see the light are where density
 * rises along its path. Lighting the coarse field keeps whole faces lit coherently (the fine
 * octaves would stripe the dust along the light), while the edge keeps every octave. Rendered as
 * gas, not rock: a translucent fringe; a burning skin on the lit faces, frayed into fibres, with a
 * faint bright line at the very surface; amber light soaking into maroon dust; ionised haze
 * glowing just outside; steam streaming off the lit edges along rays from the light.
 * Returns emission and absorption.
 */
function cloudBank({
    density, low, toward, light, glow, streaks, detail, hazeTint,
    edge = 0.62, rim = 1.6, opacity = 0.96, steam = 0.5, haze = 0.22, line = 0.6, gain = 12,
    body: bodyGain = 0.3, soft = 1, shade = float(0.5),
}) {
    const exposed = low.sub(toward).mul(gain).saturate().toVar();
    const facing = exposed.mul(exposed).toVar();
    const lit = light.mul(glow).toVar();
    const depth = density.sub(edge).toVar();
    const inside = depth.max(0).toVar();
    const outside = depth.negate().max(0).toVar();
    // `soft` widens the fringe: dust near the lens is out of focus.
    const alpha = smoothstep(float(edge).sub(0.035 * soft), float(edge).add(0.13 * soft), density).mul(opacity).toVar();
    // Fine relief: the octaves the lighting field leaves out, so the detail follows the edges' own shapes.
    const relief = density.sub(low).mul(5).add(0.6).saturate()
        .toVar();
    // The skin: light penetrates a little way, broken into bright and dark fibres.
    // `shade`: small lumps lit on the side that faces the light (0.5 = flat).
    const lumps = shade.mul(0.7).add(0.65).toVar();
    const fibres = streaks.mul(0.25).add(detail.mul(0.45)).add(relief.mul(0.6)).add(0.05)
        .mul(lumps);
    // The surface line gives the edge its sculpted definition; broken up, it never reads as a crack.
    const skin = exp(inside.mul(-9)).mul(alpha).mul(fibres)
        .add(ridgeAt(depth, 0.004, 0.016).mul(detail.mul(0.6).add(0.4)).mul(line))
        .mul(facing);
    const body = mix(AMBER, MAROON, smoothstep(0.0, 0.3, inside)).mul(exp(inside.mul(-2.5)))
        .mul(detail.mul(0.6).add(relief.mul(0.9)).add(0.1))
        .mul(exposed.mul(0.5).add(0.5))
        .mul(lumps);
    const glowAbove = exp(outside.mul(-8)).mul(float(1).sub(alpha));
    const vapour = exp(outside.mul(-14)).mul(float(1).sub(alpha)).mul(streaks).mul(exposed.mul(0.8).add(0.2));
    const emission = mix(SII, FRONT, exp(inside.mul(-30))).mul(skin.mul(lit).mul(rim))
        .add(body.mul(lit).mul(alpha).mul(bodyGain))
        .add(DUST.mul(alpha))
        .add(hazeTint.mul(glowAbove.mul(lit).mul(haze)))
        .add(STEAM.mul(vapour.mul(lit).mul(steam)));
    return { emission, absorption: alpha };
}

/** Bright foreground stars: [x, y] as fractions of the half screen, parallax depth, size, tint. */
const SPIKED = [
    [-0.8, 0.6, 1.25, 1.0, [0.85, 0.9, 1.0]],
    [0.7, 0.5, 1.4, 0.7, [1.0, 0.9, 0.78]],
    [0.86, -0.36, 1.6, 0.85, [0.82, 0.9, 1.0]],
    [-0.5, -0.62, 1.3, 0.55, [1.0, 0.95, 0.9]],
    [0.2, 0.84, 1.15, 0.45, [0.9, 0.92, 1.0]],
];

/** A star with four diffraction spikes (one telescope: every star shares the spike angle). */
function spikedStar(p, u, [fx, fy, k, size, tint]) {
    const q = layer(p, u, k);
    const at = vec2(u.ext.x.mul(fx), u.ext.y.mul(fy).sub(u.focus));
    const d = turn(q.sub(at), 0.26).toVar();
    const r2 = dot(d, d).toVar();
    const reach = u.breathSoft.mul(0.5).add(0.75).mul(size * 0.18);
    // Along each spike the light falls off smoothly; across it a pixel or so wide, wider near the star.
    const spike = (along, across) => {
        const fall = along.abs().div(reach).toVar();
        const width = u.px.mul(float(0.9).add(exp(fall.mul(-6)).mul(2.2 * size)));
        return exp(across.mul(across).div(width.mul(width)).negate())
            .mul(float(0.03).div(fall.add(0.03)))
            .mul(exp(fall.mul(fall).negate()));
    };
    const spikeX = spike(d.x, d.y);
    const spikeY = spike(d.y, d.x);
    const core = exp(r2.div(u.px.mul(u.px).mul(3.0 * size)).negate()).mul(6);
    const halo = float(1).div(r2.mul(900 / size).add(1)).mul(0.18);
    return vec3(...tint).mul(core.add(halo).add(spikeX.add(spikeY).mul(1.6))).mul(size);
}

/** Paint a layer only where `needed` holds; elsewhere it is empty (no light, no dust). */
function paintWhere(needed, paint) {
    const emission = vec3(0).toVar();
    const absorption = float(0).toVar();
    If(needed, () => {
        const painted = paint();
        emission.assign(painted.emission);
        absorption.assign(painted.absorption);
    });
    return { emission, absorption };
}

/**
 * The far sky: deep stars, emission clouds threaded with bright filaments — teal close to the
 * galaxy's light, rose farther out, gold where the gas is densest —, a young cluster lighting a
 * pool of gas, and dark dust lanes across it all whose edges are lit from behind.
 */
function farSky(p, u, { glow, top, octaves }) {
    const t = u.time;
    const col = VOID.add(starfield(layer(p, u, 0.02), u, 1.0).mul(0.68)).toVar();
    const qA = layer(p, u, 0.12).toVar();
    const warpA = vec2(gnoise(qA.mul(0.6).add(vec2(t.mul(0.01), 0))), gnoise(qA.mul(0.6).add(vec2(5.2, 1.3))))
        .sub(0.5).toVar();
    const cloudA = fbm3(vec3(qA.mul(1.05).add(warpA.mul(1.6)), t.mul(0.008)), 4).toVar();
    const wispA = ridged(qA.mul(2.3).add(warpA.mul(2.4)).add(20.0), Math.max(3, octaves - 1)).toVar();
    const hueA = gnoise(qA.mul(0.45).add(40.0)).toVar();
    const lightA = keyLight(qA.mul(1.15)).toVar();
    const brightA = smoothstep(0.3, 0.85, cloudA).toVar();
    const tintA = mix(OIII, H_ALPHA, smoothstep(0.42, 0.62, hueA.add(lightA.oneMinus().mul(0.55)).sub(0.12)))
        .toVar();
    tintA.assign(mix(tintA, SII, smoothstep(0.6, 0.76, hueA).mul(smoothstep(0.45, 0.75, cloudA)).mul(0.75)));
    const clusterAt = vec2(u.ext.x.mul(-0.8), top.mul(0.72)).toVar();
    const toCluster = qA.sub(clusterAt).toVar();
    const pool = float(1).div(dot(toCluster, toCluster).mul(14).add(1)).toVar();
    col.addAssign(tintA.mul(brightA.mul(brightA).mul(wispA.mul(1.5).add(0.25)))
        .mul(lightA.mul(0.8).add(0.18).add(pool.mul(1.2))).mul(0.5).mul(glow));
    // Close to the stars the gas glows nearly white-teal.
    const nearCluster = pool.mul(pool).mul(brightA.mul(0.5).add(0.1)).mul(0.25);
    col.addAssign(mix(OIII, vec3(0.8, 0.9, 1.0), 0.5).mul(nearCluster).mul(glow));
    col.addAssign(cluster(qA, clusterAt, u).mul(glow));
    col.addAssign(starfield(layer(p, u, 0.3).add(vec2(13.7, 5.1)), u, 0.4).mul(0.6));
    // Dark lanes: sinuous filaments along one contour of a warped field; forward scattering lights
    // their edges in the colour of the glow behind them.
    const qL = layer(p, u, 0.26).toVar();
    const laneN = fbm(qL.mul(vec2(1.5, 2.1)).add(warpA.mul(0.9)).add(60.0), 4).toVar();
    const laneD = laneN.sub(0.58).abs().toVar();
    const laneMask = smoothstep(0.42, 0.62, gnoise(qL.mul(0.8).add(70.0))).toVar();
    const laneCore = fadeOut(0.018, 0.05, laneD).mul(laneMask);
    const laneRim = ridgeAt(laneD, 0.055, 0.014).mul(laneMask);
    return col.mul(float(1).sub(laneCore.mul(0.9))).add(col.mul(laneRim).mul(1.6));
}

export function createNebulaWorld({ u, quality, random }) {
    const { octaves } = quality;
    // Phones (Low) and the lightest tier skip the finest touches: the crinkled cliff edge and the
    // lit lumps inside the dust. Everything else is the same artwork.
    const fine = quality.detail > 0.6;
    const galaxyScale = uniform(GALAXY_SCALE);

    const backdrop = Fn(() => {
        const p = backdropPoint(u).toVar();
        const t = u.time;
        const glow = u.breathSoft.mul(0.55).add(0.65).toVar();
        // The walls draw back as the lungs fill.
        const open = u.breathSoft.mul(0.14).add(0.92).toVar();
        const bottom = u.ext.y.negate().sub(u.focus).toVar();
        const top = u.ext.y.sub(u.focus).toVar();
        // Tall screens hang walls from the top and the sides and sink the cliffs; wide ones keep
        // the sky open above the galaxy.
        const tall = smoothstep(1.2, 2.0, u.ext.y).toVar();

        // Composited front to back: each layer is only painted where it can be seen, and the far
        // sky only where the dust in front lets light through.
        const col = vec3(0).toVar();
        const clear = float(1).toVar();
        const behind = (layerColor) => {
            col.addAssign(layerColor.emission.mul(clear));
            clear.mulAssign(float(1).sub(layerColor.absorption));
        };

        // Pillars rising toward the light, nearest of the painted layers (on tall screens out of a
        // bank of cloud; a wide screen has no room for it).
        const qC = layer(p, u, 0.75).toVar();
        const tipL = vec2(u.ext.x.mul(-0.62), max(bottom.add(0.42), -0.72).mul(open)).toVar();
        const tipR = vec2(u.ext.x.mul(0.7), max(bottom.add(0.34), -0.86).mul(open)).toVar();
        const tipM = vec2(u.ext.x.mul(-0.36), max(bottom.add(0.28), -1.0).mul(open)).toVar();
        // On tall screens two more hang from the top wall, reaching down toward the galaxy.
        const tipH = vec2(u.ext.x.mul(0.42), float(0.78).mul(open)).toVar();
        const tipH2 = vec2(u.ext.x.mul(-0.2), float(1.02).mul(open)).toVar();
        // Bulges and kinks along each column, so no pillar is a tube.
        const lumpsC = gnoise(vec2(qC.y.mul(3.2), qC.x.mul(1.5).add(4.0))).sub(0.5).mul(0.09).toVar();
        const shapeC = (q) => {
            const rising = smax(smax(
                pillar(q, vec2(tipL.x.mul(1.3), bottom.sub(0.4)), tipL, 0.3, 0.07),
                pillar(q, vec2(tipR.x.mul(1.2), bottom.sub(0.4)), tipR, 0.34, 0.08),
                0.06,
            ), pillar(q, vec2(tipM.x.mul(1.1), bottom.sub(0.4)), tipM, 0.18, 0.045), 0.06);
            const hanging = smax(
                pillar(q, vec2(tipH.x.mul(1.25), top.add(0.4)), tipH, 0.26, 0.06, -0.05),
                pillar(q, vec2(tipH2.x.mul(1.4), top.add(0.4)), tipH2, 0.2, 0.05),
                0.06,
            );
            // A wide screen has no room above the galaxy: there the hanging pair is gone entirely.
            const columns = smax(rising, hanging.mul(tall).sub(float(1).sub(tall)), 0.06);
            // The bank they rise from rolls (the lump noise again) and stays below the frame: its lit
            // rim along the bottom edge closed the columns into a box on tall screens.
            const floor = bottom.sub(0.1).add(lumpsC.mul(2.5)).sub(q.y).mul(1.5);
            return smax(columns.add(lumpsC), floor, 0.1);
        };
        const nearC = shapeC(qC).toVar();
        const starC = embedded(qC, tipL.add(vec2(0.012, -0.03)), u, { reach: 60 });
        const starC2 = embedded(qC, tipR.add(vec2(-0.02, -0.05)), u, { reach: 90, core: 1.6 });
        col.addAssign(vec3(0.8, 0.9, 1.0).mul(starC.glow.add(starC2.glow.mul(0.6))).mul(glow));
        behind(paintWhere(nearC.greaterThan(-0.2), () => {
            const outC = qC.div(length(qC).max(0.001)).toVar();
            const warpC = vec2(gnoise(qC.mul(2.0).add(vec2(8.1, t.mul(0.01)))), gnoise(qC.mul(2.0).add(vec2(2.6, 6.4))))
                .sub(0.5).toVar();
            const densityC = (q, shape, detail) => {
                const crinkle = fbm(q.mul(vec2(6.0, 3.6)).add(warpC.mul(0.8)).add(vec2(19.0, 3.0)), detail);
                return shape.mul(4.5).add(crinkle.sub(0.5).mul(1.1)).add(0.62);
            };
            const toward = qC.sub(outC.mul(0.04)).toVar();
            const stream = gnoise3(vec3(outC.mul(14.0), length(qC).mul(3.0).sub(u.breathInt.mul(0.06))));
            const bumpAtC = (q) => gnoise(q.mul(14.0).add(warpC.mul(2.0)).add(7.7));
            const bumpC = bumpAtC(qC).toVar();
            return cloudBank({
                density: densityC(qC, nearC, octaves + 1),
                low: densityC(qC, nearC, 2),
                toward: densityC(toward, shapeC(toward), 2),
                light: keyLight(qC).mul(0.85).add(starC.light.mul(1.4)).add(starC2.light.mul(0.9)),
                glow,
                streaks: smoothstep(0.3, 0.8, stream),
                detail: smoothstep(0.3, 0.8, bumpC).mul(0.8),
                shade: fine ? bumpC.sub(bumpAtC(qC.sub(outC.mul(0.01)))).mul(4).add(0.5).saturate() : float(0.5),
                hazeTint: H_ALPHA,
                rim: 2.0,
                line: 0.2,
                steam: 0.35,
                haze: 0.12,
                body: 0.4,
            });
        }));

        // The main walls: cliffs along the floor (and on tall screens walls from the top and the
        // sides). The ramps are capped, so the deep dust breaks into holes and banks behind banks.
        const qB = layer(p, u, 0.42).toVar();
        const linesB = vec3(
            mix(u.ext.x.mul(1.3), 1.02, tall),
            mix(top.add(0.45), 1.2, tall),
            mix(float(0.6), float(1.12), tall),
        ).mul(open).toVar();
        const rampB = (q) => wallRamp(q, linesB, vec3(0.8, 0.7, 1.0)).min(0.5);
        const wallB = rampB(qB).toVar();
        const starB = embedded(qB, vec2(u.ext.x.mul(-0.55), linesB.z.negate().sub(0.06)), u, { reach: 26 });
        const starB2 = embedded(qB, vec2(u.ext.x.mul(0.5), linesB.z.negate().sub(0.16)), u, { reach: 30 });
        col.addAssign(vec3(0.78, 0.88, 1.0).mul(starB.glow.add(starB2.glow)).mul(glow).mul(clear));
        // Far above its walls the bank is clear gas whose glow has faded out: skip it there.
        behind(paintWhere(wallB.greaterThan(-0.75), () => {
            const outB = qB.div(length(qB).max(0.001)).toVar();
            const warpB = vec2(gnoise(qB.mul(0.9).add(vec2(0, t.mul(0.012)))), gnoise(qB.mul(0.9).add(vec2(4.3, 1.9))))
                .sub(0.5).toVar();
            const densityB = (q, ramp, detail) => fbm(q.mul(vec2(1.7, 1.25)).add(warpB.mul(0.9)), detail).add(ramp);
            // A fine warp crinkles the full-detail edge only; the coarse field that is lit stays smooth.
            const crinkle = fine
                ? vec2(gnoise(qB.mul(7.0).add(11.0)), gnoise(qB.mul(7.0).add(23.0))).sub(0.5).mul(0.06)
                : vec2(0);
            const toward = qB.sub(outB.mul(0.05)).toVar();
            // Steam streams along rays from the light (3D noise on the ray's direction: no seam).
            const stream = gnoise3(vec3(outB.mul(9.0), length(qB).mul(2.2).sub(u.breathInt.mul(0.05))));
            // Fine lumps, sampled again a step toward the light: lit tops, shadowed undersides.
            const bumpAt = (q) => gnoise(q.mul(12.0).add(warpB.mul(3.0))).mul(0.62)
                .add(gnoise(q.mul(27.0).add(3.1)).mul(0.38));
            const detail = bumpAt(qB).toVar();
            const shade = fine ? detail.sub(bumpAt(qB.sub(outB.mul(0.012)))).mul(4).add(0.5).saturate() : float(0.5);
            return cloudBank({
                density: densityB(qB.add(crinkle), wallB, octaves + 1),
                low: densityB(qB, wallB, 3),
                toward: densityB(toward, rampB(toward), 3),
                light: keyLight(qB).add(starB.light.mul(0.9)).add(starB2.light.mul(0.7)),
                soft: 0.7,
                shade,
                glow,
                streaks: smoothstep(0.35, 0.8, stream),
                detail: smoothstep(0.22, 0.78, detail),
                // Ionised gas glows teal near the light and rose farther out.
                hazeTint: mix(OIII, H_ALPHA, smoothstep(0.5, 1.3, length(qB))),
            });
        }));

        // Everything farther: the deep stars, the glowing gas and the dark lanes across it, faded in
        // smoothly where the dust in front starts to let light through.
        const seen = smoothstep(0.03, 0.08, clear).toVar();
        const far = vec3(0).toVar();
        If(seen.greaterThan(0), () => {
            far.assign(farSky(p, u, { glow, top, octaves }));
        });
        col.addAssign(far.mul(clear).mul(seen));

        // The galaxy's bulge and core, behind the disc (its near-side lanes cross in front).
        const g = turn(layer(p, u, 1).div(galaxyScale), -ROLL).toVar();
        const b2 = dot(vec2(g.x, g.y.div(0.62)), vec2(g.x, g.y.div(0.62))).toVar();
        const coreGlow = u.breathSoft.mul(0.6).add(0.7);
        col.addAssign(OLD.mul(exp(b2.mul(-140)).mul(0.36).add(exp(b2.mul(-22)).mul(0.1))
            .add(float(1).div(b2.mul(60).add(1)).mul(0.045)))
            .mul(coreGlow));
        col.addAssign(vec3(1.0, 0.93, 0.82).mul(exp(b2.mul(-2600)).mul(3.2)).mul(coreGlow));
        return col;
    })();

    // The nearest dust and the brightest stars, drawn over the galaxy.
    const foreground = Fn(() => {
        const p = backdropPoint(u).toVar();
        const t = u.time;
        const glow = u.breathSoft.mul(0.55).add(0.65).toVar();
        const open = u.breathSoft.mul(0.14).add(0.92).toVar();
        const bottom = u.ext.y.negate().sub(u.focus).toVar();
        const qD = layer(p, u, 1.5).toVar();
        // Dense only where it is both low and to the side: the two bottom corners.
        const corner = (q) => smin(
            q.x.abs().sub(u.ext.x.mul(0.72).mul(open)).mul(2.0),
            bottom.add(0.5).sub(q.y).mul(2.2),
            0.2,
        ).min(0.5);
        const cornerD = corner(qD).toVar();
        const near = paintWhere(cornerD.greaterThan(-0.55), () => {
            const outD = qD.div(length(qD).max(0.001)).toVar();
            const warpD = vec2(gnoise(qD.mul(1.1).add(vec2(3.3, t.mul(0.01)))), gnoise(qD.mul(1.1).add(vec2(9.6, 0.4))))
                .sub(0.5).toVar();
            const densityD = (q, ramp, detail) => fbm(q.mul(vec2(2.4, 1.8)).add(warpD).add(vec2(41.0, 17.0)), detail)
                .add(ramp);
            const toward = qD.sub(outD.mul(0.05)).toVar();
            return cloudBank({
                density: densityD(qD, cornerD, Math.max(3, octaves - 1)),
                low: densityD(qD, cornerD, 2),
                toward: densityD(toward, corner(toward), 2),
                light: keyLight(qD).mul(0.55),
                glow,
                streaks: float(0.5),
                detail: float(0.3),
                hazeTint: H_ALPHA,
                rim: 0.45,
                line: 0.5,
                opacity: 0.98,
                steam: 0.1,
                haze: 0.05,
                body: 0.05,
                soft: 2.2,
            });
        });
        // The nearest stars, in front of the galaxy: under the breathing camera they slide fastest.
        const stars = starfield(layer(p, u, 1.8).add(vec2(31.3, 17.9)), u, 0.1).mul(0.8).toVar();
        SPIKED.forEach((star) => stars.addAssign(spikedStar(p, u, star)));
        return vec4(near.emission.add(stars.mul(glow)), near.absorption);
    })();

    const overlayMaterial = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true,
    });
    overlayMaterial.vertexNode = vec4(positionGeometry.xy, 0.5, 1);
    overlayMaterial.outputNode = foreground;
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlayMaterial);
    overlay.frustumCulled = false;
    overlay.renderOrder = 10;

    // Disc-local frame: tilt the disc out of edge-on, then roll it on screen (order ZXY), so the
    // oval's long axis is the roll.
    const galaxy = new THREE.Group();
    galaxy.rotation.order = 'ZXY';
    galaxy.rotation.set(TILT, 0, ROLL);
    galaxy.add(createDisc(u));
    galaxy.add(createStars(u, Math.max(1500, Math.round(STARS * quality.motes)), random));

    return {
        backdrop,
        objects: [galaxy, overlay],
        bloom: {
            strength: 0.55, radius: 0.72, threshold: 0.6, breath: 0.5,
        },
        grade: {
            shadows: [0.92, 0.95, 1.12], highlights: [1.06, 1.0, 0.94], saturation: 1.1, contrast: 1.05, vignette: 0.4,
        },
        camera: { dolly: 0.05, drift: [0.045, 0.022], period: 72 },
        exposure: 1.0,
        update({ ext }) {
            // Wide screens cap the galaxy; tall ones fit its long axis to the screen's width.
            const scale = Math.min(GALAXY_SCALE, (ext?.x ?? 1.78) * 1.0);
            galaxy.scale.setScalar(scale);
            galaxyScale.value = scale;
        },
    };
}
