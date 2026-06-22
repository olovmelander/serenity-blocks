/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter — Snow Renderer
 *
 * Renders a SnowSim tier's compute buffers as camera-facing billboard quads
 * (positions/spin read straight from storage — no CPU→GPU transfer per frame).
 * Each visible flake is a quad (not a Point) so it can be SIZED, SHAPED, TUMBLED,
 * TWINKLED and GLINTED — WebGPU Points are 1px and can't do this.
 *
 * Per-tier options drive the look:
 *   shape:     'gaussian' (soft disc) | 'star' (6-point snowflake SDF) | 'bokeh' (soft iris ring)
 *   additive:  bokeh/glint glow vs normal-blended body
 *   glint:     occasional sharp specular sparkle (moonlit ice crystals)
 *   fog:       mix toward the snow-mist tint + fade with distance (atmospheric depth)
 * Size is WORLD-SPACE — perspective attenuates it automatically (near big, far small).
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix,
    float, instanceIndex, length, positionLocal, storage, uniform, uv, vec2, vec4,
    sin, cos, pow, smoothstep, mix, clamp, atan, abs,
} from 'three/tsl';

export function createSnowRenderer(sim, opts = {}) {
    const { count } = sim;
    const positions = storage(sim.positionBuffer, 'vec4', count);
    const velocities = storage(sim.velocityBuffer, 'vec4', count);
    const spins = storage(sim.spinBuffer, 'vec4', count);

    const shape = opts.shape ?? 'gaussian';
    const geometry = new THREE.PlaneGeometry(1, 1);

    const uTime = uniform(0);
    const uColor = uniform(new THREE.Color(opts.color ?? 0xf5f8ff));
    const uMist = uniform(new THREE.Color(opts.mist ?? 0xbcd3e3));
    const uAurora = uniform(new THREE.Color(opts.aurora ?? 0x39e0a0));
    const uAuroraTint = opts.auroraTintUniform ?? uniform(0); // shared aurora-intensity float
    const uSize = uniform(opts.size ?? 6);
    const uOpacity = uniform(opts.opacity ?? 0.6);
    const uGlint = uniform(opts.glint ?? 0);
    const uFogNear = uniform(opts.fogNear ?? 1400);
    const uFogFar = uniform(opts.fogFar ?? 3000);
    const uFogStr = uniform(opts.fogStrength ?? 0);
    // Wind streak: stretch the billboard along its screen-space velocity (0 = round
    // flake; >0 = motion streak). Ramped with storm intensity for the combo blizzard.
    const uStretch = uniform(opts.stretch ?? 0);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    // ── Vertex: camera-facing billboard with per-flake tumble (rotate the quad
    // offset in the view plane so it always stays screen-facing) ──
    material.vertexNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const sdata = spins.element(instanceIndex).toVar();
        const center = pdata.xyz.toVar();
        const sizeRand = pdata.w.toVar();
        const angle = sdata.x.toVar();

        const size = uSize.mul(float(0.55).add(sizeRand.mul(0.9)));
        const c = cos(angle);
        const s = sin(angle);
        const q = positionLocal.xy.toVar();
        const rx = q.x.mul(c).sub(q.y.mul(s)).toVar();
        const ry = q.x.mul(s).add(q.y.mul(c)).toVar();

        // Wind streaks: stretch the quad along the flake's screen-space velocity so fast
        // driving snow reads as motion streaks. uStretch=0 → identity (round flake).
        const vdata = velocities.element(instanceIndex);
        const velView = cameraViewMatrix.mul(vec4(vdata.xyz, 0.0)).xy.toVar();
        const dir = velView.div(length(velView).add(0.0001)).toVar();
        const along = rx.mul(dir.x).add(ry.mul(dir.y));
        const perp = ry.mul(dir.x).sub(rx.mul(dir.y));
        const alongS = along.mul(float(1.0).add(uStretch));
        const perpS = perp.mul(float(1.0).sub(uStretch.mul(0.35)));
        const ox = alongS.mul(dir.x).sub(perpS.mul(dir.y));
        const oy = alongS.mul(dir.y).add(perpS.mul(dir.x));

        const viewParticle = cameraViewMatrix.mul(vec4(center, 1.0));
        const viewPos = viewParticle.add(vec4(ox.mul(size), oy.mul(size), 0.0, 0.0));
        return cameraProjectionMatrix.mul(viewPos);
    })();

    // ── Fragment colour + alpha ──
    const colorNode = Fn(() => {
        const pdata = positions.element(instanceIndex).toVar();
        const vdata = velocities.element(instanceIndex).toVar();
        const sdata = spins.element(instanceIndex).toVar();
        const center = pdata.xyz.toVar();
        const brightRand = vdata.w.toVar();
        const twPhase = sdata.z.toVar();
        const twFreq = sdata.w.toVar();

        const uvc = uv().sub(vec2(0.5, 0.5));
        const r = length(uvc).mul(2.0);

        // Shape mask.
        let mask;
        if (shape === 'star') {
            // 6-point snowflake SDF: arms reach further at the 6 spoke angles.
            const ang = atan(uvc.y, uvc.x);
            const spoke = pow(abs(cos(ang.mul(3.0))), float(0.5));
            const thresh = float(0.26).add(spoke.mul(0.66));
            const arms = smoothstep(thresh, thresh.mul(0.35), r);
            const core = smoothstep(0.34, 0.0, r);
            mask = clamp(arms.add(core.mul(0.7)), 0.0, 1.0);
        } else if (shape === 'bokeh') {
            // Out-of-focus iris: soft disc + a brighter rim ring.
            const body = smoothstep(1.0, 0.04, r);
            const ring = smoothstep(0.94, 0.72, r).mul(smoothstep(0.52, 0.72, r));
            mask = clamp(body.mul(0.5).add(ring.mul(0.65)), 0.0, 1.0);
        } else {
            const disc = smoothstep(1.0, 0.0, r);
            const core = smoothstep(0.4, 0.0, r);
            mask = clamp(disc.mul(0.7).add(core.mul(0.5)), 0.0, 1.0);
        }

        // Per-flake twinkle + occasional sharp moonlight glint sparkle.
        const tw = pow(sin(uTime.mul(twFreq).add(twPhase)).mul(0.5).add(0.5), float(2.0));
        const glintSpark = pow(tw, float(8.0)).mul(uGlint);
        const bright = float(0.66).add(brightRand.mul(0.45)).mul(float(0.72).add(tw.mul(0.45))).add(glintSpark);

        // Base colour + faint aurora-emerald kiss when the aurora is bright.
        const tinted = mix(uColor, uAurora, uAuroraTint.mul(0.16));
        const col = tinted.mul(bright);

        // Distance → mist harmony (far flakes dissolve into the snow-mist haze).
        const dist = length(center.sub(cameraPosition));
        const fogT = smoothstep(uFogNear, uFogFar, dist);
        const foggedCol = mix(col, uMist, fogT.mul(uFogStr));

        // Edge-fade near the wrap-box extents so the toroidal wrap seam is invisible.
        const rel = center.sub(sim.uCamPos.add(sim.uBoxOffset));
        const fx = smoothstep(sim.uBounds.x, sim.uBounds.x.mul(0.78), abs(rel.x));
        const fy = smoothstep(sim.uBounds.y, sim.uBounds.y.mul(0.78), abs(rel.y));
        const fz = smoothstep(sim.uBounds.z, sim.uBounds.z.mul(0.78), abs(rel.z));
        const edge = fx.mul(fy).mul(fz);

        const alpha = clamp(
            mask.mul(uOpacity).mul(edge).mul(float(1.0).sub(fogT.mul(uFogStr).mul(0.85))),
            0.0,
            1.0,
        );
        return vec4(foggedCol, alpha);
    })();

    material.colorNode = colorNode;

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = opts.renderOrder ?? 0;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    return {
        mesh,
        material,
        uniforms: {
            uTime, uColor, uSize, uOpacity, uGlint, uFogStr, uStretch,
        },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
