/**
 * High Coast — the sky dome.
 *
 * The hour's sky (high-coast-light skyColour: zenith, the horizon band, the aureole and disc), a
 * deck of fair-weather cumulus at the height the cloud shadows come from (the same two noise
 * reads, so every shadow on the islands and the water belongs to a cloud overhead), lit from the
 * sun's side and glowing at the edges against it; high cirrus above; a few stars in the light
 * night. The heaped banks on the horizon are their own part (high-coast-cumulus.js).
 *
 * Drawn LAST among the opaque parts with the depth test on and no depth write, so it is shaded
 * only where the sky shows.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    clamp,
    dot,
    exp,
    float,
    floor,
    length,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { CLOUD_BASE, skyColour, sunGlow } from './high-coast-light.js';
import { hcHash21, hcHash22 } from './high-coast-tsl.js';

export const SKY_RADIUS = 60000;

/** A cumulus field's density at a deck point (metres), as the cloud shadows read it. */
function deckDensity(u, noise, p) {
    const a = texture(noise, p.div(14000.0)).r;
    const b = texture(noise, p.div(5200.0).add(vec2(0.37, 0.61))).g;
    const cover = a.mul(0.65).add(b.mul(0.35));
    const lo = float(1.0).sub(u.cloudCover);
    return smoothstep(lo, lo.add(0.22), cover);
}

export function createSky(u, t, tier) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(u.eye)).toVar();
        const sky = skyColour(u, dir).toVar();
        const mu = dot(dir, u.sunDir).toVar();

        // ── Stars in the light night: only the brightest show through the summer twilight ──
        If(u.stars.greaterThan(0.01).and(dir.y.greaterThan(-0.02)), () => {
            const q = dir.mul(150.0);
            const cell = floor(q);
            const h = hcHash21(cell.xy.add(cell.z.mul(17.31)));
            const jitter = vec3(hcHash22(cell.xz.add(3.7)), h).mul(0.56).add(0.22);
            const d = length(q.sub(cell.add(jitter)));
            const bright = smoothstep(0.93, 1.0, h).mul(exp(d.mul(d).mul(-40.0)));
            const height = smoothstep(0.05, 0.4, dir.y);
            sky.addAssign(vec3(0.9, 0.92, 1.0).mul(bright).mul(u.stars).mul(height)
                .mul(0.9));
        });

        // ── The cumulus deck overhead ──
        if (tier.clouds > 0) {
            If(dir.y.greaterThan(0.004), () => {
                const tDeck = float(CLOUD_BASE).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tDeck)).add(u.wind).toVar();
                const dens = deckDensity(u, t.noise, p).toVar();
                // b has 32 cells a tile: p / 6000 is ~190 m of fine erosion.
                const fine = texture(t.noise, p.div(6000.0).add(vec2(0.13, 0.71))).b;
                dens.assign(clamp(dens.mul(1.15).sub(fine.mul(0.35).mul(float(1.0).sub(dens))), 0.0, 1.0));
                // Light: how much cloud stands between this point and the sun (two taps toward it).
                const toward = normalize(u.sunDir.xz.add(vec2(1e-4, 0.0)));
                const d1 = deckDensity(u, t.noise, p.add(toward.mul(650.0)));
                const d2 = deckDensity(u, t.noise, p.add(toward.mul(1600.0)));
                const shade = clamp(d1.mul(0.55).add(d2.mul(0.45)).sub(dens.mul(0.25)), 0.0, 1.0);
                const lit = float(1.0).sub(shade.mul(0.85));
                const base = mix(u.cloudShade, u.cloudLit, lit);
                const rim = sunGlow(mu).mul(float(1.0).sub(dens).mul(dens).mul(4.0)).mul(u.glow).mul(0.9);
                const col = base.add(rim);
                // Low in the sky a flat deck draws dashes: the banks hold the horizon instead.
                const fade = exp(tDeck.div(30000.0).negate()).mul(smoothstep(0.04, 0.2, dir.y));
                sky.assign(mix(sky, col, dens.mul(fade).mul(0.96)));
            });
        }

        // ── High cirrus ──
        if (tier.clouds > 1) {
            If(dir.y.greaterThan(0.02), () => {
                const tHigh = float(8200.0).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tHigh)).add(u.wind.mul(1.8));
                const streak = texture(t.noise, vec2(p.x.div(104000.0), p.y.div(20800.0)).add(vec2(0.5, 0.2))).g;
                const wisp = texture(t.noise, vec2(p.x.div(28000.0), p.y.div(5200.0))).b;
                const c = smoothstep(0.55, 0.85, streak).mul(smoothstep(0.35, 0.75, wisp)).mul(0.5);
                const col = mix(u.cloudShade.mul(1.3), u.cloudLit, 0.75).add(u.glow.mul(sunGlow(mu)).mul(0.6));
                const fade = exp(tHigh.div(60000.0).negate());
                sky.assign(mix(sky, col, c.mul(fade)));
            });
        }
        return vec4(sky, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'HighCoastSky';
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
