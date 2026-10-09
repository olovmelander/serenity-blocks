/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the sky over the line: the low sun (or the moon), a deck of trade-wind cloud lit from
 * beneath, the stars when the hour is dark, and the far sea under the horizon with the sun's
 * road on it. All of it in the hour's colours (U.light, U.stars).
 *
 * One dome, drawn last among the opaque parts with the depth test on: it is shaded only where
 * the eye of the barrel, or the water's torn edge, lets the sky show.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, atan, clamp, dot, exp, float, floor, fract, max, mix, normalize, positionGeometry, sin, smoothstep, texture,
    vec2, vec3, vec4,
} from 'three/tsl';
import { wavesSky } from './waves-tsl.js';

export function createSky({ tier, noise, U }) {
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    material.name = 'waves-sky';
    material.colorNode = Fn(() => {
        const dir = normalize(positionGeometry).toVar();
        const { sun, light } = U;
        const base = wavesSky(dir, sun, float(1.0), U.warm, light).toVar();
        const toward = clamp(dot(dir, sun).mul(0.5).add(0.5), 0.0, 1.0);

        // ── Cloud: a flat deck seen from below, drawn out along the horizon ──
        const plane = dir.xz.div(dir.y.add(0.16));
        const drift = vec2(U.time.mul(0.0016), U.time.mul(0.0007));
        const at = plane.mul(vec2(0.052, 0.15)).add(drift);
        const sunward = normalize(vec2(sun.x, sun.z)).mul(vec2(0.052, 0.15)).mul(0.5);
        const broad = texture(noise, at).b.toVar();
        const density = broad.toVar();
        const lee = texture(noise, at.add(sunward)).b.toVar();
        if (tier.clouds >= 2) {
            const fine = texture(noise, at.mul(3.1).add(vec2(0.37, 0.11)).sub(drift.mul(1.7))).a;
            density.assign(broad.mul(0.72).add(fine.mul(0.28)));
        }
        if (tier.clouds >= 3) {
            const wisp = texture(noise, plane.mul(vec2(0.021, 0.19)).add(vec2(0.61, U.time.mul(0.0011)))).a;
            density.addAssign(smoothstep(0.55, 0.9, wisp).mul(0.16));
        }
        const cover = smoothstep(0.5, 0.76, density)
            .mul(smoothstep(0.015, 0.16, dir.y))
            .mul(float(1.0).sub(smoothstep(0.55, 0.95, dir.y).mul(0.6)));
        // Lit from the sun's side and from beneath: the edge toward the sun burns in the hour's
        // fire, the far side and the thick middle go to the grey of its sky.
        const edge = clamp(density.sub(lee).mul(5.0).add(0.5), 0.0, 1.0);
        const t2 = toward.mul(toward);
        const fire = mix(light.cloudGlow, light.cloudFire, t2.mul(t2));
        const shade = mix(light.cloudFar, light.cloudShade, toward);
        const thick = smoothstep(0.62, 0.9, density);
        const cloud = mix(shade, fire, edge.mul(float(1.0).sub(thick.mul(0.55))))
            .mul(mix(vec3(1.0), vec3(1.14, 1.0, 0.82), U.warm));
        // Long bars of cloud low over the sea, lit from beneath: fire toward the sun, mauve away.
        const bearing = atan(dir.x, dir.z.negate());
        const bar = texture(noise, vec2(bearing.mul(0.33).add(U.time.mul(0.0006)), dir.y.mul(5.2).add(0.17))).b;
        const bars = smoothstep(0.55, 0.72, bar)
            .mul(smoothstep(0.012, 0.05, dir.y))
            .mul(float(1.0).sub(smoothstep(0.17, 0.36, dir.y)));
        const barColour = mix(light.barFar, light.barSun, t2.mul(t2))
            .mul(mix(vec3(1.0), vec3(1.14, 1.0, 0.82), U.warm));
        // ── Stars: out when the hour is dark, behind the cloud ──
        const starAt = vec2(bearing, dir.y).mul(64.0);
        const cell = floor(starAt);
        const h1 = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));
        const h2 = fract(sin(dot(cell, vec2(269.5, 183.3))).mul(43758.5453));
        const off = fract(starAt).sub(0.5).sub(vec2(h1, h2).sub(0.5).mul(0.6));
        // Few are bright; each has its own slow twinkle.
        const bright = h2.mul(h2).mul(h2).mul(smoothstep(0.45, 0.5, h1));
        const twinkle = sin(U.time.mul(h1.mul(1.6).add(0.7)).add(h2.mul(40.0))).mul(0.3).add(0.7);
        const stars = vec3(0.8, 0.9, 1.0).mul(exp(dot(off, off).mul(-150.0)).mul(bright).mul(twinkle).mul(4.5))
            .mul(U.stars)
            .mul(smoothstep(0.03, 0.2, dir.y))
            .mul(float(1.0).sub(max(cover, bars)));
        const sky = mix(mix(base, cloud, cover.mul(0.92)), barColour, bars.mul(0.8)).add(stars);

        // ── The far sea: the sun's road, broken into sparks ──
        const below = float(1.0).sub(smoothstep(-0.004, 0.0, dir.y));
        const down = max(dir.y.negate(), 0.0015);
        const sea = dir.xz.div(down);
        const spark = texture(noise, sea.mul(vec2(0.012, 0.004)).add(vec2(0.0, U.time.mul(0.02)))).a;
        const road = exp(dot(normalize(dir.xz), normalize(vec2(sun.x, sun.z))).sub(1.0).mul(120.0));
        const sparks = smoothstep(0.62, 0.9, spark).mul(road).mul(exp(down.mul(-9.0)));
        const glitter = vec3(7.0, 4.6, 2.0).mul(light.fireTint).mul(sparks).mul(below);
        return vec4(mix(sky, base, below).add(glitter), 1.0);
    })();

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
    mesh.name = 'waves-sky';
    mesh.scale.setScalar(4200);
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    return {
        mesh,
        /** The dome rides with the lens. */
        follow(camera) {
            mesh.position.copy(camera.position);
            mesh.updateMatrixWorld();
        },
        dispose() {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            material.dispose();
        },
    };
}
