/* eslint-disable import/no-unresolved */
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
 *   • the renderer clear colour (matched to the horizon for aerial perspective),
 *   • a 3-part LIGHT RIG (key directional + ambient fill + cool rim),
 *   • subtle ENERGY reactivity (ambient lifts with energy, key ticks with beats).
 *
 * SCOPE (P2 increment): this owns the board *globals* only. Per-chapter environment
 * content (their own skies + local lights) is left intact — the dome is a backstop
 * behind them, and the key rig replaces only the board's former static white lights,
 * so light count stays neutral (no double-lighting from the board side). Stripping
 * per-chapter lights/sky is a later increment once this rig is validated.
 *
 * WebGPU (TSL): the board now uses THREE.WebGPURenderer with a TSL post pipeline,
 * so the dome is built from the validated TSL builder
 * (composition/odyssey-atmosphere-dome.tsl.js → createOdysseyAtmosphereDomeTSL),
 * a MeshBasicNodeMaterial. The light rig + fog stay core THREE (work as-is on
 * three/webgpu). The colour/energy/exposure uniforms are still driven each frame
 * from OdysseyDirector state exactly as before.
 *
 * Active for the default cinematic Odyssey board; ?odysseyAAA=1 controls only the
 * debug overlay.
 *
 * PERF / OVERDRAW (Odyssey perf pass, Batch 3):
 *   The dome is a camera-locked r=4000 surround at renderOrder -10000, so it paints
 *   the whole screen first, every frame. Two things keep that cost in check here:
 *     1. It is a single low-cost MeshBasicNodeMaterial (a cheap zenith→horizon
 *        gradient + one smoothstep glow band — no FBM, no lighting, fog/toneMap off).
 *     2. depthTest is now ON (depthWrite stays off) so it is early-Z ELIGIBLE — see
 *        _buildDome(). Drawn first today it still passes everywhere → identical look.
 *   Confirmed NOT double-drawn from this rig: exactly one dome, added to the scene
 *   once, never re-added. (It IS, however, redundantly overpainted by any chapter's
 *   own full-coverage opaque sky dome at -100 — that genuine double-draw is addressed
 *   in Wave 2 via setDomeVisible(), below.)
 *
 *   WAVE 2 ROUTING: this full-res surround should ultimately be hidden via
 *   setDomeVisible(false) and its low-frequency gradient rendered by the half-res
 *   off-screen transparency pass (perf plan §3b). The clear colour is still driven to
 *   the horizon every frame, so hiding the dome leaves the backdrop intact. Geometry
 *   sizing and a true footprint cut (e.g. drawing the dome AFTER opaque so early-Z
 *   actually rejects it, without disturbing the chapter-sky-dome draw order) belong to
 *   that pass — they cross-couple with files this perf-only edit does not own.
 */

import * as THREE from 'three/webgpu';
import { createOdysseyAtmosphereDomeTSL } from './odyssey-atmosphere-dome.tsl.js';

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
        // Validated TSL twin of the former GLSL graded backstop (MeshBasicNodeMaterial),
        // so it renders on the WebGPURenderer. The builder returns the mesh + the TSL
        // uniform nodes (uZenith/uHorizon/uEnergy/uExposure), which update() drives below.
        const built = createOdysseyAtmosphereDomeTSL({ radius: DOME_RADIUS });
        this._domeUniforms = built.uniforms;
        this._domeDispose = built.dispose;

        this.dome = built.mesh;
        this.dome.name = 'odyssey-atmosphere-dome';
        this.dome.renderOrder = -10000; // draw first, behind everything
        this.dome.frustumCulled = false;

        // ── PERF (overdraw): the dome is a camera-locked r=4000 surround, so it
        // rasterizes the ENTIRE screen every frame as the very first (renderOrder
        // -10000) draw. The builder leaves it depthTest:false (it paints
        // unconditionally). We flip depthTest BACK ON here, keeping depthWrite:false:
        //   • Drawn first into a depth buffer freshly cleared to far (1.0), a r=4000
        //     BackSide sphere is still nearer than far, so every fragment passes
        //     depthTest TODAY → look is byte-identical (verified: gradient unchanged).
        //   • But it now makes the dome early-Z ELIGIBLE: once Wave 2 reorders the
        //     backstop draw so opaque hero geometry writes depth first, the GPU can
        //     reject every dome fragment behind opaque content for free — turning the
        //     full-screen overdraw layer into "sky-pixels only". depthTest:false would
        //     forfeit that rejection forever. This is the "depthTest sensible" ask.
        // depthWrite stays false so the dome never occludes the per-chapter sky domes
        // (-100, depthWrite:false) or hero content drawn after it.
        if (this.dome.material) this.dome.material.depthTest = true;

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
        // (Guarded: the dome may be hidden via setDomeVisible() — e.g. a chapter with
        // its own full-coverage sky dome, or once Wave 2 owns the backstop — but the
        // clear colour + light rig below MUST keep updating regardless.)
        if (camera && this.dome) this.dome.position.copy(camera.position);

        if (atmo) {
            this._zenith.copy(atmo.skyColor);
            this._horizon.copy(atmo.fogColor);
        } else {
            this._zenith.set(0x0a0a1a);
            this._horizon.set(0x1a1020);
        }

        // Dome gradient — drive the TSL uniform nodes returned by the builder.
        // Skip the uniform writes when the dome is hidden (nothing samples them while
        // mesh.visible === false); they are re-driven on the next visible frame.
        const u = this._domeUniforms;
        if (u && this.dome && this.dome.visible) {
            u.uZenith.value.copy(this._zenith);
            u.uHorizon.value.copy(this._horizon);
            u.uEnergy.value = energy;
            u.uExposure.value = atmo?.exposure ? Math.max(0.5, atmo.exposure) : 1.0;
        }

        // Scene FOG is intentionally NOT written here. ChapterEnvironmentManager's
        // per-chapter chapter-profile lerp is the single source of truth for
        // scene.fog.color/density (it cross-fades across seams). This rig still owns
        // the graded dome (zenith/horizon, above), the clear colour, and the light
        // rig — all aerial-perspective-matched to the same horizon, so depth still
        // reads — but it must not clobber the chapter fog every frame.
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

    /**
     * Show/hide ONLY the in-scene sky-dome mesh, leaving the clear colour + light rig
     * fully live. This is the clean hook for the overdraw work that lands in Wave 2:
     *
     *   • the half-res off-screen transparency pass (see §3b of the perf plan) can take
     *     over the low-frequency backstop and hide this full-res, full-screen dome to
     *     remove its per-frame overdraw layer entirely;
     *   • the adaptive-quality controller can drop the dome on the lowest tiers; and
     *   • the manager can hide it in any chapter that already paints its own
     *     full-coverage opaque sky dome (-100) — that case is pure double-draw today.
     *
     * Hiding the dome does NOT change the visible backdrop in those cases because the
     * renderer is still cleared to the horizon colour every frame (see update()), and
     * any chapter sky dome / Wave-2 pass draws over where the gradient would have been.
     *
     * @param {boolean} visible
     */
    setDomeVisible(visible) {
        if (this.dome) this.dome.visible = visible !== false;
    }

    /** @returns {boolean} whether the in-scene sky-dome mesh is currently drawn. */
    isDomeVisible() {
        return !!(this.dome && this.dome.visible);
    }

    dispose() {
        if (this.dome) {
            this.scene.remove(this.dome);
            if (this._domeDispose) this._domeDispose();
            else {
                this.dome.geometry.dispose();
                this.dome.material.dispose();
            }
            this.dome = null;
            this._domeUniforms = null;
            this._domeDispose = null;
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
