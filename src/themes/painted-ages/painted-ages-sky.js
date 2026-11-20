/**
 * Painted Ages — the sky dome.
 *
 * The hour's sky (painted-ages-light skyColour: zenith, the horizon band, the aureole and disc),
 * a deck of cumulus at the height the land's cloud shadows come from (the same reads, so every
 * shadow on the badlands belongs to a cloud overhead; its two fields slide through each other,
 * so the clouds form and melt), lit from the sun's side and glowing at the edges against it;
 * high cirrus above. In the dark hours: stars of several sizes and colours that turn about the
 * pole, the river of heaven rising out of the horizon, the moon with its halo, now and then a
 * meteor. The weather hangs a far shower's curtains under the deck.
 *
 * Drawn LAST among the opaque parts with the depth test on and no depth write, so it is shaded
 * only where the sky shows.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CLOUD_BASE, deckCover, skyColour, sunGlow,
} from './painted-ages-light.js';
import {
    columnU, paHash21, paHash22, paLuma,
} from './painted-ages-tsl.js';
import { rainbow, showerVeil, virgaVeil } from './painted-ages-events.js';

export const SKY_RADIUS = 52000;
/** The cirrus deck's height (metres) and the direction its strands stream (away, a little right). */
const CIRRUS_BASE = 8200;
const CIRRUS_AXIS = Object.freeze([0.42 / Math.hypot(0.42, 0.91), -0.91 / Math.hypot(0.42, 0.91)]);

const DEG = Math.PI / 180;
const unit = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};
const crossJs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A direction from a bearing (degrees right of the view axis) and an elevation. */
const bearingDir = (az, el) => [Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG)];

/** The celestial pole: the view looks north, the pole stands 39° up ahead (the sky turns round it). */
export const POLE = Object.freeze(unit([0, Math.sin(39 * DEG), -Math.cos(39 * DEG)]));
/**
 * The river of heaven: a great circle through a point low in the left third and one high and a
 * little left of the axis, so the band rises steeply out of the horizon beside the board. Its
 * frame: `MILKY.n` across the band, `MILKY.e` and `MILKY.f` in its plane.
 */
const milkyA = bearingDir(-23, 4);
const milkyB = bearingDir(-9, 42);
const milkyN = unit(crossJs(milkyA, milkyB));
export const MILKY = Object.freeze({
    n: Object.freeze(milkyN),
    e: Object.freeze(unit(milkyA)),
    f: Object.freeze(unit(crossJs(milkyN, milkyA))),
});
/** The moon's disc: its angular radius (radians; about twice life size, as a painter hangs it). */
export const MOON_RADIUS = 0.62 * DEG;
/** The side the moon is lit from, in its own frame (right, up, toward the eye): a gibbous moon. */
const MOON_SUN = Object.freeze(unit([-0.58, -0.3, 0.76]));

const sq = (x) => x.mul(x);

/**
 * One layer of stars: a lattice on the sphere, one star a cell, its size floored at about a
 * buffer pixel (a smaller one flickers as the view breathes) and dimmed by what the floor adds.
 * Returns the stars' light (colour × brightness).
 */
function starLayer(u, sd, cells, share, sigma, twinkle) {
    const q = sd.mul(cells);
    const cell = floor(q);
    const h = paHash21(cell.xy.add(cell.z.mul(17.31)));
    const h2 = paHash22(cell.xz.add(cell.y.mul(7.13)).add(3.7));
    const jitter = vec3(h2, fract(h.mul(57.3))).mul(0.56).add(0.22);
    const d = length(q.sub(cell.add(jitter)));
    // Magnitudes: most stars faint, a few bright (the brightest a little larger).
    const mag = smoothstep(float(1.0).sub(share), 1.0, h);
    const want = float(sigma).mul(mag.mul(0.7).add(0.65));
    const floorSize = u.pixelAngle.mul(cells).mul(0.75);
    const size = max(want, floorSize);
    const spot = exp(sq(d.div(size)).negate()).mul(sq(want.div(size)));
    // Colour by temperature: most white, some warm, some blue.
    const warm = vec3(1.0, 0.82, 0.62);
    const cool = vec3(0.72, 0.84, 1.0);
    const tint = mix(mix(vec3(1.0, 0.97, 0.94), warm, smoothstep(0.62, 0.9, h2.x)), cool, smoothstep(0.7, 0.95, h2.y));
    const blink = twinkle > 0
        ? sin(u.time.mul(h2.x.mul(1.7).add(1.3)).add(h.mul(40.0))).mul(twinkle).add(1.0 - twinkle)
        : float(1.0);
    return tint.mul(spot).mul(mag.mul(mag).mul(1.6).add(0.25)).mul(blink);
}

export function createSky(u, t, tier) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    const rich = tier.clouds > 1;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(u.eye)).toVar();
        const sky = skyColour(u, dir).toVar();
        const mu = dot(dir, u.sunDir).toVar();
        const az = atan(dir.x, dir.z.negate()).toVar();

        // ── The dark hours: stars, the river of heaven, a meteor ──
        If(u.stars.greaterThan(0.01).and(dir.y.greaterThan(-0.02)), () => {
            // The sky turns about the pole (Rodrigues), slowly by the clock and in one sweep
            // when an age wheels by.
            const pole = vec3(POLE[0], POLE[1], POLE[2]);
            const ca = cos(u.starTurn);
            const sa = sin(u.starTurn);
            const sd = dir.mul(ca).add(cross(pole, dir).mul(sa)).add(pole.mul(dot(pole, dir).mul(float(1.0).sub(ca)))).toVar();
            // Low stars drown in the horizon's air.
            const height = smoothstep(0.015, 0.2, dir.y).toVar();
            const light = starLayer(u, sd, 95.0, 0.2, 0.085, 0.3).toVar();
            // The river of heaven: a band of unresolved stars with a dark lane down it.
            const across = dot(sd, vec3(MILKY.n[0], MILKY.n[1], MILKY.n[2])).toVar();
            const band = exp(sq(across.div(0.17)).negate()).toVar();
            if (rich) {
                light.addAssign(starLayer(u, sd, 250.0, 0.42, 0.11, 0).mul(band.mul(1.6).add(0.45)));
                const along = vec2(dot(sd, vec3(MILKY.e[0], MILKY.e[1], MILKY.e[2])), dot(sd, vec3(MILKY.f[0], MILKY.f[1], MILKY.f[2])));
                const cloud = texture(t.noise, along.mul(0.9).add(vec2(across.mul(1.4), 0.17))).rgb;
                const lane = smoothstep(0.05, 0.0, abs(across.sub(cloud.r.sub(0.5).mul(0.12)))).mul(smoothstep(0.35, 0.6, cloud.g));
                const glow = band.mul(cloud.b.mul(0.9).add(0.35)).mul(float(1.0).sub(lane.mul(0.75)));
                light.addAssign(mix(vec3(0.5, 0.56, 0.8), vec3(0.85, 0.7, 0.62), cloud.g).mul(glow).mul(0.2));
            }
            sky.addAssign(light.mul(u.stars).mul(height).mul(0.95));
            // A meteor: a head running down the sky on a short bright tail.
            If(u.meteor.w.greaterThan(0.001), () => {
                // It falls toward the middle of the sky from whichever side it began on (run
                // one way only, a third of those on the far side left the frame at full strength).
                const run = vec2(u.meteor.x.sign().mul(-0.34), -0.2);
                const head = vec2(u.meteor.x, u.meteor.y).add(run.mul(u.meteor.z.mul(0.55)));
                const rel = vec2(az, dir.y).sub(head);
                const back = clamp(dot(rel, run.negate()).div(dot(run, run)), 0.0, 0.15);
                const off = length(rel.add(run.mul(back)));
                const width = max(float(0.0008), u.pixelAngle.mul(0.8));
                const streak = exp(sq(off.div(width)).negate()).mul(float(1.0).sub(back.div(0.15)));
                sky.addAssign(vec3(1.0, 0.94, 0.82).mul(streak).mul(u.meteor.w).mul(3.2));
            });
        });

        // ── The moon: a gibbous disc with its seas, and the halo the air gives it ──
        If(u.moonUp.greaterThan(0.01), () => {
            const md = u.moonDir;
            const right = normalize(cross(vec3(0.0, 1.0, 0.0), md));
            const up = cross(md, right);
            const m = vec2(dot(dir, right), dot(dir, up)).div(MOON_RADIUS).toVar();
            const facing = smoothstep(0.9, 0.97, dot(dir, md));
            const r2 = dot(m, m).toVar();
            const aa = max(u.pixelAngle.div(MOON_RADIUS), 0.02);
            const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), float(1.0).add(aa), sqrt(r2)));
            const z = sqrt(max(float(1.0).sub(r2), 0.0));
            const lit = smoothstep(-0.08, 0.22, dot(vec3(m, z), vec3(MOON_SUN[0], MOON_SUN[1], MOON_SUN[2])));
            const seas = texture(t.noise, m.mul(0.16).add(vec2(0.41, 0.23))).g;
            const face = mix(float(0.62), float(1.0), smoothstep(0.38, 0.62, seas)).mul(z.mul(0.35).add(0.65));
            // The dark limb keeps a breath of earthshine.
            const moonCol = vec3(1.0, 0.95, 0.86).mul(face).mul(lit.mul(2.6).add(0.05));
            const ang = sqrt(r2).mul(MOON_RADIUS);
            const halo = exp(ang.div(-0.016)).mul(0.5).add(exp(ang.div(-0.07)).mul(0.11));
            const low = smoothstep(-0.01, 0.05, dir.y);
            sky.addAssign(vec3(0.62, 0.72, 1.0).mul(halo).mul(u.moonUp).mul(facing)
                .mul(low));
            sky.assign(mix(sky, moonCol.mul(u.moonUp).add(sky.mul(float(1.0).sub(u.moonUp))), disc.mul(facing).mul(low)));
        });

        // ── The cumulus deck overhead (the banks on the horizon are their own part) ──
        if (tier.clouds > 0) {
            If(dir.y.greaterThan(0.004), () => {
                const tDeck = float(CLOUD_BASE).sub(u.eye.y).div(dir.y);
                const q = u.eye.xz.add(dir.xz.mul(tDeck)).toVar();
                const dens = deckCover(u, t.noise, q).toVar();
                // Edges: fine erosion of the billows.
                const fine = texture(t.noise, q.add(u.wind).div(1400.0).add(vec2(0.13, 0.71))).b;
                dens.assign(clamp(dens.mul(1.15).sub(fine.mul(0.35).mul(float(1.0).sub(dens))), 0.0, 1.0));
                // Light: how much cloud stands between this point and the sun (two taps toward it).
                const toward = normalize(u.sunDir.xz.add(vec2(1e-4, 0.0)));
                const d1 = deckCover(u, t.noise, q.add(toward.mul(700.0)));
                const d2 = deckCover(u, t.noise, q.add(toward.mul(1800.0)));
                const shade = clamp(d1.mul(0.55).add(d2.mul(0.45)).sub(dens.mul(0.25)), 0.0, 1.0);
                const lit = float(1.0).sub(shade.mul(0.85));
                // The underside takes the ground's warm light at a low sun.
                const base = mix(u.cloudShade, u.cloudLit, lit);
                // Silver lining: thin cloud against the sun glows.
                const rim = sunGlow(mu).mul(float(1.0).sub(dens).mul(dens).mul(4.0)).mul(u.glow).mul(0.9);
                // By night the moon silvers what the sun has left.
                const col = base.add(rim).add(u.moon.mul(lit).mul(1.4)).toVar();
                // A perfect clear paints the deck in the land's own strata: beds across it.
                If(u.paint.greaterThan(0.01), () => {
                    const p = q.add(u.wind);
                    const bed = texture(t.column, vec2(columnU(p.x.mul(0.011).add(p.y.mul(0.006)).sub(120.0)), 0.5)).level(4.0).rgb;
                    const painted = mix(vec3(paLuma(bed)), bed, 1.45).max(0.0);
                    col.assign(mix(col, painted.mul(paLuma(col).mul(2.3).add(0.12)), u.paint.mul(0.8)));
                });
                // Far cloud melts into the horizon's air.
                // Low in the sky a flat deck draws dashes: the banks hold the horizon instead
                // (it comes down toward the horizon only as a storm closes the sky).
                const low = mix(float(0.13), float(0.035), smoothstep(0.38, 0.7, u.cloudCover));
                const fade = exp(tDeck.div(38000.0).negate()).mul(smoothstep(low, low.add(0.14), dir.y));
                sky.assign(mix(sky, col, dens.mul(fade).mul(0.96)));
            });
        }

        // ── High cirrus ──
        // Everything the frame shows of the sky is ten or fifteen degrees up, so the cirrus deck
        // is seen at a graze thirty to fifty kilometres off and squashed six to one: its strands
        // are drawn kilometres long and hundreds of metres across, streaming away from the eye a
        // little off its axis so they converge toward the horizon. Patches of them, not a veil.
        if (rich) {
            If(dir.y.greaterThan(0.02), () => {
                const tHigh = float(CIRRUS_BASE).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tHigh)).add(u.wind.mul(1.8)).toVar();
                // Along and across the strands.
                const along = dot(p, vec2(CIRRUS_AXIS[0], CIRRUS_AXIS[1]));
                const across = dot(p, vec2(-CIRRUS_AXIS[1], CIRRUS_AXIS[0]));
                // Where there are strands at all: broad patches.
                const patchAt = vec2(along.div(70000.0), across.div(26000.0)).add(vec2(0.31, 0.77));
                const where = smoothstep(0.5, 0.72, texture(t.noise, patchAt).r);
                // The strands drift a little across their run (a straight comb reads as ruled lines).
                const bendAt = vec2(along.div(90000.0), across.div(60000.0)).add(vec2(0.6, 0.1));
                const cw = across.add(texture(t.noise, bendAt).g.sub(0.5).mul(1600.0));
                // Two sets of fibres (lattice periods 32 and 64 across the tile), the finer riding
                // on the coarser.
                const fib1 = texture(t.noise, vec2(along.div(32.0 * 18000.0), cw.div(32.0 * 950.0))).b;
                const fib2 = texture(t.noise, vec2(along.div(64.0 * 9000.0), cw.div(64.0 * 260.0)).add(0.43)).a;
                const coarse = smoothstep(0.52, 0.8, fib1);
                const strands = coarse.mul(0.7).add(smoothstep(0.6, 0.9, fib2).mul(coarse.mul(0.7).add(0.1)).mul(0.35));
                const c = clamp(where.mul(strands).mul(0.32).mul(u.cirrus), 0.0, 0.8);
                // Lit through: brightest toward the sun, the hour's cloud light elsewhere.
                const body = mix(u.cloudShade.mul(1.4).add(u.fill.mul(0.4)), u.cloudLit, 0.7);
                const col = body.add(u.glow.mul(sunGlow(mu)).mul(0.8)).add(u.moon.mul(0.9));
                const fade = exp(tHigh.div(80000.0).negate()).mul(smoothstep(0.03, 0.1, dir.y));
                sky.assign(mix(sky, col, c.mul(fade)));
            });
        }
        // Rain under the clouds: the chain's shower all along the horizon, the weather's far
        // shower as curtains on one side.
        const rainAir = u.cloudShade.mul(1.4).add(u.haze.mul(0.3));
        sky.assign(mix(sky, rainAir, showerVeil(u, dir).mul(0.55)));
        If(u.virga.y.greaterThan(0.01), () => {
            // Rain is darker than the sky behind it; it hangs from a dark base low in the sky.
            const under = smoothstep(0.19, 0.12, dir.y).mul(smoothstep(-0.02, 0.03, dir.y));
            const base = exp(sq(dir.y.sub(0.165).div(0.03)).negate()).mul(exp(sq(az.sub(u.virga.x).div(0.2)).negate())).mul(u.virga.y);
            const wetAir = u.cloudShade.mul(0.66).add(u.haze.mul(0.12));
            sky.assign(mix(sky, wetAir, max(virgaVeil(u, t.noise, az, dir.y).mul(under).mul(0.82), base.mul(0.8))));
        });
        // The bow over the valley.
        sky.addAssign(rainbow(u, dir));
        return vec4(sky, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesSky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {
        mesh,
        meshes: [mesh],
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export { max };
