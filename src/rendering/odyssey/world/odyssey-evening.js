/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE EVENING — chapter 5's own sky: the day ends on the climb (the sky pass, 2026-11-17).
 *
 * The audit of the journey found "Sky & Atmospheric Drift" had no sky of its own: six orbs in a
 * row looked at one summit under the noon of chapters 3 and 4. The owner's brief: every chapter
 * its own mood, palette and light, and alive while you are in it. So the climb is now the end of
 * the day. The colour script (odyssey-colour-script.js, the `horizon: 'evening'` keyframes) owns
 * the LIGHT'S COLOUR, one keyframe an orb. This module owns what a colour table cannot say:
 *
 *   - THE SUN SINKS, in the sky only. `ODYSSEY_WORLD_SUN` (15 deg up) is baked into the shadow
 *     plates, the forest mask and the goldens and does not move. The sky's own sun (its disc and
 *     glow on the dome, the light of the cloud sea, the antisolar point of the glory and of the
 *     mountain's shadow) is an APPARENT sun on the same bearing that sinks from 15 deg to the
 *     horizon as the evening runs. Up here the forest is far below; nothing is re-baked.
 *   - THE TWO SIDES OF A SUNSET. The rail climbs with the sun behind the eye (the view stands
 *     100-165 deg off the sun's bearing through the whole chapter), so what the player sees is
 *     the ANTISOLAR evening: the pink belt of Venus over the blue band of the Earth's own shadow,
 *     rays converging on the antisolar point, and on the sun's side (a look over the shoulder) the
 *     gold and orange of the low sun. Both are part of the AIR (`eveningAir`): the dome, the haze
 *     over land, sea and cloud all read them, so the horizon keeps one colour at infinity.
 *   - LIGHTS IN THE SKY: a half moon standing over the summit's banner, pale in the afternoon and
 *     bright by dusk, lit from the sun's side; the first stars as the eye comes out above the
 *     summit, and a shooting star now and then (`eveningLights`).
 *   - THE CLOUDS TAKE THE LIGHT (`eveningCloudWhite`): a cloud's white is the sun's colour by the
 *     end of the day, and its shade the sky's own violet.
 *
 * One clock: Act II progress, the colour script's own (`odysseyEveningAt`, pure, tested), plus the
 * board's time for what breathes. Every uniform is 0 / the world sun outside the evening, and
 * every term sits behind a uniform branch, so chapters 2-4 shade exactly what they did.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, atan, cameraViewMatrix, clamp, cross, dot, exp, float, floor, fract, length, max, mix, normalize,
    smoothstep, sqrt, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { hash31, noise2 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';

const DEG = Math.PI / 180;
const SUN_LEN = Math.hypot(...ODYSSEY_WORLD_SUN);
const SUN_FLAT_LEN = Math.hypot(ODYSSEY_WORLD_SUN[0], ODYSSEY_WORLD_SUN[2]);
/** The world sun's bearing in the ground plane (unit x, z) and its elevation. */
const SUN_FLAT = Object.freeze([ODYSSEY_WORLD_SUN[0] / SUN_FLAT_LEN, ODYSSEY_WORLD_SUN[2] / SUN_FLAT_LEN]);
const WORLD_SUN_ELEVATION = Math.asin(ODYSSEY_WORLD_SUN[1] / SUN_LEN);

/**
 * Journey progress to Act II progress, as the world's update receives it (the colour script, the
 * bow's windows and the cloud shadows are keyed the same way). The schedule below is written in
 * JOURNEY progress, where the orbs are (L27 0.349 .. L34 0.704), and converted once.
 */
const ACT_FROM = 0.0649;
const ACT_SPAN = 0.6894;
export const eveningActT = (p) => (p - ACT_FROM) / ACT_SPAN;

/**
 * THE SCHEDULE, in journey progress. [from, to] ramps.
 *   - `dusk`   the evening itself: 0 where the island pass hands the light over (just before
 *              L26), 1 as the eye reaches the summit's height (L32), the sun on the horizon.
 *   - `sunTo`  the apparent sun's elevation at dusk 1 (degrees): low enough for the belt and the
 *              long shadows, high enough that the antisolar point (as far under the horizon as
 *              the sun is over it) still falls ON the cloud floor, ~3 km out from the summit's
 *              height, where the glory and the tip of the mountain's shadow are seen. It holds
 *              there through the departure: the eye rises as fast as the sun sinks, until the
 *              Earth's own sunset on its limb (p ~0.734, composition/odyssey-orbit-earth.js).
 *   - `belt`   the belt of Venus, over `dusk`; `shadow` the Earth's shadow under it, over `dusk`.
 *   - `stars`  the first stars; `moon` its brightness over `dusk` (it is there all evening).
 *   - `cloud`  how far a cloud's white takes the sun's colour: in as the evening begins, eased
 *              back as the eye leaves the weather (`clear`), where the light is white again.
 *   - `sea`    the sea of clouds gathering below (world/odyssey-cloud-sea.js).
 *   - `cap`    the lenticular cap forming in the summit's lee (world/odyssey-summit-cap.js).
 *   - `glory`  the glory round the antisolar point, on the cloud sea: in as the eye comes out
 *              above the summit, out as the climb takes the sea far below.
 */
export const ODYSSEY_EVENING = Object.freeze({
    dusk: Object.freeze([0.335, 0.612]),
    sunTo: 4.5,
    belt: Object.freeze([0.30, 0.95]),
    shadow: Object.freeze([0.55, 1.0]),
    stars: Object.freeze([0.615, 0.725]),
    moon: Object.freeze([0.42, 1.0]),
    /** The moon comes out of the afternoon's blue across the 4->5 seam (it is never switched on). */
    moonIn: Object.freeze([0.335, 0.350]),
    /** THE LOW SUN'S SHAFTS across the high sky behind the summit (the shadows of far cloud on
     * the sun's side, seen as rays that run toward the antisolar point): in across the 4->5 seam,
     * out as the sun nears the horizon and the belt's own rays take over. */
    shafts: Object.freeze([0.335, 0.349, 0.500, 0.575]),
    /** THE FAN OPENS at the 4->5 seam: the shafts stand `fan` times as strong where the eye
     * clears the massif's shoulder at L27, easing back to their own strength up the wall. */
    fan: 1.5,
    fanOut: Object.freeze([0.352, 0.392]),
    // (Round two: the clouds are gold from the first orb. They used to warm with the dusk, so
    // L27 and L28 still wore chapter 4's white cumulus and only the banner said evening.)
    cloud: Object.freeze([0.334, 0.349]),
    cloudShare: Object.freeze([0.36, 0.56]),
    clear: Object.freeze([0.690, 0.722]),
    clearShare: 0.30,
    sea: Object.freeze([0.352, 0.585]),
    cap: Object.freeze([0.372, 0.436]),
    glory: Object.freeze([0.575, 0.628, 0.700, 0.722]),
    /** THE LIGHT BREATHES: the sun's light swells and eases on the clock, as far-off cloud crosses
     * it: +-`breath` over the two periods (s), only while the evening runs. */
    breath: 0.06,
    breathPeriods: Object.freeze([53, 23]),
});

const ramp = (a, b, x) => {
    const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return u * u * (3 - (2 * u));
};

/**
 * The evening at Act II progress `actT` and board time `time` (pure).
 * @param {number} actT 0..1 across Act II
 * @param {number} [time] seconds (the board's clock): only `breath` reads it
 * @returns {{dusk:number, sunElevation:number, warm:number, belt:number, beltAt:number,
 *   beltWidth:number, shadow:number, shadowTop:number, stars:number, moon:number, rays:number, shafts:number,
 *   cloud:number, sea:number, cap:number, glory:number, breath:number}} sunElevation in radians; beltAt,
 *   beltWidth and shadowTop are sines of elevations; the rest 0..1 (breath is a gain round 1,
 *   shafts a gain up to 1 + `fan`)
 */
export function odysseyEveningAt(actT, time = 0) {
    const E = ODYSSEY_EVENING;
    const t = Number.isFinite(actT) ? actT : 0;
    const p = ACT_FROM + (t * ACT_SPAN);
    // Half a straight ramp, half an eased one: the evening moves at every orb of the climb (an
    // eased ramp alone spends the first two orbs near 0), and still starts and ends without a corner.
    const u = Math.min(Math.max((p - E.dusk[0]) / (E.dusk[1] - E.dusk[0]), 0), 1);
    const dusk = (0.5 * u) + (0.5 * u * u * (3 - (2 * u)));
    const sunElevation = WORLD_SUN_ELEVATION + (((E.sunTo * DEG) - WORLD_SUN_ELEVATION) * (dusk ** 0.85));
    const belt = ramp(E.belt[0], E.belt[1], dusk);
    const shadow = ramp(E.shadow[0], E.shadow[1], dusk);
    const cloudIn = ramp(E.cloud[0], E.cloud[1], p);
    const clear = ramp(E.clear[0], E.clear[1], p);
    const cloudFull = E.cloudShare[0] + ((E.cloudShare[1] - E.cloudShare[0]) * dusk);
    const tt = Number.isFinite(time) ? time : 0;
    const swell = (0.65 * Math.sin((tt * 2 * Math.PI) / E.breathPeriods[0]))
        + (0.35 * Math.sin(((tt * 2 * Math.PI) / E.breathPeriods[1]) + 1.7));
    return {
        dusk,
        sunElevation,
        warm: dusk,
        belt,
        // The belt rises and widens as the sun sinks (it stands opposite the sun).
        beltAt: 0.085 + (0.075 * belt),
        beltWidth: 0.075 + (0.035 * belt),
        shadow,
        shadowTop: 0.012 + (0.068 * shadow),
        // Slow at first: two or three first stars as the eye comes out above the summit, the
        // field only as the departure darkens the sky.
        stars: ramp(E.stars[0], E.stars[1], p) ** 1.6,
        moon: ramp(E.moonIn[0], E.moonIn[1], p) * (E.moon[0] + ((E.moon[1] - E.moon[0]) * dusk)),
        rays: belt,
        shafts: ramp(E.shafts[0], E.shafts[1], p) * (1 - ramp(E.shafts[2], E.shafts[3], p))
            * (1 + (E.fan * (1 - ramp(E.fanOut[0], E.fanOut[1], p)))),
        cloud: cloudIn * (cloudFull + ((E.clearShare - cloudFull) * clear)),
        sea: ramp(E.sea[0], E.sea[1], p),
        cap: ramp(E.cap[0], E.cap[1], p),
        glory: ramp(E.glory[0], E.glory[1], p) * (1 - ramp(E.glory[2], E.glory[3], p)),
        breath: 1 + (E.breath * swell * cloudIn),
    };
}

/** The apparent sun's direction (unit, toward the sun) at an elevation, on the world sun's bearing. */
export function eveningSunDirection(elevation, out = new THREE.Vector3()) {
    const c = Math.cos(elevation);
    return out.set(SUN_FLAT[0] * c, Math.sin(elevation), SUN_FLAT[1] * c);
}

/**
 * THE MOON: where it stands (a heading from -z toward +x and an elevation, degrees), its radius
 * (degrees; several times the real moon's, as a painted sky wants) and its light.
 *
 * It stands over the summit's banner, up and to the left of the peak in the climb's views (L27
 * to L31), ~97 deg round from the sun: a half moon, as a moon a quarter of the sky from a low sun
 * is, its lit side toward the sun. Probed against the real camera's poses: in frame at every orb
 * of the face, out of it once the view turns east at the summit (L32 on) and through the
 * departure, so it is never on screen while the world's sky gives way to space.
 */
export const ODYSSEY_MOON = Object.freeze({
    headingDeg: -20,
    elevationDeg: 47,
    radiusDeg: 1.9,
    /** Its light on the dome (linear): by day, and the share the dusk adds. */
    gain: Object.freeze([0.30, 0.62]),
    /** The glow round it at full dusk, and how wide (in radii). */
    halo: 0.16,
    haloWidth: 3.2,
    colour: Object.freeze([1.0, 0.97, 0.90]),
});
const MOON_DIR = (() => {
    const h = ODYSSEY_MOON.headingDeg * DEG;
    const e = ODYSSEY_MOON.elevationDeg * DEG;
    return new THREE.Vector3(Math.cos(e) * Math.sin(h), Math.sin(e), -Math.cos(e) * Math.cos(h));
})();
/** The moon's own frame: e1 to its right (level), e2 up its face, toward the eye = -MOON_DIR. */
const MOON_E1 = new THREE.Vector3().crossVectors(MOON_DIR, new THREE.Vector3(0, 1, 0)).normalize();
const MOON_E2 = new THREE.Vector3().crossVectors(MOON_E1, MOON_DIR).normalize();
export const eveningMoonDirection = () => MOON_DIR.clone();

/** The sky's colours (linear, authored bright against the world's grade as every palette here). */
const BELT_PINK = Object.freeze([1.0, 0.60, 0.66]);
const SHADOW_BLUE = Object.freeze([0.33, 0.41, 0.74]);
const SUN_GOLD = Object.freeze([1.0, 0.66, 0.34]);
const SUN_EMBER = Object.freeze([1.0, 0.46, 0.20]);

/**
 * The evening's live state for the world's materials (module-level uniforms, as the Earth's seam
 * state is): written by `updateOdysseyEvening` once a frame, read by every material that takes
 * the evening. Neutral values = no evening.
 */
export const ODYSSEY_EVENING_U = Object.freeze({
    dusk: uniform(0),
    /** The apparent sun (unit, toward it) and the antisolar direction. */
    sunDir: uniform(new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize()),
    antiDir: uniform(new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize().negate()),
    warm: uniform(0),
    belt: uniform(0),
    beltAt: uniform(0.085),
    beltWidth: uniform(0.075),
    shadow: uniform(0),
    shadowTop: uniform(0.012),
    stars: uniform(0),
    moon: uniform(0),
    /** The light on the moon in its own frame (x right, y up, z toward the eye), unit. */
    moonLight: uniform(new THREE.Vector3(-1, 0, 0)),
    /** The moon frame's turn in the lens's image plane (cos, sin): see `updateOdysseyEvening`. */
    moonTurn: uniform(new THREE.Vector2(1, 0)),
    rays: uniform(0),
    shafts: uniform(0),
    cloud: uniform(0),
    sea: uniform(0),
    glory: uniform(0),
    time: uniform(0),
});
const U = ODYSSEY_EVENING_U;

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchM = new THREE.Matrix3();
/** A world direction through the camera's lens: its place in the image plane (x right, y up). */
function imagePlane(dir, rot, out) {
    scratchC.copy(dir).applyMatrix3(rot);
    const z = -scratchC.z;
    if (!(z > 1e-4)) return null;
    return out.set(scratchC.x / z, scratchC.y / z);
}
const planeA = new THREE.Vector2();
const planeB = new THREE.Vector2();

/**
 * Drive the evening: once a frame, from the world's update.
 * @param {number} actT 0..1 across Act II
 * @param {number} time seconds
 * @param {object|null} [camera] the view camera (for the moon's turn in the lens)
 * @returns {ReturnType<typeof odysseyEveningAt>} what was written
 */
export function updateOdysseyEvening(actT, time = 0, camera = null) {
    const e = odysseyEveningAt(actT, time);
    U.dusk.value = e.dusk;
    eveningSunDirection(e.sunElevation, U.sunDir.value);
    U.antiDir.value.copy(U.sunDir.value).negate();
    U.warm.value = e.warm;
    U.belt.value = e.belt;
    U.beltAt.value = e.beltAt;
    U.beltWidth.value = e.beltWidth;
    U.shadow.value = e.shadow;
    U.shadowTop.value = e.shadowTop;
    U.stars.value = e.stars;
    U.moon.value = e.moon;
    U.rays.value = e.rays;
    U.shafts.value = e.shafts;
    U.cloud.value = e.cloud;
    U.sea.value = e.sea;
    U.glory.value = e.glory;
    // Wrapped: only the stars' twinkle and the rays' drift read it, both periodic in an hour.
    U.time.value = (Number.isFinite(time) ? time : 0) % 3600;
    // The light on the moon, in the moon's own frame (the sun is far: one direction for its face).
    const s = U.sunDir.value;
    U.moonLight.value.set(s.dot(MOON_E1), s.dot(MOON_E2), -s.dot(MOON_DIR)).normalize();
    // The moon is drawn round in the lens's image plane (a disc on the sky is an ellipse off the
    // lens's axis), so its face has to be turned to its own frame there: the bearing, in the image
    // plane, of a step along e1 from the moon's centre.
    if (camera?.matrixWorldInverse) {
        scratchM.setFromMatrix4(camera.matrixWorldInverse);
        const centre = imagePlane(MOON_DIR, scratchM, planeA);
        const step = centre && imagePlane(
            scratchA.copy(MOON_E1).multiplyScalar(0.02).add(MOON_DIR).normalize(),
            scratchM,
            planeB,
        );
        if (step) {
            scratchB.set(planeB.x - planeA.x, planeB.y - planeA.y, 0);
            const len = Math.hypot(scratchB.x, scratchB.y);
            if (len > 1e-7) U.moonTurn.value.set(scratchB.x / len, scratchB.y / len);
        }
    }
    return e;
}

/**
 * THE AIR OF THE EVENING: `base` (the sky's gradient and its warm side, for the view direction
 * `dir`) with the sunset's two sides laid in. Built at every call site of the world's `skyAirAt`
 * (the dome, every surface's haze), so it is a few dots and smoothsteps behind a uniform branch.
 * @param {object} base vec3 node
 * @param {object} dir vec3 node, unit
 * @param {object} sunColour vec3 node: the colour script's sun
 */
export function eveningAir(base, dir, sunColour) {
    return Fn(() => {
        const out = base.toVar();
        const d = dir.toVar();
        If(U.dusk.greaterThan(0.001), () => {
            const side = dot(normalize(d.xz.add(vec2(1e-4, 0))), vec2(...SUN_FLAT)).toVar();
            const y = d.y.toVar();
            // The sun's side: gold over a broad low arch, ember close to the horizon under it.
            const sunward = clamp(side, 0, 1).toVar();
            const arch = float(1).sub(smoothstep(float(-0.08), float(0.40), y));
            const low = float(1).sub(smoothstep(float(-0.04), float(0.13), y));
            const gold = sunColour.mul(vec3(...SUN_GOLD))
                .mul(sunward.mul(sqrt(sunward)).mul(arch).mul(U.warm.mul(0.50)));
            const ember = sunColour.mul(vec3(...SUN_EMBER))
                .mul(sunward.mul(sunward).mul(sunward).mul(low).mul(U.warm.mul(0.42)));
            // Opposite the sun: the belt of Venus (the sun's reddened light scattered back from the
            // far air), reaching well round the sky, over the Earth's own shadow on the horizon.
            const away = smoothstep(float(-0.30), float(0.80), side.negate()).toVar();
            const beltY = y.sub(U.beltAt).div(U.beltWidth);
            const belt = exp(beltY.mul(beltY).negate()).mul(away).mul(U.belt).mul(0.70);
            const lit = mix(out.add(gold).add(ember), vec3(...BELT_PINK).mul(sunColour.mul(0.35).add(0.68)), belt);
            const shade = float(1).sub(smoothstep(U.shadowTop.sub(0.02), U.shadowTop.add(0.035), y))
                .mul(smoothstep(float(-0.30), float(-0.015), y))
                .mul(away)
                .mul(U.shadow)
                .mul(0.60);
            out.assign(mix(lit, vec3(...SHADOW_BLUE), shade));
        });
        return out;
    })();
}

/**
 * THE DOME'S EVENING: what only the sky itself shows, laid over its air before the departure's
 * fade. The low sun's own glow round the apparent sun, and the rays that converge on the
 * antisolar point (the shadows of far clouds on the sun's side, drawn across the belt).
 * @param {object} air vec3 node: the dome's air for `dir`
 * @param {object} dir vec3 node, unit
 * @param {object} sunColour vec3 node
 */
export function eveningDome(air, dir, sunColour) {
    return Fn(() => {
        const out = air.toVar();
        const d = dir.toVar();
        If(U.dusk.greaterThan(0.001), () => {
            // The low sun: a wide ember glow round it, growing as it nears the horizon.
            const toSun = dot(d, U.sunDir).toVar();
            const glow = smoothstep(float(0.72), float(1.0), toSun);
            out.addAssign(sunColour.mul(vec3(...SUN_EMBER)).mul(glow.mul(glow).mul(U.warm).mul(0.55)));
            // The rays: bands by the angle round the antisolar axis, slow on the clock, seen only
            // where the belt is (they are its light and shade) and fading toward the point itself.
            If(U.rays.greaterThan(0.001).or(U.shafts.greaterThan(0.001)), () => {
                const axis = U.antiDir;
                const e1 = normalize(cross(axis, vec3(0, 1, 0)));
                const e2 = cross(e1, axis);
                const ang = atan(dot(d, e2), dot(d, e1)).toVar();
                const toAnti = dot(d, axis).toVar();
                // THE SHAFTS of the golden hour: the same bands, broad and few, across the high
                // sky the climb looks up into (the summit stands in front of them), warm where
                // the light passes and the sky's own blue between.
                const wide = noise2(vec2(ang.mul(3.1).add(U.time.mul(0.003)), U.time.mul(0.009).add(4.3))).mul(0.65)
                    .add(noise2(vec2(ang.mul(7.3).sub(U.time.mul(0.005)), U.time.mul(0.006).add(1.7))).mul(0.35));
                const shaft = smoothstep(float(0.50), float(0.68), wide).toVar();
                const high = smoothstep(float(0.06), float(0.30), d.y)
                    .mul(float(1).sub(smoothstep(float(0.80), float(0.97), d.y)))
                    .mul(float(1).sub(smoothstep(float(0.55), float(0.92), toSun)))
                    .toVar();
                // Gold where the light passes, and the sky a touch deeper between the beams
                // (their shade), so the fan reads as rays and not as a wash.
                out.mulAssign(float(1).sub(float(1).sub(shaft).mul(high).mul(U.shafts)
                    .mul(0.030)));
                out.addAssign(sunColour.mul(vec3(...SUN_GOLD)).mul(shaft.mul(high).mul(U.shafts).mul(0.075)));
                const band = noise2(vec2(ang.mul(5.5).add(U.time.mul(0.004)), U.time.mul(0.011)))
                    .mul(0.6)
                    .add(noise2(vec2(ang.mul(13.0).sub(U.time.mul(0.006)), U.time.mul(0.007).add(9.1))).mul(0.4));
                const beam = smoothstep(float(0.36), float(0.70), band).sub(0.5);
                const where = smoothstep(float(0.45), float(0.82), toAnti)
                    .mul(float(1).sub(smoothstep(float(0.97), float(0.999), toAnti)))
                    .mul(smoothstep(float(-0.02), float(0.06), d.y))
                    .mul(float(1).sub(smoothstep(float(0.26), float(0.50), d.y)));
                out.mulAssign(float(1).add(beam.mul(where).mul(U.rays).mul(0.11)));
            });
        });
        return out;
    })();
}

/** The cirrus at dusk: its colour takes the low sun (coral), and there is a little more of it. */
export function eveningCirrusColour(colour, sunColour) {
    return mix(colour, sunColour.mul(vec3(1.10, 0.78, 0.70)), U.dusk.mul(0.85));
}
export function eveningCirrusCover(cover) {
    return cover.mul(U.dusk.mul(0.75).add(1));
}

/**
 * A cloud's white through the evening: the sun's own colour by the end of the day (the sunlit
 * side of a sunset cloud is the sun's light, nothing whiter), a little brighter so it stays the
 * lightest thing in the sky. One node in place of the world's constant white, so the deck, the
 * field and every tone derived from it turn together.
 * @param {object} white vec3 node: the day's cloud white
 * @param {object} sunColour vec3 node
 */
export function eveningCloudWhite(white, sunColour) {
    const hue = sunColour.div(max(max(sunColour.x, sunColour.y), max(sunColour.z, float(0.001))));
    return mix(white, white.mul(hue).mul(1.05), U.cloud);
}

/**
 * How much of a cloud's sunlit tone is its white (the rest is the sun's own colour): `share` by
 * day, less as the evening runs, so the lit side burns with the low sun while the shade keeps the
 * sky's violet. The form of a sunset cloud is that difference of hue.
 * @param {number} share the day's share (0..1)
 */
export function eveningCloudLitShare(share) {
    return float(share).sub(U.cloud.mul(0.85)).max(0.12);
}

/**
 * THE LIGHTS OF THE EVENING SKY, added over the dome after the departure's fade (they come out as
 * the sky darkens; the caller fades them with the world's sky at the very end): the moon, the
 * first stars and a shooting star. Scene-linear, before the world's output scale.
 * @param {object} dir vec3 node: the view direction, unit
 */
export function eveningLights(dir) {
    return Fn(() => {
        const out = vec3(0).toVar();
        const d = dir.toVar();
        If(U.moon.greaterThan(0.001), () => {
            // In the lens's image plane, so the disc is round wherever it stands in the frame.
            const v = cameraViewMatrix.mul(vec4(d, 0)).xyz.toVar();
            const m = cameraViewMatrix.mul(vec4(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z, 0)).xyz.toVar();
            If(v.z.lessThan(-0.05).and(m.z.lessThan(-0.05)), () => {
                const tanR = Math.tan(ODYSSEY_MOON.radiusDeg * DEG);
                const off = v.xy.div(v.z.negate()).sub(m.xy.div(m.z.negate())).div(tanR).toVar();
                const r2 = dot(off, off).toVar();
                If(r2.lessThan(ODYSSEY_MOON.haloWidth * ODYSSEY_MOON.haloWidth * 1.6), () => {
                    // Its face in its own frame (turned from the image plane's axes).
                    const q = vec2(
                        off.x.mul(U.moonTurn.x).add(off.y.mul(U.moonTurn.y)),
                        off.y.mul(U.moonTurn.x).sub(off.x.mul(U.moonTurn.y)),
                    ).toVar();
                    const r = sqrt(r2);
                    const disc = float(1).sub(smoothstep(float(0.93), float(1.0), r));
                    const n = normalize(vec3(q, sqrt(max(float(1).sub(r2), float(0.0004)))));
                    // The terminator, soft over a few degrees of the sphere; the limb a little darker.
                    const day = smoothstep(float(-0.06), float(0.14), dot(n, U.moonLight));
                    const limb = n.z.mul(0.30).add(0.70);
                    // The seas: two reads of value noise over the face, in its own frame.
                    const seas = noise2(q.mul(1.9).add(vec2(3.7, 1.3))).mul(0.62)
                        .add(noise2(q.mul(4.6).add(vec2(8.1, 5.2))).mul(0.38));
                    const face = mix(float(1), float(0.66), smoothstep(float(0.46), float(0.70), seas));
                    const gain = float(ODYSSEY_MOON.gain[0]).add(U.dusk.mul(ODYSSEY_MOON.gain[1]));
                    const halo = exp(r2.div(ODYSSEY_MOON.haloWidth * ODYSSEY_MOON.haloWidth * 0.32).negate())
                        .mul(U.dusk)
                        .mul(ODYSSEY_MOON.halo);
                    out.addAssign(vec3(...ODYSSEY_MOON.colour).mul(
                        disc.mul(day).mul(limb).mul(face).mul(gain)
                            .add(halo),
                    ));
                });
            });
        });
        If(U.stars.greaterThan(0.001).and(d.y.greaterThan(-0.05)), () => {
            // One star a cell of a 3D lattice the sky's sphere passes through: no pole, no seam.
            // Cells of about a degree; a spot a pixel and a half of a 1080-line frame across.
            const scale = 58.0;
            const q = d.mul(scale).toVar();
            const cell = floor(q).toVar();
            const h1 = hash31(cell.add(vec3(1.7, 9.2, 4.1))).toVar();
            const star = normalize(cell.add(vec3(
                h1,
                hash31(cell.add(vec3(31.3, 7.7, 19.9))),
                hash31(cell.add(vec3(5.9, 43.1, 27.5))),
            ).mul(0.56).add(0.22))).mul(scale);
            const dist = length(q.sub(star));
            // Few are bright: the brightest come out first, high in the sky, and the field fills
            // downward as the night comes; each has its own slow twinkle.
            const mag = hash31(cell.add(vec3(71.1, 13.3, 57.7))).toVar();
            const shown = smoothstep(float(1.0).sub(U.stars.mul(0.14)), float(1.03).sub(U.stars.mul(0.11)), mag);
            const bright = mag.sub(0.86).div(0.14).clamp(0, 1).toVar();
            const twinkle = fract(mag.mul(37.0)).mul(6.2831853).add(U.time.mul(mag.mul(2.2).add(1.1)));
            const spot = exp(dist.mul(dist).div(0.0085).negate());
            const high = smoothstep(
                float(0.55).sub(U.stars.mul(0.50)),
                float(0.80).sub(U.stars.mul(0.50)),
                d.y,
            );
            out.addAssign(mix(vec3(0.80, 0.88, 1.0), vec3(1.0, 0.92, 0.80), fract(mag.mul(11.0)))
                .mul(spot.mul(shown).mul(high).mul(twinkle.sin().mul(0.22).add(0.78))
                    .mul(bright.mul(bright).mul(1.1).add(0.22))));
            // A shooting star: one slot, a new streak each `period` seconds, across the upper sky.
            const period = 13.0;
            const slot = floor(U.time.div(period)).toVar();
            const age = fract(U.time.div(period)).mul(period).div(0.85).toVar();
            If(age.lessThan(1.0), () => {
                const ha = hash31(vec3(slot, 3.1, 7.9));
                const hb = hash31(vec3(slot, 17.3, 2.2));
                const hc = hash31(vec3(slot, 5.5, 23.7));
                // Where it starts (upper sky, opposite the sun) and which way it runs (across, down).
                const start = normalize(U.antiDir.add(vec3(
                    ha.sub(0.5).mul(1.5),
                    hb.mul(0.55).add(0.50),
                    hc.sub(0.5).mul(1.5),
                )));
                const run = normalize(cross(start, vec3(ha.sub(0.5), 1.0, hc.sub(0.5))));
                const head = normalize(start.add(run.mul(age.mul(0.34)))).toVar();
                const rel = d.sub(head).toVar();
                const back = dot(rel, run).negate();
                const across = length(rel.add(run.mul(back)));
                const tail = smoothstep(float(0.11), float(0.0), back).mul(smoothstep(float(-0.004), float(0.0), back));
                const streak = exp(across.mul(across).div(0.0000045).negate()).mul(tail)
                    .mul(smoothstep(float(0.0), float(0.15), age))
                    .mul(float(1).sub(smoothstep(float(0.55), float(1.0), age)));
                out.addAssign(vec3(0.92, 0.96, 1.0).mul(streak.mul(U.stars).mul(0.9)));
            });
        });
        return out;
    })();
}
