/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BIOLUMINESCENCE THEME - Three.js 3D Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * A mystical underground cave illuminated by glowing mushrooms, crystal clusters,
 * and floating spores. Features:
 * - Detailed mushroom geometry with stems, caps, and spiral patterns
 * - Crystal cluster formations (grouped crystals)
 * - Rocky cave terrain with wet reflective surfaces
 * - Cave ceiling/walls for depth
 * - Volumetric atmosphere and bloom
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { normalizeQuality } from '../../utils/quality.js';
import { BIOLUMINESCENCE_TETROMINOS } from './bioluminescence-tetrominos.js';

// ─────────────────────────────────────────────────────────────────────────────
// Quality Presets
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_PRESETS = {
    Extreme: { mushroomCount: 20, crystalClusterCount: 6, sporeCount: 300, bloomStrength: 0.4, enablePost: true },
    Ultra: { mushroomCount: 16, crystalClusterCount: 5, sporeCount: 200, bloomStrength: 0.35, enablePost: true },
    High: { mushroomCount: 12, crystalClusterCount: 4, sporeCount: 150, bloomStrength: 0.3, enablePost: true },
    Medium: { mushroomCount: 8, crystalClusterCount: 3, sporeCount: 100, bloomStrength: 0.25, enablePost: false },
    Low: { mushroomCount: 5, crystalClusterCount: 2, sporeCount: 60, bloomStrength: 0.2, enablePost: false },
    Minimal: { mushroomCount: 3, crystalClusterCount: 1, sporeCount: 30, bloomStrength: 0.15, enablePost: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// PBR TEXTURE GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create PBR textures for cave rock terrain
 * Returns: colorMap, normalMap, roughnessMap, aoMap, emissiveMap
 */
function createCaveRockPBRTextures() {
    const SIZE = 256; // Reduced from 512 for faster startup

    // Create canvases
    const heightCanvas = document.createElement('canvas');
    const normalCanvas = document.createElement('canvas');
    const colorCanvas = document.createElement('canvas');
    const roughnessCanvas = document.createElement('canvas');
    const aoCanvas = document.createElement('canvas');
    const emissiveCanvas = document.createElement('canvas');

    [heightCanvas, normalCanvas, colorCanvas, roughnessCanvas, aoCanvas, emissiveCanvas].forEach(c => {
        c.width = SIZE;
        c.height = SIZE;
    });

    const heightCtx = heightCanvas.getContext('2d');
    const normalCtx = normalCanvas.getContext('2d');
    const colorCtx = colorCanvas.getContext('2d');
    const roughnessCtx = roughnessCanvas.getContext('2d');
    const aoCtx = aoCanvas.getContext('2d');
    const emissiveCtx = emissiveCanvas.getContext('2d');

    // ─────────────────────────────────────────────────────────────────────────
    // 1. HEIGHT MAP - Rocky terrain with cracks and bumps
    // ─────────────────────────────────────────────────────────────────────────
    heightCtx.fillStyle = '#808080';
    heightCtx.fillRect(0, 0, SIZE, SIZE);

    // Large rock formations
    for (let i = 0; i < 8; i++) { // Reduced from 15
        const x = Math.random() * SIZE;
        const y = Math.random() * SIZE;
        const r = 40 + Math.random() * 80;
        const brightness = 150 + Math.random() * 80;

        const grad = heightCtx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgb(${brightness}, ${brightness}, ${brightness})`);
        grad.addColorStop(0.7, `rgb(${brightness - 40}, ${brightness - 40}, ${brightness - 40})`);
        grad.addColorStop(1, 'rgba(128, 128, 128, 0)');
        heightCtx.fillStyle = grad;
        heightCtx.beginPath();
        heightCtx.arc(x, y, r, 0, Math.PI * 2);
        heightCtx.fill();
    }

    // Cracks and crevices (dark lines)
    heightCtx.strokeStyle = 'rgb(40, 40, 40)';
    heightCtx.lineWidth = 2;
    for (let i = 0; i < 15; i++) { // Reduced from 30
        heightCtx.beginPath();
        let px = Math.random() * SIZE;
        let py = Math.random() * SIZE;
        heightCtx.moveTo(px, py);
        for (let j = 0; j < 5; j++) {
            px += (Math.random() - 0.5) * 60;
            py += (Math.random() - 0.5) * 60;
            heightCtx.lineTo(px, py);
        }
        heightCtx.stroke();
    }

    // Small bumps for texture
    for (let i = 0; i < 100; i++) { // Reduced from 300
        const x = Math.random() * SIZE;
        const y = Math.random() * SIZE;
        const r = 2 + Math.random() * 8;
        const b = 140 + Math.random() * 60;
        heightCtx.fillStyle = `rgb(${b}, ${b}, ${b})`;
        heightCtx.beginPath();
        heightCtx.arc(x, y, r, 0, Math.PI * 2);
        heightCtx.fill();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. NORMAL MAP from height (Sobel operator)
    // ─────────────────────────────────────────────────────────────────────────
    const heightData = heightCtx.getImageData(0, 0, SIZE, SIZE);
    const normalData = normalCtx.createImageData(SIZE, SIZE);

    const getHeight = (x, y) => {
        x = ((x % SIZE) + SIZE) % SIZE;
        y = ((y % SIZE) + SIZE) % SIZE;
        return heightData.data[(y * SIZE + x) * 4] / 255;
    };

    const strength = 3.0;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const tl = getHeight(x - 1, y - 1), t = getHeight(x, y - 1), tr = getHeight(x + 1, y - 1);
            const l = getHeight(x - 1, y), r = getHeight(x + 1, y);
            const bl = getHeight(x - 1, y + 1), b = getHeight(x, y + 1), br = getHeight(x + 1, y + 1);

            const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
            const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

            let nx = -dx * strength, ny = -dy * strength, nz = 1.0;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            nx /= len; ny /= len; nz /= len;

            const idx = (y * SIZE + x) * 4;
            normalData.data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
            normalData.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
            normalData.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
            normalData.data[idx + 3] = 255;
        }
    }
    normalCtx.putImageData(normalData, 0, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. COLOR MAP - Dark teal-gray cave rock
    // ─────────────────────────────────────────────────────────────────────────
    const colorData = colorCtx.createImageData(SIZE, SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
        const h = heightData.data[i * 4] / 255;
        const idx = i * 4;

        // Dark teal-gray base
        const baseR = 30 + Math.random() * 15;
        const baseG = 50 + Math.random() * 20;
        const baseB = 55 + Math.random() * 20;

        const factor = 0.5 + h * 0.7;
        colorData.data[idx] = Math.min(255, Math.floor(baseR * factor));
        colorData.data[idx + 1] = Math.min(255, Math.floor(baseG * factor));
        colorData.data[idx + 2] = Math.min(255, Math.floor(baseB * factor));
        colorData.data[idx + 3] = 255;
    }
    colorCtx.putImageData(colorData, 0, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // 4. ROUGHNESS MAP - Wet/smooth high areas, rough cracks
    // ─────────────────────────────────────────────────────────────────────────
    const roughnessData = roughnessCtx.createImageData(SIZE, SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
        const h = heightData.data[i * 4] / 255;
        const idx = i * 4;
        const noise = (Math.random() - 0.5) * 20;
        // Wet look on raised areas (low roughness = shiny)
        const roughness = Math.max(0, Math.min(255, (1 - h) * 150 + 40 + noise));
        roughnessData.data[idx] = roughnessData.data[idx + 1] = roughnessData.data[idx + 2] = roughness;
        roughnessData.data[idx + 3] = 255;
    }
    roughnessCtx.putImageData(roughnessData, 0, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // 5. AO MAP - Dark in crevices
    // ─────────────────────────────────────────────────────────────────────────
    const aoData = aoCtx.createImageData(SIZE, SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
        const h = heightData.data[i * 4] / 255;
        const idx = i * 4;
        const ao = Math.floor(h * 180 + 75);
        aoData.data[idx] = aoData.data[idx + 1] = aoData.data[idx + 2] = ao;
        aoData.data[idx + 3] = 255;
    }
    aoCtx.putImageData(aoData, 0, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // 6. EMISSIVE MAP - Glowing patches for bioluminescence
    // ─────────────────────────────────────────────────────────────────────────
    emissiveCtx.fillStyle = '#000000';
    emissiveCtx.fillRect(0, 0, SIZE, SIZE);

    // Random glowing spots
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * SIZE;
        const y = Math.random() * SIZE;
        const r = 10 + Math.random() * 40;
        const grad = emissiveCtx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(0, 180, 160, 0.4)');
        grad.addColorStop(0.5, 'rgba(0, 120, 100, 0.2)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        emissiveCtx.fillStyle = grad;
        emissiveCtx.beginPath();
        emissiveCtx.arc(x, y, r, 0, Math.PI * 2);
        emissiveCtx.fill();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. CREATE THREE.JS TEXTURES
    // ─────────────────────────────────────────────────────────────────────────
    const wrapAndRepeat = (tex, repeatX = 4, repeatY = 4) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        return tex;
    };

    return {
        colorMap: wrapAndRepeat(new THREE.CanvasTexture(colorCanvas)),
        normalMap: wrapAndRepeat(new THREE.CanvasTexture(normalCanvas)),
        roughnessMap: wrapAndRepeat(new THREE.CanvasTexture(roughnessCanvas)),
        aoMap: wrapAndRepeat(new THREE.CanvasTexture(aoCanvas)),
        emissiveMap: wrapAndRepeat(new THREE.CanvasTexture(emissiveCanvas)),
    };
}

/**
 * Create PBR textures for vines - organic bark-like appearance
 * Returns: colorMap, normalMap, roughnessMap, emissiveMap
 */
function createVinePBRTextures() {
    const SIZE = 256;

    const colorCanvas = document.createElement('canvas');
    const normalCanvas = document.createElement('canvas');
    const roughnessCanvas = document.createElement('canvas');
    const emissiveCanvas = document.createElement('canvas');
    const heightCanvas = document.createElement('canvas');

    [colorCanvas, normalCanvas, roughnessCanvas, emissiveCanvas, heightCanvas].forEach(c => {
        c.width = SIZE;
        c.height = SIZE;
    });

    const colorCtx = colorCanvas.getContext('2d');
    const normalCtx = normalCanvas.getContext('2d');
    const roughnessCtx = roughnessCanvas.getContext('2d');
    const emissiveCtx = emissiveCanvas.getContext('2d');
    const heightCtx = heightCanvas.getContext('2d');

    // ─────────────────────────────────────────────────────────────────────────
    // 1. HEIGHT MAP - Bark-like ridges and organic texture
    // ─────────────────────────────────────────────────────────────────────────
    heightCtx.fillStyle = '#808080';
    heightCtx.fillRect(0, 0, SIZE, SIZE);

    // Vertical ridges (bark grooves)
    for (let i = 0; i < 8; i++) { // Reduced from 12
        const x = (i / 8) * SIZE + (Math.random() - 0.5) * 15;
        const width = 8 + Math.random() * 12;
        const brightness = 100 + Math.random() * 50;

        heightCtx.strokeStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
        heightCtx.lineWidth = width;
        heightCtx.beginPath();
        heightCtx.moveTo(x, 0);

        // Wavy line down
        for (let y = 0; y <= SIZE; y += 20) {
            heightCtx.lineTo(x + Math.sin(y * 0.1) * 5, y);
        }
        heightCtx.stroke();
    }

    // Horizontal ring patterns
    for (let i = 0; i < 5; i++) { // Reduced from 8
        const y = Math.random() * SIZE;
        const lineY = y + (Math.random() - 0.5) * 10;
        heightCtx.strokeStyle = `rgb(60, 60, 60)`;
        heightCtx.lineWidth = 1 + Math.random() * 2;
        heightCtx.beginPath();
        heightCtx.moveTo(0, lineY);
        heightCtx.lineTo(SIZE, lineY + (Math.random() - 0.5) * 5);
        heightCtx.stroke();
    }

    // Small bumps/nodes
    for (let i = 0; i < 15; i++) { // Reduced from 30
        const x = Math.random() * SIZE;
        const y = Math.random() * SIZE;
        const r = 2 + Math.random() * 5;
        const b = 150 + Math.random() * 80;
        heightCtx.fillStyle = `rgb(${b}, ${b}, ${b})`;
        heightCtx.beginPath();
        heightCtx.arc(x, y, r, 0, Math.PI * 2);
        heightCtx.fill();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. NORMAL MAP from height (Sobel operator)
    // ─────────────────────────────────────────────────────────────────────────
    const heightData = heightCtx.getImageData(0, 0, SIZE, SIZE);
    const normalData = normalCtx.createImageData(SIZE, SIZE);

    const getHeight = (x, y) => {
        x = ((x % SIZE) + SIZE) % SIZE;
        y = ((y % SIZE) + SIZE) % SIZE;
        return heightData.data[(y * SIZE + x) * 4] / 255;
    };

    const strength = 2.5;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const tl = getHeight(x - 1, y - 1), t = getHeight(x, y - 1), tr = getHeight(x + 1, y - 1);
            const l = getHeight(x - 1, y), r = getHeight(x + 1, y);
            const bl = getHeight(x - 1, y + 1), b = getHeight(x, y + 1), br = getHeight(x + 1, y + 1);

            const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
            const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

            let nx = -dx * strength, ny = -dy * strength, nz = 1.0;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            nx /= len; ny /= len; nz /= len;

            const idx = (y * SIZE + x) * 4;
            normalData.data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
            normalData.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
            normalData.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
            normalData.data[idx + 3] = 255;
        }
    }
    normalCtx.putImageData(normalData, 0, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. COLOR MAP - Organic green/teal vine colors
    // ─────────────────────────────────────────────────────────────────────────
    // Base gradient
    const baseGrad = colorCtx.createLinearGradient(0, 0, SIZE, SIZE);
    baseGrad.addColorStop(0, '#1a4a40');
    baseGrad.addColorStop(0.5, '#0d3530');
    baseGrad.addColorStop(1, '#1a5545');
    colorCtx.fillStyle = baseGrad;
    colorCtx.fillRect(0, 0, SIZE, SIZE);

    // Add variation based on height
    const colorData = colorCtx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
        const h = heightData.data[i * 4] / 255;
        const idx = i * 4;
        // Darken grooves, lighten ridges
        const factor = 0.6 + h * 0.8;
        colorData.data[idx] = Math.floor(colorData.data[idx] * factor);
        colorData.data[idx + 1] = Math.floor(colorData.data[idx + 1] * factor);
        colorData.data[idx + 2] = Math.floor(colorData.data[idx + 2] * factor);
    }
    colorCtx.putImageData(colorData, 0, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // 4. ROUGHNESS MAP - Varied roughness
    // ─────────────────────────────────────────────────────────────────────────
    const roughData = roughnessCtx.createImageData(SIZE, SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
        const h = heightData.data[i * 4] / 255;
        // Ridges are smoother (lower roughness), grooves are rougher
        const rough = 0.5 + (1 - h) * 0.4;
        const v = Math.floor(rough * 255);
        const idx = i * 4;
        roughData.data[idx] = roughData.data[idx + 1] = roughData.data[idx + 2] = v;
        roughData.data[idx + 3] = 255;
    }
    roughnessCtx.putImageData(roughData, 0, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // 5. EMISSIVE MAP - Glowing bioluminescent spots
    // ─────────────────────────────────────────────────────────────────────────
    emissiveCtx.fillStyle = '#000000';
    emissiveCtx.fillRect(0, 0, SIZE, SIZE);

    // Random glowing spots
    for (let i = 0; i < 15; i++) {
        const x = Math.random() * SIZE;
        const y = Math.random() * SIZE;
        const r = 5 + Math.random() * 15;
        const grad = emissiveCtx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(0, 200, 180, 0.6)');
        grad.addColorStop(0.5, 'rgba(0, 150, 130, 0.3)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        emissiveCtx.fillStyle = grad;
        emissiveCtx.beginPath();
        emissiveCtx.arc(x, y, r, 0, Math.PI * 2);
        emissiveCtx.fill();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. CREATE THREE.JS TEXTURES
    // ─────────────────────────────────────────────────────────────────────────
    const wrapAndRepeat = (tex, repeatX = 1, repeatY = 4) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        return tex;
    };

    return {
        colorMap: wrapAndRepeat(new THREE.CanvasTexture(colorCanvas)),
        normalMap: wrapAndRepeat(new THREE.CanvasTexture(normalCanvas)),
        roughnessMap: wrapAndRepeat(new THREE.CanvasTexture(roughnessCanvas)),
        emissiveMap: wrapAndRepeat(new THREE.CanvasTexture(emissiveCanvas)),
    };
}

/**
 * Create PBR textures for mushroom caps
 * Returns: colorMap, normalMap, roughnessMap, emissiveMap
 */
function createMushroomCapPBRTextures() {
    const SIZE = 256;

    const colorCanvas = document.createElement('canvas');
    const normalCanvas = document.createElement('canvas');
    const roughnessCanvas = document.createElement('canvas');
    const emissiveCanvas = document.createElement('canvas');
    const heightCanvas = document.createElement('canvas');

    [colorCanvas, normalCanvas, roughnessCanvas, emissiveCanvas, heightCanvas].forEach(c => {
        c.width = SIZE;
        c.height = SIZE;
    });

    const colorCtx = colorCanvas.getContext('2d');
    const normalCtx = normalCanvas.getContext('2d');
    const roughnessCtx = roughnessCanvas.getContext('2d');
    const emissiveCtx = emissiveCanvas.getContext('2d');
    const heightCtx = heightCanvas.getContext('2d');

    const centerX = SIZE / 2, centerY = SIZE / 2;

    // ─────────────────────────────────────────────────────────────────────────
    // 1. HEIGHT MAP - Radial pattern with gill ridges
    // ─────────────────────────────────────────────────────────────────────────
    // Base dome gradient
    const baseGrad = heightCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, SIZE / 2);
    baseGrad.addColorStop(0, '#ffffff');
    baseGrad.addColorStop(0.5, '#c0c0c0');
    baseGrad.addColorStop(1, '#606060');
    heightCtx.fillStyle = baseGrad;
    heightCtx.fillRect(0, 0, SIZE, SIZE);

    // Gill ridges (radial lines as height variation)
    heightCtx.strokeStyle = 'rgba(100, 100, 100, 0.6)';
    heightCtx.lineWidth = 1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 32) {
        heightCtx.beginPath();
        heightCtx.moveTo(centerX, centerY);
        heightCtx.lineTo(centerX + Math.cos(a) * SIZE / 2, centerY + Math.sin(a) * SIZE / 2);
        heightCtx.stroke();
    }

    // Concentric rings
    heightCtx.strokeStyle = 'rgba(80, 80, 80, 0.4)';
    heightCtx.lineWidth = 2;
    for (let r = 20; r < SIZE / 2; r += 25) {
        heightCtx.beginPath();
        heightCtx.arc(centerX, centerY, r, 0, Math.PI * 2);
        heightCtx.stroke();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. NORMAL MAP from height
    // ─────────────────────────────────────────────────────────────────────────
    const heightData = heightCtx.getImageData(0, 0, SIZE, SIZE);
    const normalData = normalCtx.createImageData(SIZE, SIZE);

    const getHeight = (x, y) => {
        x = ((x % SIZE) + SIZE) % SIZE;
        y = ((y % SIZE) + SIZE) % SIZE;
        return heightData.data[(y * SIZE + x) * 4] / 255;
    };

    const strength = 2.0;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const tl = getHeight(x - 1, y - 1), t = getHeight(x, y - 1), tr = getHeight(x + 1, y - 1);
            const l = getHeight(x - 1, y), r = getHeight(x + 1, y);
            const bl = getHeight(x - 1, y + 1), b = getHeight(x, y + 1), br = getHeight(x + 1, y + 1);

            const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
            const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

            let nx = -dx * strength, ny = -dy * strength, nz = 1.0;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            nx /= len; ny /= len; nz /= len;

            const idx = (y * SIZE + x) * 4;
            normalData.data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
            normalData.data[idx + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
            normalData.data[idx + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
            normalData.data[idx + 3] = 255;
        }
    }
    normalCtx.putImageData(normalData, 0, 0);

    // ─────────────────────────────────────────────────────────────────────────
    // 3. COLOR MAP - Mushroom surface with teal-cyan tones
    // ─────────────────────────────────────────────────────────────────────────
    const colorGrad = colorCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, SIZE / 2);
    colorGrad.addColorStop(0, '#aaffee');   // Bright center
    colorGrad.addColorStop(0.3, '#66ddcc');
    colorGrad.addColorStop(0.7, '#339999');
    colorGrad.addColorStop(1, '#226666');   // Darker edges
    colorCtx.fillStyle = colorGrad;
    colorCtx.fillRect(0, 0, SIZE, SIZE);

    // Subtle spots/speckles
    for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * SIZE / 2 * 0.8;
        const x = centerX + Math.cos(angle) * dist;
        const y = centerY + Math.sin(angle) * dist;
        const r = 2 + Math.random() * 6;
        colorCtx.fillStyle = `rgba(200, 255, 250, ${0.2 + Math.random() * 0.3})`;
        colorCtx.beginPath();
        colorCtx.arc(x, y, r, 0, Math.PI * 2);
        colorCtx.fill();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. ROUGHNESS MAP - Smooth and slightly translucent
    // ─────────────────────────────────────────────────────────────────────────
    roughnessCtx.fillStyle = '#555555'; // Low roughness = slightly glossy
    roughnessCtx.fillRect(0, 0, SIZE, SIZE);

    // ─────────────────────────────────────────────────────────────────────────
    // 5. EMISSIVE MAP - Glowing from within
    // ─────────────────────────────────────────────────────────────────────────
    const emissiveGrad = emissiveCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, SIZE / 2);
    emissiveGrad.addColorStop(0, '#00ffdd');   // Bright glow center
    emissiveGrad.addColorStop(0.4, '#00bbaa');
    emissiveGrad.addColorStop(0.8, '#006655');
    emissiveGrad.addColorStop(1, '#002222');
    emissiveCtx.fillStyle = emissiveGrad;
    emissiveCtx.fillRect(0, 0, SIZE, SIZE);

    return {
        colorMap: new THREE.CanvasTexture(colorCanvas),
        normalMap: new THREE.CanvasTexture(normalCanvas),
        roughnessMap: new THREE.CanvasTexture(roughnessCanvas),
        emissiveMap: new THREE.CanvasTexture(emissiveCanvas),
    };
}


// ─────────────────────────────────────────────────────────────────────────────
// SHADERS
// ─────────────────────────────────────────────────────────────────────────────

// Enhanced Mushroom Shader with subsurface scattering and pattern
const MushroomCapShader = {
    uniforms: {
        uTime: { value: 0 },
        uPulseIntensity: { value: 0 },
        uCapTexture: { value: null },
    },
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec2 vUv;
        varying vec3 vViewDir;
        
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vUv = uv;
            
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            vViewDir = normalize(cameraPosition - worldPos.xyz);
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uPulseIntensity;
        uniform sampler2D uCapTexture;
        
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec2 vUv;
        varying vec3 vViewDir;
        
        void main() {
            // Pulsing glow with time
            float pulse = 0.7 + 0.3 * sin(uTime * 2.0 + vWorldPosition.x * 0.1);
            pulse *= (1.0 + uPulseIntensity * 1.5); // INCREASED for combo visibility
            
            // Subsurface scattering - bright on edges
            float rim = 1.0 - max(0.0, dot(vNormal, vViewDir));
            float sss = pow(rim, 2.0) * 0.8;
            
            // Sample cap texture
            vec4 texColor = texture2D(uCapTexture, vUv);
            
            // Base glow color - vibrant cyan, enhanced during combo
            vec3 glowColor = vec3(0.2, 1.0, 0.9);
            vec3 coreColor = vec3(0.4 + uPulseIntensity * 0.3, 1.0, 1.0);
            
            // Combine: texture + SSS + rim glow
            vec3 color = mix(texColor.rgb, coreColor, sss * 0.5);
            float brightness = (0.5 + sss * 0.5 + rim * 0.3) * pulse;
            
            // Emissive output for bloom - extra boost during combo
            gl_FragColor = vec4(color * brightness * (1.5 + uPulseIntensity * 0.8), 1.0);
        }
    `
};

// Crystal Shader - Bright internal glow with sharp edges
const CrystalShader = {
    uniforms: {
        uTime: { value: 0 },
        uPulseIntensity: { value: 0 },
    },
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying float vHeight;
        
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            vViewDir = normalize(cameraPosition - worldPos.xyz);
            vHeight = position.y;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uPulseIntensity;
        
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec3 vViewDir;
        varying float vHeight;
        
        void main() {
            float pulse = 0.8 + 0.2 * sin(uTime * 1.5 + vWorldPosition.x * 0.05);
            pulse *= (1.0 + uPulseIntensity * 0.4);
            
            // Sharp fresnel rim
            float rim = 1.0 - abs(dot(vNormal, vViewDir));
            rim = pow(rim, 4.0);
            
            // Internal glow increases with height
            float internalGlow = smoothstep(0.0, 1.0, vHeight * 0.02) * 0.7;
            
            // Crystal color palette - bright cyan/teal
            vec3 coreColor = vec3(0.3, 1.0, 0.95);
            vec3 rimColor = vec3(0.6, 1.0, 1.0);
            vec3 baseColor = vec3(0.1, 0.4, 0.45);
            
            vec3 color = mix(baseColor, coreColor, internalGlow);
            color = mix(color, rimColor, rim * 0.8);
            
            // Reduced brightness multiplier to prevent whiteout
            float brightness = (0.3 + internalGlow * 0.7 + rim * 0.5) * pulse * 0.8;
            
            gl_FragColor = vec4(color * brightness, 0.85);
        }
    `
};

// Terrain Shader - Rocky with wet reflective surface
const TerrainShader = {
    uniforms: {
        uTime: { value: 0 },
        uNoiseTexture: { value: null },
    },
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec2 vUv;
        varying vec3 vViewDir;
        
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vUv = uv;
            
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            vViewDir = normalize(cameraPosition - worldPos.xyz);
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform sampler2D uNoiseTexture;
        
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying vec2 vUv;
        varying vec3 vViewDir;
        
        void main() {
            // Sample noise for rock detail
            vec4 noise = texture2D(uNoiseTexture, vUv * 5.0);
            
            // Base rock color - dark blue-gray
            vec3 rockColor = vec3(0.08, 0.12, 0.14) + noise.rgb * 0.1;
            
            // Wet surface reflection
            float fresnel = pow(1.0 - max(0.0, dot(vNormal, vViewDir)), 3.0);
            vec3 reflectionTint = vec3(0.1, 0.3, 0.35);
            
            // Add subtle cyan ambient from nearby mushrooms
            float ambientGlow = sin(vWorldPosition.x * 0.02 + uTime * 0.5) * 0.5 + 0.5;
            vec3 glowTint = vec3(0.0, 0.15, 0.12) * ambientGlow * 0.3;
            
            vec3 color = rockColor + reflectionTint * fresnel * 0.4 + glowTint;
            
            gl_FragColor = vec4(color, 1.0);
        }
    `
};

// Spore Particle Shader
const SporeShader = {
    uniforms: {
        uTime: { value: 0 },
    },
    vertexShader: `
        attribute float size;
        attribute float phase;
        attribute float speed;
        
        uniform float uTime;
        
        varying float vAlpha;
        
        void main() {
            vec3 pos = position;
            
            // Float upward with drift
            float t = mod(uTime * speed * 0.3 + phase, 1.0);
            pos.y += t * 600.0 - 100.0;
            pos.x += sin(uTime * 1.5 + phase * 5.0) * 40.0;
            pos.z += cos(uTime * 1.0 + phase * 3.0) * 30.0;
            
            // Fade based on lifecycle
            vAlpha = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.7, t);
            
            vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
            gl_PointSize = size * (350.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        varying float vAlpha;
        
        void main() {
            vec2 coord = gl_PointCoord - 0.5;
            float dist = length(coord);
            if (dist > 0.5) discard;
            
            float glow = 1.0 - smoothstep(0.0, 0.5, dist);
            glow = pow(glow, 1.5);
            
            vec3 color = vec3(0.2, 0.8, 0.7); // Softer cyan
            
            gl_FragColor = vec4(color * glow * 0.8, vAlpha * glow * 0.7); // Reduced brightness
        }
    `
};


// Contact Ripple Shader - For objects standing in water
const ContactRippleShader = {
    uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x00ffcc) },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;

        void main() {
            // Radial distance from center (UV is 0..1, center 0.5)
            vec2 center = vec2(0.5);
            float dist = length(vUv - center) * 2.0;
            
            if (dist > 1.0) discard;
            
            // Concentric Ripples radiating outwards
            float ripples = sin(dist * 25.0 - uTime * 3.0);
            ripples = smoothstep(0.2, 1.0, ripples); // Sharpen
            
            // Meniscus at center (contact point)
            float meniscus = smoothstep(0.25, 0.0, dist);
            
            // Fade out at edges
            float alpha = (1.0 - dist) * (ripples * 0.4 + meniscus * 0.6);
            
            vec3 color = uColor + meniscus * 0.8;
            
            gl_FragColor = vec4(color, alpha * 0.7);
        }
    `
};

// Shore/Edge Shader - Animated foam and reaction at water edge
const ShoreShader = {
    uniforms: {
        uTime: { value: 0 },
        innerRadius: { value: 0 },
        outerRadius: { value: 0 },
    },
    vertexShader: `
        varying vec2 vUv;
        varying float vDist;
        void main() {
            vUv = uv;
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vDist = length(worldPos.xz);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float innerRadius;
        uniform float outerRadius;
        varying float vDist;
        varying vec2 vUv;

        // Simple hash function
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            // Distance factor: 0 at inner (water), 1 at outer (rock)
            float d = (vDist - innerRadius) / (outerRadius - innerRadius);
            
            // Animated water lapping/foam
            // Use polar coordinates for noise continuity
            float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
            
            // Create a "coastline" wave
            float wave = sin(angle * 10.0 + uTime) * sin(angle * 4.0 - uTime * 0.5);
            float interaction = smoothstep(0.0, 0.4 + wave * 0.1, d); // Wet rock fade
            
            // Foam line
            float foam = sin(d * 40.0 - uTime * 2.0 + wave * 5.0);
            foam = smoothstep(0.7, 1.0, foam) * (1.0 - d);
            
            // Add sparkle/noise
            float sparkle = hash(vec2(vDist * 0.1, uTime * 0.1)) * 0.5;
            
            vec3 foamColor = vec3(0.1, 0.6, 0.7); // Teal foam
            vec3 deepColor = vec3(0.005, 0.015, 0.02);
            
            vec3 color = mix(foamColor, deepColor, interaction);
            color += vec3(0.5, 0.9, 0.9) * foam * 0.5; // Bright foam highlights
            color += vec3(1.0) * sparkle * foam * 0.3; // Sparkles
            
            // Alpha fade
            float alpha = (1.0 - d) * 0.8;
            
            gl_FragColor = vec4(color, alpha);
        }
    `
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Theme Class
// ─────────────────────────────────────────────────────────────────────────────
export default class BioluminescenceTheme extends BaseTheme {
    constructor() {
        super('bioluminescence');

        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.composer = null;
        this.clock = new THREE.Clock();
        this.time = 0;

        this.mushrooms = [];
        this.crystalClusters = [];
        this.spores = null;
        this.mushrooms = [];
        this.crystalClusters = [];
        this.spores = null;
        this.terrain = null;
        this.water = null;
        this.caveWalls = [];
        this.vines = [];
        this.lightCones = [];
        this.contactRipples = [];
        this.shoreRing = null;

        this.pulseIntensity = 0;
        this.eventUnsubscribers = [];
        this.qualityPreset = QUALITY_PRESETS.High;

        // Textures
        this.caveRockTextures = null;
        this.mushroomCapTextures = null;
    }

    getTetrominoConfig() {
        return BIOLUMINESCENCE_TETROMINOS;
    }

    getCurrentQualityLevel() {
        if (typeof window !== 'undefined' && window.settings?.effectQuality) {
            return normalizeQuality(window.settings.effectQuality);
        }
        return 'High';
    }

    applyQualityPreset(quality) {
        this.qualityPreset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.High;
        console.log(`🍄 Bioluminescence: Applying ${quality} preset`);
    }

    async createScene() {
        if (typeof document === 'undefined') return;

        this.applyQualityPreset(this.getCurrentQualityLevel());

        const container = document.getElementById('bioluminescence-theme');
        if (!container) {
            console.error('🍄 Bioluminescence: Container not found');
            return;
        }

        // Create PBR textures
        this.caveRockTextures = createCaveRockPBRTextures();
        this.mushroomCapTextures = createMushroomCapPBRTextures();
        this.vineTextures = createVinePBRTextures();

        this.initRenderer(container);
        this.createCaveEnvironment();
        this.createTerrain();
        this.createMushrooms();
        this.createCrystalClusters();
        this.createSporeSystem();
        this.createVines();
        this.setupLighting();
        this.setupPostProcessing();
        this.setupEventListeners();

        console.log('🍄 Bioluminescence: Scene created with', this.mushrooms.length, 'mushrooms,', this.crystalClusters.length, 'crystal clusters');
        this.startAnimation();
    }

    initRenderer(container) {
        const w = window.innerWidth;
        const h = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0; // Reduced from 1.5 to prevent washout
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
        this.registerContainer(container);

        this.scene = new THREE.Scene();

        // Atmospheric fog - very dark for cave feel
        const fogColor = new THREE.Color(0x020505); // Near black fog
        this.scene.fog = new THREE.FogExp2(fogColor, 0.0003);
        this.scene.background = null;  // Let background sphere shader render!

        // Camera - immersive view into the cave
        this.camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 3000);
        this.camera.position.set(0, 40, 180);
        this.camera.lookAt(0, -20, -150);

        // Create atmospheric background and volumetric effects
        this.createAtmosphericBackground();
        this.createVolumetricLightCones();
    }

    createAtmosphericBackground() {
        // STUNNING bioluminescent nebula background
        const bgGeo = new THREE.SphereGeometry(2500, 64, 48);
        const bgMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec3 vWorldPos;
                varying vec2 vUv;
                void main() {
                    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec3 vWorldPos;
                varying vec2 vUv;
                
                // NO noise or fbm - completely smooth functions only
                
                void main() {
                    float y = normalize(vWorldPos).y;
                    float angle = atan(vWorldPos.x, vWorldPos.z);
                    float time = uTime * 0.02;
                    
                    // PURE BLACK CAVE VOID - absolute darkness
                    vec3 pureBlack = vec3(0.0, 0.0, 0.0);
                    vec3 veryDarkTeal = vec3(0.0, 0.008, 0.01);
                    
                    // Very subtle vertical gradient
                    vec3 color = mix(pureBlack, veryDarkTeal, smoothstep(-0.8, 0.2, y) * 0.5);
                    
                    // VERY FAINT AURORA (barely visible)
                    float aurora1 = sin(angle * 2.0 + y * 5.0 + time * 0.5);
                    float aurora2 = sin(angle * 3.0 - y * 3.0 + time * 0.3);
                    float aurora = (aurora1 * 0.5 + aurora2 * 0.5) * 0.5 + 0.5;
                    aurora = pow(aurora, 8.0) * 0.03;
                    aurora *= smoothstep(-0.3, 0.2, y) * smoothstep(0.5, -0.1, y);
                    color += vec3(0.0, 0.06, 0.05) * aurora;
                    
                    // VERY FAINT NEBULA BANDS
                    float band1 = sin(angle * 1.5 + time * 0.2) * sin(y * 8.0 + time * 0.1);
                    band1 = max(0.0, band1) * 0.015;
                    color += vec3(0.0, 0.02, 0.03) * band1;
                    
                    // VERY SUBTLE GLOW PILLARS (near floor only)
                    float pillar = sin(angle * 4.0 + time * 0.1);
                    pillar = pow(max(0.0, pillar), 24.0) * 0.02;
                    pillar *= smoothstep(0.2, -0.6, y);
                    color += vec3(0.0, 0.03, 0.025) * pillar;
                    
                    // VERY FAINT HORIZON GLOW
                    float horizonBloom = exp(-abs(y) * 12.0) * 0.015;
                    color += vec3(0.0, 0.04, 0.03) * horizonBloom;
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            fog: false,
        });
        this.backgroundSphere = new THREE.Mesh(bgGeo, bgMat);
        this.scene.add(this.backgroundSphere);
    }

    createVolumetricLightCones() {
        // Create visible light shafts from ceiling - "god rays"
        this.lightCones = [];
        const coneCount = 6;

        for (let i = 0; i < coneCount; i++) {
            const angle = (i / coneCount) * Math.PI * 2;
            const dist = 200 + Math.random() * 150;
            const x = Math.sin(angle) * dist;
            const z = Math.cos(angle) * dist - 100;

            // Tall cone coming down from ceiling
            const height = 300 + Math.random() * 150;
            const radius = 40 + Math.random() * 30;

            const coneGeo = new THREE.ConeGeometry(radius, height, 16, 1, true);
            const coneMat = new THREE.MeshBasicMaterial({
                color: 0x20aa99, // Darker cyan
                transparent: true,
                opacity: 0.03, // Much dimmer
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.set(x, 150 + height / 2, z);
            cone.rotation.x = Math.PI; // Point downward

            this.scene.add(cone);
            this.lightCones.push({ mesh: cone, phase: Math.random() * Math.PI * 2, baseOpacity: 0.08 });
        }
    }

    createCaveEnvironment() {
        // Only keep back wall, remove blocking ceiling
        // Back wall - glowing cave wall with bioluminescent veins
        const wallGeo = new THREE.PlaneGeometry(2400, 800, 64, 32);
        // Add displacement
        const wallPos = wallGeo.attributes.position;
        for (let i = 0; i < wallPos.count; i++) {
            const x = wallPos.getX(i);
            const y = wallPos.getY(i);
            const noise = Math.sin(x * 0.02) * Math.cos(y * 0.03) * 40 +
                Math.sin(x * 0.05 + y * 0.02) * 20;
            wallPos.setZ(i, noise);
        }
        wallGeo.computeVertexNormals();

        // Self-illuminating cave wall shader
        const wallMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;
                void main() {
                    vUv = uv;
                    vNormal = normalMatrix * normal;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                varying vec2 vUv;
                varying vec3 vNormal;
                
                // NO noise - smooth functions only
                
                void main() {
                    // Base rock color - VERY DARK for cave
                    vec3 rock = vec3(0.02, 0.04, 0.05);
                    
                    // Glowing bioluminescent veins (smooth sin waves)
                    float vein1 = sin(vUv.x * 20.0 + vUv.y * 5.0 + uTime * 0.2);
                    float vein2 = sin(vUv.x * 8.0 - vUv.y * 15.0 - uTime * 0.15);
                    float veins = pow(max(0.0, vein1 * vein2), 2.0);
                    
                    // Pulsing glow spots (smooth sin pattern instead of noise)
                    float spots = sin(vUv.x * 25.0) * sin(vUv.y * 18.0 + uTime * 0.5);
                    spots = pow(max(0.0, spots), 12.0) * (0.8 + 0.2 * sin(uTime * 2.0));
                    
                    vec3 color = rock;
                    color += vec3(0.0, 0.35, 0.30) * veins * 0.4;
                    color += vec3(0.1, 0.5, 0.45) * spots * 0.8;
                    
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });
        const backWall = new THREE.Mesh(wallGeo, wallMat);
        backWall.position.set(0, 150, -600);
        this.scene.add(backWall);
        this.caveWalls.push(backWall);
    }

    // Helper to get terrain height at any X, Z coordinate
    getTerrainHeight(x, z) {
        // Must match the noise logic in createTerrain
        // Multi-octave noise
        let height = 0;
        height += Math.sin(x * 0.015) * Math.cos(z * 0.015) * 25;
        height += Math.sin(x * 0.04 + 1.5) * Math.cos(z * 0.035) * 12;
        height += Math.sin(x * 0.08 + 2.3) * Math.cos(z * 0.07) * 6;

        // Flatten center area for the pool
        const dist = Math.sqrt(x * x + z * z);
        if (dist < 220) {
            const smooth = this.smoothstep(220, 180, dist);
            height = height * (1.0 - smooth) - 5 * smooth; // Dip slightly in center
        }

        return height - 50; // Base Y position
    }

    createTerrain() {
        // Main terrain with GLOWING shader material
        const geo = new THREE.PlaneGeometry(1400, 1400, 128, 128);

        // Displacement for rocky terrain matches getTerrainHeight logic
        const pos = geo.attributes.position;
        const uv = geo.attributes.uv;

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getY(i); // Plane is initially XY, so Z is Y here before rotation? 
            // Wait, PlaneGeometry is XY. We rotate X by -PI/2 later.
            // So local Y becomes World -Z. Local X becomes World X.
            // Let's use standard X, Y (which map to X, -Z in world)

            // Actually, let's keep it simple. Vertex shader handles position usually, 
            // but we need CPU access for placement.
            // Let's assume standard UV mapping.

            // To match getTerrainHeight(x, z) where x,z are world coords:
            // The plane is centered at 0,0. width/height=1400.
            // x runs -700 to 700. y runs -700 to 700.

            // Apply noise to Z (which becomes Y height after rotation)
            let height = 0;
            // Note: PlaneGeometry vertices are (x, y, 0).
            // We want height function h(x, y) applied to z.
            // Then rotate -90 deg X => (x, z, -y) -> (x, height, -y) NO.
            // Rotate -90 deg X: (x, y, z) -> (x, z, -y).
            // So if we modify z (which is 0), it becomes y (up).
            // So we set Z = height.
            // World coordinate mapping: WorldX = LocalX. WorldZ = -LocalY.

            // Let's align noise inputs:
            const worldX = x;
            const worldZ = -pos.getY(i); // Mapping local Y to world Z

            height += Math.sin(worldX * 0.015) * Math.cos(worldZ * 0.015) * 25;
            height += Math.sin(worldX * 0.04 + 1.5) * Math.cos(worldZ * 0.035) * 12;
            height += Math.sin(worldX * 0.08 + 2.3) * Math.cos(worldZ * 0.07) * 6;

            // Flatten center area for the pool
            const dist = Math.sqrt(worldX * worldX + worldZ * worldZ);
            if (dist < 220) {
                const smooth = this.smoothstep(220, 180, dist);
                height = height * (1.0 - smooth) - 5 * smooth;
            }

            pos.setZ(i, height);
        }
        geo.computeVertexNormals();

        // Generate UV2 for AO map (required by MeshStandardMaterial)
        geo.setAttribute('uv2', geo.attributes.uv.clone());

        // PBR Rock Material using procedural textures
        const terrainMat = new THREE.MeshStandardMaterial({
            map: this.caveRockTextures.colorMap,
            normalMap: this.caveRockTextures.normalMap,
            normalScale: new THREE.Vector2(2.0, 2.0), // Stronger normal for more depth
            roughnessMap: this.caveRockTextures.roughnessMap,
            roughness: 0.85, // Base roughness
            aoMap: this.caveRockTextures.aoMap,
            aoMapIntensity: 1.2, // Stronger AO for cave depth
            emissiveMap: this.caveRockTextures.emissiveMap,
            emissive: 0x00aa88, // Teal glow
            emissiveIntensity: 0.15, // Subtle bioluminescent glow
            metalness: 0.0,
            envMapIntensity: 0.3, // Slight environment reflection
        });

        this.terrain = new THREE.Mesh(geo, terrainMat);
        this.terrain.rotation.x = -Math.PI / 2;
        this.terrain.position.y = -50;
        this.scene.add(this.terrain);

        // Advanced Water - CIRCULAR pool for soft edges
        const waterRadius = 190;
        const waterGeo = new THREE.CircleGeometry(waterRadius, 64);

        // Load water normals - using a procedural approach if texture not available, 
        // but Water shader needs a texture usually. We'll use the rock normal map as a placeholder distorter
        // or a procedural noise texture if available. 
        // Let's try to generate a normal map on the fly or use 'caveRockTextures.normalMap'.
        // Actually, Water.js requires a specific texture format optionally but works best with one.
        // We'll use the existing normal map we generated for fallback.

        this.water = new Water(waterGeo, {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: this.caveRockTextures.normalMap, // Reuse procedural normal map
            sunDirection: new THREE.Vector3(),
            sunColor: 0xffffff,
            waterColor: 0x001e0f,
            distortionScale: 3.7,
            fog: this.scene.fog !== undefined
        });

        this.water.rotation.x = -Math.PI / 2;
        this.water.position.set(0, -52, 0); // Slightly below terrain center
        this.scene.add(this.water);

        // SHORE RING - Animated reaction at edges
        const edgeFadeGeo = new THREE.RingGeometry(waterRadius - 10, waterRadius + 20, 128); // Higher segment count for detailed shader
        const edgeFadeMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                innerRadius: { value: waterRadius - 10 },
                outerRadius: { value: waterRadius + 20 },
            },
            vertexShader: ShoreShader.vertexShader,
            fragmentShader: ShoreShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending, // Glow effect
        });
        const edgeFade = new THREE.Mesh(edgeFadeGeo, edgeFadeMat);
        edgeFade.rotation.x = -Math.PI / 2;
        edgeFade.position.set(0, -51.5, 0); // Slightly above water
        this.scene.add(edgeFade);
        this.shoreRing = edgeFade;
    }

    createContactRipple(x, z, scale = 1.0) {
        // Create a ripple effect at water level
        const geo = new THREE.PlaneGeometry(16 * scale, 16 * scale);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: Math.random() * 10 }, // Random offset
                uColor: { value: new THREE.Color(0x00ffcc) },
            },
            vertexShader: ContactRippleShader.vertexShader,
            fragmentShader: ContactRippleShader.fragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });

        const ripple = new THREE.Mesh(geo, mat);
        ripple.rotation.x = -Math.PI / 2;
        ripple.position.set(x, -51.8, z); // Just above water

        this.scene.add(ripple);
        this.contactRipples.push(ripple);
        return ripple;
    }

    // Add smoothstep helper for JS
    smoothstep(min, max, value) {
        const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
        return x * x * (3 - 2 * x);
    }

    createMushrooms() {
        const count = this.qualityPreset.mushroomCount;

        for (let i = 0; i < count; i++) {
            this.createMushroom(
                (Math.random() - 0.5) * 800,
                (Math.random() - 0.5) * 600 - 100
            );
        }
    }

    createMushroom(x, z) {
        const group = new THREE.Group();

        // Get height from terrain
        const y = this.getTerrainHeight(x, z);

        // Random size variation
        const scale = 0.6 + Math.random() * 0.8;
        const height = 20 + Math.random() * 30;
        const capRadius = 15 + Math.random() * 20;

        // Stem - tapered cylinder
        const stemGeo = new THREE.CylinderGeometry(
            capRadius * 0.15 * scale,  // top
            capRadius * 0.25 * scale,  // bottom
            height * scale,
            12
        );
        const stemMat = new THREE.MeshStandardMaterial({
            color: 0x3a6565,
            roughness: 0.7,
            metalness: 0.0,
            emissive: 0x0a2020,
            emissiveIntensity: 0.2, // Reduced
        });
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.y = height * scale * 0.5;
        group.add(stem);

        // Cap with PBR textures
        const capGeo = new THREE.SphereGeometry(
            capRadius * scale,
            24, 16,
            0, Math.PI * 2,
            0, Math.PI * 0.5  // Top hemisphere only
        );
        // Scale to make it flatter like a mushroom cap
        capGeo.scale(1.3, 0.5, 1.3);

        // PBR Material with mushroom cap textures
        const tex = this.mushroomCapTextures;
        const capMat = new THREE.MeshStandardMaterial({
            map: tex.colorMap,
            normalMap: tex.normalMap,
            normalScale: new THREE.Vector2(1.0, 1.0),
            roughnessMap: tex.roughnessMap,
            emissiveMap: tex.emissiveMap,
            emissive: 0x00ffee,
            emissiveIntensity: 0.4, // Reduced from 0.9 to prevent blinding
            side: THREE.DoubleSide,
        });

        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = height * scale;  // On top of stem
        group.add(cap);

        // Gill underside (darker disc under cap)
        const gillGeo = new THREE.CircleGeometry(capRadius * scale * 1.1, 24);
        const gillMat = new THREE.MeshStandardMaterial({
            color: 0x226666,
            emissive: 0x004444,
            emissiveIntensity: 0.3,
            side: THREE.DoubleSide,
        });
        const gills = new THREE.Mesh(gillGeo, gillMat);
        gills.rotation.x = Math.PI / 2;
        gills.position.y = height * scale - 1;
        group.add(gills);

        // Position in world
        group.position.set(x, y, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        group.rotation.z = (Math.random() - 0.5) * 0.15; // Slight tilt

        this.scene.add(group);
        // No PointLight - rely on emissive materials for performance
        this.mushrooms.push({ group, cap, phase: Math.random() * Math.PI * 2 });

        // Add water ripple if in water
        if (y < -52 && y > -80) { // -52 is water level
            this.createContactRipple(x, z, scale * 1.5);
        }
    }

    createCrystalClusters() {
        const count = this.qualityPreset.crystalClusterCount;

        // Place clusters at edges and back
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI - Math.PI / 2; // Arc behind
            const dist = 250 + Math.random() * 150;
            const x = Math.sin(angle) * dist;
            const z = -200 + Math.cos(angle) * dist * 0.6;

            this.createCrystalCluster(x, z);
        }
    }

    createCrystalCluster(x, z) {
        const group = new THREE.Group();
        const crystalCount = 4 + Math.floor(Math.random() * 5);

        // Get height from terrain
        const y = this.getTerrainHeight(x, z);

        const crystalMat = new THREE.ShaderMaterial({
            uniforms: CrystalShader.uniforms,
            vertexShader: CrystalShader.vertexShader,
            fragmentShader: CrystalShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        for (let i = 0; i < crystalCount; i++) {
            const height = 40 + Math.random() * 80;
            const radius = 6 + Math.random() * 8;

            // Elongated hexagonal prism
            const geo = new THREE.CylinderGeometry(
                radius * 0.3,  // top - pointed
                radius,        // bottom
                height,
                6              // hexagonal
            );

            const crystal = new THREE.Mesh(geo, crystalMat.clone());

            // Position within cluster
            const offsetAngle = (i / crystalCount) * Math.PI * 2;
            const offsetDist = Math.random() * 25;
            crystal.position.set(
                Math.cos(offsetAngle) * offsetDist,
                height / 2,
                Math.sin(offsetAngle) * offsetDist
            );

            // Random tilt for natural look
            crystal.rotation.x = (Math.random() - 0.5) * 0.3;
            crystal.rotation.z = (Math.random() - 0.5) * 0.3;

            group.add(crystal);
        }

        group.position.set(x, y, z);
        this.scene.add(group);
        // No PointLight - rely on emissive crystal shader for performance
        this.crystalClusters.push({ group, phase: Math.random() * Math.PI * 2 });

        // Add water ripple if in water
        if (y < -52 && y > -80) {
            this.createContactRipple(x, z, 2.0);
        }
    }

    createSporeSystem() {
        const count = this.qualityPreset.sporeCount;

        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 1000;
            positions[i * 3 + 1] = Math.random() * 400 - 100;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 800 - 100;

            sizes[i] = 8 + Math.random() * 16; // Larger particles to avoid grain look
            phases[i] = Math.random();
            speeds[i] = 0.3 + Math.random() * 0.7;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

        const mat = new THREE.ShaderMaterial({
            uniforms: SporeShader.uniforms,
            vertexShader: SporeShader.vertexShader,
            fragmentShader: SporeShader.fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        this.spores = new THREE.Points(geo, mat);
        this.scene.add(this.spores);
    }

    createVines() {
        // Hanging glowing vines from the TOP of the screen
        const vineCount = 8; // Reduced for performance
        this.vineData = []; // Store vine data for animation

        for (let i = 0; i < vineCount; i++) {
            // Spread vines across screen width, all from TOP
            const startX = (Math.random() - 0.5) * 1000;
            const startZ = (Math.random() - 0.5) * 400 - 150;
            const length = 200 + Math.random() * 300;
            const segments = 12 + Math.floor(Math.random() * 6);
            const thickness = 1.0 + Math.random() * 1.5;

            // Create initial vine path - hanging from VERY TOP
            const basePoints = [];
            for (let j = 0; j <= segments; j++) {
                const t = j / segments;
                // Natural curve with gravity sag
                const sagFactor = Math.pow(t, 1.5);
                const x = startX + Math.sin(t * Math.PI * 1.5 + i * 0.5) * 30 * t;
                const y = 450 - sagFactor * length; // Start from 450 (above camera view)
                const z = startZ + Math.cos(t * Math.PI + i * 0.3) * 20 * t;
                basePoints.push({ x, y, z, t });
            }

            // Store vine data for animation
            const vineInfo = {
                basePoints: basePoints,
                startX: startX,
                startZ: startZ,
                length: length,
                segments: segments,
                thickness: thickness,
                phase: Math.random() * Math.PI * 2,
                speed: 0.3 + Math.random() * 0.4,
                mesh: null,
                curve: null,
                orbs: [],
            };

            // Create initial curve and geometry
            const points = basePoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
            const curve = new THREE.CatmullRomCurve3(points);
            const tubeGeo = new THREE.TubeGeometry(curve, segments * 4, thickness, 8, false);

            // PBR vine material with procedural textures
            const vineMat = new THREE.MeshStandardMaterial({
                map: this.vineTextures.colorMap,
                normalMap: this.vineTextures.normalMap,
                normalScale: new THREE.Vector2(1.5, 1.5),
                roughnessMap: this.vineTextures.roughnessMap,
                roughness: 0.8,
                emissiveMap: this.vineTextures.emissiveMap,
                emissive: 0x00aa88,
                emissiveIntensity: 0.15,
                metalness: 0.0,
            });

            const vine = new THREE.Mesh(tubeGeo, vineMat);
            this.scene.add(vine);
            vineInfo.mesh = vine;
            vineInfo.curve = curve;

            // Add glow orbs along the vine - store t values for animation
            const orbCount = 2 + Math.floor(Math.random() * 2); // Reduced count
            for (let j = 0; j < orbCount; j++) {
                const orbT = (j + 0.5) / orbCount;
                const pos = curve.getPoint(orbT);

                const orbGeo = new THREE.SphereGeometry(2.5 + Math.random() * 2, 8, 6); // Simpler geometry
                const orbMat = new THREE.MeshStandardMaterial({
                    color: 0x00ddbb,
                    emissive: 0x00ffcc,
                    emissiveIntensity: 0.6, // Increased to compensate for no light
                    roughness: 0.3,
                });
                const orb = new THREE.Mesh(orbGeo, orbMat);
                orb.position.copy(pos);
                this.scene.add(orb);

                // No PointLight for performance - emissive material provides glow
                vineInfo.orbs.push({ mesh: orb, t: orbT });
            }

            this.vineData.push(vineInfo);
            this.vines.push({ mesh: vine, phase: vineInfo.phase });
        }
    }

    // Update vines with swaying animation (OPTIMIZED - no geometry recreation)
    updateVines(time) {
        if (!this.vineData) return;

        for (const vine of this.vineData) {
            // Calculate sway based on time
            const swayX = Math.sin(time * vine.speed + vine.phase) * 0.03;
            const swayZ = Math.cos(time * vine.speed * 0.7 + vine.phase) * 0.02;

            // Apply rotation to simulate sway (much cheaper than geometry recreation)
            vine.mesh.rotation.x = swayZ;
            vine.mesh.rotation.z = swayX;

            // Update orb positions with sway offset (they follow the swing)
            for (const orb of vine.orbs) {
                const basePos = vine.curve.getPoint(orb.t);
                const swayAmount = orb.t * orb.t; // More sway at bottom
                const swayOffsetX = Math.sin(time * vine.speed + vine.phase) * 15 * swayAmount;
                const swayOffsetZ = Math.cos(time * vine.speed * 0.7 + vine.phase) * 10 * swayAmount;

                orb.mesh.position.set(
                    basePos.x + swayOffsetX,
                    basePos.y,
                    basePos.z + swayOffsetZ
                );
                // No light to update - removed for performance
            }
        }
    }

    setupLighting() {
        // HemisphereLight - balanced teal ground, darker sky
        const hemiLight = new THREE.HemisphereLight(0x30aaaa, 0x103030, 0.4); // Reduced from 0.8
        this.scene.add(hemiLight);

        // Ambient light - softer
        this.scene.add(new THREE.AmbientLight(0x206060, 0.2)); // Reduced from 0.6

        // Key cyan light from front
        const keyLight = new THREE.DirectionalLight(0x00ddcc, 0.3); // Reduced from 0.6
        keyLight.position.set(0, 50, 150);
        this.scene.add(keyLight);

        // Fill light from side
        const fillLight = new THREE.DirectionalLight(0x40aaaa, 0.2); // Reduced from 0.4
        fillLight.position.set(-200, 30, 0);
        this.scene.add(fillLight);

        // Rim light from back for depth
        const rimLight = new THREE.DirectionalLight(0x00aacc, 0.2); // Reduced from 0.3
        rimLight.position.set(0, 100, -300);
        this.scene.add(rimLight);

        // Scattered point lights - softer and fewer
        const glowColors = [0x00ffcc, 0x00ddff, 0x44ffaa, 0x80ffee];
        for (let i = 0; i < 5; i++) { // Reduced count back to 5
            const light = new THREE.PointLight(
                glowColors[i % glowColors.length],
                0.3, // Reduced from 0.7
                400
            );
            light.position.set(
                (Math.random() - 0.5) * 700,
                Math.random() * 80 + 20,
                (Math.random() - 0.5) * 500 - 100
            );
            this.scene.add(light);
        }
    }

    setupPostProcessing() {
        if (!this.qualityPreset.enablePost) return;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // Strong bloom for that bioluminescent glow - higher threshold for dark background
        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.qualityPreset.bloomStrength,
            0.2,   // radius (reduced)
            0.9    // threshold (increased - only very bright things bloom)
        );
        this.composer.addPass(bloomPass);
    }

    setupEventListeners() {
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleLineClear(data);
            }
        });

        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handleCombo(data);
            }
        });

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, () => {
            if (this.isActive) {
                this.pulseIntensity = Math.min(this.pulseIntensity + 0.2, 0.8);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);

        window.addEventListener('resize', () => this.resize(window.innerWidth, window.innerHeight));
    }

    handleLineClear(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? 0;
        this.pulseIntensity = Math.min(0.5 + comboCount * 0.15, 1.5);
    }

    handleCombo(eventPayload) {
        const detail = eventPayload?.detail || eventPayload || {};
        const comboCount = detail.comboCount ?? detail.combo ?? 0;
        if (comboCount > 0) {
            this.pulseIntensity = Math.min(this.pulseIntensity + 0.25, 1.5);
        }
    }

    startAnimation() {
        const animate = () => {
            if (!this.isActive) return;

            const delta = this.clock.getDelta();
            this.time += delta;

            // Decay pulse
            this.pulseIntensity *= 0.97;

            // Update mushroom caps - pulse emissive intensity for combo glow
            for (const mushroom of this.mushrooms) {
                // Update emissive intensity for combo glow (MeshStandardMaterial)
                const basePulse = 0.4 + 0.1 * Math.sin(this.time * 2.0 + mushroom.phase);
                const comboBoost = this.pulseIntensity * 1.5; // Strong combo boost
                mushroom.cap.material.emissiveIntensity = basePulse + comboBoost;

                // Gentle mushroom swaying
                const swayX = Math.sin(this.time * 0.4 + mushroom.phase) * 0.015;
                const swayZ = Math.cos(this.time * 0.3 + mushroom.phase * 1.5) * 0.012;
                mushroom.group.rotation.x = swayX;
                mushroom.group.rotation.z = swayZ;
            }

            // Update crystal clusters
            for (const cluster of this.crystalClusters) {
                // Update all crystal materials in group
                cluster.group.traverse((child) => {
                    if (child.material && child.material.uniforms) {
                        child.material.uniforms.uTime.value = this.time;
                        child.material.uniforms.uPulseIntensity.value = this.pulseIntensity;
                    }
                });
                // Crystal light removed for performance - rely on emissive shader
            }

            // Terrain now uses PBR MeshStandardMaterial (no shader uniforms)

            // Update vines with swaying animation
            this.updateVines(this.time);

            // Update spores
            if (this.spores) {
                this.spores.material.uniforms.uTime.value = this.time;
            }

            // Update atmospheric background
            if (this.backgroundSphere && this.backgroundSphere.material.uniforms) {
                this.backgroundSphere.material.uniforms.uTime.value = this.time;
            }

            // Update cave walls shader
            for (const wall of this.caveWalls) {
                if (wall.material.uniforms) {
                    wall.material.uniforms.uTime.value = this.time;
                }
            }

            // Update shore ring
            if (this.shoreRing && this.shoreRing.material.uniforms) {
                this.shoreRing.material.uniforms.uTime.value = this.time;
            }

            // Update contact ripples
            for (const ripple of this.contactRipples) {
                ripple.material.uniforms.uTime.value = this.time;
            }

            // Update water
            if (this.water) {
                this.water.material.uniforms['time'].value += 1.0 / 60.0;
            }

            // Animate vines - gentle swaying
            for (const vine of this.vines) {
                const sway = Math.sin(this.time * 0.8 + vine.phase) * 0.03;
                vine.mesh.rotation.x = sway;
                vine.mesh.rotation.z = Math.cos(this.time * 0.6 + vine.phase) * 0.02;
            }

            // Animate volumetric light cones - subtle pulsing
            for (const cone of this.lightCones) {
                const pulse = 0.7 + 0.3 * Math.sin(this.time * 0.5 + cone.phase);
                cone.mesh.material.opacity = cone.baseOpacity * pulse;
            }

            // Render
            if (this.composer) {
                this.composer.render();
            } else {
                this.renderer.render(this.scene, this.camera);
            }

            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    resize(w, h) {
        if (!this.renderer || !this.camera) return;

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);

        if (this.composer) {
            this.composer.setSize(w, h);
        }
    }

    stop() {
        super.stop();

        this.eventUnsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') unsub();
        });
        this.eventUnsubscribers = [];
    }

    cleanup() {
        this.stop();

        // Dispose mushrooms
        for (const mushroom of this.mushrooms) {
            mushroom.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.scene.remove(mushroom.group);
        }
        this.mushrooms = [];

        // Dispose crystal clusters
        for (const cluster of this.crystalClusters) {
            cluster.group.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.scene.remove(cluster.group);
        }
        this.crystalClusters = [];

        // Dispose spores
        if (this.spores) {
            this.spores.geometry.dispose();
            this.spores.material.dispose();
            this.scene.remove(this.spores);
        }

        // Dispose terrain
        if (this.terrain) {
            this.terrain.geometry.dispose();
            this.terrain.material.dispose();
            this.scene.remove(this.terrain);
        }

        // Dispose cave walls
        for (const wall of this.caveWalls) {
            wall.geometry.dispose();
            wall.material.dispose();
            this.scene.remove(wall);
        }
        this.caveWalls = [];

        // Dispose contact ripples
        for (const ripple of this.contactRipples) {
            ripple.geometry.dispose();
            ripple.material.dispose();
            this.scene.remove(ripple);
        }
        this.contactRipples = [];

        // Dispose shore ring
        if (this.shoreRing) {
            this.shoreRing.geometry.dispose();
            this.shoreRing.material.dispose();
            this.scene.remove(this.shoreRing);
        }

        // Dispose textures
        if (this.capTexture) this.capTexture.dispose();
        if (this.noiseTexture) this.noiseTexture.dispose();

        // Dispose renderer
        if (this.renderer) this.renderer.dispose();
        if (this.composer) this.composer.dispose();

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.composer = null;

        super.cleanup();
    }
}
