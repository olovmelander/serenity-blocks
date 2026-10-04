import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import { IntroClassicProfile } from '../../src/ui/intro-classic-profile.js';
import IntroClassicVisual from '../../src/ui/threejs-intro-renderer.js';
import { INTRO_PHASES, getIntroVisualProfile } from '../../src/ui/intro-visual-config.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function makeProfile() {
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    const visual = new IntroClassicVisual(null);
    visual.renderer = { setPixelRatio: vi.fn() };
    visual.composer = { addPass: vi.fn(), removePass: vi.fn() };
    visual.bloomPass = { resolution: new THREE.Vector2() };
    visual.scene = new THREE.Scene();
    visual.camera = new THREE.PerspectiveCamera(60, 390 / 844);
    visual.camera.position.z = 40;
    const profile = new IntroClassicProfile(visual);
    return { visual, profile };
}

describe('classic intro shared authored profile', () => {
    it('connects the actual classic public APIs to one shared controller and restores budget on resize', () => {
        const { visual, profile } = makeProfile();
        visual.renderer.setSize = vi.fn();
        visual.composer.setSize = vi.fn();
        visual.composer.setPixelRatio = vi.fn();
        window.innerWidth = 844; window.innerHeight = 390;
        visual.setPerformanceBudget('LOW');
        visual.setPhase(INTRO_PHASES.IDLE, true);
        visual.setReactionState({ glow: 0.5 });
        visual.setAudioPulse(0.8);
        const policy = visual.setTetrominoRecyclingPolicy({ mode: 'minimum-residence', minimumResidenceMs: 90_000 });
        visual.onResize();

        expect(visual.portableProfile).toBe(profile);
        expect(visual.composer.addPass).toHaveBeenCalledOnce();
        expect(visual.composer.setPixelRatio).toHaveBeenLastCalledWith(1);
        expect(profile.reaction.glow).toBe(0.5);
        expect(profile.audioPulse).toBe(0.8);
        expect(policy.minimumResidenceMs).toBe(90_000);
        expect(visual.camera.aspect).toBe(844 / 390);
        profile.dispose();
    });

    it('uses the current cinematic grade and selected mobile budget', () => {
        const { visual, profile } = makeProfile();
        profile.setPerformanceBudget('LOW');
        expect(visual.renderer.setPixelRatio).toHaveBeenLastCalledWith(1);
        expect(visual.bloomPass.enabled).toBe(false);
        expect(profile.quality.maxTetrominos).toBe(18);
        expect(profile.gradePass.uniforms.uExposure.value).toBe(getIntroVisualProfile().post.baseExposure);
        expect(profile.gradePass.uniforms.uContrast.value).toBe(1.12);
        expect(profile.gradePass.uniforms.uSaturation.value).toBe(1.1);
        expect(visual.renderer.toneMapping).toBe(THREE.NoToneMapping);
        profile.dispose();
    });

    it('preserves boot/reveal phase ownership when disabling menu mode', () => {
        const { visual, profile } = makeProfile();
        visual.setPhase(INTRO_PHASES.BOOT, true);
        visual.setBackgroundMode(false);
        expect(profile.phase).toBe(INTRO_PHASES.BOOT);
        visual.setBackgroundMode(true);
        expect(profile.phase).toBe(INTRO_PHASES.MENU_BG);
        visual.setBackgroundMode(false);
        expect(profile.phase).toBe(INTRO_PHASES.IDLE);
        profile.dispose();
    });

    it('smoothly applies shared phase curves with bounded simulation time', () => {
        const { profile } = makeProfile();
        profile.setPhase(INTRO_PHASES.IDLE, true);
        profile.setPhase(INTRO_PHASES.HERO_INHALE, false, { durationMs: 100 });
        profile.prepareFrame(1 / 30);
        expect(profile.phaseState.attractionMul).toBeGreaterThan(1);
        expect(profile.phaseState.attractionMul).toBeLessThan(1.45);
        profile.prepareFrame(1 / 30);
        profile.prepareFrame(1 / 30);
        expect(profile.phaseState.attractionMul).toBe(1.45);
        profile.prepareFrame(100);
        expect(profile.time).toBeCloseTo(0.1 + 1 / 30);
        profile.dispose();
    });

    it('keeps the shared idle inhale/release cadence alive without a native compute clock', () => {
        const { profile } = makeProfile();
        profile.nextHeroInhale = 0;
        profile.prepareFrame(1 / 60);
        expect(profile.phase).toBe(INTRO_PHASES.HERO_INHALE);
        for (let i = 0; i < 90; i += 1) profile.prepareFrame(1 / 60);
        expect(profile.phase).toBe(INTRO_PHASES.IDLE);
        expect(profile.nextHeroInhale).toBeGreaterThan(profile.time + 5);
        profile.dispose();
    });

    it('drives bloom, crystal glow, chroma and camera from the common reaction payload', () => {
        const { visual, profile } = makeProfile();
        visual.cachedResources = { T: { material: {}, edgeMaterial: {} } };
        profile.setReactionState({
            surge: 1, bloom: 1, glow: 1, chroma: 1, vertigo: 1, spin: -1,
        });
        profile.prepareFrame(1 / 60);
        profile.applyCamera(visual.camera);
        expect(visual.bloomPass.strength).toBeGreaterThan(profile.quality.bloomStrength);
        expect(visual.cachedResources.T.material.emissiveIntensity).toBe(1.3);
        expect(profile.gradePass.uniforms.uChromatic.value).toBeGreaterThan(0.0014);
        expect(visual.camera.position.z).toBeLessThan(40);
        expect(visual.camera.fov).toBe(53);
        profile.setReactionState({ vertigo: 0, surge: 0 });
        profile.applyCamera(visual.camera);
        expect(visual.camera.fov).toBe(60);
        profile.dispose();
    });

    it('does not recycle a full pool before minimum residence and releases the oldest eligible piece', () => {
        const { visual, profile } = makeProfile();
        profile.quality.maxTetrominos = 2;
        profile.setTetrominoRecyclingPolicy({ mode: 'minimum-residence', minimumResidenceMs: 90_000 });
        const a = new THREE.Object3D(); a.userData.bornAt = 0;
        const b = new THREE.Object3D(); b.userData.bornAt = 1;
        visual.activeTetrominos = [a, b]; visual.scene.add(a, b);
        profile.time = 89;
        expect(profile.canSpawn()).toBe(false);
        expect(visual.activeTetrominos).toHaveLength(2);
        profile.time = 90;
        expect(profile.canSpawn()).toBe(true);
        expect(visual.activeTetrominos).toEqual([b]);
        expect(visual.scene.children).toEqual([b]);
        profile.dispose();
    });

    it('advances the actual CPU tetromino hooks at the same rate at30 and60Hz', () => {
        const { visual, profile } = makeProfile();
        const piece = new THREE.Object3D();
        piece.userData = { velocity: new THREE.Vector3(0.01, 0, 0), rotationSpeed: new THREE.Vector3(0.01, 0, 0) };
        visual.activeTetrominos = [piece];
        visual.updateTetrominos(1 / 30);
        const x30 = piece.position.x;
        piece.position.x = 0;
        visual.updateTetrominos(1 / 60);
        visual.updateTetrominos(1 / 60);
        expect(piece.position.x).toBeCloseTo(x30);
        profile.dispose();
    });

    it('projects pooled scene bursts at the event origin and disposes the grade exactly once', () => {
        const { visual, profile } = makeProfile();
        visual.createCollisionEffect = vi.fn();
        profile.pulseReactionAt(0.5, 0.5, 1);
        expect(visual.createCollisionEffect).toHaveBeenCalledTimes(2);
        expect(visual.createCollisionEffect.mock.calls[0]).toEqual([0, 0, 0]);
        const disposed = vi.spyOn(profile.gradePass, 'dispose');
        profile.dispose(); profile.dispose();
        expect(disposed).toHaveBeenCalledOnce();
        expect(visual.composer.removePass).toHaveBeenCalledOnce();
    });
});
