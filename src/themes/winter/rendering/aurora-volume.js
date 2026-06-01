/* eslint-disable import/no-unresolved */
/**
 * Winter AAA - Living aurora sky shell.
 *
 * Windows Chrome WebGPU was compiling the previous TSL sky-shell path to an
 * overbright white fallback even with snow, stars, and post disabled. This
 * shell keeps the same runtime uniforms but renders the night gradient and
 * aurora curtains into a bounded canvas texture, then maps that texture onto a
 * standard sky sphere. It keeps the renderer on WebGPU while removing the
 * fragile sky-material graph from the visibility-critical background.
 */

import * as THREE from 'three/webgpu';
import {
    texture as textureNode,
    uv,
    vec3,
} from 'three/tsl';

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;
const TWO_PI = Math.PI * 2;

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

function mix(a, b, t) {
    return a + (b - a) * t;
}

function colorToCss(r, g, b, a = 1) {
    return `rgba(${Math.round(clamp01(r) * 255)}, ${Math.round(clamp01(g) * 255)}, ${Math.round(clamp01(b) * 255)}, ${clamp01(a)})`;
}

function mixColor(a, b, t) {
    const k = clamp01(t);
    return [
        mix(a[0], b[0], k),
        mix(a[1], b[1], k),
        mix(a[2], b[2], k),
    ];
}

function drawAuroraCurtains(ctx, uniforms) {
    const time = uniforms.uTime.value || 0;
    const intensity = clamp01(uniforms.uIntensity.value || 0);
    const flare = clamp01((uniforms.uFlare.value || 0) / 1.5);
    const accent = uniforms.uAccent.value || new THREE.Color(0x6ff2d6);

    // Reads even at Still Night, ramps strongly with the storm. Bounded so the
    // 'screen' stack of 3 layers stays well below white over the dark sky.
    const strength = 0.13 + intensity * 0.24 + flare * 0.2;
    const accentColor = [accent.r, accent.g, accent.b];
    // Classic aurora: strong green base → green-teal mid → violet/pink tips.
    // (Accent push kept small so it stays green at idle; the accent is cyan.)
    const emerald = mixColor([0.08, 1.0, 0.34], accentColor, 0.08 + flare * 0.22);
    const teal = mixColor([0.16, 0.95, 0.50], accentColor, 0.06 + intensity * 0.14);
    const violet = [0.52, 0.34, 0.95];
    const pink = [0.92, 0.46, 0.78];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // Aurora lives in the VISIBLE band: bright base just above the ridge
    // (~0.50H = the horizon on the sphere), tall tips rising into the upper sky.
    const baseY = TEXTURE_HEIGHT * 0.50;
    const strip = 7;
    for (let layer = 0; layer < 3; layer += 1) {
        const drift = time * (0.05 + layer * 0.028); // horizontal dance
        const ripple = time * (0.7 + layer * 0.22);
        const layerAlpha = strength * (0.42 - layer * 0.08);
        const depthShift = layer * 18;

        for (let x = -strip; x < TEXTURE_WIDTH + strip; x += strip) {
            const nx = x / TEXTURE_WIDTH;
            // Ribbons spread across the FULL width via NON-HARMONIC sines + a
            // low base so both halves get coverage (no one-sided bunching).
            const f1 = 1.7 + layer * 0.4;
            const f2 = 3.9 + layer * 0.6;
            const f3 = 6.7 + layer * 0.8;
            const e1 = Math.sin((nx + drift) * TWO_PI * f1 + layer);
            const e2 = Math.sin((nx - drift * 0.7) * TWO_PI * f2 + 1.7);
            const e3 = Math.sin((nx + drift * 0.4) * TWO_PI * f3 + 4.1);
            const curtain = clamp01(e1 * 0.32 + e2 * 0.22 + e3 * 0.16 + 0.46) ** 1.9;
            // Draped FOLD bands (broad, drifting) → the curtain reads as folded
            // fabric catching light, not a flat vertical smear.
            const foldPhase = (nx + drift * 1.4) * TWO_PI * 11 + Math.sin(nx * TWO_PI * 2.3) * 1.6;
            const fold = clamp01(Math.sin(foldPhase) * 0.5 + 0.5) ** 1.6;
            // Fine irregular rays for detail (phase-warped, not a comb).
            const rayPhase = nx * TWO_PI * 40
                + Math.sin(nx * TWO_PI * 3.3 + ripple * 0.5) * 7.0
                + Math.sin(nx * TWO_PI * 0.9) * 4.0
                + ripple;
            const ray = clamp01(Math.sin(rayPhase) * 0.5 + 0.5) ** 2.4;
            const alpha = curtain * (0.32 + fold * 0.45 + ray * 0.23) * layerAlpha;
            if (alpha < 0.006) continue;

            // Draped curved curtain: top edge waves strongly, base waves gently.
            const sway = Math.sin((nx + drift) * TWO_PI * 1.3 + ripple * 0.4) * 30
                + Math.sin((nx + drift) * TWO_PI * 0.5) * 18;
            const heightVar = 0.4 + 0.6 * (Math.sin(nx * TWO_PI * 2.1 + layer * 1.3) * 0.5 + 0.5);
            const top = TEXTURE_HEIGHT * 0.12 + depthShift + sway - heightVar * 48 + (1 - curtain) * 46;
            const bottom = baseY + Math.sin(nx * TWO_PI * 2.6 - ripple * 0.5) * 14;
            const width = strip * 2.0 + ray * 8;

            const gradient = ctx.createLinearGradient(0, top, 0, bottom);
            // Tips: pink/violet (faint) → teal (mid) → emerald (bright base) → fade.
            gradient.addColorStop(0, colorToCss(pink[0], pink[1], pink[2], alpha * 0.05));
            gradient.addColorStop(0.16, colorToCss(violet[0], violet[1], violet[2], alpha * 0.16));
            gradient.addColorStop(0.5, colorToCss(teal[0], teal[1], teal[2], alpha * 0.5));
            gradient.addColorStop(0.82, colorToCss(emerald[0], emerald[1], emerald[2], alpha));
            gradient.addColorStop(1, colorToCss(emerald[0], emerald[1], emerald[2], alpha * 0.05));
            ctx.fillStyle = gradient;
            ctx.fillRect(x - width * 0.5, top, width, Math.max(1, bottom - top));
        }
    }

    // Luminous emerald skirt at the ridge — the bright base glow of the aurora.
    const glow = ctx.createLinearGradient(0, TEXTURE_HEIGHT * 0.42, 0, TEXTURE_HEIGHT * 0.6);
    glow.addColorStop(0, colorToCss(emerald[0], emerald[1], emerald[2], 0));
    glow.addColorStop(0.65, colorToCss(0.12, 0.86, 0.6, strength * 0.2));
    glow.addColorStop(1, colorToCss(0.02, 0.16, 0.22, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, TEXTURE_HEIGHT * 0.42, TEXTURE_WIDTH, TEXTURE_HEIGHT * 0.18);

    ctx.restore();
}

function drawSkyTexture(ctx, uniforms) {
    const intensity = clamp01(uniforms.uIntensity.value || 0);
    const whiteout = clamp01(uniforms.uWhiteout.value || 0);

    const top = mixColor([0.055, 0.09, 0.18], [0.08, 0.13, 0.24], intensity * 0.34);
    const mid = mixColor([0.07, 0.14, 0.25], [0.1, 0.2, 0.32], intensity * 0.42);
    const horizon = mixColor([0.09, 0.22, 0.3], [0.14, 0.3, 0.38], intensity * 0.5);
    const ground = [0.02, 0.04, 0.08];

    const gradient = ctx.createLinearGradient(0, 0, 0, TEXTURE_HEIGHT);
    gradient.addColorStop(0, colorToCss(top[0], top[1], top[2]));
    gradient.addColorStop(0.42, colorToCss(mid[0], mid[1], mid[2]));
    gradient.addColorStop(0.72, colorToCss(horizon[0], horizon[1], horizon[2]));
    gradient.addColorStop(1, colorToCss(ground[0], ground[1], ground[2]));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

    // A restrained moon-direction sky glow, aligned with the moon mesh
    // (upper-right, lowered into frame). The moon mesh supplies the visible disc.
    const moonX = TEXTURE_WIDTH * 0.64;
    const moonY = TEXTURE_HEIGHT * 0.36;
    const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, TEXTURE_HEIGHT * 0.5);
    moonGlow.addColorStop(0, 'rgba(160, 198, 255, 0.2)');
    moonGlow.addColorStop(0.24, 'rgba(82, 142, 210, 0.045)');
    moonGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = moonGlow;
    ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

    // Faint milky winter haze, kept far below white.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.translate(TEXTURE_WIDTH * 0.52, TEXTURE_HEIGHT * 0.4);
    ctx.rotate(-0.28);
    const haze = ctx.createLinearGradient(0, -TEXTURE_HEIGHT * 0.18, 0, TEXTURE_HEIGHT * 0.18);
    haze.addColorStop(0, 'rgba(80, 118, 180, 0)');
    haze.addColorStop(0.5, 'rgba(85, 130, 190, 0.035)');
    haze.addColorStop(1, 'rgba(80, 118, 180, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(-TEXTURE_WIDTH, -TEXTURE_HEIGHT * 0.18, TEXTURE_WIDTH * 2, TEXTURE_HEIGHT * 0.36);
    ctx.restore();

    // Atmospheric horizon haze — soft misty band where land meets sky, so the
    // ground/ridge transition is a cold-air gradient rather than a hard edge.
    const hazeBand = ctx.createLinearGradient(0, TEXTURE_HEIGHT * 0.40, 0, TEXTURE_HEIGHT * 0.66);
    hazeBand.addColorStop(0, 'rgba(40, 64, 100, 0)');
    hazeBand.addColorStop(0.5, 'rgba(54, 82, 122, 0.24)');
    hazeBand.addColorStop(1, 'rgba(28, 48, 78, 0)');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = hazeBand;
    ctx.fillRect(0, TEXTURE_HEIGHT * 0.40, TEXTURE_WIDTH, TEXTURE_HEIGHT * 0.26);

    drawAuroraCurtains(ctx, uniforms);

    if (whiteout > 0) {
        const hazeColor = [0.48, 0.58, 0.7];
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = colorToCss(hazeColor[0], hazeColor[1], hazeColor[2], whiteout * 0.42);
        ctx.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    }
}

export function createAuroraVolume(params = {}) {
    const radius = params.radius ?? 4500;
    console.log('%c[AuroraVolume] build: canvas-aurora-v4 (folds+haze)', 'color:#6ff2d6;font-weight:bold');
    const initialAccent = params.accent instanceof THREE.Color
        ? params.accent.clone()
        : new THREE.Color(params.accent ?? 0x6ff2d6);

    const uniforms = {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uFlare: { value: 0 },
        uWhiteout: { value: 0 },
        uAccent: { value: initialAccent },
        uMoonDir: { value: params.moonDir ?? new THREE.Vector3(500, 1000, -800).normalize() },
    };

    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_WIDTH;
    canvas.height = TEXTURE_HEIGHT;
    const ctx = canvas.getContext('2d');
    drawSkyTexture(ctx, uniforms);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
    });
    material.colorNode = textureNode(texture).sample(uv()).rgb;
    material.emissiveNode = vec3(0.0);

    const geometry = new THREE.SphereGeometry(radius, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;

    let lastFrameKey = '';
    mesh.onBeforeRender = () => {
        const key = [
            Math.floor((uniforms.uTime.value || 0) * 20),
            Math.round((uniforms.uIntensity.value || 0) * 200),
            Math.round((uniforms.uFlare.value || 0) * 100),
            Math.round((uniforms.uWhiteout.value || 0) * 100),
            uniforms.uAccent.value?.getHexString?.() || 'accent',
        ].join(':');
        if (key === lastFrameKey) return;
        lastFrameKey = key;
        drawSkyTexture(ctx, uniforms);
        texture.needsUpdate = true;
    };

    return {
        mesh,
        uniforms,
        dispose: () => {
            texture.dispose();
            geometry.dispose();
            material.dispose();
        },
    };
}
