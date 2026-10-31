/**
 * THE ANTISOLAR SKY — a rainbow, and the shower that makes it (Act II, chapters 3-4).
 *
 * Act II flies with its sun ~15 deg up behind and to the left of the camera (ODYSSEY_WORLD_SUN,
 * turned to the side 2026-10-25), which hands it the antisolar effects: the antisolar point sits
 * ~15 deg below the horizon off to the right of travel, so a primary bow (42 deg round it) stands
 * at the right of the frame, its foot coming down right of the massif from the shore orbs.
 * That is where it is drawn: on the world's own sky dome, centred on the TRUE antisolar direction
 * (so it is a property of the light, not a sticker placed for one camera), behind everything that
 * stands in front of the sky.
 *
 * What is drawn (all analytic, ~30 ALU, inside a uniform branch the CPU opens only while a bow is
 * scheduled — the dome shades nothing extra for the rest of the journey):
 *   - the PRIMARY bow at 40.6-42.4 deg, red outside, and the fainter SECONDARY at 50-53.4 deg with
 *     its colours reversed;
 *   - the brighter sky INSIDE the primary and Alexander's darker band between the two bows — the
 *     two cues that make a painted bow read as optics rather than a decal;
 *   - the SHOWER: a slate veil of rain hanging under the low sky round the antisolar azimuth,
 *     streaked by falling shafts. A bow is vivid against rain and invisible against a clean noon
 *     sky; the veil is what gives it something to stand on. It grows a little before the bow and
 *     thins after it.
 * The bow fades toward its crown (thinner rain aloft) and onto the horizon (the shower's foot).
 *
 * Pure TSL builder: every input is a node or a plain number, nothing is captured, so the sky
 * material owns its uniforms and the branch.
 */
import {
    acos, atan, clamp, dot, exp, float, floor, fract, max, mix, sin, smoothstep, vec3,
} from 'three/tsl';

const DEG = 180 / Math.PI;

/** Bow geometry (degrees from the antisolar point) and look. */
export const ODYSSEY_BOW = Object.freeze({
    primary: Object.freeze([40.6, 42.4]),
    secondary: Object.freeze([50.2, 53.4]),
    /** Peak added light of the primary at full strength (linear, before the world's output scale). */
    gain: 0.30,
    secondaryGain: 0.32,
    /** How much brighter the sky is just inside the primary, and darker in Alexander's band. */
    inside: 0.10,
    alexander: 0.12,
    /** Supernumerary bands inside the primary: [centre (deg), width (deg), strength]. */
    supernumerary: Object.freeze([
        Object.freeze([40.05, 0.22, 0.20]),
        Object.freeze([39.45, 0.22, 0.12]),
        Object.freeze([38.90, 0.22, 0.07]),
    ]),
    /** The shower: azimuth half-width round the antisolar bearing (deg), top elevation (deg). */
    showerHalfWidth: 62,
    showerTop: 24,
    showerDepth: 0.58,
});

/** Gaussian of x around c with width w, as a node (a product, never `pow` of a signed base). */
const gauss = (x, c, w) => {
    const d = x.sub(c).div(w);
    return exp(d.mul(d).negate());
};

/**
 * The light of the primary and the secondary bow at `theta` degrees from the antisolar point
 * (unscaled: the primary peaks near 1). Shared by the sky and by the shower's rain, which draws
 * the bow where the rain is (odyssey-shower.js).
 * @param {object} theta float node, degrees
 */
export function bowSpectrum(theta) {
    const B = ODYSSEY_BOW;
    // Primary: normalised 0 (violet, inner edge) .. 1 (red, outer edge).
    const tP = theta.sub(B.primary[0]).div(B.primary[1] - B.primary[0]);
    const red = gauss(tP, 0.88, 0.17);
    const yellow = gauss(tP, 0.68, 0.14);
    const green = gauss(tP, 0.50, 0.16);
    const blue = gauss(tP, 0.22, 0.15);
    const violet = gauss(tP, 0.04, 0.10).mul(0.55);
    const primary = vec3(
        red.add(yellow.mul(0.9)).add(violet.mul(0.6)),
        yellow.mul(0.85).add(green),
        blue.add(violet),
    ).mul(smoothstep(float(-0.35), float(-0.05), tP).mul(float(1).sub(smoothstep(float(1.05), float(1.35), tP))));
    // Secondary: reversed (red INSIDE), wider and fainter.
    const tS = float(1).sub(theta.sub(B.secondary[0]).div(B.secondary[1] - B.secondary[0]));
    const red2 = gauss(tS, 0.88, 0.2);
    const green2 = gauss(tS, 0.5, 0.2);
    const blue2 = gauss(tS, 0.18, 0.2);
    const secondary = vec3(red2.add(green2.mul(0.25)), green2.add(red2.mul(0.3)), blue2)
        .mul(smoothstep(float(-0.3), float(0.0), tS).mul(float(1).sub(smoothstep(float(1.0), float(1.3), tS))))
        .mul(B.secondaryGain);
    // SUPERNUMERARIES (round three): the faint pastel bands just inside the primary's violet edge,
    // pink and green by turns, each fainter than the last: the interference that makes a fine bow
    // look luminous rather than painted.
    let supern = vec3(0, 0, 0);
    B.supernumerary.forEach(([centre, width, k], i) => {
        const tint = i % 2 === 0 ? vec3(0.95, 0.55, 0.85) : vec3(0.45, 0.95, 0.60);
        supern = supern.add(tint.mul(gauss(theta, float(centre), float(width)).mul(k)));
    });
    return primary.add(secondary).add(supern);
}

/**
 * The sky's own light round the bow, as the shower draws it (round three): brighter inside the
 * primary (light scattered back by every drop inside the cone), darker in Alexander's band between
 * the two bows (no light reaches the eye from there). Returns { glow, band }, both 0..1.
 * @param {object} theta float node, degrees from the antisolar point
 */
export function bowSkyLight(theta) {
    const B = ODYSSEY_BOW;
    const glow = smoothstep(float(22.0), float(B.primary[0] - 0.3), theta)
        .mul(float(1).sub(smoothstep(float(B.primary[0] - 0.3), float(B.primary[0] + 0.6), theta)));
    const band = smoothstep(float(B.primary[1] - 0.1), float(B.primary[1] + 1.4), theta)
        .mul(float(1).sub(smoothstep(float(B.secondary[0] - 1.4), float(B.secondary[0] + 0.1), theta)));
    return { glow, band };
}

/**
 * Light added by the bows plus the sky's own brightening/darkening around them, and the shower's
 * veil. Returns `sky` with all of it applied.
 * @param {object} p
 * @param {object} p.sky       vec3 node: the sky colour at this direction (linear, world space)
 * @param {object} p.dir       vec3 node: the view direction (unit)
 * @param {object} p.anti      vec3 node: the antisolar direction (unit, = -sunDir)
 * @param {object} p.bow       float node 0..1: the bow's strength
 * @param {object} p.veil      float node 0..1: the shower veil's strength
 * @param {object} p.sunColour vec3 node: the light the drops refract
 * @param {object} p.time      float node: seconds (the rain shafts drift)
 */
export function applyAntisolarSky({
    sky, dir, anti, bow, veil, sunColour, time,
}) {
    const B = ODYSSEY_BOW;
    const theta = acos(clamp(dot(dir, anti), -1, 1)).mul(DEG).toVar('bowTheta');
    // Elevation of the view direction, degrees (the bow fades toward its crown and its foot).
    const elev = dir.y.mul(57.29578).toVar('bowElev');

    // ── The shower veil: low sky round the antisolar azimuth, streaked by rain shafts ──
    const antiAz = atan(anti.x, anti.z.negate());
    const az = atan(dir.x, dir.z.negate());
    // Wrapped azimuth difference, degrees.
    const dAz = fract(az.sub(antiAz).div(6.2831853).add(0.5)).sub(0.5).mul(360.0);
    const across = float(1).sub(smoothstep(float(B.showerHalfWidth * 0.55), float(B.showerHalfWidth), dAz.abs()));
    const low = float(1).sub(smoothstep(float(B.showerTop * 0.35), float(B.showerTop), elev))
        .mul(smoothstep(float(-3.0), float(0.5), elev));
    // Shafts: columns in azimuth, a coarse and a fine set, leaning a little and drifting.
    const col = az.mul(DEG).add(elev.mul(0.35)).add(time.mul(0.12));
    const shaftA = fract(sin(floor(col.div(2.6)).mul(91.7)).mul(43758.5));
    const shaftB = fract(sin(floor(col.div(0.9)).mul(37.3)).mul(23421.6));
    const shafts = smoothstep(float(0.30), float(0.95), shaftA.mul(0.65).add(shaftB.mul(0.35)));
    const veilW = across.mul(low).mul(veil).mul(shafts.mul(0.6).add(0.4)).toVar('bowVeil');
    const slate = vec3(0.50, 0.55, 0.62).mul(dot(sky, vec3(0.2126, 0.7152, 0.0722)).mul(1.15));
    const wet = mix(sky, slate, veilW.mul(B.showerDepth));

    // ── The bows ──
    const bows = bowSpectrum(theta);
    // Brighter inside the primary, darker in Alexander's band.
    const insideLift = smoothstep(float(18.0), float(B.primary[0]), theta)
        .mul(float(1).sub(smoothstep(float(B.primary[0]), float(B.primary[0] + 0.8), theta)))
        .mul(B.inside);
    const band = smoothstep(float(B.primary[1] - 0.2), float(B.primary[1] + 1.2), theta)
        .mul(float(1).sub(smoothstep(float(B.secondary[0] - 1.2), float(B.secondary[0] + 0.2), theta)))
        .mul(B.alexander);
    // Fainter toward the crown (thinner rain aloft) and right at the horizon.
    const crown = float(1).sub(smoothstep(float(10.0), float(26.0), elev)).mul(0.65).add(0.35)
        .mul(smoothstep(float(-1.5), float(1.5), elev));
    // A bow is brightest where it stands on the shower.
    const onRain = veilW.mul(0.8).add(0.45);
    const strength = bow.mul(crown).mul(onRain);
    const light = bows.mul(B.gain).mul(sunColour);
    const lifted = wet.mul(float(1).add(insideLift.mul(strength)).sub(band.mul(strength)));
    return max(lifted.add(light.mul(strength)), vec3(0, 0, 0));
}

/**
 * THE WHOLE ACT (round three, 2026-10-31). Olov: "the rainbow needs to be there all the time not
 * just for a short while". Probed on the real camera (the fade test's rig): the bow is in frame
 * at the shore orbs, over the meadows (p 0.20-0.21, 0.26-0.27) and through the WHOLE climb (p 0.32
 * to 0.69, a third to all of its arc), where it used to be switched off at p ~0.30. It now stands
 * from the start of chapter 3, fading in before any of it reaches the screen (p ~0.10-0.135), until
 * the eye climbs out above the cloud deck at the departure (p ~0.69-0.72): above the rain there is
 * no bow, and the world itself leaves there. In Act II progress (actT = (p - 0.065) / 0.689):
 * [in from, full by, out from, gone by].
 */
export const ANTISOLAR_WINDOW = Object.freeze({
    veil: Object.freeze([0.045, 0.095, 0.910, 0.955]),
    bow: Object.freeze([0.050, 0.100, 0.905, 0.950]),
});

/**
 * Strength of the shower veil and of the bow over Act II progress (pure; exported for its test).
 * Keyed to PROGRESS, not time, so every parked orb in the window sees the same sky: the shower
 * gathers over the shore orbs (L14-), the bow stands from L15, and both leave only once the
 * camera has turned away from them.
 *
 * WHERE THEY LEAVE IS MEASURED, NOT CHOSEN (odyssey-act2-fade-out-of-view.test.js). A bow is
 * never "passed": it stays opposite the sun however far the eye travels, so the only clean exit
 * is a stretch of the rail where it is out of view. The bow used to fade over L21 -> L22 (actT
 * 0.290-0.322), and L21 — framed for "the meadow below the massif's sunlit flank, the bow
 * beyond" — parked on a bow at 78 % that then faded with two thirds of it on screen. On the
 * real camera and height field, after L21 the view swings west to the far peak and the ground
 * hides the antisolar sky: neither bow nor shower reaches a pixel from p 0.280 to 0.317 (just
 * after L21 to just past L24). Both now hold full until L22 parks and fade inside that blind
 * stretch: bow p 0.284-0.305, shower p 0.287-0.309 (actT x 0.6894 + 0.0649).
 * @param {number} actT 0..1 across Act II
 * @returns {{bow:number, veil:number}}
 */
export function antisolarSchedule(actT) {
    const t = Number.isFinite(actT) ? actT : 0;
    const ramp = (a, b, x) => {
        const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
        return u * u * (3 - (2 * u));
    };
    const window = (a, b, c, d) => ramp(a, b, t) * (1 - ramp(c, d, t));
    return {
        veil: window(ANTISOLAR_WINDOW.veil[0], ANTISOLAR_WINDOW.veil[1], ANTISOLAR_WINDOW.veil[2], ANTISOLAR_WINDOW.veil[3]),
        bow: window(ANTISOLAR_WINDOW.bow[0], ANTISOLAR_WINDOW.bow[1], ANTISOLAR_WINDOW.bow[2], ANTISOLAR_WINDOW.bow[3]),
    };
}
