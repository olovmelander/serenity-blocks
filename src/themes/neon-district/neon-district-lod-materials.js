import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    uniform,
    uniformTexture,
    varying,
    positionLocal,
    positionWorld,
    normalLocal,
    positionView,
    uv,
    vertexColor,
    vec2,
    vec3,
    vec4,
    float,
    sin,
    fract,
    floor,
    abs,
    dot,
    length,
    mix,
    smoothstep,
    pow,
    exp,
    step,
    clamp,
    max,
    mod,
    normalize,
    sqrt,
    time,
    texture,
    normalMap,
} from 'three/tsl';

const hash2D = /* @__PURE__ */ Fn(([p]) => {
    return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

const noise2D = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = hash2D(i);
    const b = hash2D(i.add(vec2(1.0, 0.0)));
    const c = hash2D(i.add(vec2(0.0, 1.0)));
    const d = hash2D(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/**
 * BUILDING LOD SYSTEM - Simplified materials for distant buildings
 *
 * Tier 0: Full detail (existing createBuildingNodeMaterial)
 * Tier 1: Medium LOD - baked texture, simplified shader
 * Tier 2: Low LOD - solid emissive color
 */

/**
 * Generate baked window texture (1024x1024 high-res)
 * Uses "Cyberpunk Noise" pattern to mimic the procedural shader
 * Cached and reused for all Tier 1 buildings
 */
export function createBakedWindowTexture() {
    const size = 1024; // Higher resolution for better close-up quality
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. Background: Dark metallic building surface
    ctx.fillStyle = '#000000'; // Pure black for better contrast
    ctx.fillRect(0, 0, size, size);

    // 2. Base Noise: Add subtle "tech" grid lines (dark grey)
    ctx.strokeStyle = '#0a0a0a'; // Very dark grey
    ctx.lineWidth = 2;
    const gridSize = 64;
    for (let i = 0; i < size; i += gridSize) {
        ctx.beginPath();
        ctx.moveTo(i, 0); ctx.lineTo(i, size);
        ctx.moveTo(0, i); ctx.lineTo(size, i);
        ctx.stroke();
    }

    // 3. Windows Generation
    // "Noir" Style: Sparse, high contrast, mostly white/warm
    const cols = 32;
    const rows = 64;
    const cellW = size / cols;
    const cellH = size / rows;
    const padding = 8; // More spacing between windows

    for (let r = 0; r < rows; r++) {
        // Increased active rows for better density on distant buildings
        // Was 0.15 (inverted > 0.85), now 0.4 (inverted > 0.6)
        const rowActive = Math.random() > 0.6;

        for (let c = 0; c < cols; c++) {
            // Per-window variance
            if (rowActive && Math.random() > 0.5) {
                const x = c * cellW + padding;
                const y = r * cellH + padding;
                const w = cellW - padding * 2;
                // Make windows shorter (horizontal dashes)
                const h = (cellH - padding * 2) * 0.6;

                // Color Palette: Noir Style
                // Mostly neutral/warm whites (no neon/cyan).
                const rand = Math.random();
                let color;
                let intensity = 1.0;

                if (rand > 0.6) { color = '#ffffff'; intensity = 1.8; } // Pure white
                else if (rand > 0.3) { color = '#ffe9c8'; intensity = 1.5; } // Warm white
                else { color = '#f6f1e2'; intensity = 1.2; } // Soft white

                // Skip the "glow pass" to make them sharper/subtler

                // Core Pass (solid, bright, small)
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.9 * intensity;
                ctx.fillRect(x, y + h * 0.2, w, h); // Center vertically in cell
            }
        }
    }

    // 4. "Building Edge" darken (simulate corner occlusion)
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    // Harder edge falloff
    gradient.addColorStop(0, 'rgba(0,0,0,1.0)');
    gradient.addColorStop(0.1, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(0.2, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.8, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.9, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(1, 'rgba(0,0,0,1.0)');

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // Anisotropy helps with oblique viewing angles
    texture.anisotropy = 4;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace; // Ensure correct color profile
    texture.needsUpdate = true;

    return texture;
}

/**
 * Medium LOD Material (Tier 1) - Baked texture
 * Settings tuned to match High Tier procedural shader
 */
export function createBuildingMaterialMediumLOD(bakedTexture) {
    const material = new THREE.MeshStandardMaterial({
        map: bakedTexture,
        // PURE BLACK -> Matches the void-like buildings in the photo
        color: 0x000000,
        roughness: 0.1, // Very smooth/wet
        metalness: 0.9, // High reflection
        emissive: 0xffffff,
        emissiveMap: bakedTexture,
        emissiveIntensity: 0.8, // Lower glow to avoid over-bright LODs
        side: THREE.FrontSide,
    });

    return { material };
}

/**
 * Low LOD Material (Tier 2) - Simple emissive box
 * ~90% cheaper than full procedural shader
 */
export function createBuildingMaterialLowLOD(bakedTexture, color = 0x000000) {
    // If bakedTexture provided, use it for windows even on lowest LOD
    // This solves "pitch black" buildings
    if (bakedTexture) {
        const material = new THREE.MeshBasicMaterial({
            map: bakedTexture,
            color: 0xffffff, // Tint with white to keep texture colors
            side: THREE.FrontSide,
        });
        return { material };
    }

    // Fallback if no texture
    const material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.FrontSide, // Only render front faces
        transparent: false, // SOLID opaque
        depthWrite: true, // Write to depth buffer
    });

    return { material };
}

/**
 * Tier 1 (Medium LOD) - Procedural Shader (Simplified)
 * Uses the exact same window logic/quantization as High Quality to ensure visual match,
 * but removes expensive noise gloss/roughness/normal calculations.
 * ENFORCES constant "lower resolution" (blocky) look to prevent aliasing at distance.
 */
export function createProceduralBuildingNodeMaterialLOD1() {
    const uTime = uniform(0);
    const uSeed = uniform(0);
    const uGlowIntensity = uniform(1.0);
    const uWindowScale = uniform(1.0);

    const pos = positionLocal;
    const norm = normalLocal;
    const worldPos = positionWorld;

    // ═══════════════════════════════════════════════════════════════════════════
    // PERF: FIXED RESOLUTION SCALING
    // We force the "Medium/Far" look directly.
    // ═══════════════════════════════════════════════════════════════════════════

    // Increased quantization for even "chunkier" look (less noise)
    const quantStep = float(15.0);
    const windowScaleFactor = float(4.0);

    const quantizedPos = floor(pos.div(quantStep)).mul(quantStep);
    const patternPos = quantizedPos;

    const positionSeed = hash2D(floor(worldPos.xz.div(50.0)));
    const effectiveSeed = uSeed.add(positionSeed.mul(1000.0));

    // Pure black body
    const baseColor = vec3(0.01);

    const aspectParams = hash2D(vec2(effectiveSeed, 123.45));

    const baseGridW = float(5.0).add(aspectParams.mul(5.0)).mul(uWindowScale.mul(0.4).add(0.8));
    const baseGridH = float(8.0).add(hash2D(vec2(effectiveSeed, 678.9)).mul(8.0)).mul(uWindowScale.mul(0.4).add(0.8));

    const gridW = baseGridW.mul(windowScaleFactor);
    const gridH = baseGridH.mul(windowScaleFactor);

    const isSide = float(1.0).sub(step(0.1, abs(norm.y)));
    const gridXY = vec2(patternPos.x, patternPos.y);
    const gridXZ = vec2(patternPos.x, patternPos.z);
    const gridStr = mix(gridXZ, gridXY, isSide).add(effectiveSeed.mul(50.0));

    const cell = floor(gridStr.div(vec2(gridW, gridH)));
    const frac = fract(gridStr.div(vec2(gridW, gridH)));

    const baseGap = float(0.2).add(hash2D(vec2(effectiveSeed, 333.33)).mul(0.15));
    const gap = baseGap.add(0.15); // Large gaps for LOD

    const edgeSoftness = float(0.05);
    const isWindow = smoothstep(gap, gap.add(edgeSoftness), frac.x)
        .mul(smoothstep(frac.x, frac.x.add(edgeSoftness), float(1.0).sub(gap)))
        .mul(smoothstep(gap, gap.add(edgeSoftness), frac.y))
        .mul(smoothstep(frac.y, frac.y.add(edgeSoftness), float(1.0).sub(gap)));

    // Window Density Logic - DRASTICALLY REDUCED to prevent "Grey/White" washout
    const baseLitDensity = float(0.2).add(hash2D(vec2(effectiveSeed, 999.0)).mul(0.4)); // Range 0.2 - 0.6

    // Cap mostly low
    const effectiveDensity = max(baseLitDensity.mul(0.2), float(0.1));

    const h = hash2D(cell.add(vec2(effectiveSeed)));
    const isLit = isWindow.mul(step(float(1.0).sub(effectiveDensity), h));

    const hue = hash2D(cell.mul(2.0));

    // Colors: Pure White & Warm White only
    const pureWhite = vec3(1.0, 1.0, 1.0);
    const warmWhite = vec3(1.0, 0.94, 0.85);
    const winColor = mix(pureWhite, warmWhite, smoothstep(0.2, 0.8, hue));

    const wBright = float(0.75).add(hash2D(cell.mul(3.0)).mul(0.35));

    // Slightly higher brightness for pink to make it pop against black
    const effectiveBright = wBright.mul(0.5);

    const windowGlow = winColor.mul(effectiveBright).mul(0.8).mul(isLit);

    const finalColor = baseColor.add(windowGlow);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = windowGlow;

    return {
        material,
        uniforms: {
            uTime, uSeed, uGlowIntensity, uWindowScale,
        },
    };
}

/**
 * Tier 2 (Low LOD) - Procedural Shader (White/Warm Windows)
 * Replaces the texture lookup for distant buildings to ensure consistent style.
 */
export function createProceduralBuildingNodeMaterialLOD2() {
    const uTime = uniform(0);
    const uSeed = uniform(0);
    const uGlowIntensity = uniform(1.0);
    const uWindowScale = uniform(1.0);

    const pos = positionLocal;
    const norm = normalLocal;
    const worldPos = positionWorld;

    // ═══════════════════════════════════════════════════════════════════════════
    // PERF: FIXED RESOLUTION SCALING
    // Same settings as LOD1 for consistency
    // ═══════════════════════════════════════════════════════════════════════════

    const quantStep = float(15.0);
    const windowScaleFactor = float(4.0);

    const quantizedPos = floor(pos.div(quantStep)).mul(quantStep);
    const patternPos = quantizedPos;

    const positionSeed = hash2D(floor(worldPos.xz.div(50.0)));
    const effectiveSeed = uSeed.add(positionSeed.mul(1000.0));

    const baseColor = vec3(0.01);

    const aspectParams = hash2D(vec2(effectiveSeed, 123.45));

    const baseGridW = float(5.0).add(aspectParams.mul(5.0)).mul(uWindowScale.mul(0.4).add(0.8));
    const baseGridH = float(8.0).add(hash2D(vec2(effectiveSeed, 678.9)).mul(8.0)).mul(uWindowScale.mul(0.4).add(0.8));

    const gridW = baseGridW.mul(windowScaleFactor);
    const gridH = baseGridH.mul(windowScaleFactor);

    const isSide = float(1.0).sub(step(0.1, abs(norm.y)));
    const gridXY = vec2(patternPos.x, patternPos.y);
    const gridXZ = vec2(patternPos.x, patternPos.z);
    const gridStr = mix(gridXZ, gridXY, isSide).add(effectiveSeed.mul(50.0));

    const cell = floor(gridStr.div(vec2(gridW, gridH)));
    const frac = fract(gridStr.div(vec2(gridW, gridH)));

    const baseGap = float(0.2).add(hash2D(vec2(effectiveSeed, 333.33)).mul(0.15));
    const gap = baseGap.add(0.15);

    const edgeSoftness = float(0.05);
    const isWindow = smoothstep(gap, gap.add(edgeSoftness), frac.x)
        .mul(smoothstep(frac.x, frac.x.add(edgeSoftness), float(1.0).sub(gap)))
        .mul(smoothstep(gap, gap.add(edgeSoftness), frac.y))
        .mul(smoothstep(frac.y, frac.y.add(edgeSoftness), float(1.0).sub(gap)));

    const baseLitDensity = float(0.2).add(hash2D(vec2(effectiveSeed, 999.0)).mul(0.4));
    const effectiveDensity = max(baseLitDensity.mul(0.2), float(0.1));

    const h = hash2D(cell.add(vec2(effectiveSeed)));
    const isLit = isWindow.mul(step(float(1.0).sub(effectiveDensity), h));

    const hue = hash2D(cell.mul(2.0));

    // Tier 2 (Low LOD) - Standard White/Warm Windows
    const pureWhite = vec3(1.0, 1.0, 1.0);
    const warmWhite = vec3(1.0, 0.94, 0.85);
    const winColor = mix(pureWhite, warmWhite, smoothstep(0.2, 0.8, hue));

    const wBright = float(0.75).add(hash2D(cell.mul(3.0)).mul(0.35));

    // Slightly higher brightness for pink
    const effectiveBright = wBright.mul(0.5);

    const windowGlow = winColor.mul(effectiveBright).mul(0.8).mul(isLit);

    const finalColor = baseColor.add(windowGlow);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = windowGlow;

    return {
        material,
        uniforms: {
            uTime, uSeed, uGlowIntensity, uWindowScale,
        },
    };
}
