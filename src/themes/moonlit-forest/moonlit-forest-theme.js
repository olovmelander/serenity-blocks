/**
 * @fileoverview Moonlit Forest Theme - Mystical forest with procedural trees, glowing mushrooms, and moonbeams
 */

import { BaseTheme } from '../base-theme.js';
import { moonlitForestTreeCache } from '../../utils/cache.js';
import { MOONLIT_FOREST_TETROMINOS } from './moonlit-forest-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * Moonlit Forest Theme
 * Features:
 * - Procedurally generated trees with parallax layers
 * - Glowing mushrooms
 * - Moonbeams
 * - Wildlife (glowing eyes, flying owl)
 * - Falling leaves
 */
export default class MoonlitForestTheme extends BaseTheme {
    constructor() {
        super('moonlit-forest');
        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        this.mushrooms = [];
        this.moonbeams = [];
        this.eyes = [];
        this.leaves = [];
        this.qualityConfig = null;
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    /**
     * Get quality setting from game settings
     */
    getQualitySetting() {
        if (typeof window !== 'undefined' && window.settings) {
            const quality = window.settings.effectQuality || 'High';
            return quality.toLowerCase();
        }
        return 'high';
    }

    /**
     * Get quality-specific configuration for Moonlit Forest
     * Balanced presets from Minimal to Extreme for optimal visual quality and performance
     */
    getQualityConfig(quality) {
        const configs = {
            minimal: {
                trees: { back: 5, mid: 4, front: 3 },      // Sparse forest
                leaves: 5,                                   // Minimal falling leaves
                mushrooms: 5,                               // Few DOM mushrooms (canvas mushrooms scale with trees)
                moonbeams: 2,                               // Just a couple of beams
                eyes: 1,                                    // Single glowing eyes
                fireflies: 3,                               // Very few ambient fireflies
                comboEffects: {
                    fireflyMultiplier: 0.2,                 // Minimal combo effects
                    sporesMultiplier: 0.2,
                    wispsMultiplier: 0,                     // No wisps
                    auroraEnabled: false,                   // No aurora
                    shootingStarsEnabled: false,            // No shooting stars
                },
            },
            low: {
                trees: { back: 10, mid: 8, front: 6 },     // Light forest
                leaves: 12,
                mushrooms: 10,
                moonbeams: 3,
                eyes: 2,
                fireflies: 8,
                comboEffects: {
                    fireflyMultiplier: 0.4,
                    sporesMultiplier: 0.4,
                    wispsMultiplier: 0.3,                   // Minimal wisps
                    auroraEnabled: false,
                    shootingStarsEnabled: false,
                },
            },
            medium: {
                trees: { back: 15, mid: 12, front: 8 },    // Balanced forest
                leaves: 25,
                mushrooms: 15,
                moonbeams: 5,
                eyes: 3,
                fireflies: 15,
                comboEffects: {
                    fireflyMultiplier: 0.65,
                    sporesMultiplier: 0.65,
                    wispsMultiplier: 0.65,
                    auroraEnabled: true,                    // Aurora enabled from medium
                    shootingStarsEnabled: false,
                },
            },
            high: {
                trees: { back: 20, mid: 16, front: 11 },   // Dense forest
                leaves: 40,
                mushrooms: 22,
                moonbeams: 7,
                eyes: 5,
                fireflies: 22,
                comboEffects: {
                    fireflyMultiplier: 0.85,
                    sporesMultiplier: 0.85,
                    wispsMultiplier: 0.85,
                    auroraEnabled: true,
                    shootingStarsEnabled: true,             // Shooting stars from high
                },
            },
            ultra: {
                trees: { back: 26, mid: 20, front: 14 },   // Very dense forest
                leaves: 60,
                mushrooms: 30,
                moonbeams: 9,
                eyes: 7,
                fireflies: 30,
                comboEffects: {
                    fireflyMultiplier: 1.1,
                    sporesMultiplier: 1.1,
                    wispsMultiplier: 1.1,
                    auroraEnabled: true,
                    shootingStarsEnabled: true,
                },
            },
            extreme: {
                trees: { back: 35, mid: 28, front: 18 },   // Maximum density forest
                leaves: 85,
                mushrooms: 45,
                moonbeams: 12,
                eyes: 10,
                fireflies: 45,
                comboEffects: {
                    fireflyMultiplier: 1.5,                 // Maximum effects
                    sporesMultiplier: 1.5,
                    wispsMultiplier: 1.5,
                    auroraEnabled: true,
                    shootingStarsEnabled: true,
                },
            },
        };

        return configs[quality] || configs.high;
    }

    async createScene() {
        // Get quality setting and configuration
        const qualitySetting = this.getQualitySetting();
        this.qualityConfig = this.getQualityConfig(qualitySetting);

        console.log('[MoonlitForest] Creating scene with quality:', qualitySetting, this.qualityConfig);

        // Define tree colors for different layers (quality-based counts)
        const treeLayers = [
            {
                el: document.getElementById('moonlit-forest-back'),
                color: '#7A9B7E',
                foliageColor: '#5A8067',
                count: this.qualityConfig.trees.back,
                height: window.innerHeight * 0.7,
            },
            {
                el: document.getElementById('moonlit-forest-mid'),
                color: '#3D5F4A',
                foliageColor: '#4A6B56',
                count: this.qualityConfig.trees.mid,
                height: window.innerHeight * 0.85,
            },
            {
                el: document.getElementById('moonlit-forest-front'),
                color: '#1A2820',
                foliageColor: '#2F4A3A',
                count: this.qualityConfig.trees.front,
                height: window.innerHeight,
            },
        ];

        // Helper function to draw an elegant, sparse tree with refined foliage
        const drawTree = (ctx, x, y, len, angle, width, foliageColor, depth = 0) => {
            const maxDepth = 5;

            if (depth > maxDepth || width < 1.5 || len < 15) {
                // Draw refined, sparse leaf cluster at branch endpoints
                const clusterCount = Math.floor(this.random(4, 7)); // Lighter amount
                const clusterRadius = this.random(12, 20); // Tighter spread
                
                for (let i = 0; i < clusterCount; i++) {
                    const offsetX = this.random(-clusterRadius, clusterRadius);
                    const offsetY = this.random(-clusterRadius, clusterRadius);
                    const size = this.random(6, 11); // Smaller leaves
                    
                    // Single layer for crisp, clean look
                ctx.beginPath();
                    ctx.arc(
                        x + offsetX, 
                        y + offsetY, 
                        size, 
                        0, 
                        Math.PI * 2
                    );
                ctx.fillStyle = foliageColor;
                    ctx.globalAlpha = this.random(0.5, 0.7);
                ctx.fill();
                    
                    // Very selective highlights for key leaves only
                    if (Math.random() < 0.2) {
                        ctx.beginPath();
                        ctx.arc(
                            x + offsetX + this.random(-2, 2),
                            y + offsetY + this.random(-2, 2),
                            size * 0.4,
                            0,
                            Math.PI * 2
                        );
                        ctx.fillStyle = foliageColor;
                        ctx.globalAlpha = this.random(0.25, 0.4);
                        ctx.fill();
                    }
                }
                ctx.globalAlpha = 1;
                return;
            }

            // Very selective foliage along branches (sparse placement)
            if (depth >= 4 && Math.random() < 0.3) { // Only deepest branches, rarely
                const branchFoliageCount = Math.floor(this.random(1, 3)); // Minimal leaves
                for (let i = 0; i < branchFoliageCount; i++) {
                    const offsetX = this.random(-8, 8);
                    const offsetY = this.random(-8, 8);
                    const size = this.random(5, 9);
                    
                    ctx.beginPath();
                    ctx.arc(x + offsetX, y + offsetY, size, 0, Math.PI * 2);
                    ctx.fillStyle = foliageColor;
                    ctx.globalAlpha = this.random(0.45, 0.6);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }

            // Draw branch
            ctx.beginPath();
            ctx.lineWidth = width;
            ctx.moveTo(x, y);
            const x2 = x + len * Math.cos((angle * Math.PI) / 180);
            const y2 = y + len * Math.sin((angle * Math.PI) / 180);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            const newLen = len * (0.72 + Math.random() * 0.1);
            const newWidth = width * 0.7;

            // Main branch continues somewhat straight
            drawTree(ctx, x2, y2, newLen, angle + this.random(-12, 12), newWidth, foliageColor, depth + 1);

            // Standard side branches
            if (width > 2 && depth < maxDepth - 1) {
                drawTree(
                    ctx,
                    x2,
                    y2,
                    newLen * 0.75,
                    angle + this.random(25, 45),
                    newWidth * 0.75,
                    foliageColor,
                    depth + 1
                );
                drawTree(
                    ctx,
                    x2,
                    y2,
                    newLen * 0.75,
                    angle - this.random(25, 45),
                    newWidth * 0.75,
                    foliageColor,
                    depth + 1
                );
                
                // Rare extra branches for occasional variety
                if (depth >= 3 && Math.random() < 0.25) { // Further reduced from 0.4 to 0.25
                    drawTree(
                        ctx,
                        x2,
                        y2,
                        newLen * 0.6,
                        angle + this.random(40, 70),
                        newWidth * 0.6,
                    foliageColor,
                    depth + 1
                );
                }
            }
        };

        // 1. Procedurally generate trees for parallax layers (with caching)
        treeLayers.forEach((layer, layerIndex) => {
            if (layer.el) {
                this.registerContainer(layer.el);
                // Create a cache key based on layer properties and window dimensions
                // v10: MUSHROOM POSITIONING - mushrooms now properly positioned on ground line behind trees
                const cacheKey = `v10-${layerIndex}-${layer.color}-${layer.foliageColor}-${layer.count}-${layer.height}`;

                // Check if we have a cached version
                if (moonlitForestTreeCache.has(cacheKey)) {
                    const cachedData = moonlitForestTreeCache.get(cacheKey);
                    layer.el.style.backgroundImage = cachedData.backgroundImage;
                    layer.el.style.backgroundSize = cachedData.backgroundSize;
                } else {
                    // Generate the tree background
                    // OPTIMIZED: Reduced from 4096 to 2048 for 4x less pixels to process
                    const C_WIDTH = 2048;
                    const C_HEIGHT = layer.height;
                    const canvas = document.createElement('canvas');
                    canvas.width = C_WIDTH;
                    canvas.height = C_HEIGHT;
                    const ctx = canvas.getContext('2d');
                    ctx.strokeStyle = layer.color;

                    // Draw solid ground silhouette with gentle hills (aligned with trees)
                    // Use darker shade for clear ground definition
                    const groundColors = {
                        back: '#1A2820',    // Dark forest ground (matches front tree color)
                        mid: '#14201A',     // Slightly darker
                        front: '#0D1512',   // Darkest for front layer
                    };
                    const groundColorKey = layerIndex === 0 ? 'back' : layerIndex === 1 ? 'mid' : 'front';
                    ctx.fillStyle = groundColors[groundColorKey];
                    ctx.beginPath();
                    ctx.moveTo(0, C_HEIGHT);
                    let groundY = C_HEIGHT * 0.92; // Match Sakura ground height
                    const step = 4;
                    for (let x = 0; x < C_WIDTH; x += step) {
                        groundY += (Math.random() - 0.5) * 3; // Gentle terrain variation
                        ctx.lineTo(x, groundY);
                    }
                    ctx.lineTo(C_WIDTH, C_HEIGHT);
                    ctx.closePath();
                    ctx.fill();

                    // Add light, scattered undergrowth for subtle forest floor detail
                    const bushCount = Math.floor(layer.count * 0.8); // Lighter undergrowth
                    for (let i = 0; i < bushCount; i++) {
                        const bushX = Math.random() * C_WIDTH;
                        const bushY = C_HEIGHT * (0.92 + Math.random() * 0.04);
                        const bushSize = this.random(10, 24);
                        const foliageCount = Math.floor(this.random(3, 5)); // Sparse clusters
                        
                        // Draw subtle, refined bush clusters
                        for (let j = 0; j < foliageCount; j++) {
                            ctx.beginPath();
                            ctx.arc(
                                bushX + this.random(-bushSize * 0.5, bushSize * 0.5),
                                bushY + this.random(-bushSize * 0.25, bushSize * 0.25),
                                this.random(5, 11),
                                0,
                                Math.PI * 2
                            );
                            ctx.fillStyle = layer.foliageColor;
                            ctx.globalAlpha = this.random(0.5, 0.65);
                            ctx.fill();
                            
                            // Rare highlights for accent
                            if (Math.random() < 0.15) {
                                ctx.beginPath();
                                ctx.arc(
                                    bushX + this.random(-bushSize * 0.3, bushSize * 0.3),
                                    bushY + this.random(-bushSize * 0.15, bushSize * 0.15),
                                    this.random(3, 6),
                                    0,
                                    Math.PI * 2
                                );
                                ctx.fillStyle = layer.foliageColor;
                                ctx.globalAlpha = this.random(0.35, 0.5);
                                ctx.fill();
                            }
                        }
                    }
                    ctx.globalAlpha = 1;

                    // Add glowing mushrooms on the ground (layered depth effect)
                    // Matching the beautiful glowing DOM mushroom style
                    // Mushrooms are drawn BEFORE trees so they appear behind trees
                    const mushroomCount = Math.floor(layer.count * 1.2); // More mushrooms than bushes
                    const groundLineY = C_HEIGHT * 0.92; // Base ground line for this layer
                    
                    for (let i = 0; i < mushroomCount; i++) {
                        const mushroomX = Math.random() * C_WIDTH;
                        // Position mushrooms on the ground line (same as trees)
                        const mushroomGroundY = groundLineY + Math.random() * (C_HEIGHT * 0.08);
                        const mushroomSize = this.random(6, 16);
                        
                        // Determine mushroom color variant (matching DOM mushrooms)
                        // Using same logic as CSS: default (cyan/blue), 3n (purple), 5n (green)
                        const variant = i % 15; // Using 15 for LCM of 3 and 5
                        let capGradientColors, glowColor, shadowColor;
                        
                        if (variant % 5 === 0) {
                            // Green variant (every 5th)
                            capGradientColors = [
                                'rgba(100, 255, 180, 0.9)',
                                'rgba(100, 220, 160, 0.7)',
                                'rgba(80, 180, 140, 0.6)',
                                'rgba(60, 140, 120, 0.4)'
                            ];
                            glowColor = 'rgba(100, 255, 180, 0.6)';
                            shadowColor = 'rgba(100, 255, 180, 0.8)';
                        } else if (variant % 3 === 0) {
                            // Purple variant (every 3rd, not 5th)
                            capGradientColors = [
                                'rgba(180, 100, 255, 0.9)',
                                'rgba(140, 120, 220, 0.7)',
                                'rgba(100, 100, 180, 0.6)',
                                'rgba(70, 80, 140, 0.4)'
                            ];
                            glowColor = 'rgba(180, 100, 255, 0.6)';
                            shadowColor = 'rgba(180, 100, 255, 0.8)';
                        } else {
                            // Cyan/blue variant (default)
                            capGradientColors = [
                                'rgba(0, 255, 255, 0.9)',
                                'rgba(100, 200, 255, 0.7)',
                                'rgba(80, 150, 200, 0.6)',
                                'rgba(60, 120, 160, 0.4)'
                            ];
                            glowColor = 'rgba(0, 255, 255, 0.6)';
                            shadowColor = 'rgba(0, 255, 255, 0.8)';
                        }
                        
                        const stemWidth = mushroomSize * 0.3;
                        const stemHeight = mushroomSize * 0.8;
                        const capWidth = mushroomSize * 0.8;
                        const capHeight = mushroomSize * 0.6;
                        
                        // Draw mushroom stem with gradient (matching DOM style)
                        const stemGradient = ctx.createLinearGradient(
                            mushroomX, mushroomGroundY - stemHeight,
                            mushroomX, mushroomGroundY
                        );
                        stemGradient.addColorStop(0, 'rgba(180, 210, 220, 0.6)');
                        stemGradient.addColorStop(1, 'rgba(140, 170, 180, 0.4)');
                        
                        ctx.fillStyle = stemGradient;
                        ctx.globalAlpha = 1;
                        ctx.fillRect(
                            mushroomX - stemWidth / 2,
                            mushroomGroundY - stemHeight,
                            stemWidth,
                            stemHeight
                        );
                        
                        // Draw glowing cap with radial gradient (matching DOM style)
                        const capGradient = ctx.createRadialGradient(
                            mushroomX, mushroomGroundY - stemHeight,
                            0,
                            mushroomX, mushroomGroundY - stemHeight,
                            capWidth
                        );
                        capGradient.addColorStop(0, capGradientColors[0]);      // Center
                        capGradient.addColorStop(0.3, capGradientColors[1]);    // Mid
                        capGradient.addColorStop(0.6, capGradientColors[2]);    // Outer
                        capGradient.addColorStop(1, capGradientColors[3]);      // Edge
                        
                        // Apply shadow glow effect
                        ctx.shadowBlur = 8;
                        ctx.shadowColor = shadowColor;
                        
                        ctx.beginPath();
                        ctx.ellipse(
                            mushroomX,
                            mushroomGroundY - stemHeight,
                            capWidth,
                            capHeight,
                            0,
                            0,
                            Math.PI * 2
                        );
                        ctx.fillStyle = capGradient;
                        ctx.globalAlpha = 1;
                        ctx.fill();
                        
                        // Reset shadow
                        ctx.shadowBlur = 0;
                        
                        // Add outer glow halo effect
                        const glowGradient = ctx.createRadialGradient(
                            mushroomX,
                            mushroomGroundY - stemHeight,
                            0,
                            mushroomX,
                            mushroomGroundY - stemHeight,
                            mushroomSize * 1.8
                        );
                        glowGradient.addColorStop(0, glowColor);
                        glowGradient.addColorStop(0.3, glowColor.replace('0.6', '0.4'));
                        glowGradient.addColorStop(0.6, glowColor.replace('0.6', '0.2'));
                        glowGradient.addColorStop(1, 'transparent');
                        
                        ctx.beginPath();
                        ctx.arc(
                            mushroomX,
                            mushroomGroundY - stemHeight,
                            mushroomSize * 1.8,
                            0,
                            Math.PI * 2
                        );
                        ctx.fillStyle = glowGradient;
                        ctx.globalAlpha = 0.5;
                        ctx.fill();
                        
                        // Add subtle white highlight on cap (matching DOM inset highlight)
                        const highlightGradient = ctx.createRadialGradient(
                            mushroomX,
                            mushroomGroundY - stemHeight - capHeight * 0.3,
                            0,
                            mushroomX,
                            mushroomGroundY - stemHeight - capHeight * 0.3,
                            capWidth * 0.4
                        );
                        highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
                        highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                        
                        ctx.beginPath();
                        ctx.arc(
                            mushroomX,
                            mushroomGroundY - stemHeight - capHeight * 0.3,
                            capWidth * 0.4,
                            0,
                            Math.PI * 2
                        );
                        ctx.fillStyle = highlightGradient;
                        ctx.globalAlpha = 1;
                        ctx.fill();
                    }
                    ctx.globalAlpha = 1;

                    // Draw trees (positioned on ground at 0.92, matching Sakura alignment)
                    for (let i = 0; i < layer.count; i++) {
                        const x = Math.random() * C_WIDTH;
                        const y = C_HEIGHT * (0.92 + Math.random() * 0.08); // Align with ground at 0.92
                        const len = C_HEIGHT * (0.2 + Math.random() * 0.3);
                        const angle = -90 + this.random(-10, 10);
                        const width = 10 + Math.random() * (layer.height / 30);
                        drawTree(ctx, x, y, len, angle, width, layer.foliageColor);
                    }

                    // Add gradient fade at the top to blend smoothly with sky
                    const fadeHeight = C_HEIGHT * 0.35; // Fade the top 35% of the canvas
                    const gradient = ctx.createLinearGradient(0, 0, 0, fadeHeight);
                    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)'); // Fully transparent at top
                    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)'); // Gradual fade
                    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Fully visible at bottom

                    ctx.globalCompositeOperation = 'destination-out'; // Use gradient as alpha mask
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, C_WIDTH, fadeHeight);
                    ctx.globalCompositeOperation = 'source-over'; // Reset to normal

                    const backgroundImage = `url(${canvas.toDataURL()})`;
                    const backgroundSize = `${C_WIDTH}px ${C_HEIGHT}px`;

                    // Cache the generated background
                    moonlitForestTreeCache.set(cacheKey, { backgroundImage, backgroundSize });

                    // Apply to the layer
                    layer.el.style.backgroundImage = backgroundImage;
                    layer.el.style.backgroundSize = backgroundSize;
                }
            }
        });

        // 2. Glowing Mushrooms (quality-based)
        const mushroomContainer = this.getContainer('glowing-mushrooms');
        if (mushroomContainer && mushroomContainer.children.length === 0) {
            this.mushrooms = [];
            for (let i = 0; i < this.qualityConfig.mushrooms; i++) {
                const mushroom = document.createElement('div');
                mushroom.className = 'glowing-mushroom';
                mushroom.style.left = `${Math.random() * 98}%`;
                // Anchor mushrooms to the forest floor (0-3% from bottom)
                mushroom.style.bottom = `${Math.random() * 3}%`;
                mushroom.style.setProperty('--delay', `-${Math.random() * 12}s`);
                mushroomContainer.appendChild(mushroom);
                this.mushrooms.push(mushroom); // Store reference for reactive effects
            }
        }

        // 3. Moonbeams (quality-based)
        const moonbeamContainer = document.querySelector('.moonbeam-container');
        if (moonbeamContainer) {
            this.registerContainer(moonbeamContainer);
            if (moonbeamContainer.children.length === 0) {
                this.moonbeams = [];
                for (let i = 0; i < this.qualityConfig.moonbeams; i++) {
                    const beam = document.createElement('div');
                    beam.className = 'moonbeam';
                    const angle = Math.random() * 20 - 10;
                    beam.style.left = `${Math.random() * 100}%`;
                    beam.style.setProperty('--r-start', `${angle - 8}deg`);
                    beam.style.setProperty('--r-end', `${angle + 8}deg`);
                    beam.style.setProperty('--opacity', `${Math.random() * 0.3 + 0.1}`);
                    beam.style.animationDelay = `-${Math.random() * 45}s`;
                    moonbeamContainer.appendChild(beam);
                    this.moonbeams.push(beam); // Store reference for reactive effects
                }
            }
        }

        // 4. Wildlife (quality-based)
        const wildlifeContainer = this.getContainer('moonlit-wildlife');
        if (wildlifeContainer && wildlifeContainer.children.length === 0) {
            // Glowing Eyes
            this.eyes = [];
            for (let i = 0; i < this.qualityConfig.eyes; i++) {
                const eyes = document.createElement('div');
                eyes.className = 'glowing-eyes';
                eyes.style.left = `${Math.random() * 95}%`;
                eyes.style.bottom = `${Math.random() * 40}%`;
                eyes.style.animationDelay = `-${Math.random() * 12}s`;
                wildlifeContainer.appendChild(eyes);
                this.eyes.push(eyes); // Store reference for reactive effects
            }
            // Flying Owl
            const owl = document.createElement('div');
            owl.className = 'flying-owl';
            owl.style.animationDelay = `-${Math.random() * 45}s`;
            wildlifeContainer.appendChild(owl);
        }

        // 5. Falling Leaves with Depth Layers (quality-based, parallax effect)
        const themeContainer = this.getContainer('moonlit-forest-theme');
        if (themeContainer) {
            // Clear old leaves before adding new ones
            themeContainer.querySelectorAll('.moonlit-leaf').forEach((e) => e.remove());
            this.leaves = [];

            // Define depth layers for leaves to create parallax effect
            const leafDepthLayers = [
                {
                    name: 'far-back',
                    count: Math.ceil(this.qualityConfig.leaves * 0.2),  // 20% furthest back
                    zIndex: 2,
                    size: 0.5,  // Small (far away)
                    opacity: 0.4,
                    blur: 1.5,
                    durationMultiplier: 1.6,  // Slower fall (parallax)
                    driftRange: 12,
                },
                {
                    name: 'back',
                    count: Math.ceil(this.qualityConfig.leaves * 0.25),  // 25% back layer
                    zIndex: 4,
                    size: 0.7,
                    opacity: 0.6,
                    blur: 1.0,
                    durationMultiplier: 1.4,
                    driftRange: 15,
                },
                {
                    name: 'mid',
                    count: Math.ceil(this.qualityConfig.leaves * 0.3),  // 30% middle layer
                    zIndex: 7,
                    size: 0.9,
                    opacity: 0.8,
                    blur: 0.5,
                    durationMultiplier: 1.2,
                    driftRange: 18,
                },
                {
                    name: 'front',
                    count: Math.ceil(this.qualityConfig.leaves * 0.25),  // 25% front layer
                    zIndex: 11,
                    size: 1.0,
                    opacity: 1.0,
                    blur: 0,
                    durationMultiplier: 1.0,  // Normal speed
                    driftRange: 20,
                },
            ];

            // Create leaves for each depth layer
            leafDepthLayers.forEach((layer) => {
                for (let i = 0; i < layer.count; i++) {
                const leaf = document.createElement('div');
                leaf.className = 'moonlit-leaf';
                    
                    // Position and movement
                const xStart = Math.random() * 100;
                leaf.style.setProperty('--x-start', `${xStart}vw`);
                    leaf.style.setProperty('--x-end', `${xStart + (Math.random() * layer.driftRange - layer.driftRange / 2)}vw`);
                leaf.style.setProperty('--r-start', `${Math.random() * 360}deg`);
                leaf.style.setProperty('--r-end', `${Math.random() * 540 - 270}deg`);
                    
                    // Depth-based properties
                    leaf.style.setProperty('--leaf-scale', layer.size.toString());
                    leaf.style.setProperty('--leaf-opacity', layer.opacity.toString());
                    leaf.style.zIndex = layer.zIndex;
                    
                    // Apply blur for depth of field effect
                    if (layer.blur > 0) {
                        leaf.style.filter = `blur(${layer.blur}px)`;
                    }
                    
                    // Duration varies by depth for parallax effect
                    const baseDuration = Math.random() * 12 + 12;
                    const duration = baseDuration * layer.durationMultiplier;
                leaf.style.animationDuration = `${duration}s`;
                leaf.style.animationDelay = `-${Math.random() * duration}s`;
                    
                themeContainer.appendChild(leaf);
                    this.leaves.push(leaf);
                }
            });
        }

        // 6. Ambient Fireflies (quality-based, continuous)
        if (themeContainer && this.qualityConfig.fireflies > 0) {
            for (let i = 0; i < this.qualityConfig.fireflies; i++) {
                setTimeout(() => {
                    this.spawnAmbientFirefly();
                }, i * 1000); // Stagger initial spawn
            }
        }

        // Setup event listeners for reactive effects
        this.setupEventListeners();
    }

    /**
     * Spawn a single ambient firefly that continuously respawns
     */
    spawnAmbientFirefly() {
        if (!this.isActive) return;

        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const firefly = document.createElement('div');
        firefly.className = 'ambient-firefly';
        firefly.style.position = 'absolute';
        firefly.style.width = '3px';
        firefly.style.height = '3px';
        firefly.style.borderRadius = '50%';
        firefly.style.backgroundColor = '#ffeb3b';
        firefly.style.boxShadow = '0 0 6px 2px rgba(255, 235, 59, 0.6)';
        firefly.style.left = `${Math.random() * 100}%`;
        firefly.style.top = `${30 + Math.random() * 50}%`;
        firefly.style.opacity = '0';
        firefly.style.pointerEvents = 'none';
        firefly.style.zIndex = '9';
        
        // Random movement pattern
        const duration = 8 + Math.random() * 8; // 8-16 seconds
        firefly.style.animation = `fireflyWander ${duration}s ease-in-out forwards`;
        
        theme.appendChild(firefly);

        // Remove and respawn after animation
        setTimeout(() => {
            if (firefly.parentNode) {
                firefly.parentNode.removeChild(firefly);
            }
            // Respawn if theme is still active
            if (this.isActive) {
                setTimeout(() => {
                    this.spawnAmbientFirefly();
                }, Math.random() * 3000); // Random delay before respawn
            }
        }, duration * 1000);
    }

    setupEventListeners() {
        // Listen for line clear events
        const lineClearUnsub = eventBus.on(EVENTS.LINE_CLEAR, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onLineClear(data.lineCount);
            }
        });

        // Listen for combo events
        const comboUnsub = eventBus.on(EVENTS.COMBO, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onCombo(data.comboCount);
            }
        });

        // Listen for piece lock events
        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.onPieceLock(data.piece);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    /**
     * React to line clears with mystical forest effects (quality-scaled)
     */
    onLineClear(lineCount) {
        if (!this.qualityConfig) return;

        const comboEffects = this.qualityConfig.comboEffects;

        // Brighten mushrooms
        this.brightenMushrooms(lineCount);

        // Intensify moonbeams
        this.intensifyMoonbeams(lineCount);

        // Spawn fireflies for bigger line clears
        if (lineCount >= 2 && comboEffects.fireflyMultiplier > 0) {
            const fireflyCount = Math.ceil(lineCount * 3 * comboEffects.fireflyMultiplier);
            this.spawnFireflies(fireflyCount);
        }

        // Release glowing spores
        if (comboEffects.sporesMultiplier > 0) {
            const sporesCount = Math.ceil(lineCount * 4 * comboEffects.sporesMultiplier);
            this.releaseGlowingSpores(sporesCount);
        }

        // Drop enchanted leaves for big clears
        if (lineCount >= 3) {
            this.spawnEnchantedLeaves(lineCount * 2);
        }
    }

    /**
     * React to combos with intense mystical effects (quality-scaled)
     */
    onCombo(comboCount) {
        if (!this.qualityConfig) return;

        this.currentComboLevel = comboCount;
        const comboEffects = this.qualityConfig.comboEffects;

        // Make wildlife eyes glow
        this.glowWildlifeEyes(comboCount);

        // Create magical sparkles
        this.createMagicalSparkles(comboCount);

        // Intensify forest atmosphere
        this.intensifyForestAtmosphere(comboCount);

        // Spawn mystical wisps
        if (comboEffects.wispsMultiplier > 0) {
            const wispCount = Math.ceil(comboCount * 2 * comboEffects.wispsMultiplier);
            this.spawnMysticalWisps(wispCount);
        }

        // For high combos, create special effects
        if (comboCount >= 3 && comboEffects.auroraEnabled) {
            this.createAuroraShimmer(comboCount);
        }

        // Epic effects for very high combos
        if (comboCount >= 5 && comboEffects.shootingStarsEnabled) {
            this.spawnShootingStars(comboCount);
        }
    }

    /**
     * React to piece locks with subtle mystical touches
     */
    onPieceLock(piece) {
        // Small firefly sparkle on piece lock (30% chance)
        if (Math.random() < 0.3) {
            this.createSmallSparkle();
        }

        // Subtle mist particles (20% chance)
        if (Math.random() < 0.2) {
            this.spawnMistParticle();
        }
    }

    /**
     * Brighten glowing mushrooms
     */
    brightenMushrooms(intensity) {
        const mushroomsToBrighten = Math.min(Math.floor(intensity * 4), this.mushrooms.length);

        for (let i = 0; i < mushroomsToBrighten; i++) {
            const mushroom = this.mushrooms[Math.floor(Math.random() * this.mushrooms.length)];
            if (mushroom) {
                const originalFilter = mushroom.style.filter || '';
                mushroom.style.transition = 'filter 0.4s ease-out';
                mushroom.style.filter = `brightness(${1.5 + intensity * 0.3}) drop-shadow(0 0 ${8 + intensity * 4}px cyan)`;

                setTimeout(() => {
                    mushroom.style.filter = originalFilter;
                }, 400 + Math.random() * 200);
            }
        }
    }

    /**
     * Intensify moonbeams
     */
    intensifyMoonbeams(intensity) {
        const beamsToIntensify = Math.min(Math.floor(intensity * 2), this.moonbeams.length);

        for (let i = 0; i < beamsToIntensify; i++) {
            const beam = this.moonbeams[Math.floor(Math.random() * this.moonbeams.length)];
            if (beam) {
                const currentOpacity = parseFloat(beam.style.getPropertyValue('--opacity') || '0.2');
                beam.style.transition = 'opacity 0.5s ease-out';
                beam.style.setProperty('--opacity', Math.min(currentOpacity * 2.5, 0.6).toString());

                setTimeout(() => {
                    beam.style.setProperty('--opacity', currentOpacity.toString());
                }, 500);
            }
        }
    }

    /**
     * Make wildlife eyes glow brighter
     */
    glowWildlifeEyes(comboCount) {
        this.eyes.forEach((eyes) => {
            eyes.style.transition = 'filter 0.6s ease-out, transform 0.6s ease-out';
            eyes.style.filter = `brightness(${1.5 + comboCount * 0.2}) drop-shadow(0 0 ${10 + comboCount * 3}px gold)`;
            eyes.style.transform = `scale(${1 + comboCount * 0.1})`;

            setTimeout(() => {
                eyes.style.filter = '';
                eyes.style.transform = '';
            }, 600 + comboCount * 100);
        });
    }

    /**
     * Spawn magical fireflies
     */
    spawnFireflies(count) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const firefly = document.createElement('div');
                firefly.className = 'forest-firefly';
                firefly.style.position = 'absolute';
                firefly.style.width = '4px';
                firefly.style.height = '4px';
                firefly.style.borderRadius = '50%';
                firefly.style.backgroundColor = '#ffeb3b';
                firefly.style.boxShadow = '0 0 8px 2px rgba(255, 235, 59, 0.8)';
                firefly.style.left = `${20 + Math.random() * 60}%`;
                firefly.style.bottom = `${20 + Math.random() * 60}%`;
                firefly.style.opacity = '0';
                firefly.style.animation = 'fireflyFloat 2s ease-in-out forwards';
                firefly.style.pointerEvents = 'none';
                firefly.style.zIndex = '8';

                theme.appendChild(firefly);

                setTimeout(() => {
                    if (firefly.parentNode) {
                        firefly.parentNode.removeChild(firefly);
                    }
                }, 2000);
            }, i * 100);
        }
    }

    /**
     * Create magical sparkles
     */
    createMagicalSparkles(comboCount) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const sparkleCount = Math.min(comboCount * 2, 10);

        for (let i = 0; i < sparkleCount; i++) {
            setTimeout(() => {
                const sparkle = document.createElement('div');
                sparkle.className = 'forest-sparkle';
                sparkle.style.position = 'absolute';
                sparkle.style.width = '6px';
                sparkle.style.height = '6px';
                sparkle.style.left = `${Math.random() * 100}%`;
                sparkle.style.top = `${Math.random() * 100}%`;
                sparkle.style.opacity = '0';
                sparkle.style.pointerEvents = 'none';
                sparkle.style.zIndex = '11';
                sparkle.innerHTML = '✨';
                sparkle.style.animation = 'sparkleAppear 1s ease-out forwards';

                theme.appendChild(sparkle);

                setTimeout(() => {
                    if (sparkle.parentNode) {
                        sparkle.parentNode.removeChild(sparkle);
                    }
                }, 1000);
            }, i * 80);
        }
    }

    /**
     * Create small sparkle on piece lock
     */
    createSmallSparkle() {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const sparkle = document.createElement('div');
        sparkle.className = 'forest-tiny-sparkle';
        sparkle.style.position = 'absolute';
        sparkle.style.width = '3px';
        sparkle.style.height = '3px';
        sparkle.style.borderRadius = '50%';
        sparkle.style.backgroundColor = '#a0d8ff';
        sparkle.style.boxShadow = '0 0 4px 1px rgba(160, 216, 255, 0.6)';
        sparkle.style.left = `${45 + Math.random() * 10}%`;
        sparkle.style.top = `${40 + Math.random() * 20}%`;
        sparkle.style.opacity = '1';
        sparkle.style.pointerEvents = 'none';
        sparkle.style.zIndex = '11';
        sparkle.style.animation = 'tinySparkleFloat 0.8s ease-out forwards';

        theme.appendChild(sparkle);

        setTimeout(() => {
            if (sparkle.parentNode) {
                sparkle.parentNode.removeChild(sparkle);
            }
        }, 800);
    }

    /**
     * Intensify forest atmosphere
     */
    intensifyForestAtmosphere(comboCount) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const saturation = 100 + Math.min(comboCount * 15, 60);
        const brightness = 100 + Math.min(comboCount * 10, 40);

        theme.style.filter = `saturate(${saturation}%) brightness(${brightness}%)`;

        setTimeout(() => {
            theme.style.filter = '';
        }, 800 + comboCount * 100);
    }

    /**
     * Create mystic wave for high combos
     */
    createMysticWave(comboCount) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const wave = document.createElement('div');
        wave.className = 'forest-mystic-wave';
        wave.style.position = 'absolute';
        wave.style.left = '50%';
        wave.style.top = '50%';
        wave.style.width = '100px';
        wave.style.height = '100px';
        wave.style.borderRadius = '50%';
        wave.style.border = '2px solid rgba(160, 216, 255, 0.6)';
        wave.style.transform = 'translate(-50%, -50%) scale(0)';
        wave.style.opacity = '0.8';
        wave.style.pointerEvents = 'none';
        wave.style.zIndex = '99';
        wave.style.animation = `mysticWaveExpand ${1.2 + comboCount * 0.1}s ease-out forwards`;

        theme.appendChild(wave);

        setTimeout(() => {
            if (wave.parentNode) {
                wave.parentNode.removeChild(wave);
            }
        }, (1.2 + comboCount * 0.1) * 1000);
    }

    /**
     * Release glowing spores that float upward
     */
    releaseGlowingSpores(count) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const colors = ['#00d9ff', '#a78bfa', '#6ee7b7']; // Cyan, purple, aqua

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const spore = document.createElement('div');
                spore.className = 'forest-spore';
                spore.style.position = 'absolute';
                spore.style.width = '5px';
                spore.style.height = '5px';
                spore.style.borderRadius = '50%';
                spore.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                spore.style.boxShadow = `0 0 6px 2px ${colors[Math.floor(Math.random() * colors.length)]}`;
                spore.style.left = `${10 + Math.random() * 80}%`;
                spore.style.bottom = `${Math.random() * 20}%`;
                spore.style.opacity = '0';
                spore.style.pointerEvents = 'none';
                spore.style.zIndex = '7';
                spore.style.animation = 'sporeFloat 3s ease-out forwards';

                theme.appendChild(spore);

                setTimeout(() => {
                    if (spore.parentNode) {
                        spore.parentNode.removeChild(spore);
                    }
                }, 3000);
            }, i * 80);
        }
    }

    /**
     * Spawn enchanted glowing leaves that fall gently
     */
    spawnEnchantedLeaves(count) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const leaf = document.createElement('div');
                leaf.className = 'enchanted-leaf';
                leaf.style.position = 'absolute';
                leaf.style.width = '12px';
                leaf.style.height = '12px';
                leaf.style.left = `${Math.random() * 100}%`;
                leaf.style.top = '-20px';
                leaf.style.fontSize = '12px';
                leaf.style.opacity = '0';
                leaf.style.pointerEvents = 'none';
                leaf.style.zIndex = '10';
                leaf.style.filter = 'drop-shadow(0 0 4px #6ee7b7)';
                leaf.innerHTML = '🍃';
                leaf.style.animation = `enchantedLeafFall ${3 + Math.random() * 2}s ease-in-out forwards`;

                theme.appendChild(leaf);

                setTimeout(() => {
                    if (leaf.parentNode) {
                        leaf.parentNode.removeChild(leaf);
                    }
                }, 5000);
            }, i * 150);
        }
    }

    /**
     * Spawn mystical wisps that weave through the forest
     */
    spawnMysticalWisps(count) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const wisp = document.createElement('div');
                wisp.className = 'mystical-wisp';
                wisp.style.position = 'absolute';
                wisp.style.width = '8px';
                wisp.style.height = '8px';
                wisp.style.borderRadius = '50%';
                wisp.style.background = 'radial-gradient(circle, rgba(192, 216, 240, 0.9) 0%, rgba(167, 139, 250, 0.6) 50%, transparent 100%)';
                wisp.style.boxShadow = '0 0 12px 4px rgba(192, 216, 240, 0.6)';
                wisp.style.left = Math.random() < 0.5 ? '-20px' : '110%';
                wisp.style.top = `${20 + Math.random() * 60}%`;
                wisp.style.opacity = '0';
                wisp.style.pointerEvents = 'none';
                wisp.style.zIndex = '6';
                wisp.style.animation = `wispWeave ${4 + Math.random() * 2}s ease-in-out forwards`;

                theme.appendChild(wisp);

                setTimeout(() => {
                    if (wisp.parentNode) {
                        wisp.parentNode.removeChild(wisp);
                    }
                }, 6000);
            }, i * 200);
        }
    }

    /**
     * Show ancient mystical runes that appear and fade
     */
    showAncientRunes(comboCount) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const runes = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ'];
        const runeCount = Math.min(comboCount * 2, 8);

        for (let i = 0; i < runeCount; i++) {
            setTimeout(() => {
                const rune = document.createElement('div');
                rune.className = 'ancient-rune';
                rune.style.position = 'absolute';
                rune.style.fontSize = '24px';
                rune.style.fontWeight = 'bold';
                rune.style.color = '#c0d8f0';
                rune.style.textShadow = '0 0 10px rgba(192, 216, 240, 0.8), 0 0 20px rgba(167, 139, 250, 0.6)';
                rune.style.left = `${15 + Math.random() * 70}%`;
                rune.style.top = `${15 + Math.random() * 70}%`;
                rune.style.opacity = '0';
                rune.style.pointerEvents = 'none';
                rune.style.zIndex = '98';
                rune.textContent = runes[Math.floor(Math.random() * runes.length)];
                rune.style.animation = 'runeAppear 2s ease-in-out forwards';

                theme.appendChild(rune);

                setTimeout(() => {
                    if (rune.parentNode) {
                        rune.parentNode.removeChild(rune);
                    }
                }, 2000);
            }, i * 120);
        }
    }

    /**
     * Create aurora shimmer effect across the sky
     */
    createAuroraShimmer(comboCount) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const aurora = document.createElement('div');
        aurora.className = 'aurora-shimmer';
        aurora.style.position = 'absolute';
        aurora.style.top = '0';
        aurora.style.left = '0';
        aurora.style.width = '100%';
        aurora.style.height = '40%';
        aurora.style.background = 'linear-gradient(180deg, rgba(0, 217, 255, 0.3) 0%, rgba(167, 139, 250, 0.25) 50%, transparent 100%)';
        aurora.style.opacity = '0';
        aurora.style.pointerEvents = 'none';
        aurora.style.zIndex = '4';
        aurora.style.animation = `auroraShimmer ${2 + comboCount * 0.2}s ease-in-out forwards`;
        aurora.style.mixBlendMode = 'screen';

        theme.appendChild(aurora);

        setTimeout(() => {
            if (aurora.parentNode) {
                aurora.parentNode.removeChild(aurora);
            }
        }, (2 + comboCount * 0.2) * 1000);
    }

    /**
     * Spawn shooting stars that streak across the sky
     */
    spawnShootingStars(comboCount) {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const starCount = Math.min(comboCount, 6);

        for (let i = 0; i < starCount; i++) {
            setTimeout(() => {
                const star = document.createElement('div');
                star.className = 'shooting-star';
                star.style.position = 'absolute';
                star.style.width = '80px';
                star.style.height = '2px';
                star.style.background = 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.9) 50%, transparent 100%)';
                star.style.boxShadow = '0 0 8px 2px rgba(192, 216, 240, 0.8)';
                star.style.left = `${Math.random() * 100}%`;
                star.style.top = `${Math.random() * 20}%`;
                star.style.transform = 'rotate(-25deg)';
                star.style.opacity = '0';
                star.style.pointerEvents = 'none';
                star.style.zIndex = '2';
                star.style.animation = 'shootingStar 1.2s ease-out forwards';

                theme.appendChild(star);

                setTimeout(() => {
                    if (star.parentNode) {
                        star.parentNode.removeChild(star);
                    }
                }, 1200);
            }, i * 300);
        }
    }

    /**
     * Spawn subtle mist particles that drift
     */
    spawnMistParticle() {
        const theme = document.getElementById('moonlit-forest-theme');
        if (!theme) return;

        const mist = document.createElement('div');
        mist.className = 'forest-mist';
        mist.style.position = 'absolute';
        mist.style.width = `${20 + Math.random() * 40}px`;
        mist.style.height = `${10 + Math.random() * 20}px`;
        mist.style.borderRadius = '50%';
        mist.style.background = 'radial-gradient(ellipse, rgba(192, 216, 240, 0.15) 0%, transparent 70%)';
        mist.style.left = Math.random() < 0.5 ? '-50px' : '110%';
        mist.style.bottom = `${10 + Math.random() * 40}%`;
        mist.style.opacity = '0';
        mist.style.pointerEvents = 'none';
        mist.style.zIndex = '3';
        mist.style.filter = 'blur(8px)';
        mist.style.animation = `mistDrift ${6 + Math.random() * 4}s linear forwards`;

        theme.appendChild(mist);

        setTimeout(() => {
            if (mist.parentNode) {
                mist.parentNode.removeChild(mist);
            }
        }, 10000);
    }

    stop() {
        // Unsubscribe from all events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Reset combo level
        this.currentComboLevel = 0;

        // Clear references
        this.mushrooms = [];
        this.moonbeams = [];
        this.eyes = [];
        this.leaves = [];

        super.stop();
    }

    /**
     * Provide Moonlit Forest themed tetromino styling (mystical glowing forest)
     * @returns {Object} Moonlit Forest tetromino configuration
     */
    getTetrominoConfig() {
        return MOONLIT_FOREST_TETROMINOS;
    }
}
