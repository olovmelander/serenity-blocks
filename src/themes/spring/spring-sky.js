/**
 * Spring — the sky dome.
 *
 * The hour's sky (spring-light skyColour: zenith, the horizon band, the aureole), a deck of
 * spring cumulus drifting over the valley, lit from the sun's side and silver at the edges against
 * it, and high cirrus above.
 *
 * Drawn LAST among the opaque parts with the depth test on and no depth write, so it is shaded only
 * where the sky shows.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    clamp,
    dot,
    exp,
    float,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    vec2,
    vec4,
} from 'three/tsl';
import { CLOUD_BASE, skyColour, sunGlow } from './spring-light.js';

export const SKY_RADIUS = 20000;

/** A cumulus field's density at a deck point (metres). */
function deckDensity(u, noise, p) {
    const a = texture(noise, p.div(9000.0)).r;
    const b = texture(noise, p.div(3400.0).add(vec2(0.37, 0.61))).g;
    const cover = a.mul(0.62).add(b.mul(0.38));
    // The same threshold the land's cloud shadows use (spring-land.js).
    const lo = float(0.82).sub(u.cloudCover.mul(0.6));
    return smoothstep(lo, lo.add(u.cloudCover.mul(0.3).add(0.12)), cover);
}

export function createSky(u, t, tier) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(u.eye)).toVar();
        const sky = skyColour(u, dir).toVar();
        const mu = dot(dir, u.sunDir).toVar();

        // ── The cumulus deck ──
        if (tier.clouds > 0) {
            If(dir.y.greaterThan(0.004), () => {
                const tDeck = float(CLOUD_BASE).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tDeck)).add(u.wind).toVar();
                const dens = deckDensity(u, t.noise, p).toVar();
                const fine = texture(t.noise, p.div(2600.0).add(vec2(0.13, 0.71))).b;
                dens.assign(clamp(dens.mul(1.15).sub(fine.mul(0.32).mul(float(1.0).sub(dens))), 0.0, 1.0));
                const toward = normalize(u.sunDir.xz.add(vec2(1e-4, 0.0)));
                const d1 = deckDensity(u, t.noise, p.add(toward.mul(420.0)));
                const d2 = deckDensity(u, t.noise, p.add(toward.mul(1100.0)));
                const shade = clamp(d1.mul(0.55).add(d2.mul(0.45)).sub(dens.mul(0.25)), 0.0, 1.0);
                const lit = float(1.0).sub(shade.mul(float(0.86).sub(u.cloudCover.mul(0.4))));
                const base = mix(u.cloudShade, u.cloudLit, lit);
                const rim = sunGlow(mu).mul(float(1.0).sub(dens).mul(dens).mul(4.0)).mul(u.glow).mul(0.9);
                const col = base.add(rim);
                const fade = exp(tDeck.div(30000.0).negate()).mul(smoothstep(0.025, 0.12, dir.y));
                sky.assign(mix(sky, col, dens.mul(fade).mul(0.95)));
            });
        }

        // ── High cirrus ──
        if (tier.clouds > 1) {
            If(dir.y.greaterThan(0.02), () => {
                const tHigh = float(7600.0).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tHigh)).add(u.wind.mul(1.8));
                const streak = texture(t.noise, vec2(p.x.div(90000.0), p.y.div(18000.0)).add(vec2(0.5, 0.2))).g;
                const wisp = texture(t.noise, vec2(p.x.div(24000.0), p.y.div(4600.0))).b;
                const c = smoothstep(0.55, 0.85, streak).mul(smoothstep(0.35, 0.75, wisp)).mul(0.42);
                const col = mix(u.cloudShade.mul(1.3), u.cloudLit, 0.75).add(u.glow.mul(sunGlow(mu)).mul(0.6));
                const fade = exp(tHigh.div(52000.0).negate());
                sky.assign(mix(sky, col, c.mul(fade)));
            });
        }

        return vec4(sky, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringSky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {
        mesh,
        meshes: [mesh],
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
