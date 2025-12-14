/**
 * @fileoverview JourneyPathRenderer - Renders the ascending path through chapters
 *
 * Creates a glowing 3D spline path that represents the player's journey
 * from Earth Core to Black Hole transcendence.
 */

import * as THREE from 'three';

/**
 * JourneyPathRenderer - Renders the cosmic ascent path
 */
export class JourneyPathRenderer {
    constructor(scene) {
        this.scene = scene;
        this.pathCurve = null;
        this.pathMesh = null;
        this.pathGlowMesh = null;
        this.chapterMarkers = [];
        this.progress = 0;
        this.time = 0;
    }

    /**
     * Build the path from control points
     * @param {Object} pathData - Path configuration data
     */
    async buildPath(pathData) {
        // Create CatmullRom spline from control points
        const points = pathData.controlPoints.map(
            (p) => new THREE.Vector3(p.x, p.y, p.z),
        );
        this.pathCurve = new THREE.CatmullRomCurve3(points);
        this.pathCurve.curveType = 'catmullrom';
        this.pathCurve.tension = 0.5;

        // Create tube geometry along path
        this.createPathTube(pathData);

        // Create outer glow tube
        this.createPathGlow(pathData);

        // Add chapter transition markers
        this.createChapterMarkers(pathData.chapterPositions);

        console.log('[JourneyPath] Path built with', points.length, 'control points');
    }

    createPathTube(pathData) {
        const geometry = new THREE.TubeGeometry(
            this.pathCurve,
            pathData.segments || 200,
            pathData.radius || 0.3,
            8,
            false,
        );

        // Custom shader material for animated path
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uProgress: { value: 0 },
                uColorStart: { value: new THREE.Color(0xff6600) }, // Earth Core
                uColorEnd: { value: new THREE.Color(0x6600ff) }, // Black Hole
                uEmission: { value: 1.2 },
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

                varying vec2 vUv;
                varying vec3 vNormal;

                void main() {
                    // Gradient along path
                    vec3 color = mix(uColorStart, uColorEnd, vUv.x);

                    // Progress illumination
                    float lit = step(vUv.x, uProgress);
                    float edgeGlow = smoothstep(uProgress - 0.05, uProgress, vUv.x) * (1.0 - step(uProgress, vUv.x));

                    // Pulse animation on lit portion
                    float pulse = sin(vUv.x * 20.0 - uTime * 2.0) * 0.2 + 0.8;

                    // Rim lighting
                    float rim = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
                    rim = pow(rim, 2.0);

                    // Final color
                    float intensity = (lit * pulse + edgeGlow * 2.0 + rim * 0.5) * uEmission;
                    vec3 finalColor = color * intensity;

                    // Dim unlit portion
                    finalColor = mix(color * 0.2, finalColor, max(lit, edgeGlow));

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,
            transparent: false,
        });

        this.pathMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.pathMesh);
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
                varying vec2 vUv;

                void main() {
                    float lit = step(vUv.x, uProgress);
                    float pulse = sin(vUv.x * 30.0 - uTime * 3.0) * 0.3 + 0.7;
                    float alpha = lit * pulse * 0.15;
                    gl_FragColor = vec4(uColor, alpha);
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

        if (this.pathGlowMesh) {
            this.pathGlowMesh.material.uniforms.uTime.value = this.time;
            this.pathGlowMesh.material.uniforms.uProgress.value = this.progress;
        }

        // Rotate chapter markers subtly
        this.chapterMarkers.forEach((ring, i) => {
            ring.rotation.z += deltaTime * 0.2 * (i % 2 === 0 ? 1 : -1);
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
        }

        if (this.pathGlowMesh) {
            this.pathGlowMesh.geometry.dispose();
            this.pathGlowMesh.material.dispose();
            this.scene.remove(this.pathGlowMesh);
        }

        this.chapterMarkers.forEach((ring) => {
            ring.geometry.dispose();
            ring.material.dispose();
            this.scene.remove(ring);
        });
    }
}

export default JourneyPathRenderer;
