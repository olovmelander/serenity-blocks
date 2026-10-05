/**
 * Ice Temple — what hangs in the air: snow, diamond dust, and the mist that lies on the ice.
 *
 * All three are closed form: a flake's place is a function of its seed and of three numbers the
 * world integrates (metres fallen, metres drifted, the vortex's turn), so nothing is simulated,
 * `seek(t)` reproduces any frame, and the resonance can slow the snow, hold it still in the air
 * and send it back up without a single flake jumping.
 *
 * The snow is lit, not white: each flake takes the moon only where the colonnade lets it through
 * (so the moon's shafts between the columns are drawn by the snowfall itself), burns when it
 * drifts between the eye and the Great Crystal, and takes the colour of a lock's shell as the
 * shell passes through it.
 */

import {
    Fn,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    dot,
    float,
    fract,
    length,
    max,
    mix,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    itClearLight,
    itFogAmount,
    itFxMaterial,
    itHeartLight,
    itLockLight,
    itMoonShadow,
    itPart,
    itQuadGeometry,
    itSaturate,
    itSpectrum,
    mulberry32,
} from './ice-temple-tsl.js';

/** The volume the snow falls through (metres), and where its centre is. */
export const SNOW_BOX = Object.freeze([66, 30, 80]);
export const SNOW_CENTRE = Object.freeze([0, 14, -30]);
/** The height the T-spin's vortex turns about. */
const SWIRL_AXIS_Y = 9;

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

function seeds(count, seed) {
    const rand = mulberry32(seed);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < data.length; i++) data[i] = rand();
    return data;
}

/** Where a flake is: its seed, wrapped through the box by the world's integrators. */
function flakePosition(u, seed, fallScale, driftScale, wander) {
    const speed = seed.w.mul(0.8).add(0.6);
    const sway = sin(u.time.mul(speed.mul(0.55)).add(seed.x.mul(40.0))).mul(wander);
    const x = fract(seed.x.add(u.snowDrift.mul(speed).mul(driftScale / SNOW_BOX[0])).add(sway));
    const y = fract(seed.y.sub(u.snowFall.mul(speed).mul(fallScale / SNOW_BOX[1])));
    const z = fract(seed.z.add(sin(u.time.mul(0.31).add(seed.z.mul(31.0))).mul(wander * 0.6)));
    const local = vec3(
        x.sub(0.5).mul(SNOW_BOX[0]).add(SNOW_CENTRE[0]),
        y.mul(SNOW_BOX[1]).add(SNOW_CENTRE[1] - SNOW_BOX[1] / 2),
        z.sub(0.5).mul(SNOW_BOX[2]).add(SNOW_CENTRE[2]),
    );
    // The vortex: the air turns about the nave's axis, the outer flakes lagging.
    const a = u.swirl.mul(seed.w.mul(0.5).add(0.6));
    const c = cos(a);
    const s = sin(a);
    const rx = local.x;
    const ry = local.y.sub(SWIRL_AXIS_Y);
    return vec3(rx.mul(c).sub(ry.mul(s)), rx.mul(s).add(ry.mul(c)).add(SWIRL_AXIS_Y), local.z);
}

/** What lights a point in the air (vertex stage): the moon's shafts, the heart, the pulses. */
function airLight(u, p, { moon: withMoon = true } = {}) {
    const rel = p.sub(cameraPosition);
    const dist = length(rel);
    const Vd = rel.div(max(dist, 1e-3));
    const toHeart = u.heartPos.sub(p);
    const heartDir = toHeart.div(max(length(toHeart), 1.0));
    const through = pow(itSaturate(dot(Vd, heartDir)), 4.0);
    const heart = itHeartLight(u, p).mul(through.mul(3.2).add(0.25));
    const moon = withMoon ? u.moonColor.mul(u.ambient).mul(itMoonShadow(p)).mul(0.85) : vec3(0.0);
    const sky = u.skyHorizon.mul(u.ambient).mul(2.2).add(u.auroraA.mul(u.auroraGain).mul(0.05));
    const clear = itClearLight(u, p.z);
    const pulse = itLockLight(u, p).mul(2.2).add(clear.rgb.mul(1.6));
    const fog = itFogAmount(u, rel, dist);
    return { light: heart.add(moon).add(sky).add(pulse), fog, dist };
}

/**
 * Snow.
 * @param {object} u
 * @param {number} count
 */
export function createSnow(u, count) {
    const geometry = itQuadGeometry(count, { aSeed: [seeds(count, 0x5a0f), 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = itFxMaterial('IceTempleSnow');
    const world = flakePosition(u, seed, 1.0, 1.0, 0.012);
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const air = airLight(u, world);
    const pxPerMetre = u.viewport.y.mul(u.projScale).div(max(clip.w, 0.3));
    // Flakes close to the lens are out of focus: bigger and fainter.
    const near = float(1.0).sub(smoothstep(1.5, 7.0, air.dist));
    const sizeM = seed.w.mul(0.03).add(0.022).mul(near.mul(2.6).add(1.0));
    const sizePx = max(sizeM.mul(pxPerMetre), 1.5);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(sizePx.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const gain = float(1.0).sub(air.fog).mul(mix(float(1.0), float(0.3), near))
        // A flake smaller than the pixel floor carries less light, not the same light.
        .mul(itSaturate(sizeM.mul(pxPerMetre).div(1.5)));
    const vLight = varying(air.light.mul(gain), 'itSnowLight');
    material.colorNode = Fn(() => {
        const d = length(uv().sub(0.5)).mul(2.0);
        const disc = float(1.0).sub(smoothstep(0.25, 1.0, d));
        return vec4(vLight.mul(disc.mul(disc)).mul(vec3(0.9, 0.96, 1.0)).mul(1.15), 0.0);
    })();
    const part = itPart('IceTempleSnow', geometry, material, 40, false);
    part.count = count;
    return part;
}

/**
 * Diamond dust: ice crystals small enough to hang in the air. Each one is dark until one of its
 * faces turns to the eye; then it flashes, in a colour off the prism.
 * @param {object} u
 * @param {number} count
 */
export function createDust(u, count) {
    const geometry = itQuadGeometry(count, { aSeed: [seeds(count, 0xd057), 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = itFxMaterial('IceTempleDust');
    // Dust barely falls, and wanders more.
    const world = flakePosition(u, seed, 0.12, 0.45, 0.02);
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const air = airLight(u, world);
    const turn = sin(u.time.mul(seed.w.mul(3.5).add(1.4)).add(seed.x.mul(97.0))).mul(0.5).add(0.5);
    const flash = pow(turn, 22.0);
    const pxPerMetre = u.viewport.y.mul(u.projScale).div(max(clip.w, 0.3));
    const sizePx = max(float(0.02).mul(pxPerMetre), 1.3).mul(flash.mul(1.6).add(0.6));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(sizePx.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const hue = itSpectrum(seed.y.add(u.time.mul(0.03)));
    const tint = mix(vec3(1.0), hue, 0.6);
    const vLight = varying(
        air.light.add(0.02).mul(tint).mul(flash.mul(9.0).add(0.05)).mul(float(1.0).sub(air.fog))
            .mul(u.dustGain),
        'itDustLight',
    );
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).abs().mul(2.0);
        // A four-point glint.
        const star = max(float(1.0).sub(q.x.mul(6.0).add(q.y)), float(1.0).sub(q.y.mul(6.0).add(q.x)));
        const core = float(1.0).sub(smoothstep(0.0, 0.5, length(q)));
        return vec4(vLight.mul(max(star, 0.0).mul(0.6).add(core.mul(core))), 0.0);
    })();
    const part = itPart('IceTempleDust', geometry, material, 41, false);
    part.count = count;
    return part;
}

/**
 * Mist banks: low, wide sheets of fog drifting over the ice. They are what the moon's shafts
 * and a lock's shell are seen in.
 * @param {object} u
 * @param {number} count
 */
export function createMist(u, count) {
    const data = seeds(count, 0x3157);
    const geometry = itQuadGeometry(count, { aSeed: [data, 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = itFxMaterial('IceTempleMist');
    const span = 84;
    const x = fract(seed.x.add(u.snowDrift.mul(seed.w.mul(0.5).add(0.5)).div(span))).sub(0.5).mul(span);
    const z = seed.z.mul(-74.0).add(1.0);
    const y = seed.y.mul(1.9).add(0.5);
    const centre = vec3(x, y, z);
    // A sheet facing the nave: wide, low, a little taller further off.
    const w = seed.w.mul(9.0).add(11.0);
    const h = seed.y.mul(1.6).add(1.9);
    const world = centre.add(vec3(positionGeometry.x.mul(w), positionGeometry.y.mul(h), 0.0));
    material.positionNode = world;
    const vWorld = varying(world, 'itMistWorld');
    const vSeed = varying(seed, 'itMistSeed');
    // A bank is soft and many metres wide: everything but the moon's shafts is lit per corner.
    const air = airLight(u, world, { moon: false });
    const vLight = varying(air.light.mul(0.5), 'itMistLight');
    const vFade = varying(
        smoothstep(2.0, 9.0, air.dist).mul(float(1.0).sub(smoothstep(60.0, 95.0, air.dist))),
        'itMistFade',
    );
    material.colorNode = Fn(() => {
        const st = uv();
        const n = u.noise(vec2(st.x.mul(1.3).add(vSeed.x.mul(7.0)).add(u.time.mul(0.008)), st.y.mul(0.6).add(vSeed.z.mul(3.0))));
        const edge = smoothstep(0.0, 0.3, st.x).mul(float(1.0).sub(smoothstep(0.7, 1.0, st.x)))
            .mul(smoothstep(0.0, 0.35, st.y)).mul(float(1.0).sub(smoothstep(0.45, 1.0, st.y)));
        const body = smoothstep(0.3, 0.8, n.r.mul(0.8).add(n.g.mul(0.4))).mul(edge);
        const light = u.moonColor.mul(u.ambient).mul(itMoonShadow(vWorld)).mul(0.5).add(vLight);
        // Never a wall in front of the lens, never a card in the far haze.
        const a = body.mul(vFade).mul(0.2);
        return vec4(light.mul(a), a.mul(0.35));
    })();
    const part = itPart('IceTempleMist', geometry, material, 20, false);
    part.count = count;
    return part;
}
