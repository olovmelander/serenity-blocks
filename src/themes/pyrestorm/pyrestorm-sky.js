/**
 * Pyrestorm — the sky dome.
 *
 * The watch's night: zenith to horizon, the dusk's afterglow (or the dawn's rose) low on its own
 * bearing, the haze over the country warmed where the lava glows under it, the eruption's own
 * glow on the air round the summit, stars and the Milky Way over the clear, upwind side (the
 * anvil, drawn in front, roofs the rest), and the moon: a fat crescent with earthshine on its dark
 * limb and a halo in the ash haze, rising amber over the volcano's left shoulder and whitening as
 * it climbs (pyrestorm-hours.js).
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
    dot,
    exp,
    float,
    floor,
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
import { CRATER, EYE, FISSURE } from './pyrestorm-core.js';
import { pyHash21, pyHash22, wideGlowAt } from './pyrestorm-tsl.js';

export const SKY_RADIUS = 85000;
/** The moon's disc: its radius on the sky (radians; about three times the real one, as a long lens draws it). */
export const MOON_RADIUS = 0.0125;
/** Toward the sun in the disc's own frame (right, up, toward the eye): lower left, behind the moon. */
const MOON_SUN = (() => {
    const v = [-0.78, -0.42, -0.46];
    const l = Math.hypot(v[0], v[1], v[2]);
    return Object.freeze(v.map((c) => c / l));
})();

/** The sky's colour along a direction (no stars): what the haze and the anvil's edges melt into. */
export function skyColour(u, t, dir) {
    const el = dir.y;
    const up = smoothstep(-0.02, 0.55, el);
    const base = mix(u.horizon, u.zenith, up.mul(up.mul(-0.4).add(1.4)).clamp(0.0, 1.0)).toVar();
    // The dusk (or dawn) low on its bearing.
    const bearing = atan(dir.x, dir.z.negate());
    const db = bearing.sub(u.duskBearing);
    const band = exp(abs(db).mul(-1.15)).mul(exp(max(el, 0.0).div(-0.09)));
    base.addAssign(u.dusk.mul(band));
    // Haze over the country: warm where the lava glows below it (the far field's wide glow,
    // read where this line meets a layer of smoke two kilometres up).
    const tSmoke = float(2000.0).sub(u.eye.y).div(max(el, 0.012));
    const at = u.eye.xz.add(dir.xz.mul(tSmoke.min(60000.0)));
    const g = wideGlowAt(t, at);
    base.addAssign(u.fireColour.mul(g.mul(0.075).mul(u.activity)).mul(exp(max(el, 0.0).div(-0.05))));
    return base;
}

export function createSky(u, t) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 64, 32);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    const volcanoBearing = Math.atan2(CRATER.x, -CRATER.z);
    const fissureBearing = Math.atan2((FISSURE.a[0] + FISSURE.b[0]) / 2, -(FISSURE.a[1] + FISSURE.b[1]) / 2);
    // From the eye (it never leaves its ridge) toward a point a little over the crater.
    const craterDir = new THREE.Vector3(CRATER.x - EYE.x, CRATER.y + 420 - EYE.y, CRATER.z - EYE.z).normalize();
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(u.eye)).toVar();
        const sky = skyColour(u, t, dir).toVar();
        const bearing = atan(dir.x, dir.z.negate());
        // The eruption's glow on the low smoke over the vents.
        const lobe = exp(abs(bearing.sub(volcanoBearing)).mul(-4.0)).mul(1.0)
            .add(exp(abs(bearing.sub(fissureBearing)).mul(-6.0)).mul(0.4));
        sky.addAssign(u.fireColour.mul(lobe.mul(0.05).mul(u.activity)).mul(exp(max(dir.y, 0.0).div(-0.06))));
        // And on the air round the summit itself: a dome of lit haze about the fountain, wider and
        // brighter as it climbs and as a burst glows (two lobes: a tight one, a broad one).
        const fromCrater = length(dir.sub(craterDir));
        const dome = exp(fromCrater.div(-0.055)).mul(0.55).add(exp(fromCrater.div(-0.2)).mul(0.16));
        sky.addAssign(u.fireColour.mul(dome.mul(u.fountain.mul(0.075).add(u.burst.mul(0.05)).add(0.012)).mul(u.activity)));

        If(dir.y.greaterThan(-0.01), () => {
            // Where the moon's disc is (its face is shaded further down): nothing shines through it.
            const off = dir.sub(u.moonDir);
            const lx = dot(off, u.moonRight).div(MOON_RADIUS).toVar();
            const ly = dot(off, u.moonUp).div(MOON_RADIUS).toVar();
            const r2 = lx.mul(lx).add(ly.mul(ly)).toVar();
            const away = sqrt(r2).toVar();
            const rim = u.pixelAngle.div(MOON_RADIUS).mul(1.5).max(0.02);
            const disc = float(1.0).sub(smoothstep(float(1.0).sub(rim), float(1.0).add(rim), away)).mul(u.moonShow).toVar();
            // ── Stars: a lattice on the sphere, one star a cell, two sizes ──
            const starLayer = (scale, keep, gain, size = 0.9) => {
                const q = dir.mul(scale);
                const cell = floor(q);
                const h = pyHash21(cell.xy.add(cell.z.mul(17.31)));
                const jitter = vec3(pyHash22(cell.xz.add(3.7)), h).mul(0.56).add(0.22);
                const d = length(q.sub(cell.add(jitter)));
                // A star is about a pixel wide whatever the lens; a few of a layer's are bright ones,
                // wider and several times the light, so the sky is not one size of salt.
                const big = smoothstep(0.984, 1.0, h);
                const px = u.pixelAngle.mul(scale).mul(big.mul(0.75).add(size)).max(0.05);
                const bright = smoothstep(keep, 1.0, h).mul(big.mul(2.4).add(1.0)).mul(exp(d.div(px).mul(d.div(px)).negate()));
                const twinkle = sin(u.time.mul(h.mul(3.0).add(1.4)).add(h.mul(90.0))).mul(0.25).add(0.75);
                const tint = mix(vec3(1.0, 0.82, 0.7), vec3(0.75, 0.85, 1.1), pyHash21(cell.yz));
                return tint.mul(bright).mul(twinkle).mul(gain);
            };
            // ── The Milky Way: a band of light up the clear, upwind sky ──
            // It arcs up the left (the anvil roofs the right). Along it the light is drawn out in
            // long soft clouds, never in blots; one dark rift of dust runs down its middle, wandering.
            const across = dir.x.mul(0.667).sub(dir.y.mul(0.285)).sub(dir.z.mul(0.689)).toVar();
            const along = dir.x.mul(0.36).add(dir.y.mul(0.93)).add(dir.z.mul(-0.036)).toVar();
            const bandW = exp(across.mul(across).mul(-20.0)).toVar();
            // (Only inside the band: half the sky pays for none of it. Its noise is read larger than
            // the screen draws it, so an explicit level 0 is the level it would take.)
            const milky = float(0.0).toVar();
            If(bandW.greaterThan(0.004), () => {
                const mw = texture(t.noise, vec2(along.mul(0.55), across.mul(1.9)).add(vec2(0.13, 0.4))).level(0.0).r;
                const fine = texture(t.noise, vec2(along.mul(2.1), across.mul(5.0)).add(vec2(0.6, 0.2))).level(0.0).g;
                const rift = across.sub(sin(along.mul(4.6)).mul(0.035)).sub(0.02);
                const dust = exp(rift.mul(rift).mul(-420.0)).mul(smoothstep(0.2, 0.75, fine)).mul(0.62);
                // Its bright heart low on the left, thinning up the arc.
                const heart = exp(length(dir.sub(vec3(-0.52, 0.33, -0.79))).mul(-2.4)).mul(1.6).add(0.55);
                milky.assign(bandW.mul(mw.mul(0.5).add(fine.mul(0.2)).add(0.42)).mul(float(1.0).sub(dust)).mul(heart));
                const milkyHue = mix(vec3(0.045, 0.04, 0.066), vec3(0.07, 0.055, 0.05), mw);
                sky.addAssign(milkyHue.mul(milky).mul(u.stars).mul(u.milky.mul(1.25)).mul(smoothstep(0.03, 0.3, dir.y)));
                // The band's own dust of faint stars.
                sky.addAssign(starLayer(420.0, 0.82, 0.7).mul(milky).mul(u.stars).mul(smoothstep(0.015, 0.2, dir.y))
                    .mul(float(1.0).sub(disc)));
            });

            const stars = starLayer(170.0, 0.92, 1.2);

            // ── The moon: a fat crescent, earthshine on its dark limb, a halo in the haze ──
            const moonLight = vec3(0.0).toVar();
            // (Its face is worked out only on the disc.)
            If(away.lessThan(1.25), () => {
                // The disc as a sphere: its normal, lit by a sun under the horizon to its lower left.
                const nz = sqrt(max(float(1.0).sub(r2), 0.0));
                const lit = smoothstep(-0.06, 0.2, lx.mul(MOON_SUN[0]).add(ly.mul(MOON_SUN[1])).add(nz.mul(MOON_SUN[2])));
                const seas = texture(t.noise, vec2(lx, ly).mul(0.21).add(vec2(0.31, 0.62))).level(0.0).g;
                const face = mix(float(0.62), float(1.0), smoothstep(0.38, 0.6, seas)).mul(nz.mul(0.35).add(0.65));
                moonLight.assign(u.moonTint.mul(face).mul(lit.mul(1.9).add(0.05)));
            });
            // Its halo in the ash haze: wide and soft, warmer than the disc.
            const halo = exp(away.mul(-0.55)).mul(0.05).add(exp(away.mul(-0.12)).mul(0.012));
            sky.addAssign(u.moonTint.mul(vec3(1.0, 0.9, 0.82)).mul(halo).mul(u.moonShow).mul(smoothstep(-0.03, 0.06, dir.y)));
            // No star shines through the moon.
            sky.addAssign(stars.mul(u.stars).mul(smoothstep(0.015, 0.2, dir.y)).mul(float(1.0).sub(disc)));
            // Its own light on top of the sky's: the dark limb is the sky's colour plus earthshine,
            // never darker than the sky round it (a disc darker than its sky is a sticker).
            sky.addAssign(moonLight.mul(disc));
        });
        sky.assign(max(sky, vec3(0.0)));
        return vec4(sky, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PyrestormSky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {
        mesh,
        meshes: [mesh],
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export { clamp };
