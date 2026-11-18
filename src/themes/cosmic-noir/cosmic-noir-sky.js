/**
 * Cosmic Noir — the sky at the edge of the dark.
 *
 * Out here there are few stars: the night is intergalactic. What it holds is the home galaxy,
 * rising tipped over the sea's horizon as on an old observatory plate (a bright bulge, arms wound
 * as a logarithmic spiral, knots of new stars along them and dust lanes on their inner edges, the
 * near side's lane crossing the bulge), a thin scatter of foreground stars, a deep field of far
 * galaxies no bigger than smudges, and, on the horizon under the galaxy, the next lighthouse along:
 * a point that flashes twice and goes dark, and answers ours.
 *
 * Everything is a function of a direction, so the same sky stands behind the sea's mist at the
 * horizon. Grey light, scene-linear.
 */

import {
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
    fract,
    int,
    length,
    log,
    log2,
    max,
    min,
    pow,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';
import {
    DEG, FAR_LAMP, GALAXY, PULSAR, cnBeam, cnHash23,
} from './cosmic-noir-tsl.js';

/**
 * The cloud: a deck this far over the eye, one tile of its shapes this many scene units across,
 * its detail on a tile this share of that, dissolving into the horizon's haze over this reach.
 */
export const CLOUD = Object.freeze({
    height: 34, tile: 230, fine: 0.29, fade: 520,
});
/** How far the cloud's two fields run a second (tiles of each, along x and z): they slide through each other, so its shapes change. */
export const CLOUD_RATES = Object.freeze([-0.0056, -0.0041, -0.019, -0.031]);
/** A fork of lightning: how high it starts (the sine of its altitude) and how far off its own bearing it is still drawn. */
const BOLT = Object.freeze({ top: 0.5, wide: 0.42 });

/** The share of a lattice cell a far star spans on a desktop frame. */
const STAR_SPREAD = 0.22;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};

/** The galaxy's frame on the sky: where it stands, and its long and short axes there. */
export function galaxyFrame() {
    const b = GALAXY.bearing * DEG;
    const a = GALAXY.altitude * DEG;
    const dir = [Math.sin(b) * Math.cos(a), Math.sin(a), -Math.cos(b) * Math.cos(a)];
    const right = unit(cross(dir, [0, 1, 0]));
    const up = cross(right, dir);
    const c = Math.cos(GALAXY.lean * DEG);
    const s = Math.sin(GALAXY.lean * DEG);
    return {
        dir,
        major: right.map((v, i) => v * c + up[i] * s),
        minor: right.map((v, i) => -v * s + up[i] * c),
    };
}

/** The far lighthouse's direction (unit). */
export const FAR_LAMP_DIR = Object.freeze((() => {
    const b = FAR_LAMP.bearing * DEG;
    const a = FAR_LAMP.altitude * DEG;
    return [Math.sin(b) * Math.cos(a), Math.sin(a), -Math.cos(b) * Math.cos(a)];
})());

/** The direction the galaxy's light comes from (unit): the sea's and the tower's rim light. */
export const GALAXY_DIR = Object.freeze(galaxyFrame().dir);

const v3 = (a) => vec3(a[0], a[1], a[2]);

/** Far stars on one lattice of the sky: light summed over the cell a direction falls in. */
const starLayer = (dir, scale, seed, spread) => {
    const p = dir.mul(scale).add(seed);
    const cell = floor(p);
    const f = fract(p).sub(0.5);
    const h = cnHash23(cell.xy.add(cell.z.mul(vec2(37.0, 17.0))));
    const g = cnHash23(cell.xy.add(cell.z.mul(vec2(-11.0, 53.0))).add(4.7));
    const at = vec3(h.x, h.y, g.x).sub(0.5).mul(0.7);
    const away = length(f.sub(at));
    // A few bright ones, a great many faint ones.
    const mag = pow(h.z, 12.0).mul(2.6).add(pow(g.y, 4.0).mul(0.07));
    const core = float(1.0).sub(smoothstep(0.0, spread, away));
    return core.mul(core).mul(mag);
};

/**
 * The deep field: in a share of one lattice's cells, a far galaxy seen as a small spindle of
 * light, each at its own tilt (a random axis in space: face-on ones are round, edge-on ones
 * needles).
 */
const deepField = (dir, scale) => {
    const p = dir.mul(scale).add(vec3(71.3, 19.7, 43.1));
    const cell = floor(p);
    const f = fract(p).sub(0.5);
    const h = cnHash23(cell.xy.add(cell.z.mul(vec2(23.0, 61.0))).add(11.0));
    const g = cnHash23(cell.xy.add(cell.z.mul(vec2(-29.0, 7.0))).add(2.3));
    const q = f.sub(vec3(h.x, h.y, g.x).sub(0.5).mul(0.5));
    const axis = vec3(g.y, g.z, h.z).sub(0.5).normalize();
    const lengthwise = dot(q, axis);
    const across2 = max(dot(q, q).sub(lengthwise.mul(lengthwise)), 0.0);
    const size = h.z.mul(0.05).add(0.035);
    const e2 = lengthwise.mul(lengthwise).add(across2.mul(9.0)).div(size.mul(size));
    const there = smoothstep(0.86, 0.9, g.z.mul(0.5).add(h.x.mul(0.5)).add(h.y.mul(0.37)));
    return exp(e2.negate()).add(exp(e2.mul(-6.0)).mul(1.4)).mul(there).mul(h.y.mul(0.03).add(0.012));
};

/**
 * The sky's light along a direction. Call inside a Fn (it branches).
 * @param {object} u       the shared uniforms
 * @param {object} ray     unit direction (a var)
 * @param {object} options
 * @param {number} options.layers   lattices of far stars
 * @param {boolean} options.detail  the galaxy's fine dust and knots, and the deep field
 * @param {boolean} options.stars   false = the air's own light only (what the sea's mist takes)
 * @param {boolean} options.weather the cloud, the lightning in it and a fork of lightning
 */
export function cnSky(u, ray, {
    layers = 3, detail = true, stars = true, weather = stars,
} = {}) {
    // The dark itself, and a faint band where the sea's mist meets it.
    const band = exp(ray.y.abs().mul(-11.0));
    const sky = float(0.0009).add(band.mul(0.0052)).toVar();

    if (stars) {
        for (let i = 0; i < layers; i++) {
            const scale = [150, 96, 60][i];
            const want = u.pixelAngle.mul(scale * 1.25);
            const spread = min(want, 0.4);
            const thin = min(float(STAR_SPREAD).div(want), 1.0);
            sky.addAssign(starLayer(ray, scale, vec3(13.3 * (i + 1), 5.1 * (i + 2), 9.7 * (i + 3)), spread).mul(thin.mul(thin)).mul(u.stars));
        }
        if (detail) sky.addAssign(deepField(ray, 31.0).mul(u.stars));
    }

    // ── The next light, far out on the horizon: a point, its glow, and the mist round it ──
    const far = FAR_LAMP_DIR;
    const offLamp = length(ray.sub(vec3(far[0], far[1], far[2]))).toVar();
    If(offLamp.lessThan(0.2), () => {
        const core = offLamp.div(u.pixelAngle.mul(1.7));
        const glow = offLamp.div(0.0045);
        sky.addAssign(u.farLamp.mul(
            exp(core.mul(core).negate()).mul(1.5)
                .add(float(0.05).div(glow.mul(glow).add(1.0)))
                .add(exp(offLamp.mul(-55.0)).mul(0.006)),
        ));
    });

    // ── The galaxy ──
    const frame = galaxyFrame();
    const G = v3(frame.dir);
    const toward = dot(ray, G).toVar();
    If(toward.greaterThan(0.5), () => {
        const reach = Math.tan((GALAXY.span * DEG) / 2);
        const q = vec2(dot(ray, v3(frame.major)), dot(ray, v3(frame.minor))).div(toward).div(reach).toVar();
        const a = q.x;
        const b = q.y.div(Math.cos(GALAXY.tilt * DEG)).toVar();
        const r2 = a.mul(a).add(b.mul(b)).toVar();
        // The round bulge and the halo are measured on the sky, not in the disc.
        const rb = sqrt(q.x.mul(q.x).add(q.y.mul(q.y).mul(2.6))).toVar();
        const light = float(0.0).toVar();
        // Dust in front of the bulge: the near side's lanes cross it.
        const veil = float(0.0).toVar();
        If(r2.lessThan(3.2), () => {
            const r = sqrt(r2).toVar();
            const phi = atan(b, a);
            const broad = u.smokeFar(vec3(a.mul(0.5).add(0.31), b.mul(0.5).add(0.17), 0.43)).toVar();
            const wind = log(r.add(0.06)).mul(2.7);
            const phase = phi.sub(wind).mul(2.0).add(broad.r.sub(0.5).mul(1.7)).toVar();
            const arm = cos(phase).mul(0.5).add(0.5).toVar();
            const inArms = smoothstep(0.07, 0.24, r).mul(float(1.0).sub(smoothstep(0.7, 1.3, r))).toVar();
            const disc = exp(r.mul(-3.5)).toVar();
            const lit = disc.mul(float(0.15).add(arm.mul(arm).mul(1.55).mul(inArms))).toVar();
            // The lanes ride the arms' inner edges; the near side (below the long axis) shows them most.
            const lane = cos(phase.add(1.1)).mul(0.5).add(0.5);
            const near = float(1.0).sub(smoothstep(-0.3, 0.3, b));
            const dust = smoothstep(0.45, 0.95, lane).mul(inArms).toVar();
            if (detail) {
                const fine = u.smoke(vec3(a.mul(1.6), b.mul(1.6), 0.71)).toVar();
                // Clouds of stars along the arms, and the lanes frayed into dark threads.
                lit.mulAssign(fine.r.mul(0.75).add(fine.b.mul(0.45)).add(0.35));
                dust.mulAssign(fine.g.mul(1.3).add(0.35));
                // Knots of new stars: points strung along the arms, one to a cell of the disc.
                const at = vec2(a, b).mul(30.0);
                const cell = floor(at);
                const h = cnHash23(cell.add(vec2(127.0, 311.0)));
                const away = fract(at).sub(h.xy.mul(0.7).add(0.15));
                const size = h.z.mul(0.05).add(0.035);
                const chance = arm.mul(arm).mul(inArms).mul(0.55);
                const there = clamp(fract(h.z.mul(7.31).add(h.x)).add(chance).sub(1.0).mul(30.0), 0.0, 1.0);
                lit.addAssign(exp(dot(away, away).div(size.mul(size)).negate()).mul(there).mul(disc.mul(2.2).add(0.12)));
            }
            // (The lanes thin out with the disc: its faint outskirts are not torn by them.)
            const tau = dust.mul(near.mul(1.5).add(0.5)).mul(exp(r.mul(-0.8))).mul(1.5)
                .mul(float(1.0).sub(smoothstep(0.4, 0.95, r)));
            veil.assign(tau);
            light.assign(lit.mul(exp(tau.negate())).mul(float(1.0).sub(smoothstep(1.0, 1.6, r))));
        });
        const bulge = exp(rb.mul(-9.5)).mul(1.5).add(exp(rb.mul(-34.0)).mul(4.5));
        light.addAssign(bulge.mul(exp(veil.mul(-0.75))));
        light.addAssign(exp(rb.mul(-2.4)).mul(0.035));
        sky.addAssign(light.mul(GALAXY.gain).mul(u.galaxy).mul(clamp(toward.sub(0.5).mul(8.0), 0.0, 1.0)));
    });

    if (weather) {
        // ── Meteors: each a streak from its tail's end to its head, brightest at the head ──
        Loop({
            start: int(0), end: u.meteorCount, type: 'int', condition: '<', name: 'm',
        }, ({ m }) => {
            const head = u.meteors.element(m.mul(2));
            const tail = u.meteors.element(m.mul(2).add(1));
            const pa = ray.sub(tail.xyz).toVar();
            const ba = head.xyz.sub(tail.xyz).toVar();
            const along = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0.0, 1.0).toVar();
            const off = length(pa.sub(ba.mul(along)));
            const wide = max(tail.w, u.pixelAngle.mul(1.2));
            const x = off.div(wide);
            const toHead = length(ray.sub(head.xyz)).div(wide.mul(1.25));
            sky.addAssign(head.w.mul(
                exp(x.mul(x).negate()).mul(along.mul(along).mul(0.8).add(along.mul(0.2)))
                    .add(exp(toHead.mul(toHead).negate()).mul(0.9)),
            ));
        });

        // ── The cloud: a deck over the sea, seen from under ──
        // Dark against the galaxy and the stars (it is a shape before it is a light), silvered
        // where it is thin near the galaxy, modelled by which way each fold faces it, lit from
        // inside by lightning, and found by the beam that searches the sky.
        If(u.cloud.greaterThan(0.01).and(ray.y.greaterThan(0.004)), () => {
            const up = max(ray.y, 0.02).toVar();
            const reach = float(CLOUD.height).div(up).toVar();
            const at = ray.xz.mul(reach).toVar();
            // (A pixel spans a long reach of the deck where it looks along it.)
            const foot = reach.mul(u.pixelAngle).div(up).toVar();
            const a = u.sea(
                at.div(CLOUD.tile).add(u.cloudDrift.xy),
                max(log2(foot.mul(u.seaSize / CLOUD.tile)), 0.0),
            ).toVar();
            const b = u.sea(
                at.div(CLOUD.tile * CLOUD.fine).add(u.cloudDrift.zw),
                max(log2(foot.mul(u.seaSize / (CLOUD.tile * CLOUD.fine))), 0.0),
            ).toVar();
            const field = a.r.mul(0.6).add(b.r.mul(0.3)).add(a.a.sub(0.5).mul(0.8)).toVar();
            const edge = float(0.66).sub(u.cloud.mul(1.42));
            const body = smoothstep(edge, edge.add(0.46), field).toVar();
            const thick = body.mul(exp(reach.div(-CLOUD.fade))).toVar();
            const through = exp(thick.mul(-3.4)).toVar();
            // Which way this fold of it faces the galaxy (the field's own slope, along the galaxy's bearing).
            const gFlat = Math.hypot(frame.dir[0], frame.dir[2]) || 1;
            const relief = clamp(
                a.g.mul(frame.dir[0] / gFlat).add(a.b.mul(frame.dir[2] / gFlat)).mul(-0.11).add(0.5)
                    .add(b.g.mul(frame.dir[0] / gFlat).add(b.b.mul(frame.dir[2] / gFlat)).mul(-0.03)),
                0.0,
                1.0,
            );
            const nearGalaxy = exp(toward.sub(1.0).mul(7.0));
            const lining = body.mul(float(1.0).sub(body)).mul(4.0);
            const offFlash = ray.sub(u.flashDir);
            const inside = exp(dot(offFlash, offFlash).mul(-5.0)).mul(1.2).add(0.07);
            // Where the beam that searches the sky finds its base.
            const base = vec3(at.x, CLOUD.height, at.y).sub(u.pulsar).toVar();
            const away = max(length(base), 1.0);
            const found = cnBeam(base.div(away), u.beam).mul(u.beamGain)
                .div(away.mul(away).div(PULSAR.beamReach * PULSAR.beamReach).add(1.0));
            const lit = u.skyGlow.mul(relief.mul(0.42).add(0.1))
                .add(u.galaxy.mul(nearGalaxy).mul(lining.mul(0.045).add(relief.mul(0.012))))
                .add(u.flash.mul(inside).mul(relief.mul(0.7).add(0.5)))
                .add(found.mul(0.02));
            sky.assign(sky.mul(through).add(lit.mul(float(1.0).sub(through))));
        });

        // ── A fork of lightning, from the cloud to the sea ──
        If(u.bolt.y.greaterThan(0.002).and(ray.y.lessThan(BOLT.top)), () => {
            const bearing = atan(ray.x, ray.z.negate());
            const off = bearing.sub(u.bolt.w).toVar();
            If(abs(off).lessThan(BOLT.wide), () => {
                const tri = (x) => fract(x).sub(0.5).abs().mul(4.0)
                    .sub(1.0);
                const fall = float(BOLT.top).sub(ray.y).toVar(); // 0 at its head, growing down to the sea
                const s = fall.mul(9.0).add(u.bolt.z.mul(37.0)).toVar();
                // Its channel: a walk of three scales, wider the further it has fallen.
                const walk = tri(s).mul(0.034)
                    .add(tri(s.mul(2.63).add(1.3)).mul(0.016))
                    .add(tri(s.mul(7.1).add(0.5)).mul(0.006))
                    .mul(fall.mul(1.6).add(0.35));
                const lean = fall.mul(u.bolt.z.sub(0.5).mul(0.3));
                const wide = u.pixelAngle.mul(1.5);
                const dMain = abs(off.sub(walk).sub(lean)).toVar();
                // A fork leaves it part-way down and dies before the sea.
                const from = fall.sub(0.17).toVar();
                const forked = from.mul(u.bolt.z.sub(0.5).sign().mul(0.55).add(tri(s.mul(1.9).add(4.1)).mul(0.06)));
                const dFork = abs(off.sub(walk).sub(lean).sub(forked)).toVar();
                const alive = smoothstep(0.0, 0.02, from).mul(float(1.0).sub(smoothstep(0.12, 0.26, from)));
                const line = (d) => exp(d.mul(d).div(wide.mul(wide)).negate()).mul(5.0)
                    .add(float(0.003).div(d.add(0.004)));
                sky.addAssign(u.bolt.y.mul(line(dMain).add(line(dFork).mul(alive).mul(0.55))));
            });
        });
    }
    return sky;
}
