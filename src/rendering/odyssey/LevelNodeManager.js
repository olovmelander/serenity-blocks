/**
 * @fileoverview LevelNodeManager - Manages level node orbs along the path
 *
 * Creates interactive 3D representations for each level,
 * showing state (locked/unlocked/completed) and stars.
 */

import * as THREE from 'three';
import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { buildThemeIconLookup, resolveThemeIconUrl } from './theme-icon-resolver.js';

const THEME_ICON_MODULES = import.meta.glob('../../themes/*/*-theme-icon.{png,svg}', {
    eager: true,
    import: 'default',
});
const THEME_ICON_LOOKUP = buildThemeIconLookup(THEME_REGISTRY, THEME_ICON_MODULES);
const GLASS_ORB_SCALE = 1.12; // Slight size bump for better readability on the board
const GLASS_INNER_RADIUS = 0.95 * GLASS_ORB_SCALE;
const GLASS_OUTER_RADIUS = 1.0 * GLASS_ORB_SCALE;
const GLASS_GLOW_RADIUS = 1.3 * GLASS_ORB_SCALE;
const INNER_FLOW_STRENGTH = 0.28;
const INNER_WOBBLE_STRENGTH = 0.028;

/**
 * LevelNodeManager - Manages level selection orbs
 */
export class LevelNodeManager {
    constructor(scene, pathCurve) {
        this.scene = scene;
        this.pathCurve = pathCurve;
        this.nodes = new Map(); // levelId → NodeObject
        this.selectedNode = null;
        this.hoveredNode = null;
        this.time = 0;
        this.textureLoader = new THREE.TextureLoader();
        this.themeTextureCache = new Map(); // iconUrl -> THREE.Texture
        this.fallbackIconTexture = this.createFallbackIconTexture();
    }

    /**
     * Create nodes for all levels
     * @param {Object[]} levelData - Array of level configurations
     */
    async createNodes(levelData) {
        for (const level of levelData) {
            const node = this.createNode(level);
            this.nodes.set(level.id, node);
            this.scene.add(node.group);
        }

        console.log('[LevelNodes] Created', this.nodes.size, 'level nodes');
    }

    /**
     * Create a single level node
     * @param {Object} levelConfig
     * @returns {Object}
     */
    createNode(levelConfig) {
        return this.createGlassNode(levelConfig);
    }

    createGlassNode(levelConfig) {
        const group = new THREE.Group();
        group.userData.levelId = levelConfig.id;
        group.userData.locked = true;
        group.userData.completed = false;
        group.userData.stars = 0;
        const chapterColor = this.getChapterColor(levelConfig.chapter || 1);

        // Position on path
        const pathPosition = levelConfig.pathPosition || (levelConfig.id - 1) / 55;
        const point = this.pathCurve.getPointAt(THREE.MathUtils.clamp(pathPosition, 0, 1));
        group.position.copy(point);

        // Offset Z slightly to ensure path is visually behind
        group.position.z += 1.0;

        // 1. Inner "Theme" Sphere (Solid textured sphere inside)
        const themeId = levelConfig.theme?.primary;
        const themeTex = this.getOrLoadThemeTexture(themeId);

        // Inner sphere acts as the solid core, hiding the path line that passes through
        const innerGeo = new THREE.SphereGeometry(GLASS_INNER_RADIUS, 32, 32);
        const innerMat = this.createFluidInnerMaterial(themeTex, chapterColor, levelConfig.id);
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);
        group.add(innerMesh);

        // 2. Outer Glass Sphere
        const glassGeo = new THREE.SphereGeometry(GLASS_OUTER_RADIUS, 48, 48);
        const glassMat = new THREE.MeshPhysicalMaterial({
            transmission: 0.0, // Disable transmission to prevent glitches
            opacity: 0.15, // More subtle glass
            transparent: true,
            thickness: 0.0,
            roughness: 0.2, // Softer reflections
            ior: 1.5,
            metalness: 0.1,
            specularIntensity: 1.0,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
            color: 0xffffff,
            side: THREE.FrontSide, // Explicitly render front side
            depthWrite: false, // Prevent depth sorting issues with transparency
        });
        const glassMesh = new THREE.Mesh(glassGeo, glassMat);
        group.add(glassMesh);

        // 3. Internal Particles (Snow globe effect)
        const particles = this.addGlassParticles(group);

        // 4. Standard UI Elements (Lock, Stars)
        // Lock icon
        const lockGroup = this.createLockIcon();
        lockGroup.visible = true; // Managed by setNodeState
        group.add(lockGroup);

        // Star indicators
        const starGroup = this.createStarIndicators();
        starGroup.visible = false; // Managed by setNodeState
        group.add(starGroup);

        // Return standard node structure
        // We use glassMesh as 'coreMesh' for raycasting/interaction provided it's the outer shell
        // We use innerMat/glassMat as fallbacks for shader updates (though we might need to override setNodeState for this specific node if uniforms differ)

        // Mock the shader uniforms on the materials so standard setNodeState doesn't crash
        // OR better: Create a shim or update setNodeState to handle this node type.
        // For now, let's inject dummy uniforms to prevent crashes.
        glassMat.uniforms = {
            uLocked: { value: 1.0 },
            uCompleted: { value: 0.0 },
            uHovered: { value: 0.0 },
            uSelected: { value: 0.0 },
            uTime: { value: 0 },
        };
        // We don't really have a 'glowMesh' separate from glass, but we can reuse glassMesh for that slot or add a faint glow.
        // Let's add a fake glow mesh behind/around to act as the selection highlight if needed.
        const glowGeometry = new THREE.IcosahedronGeometry(GLASS_GLOW_RADIUS, 2);
        const glowMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: chapterColor },
                uLocked: { value: 1.0 },
                uHovered: { value: 0.0 },
            },
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uLocked;
                uniform float uHovered;
                varying vec3 vNormal;

                void main() {
                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 3.0);
                    float alpha = rim * (0.2 + uHovered * 0.3) * (1.0 - uLocked * 0.7);
                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
        });
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        group.add(glowMesh);

        return {
            group,
            coreMesh: glassMesh,
            coreMaterial: glassMat, // Warning: setNodeState expects ShaderMaterial uniforms. We handled this with dummy uniforms.
            glowMesh,
            glowMaterial,
            lockGroup,
            starGroup,
            config: levelConfig,
            pathPosition,
            isGlassNode: true, // Marker
            innerMesh, // Ref for updates if needed
            particles,
        };
    }

    getOrLoadThemeTexture(themeId) {
        const iconUrl = resolveThemeIconUrl(themeId, THEME_ICON_LOOKUP);
        if (!iconUrl) {
            return null;
        }

        if (this.themeTextureCache.has(iconUrl)) {
            return this.themeTextureCache.get(iconUrl);
        }

        try {
            const texture = this.textureLoader.load(iconUrl);
            texture.colorSpace = THREE.SRGBColorSpace;
            this.themeTextureCache.set(iconUrl, texture);
            return texture;
        } catch (error) {
            console.warn(`[LevelNodes] Failed to load theme icon texture for "${themeId || 'unknown'}":`, error);
            return null;
        }
    }

    createFluidInnerMaterial(themeTex, chapterColor, levelId) {
        const hasThemeTexture = Boolean(themeTex);
        const iconTexture = themeTex || this.fallbackIconTexture;
        const fallback = chapterColor.clone();
        const seed = ((levelId || 1) * 0.61803398875) % 1000;

        return new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: iconTexture },
                uUseTexture: { value: hasThemeTexture ? 1.0 : 0.0 },
                uFallbackColor: { value: fallback },
                uTime: { value: 0 },
                uSeed: { value: seed },
                uFlowStrength: { value: INNER_FLOW_STRENGTH },
                uWobbleStrength: { value: INNER_WOBBLE_STRENGTH },
                uLocked: { value: 1.0 },
                uHovered: { value: 0.0 },
                uSelected: { value: 0.0 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uSeed;
                uniform float uWobbleStrength;
                uniform float uLocked;

                varying vec2 vUv;
                varying vec3 vViewNormal;

                void main() {
                    vUv = uv;
                    vViewNormal = normalize(normalMatrix * normal);

                    vec3 transformed = position;
                    float speed = mix(0.22, 1.25, 1.0 - uLocked);
                    float phase = uTime * speed + uSeed;
                    float waveA = sin(phase + position.y * 7.0 + position.x * 5.0);
                    float waveB = cos(phase * 0.8 + position.z * 6.0 - position.y * 4.0);
                    float wobble = (waveA + waveB * 0.65) * uWobbleStrength;
                    transformed += normal * wobble;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uMap;
                uniform float uUseTexture;
                uniform vec3 uFallbackColor;
                uniform float uTime;
                uniform float uSeed;
                uniform float uFlowStrength;
                uniform float uLocked;
                uniform float uHovered;
                uniform float uSelected;

                varying vec2 vUv;
                varying vec3 vViewNormal;

                void main() {
                    vec2 uv = vUv;
                    float speed = mix(0.28, 1.25, 1.0 - uLocked);
                    float t = uTime * speed + uSeed;

                    vec2 centered = uv - 0.5;
                    float radius = length(centered);

                    vec2 flow = vec2(
                        sin((uv.y + t * 0.42) * 10.0) + cos((uv.y * 1.7 - t * 0.31) * 5.0),
                        cos((uv.x - t * 0.37) * 10.0) + sin((uv.x * 1.4 + t * 0.33) * 5.0)
                    );

                    float swirlEnvelope = smoothstep(0.75, 0.0, radius);
                    vec2 swirlDir = vec2(-centered.y, centered.x);

                    uv += flow * (uFlowStrength * 0.010);
                    uv += swirlDir
                        * (sin(t * 1.2 + radius * 11.0) * uFlowStrength * 0.05 * swirlEnvelope);
                    uv = clamp(uv, vec2(0.01), vec2(0.99));

                    vec4 tex = texture2D(uMap, uv);
                    vec3 color = uFallbackColor;
                    if (uUseTexture > 0.5) {
                        color = tex.rgb;
                    }

                    float luma = dot(color, vec3(0.299, 0.587, 0.114));
                    color = mix(vec3(luma), color, 1.0 - (uLocked * 0.45));
                    color *= mix(0.45, 1.0, 1.0 - uLocked);

                    float rim = 1.0 - abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 2.2);
                    color += rim * 0.08;
                    color *= 1.0 + (uHovered * 0.10) + (uSelected * 0.06);

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.FrontSide,
            transparent: false,
            toneMapped: false,
        });
    }

    createFallbackIconTexture() {
        const data = new Uint8Array([255, 255, 255, 255]);
        const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
    }

    addGlassParticles(group) {
        const count = 16;
        const geometry = new THREE.BufferGeometry();
        const positions = [];

        for (let i = 0; i < count; i++) {
            // Random points inside sphere r=0.9
            const r = Math.random() * 0.8;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions.push(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta),
                r * Math.cos(phi),
            );
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        // Simple glowing dots
        const material = new THREE.PointsMaterial({
            color: 0xffaa00,
            size: 0.05,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
        });

        const particles = new THREE.Points(geometry, material);
        group.add(particles);
        return particles;
    }

    createLockIcon() {
        const group = new THREE.Group();

        // ═══════════════════════════════════════════════════════════════════
        // CLEAR LOCK ICON - Sprite-based for maximum visibility
        // Uses canvas-drawn padlock that's instantly recognizable
        // ═══════════════════════════════════════════════════════════════════

        // Create lock texture via canvas
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Clear background
        ctx.clearRect(0, 0, 128, 128);

        // Draw padlock shackle (curved top)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(64, 50, 28, Math.PI, 0, false); // Arc for shackle
        ctx.stroke();

        // Shackle vertical bars
        ctx.beginPath();
        ctx.moveTo(36, 50);
        ctx.lineTo(36, 65);
        ctx.moveTo(92, 50);
        ctx.lineTo(92, 65);
        ctx.stroke();

        // Draw padlock body (rounded rectangle)
        ctx.fillStyle = '#ff4444'; // Red body for visibility
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(24, 60, 80, 56, 8);
        ctx.fill();
        ctx.stroke();

        // Keyhole - circle part
        ctx.fillStyle = '#220000';
        ctx.beginPath();
        ctx.arc(64, 78, 10, 0, Math.PI * 2);
        ctx.fill();

        // Keyhole - triangular slot
        ctx.beginPath();
        ctx.moveTo(58, 82);
        ctx.lineTo(64, 102);
        ctx.lineTo(70, 82);
        ctx.closePath();
        ctx.fill();

        // Create texture and sprite
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: true,
            depthWrite: false,
        });

        const lockSprite = new THREE.Sprite(spriteMaterial);
        lockSprite.scale.set(0.9, 0.9, 1); // Smaller lock
        lockSprite.position.set(0, 1.1, 1.3);
        lockSprite.center.set(0.5, 0.5);
        lockSprite.renderOrder = 100; // Ensure it renders on top

        group.add(lockSprite);

        // Add subtle glow behind for extra visibility
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = 64;
        glowCanvas.height = 64;
        const glowCtx = glowCanvas.getContext('2d');

        const gradient = glowCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255, 100, 100, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 50, 50, 0.3)');
        gradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
        glowCtx.fillStyle = gradient;
        glowCtx.fillRect(0, 0, 64, 64);

        const glowTexture = new THREE.CanvasTexture(glowCanvas);
        const glowMaterial = new THREE.SpriteMaterial({
            map: glowTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: false,
        });

        const glowSprite = new THREE.Sprite(glowMaterial);
        glowSprite.scale.set(1.3, 1.3, 1); // Smaller glow
        glowSprite.position.set(0, 1.1, 1.1);
        glowSprite.renderOrder = 99;

        group.add(glowSprite);

        return group;
    }

    createStarIndicators() {
        const group = new THREE.Group();

        // ═══════════════════════════════════════════════════════════════════
        // SPRITE-BASED STAR ICONS - 5-pointed stars like the lock icons
        // ═══════════════════════════════════════════════════════════════════

        // Three star positions - arc above orb
        const starPositions = [
            new THREE.Vector3(-0.5, 1.4, 1.2), // Left star
            new THREE.Vector3(0, 1.6, 1.3), // Center star (higher)
            new THREE.Vector3(0.5, 1.4, 1.2), // Right star
        ];

        starPositions.forEach((pos, i) => {
            // Create star texture via canvas
            const starTexture = this.createStarTexture(128);

            const starMaterial = new THREE.SpriteMaterial({
                map: starTexture,
                transparent: true,
                depthTest: true,
                depthWrite: false,
            });

            const starSprite = new THREE.Sprite(starMaterial);
            starSprite.scale.set(0.7, 0.7, 1);
            starSprite.position.copy(pos);
            starSprite.center.set(0.5, 0.5);
            starSprite.name = `star_${i}`;
            starSprite.visible = false;
            starSprite.renderOrder = 100;

            // Golden glow behind star
            const glowTexture = this.createGlowTexture(64);
            const glowMaterial = new THREE.SpriteMaterial({
                map: glowTexture,
                color: 0xffcc00,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthTest: false,
            });
            const glowSprite = new THREE.Sprite(glowMaterial);
            glowSprite.scale.set(1.0, 1.0, 1);
            glowSprite.position.copy(pos);
            glowSprite.position.z -= 0.1;
            glowSprite.name = `star_glow_${i}`;
            glowSprite.visible = false;
            glowSprite.renderOrder = 99;

            group.add(glowSprite);
            group.add(starSprite);
        });

        return group;
    }

    /**
     * Create a 5-pointed star texture via canvas
     * @param {number} size - Canvas size
     * @returns {THREE.CanvasTexture}
     */
    createStarTexture(size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const cx = size / 2;
        const cy = size / 2;
        const outerRadius = size * 0.4;
        const innerRadius = size * 0.18;
        const spikes = 5;

        // Clear
        ctx.clearRect(0, 0, size, size);

        // Draw star with gradient fill
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerRadius);
        gradient.addColorStop(0, '#ffffcc'); // Bright center
        gradient.addColorStop(0.3, '#ffdd00'); // Golden
        gradient.addColorStop(0.7, '#ffaa00'); // Deep gold
        gradient.addColorStop(1, '#ff8800'); // Orange edge

        ctx.fillStyle = gradient;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();

        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI) / spikes - Math.PI / 2;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Add shine highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(cx - outerRadius * 0.2, cy - outerRadius * 0.2, outerRadius * 0.15, 0, Math.PI * 2);
        ctx.fill();

        return new THREE.CanvasTexture(canvas);
    }

    /**
     * Create a radial glow texture for sprites
     * @param {number} size - Texture size
     * @returns {THREE.CanvasTexture}
     */
    createGlowTexture(size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createRadialGradient(
            size / 2,
            size / 2,
            0,
            size / 2,
            size / 2,
            size / 2,
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 220, 100, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 180, 50, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 150, 0, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        return new THREE.CanvasTexture(canvas);
    }

    getChapterColor(chapter) {
        // ═══════════════════════════════════════════════════════════════════
        // VIBRANT CHAPTER COLORS - Saturated and eye-catching
        // ═══════════════════════════════════════════════════════════════════
        const colors = [
            new THREE.Color(0xff4400), // Ch1: Earth Core - Molten Orange
            new THREE.Color(0x0088ff), // Ch2: Deep Ocean - Bright Blue
            new THREE.Color(0x00dd44), // Ch3: Surface - Emerald Green
            new THREE.Color(0x88ccff), // Ch4: Mountains - Icy Blue
            new THREE.Color(0xffdd00), // Ch5: Sky - Golden Yellow
            new THREE.Color(0xaa44ff), // Ch6: Space - Cosmic Purple
            new THREE.Color(0xff44aa), // Ch7: Black Hole - Magenta
            new THREE.Color(0x00eeff), // Ch8: Urban Dreams - Neon Cyan
        ];
        return colors[(chapter - 1) % colors.length];
    }

    /**
     * Update nodes from player progress
     * @param {Object} progressData
     */
    updateFromProgress(progressData) {
        if (!progressData?.levelProgress) return;

        this.nodes.forEach((node, levelId) => {
            const levelProgress = progressData.levelProgress[levelId];
            const isUnlocked = levelId <= (progressData.furthestLevel || 1);
            const isCompleted = levelProgress?.completed || false;
            const stars = levelProgress?.stars || 0;

            this.setNodeState(levelId, {
                locked: !isUnlocked,
                completed: isCompleted,
                stars,
            });
        });
    }

    /**
     * Set state for a specific node
     */
    setNodeState(levelId, state) {
        const node = this.nodes.get(levelId);
        if (!node) return;

        node.group.userData.locked = state.locked;
        node.group.userData.completed = state.completed;
        node.group.userData.stars = state.stars;

        // Update shader uniforms
        node.coreMaterial.uniforms.uLocked.value = state.locked ? 1.0 : 0.0;
        node.coreMaterial.uniforms.uCompleted.value = state.completed ? 1.0 : 0.0;
        node.glowMaterial.uniforms.uLocked.value = state.locked ? 1.0 : 0.0;

        // Toggle lock icon
        node.lockGroup.visible = state.locked;

        if (node.isGlassNode) {
            // Custom state handling for glass node
            // 1. Update dummy uniforms for compatibility if needed
            if (node.coreMaterial.uniforms) {
                node.coreMaterial.uniforms.uLocked.value = state.locked ? 1.0 : 0.0;
                node.coreMaterial.uniforms.uCompleted.value = state.completed ? 1.0 : 0.0;
            }

            if (node.innerMesh?.material?.uniforms?.uLocked) {
                node.innerMesh.material.uniforms.uLocked.value = state.locked ? 1.0 : 0.0;
            }
        } else {
            // Updated standard shader uniforms
            node.coreMaterial.uniforms.uLocked.value = state.locked ? 1.0 : 0.0;
            node.coreMaterial.uniforms.uCompleted.value = state.completed ? 1.0 : 0.0;
        }

        // Toggle and update star indicators (handles both stars and glow sprites)
        node.starGroup.visible = state.completed && state.stars > 0;
        if (node.starGroup.visible) {
            node.starGroup.children.forEach((child) => {
                // Extract index from name (e.g., "star_0", "star_glow_0")
                const match = child.name.match(/_(\d+)$/);
                if (match) {
                    const starIndex = parseInt(match[1], 10);
                    child.visible = starIndex < state.stars;
                }
            });
        }
    }

    /**
     * Set hover state for a node
     */
    setNodeHovered(levelId, hovered) {
        const node = this.nodes.get(levelId);
        if (!node) return;

        if (node.isGlassNode) {
            if (node.coreMaterial.uniforms) node.coreMaterial.uniforms.uHovered.value = hovered ? 1.0 : 0.0;
            node.glowMaterial.uniforms.uHovered.value = hovered ? 1.0 : 0.0;
            if (node.innerMesh?.material?.uniforms?.uHovered) {
                node.innerMesh.material.uniforms.uHovered.value = hovered ? 1.0 : 0.0;
            }

            // Scale up
            const targetScale = hovered ? 1.2 : 1.0;
            node.group.scale.setScalar(targetScale);

            // Maybe brighten glass?
            if (node.coreMaterial) {
                node.coreMaterial.color.setHex(hovered ? 0xffffff : 0xdddddd);
            }
        } else {
            node.coreMaterial.uniforms.uHovered.value = hovered ? 1.0 : 0.0;
            node.glowMaterial.uniforms.uHovered.value = hovered ? 1.0 : 0.0;

            // Scale up on hover
            const targetScale = hovered ? 1.2 : 1.0;
            node.group.scale.setScalar(targetScale);
        }

        this.hoveredNode = hovered ? node : null;
    }

    /**
     * Set selected state for a node
     */
    setNodeSelected(levelId, selected) {
        const node = this.nodes.get(levelId);
        if (!node) return;

        node.coreMaterial.uniforms.uSelected.value = selected ? 1.0 : 0.0;
        if (node.innerMesh?.material?.uniforms?.uSelected) {
            node.innerMesh.material.uniforms.uSelected.value = selected ? 1.0 : 0.0;
        }
        this.selectedNode = selected ? node : null;
    }

    /**
     * Get position of a node
     */
    getNodePosition(levelId) {
        const node = this.nodes.get(levelId);
        return node?.group.position.clone();
    }

    /**
     * Get projected screen-space metrics for a node's orb.
     * Used by the portal transition so the breach opens from the actual orb radius.
     * @param {number} levelId
     * @param {THREE.Camera} camera
     * @returns {{center: {x: number, y: number}, radius: number, onScreen: boolean, worldPosition: THREE.Vector3}|null}
     */
    getNodeCinematicMetrics(levelId, camera) {
        const node = this.nodes.get(levelId);
        if (!node?.group || !camera) {
            return null;
        }

        const worldPosition = new THREE.Vector3();
        const worldRight = new THREE.Vector3();
        const worldUp = new THREE.Vector3();
        const cameraQuaternion = new THREE.Quaternion();

        node.group.getWorldPosition(worldPosition);
        camera.getWorldQuaternion(cameraQuaternion);

        const scale = Math.max(
            Math.abs(node.group.scale.x || 1),
            Math.abs(node.group.scale.y || 1),
            Math.abs(node.group.scale.z || 1),
        );
        const orbRadiusWorld = GLASS_OUTER_RADIUS * scale;

        worldRight.set(1, 0, 0).applyQuaternion(cameraQuaternion).multiplyScalar(orbRadiusWorld);
        worldUp.set(0, 1, 0).applyQuaternion(cameraQuaternion).multiplyScalar(orbRadiusWorld);

        const centerNdc = worldPosition.clone().project(camera);
        const rightNdc = worldPosition.clone().add(worldRight).project(camera);
        const upNdc = worldPosition.clone().add(worldUp).project(camera);

        const center = {
            x: (centerNdc.x + 1) * 0.5,
            y: (1 - centerNdc.y) * 0.5,
        };
        const radiusX = Math.hypot(
            ((rightNdc.x + 1) * 0.5) - center.x,
            ((1 - rightNdc.y) * 0.5) - center.y,
        );
        const radiusY = Math.hypot(
            ((upNdc.x + 1) * 0.5) - center.x,
            ((1 - upNdc.y) * 0.5) - center.y,
        );
        const radius = Math.max(radiusX, radiusY);
        const onScreen = centerNdc.z >= -1
            && centerNdc.z <= 1
            && center.x >= 0
            && center.x <= 1
            && center.y >= 0
            && center.y <= 1
            && Number.isFinite(radius)
            && radius > 0;

        return {
            center,
            radius: Number.isFinite(radius) ? radius : 0,
            onScreen,
            worldPosition,
        };
    }

    /**
     * Raycast to find hovered node
     * @returns {number|null} Level ID or null
     */
    raycast(raycaster) {
        const meshes = [];
        this.nodes.forEach((node) => {
            if (!node.group.userData.locked) {
                meshes.push(node.coreMesh);
            }
        });

        const intersects = raycaster.intersectObjects(meshes);
        if (intersects.length > 0) {
            const { levelId } = intersects[0].object.parent.userData;
            return levelId;
        }
        return null;
    }

    /**
     * Update animation
     */
    update(deltaTime) {
        this.time += deltaTime;

        this.nodes.forEach((node) => {
            // Update time uniform
            node.coreMaterial.uniforms.uTime.value = this.time;
            if (node.innerMesh?.material?.uniforms?.uTime) {
                node.innerMesh.material.uniforms.uTime.value = this.time;
            }

            // Subtle floating animation
            if (!node.group.userData.locked) {
                node.group.position.y = this.pathCurve.getPointAt(node.pathPosition).y
                    + Math.sin(this.time * 2 + node.config.id) * 0.1;
            }

            if (node.particles?.material) {
                const lockSpeedMult = node.group.userData.locked ? 0.35 : 1.0;
                node.particles.rotation.x += deltaTime * 0.21 * lockSpeedMult;
                node.particles.rotation.y += deltaTime * 0.31 * lockSpeedMult;
                node.particles.material.opacity = 0.45 + Math.sin(this.time * 1.7 + node.config.id) * 0.1;
            }

            // Rotate completed nodes
            if (node.group.userData.completed) {
                node.coreMesh.rotation.y += deltaTime * 0.5;
            }
        });
    }

    /**
     * Dispose resources
     */
    dispose() {
        this.nodes.forEach((node) => {
            node.coreMesh.geometry.dispose();
            node.coreMaterial.dispose();
            node.glowMesh.geometry.dispose();
            node.glowMaterial.dispose();
            if (node.innerMesh?.geometry) node.innerMesh.geometry.dispose();
            if (node.innerMesh?.material) node.innerMesh.material.dispose();
            if (node.particles?.geometry) node.particles.geometry.dispose();
            if (node.particles?.material) node.particles.material.dispose();
            this.scene.remove(node.group);
        });
        this.themeTextureCache.forEach((texture) => texture.dispose());
        this.themeTextureCache.clear();
        if (this.fallbackIconTexture) {
            this.fallbackIconTexture.dispose();
            this.fallbackIconTexture = null;
        }
        this.nodes.clear();
    }
}

export default LevelNodeManager;
