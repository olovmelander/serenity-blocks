/**
 * Synthwave Sunset — the sky dome: ONE draw for the dusk gradient, the setting sun and its glow,
 * the high cloud, the first stars and the shooting stars.
 *
 * The dome draws `swSky` (synthwave-sunset-tsl.js) along the view ray; the sea and the wet sand
 * call the same function along their mirror rays. Everything is a function of the view direction,
 * so the dome's radius and tessellation do not matter; it only has to surround the camera. It is
 * drawn after the opaque world with the depth test on, so it shades only where sky shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    atan,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    vec2,
} from 'three/tsl';
import { rgb, swSky, swSkyGradient } from './synthwave-sunset-tsl.js';

/** Sky dome radius: beyond the sea's far edge, inside RIG.far. */
export const SKY_RADIUS = 6000;

/**
 * One shooting star in (azimuth, elevation) space. A = (az0, e0, vAz, vE) [rad, rad/s],
 * B = (age s, tail length rad, intensity, 0). Returns the streak intensity at p; the tail fades
 * quadratically toward its end. `pxRad` = radians per pixel.
 */
const swShootingStar = /* @__PURE__ */ Fn(([p, A, B, pxRad]) => {
    const head = A.xy.add(A.zw.mul(B.x));
    const dirV = normalize(A.zw.add(vec2(1e-5, 0.0)));
    const tail = head.sub(dirV.mul(B.y));
    const pa = p.sub(tail);
    const ba = head.sub(tail);
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-8)), 0.0, 1.0);
    const dPx = length(pa.sub(ba.mul(h))).div(pxRad);
    return exp(dPx.mul(dPx).mul(-0.5)).mul(h.mul(h)).mul(B.z);
}).setLayout({
    name: 'sw_shootingStar',
    type: 'float',
    inputs: [
        { name: 'p', type: 'vec2' },
        { name: 'A', type: 'vec4' },
        { name: 'B', type: 'vec4' },
        { name: 'pxRad', type: 'float' },
    ],
});

/**
 * @param {object} u       shared world uniforms (see createWorldUniforms)
 * @param {object} [opts]
 * @param {number} [opts.cloudOctaves=3]  0 = no clouds, 2 or 3
 * @param {boolean} [opts.stars=true]
 * @param {boolean} [opts.shootingStars=true]
 */
export function createSky(u, opts = {}) {
    const cloudOctaves = opts.cloudOctaves ?? 3;
    const withStars = opts.stars !== false;
    const withShooting = opts.shootingStars !== false;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = true;
    material.fog = false;

    material.colorNode = Fn(() => {
        // Every derivative is taken here, in uniform control flow.
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const e = dir.y.toVar();
        const az = atan(dir.x, dir.z.negate()).toVar();
        const pxRad = max(fwidth(e), 1e-5).toVar();
        const sky = swSky(u, dir, {
            pxRad, clouds: cloudOctaves, stars: withStars, sunDisc: true, az,
        });
        const col = sky.color.toVar();

        if (withShooting) {
            If(u.shoot0B.z.add(u.shoot1B.z).greaterThan(0.0), () => {
                const p = vec2(az, e);
                const s = swShootingStar(p, u.shoot0A, u.shoot0B, pxRad)
                    .add(swShootingStar(p, u.shoot1A, u.shoot1B, pxRad));
                col.addAssign(rgb(0xe4eeff, 2.6).mul(s.mul(float(1.0).sub(sky.cloud.mul(0.8)))));
            });
        }

        // Below the horizon the sea covers the dome; hold the horizon colour there so a seam
        // can never show between the sea's far edge and the sky.
        const below = swSkyGradient(u, dir).color;
        return mix(below, col, smoothstep(-0.002, 0.0008, e));
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SynthwaveSkyDome';
    mesh.renderOrder = 50;
    mesh.frustumCulled = false;
    return mesh;
}
