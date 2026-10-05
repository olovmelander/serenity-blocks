import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    MOONS,
    REST_RIG,
    SENTINEL,
    SUNS,
    dirFromAzEl,
    fallbackLayout,
    groundPointAt,
    layoutsDiffer,
    readLayoutRects,
    restVerticalFov,
} from '../../src/themes/shifting-sands/shifting-sands-composition.js';
import { WormDirector } from '../../src/themes/shifting-sands/shifting-sands-worm.js';

const ASPECTS = [4 / 3, 16 / 10, 16 / 9, 1600 / 769, 2560 / 1080];
const DEG = Math.PI / 180;

/** The rest camera at a given aspect (y is the typical solved eye height). */
function restCamera(aspect) {
    const cam = new THREE.PerspectiveCamera(restVerticalFov(aspect), aspect, REST_RIG.near, REST_RIG.far);
    cam.position.set(0, 60, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(REST_RIG.pitchDeg * DEG, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return cam;
}

/** NDC of a world direction (at infinity) or point. */
function ndcOfDir(cam, dir) {
    return dir.clone().multiplyScalar(10000).add(cam.position).project(cam);
}

/** Card rect (fallback solo layout) in NDC x. */
function cardNdc(aspect) {
    const h = 900;
    const w = Math.round(h * aspect);
    const { card, hud } = fallbackLayout(w, h);
    return {
        x0: card.x0 * 2 - 1, x1: card.x1 * 2 - 1, hx0: hud.x0 * 2 - 1, hx1: hud.x1 * 2 - 1,
    };
}

describe('shifting sands lens', () => {
    it('uses a 50° vertical lens and caps the horizontal FOV at 100°', () => {
        expect(restVerticalFov(16 / 9)).toBeCloseTo(50, 5);
        const wide = 3.2; // 32:10 — the cap binds beyond ~2.56:1
        const v = restVerticalFov(wide);
        expect(v).toBeLessThan(50);
        const hFov = (2 * Math.atan(Math.tan((v * DEG) / 2) * wide)) / DEG;
        expect(hFov).toBeCloseTo(100, 3);
    });

    it('builds unit directions with + azimuth to the right of the forward −Z axis', () => {
        const d = dirFromAzEl(-30, 5);
        expect(d.length()).toBeCloseTo(1, 6);
        expect(d.x).toBeLessThan(0);
        expect(d.z).toBeLessThan(0);
        expect(d.y).toBeCloseTo(Math.sin(5 * DEG), 6);
        const p = groundPointAt(20, 1000);
        expect(Math.hypot(p.x, p.z)).toBeCloseTo(1000, 6);
        expect(p.x).toBeGreaterThan(0);
    });
});

describe('shifting sands composition', () => {
    it.each(ASPECTS)('keeps the twin suns in the left zone, clear of the card, at aspect %f', (aspect) => {
        const cam = restCamera(aspect);
        const card = cardNdc(aspect);
        for (const sun of [SUNS.a, SUNS.b]) {
            const p = ndcOfDir(cam, dirFromAzEl(sun.az, sun.el));
            expect(p.z).toBeLessThan(1); // in front of the camera
            expect(p.x).toBeGreaterThan(-1);
            expect(p.x).toBeLessThan(card.x0);
            // Above the horizon, below the top edge.
            expect(p.y).toBeGreaterThan(0);
            expect(p.y).toBeLessThan(1);
        }
    });

    it.each(ASPECTS)('keeps the moons and the Sentinel right of the card at aspect %f', (aspect) => {
        const cam = restCamera(aspect);
        const card = cardNdc(aspect);
        for (const moon of [MOONS.a, MOONS.b]) {
            const p = ndcOfDir(cam, dirFromAzEl(moon.az, moon.el));
            expect(p.x).toBeGreaterThan(card.x1);
            expect(p.y).toBeLessThan(1);
        }
        const s = groundPointAt(SENTINEL.az, SENTINEL.dist);
        const top = new THREE.Vector3(s.x, SENTINEL.height * 0.8, s.z).project(cam);
        expect(top.x).toBeGreaterThan(card.x1);
        expect(top.y).toBeLessThan(1);
    });

    it.each(ASPECTS)('breaches the worm in frame and clear of the board and the HUD at aspect %f', (aspect) => {
        const cam = restCamera(aspect);
        const card = cardNdc(aspect);
        // What the world tells the director: the lens, and the azimuths the layout covers.
        const halfAz = Math.atan(Math.tan((cam.fov * DEG) / 2) * aspect) / DEG;
        const azOf = (ndcX) => Math.atan(ndcX * Math.tan(halfAz * DEG)) / DEG;
        const director = new WormDirector(() => 0, { eye: { x: 0, y: 60, z: 0 } });
        director.setView({
            halfAz,
            bands: [[azOf(card.x0), azOf(card.x1)], [azOf(card.hx0), azOf(card.hx1)]],
        });
        const sites = Array.from({ length: 40 }, (_, cycle) => director.idleBreach(cycle));
        const clean = sites.filter((br) => director.faults(br) === 0);
        expect(clean.length).toBeGreaterThan(sites.length * 0.85);
        for (const br of clean) {
            // Where it comes up and where it goes down are both on screen, beside the layout.
            for (const foot of [br.up, br.down]) {
                const p = new THREE.Vector3(foot.x, foot.y, foot.z).project(cam);
                expect(Math.abs(p.x)).toBeLessThan(1);
                expect(Math.abs(p.y)).toBeLessThan(1);
                expect(p.x > card.x0 && p.x < card.x1).toBe(false);
                expect(p.x > card.hx0 && p.x < card.hx1).toBe(false);
            }
            const apex = new THREE.Vector3(br.ox, br.oy + br.b - br.k, br.oz).project(cam);
            expect(Math.abs(apex.x)).toBeLessThan(1);
        }
    });

    it('reads visible gameplay boards and the HUD as screen fractions', () => {
        const rect = (left, top, w, h) => ({
            left, top, right: left + w, bottom: top + h, width: w, height: h,
        });
        const card = { getBoundingClientRect: () => rect(800, 160, 360, 760) };
        const hidden = { getBoundingClientRect: () => rect(0, 0, 0, 0) };
        const hud = { getBoundingClientRect: () => rect(1240, 270, 140, 540) };
        const doc = {
            querySelectorAll: () => [card, hidden],
            querySelector: () => hud,
        };
        const style = { display: 'block', visibility: 'visible', opacity: '1' };
        const win = { innerWidth: 1920, innerHeight: 1080, getComputedStyle: () => style };
        const r = readLayoutRects(doc, win);
        expect(r.cardCount).toBe(1);
        expect(r.cards[0].x0).toBeCloseTo(800 / 1920, 6);
        expect(r.cards[0].y1).toBeCloseTo(920 / 1080, 6);
        expect(r.hud.x0).toBeCloseTo(1240 / 1920, 6);
        expect(readLayoutRects({ querySelectorAll: () => [hidden], querySelector: () => null }, win)).toBeNull();
    });

    it('treats sub-threshold layout jitter as unchanged', () => {
        const a = {
            cardCount: 1,
            cards: [{
                x0: 0.4, y0: 0.1, x1: 0.6, y1: 0.9,
            }],
            hud: null,
        };
        const b = {
            cardCount: 1,
            cards: [{
                x0: 0.401, y0: 0.1, x1: 0.6, y1: 0.9,
            }],
            hud: null,
        };
        const c = {
            cardCount: 1,
            cards: [{
                x0: 0.42, y0: 0.1, x1: 0.6, y1: 0.9,
            }],
            hud: null,
        };
        expect(layoutsDiffer(a, b)).toBe(false);
        expect(layoutsDiffer(a, c)).toBe(true);
        expect(layoutsDiffer(a, null)).toBe(true);
        expect(layoutsDiffer(null, null)).toBe(false);
    });
});
