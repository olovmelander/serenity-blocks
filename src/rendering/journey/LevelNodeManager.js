/**
 * @fileoverview LevelNodeManager - Manages level node orbs along the path
 *
 * Creates interactive 3D representations for each level,
 * showing state (locked/unlocked/completed) and stars.
 */

import * as THREE from 'three';

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
        const group = new THREE.Group();
        group.userData.levelId = levelConfig.id;
        group.userData.locked = true;
        group.userData.completed = false;
        group.userData.stars = 0;

        // Position along path
        const pathPosition = levelConfig.pathPosition || (levelConfig.id - 1) / 55;
        const point = this.pathCurve.getPointAt(THREE.MathUtils.clamp(pathPosition, 0, 1));
        group.position.copy(point);

        // Slight offset perpendicular to path for visual spacing
        const tangent = this.pathCurve.getTangentAt(pathPosition);
        const offset = new THREE.Vector3(-tangent.y, tangent.x, 0).multiplyScalar(2);
        group.position.add(offset);

        // Core orb geometry
        const coreGeometry = new THREE.IcosahedronGeometry(0.6, 2);
        const coreMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: this.getChapterColor(levelConfig.chapter || 1) },
                uLocked: { value: 1.0 },
                uCompleted: { value: 0.0 },
                uHovered: { value: 0.0 },
                uSelected: { value: 0.0 },
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform vec3 uColor;
                uniform float uLocked;
                uniform float uCompleted;
                uniform float uHovered;
                uniform float uSelected;

                varying vec3 vNormal;
                varying vec3 vPosition;

                void main() {
                    // Base color with rim lighting
                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 2.0);

                    vec3 color = uColor;

                    // Locked = grayscale
                    float gray = dot(color, vec3(0.299, 0.587, 0.114));
                    color = mix(color, vec3(gray * 0.5), uLocked);

                    // Completed = brighter with pulse
                    float pulse = sin(uTime * 3.0) * 0.1 + 0.9;
                    color = mix(color, color * 1.5 * pulse, uCompleted);

                    // Hover/selection effects
                    float glow = uHovered * 0.3 + uSelected * 0.5;
                    color += vec3(glow);

                    // Rim highlight
                    color += rim * 0.3;

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            transparent: false,
        });

        const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
        group.add(coreMesh);

        // Outer glow shell
        const glowGeometry = new THREE.IcosahedronGeometry(0.9, 2);
        const glowMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: this.getChapterColor(levelConfig.chapter || 1) },
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

        // Lock icon (for locked levels)
        const lockGroup = this.createLockIcon();
        lockGroup.visible = true;
        group.add(lockGroup);

        // Star indicators (for completed levels)
        const starGroup = this.createStarIndicators();
        starGroup.visible = false;
        group.add(starGroup);

        return {
            group,
            coreMesh,
            coreMaterial,
            glowMesh,
            glowMaterial,
            lockGroup,
            starGroup,
            config: levelConfig,
            pathPosition,
        };
    }

    createLockIcon() {
        const group = new THREE.Group();

        // Simple lock representation using basic shapes
        const bodyGeometry = new THREE.BoxGeometry(0.3, 0.25, 0.1);
        const shackleGeometry = new THREE.TorusGeometry(0.12, 0.03, 8, 16, Math.PI);

        const material = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.7,
            roughness: 0.3,
        });

        const body = new THREE.Mesh(bodyGeometry, material);
        body.position.set(0, 0.9, 0);

        const shackle = new THREE.Mesh(shackleGeometry, material);
        shackle.position.set(0, 1.05, 0);
        shackle.rotation.x = Math.PI / 2;

        group.add(body);
        group.add(shackle);

        return group;
    }

    createStarIndicators() {
        const group = new THREE.Group();

        // Three star positions
        const starPositions = [
            new THREE.Vector3(-0.4, 1.0, 0),
            new THREE.Vector3(0, 1.2, 0),
            new THREE.Vector3(0.4, 1.0, 0),
        ];

        starPositions.forEach((pos, i) => {
            const starGeometry = new THREE.OctahedronGeometry(0.12, 0);
            const starMaterial = new THREE.MeshStandardMaterial({
                color: 0xffdd00,
                emissive: 0xffaa00,
                emissiveIntensity: 0.5,
            });

            const star = new THREE.Mesh(starGeometry, starMaterial);
            star.position.copy(pos);
            star.name = `star_${i}`;
            star.visible = false;

            group.add(star);
        });

        return group;
    }

    getChapterColor(chapter) {
        const colors = [
            new THREE.Color(0xff6600), // Ch1: Earth Core - Orange
            new THREE.Color(0x0066ff), // Ch2: Deep Ocean - Blue
            new THREE.Color(0x00ff66), // Ch3: Surface - Green
            new THREE.Color(0xaaaaff), // Ch4: Mountains - Light Blue
            new THREE.Color(0xffff66), // Ch5: Sky - Yellow
            new THREE.Color(0x9966ff), // Ch6: Space - Purple
            new THREE.Color(0xff00ff), // Ch7: Black Hole - Magenta
            new THREE.Color(0x00ffff), // Ch8: Urban Dreams - Cyan
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

        // Toggle and update star indicators
        node.starGroup.visible = state.completed && state.stars > 0;
        if (node.starGroup.visible) {
            node.starGroup.children.forEach((star, i) => {
                star.visible = i < state.stars;
            });
        }
    }

    /**
     * Set hover state for a node
     */
    setNodeHovered(levelId, hovered) {
        const node = this.nodes.get(levelId);
        if (!node) return;

        node.coreMaterial.uniforms.uHovered.value = hovered ? 1.0 : 0.0;
        node.glowMaterial.uniforms.uHovered.value = hovered ? 1.0 : 0.0;

        // Scale up on hover
        const targetScale = hovered ? 1.2 : 1.0;
        node.group.scale.setScalar(targetScale);

        this.hoveredNode = hovered ? node : null;
    }

    /**
     * Set selected state for a node
     */
    setNodeSelected(levelId, selected) {
        const node = this.nodes.get(levelId);
        if (!node) return;

        node.coreMaterial.uniforms.uSelected.value = selected ? 1.0 : 0.0;
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

            // Subtle floating animation
            if (!node.group.userData.locked) {
                node.group.position.y = this.pathCurve.getPointAt(node.pathPosition).y
                    + Math.sin(this.time * 2 + node.config.id) * 0.1;
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
            this.scene.remove(node.group);
        });
        this.nodes.clear();
    }
}

export default LevelNodeManager;
