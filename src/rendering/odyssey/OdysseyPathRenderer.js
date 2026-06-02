/**
 * @fileoverview OdysseyPathRenderer - Renders the ascending path through chapters
 *
 * Creates a glowing 3D spline path that represents the player's odyssey
 * from Earth Core to Black Hole transcendence.
 */

import * as THREE from 'three';
import { buildOdysseyPathCurve } from './path-utils.js';
import {
    ODYSSEY_CHAPTER_PROFILES,
    ODYSSEY_PATH_STYLES,
} from './chapter-environments/shared/chapter-profile.js';

// Map each path style to a shader style index (P3 — diegetic path, plan §4.4).
const PATH_STYLE_INDEX = {
    [ODYSSEY_PATH_STYLES.LAVA_CRUST]: 0,
    [ODYSSEY_PATH_STYLES.CAUSTIC_CURRENT]: 1,
    [ODYSSEY_PATH_STYLES.LEY_LINE]: 2,
    [ODYSSEY_PATH_STYLES.CAIRN_RIDGE]: 3,
    [ODYSSEY_PATH_STYLES.JET_STREAM]: 4,
    [ODYSSEY_PATH_STYLES.STELLAR_STREAM]: 5,
    [ODYSSEY_PATH_STYLES.HORIZON_FILAMENT]: 6,
    [ODYSSEY_PATH_STYLES.NEON_DATA_LINE]: 7,
};

// GLSL chunk: per-chapter colour lookup along the path + per-style surface pattern.
// Injected into the outer + core fragment shaders only when the AAA path is active.
const PATH_CHAPTER_GLSL = `
    uniform float uChapterBounds[9];
    uniform vec3 uChapterBase[8];
    uniform vec3 uChapterEmissive[8];
    uniform float uChapterStyle[8];
    uniform float uFlow;   // director flow strength
    uniform float uHead;   // player progress (flow target)
    uniform float uBeat;   // beat pulse 0..1

    float pr_hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float pr_vnoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = pr_hash21(i), b = pr_hash21(i + vec2(1.0, 0.0));
        float c = pr_hash21(i + vec2(0.0, 1.0)), d = pr_hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void chapterAt(float x, out vec3 baseCol, out vec3 emisCol, out float styleId) {
        baseCol = uChapterBase[0]; emisCol = uChapterEmissive[0]; styleId = uChapterStyle[0];
        for (int i = 0; i < 8; i++) {
            float lo = uChapterBounds[i];
            float hi = uChapterBounds[i + 1];
            if (x >= lo && x <= hi) {
                baseCol = uChapterBase[i]; emisCol = uChapterEmissive[i]; styleId = uChapterStyle[i];
                float seam = 0.012;
                if (i < 7 && x > hi - seam) {
                    float t = smoothstep(hi - seam, hi, x);
                    baseCol = mix(baseCol, uChapterBase[i + 1], t);
                    emisCol = mix(emisCol, uChapterEmissive[i + 1], t);
                    styleId = mix(styleId, uChapterStyle[i + 1], step(0.5, t));
                }
            }
        }
    }

    // Per-world surface character. uv.x = along path, uv.y = around tube.
    float stylePattern(float styleId, vec2 uv, float t) {
        float s = styleId + 0.5;
        if (s < 1.0) { // lavaCrust — cracked molten cells
            float n = pr_vnoise(vec2(uv.x * 60.0, uv.y * 8.0));
            float cracks = smoothstep(0.44, 0.5, n) - smoothstep(0.5, 0.56, n);
            return 0.7 + cracks * 2.4 + pr_vnoise(vec2(uv.x * 130.0, uv.y * 12.0)) * 0.2;
        } else if (s < 2.0) { // causticCurrent — flowing caustic stripes
            float c = sin(uv.x * 38.0 - t * 2.0) * sin(uv.y * 10.0 + t * 0.7);
            return 0.8 + c * c * 0.7;
        } else if (s < 3.0) { // leyLine — travelling dashes
            float d = fract(uv.x * 26.0 - t * 0.4);
            float dash = smoothstep(0.0, 0.12, d) * smoothstep(0.55, 0.4, d);
            return 0.6 + dash * 1.3;
        } else if (s < 4.0) { // cairnRidge — stone with bright veins
            float v = smoothstep(0.47, 0.5, pr_vnoise(vec2(uv.x * 24.0, uv.y * 4.0)));
            return 0.65 + v * 1.4;
        } else if (s < 5.0) { // jetStream — wind streaks along length
            float st = sin(uv.x * 9.0 + uv.y * 2.0 - t * 3.0) * 0.5 + 0.5;
            return 0.7 + st * 0.7;
        } else if (s < 6.0) { // stellarStream — sparkle particle river
            float sp = pr_hash21(floor(vec2(uv.x * 80.0, uv.y * 16.0)) + floor(t * 4.0));
            return 0.7 + step(0.93, sp) * 2.2;
        } else if (s < 7.0) { // horizonFilament — stretched lensing streaks
            float l = sin(uv.x * 48.0 - t * 4.0) * 0.5 + 0.5;
            return 0.7 + pow(l, 3.0) * 1.1;
        }
        // neonDataLine — scanline data segments
        float sc = step(0.5, fract(uv.x * 46.0 - t * 1.4));
        return 0.6 + sc * 0.85;
    }
`;

/**
 * OdysseyPathRenderer - Renders the cosmic ascent path
 */
export class OdysseyPathRenderer {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.aaa = !!options.aaa; // P3: diegetic per-chapter path (?odysseyAAA=1)
        this.pathCurve = null;
        this.pathMesh = null;
        this.pathCoreMesh = null; // Inner glowing core
        this.pathGlowMesh = null;
        this.chapterMarkers = [];
        this.progress = 0;
        this.time = 0;
        this.chapterTransition = null;
        this.transitionResetColor = new THREE.Color(0xffffff);
        this._chapterUniforms = null; // built in buildPath when aaa
    }

    /**
     * Build shared per-chapter uniform values (bounds, base/emissive colours, style)
     * from the chapter profiles + the layout's chapter positions.
     * @param {number[]} chapterPositions
     */
    _buildChapterUniforms(chapterPositions = []) {
        const bounds = chapterPositions.filter((p) => Number.isFinite(p));
        // bounds must have 9 entries: 8 chapter starts + a trailing 1.0.
        while (bounds.length < 9) bounds.push(1);
        if (bounds[bounds.length - 1] < 1) bounds.push(1);

        const base = [];
        const emissive = [];
        const style = [];
        for (let i = 0; i < 8; i += 1) {
            const profile = ODYSSEY_CHAPTER_PROFILES[i] || ODYSSEY_CHAPTER_PROFILES[0];
            base.push(new THREE.Color(profile.path.baseColor));
            emissive.push(new THREE.Color(profile.path.emissiveColor));
            style.push(PATH_STYLE_INDEX[profile.path.style] ?? 0);
        }

        this._chapterUniforms = {
            uChapterBounds: { value: bounds.slice(0, 9) },
            uChapterBase: { value: base },
            uChapterEmissive: { value: emissive },
            uChapterStyle: { value: style },
            uFlow: { value: 0 },
            uHead: { value: 0 },
            uBeat: { value: 0 },
        };
    }

    /**
     * Build the path from control points
     * @param {Object} pathData - Path configuration data
     */
    async buildPath(pathData) {
        this.pathCurve = buildOdysseyPathCurve(pathData);

        // P3: build per-chapter path uniforms (diegetic colour/style) when AAA active.
        if (this.aaa) {
            this._buildChapterUniforms(pathData.chapterPositions);
        }

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

        // Enhanced shader material with brighter emission.
        // P3: when AAA active, the per-chapter diegetic colour/style branch (injected
        // GLSL + uniforms) replaces the fixed orange→purple gradient.
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
                ...(this.aaa ? this._chapterUniforms : {}),
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
                ${this.aaa ? PATH_CHAPTER_GLSL : ''}

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

                    ${this.aaa ? `
                    // ── AAA: per-chapter diegetic path (colour + per-world surface) ──
                    vec3 aaaBase; vec3 aaaEmis; float aaaStyle;
                    chapterAt(vUv.x, aaaBase, aaaEmis, aaaStyle);
                    float pat = stylePattern(aaaStyle, vUv, uTime);
                    // flow pulse travelling toward the head (player progress)
                    float flow = sin((vUv.x - uHead) * 55.0 - uTime * (2.0 + uFlow * 3.0));
                    float flowGlow = smoothstep(0.2, 1.0, flow) * 0.35 * lit;
                    vec3 aaaColor = mix(aaaBase * 0.5, mix(aaaBase, aaaEmis, 0.65) * pat, max(lit, 0.4));
                    aaaColor += aaaEmis * (rim * 0.5 + flowGlow + uBeat * 0.18 + edgeGlow * 1.5);
                    aaaColor *= uEmission;
                    aaaColor = mix(
                        aaaColor,
                        mix(aaaColor, uTransitionColor * (1.4 + pat), 0.8),
                        transitionBand * uTransitionMix
                    );
                    finalColor = aaaColor;
                    ` : ''}

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
                ...(this.aaa ? this._chapterUniforms : {}),
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
                ${this.aaa ? PATH_CHAPTER_GLSL : ''}

                void main() {
                    vec3 color = mix(uColorStart, uColorEnd, vUv.x);
                    float lit = step(vUv.x, uProgress);
                    float pulse = sin(vUv.x * 30.0 - uTime * 4.0) * 0.2 + 0.8;
                    float transitionBand = 1.0 - smoothstep(0.0, uTransitionWidth, abs(vUv.x - uTransitionHead));

                    // Core is always bright, even brighter when lit
                    float intensity = 0.8 + lit * pulse * 0.5;
                    vec3 finalColor = color * intensity * 2.0;

                    ${this.aaa ? `
                    // AAA: bright inner core uses the chapter emissive colour.
                    vec3 cBase; vec3 cEmis; float cStyle;
                    chapterAt(vUv.x, cBase, cEmis, cStyle);
                    finalColor = cEmis * intensity * 2.0 + cEmis * uBeat * 0.3;
                    ` : ''}

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
                ...(this.aaa ? this._chapterUniforms : {}),
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
                ${this.aaa ? PATH_CHAPTER_GLSL : ''}

                void main() {
                    float lit = step(vUv.x, uProgress);
                    float pulse = sin(vUv.x * 30.0 - uTime * 3.0) * 0.3 + 0.7;
                    float transitionBand = 1.0 - smoothstep(0.0, uTransitionWidth, abs(vUv.x - uTransitionHead));
                    float alpha = lit * pulse * 0.15 + (transitionBand * uTransitionMix * 0.25);
                    vec3 glowColor = uColor;

                    ${this.aaa ? `
                    // AAA: per-chapter glow halo tinted by the chapter emissive colour.
                    vec3 gBase; vec3 gEmis; float gStyle;
                    chapterAt(vUv.x, gBase, gEmis, gStyle);
                    glowColor = gEmis;
                    alpha += uBeat * 0.06 * lit;
                    ` : ''}

                    vec3 color = mix(glowColor, uTransitionColor, transitionBand * uTransitionMix);
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
     * @param {object} [directorState] - OdysseyDirector.getState() (AAA flow/beat)
     */
    update(deltaTime, directorState = null) {
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

        // P3: drive the diegetic flow toward the head + beat pulse from director state.
        if (this.aaa && this._chapterUniforms) {
            this._chapterUniforms.uHead.value = this.progress;
            this._chapterUniforms.uFlow.value = directorState?.path?.flowSpeed ?? 0;
            this._chapterUniforms.uBeat.value = directorState?.path?.beatPulse ?? 0;
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
