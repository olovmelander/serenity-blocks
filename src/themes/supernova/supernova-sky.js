/**
 * Supernova — the deep sky behind everything.
 *
 * One dome that follows the camera. The sky has a frame of its own (u.skyRot): its y axis is the
 * pole of the galaxy this star is dying in, and the frame turns about that pole, a turn in SKY_TURN
 * seconds. The LINE of the galaxy's band therefore stands still in the picture (it crosses where
 * the card leaves sky) while everything on it slides along it for ever: the star clouds, the dark
 * rift, the bright stars, the bulge of old suns that comes round once a turn, the far galaxies.
 *
 *  - the void's own colour, a little lighter toward the star;
 *  - far clouds lit faintly in the palette's two sky colours (they also carry a detonation's
 *    echo: a ring that leaves the star's place on the sky and lights the dust it passes);
 *  - the band of far suns: POINTS, not cloud (a band made of noise reads as smoke), thick where
 *    the star clouds are, parted by a rift of dust, over the faint light of the suns too far to
 *    part;
 *  - lattices of stars over the whole sky (the stars live in the cells of a 3D lattice the dome
 *    cuts through, so there is no pole and no seam), a few bright ones with the four rays a lens
 *    gives a point of light, and a handful of far galaxies: small leaning discs with a core.
 *
 * A star is never smaller than a pixel (what the clamp adds in area it takes back in
 * brightness), so the field does not shimmer as the sky turns.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    acos,
    cameraPosition,
    clamp,
    cross,
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
    step,
    vec3,
    vec4,
} from 'three/tsl';
import {
    snBell, snHash33, snPart, snRidge, snUnit,
} from './supernova-tsl.js';

/**
 * The star lattices: cells across the unit sphere's radius, the chance a cell holds a star off
 * the band, a star's size in cells, its gain.
 */
const LATTICES = Object.freeze([
    [52, 0.3, 0.03, 4.2],
    [140, 0.26, 0.028, 6.5],
    [310, 0.2, 0.026, 24],
]);
/**
 * The band's own lattices: far suns that stand only where the band is thick. Their stars are
 * smaller than a pixel on most screens, where the pixel floor takes back in brightness what it
 * adds in area: the gains are set for what is left (about a thirtieth at 900 lines).
 */
const BAND_LATTICES = Object.freeze([
    [320, 1.0, 0.026, 52],
    [170, 0.8, 0.028, 11],
]);

/**
 * @param {object} u shared uniforms
 * @param {{ layers?: number, clouds?: boolean, deep?: number }} [options]
 *   deep 0 = the lattices and a plain band; 1 = + the bright stars with their rays;
 *   2 = + the far galaxies
 */
export function createSky(u, { layers = 3, clouds = true, deep = 2 } = {}) {
    const geometry = new THREE.SphereGeometry(400, 24, 16);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false });
    material.name = 'SupernovaSky';
    material.fog = false;

    material.fragmentNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        // The sky's own frame: y is the pole of the band, and the frame turns about it.
        const q = u.skyRot.mul(dir).toVar();
        const toStar = clamp(dot(dir, u.starDir), -1.0, 1.0).toVar();
        const angle = acos(toStar).toVar();
        const col = vec3(u.voidCol).toVar();
        // The void is a little lighter toward the star: its light is everywhere.
        col.mulAssign(float(1.0).add(exp(angle.mul(-2.2)).mul(1.6)));

        // ── Far clouds, and the band's broad shape ──
        const dust = float(0.0).toVar();
        /** Where the band of far suns is thick (0..1), and how far round toward its bulge. */
        const band = float(0.0).toVar();
        const bulge = smoothstep(0.35, 0.96, q.x).toVar();
        if (clouds) {
            const n1 = u.noise(q.mul(0.42).add(vec3(0.13, 0.71, 0.37))).toVar();
            const n2 = u.noise(q.mul(1.15).add(n1.xyz.sub(0.5).mul(0.3)).add(vec3(0.61, 0.07, 0.83))).toVar();
            const body = smoothstep(0.36, 0.78, n1.r).mul(smoothstep(0.2, 0.75, n2.g));
            const wisp = snRidge(n2.r).pow(3.0);
            dust.assign(body.mul(float(0.45).add(wisp.mul(0.9))));
            const hue = mix(u.skyA, u.skyB, smoothstep(0.34, 0.66, n1.b));
            col.addAssign(hue.mul(dust).mul(0.05));
            // The band: its middle wanders, it swells at the bulge, its star clouds are the broad
            // read and a rift of dust runs along it where the second read says so.
            const lat = q.y.add(n1.a.sub(0.5).mul(0.13)).toVar();
            const wide = float(0.0075).add(bulge.mul(0.016));
            const profile = exp(lat.mul(lat).div(wide).negate()).toVar();
            const starClouds = smoothstep(0.24, 0.78, n2.b.mul(0.55).add(n1.g.mul(0.45)));
            const rift = smoothstep(0.47, 0.7, n2.a.mul(0.6).add(n1.r.mul(0.4)))
                .mul(exp(lat.mul(lat).div(-0.006)));
            band.assign(profile.mul(starClouds.mul(0.72).add(0.28)).mul(float(1.0).sub(rift.mul(0.86))));
            // The suns too far to part: a faint light, cool along the arms and warm at the bulge,
            // and the rift's dust reddens what shows through it.
            const far = mix(vec3(0.42, 0.56, 1.0), vec3(1.0, 0.66, 0.36), bulge);
            col.addAssign(far.mul(band.mul(band)).mul(float(0.009).add(bulge.mul(0.016))));
            col.addAssign(u.skyA.mul(rift.mul(profile)).mul(0.012));
            dust.addAssign(rift.mul(profile).mul(0.5));
        } else {
            band.assign(exp(q.y.mul(q.y).div(-0.016)).mul(0.6));
        }

        // ── The echo: the flash crossing the far dust ──
        const echoAge = u.time.sub(u.echo.x);
        const echoRadius = max(echoAge, 0.0).mul(u.echo.z);
        const ring = snBell(angle.sub(echoRadius).div(u.echo.w.add(echoRadius.mul(0.12))));
        const echo = ring.mul(u.echo.y).mul(exp(max(echoAge, 0.0).mul(-0.55)))
            .mul(smoothstep(0.0, 0.08, echoAge));
        col.addAssign(u.echoCol.mul(echo).mul(float(0.02).add(dust.mul(0.5)).add(band.mul(0.08))));

        // ── Stars: one per cell of a lattice the sphere of directions cuts through ──
        const pixel = u.pixelAngle;
        const starLayer = (scale, chance, size, gain, shift) => {
            const p = q.mul(scale).add(shift);
            const h = snHash33(floor(p)).toVar();
            const f = fract(p).sub(h.mul(0.6).add(0.2)).toVar();
            // Its distance across the line of sight (along it the lattice is cut, not seen).
            const d = length(f.sub(q.mul(dot(f, q))));
            const r = max(float(size), pixel.mul(scale).mul(0.85));
            const shrink = float(size).div(r);
            const core = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(shrink.mul(shrink));
            // A steep split: most are dust, a few burn.
            const m2 = h.z.mul(h.z);
            const mag = m2.mul(m2).mul(0.94).add(0.06);
            const twinkle = sin(u.time.mul(h.y.mul(2.4).add(0.7)).add(h.x.mul(40.0))).mul(0.18).add(0.82);
            // Old and warm, white, or young and blue.
            const warm = mix(vec3(1.0, 0.6, 0.36), vec3(1.0, 0.95, 0.9), smoothstep(0.0, 0.45, h.y));
            const tint = mix(warm, vec3(0.6, 0.76, 1.0), smoothstep(0.6, 1.0, h.y));
            return tint.mul(core.mul(mag).mul(twinkle).mul(step(h.x, min(chance, 0.94))).mul(gain));
        };
        // Thick along the band, thin off it: the band is made of them.
        const crowd = band.mul(2.4).add(0.55).toVar();
        const stars = vec3(0.0).toVar();
        for (let i = 0; i < Math.min(layers, LATTICES.length); i++) {
            const [scale, chance, size, gain] = LATTICES[i];
            stars.addAssign(starLayer(scale, crowd.mul(chance), size, gain, vec3(i * 19.7, i * 7.3, i * 3.1)));
        }
        // (Only where the band is: most of the sky pays for none of its lattices.)
        If(band.greaterThan(0.012), () => {
            for (let i = 0; i < Math.min(Math.max(1, layers - 1), BAND_LATTICES.length); i++) {
                const [scale, chance, size, gain] = BAND_LATTICES[i];
                stars.addAssign(starLayer(scale, band.mul(chance), size, gain, vec3(71.3 + i * 23.1, 13.9, 37.1)));
            }
        });
        if (deep >= 1) {
            // A few bright ones: a hard point, a halo, and the four rays a lens gives a bright
            // point (along the frame's own axes, which the world hands over in the sky's frame).
            const scale = 7.0;
            const p = q.mul(scale).add(vec3(3.7, 9.1, 5.3));
            const h = snHash33(floor(p).add(vec3(17.0, 5.0, 31.0))).toVar();
            const f = fract(p).sub(h.mul(0.56).add(0.22)).toVar();
            const perp = f.sub(q.mul(dot(f, q))).toVar();
            const d = length(perp).toVar();
            // (Only a cell that holds one, and only as far from it as its rays reach: the rest
            // of the sky pays for the hash alone.)
            If(h.x.lessThan(0.4).and(d.lessThan(0.15)), () => {
                const r = max(float(0.008), pixel.mul(scale).mul(0.95)).toVar();
                const point = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(float(0.008).div(r).mul(float(0.008).div(r)));
                const haloD = d.div(0.022);
                const halo = float(1.0).div(haloD.mul(haloD).add(1.0));
                const ax = abs(dot(perp, u.skyRight));
                const ay = abs(dot(perp, u.skyUp));
                const thin = r.mul(0.7);
                const rays = exp(ax.div(-0.03)).mul(exp(ay.mul(ay).div(thin.mul(thin)).negate()))
                    .add(exp(ay.div(-0.03)).mul(exp(ax.mul(ax).div(thin.mul(thin)).negate())));
                const mag = h.z.mul(h.z).mul(0.85).add(0.15);
                // Slowly variable: each on its own period of a minute or so.
                const vary = sin(u.time.mul(h.x.mul(0.11).add(0.05)).add(h.y.mul(40.0))).mul(0.22).add(0.78);
                const warm = mix(vec3(1.0, 0.9, 0.8), vec3(1.0, 0.66, 0.4), smoothstep(0.62, 1.0, h.y));
                const tint = mix(warm, vec3(0.62, 0.78, 1.0), float(1.0).sub(smoothstep(0.0, 0.34, h.y)));
                // (Faded to nothing at the edge of what is drawn.)
                const within = float(1.0).sub(smoothstep(0.11, 0.15, d));
                stars.addAssign(tint.mul(point.mul(9.0).add(halo.mul(halo).mul(0.035)).add(rays.mul(0.22)))
                    .mul(mag.mul(vary)).mul(within));
            });
        }
        if (deep >= 2) {
            // Far galaxies: a leaning disc with a core, one in a few cells of a coarse lattice.
            const scale = 4.6;
            const p = q.mul(scale).add(vec3(11.3, 2.9, 7.7));
            const cell = floor(p);
            const h = snHash33(cell.add(vec3(5.0, 23.0, 41.0))).toVar();
            const f = fract(p).sub(h.mul(0.5).add(0.25)).toVar();
            const perp = f.sub(q.mul(dot(f, q))).toVar();
            // (Only a cell that holds one, and only within reach of its disc.)
            If(h.z.lessThan(0.34).and(length(perp).lessThan(0.2)), () => {
                const k = snHash33(cell.add(vec3(61.0, 3.0, 19.0))).toVar();
                // Its long axis: any direction across the line of sight.
                const major = snUnit(cross(q, k.sub(0.5))).toVar();
                const minor = cross(q, major);
                const a = dot(perp, major).toVar();
                const b = dot(perp, minor).toVar();
                const size = max(float(0.02).add(k.x.mul(0.035)), pixel.mul(scale).mul(3.0)).toVar();
                const lean = float(0.22).add(k.y.mul(0.6));
                const rr = a.mul(a).add(b.mul(b).div(lean.mul(lean))).div(size.mul(size)).toVar();
                const disc = exp(rr.negate());
                const core = exp(rr.mul(-9.0));
                // An edge-on one shows its dust as a dark line along the disc.
                const lane = float(1.0).sub(exp(b.mul(b).div(size.mul(size).mul(0.004)).negate())
                    .mul(float(1.0).sub(smoothstep(0.25, 0.5, lean))).mul(0.7));
                const tint = mix(vec3(0.6, 0.72, 1.0), vec3(1.0, 0.82, 0.62), core.add(k.z.mul(0.4)));
                stars.addAssign(tint.mul(disc.mul(0.11).mul(lane).add(core.mul(0.35))).mul(k.z.mul(0.7).add(0.5)));
            });
        }
        // The stars answer a clear, and the nearest ones drown in the star's own glare.
        const drown = float(1.0).sub(exp(angle.mul(-9.0)).mul(0.85));
        col.addAssign(stars.mul(float(1.0).add(u.skyPulse.mul(1.4))).mul(drown).mul(float(1.0).sub(dust.mul(0.35))));

        return vec4(col.mul(mix(float(0.55), float(1.0), u.breath)), 1.0);
    })();

    return snPart('SupernovaSky', geometry, material, 0);
}
