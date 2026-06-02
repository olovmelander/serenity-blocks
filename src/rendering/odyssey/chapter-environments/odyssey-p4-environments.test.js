import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { createSkyDriftEnvironment } from './sky-drift.js';
import { createCosmicExpanseEnvironment } from './cosmic-expanse.js';
import { createBlackHoleTranscendenceEnvironment } from './black-hole-transcendence.js';
import { createUrbanDreamsEnvironment } from './urban-dreams.js';

function stubCanvasDocument() {
    const gradient = { addColorStop: vi.fn() };
    const context = {
        clearRect: vi.fn(),
        createRadialGradient: vi.fn(() => gradient),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
    };
    vi.stubGlobal('document', {
        createElement: vi.fn(() => ({
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        })),
    });
}

describe('Odyssey P4 chapter environment anchors', () => {
    it('adds cloud deck, aurora, and weather layers to chapter 5', () => {
        stubCanvasDocument();

        const group = createSkyDriftEnvironment({ particleCount: 8 });

        expect(group.userData.cloudDecks?.name).toBe('cloud-deck-break');
        expect(group.userData.aurora?.name).toBe('aurora-ribbons');
        expect(group.userData.rainVeils?.name).toBe('rain-veil-particles');
    });

    it('uses a volumetric black-hole anchor and hero planet in chapter 6', () => {
        const group = createCosmicExpanseEnvironment({ particleCount: 8 });

        expect(group.userData.blackHole?.name).toBe('volumetric-black-hole-anchor');
        expect(group.userData.blackHole?.isMesh).not.toBe(true);
        expect(group.userData.heroPlanet?.name).toBe('hero-planet-nebula-anchor');
        expect(group.userData.nebulaVolume?.name).toBe('nebula-volume-points');
    });

    it('adds lensing and infall layers to chapter 7', () => {
        const group = createBlackHoleTranscendenceEnvironment();

        expect(group.userData.eventHorizon?.name).toBe('dominant-event-horizon-anchor');
        expect(group.userData.lensingStarfield?.name).toBe('lensing-starfield');
        expect(group.userData.infallStreams?.name).toBe('infall-streams');
    });

    it('adds a neon spire, holograms, reflections, and traffic to chapter 8', () => {
        const group = createUrbanDreamsEnvironment();

        expect(group.userData.spire?.name).toBe('neon-megastructure-spire');
        expect(group.userData.signs?.name).toBe('hologram-sign-stack');
        expect(group.userData.reflectionPlane?.name).toBe('wet-neon-reflection-plane');
        expect(group.userData.traffic?.name).toBe('sky-traffic-light-trails');
    });
});
