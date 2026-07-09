import { describe, expect, it } from 'vitest';
import {
    CH8_RETROSUN_STAGE,
    createUrbanDreamsEnvironment,
    updateUrbanDreamsEnvironment,
} from './urban-dreams.js';
import {
    CH8_FACADE_VALUE_SETTINGS,
    CH8_RETROSUN_SHADER_SETTINGS,
} from './urban-dreams.tsl.js';
import { ODYSSEY_CHAPTER_PROFILES } from './shared/chapter-profile.js';

describe('Urban Dreams chapter environment (creative plan ch8)', () => {
    it('mounts the skyline cards, horizon haze, and the Gate Bridge', () => {
        const group = createUrbanDreamsEnvironment();

        expect(group.userData.skyline).toHaveLength(2);
        group.userData.skyline.forEach((card) => {
            expect(card.name).toBe('skyline-silhouette');
            // The ecotone bridge must reach the cards.
            expect(card.material.uniforms?.uOpacity).toBeTruthy();
        });
        expect(group.userData.horizonHaze?.name).toBe('horizon-haze-band');
        expect(group.userData.horizonHaze.position.toArray()).toEqual(CH8_RETROSUN_STAGE.horizonHaze);
        expect(group.userData.horizonHaze.geometry.parameters.height).toBe(340);
        expect(group.userData.gateBridge?.name).toBe('gate-bridge');
        // Deck + two pylons + holo billboard.
        expect(group.userData.gateBridge.children.length).toBe(4);
    });

    it('keeps the Retrosun alive mid-chapter and heats it at the finale', () => {
        const group = createUrbanDreamsEnvironment();
        const sunReveal = group.userData.sun.userData.uReveal;

        expect(group.userData.sun.position.toArray()).toEqual(CH8_RETROSUN_STAGE.sun);
        expect(group.userData.sun.userData.readability).toEqual(CH8_RETROSUN_SHADER_SETTINGS);
        expect(sunReveal.value).toBeCloseTo(CH8_RETROSUN_STAGE.revealFloor, 5);

        // Mid-chapter (pre-ignition): the visibility floor holds the disc alive.
        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, 0.5);
        expect(sunReveal.value).toBeCloseTo(CH8_RETROSUN_STAGE.revealFloor, 5);

        // Finale: full heat.
        updateUrbanDreamsEnvironment(group, 0.016, 2.0, null, 1.0);
        expect(sunReveal.value).toBeCloseTo(1.0, 5);
    });

    it('tracks facade value tiers so windows read as punctuation', () => {
        const group = createUrbanDreamsEnvironment();
        const { cityBlocks } = group.userData;
        const towers = cityBlocks.getObjectByName('city-tower-instances-tsl');

        expect(cityBlocks.name).toBe('city-blocks');
        expect(towers.material.userData.valueTiers).toEqual(CH8_FACADE_VALUE_SETTINGS);
        expect(CH8_FACADE_VALUE_SETTINGS.brightCutoff).toBeGreaterThan(0.95);
        expect(CH8_FACADE_VALUE_SETTINGS.colorGain).toBeLessThan(0.6);
    });

    it('caps the Urban Encore data line so it does not overpower the skyline', () => {
        const profile = ODYSSEY_CHAPTER_PROFILES.find((chapter) => chapter.id === 8);

        expect(profile.path.emissiveColor).toBe(0x18b9c8);
        expect(profile.path.widthScale).toBeLessThanOrEqual(0.82);
    });

    it('dims the city at the journey resolve while the sun stays lit', () => {
        const group = createUrbanDreamsEnvironment();
        const { uniforms } = group.userData;

        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, 0.9);
        const litEnergy = uniforms.uEnergy.value;
        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, 1.0);
        const dimmedEnergy = uniforms.uEnergy.value;
        expect(dimmedEnergy).toBeLessThan(litEnergy * 0.3);
        // The sun's reveal floor is untouched by the dimming.
        expect(group.userData.sun.userData.uReveal.value).toBeCloseTo(1.0, 5);
    });
});
