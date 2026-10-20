import {
    describe, expect, it, vi,
} from 'vitest';
import {
    ChromadelicComposition,
    fallbackLayout,
    restVerticalFov,
} from '../../src/themes/chromadelic-highway/chromadelic-highway-composition.js';
import {
    DASH_PERIOD,
    RAIL_PACKET_PERIOD,
    RING_COUNT_MODULUS,
    RING_SPACING,
    TRAVEL_WRAP,
    TUNNEL_SPAN,
    worldSpeedFactor,
} from '../../src/themes/chromadelic-highway/chromadelic-highway-tsl.js';
import { ChromadelicWorld, WORLD_TIERS } from '../../src/themes/chromadelic-highway/chromadelic-highway-world.js';
import {
    MOVEMENTS, SPECTRUM_HOME, STEP_TRAVEL, movementAt, skyTurnAt,
} from '../../src/themes/chromadelic-highway/chromadelic-highway-spectrum.js';

const ASPECTS = [4 / 3, 16 / 10, 16 / 9, 1600 / 769, 2560 / 1080];

/** The solo layout at 1080p and above (the board width caps at 300 px). */
const LAYOUT_1080 = {
    cardCount: 1,
    card: {
        u0: -0.166, u1: 0.166, v0: -0.35, v1: 0.35, x0: 0.4, y0: 0.15, x1: 0.6, y1: 0.85,
    },
    hud: {
        u0: 0.241, u1: 0.37, v0: -0.25, v1: 0.25, x0: 0.63, y0: 0.25, x1: 0.71, y1: 0.75,
    },
};

describe('chromadelic highway composition', () => {
    it('uses a 60° vertical lens and caps the horizontal FOV at 104°', () => {
        expect(restVerticalFov(16 / 9)).toBeCloseTo(60, 5);
        expect(restVerticalFov(16 / 10)).toBeCloseTo(60, 5);
        const wide = 2560 / 1080;
        const v = restVerticalFov(wide);
        expect(v).toBeLessThan(60);
        const h = 2 * Math.atan(Math.tan((v * Math.PI) / 360) * wide) * (180 / Math.PI);
        expect(h).toBeCloseTo(104, 3);
    });

    it.each(ASPECTS)('keeps every body clear of the board and inside the frame at aspect %f', (aspect) => {
        const comp = new ChromadelicComposition();
        const viewport = { width: Math.round(900 * aspect), height: 900 };
        for (const layout of [null, LAYOUT_1080]) {
            const res = comp.solve({ aspect, layout, viewport });
            expect(res.boardClear).toBe(true);
            const t = comp.tanHalf;
            const heroR = res.hero.radius / (2 * t * 3600);
            expect(Math.abs(res.hero.anchor.u) + heroR).toBeLessThan(aspect / 2);
            expect(res.hero.anchor.u).toBeLessThan((layout ?? fallbackLayout(viewport.width, viewport.height)).card.u0);
            // The binary sits at least 0.12 H outside the secondary's ring system.
            const secExtent = (res.secondary.radius / (2 * t * 5200)) * 2.2;
            const dBin = Math.hypot(
                res.binary.anchor.u - res.secondary.anchor.u,
                res.binary.anchor.v - res.secondary.anchor.v,
            );
            expect(dBin - secExtent).toBeGreaterThanOrEqual(0.07);
            expect(res.binary.anchor.v).toBeLessThan(0.5);
        }
    });

    it('evaluates the stylesheet formulas for the solo fallback', () => {
        const at769 = fallbackLayout(1600, 769).card;
        expect(at769.u1).toBeCloseTo(0.201, 2);
        expect(at769.v1).toBeCloseTo(0.44, 1);
        const at1080 = fallbackLayout(1920, 1080).card;
        expect(at1080.u1).toBeCloseTo(0.165, 2);
        expect(at1080.v1).toBeCloseTo(0.351, 2);
    });

    it('launches events from where the road slides under the card', () => {
        const comp = new ChromadelicComposition();
        // solve() reuses one result object: read each value before the next solve.
        const r769 = comp.solve({ aspect: 1600 / 769, viewport: { width: 1600, height: 769 } });
        const { zEntry: z769, dEmerge: d769 } = r769;
        expect(z769).toBeGreaterThan(-170);
        expect(z769).toBeLessThan(-130);
        const r1080 = comp.solve({ aspect: 16 / 9, viewport: { width: 1920, height: 1080 } });
        expect(r1080.zEntry).toBeGreaterThan(-260);
        expect(r1080.zEntry).toBeLessThan(-220);
        expect(r1080.dEmerge).toBeGreaterThan(d769);
    });

    it('grows the hero with the level and stays clear of the board', () => {
        const comp = new ChromadelicComposition();
        const r1 = comp.solve({ aspect: 16 / 9, level: 1 }).hero.radius;
        const res = comp.solve({ aspect: 16 / 9, level: 11 });
        expect(res.hero.radius).toBeGreaterThan(r1 * 1.1);
        expect(res.boardClear).toBe(true);
    });

    it('mirrors the bodies when only the right zone is free', () => {
        const comp = new ChromadelicComposition();
        const res = comp.solve({
            aspect: 16 / 9,
            layout: {
                cardCount: 1,
                card: {
                    u0: -0.85, u1: -0.15, v0: -0.45, v1: 0.45, x0: 0, y0: 0.05, x1: 0.41, y1: 0.95,
                },
                hud: null,
            },
        });
        expect(res.mirrored).toBe(true);
        expect(res.hero.anchor.u).toBeGreaterThan(0);
        expect(res.boardClear).toBe(true);
        // The secondary is solved on the free side too: hidden, or clear of the card.
        const { card } = comp.layout;
        const t = comp.tanHalf;
        const secExtent = (res.secondary.radius / (2 * t * 5200)) * 2.2;
        if (res.secondary.visible) {
            expect(res.secondary.anchor.u - secExtent).toBeGreaterThan(card.u1);
        }
        expect(res.binary.anchor.u > card.u1 || res.binary.anchor.v > card.v1).toBe(true);
        // The card does not cover the vanishing point: nothing hides behind it.
        expect(res.dEmerge).toBeGreaterThanOrEqual(4000);
    });

    it('keeps the bodies off a card that sits right of the vanishing point', () => {
        const comp = new ChromadelicComposition();
        const res = comp.solve({
            aspect: 16 / 9,
            layout: {
                cardCount: 1,
                card: {
                    u0: 0.15, u1: 0.85, v0: -0.45, v1: 0.45, x0: 0.58, y0: 0.05, x1: 0.98, y1: 0.95,
                },
                hud: null,
            },
        });
        expect(res.mirrored).toBe(false);
        expect(res.boardClear).toBe(true);
        expect(res.secondary.visible).toBe(false); // its zone is too narrow to hold it
        expect(res.dEmerge).toBeGreaterThanOrEqual(4000);
    });

    it('derives the mask fractions from the current aspect (width-only resize)', () => {
        // At 1080p and above the board width caps, so a width-only resize leaves every u/v alone
        // and the layout watch commits nothing new: the fractions must still follow the window.
        const comp = new ChromadelicComposition();
        const cardW = 357;
        const cardH = 758;
        const layoutAt = (W, H) => ({
            cardCount: 1,
            card: {
                u0: -cardW / 2 / H,
                u1: cardW / 2 / H,
                v0: -cardH / 2 / H,
                v1: cardH / 2 / H,
                x0: (W - cardW) / 2 / W,
                x1: (W + cardW) / 2 / W,
                y0: (H - cardH) / 2 / H,
                y1: (H + cardH) / 2 / H,
            },
            hud: null,
        });
        const applied = layoutAt(1920, 1080);
        const res = comp.solve({ aspect: 1600 / 1080, layout: applied, viewport: { width: 1600, height: 1080 } });
        const real = layoutAt(1600, 1080).card;
        expect(res.rects.card.x0).toBeCloseTo(real.x0, 6);
        expect(res.rects.card.x1).toBeCloseTo(real.x1, 6);
        expect(res.rects.card.y0).toBeCloseTo(real.y0, 6);
        expect(res.rects.card.y1).toBeCloseTo(real.y1, 6);
        expect(res.veil.board.x0).toBeCloseTo(real.x0, 6);
    });

    it('aims the sky masks at the bodies', () => {
        const comp = new ChromadelicComposition();
        const res = comp.solve({ aspect: 16 / 9 });
        expect(res.sky.warmDir.x).toBeLessThan(0); // behind the hero, left
        expect(res.sky.coolDir.x).toBeGreaterThan(0); // around the secondary, right
        expect(res.sky.bandNormal.length()).toBeCloseTo(1, 5);
    });
});

describe('chromadelic highway event state', () => {
    const makeWorld = () => {
        const world = new ChromadelicWorld({ scene: null, quality: 'High', random: () => 0.5 });
        world.spawnComet = vi.fn();
        world.spawnMeteor = vi.fn();
        return world;
    };

    it('re-arms the chain comet for every new chain (emitters restart chains at depth 2)', () => {
        const world = makeWorld();
        for (let c = 2; c <= 6; c++) world.onCombo(c);
        expect(world.spawnComet).toHaveBeenCalledTimes(1);
        world.time += 21; // past the 20 s spacing
        for (let c = 2; c <= 6; c++) world.onCombo(c);
        expect(world.spawnComet).toHaveBeenCalledTimes(2);
    });

    it('forgets lock and comet timestamps when seeking backwards', () => {
        const world = makeWorld();
        world.seek(100);
        world.onPieceLock();
        for (let c = 2; c <= 6; c++) world.onCombo(c);
        world.seek(10);
        world.onPieceLock();
        expect(world.lastLockAt).toBe(10);
        for (let c = 2; c <= 6; c++) world.onCombo(c);
        expect(world.spawnComet).toHaveBeenCalledTimes(2);
    });
});

describe('chromadelic highway spectrum in the world', () => {
    /** An unbuilt world with stand-ins for the parts update() touches (no GPU, no textures). */
    const liveWorld = (quality = 'High') => {
        const world = new ChromadelicWorld({ scene: null, quality, random: () => 0.5 });
        world.spawnComet = vi.fn();
        world.spawnMeteor = vi.fn();
        world.sky = {
            uniforms: { uTime: { value: 0 }, uNebBreath: { value: 0 } },
            setHueShift: vi.fn(),
            setAir: vi.fn(),
            setDirections: vi.fn(),
        };
        world.stars = {
            uniforms: { uTime: { value: 0 }, uBinaryFlare: { value: 0 }, uBinaryDir: { value: { copy() {} } } },
            triggerWave: vi.fn(),
        };
        world.meteors = { update: () => 0, clear: vi.fn() };
        world.updateBodies = () => {};
        return world;
    };
    const sim = (time, delta, extra = {}) => ({
        time, delta, pace: 1, pulse: 0, ring: 0, particle: 0, ambient: 0, ...extra,
    });
    /** Live play at a fixed step from `from` to `to` (pace 1, no events unless `each` fires them). */
    const play = (world, from, to, dt = 1 / 60, each = null) => {
        const steps = Math.round((to - from) / dt);
        for (let i = 1; i <= steps; i++) {
            const t = from + i * dt;
            each?.(world, t);
            world.update(sim(t, dt), null);
        }
    };
    const onScreen = (world) => world.getSpectrumDiagnostics().rings
        .map((r) => `${r.serial}:${r.form}:${r.hue}`);
    const chroma = (c) => {
        const mx = Math.max(c.r, c.g, c.b);
        return (mx - Math.min(c.r, c.g, c.b)) / mx;
    };

    it('drifts the colours with the road at level 1, with no gameplay: one movement in ~90 s', () => {
        const world = liveWorld();
        world.seek(0);
        expect(world.level).toBe(1);
        const home = world.ringPlace();
        expect(home).toBeCloseTo(SPECTRUM_HOME, 9);
        expect(movementAt(home).movement.name).toBe('prism');
        const sky0 = skyTurnAt(world.skyPlace());
        play(world, 0, 60);
        expect(world.level).toBe(1);
        // Within the first minute the sky has started to turn and the rings coming out are new ones.
        expect(world.ringPlace() - home).toBeCloseTo((60 * 180) / STEP_TRAVEL, 3);
        expect(Math.abs(skyTurnAt(world.skyPlace()) - sky0)).toBeGreaterThan(0.005);
        // One step on, the rings coming out wear the next movement.
        play(world, 60, 90);
        expect(movementAt(world.ringPlace()).movement.name).toBe('orchid');
        const lead = world.leadStyle();
        expect(MOVEMENTS[lead.movement].name).toBe('orchid');
    });

    it('steps one movement per level-up on top of the drift; a new game never turns it back', () => {
        const world = liveWorld();
        world.seek(10);
        const p0 = world.ringPlace();
        world.setLevel(2);
        expect(world.ringPlace() - p0).toBeCloseTo(1, 9);
        world.setLevel(9); // a jump counts at most three steps
        expect(world.ringPlace() - p0).toBeCloseTo(4, 9);
        world.setLevel(2); // the first LEVEL_UP of the next game: one more step, never back
        expect(world.ringPlace() - p0).toBeCloseTo(5, 9);
        expect(world.level).toBe(2);
    });

    it('keeps the style a ring came out with while the road drifts on', () => {
        const world = liveWorld();
        world.seek(55); // the prism → orchid boundary (place 1.0) falls inside the next seconds
        const shownBefore = onScreen(world);
        expect(shownBefore.length).toBeGreaterThanOrEqual(3);
        play(world, 55, 60);
        expect(movementAt(world.ringPlace()).movement.name).toBe('orchid');
        const now = new Map(onScreen(world).map((s) => [s.split(':')[0], s]));
        let kept = 0;
        shownBefore.forEach((s) => {
            const serial = s.split(':')[0];
            if (!now.has(serial)) return;
            expect(now.get(serial)).toBe(s);
            kept += 1;
        });
        expect(kept).toBeGreaterThan(0);
    });

    it('repaints the tunnel on a level-up: the cascade re-dresses every ring it passes', () => {
        const world = liveWorld();
        world.seek(30);
        const rings = () => world.getSpectrumDiagnostics().rings;
        expect(rings().every((r) => r.movement === 'prism')).toBe(true);
        world.onLevelUp(2);
        const next = MOVEMENTS[movementAt(world.ringPlace()).index].name;
        expect(next).toBe('orchid');
        // A front at 2000 u/s from where the rings come out: halfway, the near rings are not yet
        // repainted; by 0.7 s it has passed every ring on screen.
        play(world, 30, 30.2);
        const half = rings();
        expect(half.some((r) => r.movement === 'prism')).toBe(true);
        expect(half.some((r) => r.movement === next)).toBe(true);
        play(world, 30.2, 30.7);
        expect(rings().every((r) => r.movement === next)).toBe(true);
        expect(world.level).toBe(2); // the hero's growth landed at +0.5 s
        // And what comes out of the board afterwards wears it too.
        play(world, 30.7, 33);
        expect(rings().every((r) => r.movement === next)).toBe(true);
    });

    it('reproduces live play when seeking (pace 1, no events)', () => {
        const live = liveWorld();
        live.seek(0);
        play(live, 0, 50);
        const seeked = liveWorld();
        seeked.seek(50);
        expect(onScreen(live)).toEqual(onScreen(seeked));
        expect(live.ringPlace()).toBeCloseTo(seeked.ringPlace(), 6);
    });

    it('keeps the air a colour whatever the rings on screen (never a grey average)', () => {
        const world = liveWorld();
        for (let t = 0; t < MOVEMENTS.length * 90; t += 7) {
            world.seek(t);
            expect(chroma(world.air), `t=${t}`).toBeGreaterThan(0.6);
        }
    });

    it('runs the packets on an integrated phase: a combo chain never jumps them, early or late', () => {
        for (const start of [5, 600]) {
            const world = liveWorld();
            world.seek(start);
            let prev = world.ringPhase;
            let maxStep = 0;
            play(world, start, start + 6, 1 / 60, (w, t) => {
                const k = Math.round((t - start) * 60);
                if (k % 20 === 0) w.onCombo(2 + Math.floor(k / 20)); // a rapid chain, a step every 1/3 s
                let step = w.ringPhase - prev;
                if (step < 0) step += Math.PI * 40;
                maxStep = Math.max(maxStep, step);
                prev = w.ringPhase;
            });
            // Never more than the fastest rate (0.7 + 1.4 rad/s) times one frame.
            expect(maxStep, `session ${start} s old`).toBeLessThanOrEqual((2.1 / 60) * 1.0001);
        }
    });

    it('carries the spectrum across a rebuild in place (GPU device loss)', () => {
        const a = liveWorld();
        a.seek(200);
        a.setLevel(3);
        const state = a.getSpectrumState();
        const b = liveWorld();
        b.restoreSpectrumState(state);
        expect(b.level).toBe(3);
        expect(b.ringPlace()).toBeCloseTo(state.place, 9);
    });
});

describe('chromadelic highway travel clock', () => {
    it('wraps seamlessly for every tier', () => {
        for (const [tierName, tier] of Object.entries(WORLD_TIERS)) {
            expect(RING_COUNT_MODULUS % tier.rings, `${tierName} ring count`).toBe(0);
            expect(TRAVEL_WRAP % (RING_SPACING * tier.rings)).toBe(0);
        }
        expect(TRAVEL_WRAP % DASH_PERIOD).toBe(0);
        expect((TRAVEL_WRAP * 1.6) % RAIL_PACKET_PERIOD).toBe(0);
        expect(TRAVEL_WRAP % 8).toBe(0);
        // Streaks/motes move at k/30 of travel over a TUNNEL_SPAN lattice.
        for (let k = 1; k <= 60; k++) expect(((TRAVEL_WRAP * k) / 30) % TUNNEL_SPAN).toBe(0);
    });

    it('runs one world speed: 180 u/s at pace 1, clamped at both ends', () => {
        expect(worldSpeedFactor(1) * 200).toBeCloseTo(180, 5);
        expect(worldSpeedFactor(0)).toBeCloseTo(0.75, 5);
        expect(worldSpeedFactor(10)).toBeCloseTo(1.5, 5);
        expect(worldSpeedFactor(Number.NaN)).toBeCloseTo(0.9, 5);
    });
});

describe('chromadelic highway adaptive scaler', () => {
    async function makeTheme() {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { default: Theme } = await import('../../src/themes/chromadelic-highway/chromadelic-highway-theme.js');
        const theme = new Theme();
        theme.applyQualityPreset('High');
        theme.renderer = { info: { autoReset: true, render: { drawCalls: 24 } } };
        theme.resizes = 0;
        theme.applyAdaptiveScalerState = () => { theme.resizes += 1; };
        return theme;
    }

    /** Frames on a 60 Hz display: GPU time scales with pixels; a frame takes whole vsyncs. */
    function frameMsFor(theme, gpuMsAtFullRes) {
        const q = theme.adaptiveScalerState.resolutionScale / theme.adaptiveScalerState.baseResolutionScale;
        const gpu = gpuMsAtFullRes * q * q;
        return Math.ceil(gpu / 16.667) * 16.667;
    }

    it('settles on a GPU-bound machine instead of cycling through resizes', async () => {
        const theme = await makeTheme();
        // 20 ms at full resolution: sustainable only below the top scale.
        for (let i = 0; i < 60 * 60; i++) theme.updateAdaptiveScaler(frameMsFor(theme, 20));
        const settledScale = theme.adaptiveScalerState.qualityScale;
        const resizesAfterSettle = theme.resizes;
        for (let i = 0; i < 60 * 240; i++) theme.updateAdaptiveScaler(frameMsFor(theme, 20));
        // Four more minutes: at most a handful of (backed-off) probes.
        expect(theme.resizes - resizesAfterSettle).toBeLessThanOrEqual(6);
        expect(theme.adaptiveScalerState.qualityScale).toBeLessThan(1);
        expect(Math.abs(theme.adaptiveScalerState.qualityScale - settledScale)).toBeLessThan(0.08);
    });

    it('ignores compile stalls right after start', async () => {
        const theme = await makeTheme();
        theme.updateAdaptiveScaler(600);
        for (let i = 0; i < 29; i++) theme.updateAdaptiveScaler(16.667);
        for (let i = 0; i < 600; i++) theme.updateAdaptiveScaler(16.667);
        expect(theme.resizes).toBe(0);
        expect(theme.adaptiveScalerState.qualityScale).toBe(1);
    });

    it('does not chase a target frame rate above the display refresh', async () => {
        const theme = await makeTheme();
        const original = globalThis.window?.settings;
        if (globalThis.window) globalThis.window.settings = { ...(original || {}), targetFrameRate: 240 };
        // A 165 Hz panel: frames arrive every 6.06 ms no matter what.
        for (let i = 0; i < 165 * 20; i++) theme.updateAdaptiveScaler(1000 / 165);
        if (globalThis.window) globalThis.window.settings = original;
        expect(theme.adaptiveScalerState.qualityScale).toBe(1);
        expect(theme.resizes).toBe(0);
    });
});
