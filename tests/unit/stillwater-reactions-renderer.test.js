import fs from 'fs';
import path from 'path';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createStillwaterReactions } from '../../src/themes/stillwater/rendering/stillwater-reactions.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const rendererSource = fs.readFileSync(
    path.join(
        ROOT,
        'src',
        'themes',
        'stillwater',
        'rendering',
        'stillwater-reactions.js',
    ),
    'utf8',
);
const pilotSource = fs.readFileSync(
    path.join(
        ROOT,
        'src',
        'playground',
        'effects',
        'stillwater-reactions.effect.js',
    ),
    'utf8',
);

describe('Stillwater fixed reaction renderer', () => {
    it('owns one fixed mote pool, tier-sized shafts, and one priority rune', () => {
        expect(rendererSource).toContain('STILLWATER_REACTION_MOTE_CAPACITY = 192');
        expect(rendererSource).toContain('STILLWATER_REACTION_SHAFT_CAPACITY = 4');
        expect(rendererSource).toContain('profile.transientShaftSlots');
        expect(rendererSource).toContain("rune.name = 'stillwater-priority-lake-rune'");
        expect(rendererSource).toContain('specialSlots: runeEnabled ? 1 : 0');
    });

    it('updates attributes and uniforms without constructing event-time resources', () => {
        const eventSection = rendererSource.slice(
            rendererSource.indexOf('function spawnMotes'),
            rendererSource.indexOf('function getDiagnostics'),
        );
        expect(eventSection).not.toMatch(/new THREE\./);
        expect(eventSection).not.toMatch(/new (Float32Array|Array|Map|Set)\b/);
        expect(eventSection).not.toMatch(/setTimeout|requestAnimationFrame/);
        expect(eventSection).toContain('markAttributes(');
        expect(eventSection).toContain('uRuneBirth.value = currentTime');
    });

    it('uses TSL and explicit selective emissive MRT roles only on bloom tiers', () => {
        expect(rendererSource).toContain("from 'three/webgpu'");
        expect(rendererSource).toContain("from 'three/tsl'");
        expect(rendererSource).not.toMatch(/ShaderMaterial|glsl|wgsl/i);
        expect(rendererSource).toContain('profile.bloom && selectiveBloom');
        expect(rendererSource).toContain('configureStillwaterSelectiveBloomMaterial');
    });

    it('constructs premium mycelium only for bloom tiers and an etched lean rune otherwise', () => {
        expect(rendererSource).toContain('if (runeEnabled) {');
        expect(rendererSource).toContain('let runeGeometry = null');
        expect(rendererSource).toContain('let runeMaterial = null');
        expect(rendererSource).toContain(
            "runeModel = premiumRune ? 'mycelial-premium' : 'etched-lean'",
        );
        expect(rendererSource).toContain("let runeModel = 'disabled-minimal'");
        expect(rendererSource).toContain('if (premiumRune)');
        expect(rendererSource).toContain(
            'const diamondRadius = abs(centered.x).add(abs(centered.y))',
        );
        expect(rendererSource).toContain('runeBaseScale + strength * runeStrengthScale');
    });

    it('structurally omits the rune and shaft resources from Minimal', () => {
        const root = new THREE.Group();
        const reactions = createStillwaterReactions({
            root,
            quality: 'Minimal',
        });

        expect(reactions.getDiagnostics()).toMatchObject({
            quality: 'Minimal',
            shaftCapacity: 0,
            specialSlots: 0,
            runeModel: 'disabled-minimal',
            runeMaxScale: 0,
            maxDraws: 1,
        });
        expect(reactions.getResourceState()).toMatchObject({
            geometries: 1,
            materials: 1,
            shaftOriginBirthArray: null,
            shaftStyleArray: null,
            runeGeometry: null,
            runeMaterial: null,
        });

        reactions.dispose();
        expect(root.children).toHaveLength(0);
    });

    it('preserves exact top-left reaction origins instead of recentering zero', () => {
        const root = new THREE.Group();
        const reactions = createStillwaterReactions({
            root,
            quality: 'Minimal',
        });

        reactions.dimple({
            originX: 0,
            originY: 0,
            moteCount: 1,
            strength: 1,
            durationMs: 600,
        });
        const state = reactions.getResourceState();
        expect(state.moteOriginBirthArray[0]).toBe(-9);
        expect(state.moteOriginBirthArray[2]).toBe(1);

        reactions.dispose();
    });

    it('keeps the isolated pilot phase locked and disables water proxies/post', () => {
        expect(pilotSource).toContain("id: 'stillwater-reactions'");
        expect(pilotSource).toContain("waterParams.set('proxies', 'off')");
        expect(pilotSource).toContain("waterParams.set('post', 'off')");
        expect(pilotSource).toContain('captureTime - age');
        expect(pilotSource).toContain('__STILLWATER_REACTIONS__');
    });
});
