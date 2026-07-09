/**
 * Fluid Dreams Theme - TSL Node Materials (WebGPU path)
 *
 * Hero raymarched iridescent fluid surface + atmosphere + particles.
 * Inspired by the Codrops TSL liquid raymarching scaffold and the
 * PhishChiang thin-film iridescence trick, ported to TSL.
 */

import {
    AdditiveBlending,
    BackSide,
    DoubleSide,
    MeshBasicNodeMaterial,
    NormalBlending,
    PointsNodeMaterial,
    Vector3,
    Vector4,
} from 'three/webgpu';

import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    fract,
    Fn,
    If,
    instanceIndex,
    length,
    max,
    min,
    mix,
    mx_noise_float,
    normalize,
    positionWorld,
    pow,
    smoothstep,
    sqrt,
    step,
    storage,
    uniform,
    uv,
    vec3,
    vec4,
} from 'three/tsl';

// ─────────────────────────────────────────────────────────────────────────────
// Electric palette — vibrant hero (5 stops)
// ─────────────────────────────────────────────────────────────────────────────

export const ELECTRIC_PALETTE = {
    deepAmethyst: new Vector3(0.102, 0.020, 0.196), // #1A0532
    neonPink: new Vector3(1.000, 0.176, 0.584), // #FF2D95
    electricViolet: new Vector3(0.694, 0.298, 1.000), // #B14CFF
    electricCyan: new Vector3(0.000, 0.898, 1.000), // #00E5FF
    warmGold: new Vector3(1.000, 0.851, 0.239), // #FFD93D
};

// Tetromino tints pulled from the same palette so the whole scene reads
// as one material language.
export const ELECTRIC_TETROMINO_TINTS = {
    I: '#00E5FF', // electric cyan
    O: '#FFD93D', // warm gold (accent)
    T: '#FF2D95', // neon pink
    S: '#6FE7E0', // soft cyan-mint
    Z: '#FF6FB5', // pink rim
    J: '#B14CFF', // electric violet
    L: '#FFA84C', // gold-orange
    GARBAGE: '#1A0532', // deep amethyst
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared TSL helpers
// ─────────────────────────────────────────────────────────────────────────────

// Polynomial smooth-min (IQ): blends two SDFs smoothly with knob k.
const sminPoly = Fn(([a, b, k]) => {
    const h = clamp(float(0.5).add(b.sub(a).mul(0.5).div(k)), float(0.0), float(1.0));
    return mix(b, a, h).sub(k.mul(h).mul(float(1.0).sub(h)));
});

// Sample the 5-stop electric palette by t in [0,1) — smooth, wraps.
const samplePaletteRamp = Fn(([t, c0, c1, c2, c3, c4]) => {
    const tw = fract(t);
    const m01 = mix(c0, c1, smoothstep(float(0.0), float(0.25), tw));
    const m12 = mix(m01, c2, smoothstep(float(0.25), float(0.5), tw));
    const m23 = mix(m12, c3, smoothstep(float(0.5), float(0.75), tw));
    const m34 = mix(m23, c4, smoothstep(float(0.75), float(1.0), tw));
    return m34;
});

// 3D curl from three offset noise samples — cheap, divergence-free-ish.
const curlNoise3 = Fn(([p]) => {
    const e = float(0.1);
    const dx = vec3(e, float(0.0), float(0.0));
    const dy = vec3(float(0.0), e, float(0.0));
    const dz = vec3(float(0.0), float(0.0), e);

    const x0 = mx_noise_float(p.sub(dx));
    const x1 = mx_noise_float(p.add(dx));
    const y0 = mx_noise_float(p.sub(dy));
    const y1 = mx_noise_float(p.add(dy));
    const z0 = mx_noise_float(p.sub(dz));
    const z1 = mx_noise_float(p.add(dz));

    return vec3(
        y1.sub(y0).sub(z1.sub(z0)),
        z1.sub(z0).sub(x1.sub(x0)),
        x1.sub(x0).sub(y1.sub(y0)),
    ).div(e.mul(2.0));
});

// ─────────────────────────────────────────────────────────────────────────────
// HERO: Raymarched iridescent fluid surface
// ─────────────────────────────────────────────────────────────────────────────

export function createFluidHeroNodeMaterial(options = {}) {
    const marchSteps = Math.max(24, Math.min(160, Math.floor(options.marchSteps ?? 72)));
    const metaballCount = Math.max(3, Math.min(8, Math.floor(options.metaballCount ?? 7)));
    const maxDist = float(options.maxDist ?? 70.0);
    const epsilon = float(options.epsilon ?? 0.001);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: BackSide,
        blending: NormalBlending,
    });

    const uTime = uniform(0);
    const uIridescenceShift = uniform(0);
    const uShockwaveOrigin = uniform(new Vector3(0, 0, 0));
    const uShockwaveRadius = uniform(0);
    const uShockwaveStrength = uniform(0);
    const uPaletteC0 = uniform(ELECTRIC_PALETTE.neonPink);
    const uPaletteC1 = uniform(ELECTRIC_PALETTE.electricViolet);
    const uPaletteC2 = uniform(ELECTRIC_PALETTE.electricCyan);
    const uPaletteC3 = uniform(ELECTRIC_PALETTE.electricViolet);
    const uPaletteC4 = uniform(ELECTRIC_PALETTE.warmGold);
    const uAmbient = uniform(ELECTRIC_PALETTE.deepAmethyst);
    const uIntensity = uniform(options.intensity ?? 1.0);
    const uSmoothK = uniform(options.smoothK ?? 0.9);
    // Gameplay-reactive uniforms.
    // uHeroPulse: 0 = base, >0 grows metaball radii (breath on piece lock / line clear).
    // uHeroPaletteInvert: 0 = base palette, 1 = shifted half-cycle (tetris signature flash).
    // uHeroAmbientGlow: 0..N, additive emissive multiplier driven by combo hum.
    const uHeroPulse = uniform(0);
    const uHeroPaletteInvert = uniform(0);
    const uHeroAmbientGlow = uniform(0);

    // Per-metaball uniforms (xyz = position, w = radius).
    const metaballUniforms = [];
    for (let i = 0; i < metaballCount; i += 1) {
        metaballUniforms.push(uniform(new Vector4(0, 0, 0, 4.0)));
    }

    // Scene SDF — smooth union of metaballs + shockwave ring deformation.
    // Each metaball radius is scaled by (1 + uHeroPulse * 0.18) so piece locks
    // and line clears drive a brief "breath" through the surface.
    const sceneSDF = Fn(([p]) => {
        let d = float(maxDist).toVar();
        const k = uSmoothK;
        const pulseScale = float(1.0).add(uHeroPulse.mul(0.18));
        for (let i = 0; i < metaballCount; i += 1) {
            const center = metaballUniforms[i].xyz;
            const radius = metaballUniforms[i].w.mul(pulseScale);
            const dist = length(p.sub(center)).sub(radius);
            d.assign(sminPoly(d, dist, k));
        }
        // Shockwave: subtract a thin radial bulge centred on uShockwaveOrigin.
        const shockDist = length(p.sub(uShockwaveOrigin));
        const ringWidth = float(2.5);
        const ring = smoothstep(ringWidth, float(0.0), abs(shockDist.sub(uShockwaveRadius)));
        d.assign(d.sub(ring.mul(uShockwaveStrength)));
        return d;
    });

    // Tetrahedral normal sampling — 4 SDF evals (vs 6 for axis-aligned diffs).
    const sceneNormal = Fn(([p]) => {
        const e = epsilon.mul(5.0);
        const k1 = vec3(float(1.0), float(-1.0), float(-1.0));
        const k2 = vec3(float(-1.0), float(-1.0), float(1.0));
        const k3 = vec3(float(-1.0), float(1.0), float(-1.0));
        const k4 = vec3(float(1.0), float(1.0), float(1.0));
        const n = k1.mul(sceneSDF(p.add(k1.mul(e))))
            .add(k2.mul(sceneSDF(p.add(k2.mul(e)))))
            .add(k3.mul(sceneSDF(p.add(k3.mul(e)))))
            .add(k4.mul(sceneSDF(p.add(k4.mul(e)))));
        return normalize(n);
    });

    // Thin-film iridescence — single noise sample (vs 6 for curl-noise).
    // Palette index is shifted by uHeroPaletteInvert*0.5 — a half-cycle rotation
    // through the 5 stops, used for the Tetris signature flash.
    // uHeroAmbientGlow adds a low-frequency emissive lift driven by combo hum.
    const thinFilmColor = Fn(([nrm, view, hitPos]) => {
        const ndotv = clamp(dot(nrm, view), float(0.0), float(1.0));
        const fresnel = pow(float(1.0).sub(ndotv), float(5.0));
        const noiseCoord = hitPos.mul(0.18).add(vec3(float(0.0), uTime.mul(0.05), float(0.0)));
        const noise = mx_noise_float(noiseCoord);
        const t = fresnel.mul(3.0).add(noise.mul(0.5))
            .add(uTime.mul(0.04))
            .add(uIridescenceShift)
            .add(uHeroPaletteInvert.mul(0.5));
        const base = samplePaletteRamp(t, uPaletteC0, uPaletteC1, uPaletteC2, uPaletteC3, uPaletteC4);
        const rim = pow(float(1.0).sub(ndotv), float(2.0)).mul(0.4);
        const body = base.mul(float(0.6).add(fresnel.mul(0.7)));
        const ambient = uAmbient.mul(0.18);
        const rimPop = uPaletteC2.mul(rim);
        const comboGlow = base.mul(uHeroAmbientGlow.mul(0.25));
        return body.add(ambient).add(rimPop).add(comboGlow);
    });

    // Raymarch with bounding-sphere early-out.
    // Rays that miss the metaball bounding sphere skip the whole loop body.
    // Rays that hit are clamped to the [tNear, tFar] interval so we don't waste
    // steps marching empty space outside the volume.
    const boundsRadius = float(options.boundsRadius ?? 18.0);

    const raymarchHero = Fn(() => {
        const ro = cameraPosition.toVar();
        const rd = normalize(positionWorld.sub(cameraPosition)).toVar();

        // Ray vs bounding sphere centred at origin.
        const b = dot(ro, rd);
        const cTerm = dot(ro, ro).sub(boundsRadius.mul(boundsRadius));
        const disc = b.mul(b).sub(cTerm);
        const missed = step(disc, float(0.0));
        const sqrtDisc = sqrt(max(float(0.0001), disc));
        const tNear = b.negate().sub(sqrtDisc);
        const tFar = b.negate().add(sqrtDisc);
        const tStart = max(float(0.05), tNear);
        const tEnd = max(tStart.add(float(0.5)), tFar);

        const t = tStart.toVar();
        // `done` short-circuits the loop body: set to 1 on hit, on bounds exit, or if ray missed.
        const done = missed.toVar();
        const realHit = float(0.0).toVar();
        const hitPos = vec3(0.0, 0.0, 0.0).toVar();

        for (let i = 0; i < marchSteps; i += 1) {
            If(done.equal(float(0.0)), () => {
                const p = ro.add(rd.mul(t));
                const d = sceneSDF(p);
                If(d.lessThan(epsilon), () => {
                    done.assign(1.0);
                    realHit.assign(1.0);
                    hitPos.assign(p);
                });
                t.addAssign(max(d.mul(0.85), float(0.05)));
                If(t.greaterThan(tEnd), () => {
                    done.assign(1.0);
                });
            });
        }

        const nrm = sceneNormal(hitPos);
        const view = normalize(cameraPosition.sub(hitPos));
        const colour = thinFilmColor(nrm, view, hitPos).mul(uIntensity);
        const distFade = float(1.0).sub(smoothstep(float(40.0), float(70.0), t));
        const alpha = realHit.mul(distFade);
        return vec4(colour, alpha);
    });

    const result = raymarchHero();
    const finalColor = vec3(result.x, result.y, result.z);
    const finalAlpha = result.w;

    material.colorNode = finalColor;
    material.opacityNode = finalAlpha;
    material.emissiveNode = finalColor.mul(finalAlpha); // drives MRT bloom

    material.userData = {
        uTime,
        uIridescenceShift,
        uShockwaveOrigin,
        uShockwaveRadius,
        uShockwaveStrength,
        uIntensity,
        uSmoothK,
        uPaletteC0,
        uPaletteC1,
        uPaletteC2,
        uPaletteC3,
        uPaletteC4,
        uHeroPulse,
        uHeroPaletteInvert,
        uHeroAmbientGlow,
        metaballs: metaballUniforms,
        marchSteps,
        metaballCount,
    };

    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Background — vibrant amethyst → violet vertical gradient (cheap inverted sphere)
// ─────────────────────────────────────────────────────────────────────────────

export function createBackgroundNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        side: BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
    });

    const uTime = uniform(0);
    const uColorTop = uniform(new Vector3(0.071, 0.024, 0.224)); // deep amethyst
    const uColorMid = uniform(new Vector3(0.180, 0.063, 0.345)); // mid violet
    const uColorBottom = uniform(new Vector3(0.412, 0.165, 0.620)); // bright violet base
    const uPulse = uniform(0);

    const uvCoord = uv();
    const verticalT = clamp(uvCoord.y, float(0.0), float(1.0));

    // Two-stop vertical gradient.
    const lower = mix(uColorBottom, uColorMid, smoothstep(float(0.0), float(0.55), verticalT));
    const upper = mix(lower, uColorTop, smoothstep(float(0.55), float(1.0), verticalT));

    // Slow shimmer streaks via low-frequency noise.
    const shimmerCoord = vec3(uvCoord.x.mul(2.0), uvCoord.y.mul(2.0), uTime.mul(0.05));
    const shimmer = mx_noise_float(shimmerCoord).mul(0.06);
    const colour = upper.add(shimmer).add(uPulse.mul(0.04));

    // Emissive is intentionally zero so the background does not bloom.
    material.colorNode = colour;
    material.emissiveNode = vec3(0.0, 0.0, 0.0);

    material.userData = {
        uTime, uPulse, uColorTop, uColorMid, uColorBottom,
    };

    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Volumetric haze — cheap god-ray field on a large quad behind the hero.
// Bicubic upscaling is handled by the post step; this material renders
// at the target plane resolution itself (we keep the geometry small).
// ─────────────────────────────────────────────────────────────────────────────

export function createVolumetricHazeNodeMaterial(options = {}) {
    const steps = Math.max(0, Math.min(64, Math.floor(options.steps ?? 24)));
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        fog: false,
    });

    const uTime = uniform(0);
    // Density bumped so the volumetric god-rays actually register past the bloom + tonemap.
    const uDensity = uniform(options.density ?? 0.12);
    const uTint = uniform(new Vector3(0.694, 0.298, 1.000)); // electric violet haze
    const uHighlight = uniform(new Vector3(1.000, 0.176, 0.584)); // neon pink rim
    const uPulse = uniform(0);

    const haze = Fn(() => {
        const accum = float(0.0).toVar();
        const p = positionWorld.toVar();
        for (let i = 0; i < steps; i += 1) {
            const s = float(i).div(float(steps));
            const sample = vec3(
                p.x.mul(0.06).add(s.mul(0.4)),
                p.y.mul(0.06).add(uTime.mul(0.04)),
                p.z.mul(0.06).add(s.mul(0.8)).add(uTime.mul(0.02)),
            );
            const n = mx_noise_float(sample);
            accum.addAssign(n.mul(float(1.0).sub(s.mul(0.7))));
        }
        return accum.div(float(Math.max(1, steps))).mul(uDensity);
    });

    const density = haze().mul(float(1.0).add(uPulse.mul(0.4)));
    const sweepHighlight = smoothstep(float(0.6), float(1.0), density.mul(2.0));
    const colour = mix(uTint.mul(density), uHighlight, sweepHighlight).mul(clamp(density.mul(2.0), float(0.0), float(1.6)));

    material.colorNode = colour;
    material.opacityNode = clamp(density.mul(1.4), float(0.0), float(0.9));
    material.emissiveNode = colour.mul(0.5);

    material.userData = {
        uTime, uDensity, uTint, uHighlight, uPulse, steps,
    };

    return material;
}

// ─────────────────────────────────────────────────────────────────────────────
// Curl-noise compute particle sprite material
// Reads positions + life from the compute storage buffers.
// ─────────────────────────────────────────────────────────────────────────────

export function createFluidParticleNodeMaterial(params = {}) {
    const { isWebGPU = false, particleCompute = null } = params;
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: AdditiveBlending,
    });

    const useGPU = Boolean(isWebGPU && particleCompute?.getPositionBuffer && particleCompute?.getColorBuffer);

    const positionBuffer = useGPU
        ? storage(particleCompute.getPositionBuffer(), 'vec4', particleCompute.count)
        : null;
    const colorBuffer = useGPU
        ? storage(particleCompute.getColorBuffer(), 'vec4', particleCompute.count)
        : null;
    const velocityBuffer = useGPU
        ? storage(particleCompute.getVelocityBuffer(), 'vec4', particleCompute.count)
        : null;

    const aPos = attribute('instancePosition');
    const aColor = attribute('instanceColor');
    const aSize = attribute('instanceSize');

    // Gameplay-reactive uniforms for particle colour wash + brightness boost.
    // uColorOverride: a target tint pushed in by line-clear / tetris events.
    // uColorOverrideMix: 0 = pure curl-noise colour, 1 = full wash.
    // uBrightnessBoost: additive multiplier on emissive — driven by combo hum.
    const uColorOverride = uniform(new Vector3(1.0, 0.5, 0.8));
    const uColorOverrideMix = uniform(0);
    const uBrightnessBoost = uniform(0);

    const basePos = Fn(() => {
        if (useGPU) return positionBuffer.element(instanceIndex).xyz;
        return aPos;
    })();

    const baseLife = Fn(() => {
        if (useGPU) return positionBuffer.element(instanceIndex).w;
        return float(1.0);
    })();

    const baseColor = Fn(() => {
        if (useGPU) return colorBuffer.element(instanceIndex).xyz;
        return aColor;
    })();

    const baseSize = Fn(() => {
        if (useGPU) return colorBuffer.element(instanceIndex).w;
        return aSize;
    })();

    const baseSpeed = Fn(() => {
        if (useGPU) {
            const v = velocityBuffer.element(instanceIndex).xyz;
            return min(float(2.0), length(v));
        }
        return float(0.5);
    })();

    material.positionNode = basePos;
    // Boosted size multiplier so particles read at typical screen resolution.
    material.sizeNode = baseSize.mul(float(1.6).add(baseSpeed.mul(0.35)));

    // Sprite UV — TSL's pointUV currently emits raw gl_PointCoord which is invalid WGSL,
    // so use uv() which TSL maps to a sprite-correct UV for PointsNodeMaterial. It logs
    // a benign "Vertex attribute uv not found on geometry" warning on first build; that
    // warning is shared by all WebGPU point-sprite materials in this codebase (see
    // black-hole-materials.js:539). Suppress it at the source by attaching a stub uv
    // attribute to the Points geometry; we do that in fluid-dreams-theme.js.
    const center = uv().sub(0.5);
    const dist = length(center);
    const sprite = max(float(0.0), float(1.0).sub(dist.mul(2.0)));
    const soft = pow(sprite, float(1.6));
    const life = clamp(baseLife, float(0.0), float(1.0));
    const lifeFade = smoothstep(float(0.0), float(0.2), life).mul(smoothstep(float(1.0), float(0.7), life));

    const speedBoost = float(1.0).add(baseSpeed.mul(0.4));
    const baseColored = baseColor.mul(speedBoost);
    const colour = mix(baseColored, uColorOverride, uColorOverrideMix);
    const emissiveScale = float(1.4).add(uBrightnessBoost.mul(0.8));

    // Emissive boosted so the particles register against the bloomed hero and
    // bloom catches them — the post threshold is now 0.55, so they need to pop.
    material.colorNode = colour;
    material.opacityNode = soft.mul(lifeFade).mul(0.95);
    material.emissiveNode = colour.mul(soft).mul(lifeFade).mul(emissiveScale);

    material.userData = { uColorOverride, uColorOverrideMix, uBrightnessBoost };

    return material;
}
