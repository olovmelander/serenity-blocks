/**
 * Nimbus Veil — the light in the air round the lamp of the hour (the sun by day, the young moon
 * once the stars are out): a cascade's rays and a twist's corona.
 *
 * Two of the events' own instruments (the world drives them, u.rays and u.optics):
 *   the rays     one for each wave of a cascade, standing together like the pipes of an organ;
 *                a perfect clear and a new run's dawn open the whole fan
 *   the corona   rings of mother-of-pearl close round the disc, turning: a twist
 *
 * One additive card that follows the lamp, drawn after the towers with no depth test: light in
 * the air between the eye and a cloud shows in front of the cloud, so a ray is never cut by a
 * tower (the towers composite over the sky function, where these were first drawn and were
 * hidden). One uniform test skips the corona at rest, and the card's own edge fades out before
 * anything could be cut by it. Its light is added with an alpha of zero (premultiplied, a custom
 * output), so the scene pass's alpha is left as it was under the card: a bird's mark there
 * (nimbus-veil-albatross.js) reaches the post.
 *
 * What is NOT here, on purpose: a halo ring, sundogs, a sun pillar, arcs. They were tried for
 * this pass and they are Parhelion's (that theme is an ice-halo display): this one keeps to what
 * a sea of clouds does with light.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    cameraPosition,
    dot,
    exp,
    float,
    fract,
    int,
    length,
    max,
    min,
    normalize,
    positionGeometry,
    positionWorld,
    smoothstep,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { nvSpectrum } from './nimbus-veil-tsl.js';

/** How many rays can stand in the sky at once. */
export const RAY_SLOTS = 7;

/** The card reaches this far from the lamp (the tangent of the angle), and stands this far off. */
const EXTENT = 0.82;
const DISTANCE = 1000;

/**
 * @param {object} u  shared world uniforms
 * @returns {THREE.Mesh}
 */
export function createOptics(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NimbusOptics';
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;

    material.positionNode = cameraPosition.add(u.lampDir.mul(DISTANCE))
        .add(u.lampRight.mul(positionGeometry.x.mul(DISTANCE * EXTENT)))
        .add(u.lampUp.mul(positionGeometry.y.mul(DISTANCE * EXTENT)));

    const lightInAir = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        // The lamp's frame: local tangent coordinates ≈ angle from its centre (radians).
        const lx = dot(dir, u.lampRight).toVar();
        const ly = dot(dir, u.lampUp).toVar();
        const ang = length(vec2(lx, ly)).toVar();
        const light = vec3(0.0).toVar();

        // ── The rays. Each slot is (cos, sin of its bearing round the lamp, light, sharpness):
        // a soft blade with a bright core, widening as it leaves the lamp. Deep gold by day
        // (u.lampTint): against the sun's own white-gold glow, colour is what shows. ──
        const rayLight = float(0.0).toVar();
        const round = vec2(lx, ly).div(max(ang, 1e-4)).toVar();
        Loop({
            start: int(0), end: int(RAY_SLOTS), type: 'int', condition: '<',
        }, ({ i }) => {
            const ray = u.rays.element(i);
            const along = round.x.mul(ray.x).add(round.y.mul(ray.y)).sub(1.0);
            rayLight.addAssign(exp(along.mul(ray.w)).mul(0.65).add(exp(along.mul(ray.w).mul(5.0)).mul(0.6)).mul(ray.z));
        });
        const rayReach = smoothstep(u.lampInfo.x, u.lampInfo.x.mul(2.6), ang).mul(exp(ang.mul(-1.5)));
        light.addAssign(u.lampTint.mul(min(rayLight, 2.5).mul(rayReach).mul(2.6)));

        // ── The corona: rings of mother-of-pearl close round the disc, turning (a twist). ──
        If(u.optics.x.greaterThan(0.003), () => {
            const corona = nvSpectrum(fract(ang.mul(11.0).sub(u.optics.y))).mul(exp(ang.mul(-8.5)))
                .mul(smoothstep(u.lampInfo.x, u.lampInfo.x.mul(1.7), ang));
            light.addAssign(corona.mul(u.optics.x).mul(1.7));
        });

        // Nothing reaches the card's edge: it fades out well inside it. u.lampInfo.y is the
        // lamp's own share (it dips to nothing while the sun hands over to the moon), .z how
        // bright the hour lets event light be (the night's is the moon's).
        const edge = float(1.0).sub(smoothstep(0.5, 0.62, ang));
        return light.mul(edge).mul(u.lampInfo.y).mul(u.lampInfo.z);
    })();
    material.outputNode = vec4(lightInAir, 0.0);

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.name = 'NimbusOptics';
    mesh.frustumCulled = false;
    mesh.renderOrder = 36;
    return mesh;
}
