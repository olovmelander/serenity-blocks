/**
 * Painted Ages — the sky dome.
 *
 * The hour's sky (painted-ages-light skyColour: zenith, the horizon band, the aureole and disc),
 * a deck of cumulus at the height the land's cloud shadows come from (the same two noise reads,
 * so every shadow on the badlands belongs to a cloud overhead), lit from the sun's side and
 * glowing at the edges against it; high cirrus above; stars in the blue hour.
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
    fract,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { CLOUD_BASE, skyColour, sunGlow } from './painted-ages-light.js';
import { paHash21, paHash22 } from './painted-ages-tsl.js';
import { rainbow, showerVeil } from './painted-ages-events.js';

export const SKY_RADIUS = 52000;
/** The cirrus deck's height (metres) and the direction its strands stream (away, a little right). */
const CIRRUS_BASE = 8200;
const CIRRUS_AXIS = Object.freeze([0.42 / Math.hypot(0.42, 0.91), -0.91 / Math.hypot(0.42, 0.91)]);

/** A cumulus field's density at a deck point (metres), as the land's cloud shadow reads it. */
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
    material.name = 'PaintedAgesSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(u.eye)).toVar();
        const sky = skyColour(u, dir).toVar();
        const mu = dot(dir, u.sunDir).toVar();

        // ── Stars (the blue hour): a lattice on the sphere, one star a cell ──
        If(u.stars.greaterThan(0.01).and(dir.y.greaterThan(-0.02)), () => {
            const q = dir.mul(150.0);
            const cell = floor(q);
            const h = paHash21(cell.xy.add(cell.z.mul(17.31)));
            const jitter = vec3(paHash22(cell.xz.add(3.7)), h).mul(0.56).add(0.22);
            const d = length(q.sub(cell.add(jitter)));
            const bright = smoothstep(0.86, 1.0, h).mul(exp(d.mul(d).mul(-40.0)));
            const height = smoothstep(0.02, 0.25, dir.y);
            sky.addAssign(vec3(0.9, 0.92, 1.0).mul(bright).mul(u.stars).mul(height)
                .mul(0.9));
        });

        // ── The cumulus deck overhead (the banks on the horizon are their own part) ──
        if (tier.clouds > 0) {
            If(dir.y.greaterThan(0.004), () => {
                const tDeck = float(CLOUD_BASE).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tDeck)).add(u.wind).toVar();
                const dens = deckDensity(u, t.noise, p).toVar();
                // Edges: fine erosion of the billows.
                const fine = texture(t.noise, p.div(1400.0).add(vec2(0.13, 0.71))).b;
                dens.assign(clamp(dens.mul(1.15).sub(fine.mul(0.35).mul(float(1.0).sub(dens))), 0.0, 1.0));
                // Light: how much cloud stands between this point and the sun (two taps toward it).
                const toward = normalize(u.sunDir.xz.add(vec2(1e-4, 0.0)));
                const d1 = deckDensity(u, t.noise, p.add(toward.mul(700.0)));
                const d2 = deckDensity(u, t.noise, p.add(toward.mul(1800.0)));
                const shade = clamp(d1.mul(0.55).add(d2.mul(0.45)).sub(dens.mul(0.25)), 0.0, 1.0);
                const lit = float(1.0).sub(shade.mul(0.85));
                // The underside takes the ground's warm light at a low sun.
                const base = mix(u.cloudShade, u.cloudLit, lit);
                // Silver lining: thin cloud against the sun glows.
                const rim = sunGlow(mu).mul(float(1.0).sub(dens).mul(dens).mul(4.0)).mul(u.glow).mul(0.9);
                // The record's colours on a perfect clear (paint): bands across the deck.
                const col = base.add(rim).toVar();
                If(u.paint.greaterThan(0.01), () => {
                    const band = fract(p.x.mul(0.00031).add(p.y.mul(0.00017)));
                    const hue = vec3(
                        smoothstep(0.0, 0.33, band).mul(float(1.0).sub(smoothstep(0.5, 0.83, band))),
                        smoothstep(0.17, 0.5, band).mul(float(1.0).sub(smoothstep(0.67, 1.0, band))),
                        smoothstep(0.5, 0.83, band).add(float(1.0).sub(smoothstep(0.0, 0.33, band))).clamp(0.0, 1.0),
                    );
                    col.assign(mix(col, col.mul(hue.mul(1.6).add(0.25)), u.paint.mul(0.8)));
                });
                // Far cloud melts into the horizon's air.
                // Low in the sky a flat deck draws dashes: the banks hold the horizon instead.
                // (it comes down toward the horizon only as a storm closes the sky).
                const low = mix(float(0.13), float(0.035), smoothstep(0.38, 0.7, u.cloudCover));
                const fade = exp(tDeck.div(38000.0).negate()).mul(smoothstep(low, low.add(0.14), dir.y));
                sky.assign(mix(sky, col, dens.mul(fade).mul(0.96)));
            });
        }

        // ── High cirrus ──
        // Everything the frame shows of the sky is ten or fifteen degrees up, so the cirrus deck
        // is seen at a graze thirty to fifty kilometres off and squashed six to one: its strands
        // are drawn kilometres long and hundreds of metres across, streaming away from the eye a
        // little off its axis so they converge toward the horizon. Patches of them, not a veil.
        if (tier.clouds > 1) {
            If(dir.y.greaterThan(0.02), () => {
                const tHigh = float(CIRRUS_BASE).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tHigh)).add(u.wind.mul(1.8)).toVar();
                // Along and across the strands.
                const along = dot(p, vec2(CIRRUS_AXIS[0], CIRRUS_AXIS[1]));
                const across = dot(p, vec2(-CIRRUS_AXIS[1], CIRRUS_AXIS[0]));
                // Where there are strands at all: broad patches.
                const patchAt = vec2(along.div(70000.0), across.div(26000.0)).add(vec2(0.31, 0.77));
                const where = smoothstep(0.5, 0.72, texture(t.noise, patchAt).r);
                // The strands drift a little across their run (a straight comb reads as ruled lines).
                const bendAt = vec2(along.div(90000.0), across.div(60000.0)).add(vec2(0.6, 0.1));
                const cw = across.add(texture(t.noise, bendAt).g.sub(0.5).mul(1600.0));
                // Two sets of fibres (lattice periods 32 and 64 across the tile), the finer riding
                // on the coarser.
                const fib1 = texture(t.noise, vec2(along.div(32.0 * 18000.0), cw.div(32.0 * 950.0))).b;
                const fib2 = texture(t.noise, vec2(along.div(64.0 * 9000.0), cw.div(64.0 * 260.0)).add(0.43)).a;
                const coarse = smoothstep(0.52, 0.8, fib1);
                const strands = coarse.mul(0.7).add(smoothstep(0.6, 0.9, fib2).mul(coarse.mul(0.7).add(0.1)).mul(0.35));
                const c = where.mul(strands).mul(0.32);
                // Lit through: brightest toward the sun, the hour's cloud light elsewhere.
                const body = mix(u.cloudShade.mul(1.4).add(u.fill.mul(0.4)), u.cloudLit, 0.7);
                const col = body.add(u.glow.mul(sunGlow(mu)).mul(0.8));
                const fade = exp(tHigh.div(80000.0).negate()).mul(smoothstep(0.03, 0.1, dir.y));
                sky.assign(mix(sky, col, c.mul(fade)));
            });
        }
        // The chain's shower: grey veils of rain under the clouds toward the horizon.
        sky.assign(mix(sky, u.cloudShade.mul(1.4).add(u.haze.mul(0.3)), showerVeil(u, dir).mul(0.55)));
        // The bow over the valley.
        sky.addAssign(rainbow(u, dir));
        return vec4(sky, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PaintedAgesSky';
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

export { max };
