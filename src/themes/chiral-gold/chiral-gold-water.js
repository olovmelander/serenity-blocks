/**
 * Chiral Gold — the black water.
 *
 * The hall's floor is a sheet of still water over black glass. On the showcase tiers everything
 * that stands in it stands in it twice: a planar reflector() renders the hall from the mirrored
 * camera at reduced resolution with a mip chain, and the water reads it through its own slope
 * (a slow swell, the rings the towers stir, the rings gameplay drops into it), a little smeared
 * down the line of sight as moving water smears a light. Lower tiers mirror the towers' glow
 * analytically instead.
 *
 * Gameplay writes into the water: a locking piece drops a ring under the board at its own column
 * (a crisp crest with two fainter ones behind it, in the piece's colour, bending the mirror as it
 * passes); a clear sends a straight front of light out to both sides, one crest per line; the
 * four-line strike gilds the whole surface outward from the board.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    cameraPosition,
    clamp,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    reflector,
    screenUV,
    sin,
    smoothstep,
    step,
    vec2,
    vec3,
} from 'three/tsl';
import {
    HELIX,
    RIPPLE_FADE,
    RIPPLE_REACH,
    RIPPLE_SLOTS,
    RIPPLE_TAU,
    STAGE,
    cgBell,
    cgPart,
} from './chiral-gold-tsl.js';
import { hallSky } from './chiral-gold-atmosphere.js';

/** Metres a second the clear's front runs out from the board, and the gap between its crests. */
export const SURGE_SPEED = 13;
export const SURGE_GAP = 1.1;

/**
 * @param {object} u  shared hall uniforms
 * @param {object} [opts]
 * @param {number} [opts.reflectionScale=0]  reflector resolution scale (0 = analytic glow)
 * @param {number} [opts.reflectionTaps=3]   taps down the smear (1 or 3)
 */
export function createWater(u, opts = {}) {
    const reflectionScale = opts.reflectionScale ?? 0;
    const taps = opts.reflectionTaps ?? 3;
    const reflection = reflectionScale > 0
        ? reflector({ resolutionScale: reflectionScale, bounces: false, generateMipmaps: true })
        : null;
    if (reflection) {
        reflection.target.rotateX(-Math.PI / 2);
        reflection.target.name = 'ChiralGoldReflectorTarget';
    }

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'ChiralGoldWater';
    material.fog = false;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(rel).toVar();
        const V = rel.div(dist).toVar();
        const st = vec2(p.x, p.z).toVar();
        const t = u.time;

        // ── The water's slope ──
        // A slow swell: two fetches of the noise drifting against each other.
        const nA = u.noise(st.mul(0.041).add(vec2(t.mul(0.0052), t.mul(0.0037)))).toVar();
        const nB = u.noise(st.mul(0.163).sub(vec2(t.mul(0.0093), t.mul(-0.0061)))).toVar();
        const swell = u.audio.x.mul(0.5).add(0.55);
        const slope = nA.rg.sub(0.5).mul(0.13).add(nB.gb.sub(0.5).mul(0.03)).mul(swell)
            .toVar();

        // The towers stir it: slow rings leaving each foot.
        const light = vec3(0.0).toVar();
        for (let side = -1; side <= 1; side += 2) {
            const o = st.sub(vec2(u.helixX.mul(side), 0.0));
            const d = length(o);
            const flare = side < 0 ? u.flare.x : u.flare.y;
            const stir = sin(d.mul(5.2).sub(t.mul(1.9))).mul(exp(d.mul(-0.5))).mul(0.045);
            slope.addAssign(o.div(max(d, 1e-3)).mul(stir));
            // The core's light lying on the water round the foot.
            const pool = exp(d.mul(d).mul(-0.3)).mul(u.heat.mul(0.4).add(0.045).add(flare.mul(0.25)));
            light.addAssign(u.glow.mul(pool).mul(0.5));
        }

        // Rings dropped by the board.
        for (let i = 0; i < RIPPLE_SLOTS; i++) {
            const A = u.rippleA[i];
            const age = t.sub(A.z);
            const radius = float(RIPPLE_REACH).mul(float(1.0).sub(exp(age.div(-RIPPLE_TAU))));
            const o = st.sub(A.xy);
            const d = length(o);
            const x = d.sub(radius);
            const env = exp(age.mul(-RIPPLE_FADE)).mul(step(0.0, age)).mul(A.w);
            const wave = sin(x.mul(5.6)).mul(exp(x.mul(x).mul(-0.42))).mul(env);
            slope.addAssign(o.div(max(d, 1e-3)).mul(wave).mul(0.1));
            const crest = cgBell(x.div(0.2))
                .add(cgBell(x.add(1.12).div(0.28)).mul(0.42))
                .add(cgBell(x.add(2.24).div(0.34)).mul(0.18));
            light.addAssign(u.rippleC[i].mul(crest.mul(env)).mul(1.15));
        }

        // The clear's surge: straight fronts running out to both sides, one crest per line.
        const sAge = t.sub(u.surge.x);
        const sEnv = exp(sAge.mul(-1.25)).mul(step(0.0, sAge)).mul(u.surge.y);
        const sx = abs(p.x).sub(sAge.mul(SURGE_SPEED));
        const surgeCrest = float(0.0).toVar();
        const surgeWave = float(0.0).toVar();
        for (let k = 0; k < 4; k++) {
            const on = step(k + 0.5, u.surge.z);
            const xk = sx.add(k * SURGE_GAP);
            surgeCrest.addAssign(cgBell(xk.div(0.8)).mul(on));
            surgeWave.addAssign(sin(xk.mul(4.4)).mul(exp(xk.mul(xk).mul(-0.9))).mul(on));
        }
        const along = exp(p.z.sub(3.0).mul(p.z.sub(3.0)).mul(-0.012));
        slope.x.addAssign(surgeWave.mul(sEnv).mul(along).mul(0.2).mul(p.x.sign()));
        const shimmer = nB.r.mul(0.9).add(0.35);
        light.addAssign(mix(u.glow, vec3(1.0, 0.9, 0.72), 0.3).mul(surgeCrest.mul(sEnv).mul(along)).mul(shimmer).mul(0.45));

        // The four-line strike gilds the water outward from the board's foot.
        const aAge = t.sub(u.aurum.x);
        const aLive = step(0.0, aAge).mul(u.aurum.y);
        const fromBoard = length(st.sub(vec2(0.0, STAGE.boardZ)));
        const gilt = smoothstep(0.0, 9.0, aAge.mul(20.0).sub(fromBoard)).mul(exp(aAge.mul(-0.55))).mul(aLive);
        const nC = u.noise(st.mul(0.71).add(vec2(t.mul(0.031), t.mul(-0.022))));
        const sparkle = pow(nC.r, 6.0).mul(9.0).add(pow(nB.r, 4.0).mul(1.2));
        light.addAssign(u.glow.mul(gilt).mul(sparkle.add(0.03)).mul(0.12));

        // ── The mirror ──
        const cosT = clamp(V.y.negate(), 0.0, 1.0);
        // Water over black glass: more of a mirror than open water is.
        const fres = float(0.26).add(float(0.74).mul(pow(float(1.0).sub(cosT), 3.0)));
        const mirror = vec3(0.0).toVar();
        const rough = length(slope).toVar();
        if (reflection) {
            // Far water is seen edge-on: its slope shifts the mirror less on screen.
            const reach = float(1.0).div(dist.mul(0.07).add(1.0));
            const ruv = screenUV.flipX().add(vec2(slope.x, slope.y.mul(1.7)).mul(reach).mul(0.16)).toVar();
            const lod = rough.mul(11.0).add(0.45);
            if (taps >= 3) {
                // Moving water drags a light down the line of sight.
                const run = rough.mul(0.09).add(0.002);
                const jitter = nB.a.sub(0.5).mul(run).mul(0.7);
                const tap = (o) => reflection.sample(ruv.add(vec2(0.0, run.mul(o).add(jitter)))).level(lod).rgb;
                mirror.assign(tap(0).mul(0.46).add(tap(1.5).add(tap(-1.5)).mul(0.27)));
            } else {
                mirror.assign(reflection.sample(ruv).level(lod).rgb);
            }
        } else {
            // No second render: follow the mirrored ray to the plane the towers stand in and return
            // their glow there, and the hall's own dark beyond.
            const R = normalize(vec3(V.x.add(slope.x.mul(0.5)), V.y.negate(), V.z.add(slope.y.mul(0.5)))).toVar();
            const reachT = p.z.div(max(R.z.negate(), 1e-3));
            const hx = p.x.add(R.x.mul(reachT));
            const hy = R.y.mul(reachT);
            const ahead = step(0.0, p.z);
            const span = float(HELIX.radius * 1.1).mul(u.helixScale);
            const column = (side, flare) => {
                const dx = hx.sub(u.helixX.mul(side)).div(span);
                const body = exp(dx.mul(dx).mul(-1.4)).mul(step(0.0, hy)).mul(float(1.0).sub(smoothstep(7.0, 13.0, hy)));
                // The braid, read as the column's light swelling and thinning with height.
                const bands = sin(hy.mul(2.1).sub(t.mul(0.22)).add(side * 0.8)).mul(0.5).add(0.5);
                return body.mul(bands.mul(0.55).add(0.3)).mul(u.heat.mul(1.0).add(0.55).add(flare.mul(0.8)));
            };
            const towers = column(-1, u.flare.x).add(column(1, u.flare.y));
            // And on to the plane the great ring stands in.
            const ringT = p.z.sub(STAGE.ring.z).div(max(R.z.negate(), 1e-3));
            const rx = p.x.add(R.x.mul(ringT));
            const ry = R.y.mul(ringT).sub(STAGE.ring.y);
            const ringScale = clamp(u.helixX.div(6.8), 0.35, 1.15);
            const off = length(vec2(rx, ry)).sub(ringScale.mul(STAGE.ring.radius));
            const hoop = exp(off.mul(off).mul(-5.0)).mul(step(-STAGE.ring.y, ry));
            mirror.assign(u.alloyA.mul(towers.mul(0.55).add(hoop.mul(0.22))).mul(ahead).mul(u.emit).add(hallSky(u, R)));
        }

        const body = vec3(0.0016, 0.0012, 0.0009);
        const col = body.mul(float(1.0).sub(fres)).add(mirror.mul(fres)).add(light.mul(u.emit)).toVar();
        // The far water goes into the dark the hall ends in.
        const far = smoothstep(55.0, 190.0, dist);
        return mix(col, hallSky(u, vec3(V.x, 0.0, V.z).normalize()), far);
    })();

    const geometry = new THREE.PlaneGeometry(560, 420, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -170);
    const part = cgPart('ChiralGoldWater', geometry, material, -10, false);
    part.mesh.matrixAutoUpdate = false;
    part.reflection = reflection;
    part.reflectorTarget = reflection ? reflection.target : null;
    return part;
}
