/**
 * @fileoverview OdysseyAtmosphere — the board's single global atmosphere rig
 *
 * Part of the Odyssey AAA "Cosmic Ascent" overhaul (Phase 2 — unified atmosphere).
 * See docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §4.3.
 *
 * Replaces the board's scattered global lighting + flat clear-colour backdrop with
 * ONE director-driven rig so the whole ascent shares a consistent key light and
 * exposure, and so depth reads through aerial perspective (fog colour == the sky
 * horizon). It owns, all driven each frame by OdysseyDirector.getState():
 *
 *   • a graded SKY-DOME backstop (zenith = sky colour, horizon = fog colour),
 *   • the scene FOG (colour == horizon) + renderer clear colour,
 *   • a 3-part LIGHT RIG (key directional + ambient fill + cool rim),
 *   • subtle ENERGY reactivity (ambient lifts with energy, key ticks with beats).
 *
 * SCOPE (P2 increment): this owns the board *globals* only. Per-chapter environment
 * content (their own skies + local lights) is left intact — the dome is a backstop
 * behind them, and the key rig replaces only the board's former static white lights,
 * so light count stays neutral (no double-lighting from the board side). Stripping
 * per-chapter lights/sky is a later increment once this rig is validated.
 *
 * GLSL (not TSL): the board still uses THREE.WebGLRenderer (the WebGPU swap is
 * deferred until board materials are TSL — see plan §4.1 status note), so the dome
 * is a classic ShaderMaterial like the rest of the board.
 *
 * Active for the default cinematic Odyssey board; ?odysseyAAA=1 controls only the
 * debug overlay.
 */

import * as THREE from 'three';

const DOME_RADIUS = 4000; // inside camera far (9000); follows the camera each frame
const KEY_LIGHT_DISTANCE = 200;

export class OdysseyAtmosphere {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.WebGLRenderer} renderer
     */
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;

        // Scratch colours (never reallocated per frame).
        this._zenith = new THREE.Color();
        this._horizon = new THREE.Color();

        this._buildDome();
        this._buildLights();
    }

    _buildDome() {
        const geometry = new THREE.SphereGeometry(DOME_RADIUS, 32, 16);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uZenith: { value: new THREE.Color(0x0a0a1a) },
                uHorizon: { value: new THREE.Color(0x1a1020) },
                uEnergy: { value: 0 },
                uExposure: { value: 1.0 },
            },
            vertexShader: `
                varying vec3 vDir;
                void main() {
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uZenith;
                uniform vec3 uHorizon;
                uniform float uEnergy;
                uniform float uExposure;
                varying vec3 vDir;

                // Cheap screen-space dither to kill gradient banding.
                float dither(vec2 p) {
                    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
                }

                void main() {
                    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
                    float t = pow(h, 0.6);
                    vec3 color = mix(uHorizon, uZenith, t);

                    // Subtle horizon glow band + tiny energy lift near the horizon.
                    float glow = smoothstep(0.55, 0.0, abs(vDir.y));
                    color += uHorizon * glow * (0.12 + uEnergy * 0.10);

                    color *= uExposure;
                    color += dither(gl_FragCoord.xy) * (1.0 / 255.0);
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            fog: false,
        });

        this.dome = new THREE.Mesh(geometry, material);
        this.dome.name = 'odyssey-atmosphere-dome';
        this.dome.renderOrder = -10000; // draw first, behind everything
        this.dome.frustumCulled = false;
        this.scene.add(this.dome);
    }

    _buildLights() {
        this.ambient = new THREE.AmbientLight(0x404080, 0.35);
        this.ambient.name = 'odyssey-atmosphere-ambient';

        this.key = new THREE.DirectionalLight(0xffffff, 0.7);
        this.key.name = 'odyssey-atmosphere-key';
        this.key.position.set(0.3, 0.8, 0.5).multiplyScalar(KEY_LIGHT_DISTANCE);

        // Cool counter-fill so shadow sides never go dead black.
        this.fill = new THREE.DirectionalLight(0x3a4a7a, 0.18);
        this.fill.name = 'odyssey-atmosphere-fill';
        this.fill.position.set(-0.4, -0.2, -0.5).multiplyScalar(KEY_LIGHT_DISTANCE);

        this.scene.add(this.ambient);
        this.scene.add(this.key);
        this.scene.add(this.fill);

        this._baseAmbientIntensity = this.ambient.intensity;
        this._baseKeyIntensity = this.key.intensity;
    }

    /**
     * Drive the whole rig from director state. Safe to call with null state
     * (renders a neutral atmosphere).
     * @param {THREE.Camera} camera
     * @param {object} directorState - OdysseyDirector.getState()
     */
    update(camera, directorState) {
        const atmo = directorState?.atmosphere || null;
        const energy = directorState?.energy || 0;
        const beatPulse = directorState?.beatPulse || 0;

        // Keep the dome centred on the camera so it always surrounds the view.
        if (camera) this.dome.position.copy(camera.position);

        if (atmo) {
            this._zenith.copy(atmo.skyColor);
            this._horizon.copy(atmo.fogColor);
        } else {
            this._zenith.set(0x0a0a1a);
            this._horizon.set(0x1a1020);
        }

        // Dome gradient.
        const u = this.dome.material.uniforms;
        u.uZenith.value.copy(this._zenith);
        u.uHorizon.value.copy(this._horizon);
        u.uEnergy.value = energy;
        u.uExposure.value = atmo?.exposure ? Math.max(0.5, atmo.exposure) : 1.0;

        // Fog == horizon (aerial perspective) + clear colour matched to the horizon.
        const fogDensity = atmo ? atmo.fogDensity : 0.008;
        if (this.scene.fog instanceof THREE.FogExp2) {
            this.scene.fog.color.copy(this._horizon);
            this.scene.fog.density = fogDensity;
        } else {
            this.scene.fog = new THREE.FogExp2(this._horizon.clone(), fogDensity);
        }
        this.renderer?.setClearColor?.(this._horizon, 1);

        // Light rig — director-driven key + ambient + cool fill, energy-reactive.
        if (atmo) {
            this.ambient.color.copy(atmo.ambientColor);
            this.ambient.intensity = atmo.ambientIntensity * (1 + energy * 0.12);

            this.key.color.copy(atmo.lightColor);
            this.key.intensity = atmo.lightIntensity * (1 + beatPulse * 0.18);
            if (atmo.lightDir && atmo.lightDir.lengthSq() > 1e-6) {
                this.key.position.copy(atmo.lightDir).multiplyScalar(KEY_LIGHT_DISTANCE);
            }
        }
    }

    dispose() {
        if (this.dome) {
            this.dome.geometry.dispose();
            this.dome.material.dispose();
            this.scene.remove(this.dome);
            this.dome = null;
        }
        [this.ambient, this.key, this.fill].forEach((light) => {
            if (light) this.scene.remove(light);
        });
        this.ambient = null;
        this.key = null;
        this.fill = null;
    }
}

export default OdysseyAtmosphere;
