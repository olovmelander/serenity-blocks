import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CH6_CLOSE_UPS, resolveCh6CloseUp, resolveCh6CloseUpKey } from './odyssey-ch6-close-ups.js';
import { resolveCh6HeroPlaces, resolveOmenHandoffWindow, resolveOmenPathPlace } from './chapter-environments/cosmic-expanse.js';
import { getLevelRegistry } from '../../core/odyssey/LevelRegistry.js';
import { getOdysseyPathCurve } from './path-utils.js';

const layout = getLevelRegistry().getPresentationLayout();
const cp = layout.chapterPositions;
const places = resolveCh6HeroPlaces(cp);
const curve = getOdysseyPathCurve();
const UP = new THREE.Vector3(0, 1, 0);

/** Frame orb `id` as the board does and return the hero's place on screen (ndc) and the orb's. */
function closeUp(id) {
    const p = layout.levelPositions[id - 1];
    const t = (p - cp[5]) / (cp[6] - cp[5]);
    const orb = curve.getPointAt(p);
    const along = curve.getPointAt(Math.min(1, p + 0.004)).sub(curve.getPointAt(Math.max(0, p - 0.004))).normalize();
    // The hole where it stands for the eye parked here (it rides the rail), as the board asks for it.
    const omen = resolveOmenPathPlace(p, resolveOmenHandoffWindow(cp).end, new THREE.Vector3());
    const heroes = { planet: places.planet, galaxyDir: places.galaxyDir, omen };
    const view = resolveCh6CloseUp(t, orb, along, UP, heroes);
    if (!view) return { t, view: null };
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100000);
    camera.position.copy(orb).addScaledVector(view, -14).addScaledVector(UP, 2);
    camera.up.copy(UP);
    camera.lookAt(orb);
    camera.updateMatrixWorld(true);
    const key = resolveCh6CloseUpKey(t);
    const target = key.hero === 'galaxy'
        ? camera.position.clone().addScaledVector(places.galaxyDir, 5000)
        : (key.hero === 'planet' ? places.planet : omen).clone();
    return {
        t, view, hero: key.hero, ndc: target.project(camera),
    };
}

describe('chapter 6\'s close-ups (the deep chapters audit, S1)', () => {
    it('keeps the rail\'s own view for the planetrise orbs', () => {
        expect(closeUp(35).view).toBeNull();
        expect(closeUp(36).view).toBeNull();
    });

    it('stands each orb\'s hero beside it, inside the frame and clear of the orb', () => {
        for (let id = 37; id <= 48; id += 1) {
            const { ndc, hero } = closeUp(id);
            // In front, inside the frame...
            expect(ndc.z).toBeLessThan(1);
            expect(Math.abs(ndc.x)).toBeLessThan(0.92);
            expect(Math.abs(ndc.y)).toBeLessThan(0.92);
            // ...and off the middle, where the orb is (never behind the glass).
            expect(Math.hypot(ndc.x, ndc.y), `orb ${id} (${hero})`).toBeGreaterThan(0.3);
        }
    });

    it('is a journey: the giant, then the galaxy, then the hole, and no two neighbours one picture', () => {
        const heroes = [];
        for (let id = 37; id <= 48; id += 1) heroes.push(closeUp(id).hero);
        expect(heroes[0]).toBe('planet');
        expect(heroes.includes('galaxy')).toBe(true);
        expect(heroes[heroes.length - 1]).toBe('omen');
        // The giant drifts out as it falls behind.
        const a = closeUp(37).ndc;
        const b = closeUp(40).ndc;
        expect(Math.abs(b.x)).toBeGreaterThan(Math.abs(a.x));
        // The keys are in order.
        CH6_CLOSE_UPS.forEach((k, i) => { if (i) expect(k.t).toBeGreaterThan(CH6_CLOSE_UPS[i - 1].t); });
    });
});
