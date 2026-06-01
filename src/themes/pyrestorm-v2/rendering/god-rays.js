/* eslint-disable import/no-unresolved */
/**
 * Pyrestorm V2 — God Rays
 *
 * A soft volumetric light shaft scattering up from the vent through the ash —
 * an open cone (wide at the top) with FBM angular streaks, brightest at the
 * base and fading up. Additive but deliberately low-intensity so it reads as
 * crepuscular scattering, not another white hotspot. Scales with gameplay
 * intensity. Selective bloom (Phase 6) will give it a gentle glow.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    float,
    oneMinus,
    positionWorld,
    smoothstep,
    uniform,
    uv,
    vec3,
    vec4,
} from 'three/tsl';
import { fbm3 } from '../materials/tsl-fire-lib.js';

const VENT_Y = 155;
const RAY_HEIGHT = 950;
const TOP_RADIUS = 360;

export function createGodRays() {
    const uTime = uniform(0);
    const uIntensity = uniform(0);

    const geometry = new THREE.ConeGeometry(TOP_RADIUS, RAY_HEIGHT, 48, 1, true);
    geometry.rotateX(Math.PI); // wide end up, apex at the vent

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const shade = Fn(() => {
        const v = uv();
        const streak = fbm3(vec3(v.x.mul(16.0), v.y.mul(2.5).add(uTime.mul(0.12)), 0.0));
        const beam = smoothstep(0.5, 0.85, streak);
        const hFade = oneMinus(smoothstep(float(VENT_Y), float(VENT_Y + RAY_HEIGHT), positionWorld.y));
        const intensity = uIntensity.mul(0.4).add(0.1);
        const col = vec3(1.0, 0.5, 0.22).mul(beam).mul(hFade).mul(intensity)
            .mul(0.28);
        return vec4(col, 1.0);
    })();

    material.colorNode = shade;
    material.emissiveNode = shade.rgb;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = VENT_Y + RAY_HEIGHT / 2;
    mesh.frustumCulled = false;
    mesh.renderOrder = 9; // behind the fire

    return {
        mesh,
        uniforms: { uTime, uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
