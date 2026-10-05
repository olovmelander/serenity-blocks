import * as THREE from 'three/webgpu';
import { createBuildingNodeMaterial } from './neon-district-materials.js';
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

                if (rand > 0.6) {
                    color = '#a0efff'; intensity = 1.8;
                } else if (rand > 0.3) {
                    color = '#ffd0ae'; intensity = 1.5;
                } else {
                    color = '#ff8ebd'; intensity = 1.2;
                }

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
 * Shares the derivative-filtered architectural grid with High quality,
 * but removes expensive noise gloss/roughness/normal calculations.
 * ENFORCES constant "lower resolution" (blocky) look to prevent aliasing at distance.
 */
export function createProceduralBuildingNodeMaterialLOD1() {
    return createBuildingNodeMaterial({ detail: 'medium' });
}

/** Distant facades use the same stable rooms with inexpensive cladding. */
export function createProceduralBuildingNodeMaterialLOD2() {
    return createBuildingNodeMaterial({ detail: 'low' });
}
