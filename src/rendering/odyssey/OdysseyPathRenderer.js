/**
 * @fileoverview OdysseyPathRenderer - Renders the ascending path through chapters
 *
 * Creates a glowing 3D spline path that represents the player's odyssey
 * from Earth Core to Black Hole transcendence.
 */

import * as THREE from 'three';
import { buildOdysseyPathCurve } from './path-utils.js';

/**
 * OdysseyPathRenderer - Renders the cosmic ascent path
 */
export class OdysseyPathRenderer {
    constructor(scene) {
        this.scene = scene;
        this.pathCurve = null;
        this.pathMesh = null;
        this.pathCoreMesh = null; // Inner glowing core
        this.pathGlowMesh = null;
        this.chapterMarkers = [];
        this.progress = 0;
        this.time = 0;
        this.chapterTransition = null;
        this.transitionResetColor = new THREE.Color(0xffffff);
    }

    /**
     * Build the path from control points
     * @param {Object} pathData - Path configuration data
     */
    async buildPath(pathData) {
        this.pathCurve = buildOdysseyPathCurve(pathData);

        // Create tube geometry along path
        this.createPathTube(pathData);

        // Create outer glow tube
        this.createPathGlow(pathData);

        // Add chapter transition markers
        this.createChapterMarkers(pathData.chapterPositions);

        console.log('[OdysseyPath] Path built with', pathData.controlPoints.length, 'control points');
    }

    async rebuildPath(pathData) {
        const { progress } = this;
        this.dispose();
        await this.buildPath(pathData);
        this.setProgress(progress);
    }

    createPathTube(pathData) {
        // ═══════════════════════════════════════════════════════════════════
        // OUTER PATH TUBE - Main visible path
        // ═══════════════════════════════════════════════════════════════════
        const outerRadius = pathData.radius || 0.6; // Increased from 0.3
        const geometry = new THREE.TubeGeometry(
            this.pathCurve,
            pathData.segments || 300,
            outerRadius,
            16, // More radial segments for smoother tube
            false,
        );

        // Enhanced shader material with brighter emission
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uColorStart: { value: new THREE.Color(0xff6600) }, // Earth Core
                uColorEnd: { value: new THREE.Color(0x6600ff) }, // Black Hole
                uEmission: { value: 1.8 }, // Increased from 1.2
                uTransitionColor: { value: new THREE.Color(0xffffff) },
                uTransitionMix: { value: 0 },
                uTransitionHead: { value: 0.5 },
                uTransitionWidth: { value: 0.08 },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormal;

                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uProgress;
                uniform vec3 uColorStart;
                uniform vec3 uColorEnd;
                uniform float uEmission;
                uniform vec3 uTransitionColor;
                uniform float uTransitionMix;
                uniform float uTransitionHead;
                uniform float uTransitionWidth;

                varying vec2 vUv;
                varying vec3 vNormal;

                void main() {
                    // Gradient along path
                    vec3 color = mix(uColorStart, uColorEnd, vUv.x);

                    // Progress illumination
                    float lit = step(vUv.x, uProgress);
                    float edgeGlow = smoothstep(uProgress - 0.05, uProgress, vUv.x) * (1.0 - step(uProgress, vUv.x));

                    // Pulse animation on lit portion
                    float pulse = sin(vUv.x * 20.0 - uTime * 2.0) * 0.15 + 0.85;

                    // Rim lighting - enhanced
                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 1.5); // Softer rim falloff

                    // Final color - BRIGHTER base emission
                    float baseGlow = 0.5; // Minimum brightness for unlit (was 0.2)
                    float intensity = (lit * pulse + edgeGlow * 2.0 + rim * 0.6) * uEmission;
                    vec3 finalColor = color * intensity;

                    float transitionBand = 1.0 - smoothstep(0.0, uTransitionWidth, abs(vUv.x - uTransitionHead));
                    finalColor = mix(
                        finalColor,
                        mix(finalColor, uTransitionColor * (intensity + 0.65), 0.8),
                        transitionBand * uTransitionMix
                    );

                    // Brighter unlit portion
                    finalColor = mix(color * baseGlow, finalColor, max(lit, edgeGlow * 0.5 + 0.5));

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            transparent: false,
        });

        this.pathMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.pathMesh);

        // ═══════════════════════════════════════════════════════════════════
        // INNER CORE - Bright glowing center line
        // ═══════════════════════════════════════════════════════════════════
        const coreRadius = outerRadius * 0.3; // Inner core is 30% of outer
        const coreGeometry = new THREE.TubeGeometry(
            this.pathCurve,
            pathData.segments || 300,
            coreRadius,
            8,
            false,
        );

        const coreMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uColorStart: { value: new THREE.Color(0xffaa44) }, // Brighter orange
                uColorEnd: { value: new THREE.Color(0xaa66ff) }, // Brighter purple
                uTransitionColor: { value: new THREE.Color(0xffffff) },
                uTransitionMix: { value: 0 },
                uTransitionHead: { value: 0.5 },
                uTransitionWidth: { value: 0.06 },
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
                uniform float uProgress;
                uniform vec3 uColorStart;
                uniform vec3 uColorEnd;
                uniform vec3 uTransitionColor;
                uniform float uTransitionMix;
                uniform float uTransitionHead;
                uniform float uTransitionWidth;
                varying vec2 vUv;

                void main() {
                    vec3 color = mix(uColorStart, uColorEnd, vUv.x);
                    float lit = step(vUv.x, uProgress);
                    float pulse = sin(vUv.x * 30.0 - uTime * 4.0) * 0.2 + 0.8;
                    float transitionBand = 1.0 - smoothstep(0.0, uTransitionWidth, abs(vUv.x - uTransitionHead));
                    
                    // Core is always bright, even brighter when lit
                    float intensity = 0.8 + lit * pulse * 0.5;
                    vec3 finalColor = color * intensity * 2.0;
                    finalColor = mix(finalColor, uTransitionColor * (2.2 + pulse), transitionBand * uTransitionMix);
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            transparent: false,
        });

        this.pathCoreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
        this.scene.add(this.pathCoreMesh);
    }

    createPathGlow(pathData) {
        const geometry = new THREE.TubeGeometry(
            this.pathCurve,
            pathData.segments || 200,
            (pathData.radius || 0.3) * 2,
            8,
            false,
        );

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uColor: { value: new THREE.Color(0x4488ff) },
                uTransitionColor: { value: new THREE.Color(0xffffff) },
                uTransitionMix: { value: 0 },
                uTransitionHead: { value: 0.5 },
                uTransitionWidth: { value: 0.1 },
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
                uniform float uProgress;
                uniform vec3 uColor;
                uniform vec3 uTransitionColor;
                uniform float uTransitionMix;
                uniform float uTransitionHead;
                uniform float uTransitionWidth;
                varying vec2 vUv;

                void main() {
                    float lit = step(vUv.x, uProgress);
                    float pulse = sin(vUv.x * 30.0 - uTime * 3.0) * 0.3 + 0.7;
                    float transitionBand = 1.0 - smoothstep(0.0, uTransitionWidth, abs(vUv.x - uTransitionHead));
                    float alpha = lit * pulse * 0.15 + (transitionBand * uTransitionMix * 0.25);
                    vec3 color = mix(uColor, uTransitionColor, transitionBand * uTransitionMix);
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
        });

        this.pathGlowMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.pathGlowMesh);
    }

    createChapterMarkers(chapterPositions) {
        const chapterColors = [
            0xff6600, // Ch1: Earth Core - Orange
            0x0066ff, // Ch2: Deep Ocean - Blue
            0x00ff66, // Ch3: Surface - Green
            0xffffff, // Ch4: Mountains - White
            0xffff66, // Ch5: Sky - Yellow
            0x6600ff, // Ch6: Space - Purple
            0x000000, // Ch7: Black Hole - Black (with glow)
            0x00ffff, // Ch8: Urban Dreams - Cyan
        ];

        chapterPositions.forEach((pos, index) => {
            if (index >= chapterColors.length) {
                return;
            }

            const point = this.pathCurve.getPointAt(pos);

            // Create ring marker
            const geometry = new THREE.TorusGeometry(1.5, 0.1, 8, 32);
            const material = new THREE.MeshStandardMaterial({
                color: chapterColors[index],
                emissive: chapterColors[index],
                emissiveIntensity: 0.5,
            });

            const ring = new THREE.Mesh(geometry, material);
            ring.position.copy(point);

            // Orient ring to face along path
            const tangent = this.pathCurve.getTangentAt(pos);
            ring.lookAt(point.clone().add(tangent));

            this.chapterMarkers.push(ring);
            this.scene.add(ring);
        });
    }

    /**
     * Set player progress along path
     * @param {number} normalizedProgress - 0 to 1
     */
    setProgress(normalizedProgress) {
        this.progress = THREE.MathUtils.clamp(normalizedProgress, 0, 1);
    }

    getChapterColor(chapterId) {
        const palette = [
            0xff6600,
            0x0066ff,
            0x00ff66,
            0xffffff,
            0xffff66,
            0x6600ff,
            0xff33cc,
            0x00ffff,
        ];
        return new THREE.Color(palette[(chapterId - 1) % palette.length]);
    }

    triggerChapterTransition({
        fromChapter,
        toChapter,
        direction = 1,
        boundaryPosition = 0.5,
        durationMs = 850,
    } = {}) {
        this.chapterTransition = {
            active: true,
            startTime: performance.now(),
            duration: Math.max(1, durationMs),
            direction: Math.sign(direction) || 1,
            fromChapter,
            toChapter,
            boundaryPosition: THREE.MathUtils.clamp(boundaryPosition ?? 0.5, 0, 1),
            incomingColor: this.getChapterColor(toChapter || fromChapter || 1),
        };
    }

    /**
     * Get position on path at normalized t
     * @param {number} t - 0 to 1
     * @returns {THREE.Vector3}
     */
    getPointAt(t) {
        return this.pathCurve?.getPointAt(THREE.MathUtils.clamp(t, 0, 1));
    }

    /**
     * Update animation
     * @param {number} deltaTime
     */
    update(deltaTime) {
        this.time += deltaTime;

        if (this.pathMesh) {
            this.pathMesh.material.uniforms.uTime.value = this.time;
            this.pathMesh.material.uniforms.uProgress.value = this.progress;
        }

        // Update inner core
        if (this.pathCoreMesh) {
            this.pathCoreMesh.material.uniforms.uTime.value = this.time;
            this.pathCoreMesh.material.uniforms.uProgress.value = this.progress;
        }

        if (this.pathGlowMesh) {
            this.pathGlowMesh.material.uniforms.uTime.value = this.time;
            this.pathGlowMesh.material.uniforms.uProgress.value = this.progress;
        }

        this.updateChapterTransition();

        // Rotate chapter markers subtly
        this.chapterMarkers.forEach((ring, i) => {
            ring.rotation.z += deltaTime * 0.2 * (i % 2 === 0 ? 1 : -1);
        });
    }

    updateChapterTransition() {
        if (!this.chapterTransition?.active) {
            this.applyTransitionUniforms(0, 0.5, 0.08, this.transitionResetColor);
            this.chapterMarkers.forEach((ring, index) => {
                const { material } = ring;
                const chapterColor = this.getChapterColor(index + 1);
                material.emissive.copy(chapterColor);
                material.emissiveIntensity = 0.5;
                ring.scale.setScalar(1);
            });
            return;
        }

        const elapsed = performance.now() - this.chapterTransition.startTime;
        const rawProgress = THREE.MathUtils.clamp(elapsed / this.chapterTransition.duration, 0, 1);
        const envelope = Math.sin(rawProgress * Math.PI);
        const head = THREE.MathUtils.clamp(
            this.chapterTransition.boundaryPosition
                + (rawProgress - 0.35) * 0.18 * this.chapterTransition.direction,
            0,
            1,
        );
        this.applyTransitionUniforms(
            envelope,
            head,
            0.08 + ((1 - rawProgress) * 0.04),
            this.chapterTransition.incomingColor,
        );

        this.chapterMarkers.forEach((ring, index) => {
            const chapterId = index + 1;
            const { material } = ring;
            const chapterColor = this.getChapterColor(chapterId);
            material.emissive.copy(chapterColor);
            if (chapterId === this.chapterTransition.toChapter) {
                material.emissive.lerp(this.chapterTransition.incomingColor, 0.35);
                material.emissiveIntensity = 0.5 + (envelope * 1.1);
                ring.scale.setScalar(1 + (envelope * 0.25));
            } else if (chapterId === this.chapterTransition.fromChapter) {
                material.emissiveIntensity = 0.5 + (envelope * 0.45);
                ring.scale.setScalar(1 + (envelope * 0.12));
            } else {
                material.emissiveIntensity = 0.5;
                ring.scale.setScalar(1);
            }
        });

        if (rawProgress >= 1) {
            this.chapterTransition.active = false;
        }
    }

    applyTransitionUniforms(transitionMix, head, width, color) {
        const targets = [
            this.pathMesh?.material?.uniforms,
            this.pathCoreMesh?.material?.uniforms,
            this.pathGlowMesh?.material?.uniforms,
        ].filter(Boolean);

        targets.forEach((uniforms) => {
            uniforms.uTransitionMix.value = transitionMix;
            uniforms.uTransitionHead.value = head;
            uniforms.uTransitionWidth.value = width;
            uniforms.uTransitionColor.value.copy(color);
        });
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.pathMesh) {
            this.pathMesh.geometry.dispose();
            this.pathMesh.material.dispose();
            this.scene.remove(this.pathMesh);
            this.pathMesh = null;
        }

        if (this.pathCoreMesh) {
            this.pathCoreMesh.geometry.dispose();
            this.pathCoreMesh.material.dispose();
            this.scene.remove(this.pathCoreMesh);
            this.pathCoreMesh = null;
        }

        if (this.pathGlowMesh) {
            this.pathGlowMesh.geometry.dispose();
            this.pathGlowMesh.material.dispose();
            this.scene.remove(this.pathGlowMesh);
            this.pathGlowMesh = null;
        }

        this.chapterMarkers.forEach((ring) => {
            ring.geometry.dispose();
            ring.material.dispose();
            this.scene.remove(ring);
        });
        this.chapterMarkers = [];
        this.pathCurve = null;
    }
}

export default OdysseyPathRenderer;
