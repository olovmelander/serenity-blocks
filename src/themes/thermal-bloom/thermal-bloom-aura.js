/**
 * Thermal Bloom — the great bow: a shower's double rainbow standing in the basin's air.
 *
 * The theme's one rainbow lives in the Chalice's spray (the march's bow, at four lines). A perfect
 * clear earns the whole thing: the Sleeper's fall-back drifts across the basin as a shower, and
 * the bow stands in it from the floor into the sky, the primary bright, the secondary outside it
 * with its colours reversed, the air between them a shade darker than the air inside the primary.
 * Its place is the sun's (the same antisolar geometry as the spray's bow, so it rises where the
 * Chalice's column wears its own), and its light is the sun's: by night it is a moonbow, pale and
 * nearly white.
 *
 * One camera-facing sheet standing CURTAIN metres out along the view, depth-tested: whatever is
 * nearer (the Stair, the Chalice's mound, the snags) stands in front of the shower, and the bow
 * rises from behind it. It adds light only, and is not drawn at all while no bow stands
 * (`part.mesh.visible`, set by the world).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    acos,
    atan,
    clamp,
    dot,
    float,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    smoothstep,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    tbFxMaterial,
    tbLuma,
    tbPart,
} from './thermal-bloom-tsl.js';

/** How far out along the view the shower stands (metres). */
export const CURTAIN = 360;
/** The secondary bow's band (degrees from the antisolar point), red inside. */
export const BOW2 = Object.freeze({ inner: 50.4, outer: 53.6 });

/** The spectrum at x = 0 (violet) … 6 (red), linear rgb. */
function spectrum(x) {
    const stops = [
        vec3(0.32, 0.08, 0.55), vec3(0.1, 0.2, 0.85), vec3(0.05, 0.55, 0.65), vec3(0.1, 0.7, 0.18),
        vec3(0.85, 0.78, 0.08), vec3(0.95, 0.42, 0.04), vec3(0.8, 0.07, 0.04),
    ];
    let c = stops[0];
    for (let i = 1; i < stops.length; i++) c = mix(c, stops[i], clamp(x.sub(i - 1), 0.0, 1.0));
    return c;
}

/**
 * The great bow's part.
 * @param {object} u    the shared uniforms
 * @param {object} tex  the world's baked textures (the noise atlas)
 */
export function createAura(u, tex) {
    /** How much of the bow stands (0 none … 1), and the secondary's share of it. */
    const amount = uniform(0);
    const second = uniform(0.45);

    const material = tbFxMaterial('ThermalBloomAura', { depthTest: true });
    // The sheet: the frame's own rectangle, CURTAIN metres out along each view ray's forward
    // distance (a plane facing the camera), a little oversized so the rig's breath never shows
    // its edge.
    material.positionNode = Fn(() => {
        const nx = positionGeometry.x.mul(1.08);
        const ny = positionGeometry.y.mul(1.08);
        return u.camPos.add(u.camFwd.mul(CURTAIN))
            .add(u.camRight.mul(nx.mul(u.tanHalf.x).mul(CURTAIN)))
            .add(u.camUp.mul(ny.mul(u.tanHalf.y).mul(CURTAIN)));
    })();
    const auraFn = Fn(() => {
        const dir = normalize(positionWorld.sub(u.camPos)).toVar();
        const deg = acos(clamp(dot(dir.negate(), u.sunDir), -1.0, 1.0)).mul(180.0 / Math.PI).toVar();
        // The primary: violet inside at 40.6°, red outside at 42.4°.
        const x1 = clamp(deg.sub(40.6).div(1.8), 0.0, 1.0).mul(6.0);
        const band1 = smoothstep(39.6, 40.9, deg).mul(float(1.0).sub(smoothstep(42.0, 43.4, deg)));
        // The secondary: wider, fainter, its colours the other way round.
        const x2 = clamp(float(BOW2.outer).sub(deg).div(BOW2.outer - BOW2.inner), 0.0, 1.0).mul(6.0);
        const band2 = smoothstep(49.4, 50.9, deg).mul(float(1.0).sub(smoothstep(53.0, 54.6, deg)));
        // Inside the primary the shower sends more light back than outside it; between the two
        // bows it sends least (the dark band): the bright inside is what this sheet can add.
        const inside = float(1.0).sub(smoothstep(38.0, 40.8, deg));
        // The shower: falling streaks, thicker in some curtains than others, drifting downwind.
        const az = atan(dir.x, dir.z.negate());
        const fall = texture(tex.noise, vec2(az.mul(5.0).add(u.time.mul(0.004)), dir.y.mul(1.4).add(u.time.mul(0.11))))
            .level(0);
        const banks = texture(tex.noise, vec2(az.mul(0.9).sub(u.time.mul(0.003)), 0.37)).level(0).y;
        const shower = smoothstep(0.2, 0.75, fall.x).mul(0.35).add(0.65)
            .mul(smoothstep(0.2, 0.6, banks).mul(0.45).add(0.55));
        // The sun's light, a little whitened (a moonbow is nearly white).
        const sunTint = mix(vec3(tbLuma(u.sunColor)), u.sunColor, 0.3).mul(0.98);
        const colours = spectrum(x1).mul(band1.mul(0.8))
            .add(spectrum(x2).mul(band2.mul(0.62)).mul(second));
        // (by night the eye sees a moonbow nearly white: its colours pale with the stars)
        const light = mix(colours, vec3(tbLuma(colours).mul(1.6)), u.stars.mul(0.78))
            .add(vec3(0.05, 0.055, 0.06).mul(inside));
        return vec4(light.mul(sunTint).mul(shower).mul(amount), 0.0);
    });
    material.colorNode = auraFn();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    // After the solids and the backdrop, before the steam's sheets and the drops.
    const part = tbPart('ThermalBloomAura', geometry, material, 53);
    part.mesh.visible = false;
    /** Stand the bow at `value` (0 none … 1); `secondary` its outer bow's share. */
    part.setBow = (value, secondary = 0.45) => {
        const v = Math.max(0, Math.min(1, Number(value) || 0));
        amount.value = v;
        second.value = Math.max(0, Math.min(1, Number(secondary) || 0));
        part.mesh.visible = v > 0.004;
    };
    part.bow = () => amount.value;
    return part;
}
