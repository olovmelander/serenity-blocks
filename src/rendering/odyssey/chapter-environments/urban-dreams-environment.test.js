import { describe, expect, it } from 'vitest';
import {
    CH8_RETROSUN_STAGE,
    createUrbanDreamsEnvironment,
    updateUrbanDreamsEnvironment,
} from './urban-dreams.js';
import {
    CH8_CITY_LAYOUT,
    CH8_FACADE_VALUE_SETTINGS,
    CH8_RETROSUN_SHADER_SETTINGS,
} from './urban-dreams.tsl.js';
import { ODYSSEY_CHAPTER_PROFILES } from './shared/chapter-profile.js';
import { getActiveOdysseyChapterPositions } from '../path-utils.js';
import { OdysseyDirector } from '../composition/OdysseyDirector.js';
import { urbanIgnition } from '../composition/odyssey-stage-frame.js';

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

    it('builds dark towers whose light is sparse, clustered by floor, and never clips', () => {
        const group = createUrbanDreamsEnvironment();
        const { cityBlocks } = group.userData;
        const towers = cityBlocks.getObjectByName('city-tower-instances-tsl');

        expect(cityBlocks.name).toBe('city-blocks');
        expect(towers.material.userData.valueTiers).toEqual(CH8_FACADE_VALUE_SETTINGS);
        // 2026-10 facade rewrite: the even window mosaic became whole lit FLOORS on dark
        // glass. Every emissive gain stays under 1 so bloom gilds instead of clipping.
        ['warmGain', 'coolGain', 'neonGain', 'trimGain'].forEach((key) => {
            expect(CH8_FACADE_VALUE_SETTINGS[key]).toBeLessThan(1);
        });
        // Per-instance variation rides attributes on ONE material (one draw, one program).
        const facade = towers.geometry.getAttribute('aFacade');
        const dims = towers.geometry.getAttribute('aDims');
        expect(facade.itemSize).toBe(4);
        expect(dims.itemSize).toBe(3);
        expect(facade.count).toBe(towers.count);
        // MOST of the city is dark: mean floor occupancy stays well under a third.
        let occupancy = 0;
        let heroes = 0;
        for (let i = 0; i < facade.count; i += 1) {
            occupancy += facade.getY(i);
            if (facade.getW(i) > 0) heroes += 1;
        }
        expect(occupancy / facade.count).toBeLessThan(0.3);
        expect(heroes).toBe(CH8_CITY_LAYOUT.heroes.length);
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
        // 2026-10: the resolve is a SETTLE, not a blackout — the journey ends on a held
        // final frame, so windows dim ~60 % and a third of the buildings gutter out while
        // the spire, hero trims and the Retrosun stay lit (was an 85 % blackout).
        expect(dimmedEnergy).toBeLessThan(litEnergy * 0.5);
        expect(uniforms.uDim.value).toBeGreaterThan(0.3);
        // The sun's reveal floor is untouched by the dimming.
        expect(group.userData.sun.userData.uReveal.value).toBeCloseTo(1.0, 5);
    });

    it('runs the finale on ONE in-chapter clock (dark arrival, then ignition)', () => {
        const group = createUrbanDreamsEnvironment();
        const [start] = getActiveOdysseyChapterPositions().slice(7);
        const at = (local) => start + (1 - start) * local;

        // Global progress inside chapters 6/7 used to be ~88 % ignited on arrival.
        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, at(0.0));
        expect(group.userData.reveal).toBe(0);
        expect(group.userData.uniforms.uIgniteRadius.value).toBe(0);
        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, at(0.3));
        expect(group.userData.reveal).toBe(0);
        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, at(0.62));
        expect(group.userData.reveal).toBeGreaterThan(0.3);
        expect(group.userData.reveal).toBeLessThan(0.7);
        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, at(0.9));
        expect(group.userData.reveal).toBeCloseTo(1, 5);
        expect(group.userData.uniforms.uIgniteRadius.value).toBeGreaterThan(600);

        // The director publishes the SAME clock for the camera crane + post swell.
        const director = new OdysseyDirector({ chapterPositions: getActiveOdysseyChapterPositions() });
        const state = director.update(1 / 60, { ascentProgress: at(0.62) });
        updateUrbanDreamsEnvironment(group, 0.016, 1.0, null, at(0.62));
        expect(state.urbanReveal).toBeCloseTo(group.userData.reveal, 6);
        expect(state.urbanReveal).toBeCloseTo(urbanIgnition(0.62), 6);
    });
});
