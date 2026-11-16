/**
 * Winter — the sky.
 *
 * One dome, drawn last among the solids so it is shaded only where the sky shows: the polar
 * twilight's gradient and the last light along the horizon (wSky, which every other material
 * also uses as the colour of distance), stars and the band of the galaxy, the fires themselves
 * (wAurora) in whatever form the night has given them, the corona when they break up overhead,
 * the spiral a twist winds them into, pillars of light over the far land, the high thin cloud
 * that drifts over on some nights, the moon with its seas, and the ring of ice-light that stands
 * 22° from it when there is ice in the air.
 *
 * What only some of the sky needs is branched out, so the rest of the sky does not pay for it:
 * the moon's face is worked out on the moon, the corona, the spiral and the cloud only while
 * there is any.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    acos,
    atan,
    cameraPosition,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    step,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DEG, LOOK, MOON, RANGE_TOP, wAurora, wCorona, wHash23, wPart, wPillars, wRange, wSky, wSkyTint, wSolidMaterial, wSq,
    wSwirl, wVeil,
} from './winter-tsl.js';

/** The dome's radius (metres): inside the far plane, beyond the last fell. */
export const SKY_RADIUS = 30000;

/**
 * The band of the galaxy: a great circle that rises from the horizon left of the board and leans
 * further left as it climbs. `pole` is the circle's own axis; `along` and `rise` span it.
 */
export const GALAXY = (() => {
    const unit = (v) => {
        const l = Math.hypot(v[0], v[1], v[2]);
        return [v[0] / l, v[1] / l, v[2] / l];
    };
    const foot = [Math.sin(-17 * DEG), 0, -Math.cos(-17 * DEG)];
    const c = Math.cos(42 * DEG);
    const high = [Math.sin(-40 * DEG) * c, Math.sin(42 * DEG), -Math.cos(-40 * DEG) * c];
    const pole = unit([
        foot[1] * high[2] - foot[2] * high[1],
        foot[2] * high[0] - foot[0] * high[2],
        foot[0] * high[1] - foot[1] * high[0],
    ]);
    const rise = unit([
        pole[1] * foot[2] - pole[2] * foot[1],
        pole[2] * foot[0] - pole[0] * foot[2],
        pole[0] * foot[1] - pole[1] * foot[0],
    ]);
    return Object.freeze({ pole, along: foot, rise });
})();

/**
 * @param {object} u
 * @param {object} o
 * @param {number} o.curtains  sheets of aurora to draw
 * @param {boolean} [o.galaxy]  the band of the galaxy
 * @param {boolean} [o.lumps]   the high cloud's second, lumpier read
 * @param {boolean} [o.range]   the far range behind the fells
 */
export function createSky(u, {
    curtains = 3, galaxy = true, lumps = true, range = true,
} = {}) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const material = wSolidMaterial('WinterSky');
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.colorNode = Fn(() => {
        const raw = normalize(positionWorld.sub(cameraPosition));
        const dir = normalize(vec3(raw.x, max(raw.y, 0.0), raw.z)).toVar();
        const air = wSky(u, dir).toVar();
        const col = vec3(air).toVar();
        const low = smoothstep(0.03, 0.3, dir.y).toVar();
        // How many stars show: the hour's, and more of them on a clear night than under cloud or
        // through falling snow.
        const snowing = min(u.weather.x.mul(1.6), 1.0);
        const seen = u.stars.mul(max(float(1.42).sub(u.weather.y.mul(0.75)).sub(snowing.mul(0.2)), 0.2)).toVar();

        // ── Stars: a jittered grid on the dome, each with its own beat ──
        const sp = dir.xz.div(dir.y.add(0.55)).mul(150.0);
        const cell = floor(sp);
        const h = wHash23(cell);
        const d = length(fract(sp).sub(0.5).sub(h.xy.sub(0.5).mul(0.7)));
        const size = h.z.mul(h.z).mul(0.09).add(0.035);
        const beat = sin(u.time.mul(h.x.mul(3.0).add(1.2)).add(h.y.mul(40.0))).mul(0.3).add(0.7);
        const bright = wSq(wSq(h.z)).mul(5.0).add(0.25);
        const tone = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.9, 0.78), h.x);
        const star = smoothstep(size, size.mul(0.25), d).mul(bright).mul(beat)
            .mul(low)
            .mul(seen);
        const starlight = tone.mul(star).toVar();

        // ── The galaxy: a band of points too faint to count, a glow under them, a dark lane ──
        if (galaxy && LOOK.milkyWay > 0) {
            const across = dot(dir, vec3(...GALAXY.pole));
            const on = vec2(dot(dir, vec3(...GALAXY.along)), dot(dir, vec3(...GALAXY.rise)));
            // (Noise does only the broad things: star clouds and where the lane wanders. The band
            // itself is points, which neither blur nor crawl.)
            const clouds = u.noise(on.mul(vec2(0.9, 1.3)).add(vec2(0.23, 0.61)));
            const band = exp(wSq(across.div(0.15)).negate());
            const lane = smoothstep(0.012, 0.06, abs(across.add(clouds.a.sub(0.5).mul(0.11))));
            const rich = band.mul(smoothstep(0.25, 0.8, clouds.r).mul(0.75).add(0.25)).mul(lane.mul(0.8).add(0.2));
            const gp = dir.xz.div(dir.y.add(0.55)).mul(262.0).add(vec2(31.0, 57.0));
            const gh = wHash23(floor(gp));
            const gd = length(fract(gp).sub(0.5).sub(gh.xy.sub(0.5).mul(0.6)));
            const point = smoothstep(0.24, 0.06, gd).mul(step(gh.z, rich.mul(0.82))).mul(gh.x.mul(0.5).add(0.22));
            starlight.addAssign(mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.74), gh.y)
                .mul(point.add(rich.mul(0.035)).mul(low).mul(seen).mul(LOOK.milkyWay)));
        }

        // ── The fires ──
        // (The colour the fires have at this bearing, their own or a piece's: worked out once.)
        const tint = wSkyTint(u, dir.x.div(max(dir.z.negate(), 0.2)), u.fire).toVar();
        const fires = wAurora(u, dir, { count: curtains, fine: true, tint }).toVar();
        If(u.form2.x.greaterThan(0.004), () => {
            fires.addAssign(wCorona(u, dir, tint));
        });
        If(u.swirlA.w.greaterThan(0.004), () => {
            fires.addAssign(wSwirl(u, dir));
        });
        If(u.pillars.x.add(u.pillars.z).greaterThan(0.004), () => {
            fires.addAssign(wPillars(u, dir));
        });

        // ── The high thin cloud: it hides what is behind it, and has light of its own ──
        const hidden = float(0.0).toVar();
        const cloud = vec3(0.0).toVar();
        If(u.weather.y.greaterThan(0.012), () => {
            const veil = wVeil(u, dir, { lumps });
            hidden.assign(veil.a);
            cloud.assign(veil.rgb);
        });
        // (Stars go out behind it sooner than the fires do.)
        col.addAssign(starlight.mul(u.breath).mul(max(float(1.0).sub(hidden.mul(1.6)), 0.0)));
        col.addAssign(fires);
        col.assign(mix(col, cloud, hidden));

        // ── The far range: it stands in front of all of that ──
        if (range) {
            If(dir.y.lessThan(RANGE_TOP), () => {
                const far = wRange(u, dir, air);
                col.assign(mix(col, far.rgb, far.a));
            });
        }

        // ── The moon ──
        // The disc is drawn in the lens's image plane, so it is round wherever the frame puts it:
        // laid on the dome, a wide lens stretched it into an egg toward the corner it stands in.
        // Its radius there is the egg's short axis (tan R over the cosine of its angle off the axis).
        const cs = dot(dir, u.moonDir).toVar();
        const vD = cameraViewMatrix.mul(vec4(dir, 0.0)).xyz;
        const vM = cameraViewMatrix.mul(vec4(u.moonDir, 0.0)).xyz;
        const offAxis = max(vM.z.negate(), 0.2);
        const plane = vD.xy.div(max(vD.z.negate(), 0.05)).sub(vM.xy.div(offAxis));
        const m = plane.mul(offAxis).div(Math.tan(MOON.radius)).toVar();
        const r = length(m).toVar();
        const disc = smoothstep(1.0, 0.965, r).mul(smoothstep(0.0, 0.2, cs)).toVar();
        If(disc.greaterThan(0.0), () => {
            const limb = sqrt(max(float(1.0).sub(r.mul(r)), 0.0));
            // Its face, as the full moon's: dark seas with crisp shores, gathered in its upper half;
            // bright highlands pitted with small craters; and a young crater low down whose rays
            // run out over half the disc.
            const broadSeas = u.noise(m.mul(0.3).add(vec2(0.31, 0.62))).r;
            const smallSeas = u.noise(m.mul(0.62).add(vec2(0.13, 0.47))).a;
            const fine = u.noise(m.mul(0.5).add(vec2(0.7, 0.2))).a;
            const north = smoothstep(-0.6, 0.5, m.y.add(m.x.mul(0.2)));
            const seaField = broadSeas.mul(0.7).add(smallSeas.mul(0.3)).add(north.mul(0.14)).sub(0.07);
            const sea = smoothstep(LOOK.moonSeaFrom, LOOK.moonSeaFrom + 0.05, seaField.add(fine.sub(0.5).mul(0.08)));
            const pit = m.mul(4.2);
            const pitCell = floor(pit);
            const ph = wHash23(pitCell);
            // (A crater in one cell of four, anywhere in its cell, of any size: denser or centred,
            // they lie on a visible grid.)
            const pitD = length(fract(pit).sub(0.5).sub(ph.xy.sub(0.5).mul(0.72))).div(wSq(ph.z).mul(0.3).add(0.06));
            const has = step(0.75, fract(ph.z.mul(7.31)));
            const rim = exp(wSq(pitD.sub(1.0).div(0.25)).negate()).mul(has);
            const floorDark = smoothstep(1.0, 0.6, pitD).mul(has);
            const young = m.sub(vec2(-0.12, -0.58));
            const youngR = length(young);
            const spokes = u.noise(vec2(atan(young.y, young.x).mul(3.0), 0.43)).r;
            const rays = smoothstep(0.55, 0.85, spokes).mul(exp(youngR.mul(-2.4))).mul(smoothstep(0.06, 0.12, youngR))
                .add(exp(wSq(youngR.div(0.05)).negate()).mul(1.4));
            const highland = float(0.82).add(fine.sub(0.5).mul(0.22)).add(rim.mul(0.22)).sub(floorDark.mul(0.1));
            const albedo = mix(highland, float(LOOK.moonSea).add(fine.sub(0.5).mul(0.1)), sea).add(rays.mul(0.5));
            const face = u.moonCol.mul(albedo).mul(limb.mul(0.2).add(0.8)).mul(LOOK.moonGain);
            // (Cloud over it softens its face and keeps its own light.)
            col.assign(mix(col, face.mul(float(1.0).sub(hidden.mul(0.55))).add(cloud.mul(hidden.mul(0.55))), disc));
        });

        // ── The ring of ice-light, 22° out: sharp and red inside, soft and blue outside ──
        const away = acos(clamp(cs, -1.0, 1.0)).sub(MOON.halo);
        const inner = exp(wSq(away.div(0.55 * DEG)).negate());
        const outer = exp(max(away, 0.0).div(-2.6 * DEG));
        const ring = mix(inner, outer, smoothstep(-0.2 * DEG, 0.4 * DEG, away));
        const ringTone = mix(vec3(1.0, 0.72, 0.55), vec3(0.8, 0.92, 1.15), smoothstep(-0.4 * DEG, 1.6 * DEG, away));
        // Its dogs stand on it at the moon's own height.
        const dogs = exp(wSq(dir.y.sub(u.moonDir.y).div(0.035)).negate()).mul(2.2).add(1.0);
        const horizon = smoothstep(0.0, 0.08, dir.y);
        col.addAssign(u.moonCol.mul(ringTone).mul(ring.mul(dogs).mul(u.halo).mul(0.55)).mul(horizon));
        // A pillar of moonlight above and below the disc: plate crystals settling in the coldest
        // air. It stands only when play runs hot (a fever, a back-to-back, a perfect clear).
        const pillar = exp(wSq(m.x.div(0.5)).negate()).mul(exp(abs(m.y).div(-6.5))).mul(float(1.0).sub(disc));
        col.addAssign(u.moonCol.mul(pillar.mul(u.heat.w).mul(0.55)).mul(horizon));
        return col;
    })();
    const part = wPart('WinterSky', geometry, material, 30);
    return part;
}
