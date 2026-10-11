/**
 * Solar Eclipse — the dome: the air at totality, the planets and stars it lets out, the black
 * sun (solar-eclipse-sun.js), and the ranges in front of it all.
 *
 * One dome round the lens; every pixel reads the scene in its own direction, so nothing is
 * marched and nothing is drawn twice. Composited back to front:
 *
 *   the air      the dark of the shadow overhead, the band of light low all round (the sky
 *                beyond the moon's shadow is still in sunlight) and its bright rim at the horizon
 *   the points   the planets that come out at totality, and the faint stars a long exposure
 *                (a chain) brings out
 *   the sun      behind the moon: corona, prominences, chromosphere; the moon over them; in front
 *                of it the bead necklace and the diamond's glare
 *   the ranges   six crest lines, farthest first: each darker than the air behind it, mist
 *                rising from its foot, its crest rimmed by the light behind; the farthest range
 *                stands outside the shadow, its snow catching the light
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    asin,
    atan,
    cameraPosition,
    clamp,
    cos,
    exp,
    float,
    floor,
    fract,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    step,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BRIGHT_POINTS, DEG, RANGES, RIDGE_SPAN,
} from './solar-eclipse-core.js';
import {
    crestU, noiseAt, seHash21, sized, sunPlane,
} from './solar-eclipse-tsl.js';
import { drawSun } from './solar-eclipse-sun.js';

/** Per range, near to far mirrored from RANGES: how much air stands between it and the lens. */
const AERIAL = Object.freeze([0.6, 0.4, 0.25, 0.13, 0.055, 0.012]);
/** The mist rising from each range's foot: (how far up it reaches in radians, how thick). */
const MIST = Object.freeze([[0.005, 0.3], [0.007, 0.36], [0.009, 0.34], [0.011, 0.26], [0.014, 0.16], [0.02, 0.05]]);
/** The light behind each crest, a thin rim. */
const RIM = Object.freeze([1.0, 0.55, 0.3, 0.16, 0.08, 0.03]);

/** A bright point's colour from its temperature: 0 ember … 0.5 white … 1 blue. */
const pointColour = (temp) => {
    const warm = [1.0, 0.72, 0.46];
    const white = [1.0, 0.97, 0.93];
    const blue = [0.7, 0.82, 1.0];
    const k = temp < 0.5 ? temp / 0.5 : (temp - 0.5) / 0.5;
    const a = temp < 0.5 ? warm : white;
    const b = temp < 0.5 ? white : blue;
    return vec3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
};

export function createSky({
    u, noise, ranges, tier,
}) {
    const geometry = new THREE.SphereGeometry(6000, 32, 16);
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });

    material.fragmentNode = Fn(() => {
        const d = normalize(positionWorld.sub(cameraPosition)).toVar();
        const alt = asin(clamp(d.y, -1.0, 1.0)).toVar();
        const az = atan(d.x, d.z.negate()).toVar();
        const up = max(alt, 0.0);

        // ── The air at totality ──
        const sky = mix(u.mid, u.zenith, smoothstep(0.1, 0.55, up)).toVar();
        sky.addAssign(u.horizon.mul(exp(up.div(-0.1))));
        sky.addAssign(u.glow.mul(exp(up.div(u.glowHeight).negate())));
        // The moment the diamond burns, daylight floods back into the air.
        sky.addAssign(mix(u.horizon.mul(1.6), vec3(0.09, 0.13, 0.22), smoothstep(0.0, 0.3, up)).mul(u.daylight));

        const plane = sunPlane(u, d).toVar();

        // ── The planets, placed off the sun ──
        const pointLight = vec3(0.0).toVar();
        const spot = sized(u, 1.15, 0.9).div(u.sunTan);
        BRIGHT_POINTS.forEach(([x, y, power, temp], index) => {
            const at = vec2(Math.tan(x * DEG), Math.tan(y * DEG)).div(u.sunTan);
            const dd = plane.xy.sub(at).div(spot);
            const twinkle = sin(u.time.mul(1.7 + index * 0.37).add(index * 2.1)).mul(0.08).add(0.92);
            const shine = exp(dd.dot(dd).negate()).mul(power).mul(twinkle);
            pointLight.addAssign(pointColour(temp).mul(shine));
        });
        const night = float(1.0).sub(u.daylight);
        sky.addAssign(pointLight.mul(u.starPower).mul(u.exposure.mul(0.5).add(0.55)).mul(0.6).mul(night));

        // ── The faint stars a long exposure brings out ──
        if (tier.stars) {
            If(alt.greaterThan(0.0).and(u.exposure.greaterThan(0.02)), () => {
                const cell = 0.016;
                const g = vec2(az.mul(cos(alt)), alt).div(cell);
                const id = floor(g);
                const at = fract(g).sub(0.5);
                const place = vec2(seHash21(id.add(3.1)), seHash21(id.add(9.7))).sub(0.5).mul(0.6);
                const away = at.sub(place).mul(cell);
                const rad = sized(u, 0.85, 0.7);
                const h = seHash21(id.add(41.3));
                const lit = step(seHash21(id.add(77.7)), u.exposure.mul(0.42));
                const shine = exp(away.dot(away).div(rad.mul(rad)).negate()).mul(h.mul(h).mul(0.7).add(0.06)).mul(lit);
                sky.addAssign(vec3(0.86, 0.92, 1.0).mul(shine).mul(u.starPower).mul(float(1.0).sub(u.daylight)));
            });
        }

        // ── The black sun ──
        const behind = vec3(0.0).toVar();
        const front = vec3(0.0).toVar();
        const cover = float(0.0).toVar();
        const face = vec3(0.0).toVar();
        If(plane.z.greaterThan(0.2), () => {
            drawSun({ u, noise, tier }, plane.xy, {
                behind, cover, face, front,
            });
        });
        sky.addAssign(behind);
        sky.assign(mix(sky, face, cover));

        // ── The ranges, farthest first ──
        const top = RANGES.reduce((m, r) => Math.max(m, r.base + r.amp * 1.4), -1);
        If(alt.lessThan(top + 0.004), () => {
            const uu = crestU(az, RIDGE_SPAN);
            const row0 = texture(ranges, vec2(uu, 0.25)).level(0);
            const row1 = texture(ranges, vec2(uu, 0.75)).level(0);
            const crests = [row0.x, row0.y, row0.z, row0.w, row1.x, row1.y];
            const fuzz = u.texel.mul(0.75);
            // The air beyond the shadow, as it lies between the ranges.
            const farAir = mix(u.haze, u.glow, 0.42).mul(0.82).toVar();
            const daylit = u.daylight.mul(0.6);
            for (let k = 0; k < RANGES.length; k += 1) {
                const below = crests[k].sub(alt);
                const inside = smoothstep(fuzz.negate(), fuzz, below);
                const body = mix(u.ridge, farAir, AERIAL[k]).toVar();
                // The near ranges stand under the dark of the shadow: a little of its blue.
                body.addAssign(u.mid.mul((k / (RANGES.length - 1)) * 0.5));
                // Mist rising from its foot, banked where the valleys hold it.
                const [reach, thick] = MIST[k];
                let banks = float(1.0);
                if (tier.mist) {
                    // Banks that roll along the valley and thin as they climb.
                    const roll = u.time.mul(0.002 * (k + 1));
                    const bankAt = vec2(az.mul(3.1 + k * 0.9).add(roll), below.mul(26.0).add(k * 0.17));
                    banks = noiseAt(noise, bankAt, 1.5).r
                        .mul(1.5).add(0.25);
                }
                const mistColour = mix(u.haze, u.mid.mul(3.2).add(u.haze.mul(0.25)), k / (RANGES.length - 1));
                const thins = float(1.0).sub(smoothstep(reach, reach * 4.0, below).mul(0.6));
                body.addAssign(mistColour.mul(smoothstep(0.0, reach, below).mul(thick).mul(banks)).mul(thins));
                // The light behind its crest, a thin rim.
                const rimWidth = u.texel.mul(1.1).add(0.0002 + k * 0.0001);
                // Bounded before it is masked: far above the crest the exponent would overflow, and
                // mix(sky, Inf, 0) is NaN.
                const rim = exp(max(below, 0.0).div(rimWidth).negate());
                body.addAssign(u.alpen.mul(u.alpenPower).mul(rim).mul(RIM[k] * 0.32));
                if (k === 0) {
                    // The sunlit range: its snow catches the light outside the shadow, brightest
                    // on the faces that turn toward it, cut by couloirs.
                    const slope = row1.z;
                    const facing = smoothstep(-0.8, 0.8, slope.negate()).mul(0.6).add(0.4);
                    let snow = float(0.75);
                    if (tier.faces) {
                        const couloir = noiseAt(noise, vec2(az.mul(11.0), below.mul(70.0).add(0.3)), 0.5).b;
                        snow = smoothstep(0.4, 0.78, couloir).mul(0.7).add(0.25);
                    }
                    const band = smoothstep(0.0, 0.002, below).mul(exp(max(below, 0.0).div(-0.01)));
                    body.addAssign(u.alpen.mul(u.alpenPower).mul(facing).mul(snow).mul(band)
                        .mul(0.14));
                }
                body.addAssign(u.haze.mul(daylit).mul(AERIAL[k] + 0.25));
                sky.assign(mix(sky, body, inside));
            }
        });

        // Glare sits on the lens, in front of everything.
        sky.addAssign(front);
        return vec4(sky, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.name = 'solar-eclipse-sky';

    return {
        object: mesh,
        update(camera) {
            mesh.position.copy(camera.position);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
