/**
 * Spring — the sky dome.
 *
 * The hour's sky (spring-light skyColour: zenith, the horizon band, the aureole) and everything
 * the weather hangs in it (spring-weather.js), from the top down:
 *
 *   stars              a few of the brightest, high up, in the light night only
 *   night-shining      noctilucent clouds: silver-blue ripples low over the north where the sun
 *   clouds             hides, in the heart of the light night (they answer a perfect clear)
 *   the veil           cirrostratus: a milky sky and a halo 22° round the sun
 *   cirrus             mares' tails, high and fast
 *   altocumulus        a mackerel sky: ripples and cells in patches, white by day, lit from below
 *                      by a low sun (the sunset's burning sky)
 *   the cumulus deck   spring cumulus drifting over the valley, lit from the sun's side and silver
 *                      at the edges against it
 *
 * Every layer is a plane the view ray meets, drifting on the wind's own clock (`u.wind`, metres,
 * integrated on the CPU at the weather's pace), each at its own speed, so the layers slide past
 * each other and the clouds form and melt instead of translating as one picture. What a weather
 * or an hour does not show is branched out, not multiplied by zero.
 *
 * Drawn LAST among the opaque parts with the depth test on and no depth write, so it is shaded only
 * where the sky shows.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    acos,
    asin,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    mix,
    normalize,
    positionWorld,
    select,
    sin,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { CLOUD_BASE, skyColour, sunGlow } from './spring-light.js';
import { TAU, spHash21, spHash22 } from './spring-tsl.js';

export const SKY_RADIUS = 20000;
/** The altocumulus layer's height and the cirrus's (metres). */
export const ALTO_BASE = 4300;
export const CIRRUS_BASE = 7600;
/**
 * The mackerel sky's pillows: how far apart its rows lie and how long a pillow is along its row
 * (metres), and the distances along the view ray over which they give way to their mean.
 */
export const ALTO = Object.freeze({ row: 560, cell: 940, far: Object.freeze([30000, 80000]) });
/** How far a great clear's crown flushes the clouds with the hour's glow (at a full crown). */
export const CROWN_FLUSH = 0.34;
/** The halo's radius round the sun (degrees), and how bright it stands in a full veil. */
export const HALO = Object.freeze({ radius: 22.4, gain: 0.24 });
/**
 * The stars: cells across a radian of sky (one star to a cell at most), the share of cells that
 * hold one, how many pixels wide a star is drawn, and the lowest they show (the sine of the height).
 */
export const STARS = Object.freeze({
    cells: 44, share: 0.15, pixels: 1.15, floor: 0.18,
});
/**
 * The night-shining clouds: the heights (sines) they stand between, how far round from the sun's
 * hidden place they reach (the cosine of the bearing between), how bright, and how close their
 * billows' ranks lie (waves per unit of the ray's slope).
 */
export const NIGHT_SHINE = Object.freeze({
    low: 0.05, high: 0.4, reach: 0.2, gain: 0.46, ranks: 46,
});

/** A cumulus field's density at a deck point (metres). */
function deckDensity(u, noise, p) {
    const a = texture(noise, p.div(9000.0)).r;
    const b = texture(noise, p.div(3400.0).add(vec2(0.37, 0.61))).g;
    const cover = a.mul(0.62).add(b.mul(0.38));
    // The same threshold the land's cloud shadows use (spring-land.js).
    const lo = float(0.82).sub(u.cloudCover.mul(0.6));
    return smoothstep(lo, lo.add(u.cloudCover.mul(0.3).add(0.12)), cover);
}

export function createSky(u, t, tier) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(u.eye)).toVar();
        const sky = skyColour(u, dir).toVar();
        const mu = dot(dir, u.sunDir).toVar();
        const sunward = sunGlow(mu).toVar();
        const alto = u.sky.x;
        const cirrus = u.sky.y;
        const veil = u.sky.z;
        const night = u.sky2.z;
        const under = u.sky2.w;
        const crown = u.sky2.y;

        // ── A few stars, high up, in the light night ──
        If(night.greaterThan(0.02).and(dir.y.greaterThan(STARS.floor)), () => {
            const el = asin(dir.y.clamp(-1.0, 1.0));
            const az = atan(dir.x, dir.z.negate());
            // (Cells shifted positive: a hash wants whole, non-negative numbers.)
            const g = vec2(az.mul(cos(el)), el).mul(STARS.cells).add(vec2(300.0, 100.0));
            const cell = floor(g).toVar();
            const h = spHash22(cell);
            const dv = g.sub(cell.add(h.mul(0.7).add(0.15)));
            const r = u.pixelAngle.mul(STARS.cells * STARS.pixels);
            const disc = exp(dot(dv, dv).div(r.mul(r)).negate());
            const mag = spHash21(cell.add(vec2(17.0, 91.0)));
            const lit = smoothstep(1.0 - STARS.share, 1.0, mag);
            const twinkle = sin(u.time.mul(mag.mul(2.2).add(1.1)).add(mag.mul(40.0))).mul(0.22).add(0.78);
            const tone = mix(vec3(1.0, 0.9, 0.78), vec3(0.8, 0.9, 1.0), h.x);
            sky.addAssign(tone.mul(disc.mul(lit.mul(lit)).mul(twinkle).mul(night).mul(0.75)
                .mul(smoothstep(STARS.floor, STARS.floor + 0.22, dir.y))));
        });

        // ── Night-shining clouds: silver-blue ripples over the north, where the sun hides ──
        If(night.greaterThan(0.02).and(dir.y.greaterThan(NIGHT_SHINE.low)), () => {
            const flat = normalize(dir.xz.add(vec2(1e-5, 0.0)));
            const toward = dot(flat, normalize(u.sunDir.xz.add(vec2(1e-5, 0.0))));
            const band = smoothstep(NIGHT_SHINE.low, NIGHT_SHINE.low * 2.4, dir.y)
                .mul(float(1.0).sub(smoothstep(NIGHT_SHINE.high * 0.55, NIGHT_SHINE.high, dir.y)))
                .mul(smoothstep(NIGHT_SHINE.reach, 0.9, toward));
            // The layer lies far above the weather: read it by the ray's slope alone (eased toward
            // the horizon, so its ripples never crowd under a pixel there).
            const q = dir.xz.div(dir.y.add(0.12)).add(vec2(u.time.mul(0.0035), u.time.mul(-0.0012))).toVar();
            const field = texture(t.noise, q.mul(0.045).add(vec2(0.2, 0.7))).toVar();
            // Where the veil lies, and the billows that run through it in close ranks, bent by it.
            const veilAt = smoothstep(0.42, 0.6, field.r.mul(0.6).add(field.g.mul(0.4)));
            const ranks = sin(q.y.mul(NIGHT_SHINE.ranks).add(q.x.mul(5.3)).add(field.b.mul(15.0))).mul(0.5).add(0.5);
            // (A second, slower set crossing them: the ranks knot and part instead of ruling the sky.)
            const cross = sin(q.x.mul(NIGHT_SHINE.ranks * 0.37).sub(q.y.mul(8.0)).add(field.a.mul(9.0)))
                .mul(0.5).add(0.5);
            const fine = smoothstep(0.3, 0.95, ranks).mul(cross.mul(0.6).add(0.4));
            const body = veilAt.mul(fine.mul(0.82).add(0.18));
            const colour = mix(vec3(0.1, 0.38, 1.0), vec3(0.5, 0.8, 1.0), fine.mul(veilAt));
            sky.addAssign(colour.mul(body.mul(band).mul(night).mul(crown.mul(1.6).add(1.0)).mul(NIGHT_SHINE.gain)));
        });

        // ── The veil: a milky sky, and a halo round the sun ──
        If(veil.greaterThan(0.01), () => {
            const milk = mix(u.horizon, u.cloudLit.mul(0.4), 0.3);
            const low = float(1.0).sub(smoothstep(-0.02, 0.6, dir.y));
            sky.assign(mix(sky, milk, veil.mul(low.mul(0.26).add(0.2))));
            const off = acos(mu.clamp(-1.0, 1.0)).mul(180 / Math.PI).sub(HALO.radius).toVar();
            // Sharp on its inner edge (red), spreading outward (blue-white).
            const ring = exp(off.mul(off).negate().div(select(off.lessThan(0.0), float(0.45), float(4.2))));
            const tint = mix(vec3(1.0, 0.7, 0.5), vec3(0.86, 0.94, 1.0), smoothstep(-0.7, 1.6, off));
            sky.addAssign(u.glow.mul(tint).mul(ring.mul(veil).mul(HALO.gain).mul(smoothstep(-1.0, 3.0, u.sunEl))));
        });

        // ── High cirrus ──
        if (tier.clouds > 1) {
            If(dir.y.greaterThan(0.02).and(cirrus.greaterThan(0.02)), () => {
                const tHigh = float(CIRRUS_BASE).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tHigh)).add(u.wind.mul(1.8));
                const streak = texture(t.noise, vec2(p.x.div(90000.0), p.y.div(18000.0)).add(vec2(0.5, 0.2))).g;
                const wisp = texture(t.noise, vec2(p.x.div(24000.0), p.y.div(4600.0))).b;
                // More of it shows as the weather thickens it (its own share at 1).
                const more = cirrus.sub(1.0).mul(0.12);
                const c = smoothstep(float(0.55).sub(more), float(0.85).sub(more), streak)
                    .mul(smoothstep(0.35, 0.75, wisp)).mul(0.42).mul(cirrus.min(1.6));
                const col = mix(u.cloudShade.mul(1.3), u.cloudLit, 0.75).add(u.glow.mul(sunward).mul(0.6))
                    .add(u.glow.mul(under.mul(0.3).add(crown.mul(CROWN_FLUSH))));
                const fade = exp(tHigh.div(52000.0).negate());
                sky.assign(mix(sky, col, c.mul(fade).min(1.0)));
            });
        }

        // ── Altocumulus: a mackerel sky ──
        If(dir.y.greaterThan(0.03).and(alto.greaterThan(0.02)), () => {
            const tMid = float(ALTO_BASE).sub(u.eye.y).div(dir.y).toVar();
            const p = u.eye.xz.add(dir.xz.mul(tMid)).add(u.wind.mul(1.35)).add(vec2(1700.0, 900.0)).toVar();
            // Where the sheet lies (broad patches), and a warp that bends its rows.
            const patch = texture(t.noise, p.div(26000.0).add(vec2(0.11, 0.53))).r;
            const warp = texture(t.noise, p.div(5600.0).add(vec2(0.71, 0.29))).toVar();
            // Rows across the wind, broken along their length into pillows: two waves, bent by the
            // warp and drifting through the patches at their own pace, so the pattern forms and
            // melts. Waves, not a noise's lattice: the cells are round and soft at any size.
            const pr = vec2(p.x.mul(0.82).add(p.y.mul(0.57)), p.y.mul(0.82).sub(p.x.mul(0.57)))
                .add(u.wind.mul(0.22)).toVar();
            const along = pr.x.div(ALTO.row / TAU).add(warp.r.mul(5.4)).toVar();
            const across = pr.y.div(ALTO.cell / TAU).add(warp.g.mul(6.2)).add(sin(along.mul(0.5)).mul(0.8));
            // (The warp's third field swells some pillows into their neighbours and starves others.)
            const pillow = sin(along).mul(0.5).add(0.5).mul(sin(across).mul(0.35).add(0.65))
                .add(warp.b.sub(0.5).mul(0.55));
            // Far off the pillows shrink under a pixel: they give way to their mean.
            const cells = mix(pillow, float(0.34), smoothstep(ALTO.far[0], ALTO.far[1], tMid)).toVar();
            const lo = float(0.7).sub(alto.mul(0.36)).toVar();
            const sheet = smoothstep(lo, lo.add(0.16), patch.add(warp.a.sub(0.5).mul(0.1))).toVar();
            const dens = sheet.mul(smoothstep(0.1, 0.5, cells)).toVar();
            const thick = sheet.mul(smoothstep(0.3, 0.85, cells));
            // By day its thin edges are white and its thick middles a little grey (we see the bases).
            const day = mix(u.cloudLit.mul(0.86), u.cloudShade.mul(1.5), thick.mul(0.5));
            // A low sun lights it from below, the thick middles the most: gold toward the sun,
            // rose and mauve round from it, with the sky's own blue between the pillows.
            const warmth = smoothstep(-0.25, 0.92, mu);
            const lift = thick.mul(0.5).add(0.7);
            const near = u.cloudLit.mul(lift).add(u.glow.mul(thick.mul(0.3).add(0.15)));
            const round = u.cloudLit.mul(vec3(0.62, 0.5, 0.85)).add(u.cloudShade.mul(0.6)).mul(lift);
            const burn = mix(round, near, warmth);
            const rim = sunward.mul(float(1.0).sub(dens).mul(dens).mul(3.0)).mul(u.glow).mul(0.8);
            const col = mix(day, burn, under).add(rim).add(u.glow.mul(crown.mul(CROWN_FLUSH)));
            const fade = exp(tMid.div(52000.0).negate()).mul(smoothstep(0.03, 0.13, dir.y));
            sky.assign(mix(sky, col, dens.mul(fade).mul(0.92)));
        });

        // ── The cumulus deck ──
        if (tier.clouds > 0) {
            If(dir.y.greaterThan(0.004), () => {
                const tDeck = float(CLOUD_BASE).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tDeck)).add(u.wind).toVar();
                const dens = deckDensity(u, t.noise, p).toVar();
                const fine = texture(t.noise, p.div(2600.0).add(vec2(0.13, 0.71)).add(u.wind.div(41000.0))).b;
                dens.assign(clamp(dens.mul(1.15).sub(fine.mul(0.32).mul(float(1.0).sub(dens))), 0.0, 1.0));
                const toward = normalize(u.sunDir.xz.add(vec2(1e-4, 0.0)));
                const d1 = deckDensity(u, t.noise, p.add(toward.mul(420.0)));
                const d2 = deckDensity(u, t.noise, p.add(toward.mul(1100.0)));
                const shade = clamp(d1.mul(0.55).add(d2.mul(0.45)).sub(dens.mul(0.25)), 0.0, 1.0);
                const lit = float(1.0).sub(shade.mul(float(0.86).sub(u.cloudCover.mul(0.4))));
                const base = mix(u.cloudShade, u.cloudLit, lit);
                const rim = sunward.mul(float(1.0).sub(dens).mul(dens).mul(4.0)).mul(u.glow).mul(0.9);
                const col = base.add(rim).add(u.glow.mul(crown.mul(CROWN_FLUSH).mul(lit)));
                const fade = exp(tDeck.div(30000.0).negate()).mul(smoothstep(0.025, 0.12, dir.y));
                sky.assign(mix(sky, col, dens.mul(fade).mul(0.95)));
            });
        }

        return vec4(sky, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringSky';
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
