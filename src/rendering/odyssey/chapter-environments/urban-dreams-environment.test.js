import { describe, expect, it } from 'vitest';
import {
    createUrbanDreamsEnvironment,
    updateUrbanDreamsEnvironment,
} from './urban-dreams.js';

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
        expect(group.userData.gateBridge?.name).toBe('gate-bridge');
        // Deck + two pylons + holo billboard.
        expect(group.userData.gateBridge.children.length).toBe(4);
    });

    it('keeps the Retrosun alive mid-chapter and heats it at the finale', () => {
        const group = createUrbanDreamsEnvironment();
        const sunReveal = group.userData.sun.userData.uReveal;

        // Mid-chapter (pre-ignition): the visibility floor holds the disc alive.
        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, 0.5);
        expect(sunReveal.value).toBeCloseTo(0.45, 5);

        // Finale: full heat.
        updateUrbanDreamsEnvironment(group, 0.016, 2.0, null, 1.0);
        expect(sunReveal.value).toBeCloseTo(1.0, 5);
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
