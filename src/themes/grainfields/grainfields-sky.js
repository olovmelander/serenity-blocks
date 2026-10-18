/**
 * Grainfields — the sky dome and the storm deck seen from below.
 *
 * Where a view ray meets the deck's base it reads the same cover the land's shadows and the
 * light shafts read (grainfields-tsl deckCover), so every gap overhead is a gap the sun comes
 * through onto the fields. The deck's underside is dark slate, its billows lit from the bright
 * band low on the horizon (the light coming in under the storm's far edge) and from the fields'
 * gold below; the cloud thins and glows silver round the gaps on the sun's side, and the walls
 * of a gap that face the sun are lit. Through the gaps: clean blue sky, high thin cirrus, the sun.
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
import { DECK } from './grainfields-core.js';
import { skyColour, sunGlow } from './grainfields-light.js';
import {
    deckCover, deckPoint, gfCells, gfHash21, gfHash22,
} from './grainfields-tsl.js';

export const SKY_RADIUS = 80000;

export function createSky(u, t, tier) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(u.eye)).toVar();
        const sky = skyColour(u, dir).toVar();
        const mu = dot(dir, u.sunDir).toVar();

        // ── Stars in the twilight, through the gaps ──
        If(u.stars.greaterThan(0.01).and(dir.y.greaterThan(-0.02)), () => {
            const q = dir.mul(150.0);
            const cell = floor(q);
            const h = gfHash21(cell.xy.add(cell.z.mul(17.31)));
            const jitter = vec3(gfHash22(cell.xz.add(3.7)), h).mul(0.56).add(0.22);
            const d = length(q.sub(cell.add(jitter)));
            const bright = smoothstep(0.93, 1.0, h).mul(exp(d.mul(d).mul(-40.0)));
            sky.addAssign(vec3(0.9, 0.92, 1.0).mul(bright).mul(u.stars).mul(smoothstep(0.05, 0.4, dir.y))
                .mul(0.9));
        });

        // ── High cirrus through the gaps ──
        if (tier.clouds > 1) {
            If(dir.y.greaterThan(0.02), () => {
                const tHigh = float(9000.0).sub(u.eye.y).div(dir.y);
                const p = u.eye.xz.add(dir.xz.mul(tHigh)).add(u.drift.mul(1.7));
                const streak = texture(t.noise, vec2(p.x.div(120000.0), p.y.div(24000.0)).add(vec2(0.5, 0.2))).g;
                const wisp = texture(t.noise, vec2(p.x.div(32000.0), p.y.div(6000.0))).b;
                const c = smoothstep(0.55, 0.85, streak).mul(smoothstep(0.35, 0.75, wisp)).mul(0.45);
                const col = mix(u.cloudShade.mul(2.5).add(u.fill), u.cloudLit, 0.7).add(u.glow.mul(sunGlow(mu)).mul(0.5));
                sky.assign(mix(sky, col, c.mul(exp(tHigh.div(70000.0).negate()))));
            });
        }

        // ── The storm deck overhead ──
        If(dir.y.greaterThan(0.0025), () => {
            const tDeck = float(DECK.base).sub(u.eye.y).div(dir.y).toVar();
            const p = u.eye.xz.add(dir.xz.mul(tDeck)).toVar();
            const dens = deckCover(u, t.noise, p).toVar();
            // The underside's billows: cells with thick round hearts that hang low and thin seams
            // between them, a finer lumpiness over them; their relief fades where they shrink under a
            // pixel toward the horizon.
            const q = deckPoint(u, t.noise, p).toVar();
            const reliefAt = (qq) => {
                const big = gfCells(qq.div(1150.0)).x;
                const small = gfCells(qq.div(430.0).add(vec2(5.3, 1.7))).x;
                const roundBig = float(1.0).sub(smoothstep(0.05, 0.85, big));
                const roundSmall = float(1.0).sub(smoothstep(0.05, 0.8, small));
                return roundBig.mul(0.58).add(roundSmall.mul(0.27)).add(texture(t.noise, qq.div(4200.0)).a.mul(0.15));
            };
            const sharp = exp(tDeck.div(-24000.0)).toVar();
            const r0 = reliefAt(q).toVar();
            const lump = mix(float(0.5), r0, sharp).toVar();
            // The billows hang down by up to HANG metres: their faces turn toward the light.
            const HANG = 420.0;
            const STEP = 110.0;
            const gx = reliefAt(q.add(vec2(STEP, 0.0))).sub(r0).mul(HANG / STEP).mul(sharp);
            const gz = reliefAt(q.add(vec2(0.0, STEP))).sub(r0).mul(HANG / STEP).mul(sharp);
            const Nb = normalize(vec3(gx.negate(), -1.0, gz.negate()));
            // Light under the deck comes in from its far edge on the sun's side (the bright band low
            // on the horizon) and up from the gold fields; the hearts are thick and dark.
            const Lband = normalize(vec3(u.sunDir.x, -0.3, u.sunDir.z));
            const faces = clamp(dot(Nb, Lband), 0.0, 1.0);
            const under = u.cloudShade.mul(mix(float(0.95), float(0.34), lump))
                .add(u.horizon.mul(faces.mul(faces).mul(0.16)).mul(float(1.0).sub(lump.mul(0.5))))
                .add(u.bounce.mul(clamp(Nb.y.negate(), 0.0, 1.0).mul(0.14)))
                .toVar();
            // Thin cloud passes light: the deck brightens where it thins toward a gap, and on the sun's
            // side it glows silver (forward scattering through the thinning edge).
            const thin = float(1.0).sub(dens).mul(smoothstep(0.02, 0.4, dens));
            under.addAssign(u.cloudLit.mul(thin).mul(0.16));
            // A gap's torn edge is thin cloud lit through: a silver lining brighter than the sky
            // behind it toward the sun, a pale rim away from it.
            const rimBand = smoothstep(0.03, 0.3, dens).mul(float(1.0).sub(smoothstep(0.45, 0.95, dens)));
            // A tight lobe round the sun (the glare through thin cloud), a broad faint one.
            const m = clamp(mu, 0.0, 1.0);
            const m2 = m.mul(m);
            const m4 = m2.mul(m2);
            const m8 = m4.mul(m4);
            const forward = m8.mul(m8).mul(m8).mul(3.2).add(m4.mul(0.5));
            under.addAssign(u.cloudLit.mul(thin).mul(forward).mul(u.sunUp).mul(1.1));
            under.addAssign(u.cloudLit.mul(rimBand).mul(forward.mul(1.6).add(0.12)).mul(u.sunUp).mul(lump.oneMinus().mul(0.6).add(0.4)));
            // A torn edge is thin cloud lit through: never darker than the sky behind it, so a gap
            // reads as a tear with a bright frayed rim, not a cut-out with a grey ring round it.
            // In a broken sky (the morning, the golden hour) the cloud's edges are its sunlit sides:
            // white, never the sky's blue.
            const broken = float(1.0).sub(u.cover).max(0.0);
            const edgeLit = max(sky.mul(1.06).add(u.cloudLit.mul(0.04).mul(u.sunUp)), u.cloudLit.mul(u.sunUp).mul(broken).mul(0.85));
            under.assign(mix(under, edgeLit, rimBand.mul(0.85)));
            // ...and a broken sky's clouds are lit through: their bodies pale toward the sun's side.
            const sunward = clamp(mu.mul(0.5).add(0.5), 0.0, 1.0);
            under.addAssign(u.cloudLit.mul(u.sunUp).mul(broken.mul(broken)).mul(lump.oneMinus().mul(0.5).add(0.5))
                .mul(sunward.mul(0.35).add(0.12)));
            // A gap's walls: where the cloud thins toward the sun, its sunlit side faces the eye.
            if (tier.clouds > 0) {
                const toward = normalize(u.sunDir.xz.add(vec2(1e-4, 0.0)));
                const ahead = deckCover(u, t.noise, p.add(toward.mul(tDeck.mul(0.02).add(260.0))));
                const wall = clamp(dens.sub(ahead).mul(3.0), 0.0, 1.0).mul(dens);
                under.addAssign(u.cloudLit.mul(wall).mul(u.sunUp).mul(0.42).mul(sunGlow(mu).mul(2.0).add(0.35)));
            }
            // Far away the deck takes the haze's colour (the air between).
            const hazeFar = float(1.0).sub(exp(tDeck.div(26000.0).negate()));
            under.assign(mix(under, u.haze.mul(0.85).add(u.horizon.mul(0.22)), hazeFar.mul(0.7)));
            // Very low the deck thins out over the horizon band (no dashes at a grazing view).
            const keep = dens.mul(smoothstep(0.0025, 0.03, dir.y));
            sky.assign(mix(sky, under, clamp(keep, 0.0, 1.0)));
        });
        return vec4(sky, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsSky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
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
