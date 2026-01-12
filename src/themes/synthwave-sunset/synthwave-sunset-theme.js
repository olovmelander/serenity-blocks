/**
 * Synthwave Sunset Theme - Three.js Masterpiece Edition
 * 
 * A stunning 3D retrofuturistic experience featuring:
 * - Infinite perspective neon grid with glow
 * - Volumetric sun with stripes and corona
 * - 3D procedural cityscape with window lights
 * - Dynamic tetromino grid highlighting
 * - Particle-based combo effects
 * - Post-processing bloom and atmosphere
 */

import * as THREE from 'three';
import { BaseTheme } from '../base-theme.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { SYNTHWAVE_SUNSET_TETROMINOS } from './synthwave-sunset-tetrominos.js';
import {
    gridVertexShader,
    gridFragmentShader,
    sunVertexShader,
    sunFragmentShader,
    sunGlowVertexShader,
    sunGlowFragmentShader,
    starVertexShader,
    starFragmentShader,
    highlightVertexShader,
    highlightFragmentShader,
    particleVertexShader,
    particleFragmentShader
} from './synthwave-shaders.js';

export default class SynthwaveSunsetTheme extends BaseTheme {
    constructor() {
        super('synthwave-sunset');

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();

        // Scene elements
        this.grid = null;
        this.sun = null;
        this.sunGlowLayers = [];
        this.starField = null;
        this.buildings = [];
        this.buildingEdges = [];

        // Effects
        this.gridHighlights = [];
        this.highlightPool = [];
        this.particles = null;
        this.particleData = [];

        // Animation state
        this.sunPosition = { x: 0, y: 0 };
        this.sunPhaseX = Math.random() * Math.PI * 2;
        this.timeOffset = Math.random() * 10000;

        // Event state
        this.gridPulseIntensity = 0;
        this.sunPulseIntensity = 0;
        this.cityGlowIntensity = 0;
        this.comboColorShift = 0;
        this.highlightTwinkleIntensity = 0;  // For combo twinkle effect on highlights

        // Event handlers
        this.eventUnsubscribers = [];

        // Quality presets
        this.qualityPresets = {
            Minimal: { starCount: 500, buildingCount: 30, glowLayers: 1, maxHighlights: 30, particleBudget: 500 },
            Low: { starCount: 1000, buildingCount: 50, glowLayers: 2, maxHighlights: 40, particleBudget: 1000 },
            Medium: { starCount: 1800, buildingCount: 70, glowLayers: 3, maxHighlights: 60, particleBudget: 2000 },
            High: { starCount: 2500, buildingCount: 90, glowLayers: 4, maxHighlights: 80, particleBudget: 3500 },
            Ultra: { starCount: 4000, buildingCount: 120, glowLayers: 5, maxHighlights: 100, particleBudget: 6000 },
            Extreme: { starCount: 6000, buildingCount: 150, glowLayers: 6, maxHighlights: 150, particleBudget: 10000 }
        };
        this.currentQuality = 'High';
        this.activePreset = this.qualityPresets.High;

        // Colors
        this.colors = {
            gridPink: new THREE.Color(0xff0066),
            gridCyan: new THREE.Color(0x00ffff),
            sunTop: new THREE.Color(0xffdd00),
            sunMid: new THREE.Color(0xff8800),
            sunBottom: new THREE.Color(0xff0066),
            skyTop: new THREE.Color(0x1a0033),
            skyMid: new THREE.Color(0x660066),
            skyBottom: new THREE.Color(0xff6600),
            buildingDark: new THREE.Color(0x0a0515)
        };

        // Neon palette for highlights
        this.neonColors = [
            new THREE.Color(0x00ffff), // Cyan
            new THREE.Color(0xff00ff), // Magenta
            new THREE.Color(0xffff00), // Yellow
            new THREE.Color(0x00ff00), // Lime
            new THREE.Color(0x9900ff), // Purple
            new THREE.Color(0xff6600)  // Orange
        ];

        // Tetromino shapes (relative cell positions)
        this.tetrominoShapes = [
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], // I
            [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // J
            [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // L
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], // O
            [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }], // S
            [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }], // T
            [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }]  // Z
        ];
    }

    getGraphicsQuality() {
        const settings = typeof window !== 'undefined' ? window.settings : null;
        return settings?.effectQuality || 'High';
    }

    async createScene() {
        console.log('[Synthwave3D] Initializing Three.js scene...');

        const container = document.getElementById('synthwave-sunset-theme');
        if (!container) {
            console.error('[Synthwave3D] Container not found');
            return;
        }

        container.innerHTML = '';

        // Apply quality settings
        this.currentQuality = this.getGraphicsQuality();
        this.activePreset = this.qualityPresets[this.currentQuality] || this.qualityPresets.High;

        // Setup Three.js scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a0033);
        this.scene.fog = new THREE.FogExp2(0x330033, 0.015);

        // Setup camera
        this.camera = new THREE.PerspectiveCamera(
            70,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 8, 20);
        this.camera.lookAt(0, 2, -20);

        // Setup renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: false,
            antialias: this.getAntialiasEnabled(),
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this.getEffectivePixelRatio());
        container.appendChild(this.renderer.domElement);

        // Create scene elements
        this.createSkyGradient();
        this.createStarField();
        this.createSun();
        this.createBuildings();
        this.createGrid();
        this.createHighlightPool();
        this.createParticleSystem();

        // Setup events
        this.setupEventListeners();
        window.addEventListener('resize', this.onResize.bind(this));

        // Start animation
        this.animate();

        console.log(`[Synthwave3D] Scene initialized with ${this.currentQuality} quality`);
    }

    createSkyGradient() {
        // Create a sphere that surrounds the entire scene (radius 4000)
        // BackSide so we see it from inside
        const geometry = new THREE.SphereGeometry(4000, 32, 32);

        // Use vertex colors for gradient
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        const positions = geometry.attributes.position.array;

        for (let i = 0; i < geometry.attributes.position.count; i++) {
            const y = positions[i * 3 + 1];
            // Normalize y from -4000..4000 to 0..1
            // Use a slightly shifted range to keep the "sunset" colors more visible near horizon
            const t = (y + 1000) / 3000;
            const clampedT = Math.max(0, Math.min(1, t));

            let color;
            if (clampedT < 0.5) {
                color = this.colors.skyBottom.clone().lerp(this.colors.skyMid, clampedT / 0.5);
            } else {
                color = this.colors.skyMid.clone().lerp(this.colors.skyTop, (clampedT - 0.5) / 0.5);
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.BackSide, // Render inside of sphere
            depthWrite: false
        });

        const sky = new THREE.Mesh(geometry, material);
        // Center at origin
        sky.position.set(0, 0, 0);
        this.scene.add(sky);

        // Also add a bottom fading plane to mask the "south pole" if needed, 
        // but sphere usually covers it well.
    }

    createStarField() {
        const count = this.activePreset.starCount;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        const starColors = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xaaddff),
            new THREE.Color(0xffddee)
        ];

        for (let i = 0; i < count; i++) {
            // Distribute in a full large sphere surrounding the scene
            // Radius much larger to cover all camera angles
            const radius = 300 + Math.random() * 200;
            const theta = Math.random() * Math.PI * 2; // Full horizontal rotation
            const phi = Math.acos(2 * Math.random() - 1); // Uniform sphere distribution

            // Only keep stars above a certain horizon (y > -50) to avoid wasting stars deep underground
            // But keep enough low ones to fill gaps near horizon
            // User requested "higher" stars, so we cut off earlier (0.45 * PI) to lift them off the "ground"
            if (phi > Math.PI * 0.45) {
                i--; // Retry
                continue;
            }

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.cos(phi);
            positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

            sizes[i] = Math.random() * 2.5 + 1.5; // Larger stars since they are far away
            phases[i] = Math.random() * Math.PI * 2;

            const color = starColors[Math.floor(Math.random() * starColors.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: starVertexShader,
            fragmentShader: starFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.starField = new THREE.Points(geometry, material);
        this.scene.add(this.starField);
    }

    createSun() {
        // Main sun sphere - Slightly smaller as requested
        const sunGeometry = new THREE.SphereGeometry(25, 64, 32);
        const sunMaterial = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                colorTop: { value: this.colors.sunTop },
                colorMid: { value: this.colors.sunMid },
                colorBottom: { value: this.colors.sunBottom },
                stripeCount: { value: 12.0 },
                pulseIntensity: { value: 0 }
            },
            vertexShader: sunVertexShader,
            fragmentShader: sunFragmentShader,
            transparent: true,
            side: THREE.FrontSide
        });

        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        this.sun.position.set(0, 35, -100);
        this.scene.add(this.sun);

        // Glow layers
        const glowCount = this.activePreset.glowLayers;
        const glowColors = [
            new THREE.Color(0xff8800),
            new THREE.Color(0xff4400),
            new THREE.Color(0xff0066),
            new THREE.Color(0xaa0088),
            new THREE.Color(0x6600aa),
            new THREE.Color(0x330066)
        ];

        for (let i = 0; i < glowCount; i++) {
            const scale = 1.5 + i * 0.8;
            // Larger glow planes to match bigger sun
            const glowGeometry = new THREE.PlaneGeometry(60 * scale, 60 * scale);
            const glowMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    glowColor: { value: glowColors[i % glowColors.length] },
                    opacity: { value: 0.4 - i * 0.05 },
                    pulseIntensity: { value: 0 }
                },
                vertexShader: sunGlowVertexShader,
                fragmentShader: sunGlowFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            });

            const glow = new THREE.Mesh(glowGeometry, glowMaterial);
            glow.position.copy(this.sun.position);
            glow.position.z += 1 + i * 0.5;
            this.scene.add(glow);
            this.sunGlowLayers.push(glow);
        }
    }

    createBuildings() {
        const count = this.activePreset.buildingCount;

        // Two layers of buildings
        const layers = [
            { y: 0, zStart: -80, zEnd: -50, scaleY: 1.0, color: 0x0a0515 },
            { y: 0, zStart: -60, zEnd: -35, scaleY: 0.7, color: 0x08040f }
        ];

        layers.forEach((layer, layerIndex) => {
            const buildingsPerLayer = Math.floor(count / 2);

            for (let i = 0; i < buildingsPerLayer; i++) {
                const width = 2 + Math.random() * 6;
                const height = (5 + Math.random() * 25) * layer.scaleY;
                const depth = 3 + Math.random() * 8;

                const geometry = new THREE.BoxGeometry(width, height, depth);
                const material = new THREE.MeshBasicMaterial({
                    color: layer.color
                });

                const building = new THREE.Mesh(geometry, material);

                // Position across the horizon - full screen width
                const spreadX = 250;
                building.position.x = (i / buildingsPerLayer) * spreadX - spreadX / 2 + (Math.random() - 0.5) * 5;
                building.position.y = height / 2 + layer.y;
                building.position.z = layer.zStart + Math.random() * (layer.zEnd - layer.zStart);

                this.scene.add(building);
                this.buildings.push(building);

                // Add edge glow (for combo effects)
                const edges = new THREE.EdgesGeometry(geometry);
                const edgeMaterial = new THREE.LineBasicMaterial({
                    color: 0xff0066,
                    transparent: true,
                    opacity: 0,
                    blending: THREE.AdditiveBlending // Add blending for brighter glow interaction
                });
                const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
                edgeLines.position.copy(building.position);
                this.scene.add(edgeLines);
                this.buildingEdges.push(edgeLines);
            }
        });
    }

    createGrid() {
        // Much larger plane so edges are never visible on screen
        const geometry = new THREE.PlaneGeometry(400, 300, 100, 75);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                speed: { value: -5.0 }, // Negative speed moves grid TOWARDS camera (driving forward)
                gridColor: { value: this.colors.gridPink },
                glowIntensity: { value: 1.0 },
                pulseIntensity: { value: 0 }
            },
            vertexShader: gridVertexShader,
            fragmentShader: gridFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });

        this.grid = new THREE.Mesh(geometry, material);
        this.grid.position.y = 0;
        this.grid.position.z = -30;
        this.scene.add(this.grid);
    }

    createHighlightPool() {
        const poolSize = this.activePreset.maxHighlights;

        for (let i = 0; i < poolSize; i++) {
            // Match the grid cell size (gridSpacing = 1.5)
            // Increased to 1.55 for better fit/overlap (retro solid look)
            const geometry = new THREE.PlaneGeometry(1.55, 1.55);
            geometry.rotateX(-Math.PI / 2);

            const material = new THREE.ShaderMaterial({
                uniforms: {
                    color: { value: new THREE.Color(0x00ffff) },
                    intensity: { value: 0 },
                    time: { value: 0 }
                },
                vertexShader: highlightVertexShader,
                fragmentShader: highlightFragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.userData = {
                active: false,
                life: 0,
                maxLife: 4.0,
                intensity: 0,
                decay: 0.01
            };

            this.scene.add(mesh);
            this.highlightPool.push(mesh);
        }
    }

    createParticleSystem() {
        const count = this.activePreset.particleBudget;
        const geometry = new THREE.BufferGeometry();

        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: particleVertexShader,
            fragmentShader: particleFragmentShader,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);

        // Initialize particle data
        for (let i = 0; i < count; i++) {
            this.particleData.push({
                active: false,
                x: 0, y: 0, z: 0,
                vx: 0, vy: 0, vz: 0,
                life: 0,
                maxLife: 1,
                size: 1,
                color: new THREE.Color(0xffffff)
            });
        }
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

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

        const pieceLockUnsub = eventBus.on(EVENTS.PIECE_LOCK, (data) => {
            const settings = typeof window !== 'undefined' ? window.settings : null;
            if (this.isActive && settings?.backgroundComboEffects === true) {
                this.handlePieceLock(data);
            }
        });

        this.eventUnsubscribers.push(lineClearUnsub, comboUnsub, pieceLockUnsub);
    }

    handlePieceLock(data) {
        const currentTime = this.clock.getElapsedTime();
        // Grid shader speed is 5.0 world units/sec. Grid cell spacing is 1.5.
        // Highlight logic multiplies relative grid index by 1.5.
        // So internal scroll speed must be 5.0 / 1.5 to result in 5.0 world speed.
        const scrollSpeed = 5.0 / 1.5;
        const scrollOffset = currentTime * scrollSpeed;

        // Get the actual piece that was locked
        const piece = data?.piece;
        if (!piece) return;

        // Get the color for this piece type from the theme colors
        const pieceType = piece.type; // 'I', 'O', 'T', 'S', 'Z', 'J', 'L'
        const color = this.getPieceColor(pieceType);

        // Position on grid based on piece position on board
        // Board width is typically 10 units (0-9). Center is ~4.5.
        // Map 0-9 to -30 to +30 on grid (scale factor ~6-8)
        let gridX;
        if (piece.x !== undefined) {
            // Center 0 is at piece.x = 4.5
            // Scale by 6 to cover a good portion of the width without being too extreme
            // Center 0 is at piece.x = 4.5
            // Scale by 6 to cover a good portion of the width without being too extreme
            // ROUND to nearest integer to snap to grid lines
            gridX = Math.round((piece.x - 4.5) * 6);
            // Removed random scatter for perfect alignment
        } else {
            // Fallback to random if no position data
            gridX = Math.floor(Math.random() * 80 - 40);
        }

        const gridZ = Math.floor(scrollOffset + 3 + Math.random() * 12);

        // Get the shape for this piece type
        const shape = this.getShapeForType(pieceType);
        // Use actual rotation from the piece if available, otherwise random
        const rotation = piece.rotation !== undefined ? piece.rotation : Math.floor(Math.random() * 4);

        // Spawn each cell of the actual tetromino shape
        for (const block of shape) {
            let rx = block.x;
            let ry = block.y;

            // Apply rotation
            for (let r = 0; r < rotation; r++) {
                const temp = rx;
                rx = -ry;
                ry = temp;
            }

            this.spawnHighlightCell(gridX + rx, gridZ + ry, color, scrollOffset);
        }

        // Grid pulse
        this.gridPulseIntensity = Math.min(1, this.gridPulseIntensity + 0.25);

        // Trigger highlight glitch effect - stronger
        this.highlightTwinkleIntensity = 1.6;
    }

    getPieceColor(pieceType) {
        // Use the theme's tetromino colors from synthwave-sunset-tetrominos.js
        const colorMap = {
            'I': new THREE.Color(0xff0066), // Hot Pink
            'O': new THREE.Color(0xff4500), // Orange-Red
            'T': new THREE.Color(0xb000ff), // Violet Purple
            'S': new THREE.Color(0xff006e), // Deep Pink
            'Z': new THREE.Color(0xff5e78), // Coral
            'J': new THREE.Color(0x00d4ff), // Electric Blue
            'L': new THREE.Color(0xffff00)  // Neon Yellow
        };
        return colorMap[pieceType] || this.neonColors[0];
    }

    getShapeForType(pieceType) {
        const shapes = {
            'I': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
            'J': [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            'L': [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            'O': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            'S': [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            'T': [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
            'Z': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }]
        };
        return shapes[pieceType] || shapes['T'];
    }

    spawnHighlightCell(gridX, gridZ, color, scrollOffset) {
        // Find inactive highlight from pool
        const highlight = this.highlightPool.find(h => !h.userData.active);
        if (!highlight) return;

        highlight.userData.active = true;
        highlight.userData.life = 1.0;
        highlight.userData.maxLife = 15.0 + Math.random() * 10.0;  // Stay very long (15-25 seconds)
        highlight.userData.intensity = 2.5 + Math.random() * 0.5;
        highlight.userData.decay = 0.001 + Math.random() * 0.001;  // Very slow decay
        highlight.userData.gridZ = gridZ;
        highlight.userData.scrollOffset = scrollOffset;

        // Position in world space - scale by gridSpacing (1.5) and offset to center in cell
        highlight.position.x = gridX * 1.5 + 0.75;
        highlight.position.y = 0.05;
        // Reverted to -0.75 (mathematical center) as X-jitter was likely the issue
        highlight.position.z = -(gridZ - scrollOffset) * 1.5 + this.grid.position.z - 0.75;

        // Set color
        highlight.material.uniforms.color.value.copy(color);
        highlight.material.uniforms.intensity.value = highlight.userData.intensity;

        highlight.visible = true;
        this.gridHighlights.push(highlight);
    }

    handleLineClear(data) {
        const { lineCount } = data;

        this.gridPulseIntensity = Math.min(1, this.gridPulseIntensity + 0.3 * lineCount);
        this.cityGlowIntensity = Math.min(1, this.cityGlowIntensity + 0.3 * lineCount);

        // Spawn horizon burst particles
        this.createHorizonBurst(lineCount);
    }

    handleCombo(data) {
        const { comboCount } = data;

        this.sunPulseIntensity = Math.min(1, this.sunPulseIntensity + 0.3);
        this.cityGlowIntensity = Math.min(1, this.cityGlowIntensity + 0.4);
        this.comboColorShift = Math.min(1, comboCount * 0.15);

        // Make all highlights twinkle during combo
        this.highlightTwinkleIntensity = Math.min(1.5, 0.5 + comboCount * 0.2);

        // Spawn sun corona burst
        if (comboCount >= 2) {
            this.createSunBurst(comboCount);
        }
    }

    createHorizonBurst(lineCount) {
        const baseCount = 20 * lineCount;
        const colors = [
            new THREE.Color(0xff0066),
            new THREE.Color(0xff4500),
            new THREE.Color(0xff006e),
            new THREE.Color(0xb000ff)
        ];

        for (let i = 0; i < baseCount; i++) {
            const particle = this.particleData.find(p => !p.active);
            if (!particle) break;

            particle.active = true;
            particle.x = (Math.random() - 0.5) * 60;
            particle.y = 5 + Math.random() * 3;
            particle.z = -45 + Math.random() * 5;
            particle.vx = (Math.random() - 0.5) * 3;
            particle.vy = 3 + Math.random() * 4;
            particle.vz = (Math.random() - 0.5) * 2;
            particle.life = 1.0;
            particle.maxLife = 1.5 + Math.random() * 0.5;
            particle.size = 2 + Math.random() * 3;
            particle.color = colors[Math.floor(Math.random() * colors.length)];
        }
    }

    createSunBurst(comboCount) {
        const count = 30 * comboCount;
        const colors = [
            new THREE.Color(0xff4500),
            new THREE.Color(0xff8c00),
            new THREE.Color(0xffd700),
            new THREE.Color(0xff0000)
        ];

        for (let i = 0; i < count; i++) {
            const particle = this.particleData.find(p => !p.active);
            if (!particle) break;

            const angle = Math.random() * Math.PI;
            const speed = 2 + Math.random() * 3;

            particle.active = true;
            particle.x = this.sun.position.x + Math.cos(angle) * 12;
            particle.y = this.sun.position.y + Math.sin(angle) * 12;
            particle.z = this.sun.position.z + 5;
            particle.vx = Math.cos(angle) * speed;
            particle.vy = Math.sin(angle) * speed;
            particle.vz = (Math.random() - 0.5) * 2;
            particle.life = 1.0;
            particle.maxLife = 1.0 + Math.random() * 0.8;
            particle.size = 3 + Math.random() * 4;
            particle.color = colors[Math.floor(Math.random() * colors.length)];
        }
    }

    // =========================================================================
    // ANIMATION
    // =========================================================================

    animate() {
        if (!this.isActive) return;

        const animId = requestAnimationFrame(() => this.animate());
        this.registerAnimation(animId);

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();

        this.updateCamera(elapsed);
        this.updateSun(elapsed, delta);
        this.updateGrid(elapsed, delta);
        this.updateHighlights(elapsed, delta);
        this.updateParticles(delta);
        this.updateBuildings(delta);
        this.updateStars(elapsed);

        this.renderer.render(this.scene, this.camera);
    }

    updateCamera(time) {
        // Gentle orbital sway
        const t = time * 0.03;
        this.camera.position.x = Math.sin(t) * 4;
        this.camera.position.y = 8 + Math.cos(t * 0.7) * 2;
        this.camera.position.z = 20 + Math.sin(t * 0.5) * 2;

        this.camera.lookAt(
            Math.sin(t * 0.4) * 2,
            3 + Math.cos(t * 0.3),
            -20
        );
    }

    updateSun(time, delta) {
        // Sun drift (left to right)
        // Much wider range so it starts OFF SCREEN left and ends OFF SCREEN right
        const driftTime = time + this.timeOffset;
        const driftProgress = (driftTime * 0.002) % 1; // Even slower progress (0.002 scale)
        // Range -350 to 350 covers full width at z=-100 and more
        const sunX = (driftProgress * 2 - 1) * 350;

        this.sun.position.x = sunX;

        // Update glow layers
        this.sunGlowLayers.forEach((glow, i) => {
            glow.position.x = sunX;
            glow.material.uniforms.pulseIntensity.value = this.sunPulseIntensity;

            // Subtle scale pulse
            const scale = 1 + Math.sin(time * 0.5 + i * 0.5) * 0.05;
            glow.scale.setScalar(scale + this.sunPulseIntensity * 0.2);
        });

        // Update sun shader
        this.sun.material.uniforms.time.value = time;
        this.sun.material.uniforms.pulseIntensity.value = this.sunPulseIntensity;

        // Decay pulse
        if (this.sunPulseIntensity > 0) {
            this.sunPulseIntensity *= 0.97;
            if (this.sunPulseIntensity < 0.01) this.sunPulseIntensity = 0;
        }
    }

    updateGrid(time, delta) {
        // Update shader uniforms
        this.grid.material.uniforms.time.value = time;
        this.grid.material.uniforms.pulseIntensity.value = this.gridPulseIntensity;

        // Color shift on combos
        const baseColor = this.colors.gridPink.clone();
        if (this.comboColorShift > 0) {
            baseColor.lerp(this.colors.gridCyan, this.comboColorShift);
        }
        this.grid.material.uniforms.gridColor.value = baseColor;

        // Decay effects
        if (this.gridPulseIntensity > 0) {
            this.gridPulseIntensity *= 0.95;
            if (this.gridPulseIntensity < 0.01) this.gridPulseIntensity = 0;
        }

        if (this.comboColorShift > 0) {
            this.comboColorShift *= 0.98;
            if (this.comboColorShift < 0.01) this.comboColorShift = 0;
        }
    }

    updateHighlights(time, delta) {
        // Grid shader speed is 5.0 world units/sec. Grid cell spacing is 1.5.
        const scrollSpeed = 5.0 / 1.5;
        const currentScroll = time * scrollSpeed;

        for (let i = this.gridHighlights.length - 1; i >= 0; i--) {
            const highlight = this.gridHighlights[i];
            const data = highlight.userData;

            // Update position to match grid scroll - scale by gridSpacing (1.5)
            // Update position to match grid scroll - scale by gridSpacing (1.5)
            const relativeZ = data.gridZ - currentScroll;
            highlight.position.z = -relativeZ * 1.5 + this.grid.position.z - 0.75; // Reverted to -0.75

            // Keep at full intensity - no time-based fade
            // Only fade slightly based on distance to horizon for visual effect
            const distanceFade = Math.max(0.3, 1.0 - Math.max(0, -relativeZ - 30) / 50);

            // Add twinkle effect during combos
            let twinkle = 1.0;
            if (this.highlightTwinkleIntensity > 0) {
                // Medium-High frequency blink - visible glitch feel matching Neon Dusk
                const phase = (data.gridZ * 0.5 + data.intensity * 2.0);
                const glitch = Math.sin(time * 30.0 + phase);
                twinkle = 1.0 + glitch * this.highlightTwinkleIntensity * 0.5;
            }

            highlight.material.uniforms.intensity.value = data.intensity * distanceFade * twinkle;
            highlight.material.uniforms.time.value = time;

            // Remove ONLY when scrolled past visible horizon (far away)
            if (relativeZ < -80) {
                highlight.visible = false;
                data.active = false;
                this.gridHighlights.splice(i, 1);
            }
        }

        // Decay twinkle intensity
        if (this.highlightTwinkleIntensity > 0) {
            this.highlightTwinkleIntensity *= 0.96;
            if (this.highlightTwinkleIntensity < 0.01) this.highlightTwinkleIntensity = 0;
        }
    }

    updateParticles(delta) {
        const positions = this.particles.geometry.attributes.position.array;
        const sizes = this.particles.geometry.attributes.aSize.array;
        const lives = this.particles.geometry.attributes.aLife.array;
        const colors = this.particles.geometry.attributes.aColor.array;

        for (let i = 0; i < this.particleData.length; i++) {
            const p = this.particleData[i];

            if (p.active) {
                // Physics
                p.x += p.vx * delta;
                p.y += p.vy * delta;
                p.z += p.vz * delta;
                p.vy -= 5 * delta; // Gravity

                p.life -= delta / p.maxLife;

                if (p.life <= 0) {
                    p.active = false;
                    p.life = 0;
                }

                // Update buffers
                positions[i * 3] = p.x;
                positions[i * 3 + 1] = p.y;
                positions[i * 3 + 2] = p.z;
                sizes[i] = p.size;
                lives[i] = Math.max(0, p.life);
                colors[i * 3] = p.color.r;
                colors[i * 3 + 1] = p.color.g;
                colors[i * 3 + 2] = p.color.b;
            } else {
                // Hide inactive particles
                positions[i * 3 + 1] = -1000;
                lives[i] = 0;
            }
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.aSize.needsUpdate = true;
        this.particles.geometry.attributes.aLife.needsUpdate = true;
        this.particles.geometry.attributes.aColor.needsUpdate = true;
    }

    updateBuildings(delta) {
        // Update building edge glow for combo effects
        if (this.cityGlowIntensity > 0) {
            this.buildingEdges.forEach(edge => {
                // Increase multiplier for much brighter edge glow (cap at 1.0 implicitly by material)
                edge.material.opacity = Math.min(1.0, this.cityGlowIntensity * 1.5);
                // Also scale line width if supported by browser (often strictly 1, but worth trying)
                edge.material.linewidth = 2;
            });

            // Slower decay for longer lasting glow effect
            this.cityGlowIntensity *= 0.985;
            if (this.cityGlowIntensity < 0.01) this.cityGlowIntensity = 0;
        }
    }

    updateStars(time) {
        if (this.starField) {
            this.starField.material.uniforms.time.value = time;
            this.starField.rotation.y = time * 0.002;
        }
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    onResize() {
        if (!this.camera || !this.renderer) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    stop() {
        // Unsubscribe events
        this.eventUnsubscribers.forEach(unsub => unsub());
        this.eventUnsubscribers = [];

        // Clear effects
        this.gridHighlights = [];
        this.particleData.forEach(p => p.active = false);

        // Dispose Three.js resources
        if (this.renderer) {
            this.renderer.dispose();
            const container = document.getElementById('synthwave-sunset-theme');
            if (container && container.contains(this.renderer.domElement)) {
                container.removeChild(this.renderer.domElement);
            }
        }

        if (this.scene) {
            this.scene.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;

        super.stop();
    }

    getTetrominoConfig() {
        return SYNTHWAVE_SUNSET_TETROMINOS;
    }
}
