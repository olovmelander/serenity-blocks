/**
 * Tests for Chromadelic Highway's Cosmic Voyage sectors, procedural texture bakes,
 * and distinct per-event signatures (hardDrop, twist, combo, b2b, quad, perfect,
 * levelUp, gameOver coast-down + self-recovery).
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    SECTORS, SECTOR_NAMES, SECTOR_PERIOD,
    sectorAt, sectorPhase, sectorIndexByName,
} from '../../src/themes/chromadelic-highway/chromadelic-highway-voyage.js';
import {
    bakeCosmicNebulaData,
    bakeRainbowGiantData,
    bakeIceRingData,
    createCosmicNebulaTexture,
    createRainbowGiantTexture,
    createIceRingTexture,
    warmHighwayBakes,
} from '../../src/themes/chromadelic-highway/chromadelic-highway-bake.js';
import { resetBakeCache } from '../../src/themes/shared/bake-cache.js';
import { ChromadelicWorld } from '../../src/themes/chromadelic-highway/chromadelic-highway-world.js';
import { PORTAL_KIND } from '../../src/themes/chromadelic-highway/chromadelic-highway-events-fx.js';
import { holdFlashing, REDUCED_FLASH_SCALE } from '../../src/utils/photosensitivity.js';

describe('chromadelic highway cosmic voyage', () => {
    it('defines five distinct sectors and resolves names cleanly', () => {
        expect(SECTORS).toHaveLength(5);
        expect(SECTOR_NAMES).toEqual([
            'velvet-rift',
            'aurora-slipstream',
            'starlight-crossing',
            'ion-corridor',
            'nebula-heart',
        ]);
        expect(sectorIndexByName('aurora-slipstream')).toBe(1);
        expect(sectorIndexByName('Nebula-Heart')).toBe(4);
        expect(sectorIndexByName('unknown')).toBe(-1);
    });

    it('wraps continuously across the 5-sector seam with distinct plateaus', () => {
        const start = sectorAt(0);
        const end = sectorAt(SECTORS.length - 1e-6);
        expect(start.name).toBe('velvet-rift');
        expect(Math.abs(start.aurora - end.aurora)).toBeLessThan(0.01);
        expect(Math.abs(start.nebulaGain - end.nebulaGain)).toBeLessThan(0.01);

        const aurora = sectorAt(1.2);
        const starlight = sectorAt(2.2);
        const ion = sectorAt(3.2);
        const heart = sectorAt(4.2);
        expect(aurora.aurora).toBeGreaterThan(start.aurora + 0.5);
        expect(starlight.starBoost).toBeGreaterThan(start.starBoost + 0.3);
        expect(starlight.milkyWay).toBeGreaterThan(start.milkyWay + 0.4);
        expect(ion.dustDepth).toBeGreaterThan(aurora.dustDepth + 0.25);
        expect(heart.coreWarmth).toBeGreaterThan(start.coreWarmth + 0.4);
    });

    it('advances smoothly along the independent 73 s clock', () => {
        const s0 = sectorAt(sectorPhase(0));
        const s1 = sectorAt(sectorPhase(SECTOR_PERIOD + 10));
        expect(s0.name).toBe('velvet-rift');
        expect(s1.name).toBe('aurora-slipstream');
    });
});

describe('chromadelic highway procedural bakes', () => {
    it('transfers a first-visit bake under the keys used by the texture constructors', async () => {
        const posted = [];
        const host = {};
        vi.stubGlobal('self', host);
        resetBakeCache();
        try {
            await import('../../src/themes/chromadelic-highway/chromadelic-highway-bake.worker.js');
            vi.stubGlobal('Worker', class {
                constructor() {
                    host.postMessage = (reply, buffers) => {
                        expect(buffers).toContain(reply.value.data.buffer);
                        posted.push(reply.value);
                        this.onmessage({ data: reply });
                    };
                }

                postMessage(job) {
                    queueMicrotask(() => host.onmessage({ data: job }));
                }

                terminate() {}
            });

            // Minimal builds the hero only. Moving up a tier keeps that bake and adds the sky.
            const minimal = await warmHighwayBakes({ skyTaps: 0 });
            expect(minimal).toEqual({ viaWorker: true, baked: 1, cached: 0 });
            expect(bakeRainbowGiantData()).toBe(posted[0]);
            const high = await warmHighwayBakes({ skyTaps: 2 });
            expect(high).toEqual({ viaWorker: true, baked: 1, cached: 1 });
            expect(bakeCosmicNebulaData()).toBe(posted[1]);
            await expect(warmHighwayBakes({ skyTaps: 2 })).resolves.toEqual({ viaWorker: false, baked: 0, cached: 2 });
        } finally {
            vi.unstubAllGlobals();
            resetBakeCache();
        }
    });

    it('bakes seamless RGBA nebula, rainbow gas giant, and CPU-mipped icy rings', () => {
        const neb = bakeCosmicNebulaData(64);
        expect(neb.width).toBe(64);
        expect(neb.height).toBe(64);
        expect(neb.data.length).toBe(64 * 64 * 4);
        let maxR = 0; let maxG = 0; let maxB = 0;
        for (let i = 0; i < neb.data.length; i += 4) {
            if (neb.data[i] > maxR) maxR = neb.data[i];
            if (neb.data[i + 1] > maxG) maxG = neb.data[i + 1];
            if (neb.data[i + 2] > maxB) maxB = neb.data[i + 2];
        }
        expect(maxR).toBeGreaterThan(140);
        expect(maxG).toBeGreaterThan(100);
        expect(maxB).toBeGreaterThan(120);

        const giant = bakeRainbowGiantData(128, 64);
        expect(giant.data.length).toBe(128 * 64 * 4);

        const ring = bakeIceRingData(128);
        expect(ring.levels[0].data.length).toBe(128 * 4);
        // Cassini Division (~t = 0.60) must be markedly thinner than dense B-ring (~t = 0.35)
        const bRingAlpha = ring.levels[0].data[Math.floor(0.35 * 128) * 4 + 3];
        const cassiniAlpha = ring.levels[0].data[Math.floor(0.60 * 128) * 4 + 3];
        expect(bRingAlpha).toBeGreaterThan(140);
        expect(cassiniAlpha).toBeLessThan(35);

        const ringTex = createIceRingTexture(128);
        expect(ringTex.mipmaps.length).toBeGreaterThanOrEqual(8);
        expect(ringTex.generateMipmaps).toBe(false);

        const nebTex = createCosmicNebulaTexture(64);
        const giantTex = createRainbowGiantTexture(128, 64);
        expect(nebTex.wrapS).toBe(THREE.RepeatWrapping);
        expect(giantTex.wrapS).toBe(THREE.RepeatWrapping);
        ringTex.dispose();
        nebTex.dispose();
        giantTex.dispose();
    });
});

describe('chromadelic highway distinct event choreography', () => {
    function makeWorld() {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(65, 16 / 9, 1, 20000);
        camera.updateProjectionMatrix();
        const world = new ChromadelicWorld({ scene, quality: 'High' }).build();
        world.setViewport(900, camera, 1600);
        world.updateCamera(camera, { time: 10, delta: 0 });
        world.update({ time: 10, delta: 0.016 }, camera);
        return { world, camera };
    }

    const tick = (world, camera, time, delta = 0.016) => {
        world.updateCamera(camera, { time, delta });
        world.update({ time, delta }, camera);
    };

    it('gives every event its own distinct visual signature', () => {
        const { world, camera } = makeWorld();
        try {
            world.onPieceLock({ piece: { type: 'T' } });
            tick(world, camera, 10.06);
            expect(world.shared.uLanePulse.value.y).toBeGreaterThan(0.2);

            world.onHardDrop();
            world.onPieceLock({ piece: { type: 'I' } });
            tick(world, camera, 10.22);
            expect(world.shared.uSlamWave.value.y).toBeGreaterThan(0.2);

            world.onTwist(2);
            tick(world, camera, 10.5);
            expect(world.shared.uTwistHelix.value.w).toBeGreaterThan(0.3);
            expect(world.shared.uTwistGlass.value.y).toBeGreaterThan(0.2);

            world.onB2B();
            tick(world, camera, 11.0);
            expect(world.shared.uGoldGild.value).toBeGreaterThan(0.25);
            expect(world.shared.uPortalA.array[1].z).toBeGreaterThan(0.2);
            expect(world.fx.ringGold).toBeGreaterThan(0.2);

            world.onLineClear(4);
            tick(world, camera, 11.45, 0.45);
            expect(world.shared.uWarpRails.value.y).toBeGreaterThan(0.3);
            expect(world.fx.warpRush).toBeGreaterThan(0.15);

            world.onPerfectClear();
            tick(world, camera, 12.1);
            expect(world.fx.nova).toBeGreaterThan(0.3);
            expect(world.shared.uPortalA.array[3].z).toBeGreaterThan(0.2);
            expect(world.shared.uWarpRails.value.w).toBeGreaterThan(0.3);

            const voyageBefore = world.voyage.offsetTarget;
            world.onLevelUp(3);
            tick(world, camera, 12.4);
            expect(world.shared.uPortalA.array[0].z).toBeGreaterThan(0.2);
            expect(world.voyage.offsetTarget).toBeGreaterThan(voyageBefore + 0.3);
            expect(world.voyage.offset).toBeGreaterThan(0);

            world.onCombo(5);
            tick(world, camera, 12.8);
            expect(world.shared.uPortalA.array[2].z).toBeGreaterThan(0.2);
        } finally {
            world.dispose();
        }
    });

    it('keeps a cascade and a consecutive-clear chain visible independently when they coincide', () => {
        const { world, camera } = makeWorld();
        try {
            expect(world.cosmicPortals.mesh.geometry.drawRange.count).toBe(3);
            world.onLineClear(2, { cascade: 1, combo: 4, chainStep: true });
            tick(world, camera, 10.1);
            const portals = world.shared.uPortalA.array;
            expect(portals[PORTAL_KIND.chain].z).toBeGreaterThan(0);
            expect(portals[PORTAL_KIND.cascade].z).toBe(0);
            const chainBirth = world.portals[PORTAL_KIND.chain].birth;
            world.onCombo(3);
            tick(world, camera, 10.22);
            expect(portals[PORTAL_KIND.cascade].z).toBeGreaterThan(0);
            expect(portals[PORTAL_KIND.chain].z).toBeGreaterThan(0);
            expect(world.portals[PORTAL_KIND.chain].birth).toBe(chainBirth);
            world.seek(1);
            expect(portals.every((slot) => slot.z === 0)).toBe(true);
            tick(world, camera, 1);
            expect(world.cosmicPortals.mesh.geometry.drawRange.count).toBe(3);
        } finally {
            world.dispose();
        }
    });

    it('holds the portal position for reduced motion and scales its light live', () => {
        const { world, camera } = makeWorld();
        try {
            world.onPerfectClear();
            world.motion = 0;
            world.time += 0.16;
            world.updateSpectacles();
            const slot = world.shared.uPortalA.array[PORTAL_KIND.perfect];
            const { x: radius, z: full } = slot;
            holdFlashing(true);
            world.updateSpectacles();
            expect(slot.z).toBeCloseTo(full * REDUCED_FLASH_SCALE);
            world.time += 0.35;
            world.updateSpectacles();
            expect(slot.x).toBe(radius);
            holdFlashing(false);
            world.update({ time: world.time, delta: 0 }, camera);
            const fullRails = world.shared.uWarpRails.value.w;
            expect(fullRails).toBeGreaterThan(0);
            holdFlashing(true);
            world.update({ time: world.time, delta: 0 }, camera);
            expect(world.shared.uWarpRails.value.w).toBeCloseTo(fullRails * REDUCED_FLASH_SCALE);
        } finally {
            holdFlashing(false);
            world.dispose();
        }
    });

    it('coasts down gracefully on game over and self-recovers cleanly without getting stuck', () => {
        const { world, camera } = makeWorld();
        try {
            world.onGameOver();
            tick(world, camera, 11.5, 0.2);
            expect(world.road.uniforms.uBrightness.value).toBeLessThan(0.8);
            // Self-recovers back to cruise after COAST_HOLD + COAST_RECOVER (~10 s)
            tick(world, camera, 22.0, 0.2);
            expect(world.road.uniforms.uBrightness.value).toBeCloseTo(1, 2);

            // Or wakes immediately on new session start
            world.onGameOver();
            tick(world, camera, 23.5, 0.2);
            expect(world.road.uniforms.uBrightness.value).toBeLessThan(0.8);
            world.onSessionStart();
            tick(world, camera, 23.7, 0.2);
            expect(world.road.uniforms.uBrightness.value).toBeCloseTo(1, 2);
        } finally {
            world.dispose();
        }
    });

    it('toggles boardActive smoothly to eliminate ghost boxes when no board is shown', () => {
        const { world } = makeWorld();
        try {
            world.setBoardActive(0);
            expect(world.shared.uBoardActive.value).toBe(0);

            world.setBoardActive(1);
            expect(world.shared.uBoardActive.value).toBe(1);
        } finally {
            world.dispose();
        }
    });
});
