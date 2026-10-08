import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    AMBIENT_BEAT, CHROMATIC_IMPASTO_PARTS, ChromaticImpastoWorld, DRY_STEP, LAMP, REST_RIG, fovForAspect,
} from '../../src/themes/chromatic-impasto/chromatic-impasto-world.js';
import {
    GOLD, HUSH_HOLD, IMPASTO_PERIODS, INTRO_SPAN, KIND, SHEEN_SLOTS, SWIRL_FROM, TWIST_BAKE_AT, VIEW_DISTANCE, pigmentFromHex,
} from '../../src/themes/chromatic-impasto/chromatic-impasto-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/chromatic-impasto/chromatic-impasto-quality.js';
import { fallbackLayout } from '../../src/themes/chromatic-impasto/chromatic-impasto-composition.js';
import { canvasExtent } from '../../src/themes/chromatic-impasto/chromatic-impasto-gestures.js';
import { flightTime } from '../../src/themes/chromatic-impasto/chromatic-impasto-fx.js';

/**
 * A renderer double that records what the world draws into its paint: enough of the surface for
 * the stamp, fill, dry and bake passes (QuadMesh#render calls renderer.render too).
 */
function makeRenderer() {
    const renderer = {
        autoClear: true,
        target: null,
        passes: [],
        getRenderTarget() {
            return this.target;
        },
        setRenderTarget(target) {
            this.target = target;
        },
        render(scene) {
            const mesh = scene.isMesh ? scene : scene.children?.[0];
            this.passes.push({
                target: this.target?.texture?.name ?? null,
                material: mesh?.material?.name ?? null,
                autoClear: this.autoClear,
                range: mesh?.geometry?.drawRange?.count ?? null,
            });
        },
    };
    return renderer;
}

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, renderer = null, time = 10, seed = 1,
} = {}) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(REST_RIG.fov, width / height, REST_RIG.near, REST_RIG.far);
    const world = new ChromaticImpastoWorld({
        scene, quality, capture: true, renderer, seed,
    }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(live ? fallbackLayout(width, height) : null, width / height);
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
    return { scene, camera, world };
}

/** Advance the world from its current time by `seconds` in equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60))) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
    }
}

const tagged = (world, tag) => world.painter.log.filter((s) => s.tag === tag);
const startOf = (s) => [(s.baseLeft[0] + s.baseRight[0]) / 2, (s.baseLeft[1] + s.baseRight[1]) / 2];
const endOf = (s) => {
    const n = s.nodes * 2;
    return [(s.baseLeft[n - 2] + s.baseRight[n - 2]) / 2, (s.baseLeft[n - 1] + s.baseRight[n - 1]) / 2];
};

describe('chromatic impasto world: build', () => {
    it('builds every part on every tier and takes them all down again', () => {
        QUALITY_NAMES.forEach((quality) => {
            const { scene, world } = makeWorld(quality);
            const names = Object.keys(world.parts);
            names.forEach((name) => expect(CHROMATIC_IMPASTO_PARTS).toContain(name));
            expect(names).toEqual(expect.arrayContaining(['canvas', 'droplets', 'shadows']));
            expect(names.includes('motes')).toBe(QUALITY[quality].motes > 0);
            expect(world.droplets.count).toBe(QUALITY[quality].droplets);
            expect(scene.children).toContain(world.root);
            world.dispose();
            world.dispose();
            expect(scene.children).not.toContain(world.root);
            expect(world.canvas).toBeNull();
            expect(world.u).toBeNull();
        });
    });

    it('frames the canvas: two units tall at the rest distance, the cloth a little past the frame', () => {
        const { world, camera } = makeWorld('Low');
        expect(fovForAspect(0.5)).toBe(fovForAspect(2.4));
        expect(REST_RIG.distance).toBeCloseTo(VIEW_DISTANCE, 9);
        expect(camera.position.z).toBeGreaterThan(REST_RIG.distance - 0.01);
        expect(Math.hypot(camera.position.x, camera.position.y)).toBeLessThan(0.08);
        const { halfX, halfY } = canvasExtent(1600 / 900);
        const surface = world.parts.canvas.mesh;
        expect(surface.scale.x).toBeCloseTo(halfX, 6);
        expect(surface.scale.y).toBeCloseTo(halfY, 6);
        expect(halfY).toBeGreaterThan(1);
        expect(world.screenToCanvas(0.5, 0.5)).toEqual([0, 0]);
        expect(world.screenToCanvas(1, 0)[0]).toBeCloseTo(1600 / 900, 6);
        expect(world.screenToCanvas(1, 0)[1]).toBe(1);
        world.dispose();
    });

    it('sizes its paint to the frame and the tier, and repaints when the size changes', () => {
        const low = makeWorld('Low', { width: 1600, height: 900 }).world;
        const high = makeWorld('High', { width: 1600, height: 900 }).world;
        expect(high.canvas.height).toBeGreaterThan(low.canvas.height);
        expect(high.canvas.width / high.canvas.height).toBeCloseTo(1600 / 900, 2);
        expect(high.canvas.height).toBeLessThanOrEqual(QUALITY.High.canvasMax);
        high.needsPaint = false;
        high.setViewport(1200, 675, 1600 / 900);
        expect(high.needsPaint).toBe(true);
        low.dispose();
        high.dispose();
    });

    it('draws only the parts it is asked for', () => {
        const { world } = makeWorld('Medium');
        world.showOnlyParts(['canvas']);
        expect(world.parts.canvas.mesh.visible).toBe(true);
        expect(world.parts.droplets.mesh.visible).toBe(false);
        expect(world.parts.motes.mesh.visible).toBe(false);
        world.dispose();
    });
});

describe('chromatic impasto world: the painting', () => {
    it('blocks the canvas in over the intro, and is the same canvas whenever it is looked at', () => {
        const early = makeWorld('Low', { time: 1 }).world;
        const under = tagged(early, 'under');
        expect(under.length).toBeGreaterThan(150);
        const begun = under.filter((s) => s.drawn > 0 || s.done).length;
        expect(begun).toBeGreaterThan(10);
        expect(begun).toBeLessThan(under.length);
        const late = makeWorld('Low', { time: INTRO_SPAN + 2 }).world;
        expect(tagged(late, 'under').every((s) => s.done)).toBe(true);
        expect(tagged(late, 'under').map((s) => s.seed)).toEqual(under.map((s) => s.seed));
        const other = makeWorld('Low', { time: 1, seed: 2 }).world;
        expect(tagged(other, 'under').map((s) => s.seed)).not.toEqual(under.map((s) => s.seed));
        early.dispose();
        late.dispose();
        other.dispose();
    });

    it('lays the same paint at 30 and at 240 frames a second', () => {
        const laid = (fps) => {
            const { world, camera } = makeWorld('Minimal', { time: 0 });
            run(world, camera, INTRO_SPAN + 1, Math.round((INTRO_SPAN + 1) * fps));
            const done = world.painter.log.filter((s) => s.done).length;
            const reach = world.painter.log.reduce((sum, s) => sum + (s.drawn || 0), 0);
            world.dispose();
            return { done, reach };
        };
        const slow = laid(30);
        const fast = laid(240);
        expect(fast.done).toBe(slow.done);
        expect(fast.reach).toBeCloseTo(slow.reach, 4);
    });

    it('keeps the painter at work between events, on the studio\'s clock', () => {
        const { world, camera } = makeWorld('Low', { time: 20 });
        expect(tagged(world, 'ambient')).toHaveLength(0);
        run(world, camera, AMBIENT_BEAT * 3 + 0.1);
        const ambient = tagged(world, 'ambient');
        expect(ambient.length).toBeGreaterThanOrEqual(3);
        expect(ambient.length).toBeLessThanOrEqual(4);
        ambient.forEach((s) => expect(s.dur).toBeGreaterThan(1));
        world.dispose();
    });

    it('draws into both paint targets without clearing them, and dries the paint by steps', () => {
        const renderer = makeRenderer();
        const { world, camera } = makeWorld('Low', { renderer, time: INTRO_SPAN + 2 });
        // The first frame fills both targets, then lays the whole underpainting into them.
        const fills = renderer.passes.filter((p) => /fill/.test(p.material));
        expect(fills.map((p) => p.target)).toEqual(['Chromatic Impasto — pigment 0', 'Chromatic Impasto — relief 0']);
        // Before any paint, the passes a game meets late are drawn once so they compile now:
        // the bake into the spare pair (which nothing reads), and one drying step of no effect.
        const first = renderer.passes.slice(2, 5).map((p) => [p.material, p.target]);
        expect(first).toEqual([
            ['Chromatic Impasto — bake pigment', 'Chromatic Impasto — pigment 1'],
            ['Chromatic Impasto — bake relief', 'Chromatic Impasto — relief 1'],
            ['Chromatic Impasto — dry', 'Chromatic Impasto — pigment 0'],
        ]);
        const stamps = renderer.passes.filter((p) => /stamp/.test(p.material));
        expect(stamps.length).toBeGreaterThanOrEqual(2);
        expect(stamps.length % 2).toBe(0);
        stamps.forEach((p, i) => {
            expect(p.autoClear).toBe(false);
            expect(p.material).toMatch(i % 2 === 0 ? /pigment/ : /relief/);
            expect(p.target).toMatch(i % 2 === 0 ? /pigment 0/ : /relief 0/);
            expect(p.range).toBeGreaterThan(0);
        });
        expect(renderer.target).toBeNull();
        expect(renderer.autoClear).toBe(true);

        // (The painter's own strokes are held back here, so only what this test asks for is laid.)
        world.ambientIndex = Infinity;
        // Nothing due: nothing is stamped, and the only passes are the drying steps.
        renderer.passes.length = 0;
        run(world, camera, DRY_STEP * 4 + 0.01, 60);
        expect(renderer.passes.filter((p) => /stamp/.test(p.material))).toHaveLength(0);
        const dries = renderer.passes.filter((p) => /dry/.test(p.material));
        expect(dries).toHaveLength(4);
        dries.forEach((p) => expect(p.target).toMatch(/pigment 0/));

        // A lock is stamped while its brush moves, and not after.
        renderer.passes.length = 0;
        world.onLock({ rows: [12], u: 0.2, color: '#b30000' });
        run(world, camera, 1.5, 90);
        expect(renderer.passes.filter((p) => /stamp/.test(p.material)).length).toBeGreaterThan(4);
        renderer.passes.length = 0;
        run(world, camera, 0.2, 12);
        expect(renderer.passes.filter((p) => /stamp/.test(p.material))).toHaveLength(0);
        world.dispose();
    });

    it('keeps the paint through a change of resolution, and lays it again on a cloth of another shape', () => {
        const renderer = makeRenderer();
        const { world, camera } = makeWorld('Low', { renderer, time: INTRO_SPAN + 2 });
        world.ambientIndex = Infinity;
        world.onLock({ rows: [10], u: 0.8, color: '#00d9cc' });
        run(world, camera, 1.5);
        // The same cloth at another resolution (a render-scale step): the paint is resampled.
        renderer.passes.length = 0;
        const before = world.canvas.height;
        world.setViewport(1280, 720, 1600 / 900);
        expect(world.canvas.height).not.toBe(before);
        expect(world.needsPaint).toBe(false);
        expect(renderer.passes.map((p) => p.material)).toEqual([
            'Chromatic Impasto — bake pigment', 'Chromatic Impasto — bake relief',
        ]);
        run(world, camera, 0.05, 2);
        expect(renderer.passes.filter((p) => /fill|stamp/.test(p.material))).toHaveLength(0);

        // A frame of another shape is another canvas: blocked in again, with the game's paint on it.
        renderer.passes.length = 0;
        world.setViewport(900, 900, 1);
        world.setLayout(fallbackLayout(900, 900), 1);
        expect(world.needsPaint).toBe(true);
        // Live, the replay is spread over a few frames.
        world.capture = false;
        run(world, camera, 0.5, 30);
        expect(renderer.passes.filter((p) => /fill/.test(p.material))).toHaveLength(2);
        expect(renderer.passes.filter((p) => /stamp/.test(p.material)).length).toBeGreaterThanOrEqual(2);
        expect(tagged(world, 'under').every((s) => s.done)).toBe(true);
        expect(world.painter.log.filter((s) => s.tag === 'lock' && s.done)).toHaveLength(1);
        const { halfX } = canvasExtent(1);
        expect(world.canvas.halfX).toBeCloseTo(halfX, 6);
        world.dispose();
    });

    it('lets a replayed painting dry as it is laid', () => {
        const renderer = makeRenderer();
        const { world } = makeWorld('Low', { renderer, time: 40 });
        // The underpainting is 35 s old by now: one long drying step went over it.
        const dries = renderer.passes.filter((p) => /dry/.test(p.material));
        expect(dries.length).toBeGreaterThanOrEqual(1);
        expect(world.painter.clock).toBe(40);
        world.dispose();
    });
});

describe('chromatic impasto world: the board paints', () => {
    it('lays a lock out of the board\'s side, on the piece\'s side and at its height, in its colour', () => {
        const { world } = makeWorld('Low');
        const { card } = world;
        world.onLock({ rows: [1, 2], u: 0.15, color: '#00d9cc' });
        world.onLock({ rows: [17, 18], u: 0.9, color: '#b30000' });
        const [first, second] = tagged(world, 'lock');
        expect(first.colorA).toEqual(pigmentFromHex('#00d9cc'));
        expect(startOf(first)[0]).toBeLessThan(card.x0);
        expect(startOf(first)[0]).toBeGreaterThan(card.x0 - 0.03); // it leaves the card's very edge
        expect(endOf(first)[0]).toBeLessThan(startOf(first)[0] - 0.1); // and goes outward
        expect(startOf(first)[1]).toBeGreaterThan(0.2); // high on the board: high on the canvas
        expect(startOf(second)[0]).toBeGreaterThan(card.x1);
        expect(endOf(second)[0]).toBeGreaterThan(startOf(second)[0] + 0.1);
        expect(startOf(second)[1]).toBeLessThan(-0.2);
        // The second stroke picks up the first one's colour, wet.
        expect(second.colorB).toEqual(pigmentFromHex('#00d9cc'));
        expect(second.mixB).toBeGreaterThan(0);
        expect(world.counts.locks).toBe(2);
        expect(world.kick).toBeGreaterThan(0);
        world.dispose();
    });

    it('reaches nearer and farther from lock to lock rather than piling the paint on one spot', () => {
        const { world } = makeWorld('Low');
        for (let i = 0; i < 16; i++) world.onLock({ rows: [10], u: 0.2, color: '#ffd000' });
        const locks = tagged(world, 'lock');
        const lengths = locks.map((s) => s.length);
        expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(0.35);
        const tips = locks.map((s) => endOf(s));
        const spread = (k) => Math.max(...tips.map((p) => p[k])) - Math.min(...tips.map((p) => p[k]));
        expect(Math.max(spread(0), spread(1))).toBeGreaterThan(0.35);
        locks.forEach((s) => {
            expect(startOf(s)[0]).toBeLessThan(world.card.x0);
            expect(startOf(s)[0]).toBeGreaterThan(world.card.x0 - 0.03);
        });
        world.dispose();
    });

    it('answers a hard drop with the knife, a splat and paint in the air that lands where it says', () => {
        const { world, camera } = makeWorld('Low');
        world.onLock({
            rows: [12], u: 0.7, hardDrop: true, color: '#ff7f00',
        });
        const [slab] = tagged(world, 'lock');
        expect(slab.kind).toBe(KIND.KNIFE);
        const splat = tagged(world, 'splat');
        expect(splat.length).toBeGreaterThan(4);
        expect(splat.every((b) => b.kind === KIND.BLOB)).toBe(true);
        const drops = tagged(world, 'drop');
        expect(drops.length).toBeGreaterThan(5);
        drops.forEach((d) => {
            expect(d.t0).toBeGreaterThan(world.time);
            expect(d.t0).toBeLessThan(world.time + flightTime(3) + 0.2);
            expect(d.colorA).toEqual(pigmentFromHex('#ff7f00'));
        });
        // Each drop in the pool lands where its dot is laid.
        const { aStart, aVel } = world.droplets.state;
        let matched = 0;
        for (let i = 0; i < world.droplets.count; i++) {
            if (aStart[i * 4 + 3] < 0) continue;
            const flight = flightTime(aVel[i * 4 + 2], aStart[i * 4 + 2]);
            const x = aStart[i * 4] + aVel[i * 4] * flight;
            const y = aStart[i * 4 + 1] + aVel[i * 4 + 1] * flight;
            if (drops.some((d) => Math.hypot(d.x - x, d.y - y) < 1e-4 && Math.abs(d.t0 - (aStart[i * 4 + 3] + flight)) < 1e-4)) {
                matched += 1;
            }
        }
        expect(matched).toBe(drops.length);
        run(world, camera, 2.5);
        expect(tagged(world, 'drop').every((d) => d.done)).toBe(true);
        world.dispose();
    });

    it('lays a lock above or below the board when the frame has no cloth beside it', () => {
        const { world } = makeWorld('Low', { width: 300, height: 932 });
        expect(world.card.x0 + world.aspect).toBeLessThan(0.16);
        world.onLock({ rows: [2], u: 0.3, color: '#0033cc' });
        world.onLock({ rows: [18], u: 0.6, color: '#0033cc' });
        const [top, bottom] = tagged(world, 'lock');
        expect(startOf(top)[1]).toBeGreaterThan(world.card.y1);
        expect(startOf(bottom)[1]).toBeLessThan(world.card.y0);
        world.dispose();
    });

    it('sends each cleared row out of the card\'s sides at its own height, in the colours just laid', () => {
        const { world } = makeWorld('Low');
        world.onLock({ rows: [19], u: 0.3, color: '#00d9cc' });
        world.onLock({ rows: [18], u: 0.6, color: '#ffd000' });
        world.onClear({ rows: [19, 18], lines: 2 });
        const sweeps = tagged(world, 'sweep');
        expect(sweeps).toHaveLength(4);
        const heights = [...new Set(sweeps.map((s) => +startOf(s)[1].toFixed(4)))].sort((a, b) => a - b);
        expect(heights).toHaveLength(2);
        expect(heights[1] - heights[0]).toBeGreaterThan(0.04);
        expect(heights[0]).toBeLessThan(-0.5); // the floor rows are at the foot of the board
        const colours = sweeps.map((s) => s.colorA.join());
        expect(colours).toContain(pigmentFromHex('#ffd000').join());
        expect(colours).toContain(pigmentFromHex('#00d9cc').join());
        // A ring of wet light leaves the board.
        const slots = world.u.sheenSlots.filter((v) => v.z > 0);
        expect(slots).toHaveLength(1);
        expect(slots[0].w).toBeGreaterThan(0.5);
        expect(world.counts.clears).toBe(1);
        world.dispose();
    });

    it('holds its breath before four lines, then flings paint and lays gold', () => {
        const { world, camera } = makeWorld('Low');
        const t = world.time;
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(world.hushUntil).toBeCloseTo(t + HUSH_HOLD, 6);
        expect(tagged(world, 'sweep')).toHaveLength(8);
        const burst = tagged(world, 'burst');
        expect(burst.filter((s) => s.kind !== KIND.BLOB).length).toBeGreaterThanOrEqual(14);
        expect(burst.every((s) => s.t0 >= t + HUSH_HOLD)).toBe(true);
        const gold = tagged(world, 'gold');
        expect(gold.length).toBeGreaterThanOrEqual(12);
        expect(gold.every((s) => s.special === 1 && s.t0 > t + HUSH_HOLD)).toBe(true);
        expect(gold[0].colorA).toEqual([...GOLD]);
        run(world, camera, HUSH_HOLD * 0.5, 4);
        expect(world.getPostState().hush).toBe(1);
        expect(world.breath).toBeLessThan(0.6);
        run(world, camera, 0.5);
        expect(world.getPostState().hush).toBe(0);
        expect(world.surge).toBeGreaterThan(0.5);
        expect(world.counts.quads).toBe(1);
        // The next four lines lay their ring outside the first.
        const reachOf = (list) => Math.max(...list.map((s) => Math.abs(startOf(s)[0])));
        const firstRing = reachOf(gold);
        world.onClear({ rows: [19, 18, 17, 16], lines: 4 });
        expect(reachOf(tagged(world, 'gold'))).toBeGreaterThan(firstRing + 0.05);
        // A perfect clear lays more: a second ring, and two great arcs.
        const perfect = makeWorld('Low').world;
        perfect.onClear({ rows: [19, 18, 17, 16], lines: 4, perfect: true });
        expect(tagged(perfect, 'gold').length).toBeGreaterThan(gold.length + 12);
        world.dispose();
        perfect.dispose();
    });

    it('draws an arc for every link of a chain and turns the canvas while it holds', () => {
        const { world, camera } = makeWorld('Low');
        world.onCombo(1);
        run(world, camera, 1);
        expect(world.twistAngle).toBe(0);
        expect(tagged(world, 'spiral')).toHaveLength(0);
        world.onCombo(SWIRL_FROM);
        const arcs = tagged(world, 'spiral').length;
        expect(arcs).toBeGreaterThan(0);
        run(world, camera, 1);
        const turned = world.twistAngle;
        expect(turned).toBeGreaterThan(0.05);
        expect(world.u.twist.value.z).toBeCloseTo(turned, 6);
        expect(world.power).toBeGreaterThan(0);
        world.onCombo(SWIRL_FROM + 3);
        expect(tagged(world, 'spiral').length).toBeGreaterThan(arcs);
        run(world, camera, 1);
        // A later link turns it a bigger notch.
        expect(world.twistAngle - turned).toBeGreaterThan(turned);
        // Held, the chain only creeps: the canvas is turned by links, not by time.
        const held = world.twistAngle;
        run(world, camera, 2);
        expect(world.twistAngle - held).toBeLessThan(0.15);
        world.dispose();
    });

    it('bakes the twist into the paint when it has wound far enough; a broken chain leaves it turned', () => {
        const { world, camera } = makeWorld('Low');
        let peak = 0;
        for (let n = 2; n <= 9; n++) {
            world.onCombo(n);
            for (let i = 0; i < 4; i++) {
                run(world, camera, 0.2);
                peak = Math.max(peak, Math.abs(world.twistAngle));
            }
        }
        expect(peak).toBeLessThanOrEqual(TWIST_BAKE_AT + 0.05);
        expect(world.counts.bakes).toBeGreaterThan(1);
        const { bakes } = world.counts;
        expect(world.painter.log.filter((s) => s.bake).length).toBe(bakes);
        run(world, camera, 0.2);
        const held = world.twistAngle;
        expect(held).toBeGreaterThan(0);
        world.onCombo(0);
        // The chain broke: the canvas stops where it is, still turned.
        expect(world.twistAngle).toBe(held);
        expect(world.twistTarget).toBe(held);
        expect(world.counts.bakes).toBe(bakes);
        run(world, camera, 1);
        expect(world.twistAngle).toBeCloseTo(held, 9);
        // The game ends: what is left is baked in.
        world.resetSession();
        expect(world.twistAngle).toBe(0);
        expect(world.twistTarget).toBe(0);
        expect(world.counts.bakes).toBe(bakes + 1);
        expect(world.painter.log.filter((s) => s.bake).pop().angle).toBeCloseTo(held, 6);
        run(world, camera, 1);
        expect(world.twistAngle).toBe(0);
        world.dispose();
    });

    it('holds the stirring\'s reach while the canvas is turned, and bakes the turn before the board moves', () => {
        const { world, camera } = makeWorld('Low');
        world.onCombo(2);
        run(world, camera, 0.5);
        const reach = world.u.twist.value.w;
        world.onCombo(7); // a longer chain would reach further, but the paint is already turned
        run(world, camera, 0.3);
        expect(world.twistAngle).toBeGreaterThan(0.2);
        expect(world.u.twist.value.w).toBe(reach);
        const { bakes } = world.counts;
        const layout = fallbackLayout(1600, 900);
        layout.cards[0] = {
            x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.9,
        };
        world.setLayout(layout, 1600 / 900);
        expect(world.counts.bakes).toBe(bakes + 1);
        expect(world.twistAngle).toBe(0);
        // The same layout read again moves nothing and bakes nothing.
        run(world, camera, 0.1);
        const after = world.counts.bakes;
        world.setLayout(layout, 1600 / 900);
        expect(world.counts.bakes).toBe(after);
        // Untwisted, the next frame chooses the reach for the chain as it now stands.
        world.onCombo(0);
        world.resetSession();
        world.onCombo(8);
        run(world, camera, 0.05, 3);
        expect(world.u.twist.value.w).toBeGreaterThan(reach);
        world.dispose();
    });

    it('logs a bake after the paint that was begun under its twist, so a replay stirs the same paint', () => {
        const { world, camera } = makeWorld('Low');
        world.ambientIndex = Infinity;
        // Wind the canvas to just under the bake, then let one more link and a lock land together.
        for (let n = 2; n <= 4; n++) {
            world.onCombo(n);
            run(world, camera, 1);
        }
        expect(world.counts.bakes).toBe(0);
        const before = world.twistAngle;
        expect(before).toBeGreaterThan(0.8);
        world.onCombo(5);
        let lock = null;
        for (let i = 0; i < 240 && world.counts.bakes === 0; i++) {
            if (!lock && world.twistAngle > before + 0.05) {
                world.onLock({ rows: [8], u: 0.2, color: '#ffd000' });
                [lock] = tagged(world, 'lock');
            }
            run(world, camera, 1 / 60, 1);
        }
        expect(world.counts.bakes).toBe(1);
        expect(lock).toBeTruthy();
        // The lock began under the twist: in the log it comes before the bake that followed it.
        const { log } = world.painter;
        const bakeAt = log.findIndex((s) => s.bake);
        expect(log.indexOf(lock)).toBeLessThan(bakeAt);
        expect(lock.twist.angle).toBeGreaterThan(before);
        // Everything in the log before the bake had begun when it was baked.
        log.slice(0, bakeAt).forEach((s) => expect(s.warped || s.done).toBe(true));
        world.dispose();
    });

    it('leaves a bake asked for during a replay to its turn in the log', () => {
        const renderer = makeRenderer();
        const { world, camera } = makeWorld('Low', { renderer, time: INTRO_SPAN + 2 });
        world.ambientIndex = Infinity;
        world.onCombo(3);
        run(world, camera, 1);
        const painting = world.exportPainting();
        expect(painting.twist.angle).toBeCloseTo(world.twistAngle, 9);
        const next = makeWorld('Low', { renderer: makeRenderer(), time: 0 });
        next.world.capture = false; // a live world lays a replay a few frames at a time
        next.world.frameBudget = 1500;
        next.world.importPainting(painting);
        next.world.update({ time: painting.time, delta: 0 }, next.camera);
        expect(next.world.painter.behind).toBe(true);
        // The game ends in the middle of the replay: the turn is to be baked, but not yet.
        next.world.resetSession();
        const entry = next.world.painter.log.filter((s) => s.bake).pop();
        expect(entry.done).toBe(false);
        expect(next.world.canvas.bakes).toBe(0);
        for (let i = 1; i <= 20; i++) next.world.update({ time: painting.time + i / 60, delta: 1 / 60 }, next.camera);
        expect(next.world.painter.behind).toBe(false);
        expect(entry.done).toBe(true);
        expect(next.world.canvas.bakes).toBe(1);
        world.dispose();
        next.world.dispose();
    });

    it('blocks the canvas in again when the frame has drifted from the shape it was painted for', () => {
        const { world, camera } = makeWorld('Low');
        expect(world.composedAspect).toBeCloseTo(1600 / 900, 9);
        // A window dragged wider in steps of three per cent: no one step is a reshape, the sum is.
        let aspect = 1600 / 900;
        const shapes = new Set([world.composedAspect]);
        for (let i = 0; i < 6; i++) {
            aspect *= 1.03;
            world.setViewport(Math.round(900 * aspect), 900, aspect);
            run(world, camera, 0.05, 2);
            shapes.add(world.composedAspect);
        }
        expect(shapes.size).toBeGreaterThan(2);
        expect(Math.abs(world.aspect / world.composedAspect - 1)).toBeLessThanOrEqual(0.04);
        expect(tagged(world, 'under').length).toBeGreaterThan(100);
        // A painting handed to a world of another shape is blocked in again there too.
        const painting = world.exportPainting();
        const tall = makeWorld('Low', { width: 430, height: 932, time: 0 });
        tall.world.importPainting(painting);
        expect(tall.world.composedAspect).toBeCloseTo(430 / 932, 6);
        const { halfX } = canvasExtent(430 / 932);
        tagged(tall.world, 'under').forEach((s) => expect(Math.abs(startOf(s)[0])).toBeLessThan(halfX + 1.2));
        world.dispose();
        tall.world.dispose();
    });

    it('sends cleared rows out from under the board\'s foot and over its top when the frame is too narrow for its sides', () => {
        const { world } = makeWorld('Low', { width: 430, height: 932 });
        const { card } = world;
        expect(Math.min(card.x0 + world.aspect, world.aspect - card.x1)).toBeLessThan(0.3);
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        const sweeps = tagged(world, 'sweep');
        expect(sweeps).toHaveLength(6);
        sweeps.forEach((s) => {
            const y = startOf(s)[1];
            expect(y < card.y0 || y > card.y1).toBe(true);
            // Each runs from the middle to the edge of the cloth.
            expect(Math.abs(startOf(s)[0] - world.heart.x)).toBeLessThan(0.08);
            expect(Math.abs(endOf(s)[0])).toBeGreaterThan(world.aspect);
        });
        expect(new Set(sweeps.map((s) => Math.sign(startOf(s)[1] - world.heart.y))).size).toBe(2);
        world.dispose();
    });

    it('does not turn the canvas under reduced motion, but still draws the chain', () => {
        const { world, camera } = makeWorld('Low');
        world.setReducedMotion(true);
        world.onCombo(6);
        run(world, camera, 2);
        expect(world.twistAngle).toBe(0);
        expect(tagged(world, 'spiral').length).toBeGreaterThan(0);
        const still = camera.position.clone();
        run(world, camera, 2);
        expect(camera.position.distanceTo(still)).toBeLessThan(1e-9);
        world.dispose();
    });

    it('gives a T-spin a turn of its own', () => {
        const { world, camera } = makeWorld('Low');
        world.onClear({ rows: [19, 18], lines: 2, tspin: true });
        expect(tagged(world, 'spiral').length).toBeGreaterThanOrEqual(2);
        run(world, camera, 1.5);
        expect(world.twistAngle).toBeGreaterThan(0.2);
        expect(world.twistAngle).toBeLessThan(0.6);
        world.dispose();
    });

    it('paints a new period over the old one at each level', () => {
        const { world, camera } = makeWorld('Low');
        expect(world.getState().period).toBe(IMPASTO_PERIODS[0].name);
        const before = world.painter.log.length;
        world.levelUp(2);
        expect(world.getState().period).toBe(IMPASTO_PERIODS[1].name);
        const over = tagged(world, 'level');
        expect(over.length).toBeGreaterThan(30);
        expect(world.painter.log.length).toBe(before + over.length);
        expect(over.every((s) => s.t0 > world.time)).toBe(true);
        run(world, camera, 0.2);
        world.levelUp(2);
        expect(tagged(world, 'level')).toHaveLength(over.length); // the same level again: nothing new
        world.levelUp(IMPASTO_PERIODS.length + 1);
        expect(world.getState().period).toBe(IMPASTO_PERIODS[0].name); // the periods come round
        // Silently (a capture resting on a level): the picture as if it had always been so.
        const rest = makeWorld('Low').world;
        rest.levelUp(3, { silent: true });
        rest.update({ time: rest.time, delta: 0 });
        expect(tagged(rest, 'level')).toHaveLength(0);
        expect(tagged(rest, 'under').every((s) => s.done)).toBe(true);
        expect(rest.getState().period).toBe(IMPASTO_PERIODS[2].name);
        world.dispose();
        rest.dispose();
    });

    it('keeps the painting when a game ends and scrapes it down when the next one starts', () => {
        const { world, camera } = makeWorld('Low');
        world.freshCanvas();
        expect(tagged(world, 'scrape')).toHaveLength(0); // nothing played: nothing to scrape
        world.onLock({ rows: [12], u: 0.3, color: '#b30000' });
        world.onCombo(4);
        run(world, camera, 1);
        const log = world.painter.log.length;
        world.resetSession();
        expect(world.combo).toBe(0);
        expect(world.twistAngle).toBe(0);
        expect(world.painter.log.length).toBeGreaterThanOrEqual(log); // (the bake joins the log)
        expect(tagged(world, 'lock')).toHaveLength(1);
        world.counts.quads = 3;
        world.freshCanvas();
        expect(world.counts.quads).toBe(0); // the new game's first gold ring is the innermost again
        expect(tagged(world, 'scrape').length).toBeGreaterThan(20);
        const fresh = tagged(world, 'under');
        expect(fresh.length).toBeGreaterThan(150);
        expect(fresh.every((s) => s.t0 >= world.time)).toBe(true);
        expect(world.counts.locks).toBe(0);
        world.dispose();
    });

    it('opens a new game in the first period, and hands its painting to another world whole', () => {
        const { world, camera } = makeWorld('Low');
        world.onLock({ rows: [12], u: 0.3, color: '#b30000' });
        world.levelUp(3);
        world.onCombo(3);
        run(world, camera, 1);
        world.onCombo(0);
        expect(world.twistAngle).toBeGreaterThan(0.1);
        expect(world.getState().period).toBe(IMPASTO_PERIODS[2].name);
        const painting = world.exportPainting();
        expect(painting.log).toHaveLength(world.painter.log.length);
        expect(painting.log).not.toBe(world.painter.log);

        const next = makeWorld('Medium', { time: 0 });
        expect(next.world.importPainting(null)).toBe(false);
        expect(next.world.importPainting(painting)).toBe(true);
        expect(next.world.time).toBe(world.time);
        // The turn the canvas was holding is still on it.
        expect(next.world.twistAngle).toBeCloseTo(world.twistAngle, 9);
        expect(next.world.twistReach).toBe(world.twistReach);
        expect(next.world.getState()).toMatchObject({ level: 3, period: IMPASTO_PERIODS[2].name });
        expect(next.world.counts.locks).toBe(1);
        expect(next.world.needsPaint).toBe(true);
        expect(next.world.painter.cursor).toBe(0);
        next.world.update({ time: painting.time, delta: 0 }, next.camera);
        expect(tagged(next.world, 'lock').every((s) => s.done)).toBe(true);
        expect(tagged(next.world, 'under').length).toBe(tagged(world, 'under').length);

        // A log whose underpainting a long game has let go of is blocked in again under the rest.
        const trimmed = world.exportPainting();
        trimmed.log = trimmed.log.filter((s) => s.tag !== 'under');
        const third = makeWorld('Low', { time: 0 });
        expect(third.world.importPainting(trimmed)).toBe(true);
        expect(tagged(third.world, 'under').length).toBeGreaterThan(100);
        expect(tagged(third.world, 'lock')).toHaveLength(1);
        expect(third.world.painter.log.some((s) => s.bake)).toBe(true); // (the held turn, baked)
        third.world.dispose();

        // A new game: back to the first period, on a scraped canvas.
        next.world.freshCanvas();
        expect(next.world.getState()).toMatchObject({ level: 1, period: IMPASTO_PERIODS[0].name });
        expect(tagged(next.world, 'scrape').length).toBeGreaterThan(20);
        world.dispose();
        next.world.dispose();
    });

    it('aims at the fallback board until a live layout arrives, and follows the card after', () => {
        const { world } = makeWorld('Low', { live: false });
        expect(world.layoutLive).toBe(false);
        expect(world.card.x1 - world.card.x0).toBeGreaterThan(0.4);
        const layout = fallbackLayout(1600, 900);
        layout.cards[0] = {
            x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.9,
        };
        world.setLayout(layout, 1600 / 900);
        expect(world.layoutLive).toBe(true);
        expect(world.card.x0).toBeCloseTo((0.1 * 2 - 1) * (1600 / 900), 6);
        expect(world.card.y1).toBeCloseTo(1 - 0.2 * 2, 6);
        expect(world.heart.x).toBeLessThan(0);
        expect(world.field.whorls[0].x).toBeCloseTo(world.heart.x, 6);
        world.dispose();
    });

    it('lays a meditation click where it was made', () => {
        const { world } = makeWorld('Low', { live: false });
        world.onLock({ screen: { x: 0.25, y: 0.25 }, color: '#fff8dc' });
        const [s] = tagged(world, 'lock');
        expect(startOf(s)[0]).toBeCloseTo((0.25 * 2 - 1) * world.aspect, 6);
        expect(startOf(s)[1]).toBeCloseTo(0.5, 6);
        world.dispose();
    });
});

describe('chromatic impasto world: light and state', () => {
    it('keeps the lamp low and to the upper left, and lifts it with the chain', () => {
        const { world, camera } = makeWorld('Low');
        const dir = world.u.lightDir.value;
        expect(dir.length()).toBeCloseTo(1, 6);
        expect(dir.x).toBeLessThan(0);
        expect(dir.y).toBeGreaterThan(0);
        expect(Math.asin(dir.z)).toBeGreaterThan(LAMP.elevation - 0.12);
        expect(Math.asin(dir.z)).toBeLessThan(LAMP.elevation + 0.12);
        const rest = world.u.keyColor.value.clone();
        world.onCombo(8);
        run(world, camera, 3);
        expect(world.u.keyColor.value.x).toBeGreaterThan(rest.x);
        expect(world.u.wetLift.value).toBeGreaterThan(0.2);
        expect(world.getPostState().exposure).toBeLessThan(1);
        world.dispose();
    });

    it('reports what it holds, and reuses its sheen slots', () => {
        const { world } = makeWorld('Low');
        for (let i = 0; i < SHEEN_SLOTS + 2; i++) world.onClear({ rows: [19], lines: 1 });
        expect(world.u.sheenSlots.filter((v) => v.z > 0)).toHaveLength(SHEEN_SLOTS);
        const state = world.getState();
        expect(state.quality).toBe('Low');
        expect(state.counts.clears).toBe(SHEEN_SLOTS + 2);
        expect(state.log).toBe(world.painter.log.length);
        expect(state.canvas).toEqual([world.canvas.width, world.canvas.height]);
        expect(state.card.x0).toBeLessThan(state.card.x1);
        world.dispose();
        expect(() => world.update({ time: 99, delta: 0.1 })).not.toThrow();
        expect(() => world.onLock({ rows: [3], u: 0.5 })).not.toThrow();
    });
});
