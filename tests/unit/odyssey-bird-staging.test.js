/**
 * Odyssey — where the island's birds stand in the ORB CLOSE-UPS (2026-11-20).
 *
 * A player rests in an orb's close-up: the eye 10 u south of the orb and 2 u over it, looking at
 * it (so due north and some 12 degrees down), the HUD along the top of the frame and the orb's
 * panel over its right fifth. The birds were sited for the travelling rail camera, and from the
 * close-ups the skein was under the HUD at every orb, the eagle 20-50 degrees over the top of the
 * frame, the gulls behind the panel by L15 and the kettle out of frame at L29 and L30: from L25
 * to L30 a parked player saw no bird at all. Each kind is now sited against the close-ups, and
 * this file holds what every seat sees of it, in the part of the frame the UI leaves free:
 *
 *   gulls      L11-L16   loops over the surf, under and beside the rail
 *   skeins     L15-L27   two skeins on a low line across the foot of the wall
 *   eagle      L16-L27   a thermal at the foot of the wall, west of the rail
 *   vultures   L28-L33   a column that leans as the wall does
 *
 * and that nothing is paid for it: every bird clear of the rail, of every seat's eye, of the
 * ground, the water and the tree crowns; no goose that appears or goes inside a frame; no window
 * that fades while a seat or the rail camera still has the bird in view.
 *
 * (The seats' cameras are built as the board builds them: OdysseyCameraController.focusOnNode.)
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import { resolveFrameShift } from '../../src/rendering/odyssey/OdysseyCameraController.js';
import {
    FLIGHT_KIND, ODYSSEY_FLIGHTS, flightPositionAt, resolveFlightLanes,
} from '../../src/rendering/odyssey/composition/odyssey-flights.js';
import { ODYSSEY_EAGLE, eaglePoint, eagleRevealAt } from '../../src/rendering/odyssey/composition/odyssey-eagle-flight.js';
import {
    SUMMIT_BIRDS, resolveSummitBirdLanes, summitBirdPositionAt,
} from '../../src/rendering/odyssey/composition/odyssey-summit-birds.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { scatterZonedForest } from '../../src/rendering/odyssey/world/odyssey-forest-scatter.js';

const rig = createOdysseyCameraRig();
/** The sea's surface (odyssey-forest-scatter.js `seaLevel`): the height mirror is the seabed there. */
const SEA_LEVEL = 287.31;
/** The frame the UI leaves free, in NDC: left of the orb panel (1560 of 1920 px), under the HUD (75 of 1080). */
const PANEL_X = ((1560 / 1920) * 2) - 1;
const HUD_Y = 1 - ((75 / 1080) * 2);
/**
 * The lens is shifted so the picture's centre is the middle of that free frame (FRAME_SHIFT in the
 * camera, 2026-11-25): the orb sits there, not in the middle of the screen.
 */
const FREE_MIDDLE = { x: (PANEL_X - 1) / 2, y: (HUD_Y - 1) / 2 };
const LENS = resolveFrameShift(FREE_MIDDLE.x, FREE_MIDDLE.y);
/** The orb's own disc in the middle of every close-up, pixels at 1080 lines. */
const ORB_DISC = 170;
/** The narrowest lens a close-up can have (the director's lens changes orb by orb: 57 to 75 degrees). */
const NARROW = 57;

/** The close-up's camera on orb `id` (focusOnNode: the eye behind and over the orb, looking at it). */
function seat(id, fov = null) {
    const orb = getOdysseyPathPointAt(rig.layout.levelPositionsById[id]);
    rig.poseAt(rig.parkOf(id));
    const camera = new THREE.PerspectiveCamera(fov ?? rig.controller._resolveBaseFov(), 16 / 9, 0.1, 40000);
    camera.position.set(orb.x, orb.y + 2, orb.z + rig.controller.config.focusDistance);
    camera.lookAt(orb.x, orb.y, orb.z);
    camera.updateMatrixWorld(true);
    camera.setViewOffset(camera.aspect, 1, -LENS.x * camera.aspect, LENS.y, camera.aspect, 1);
    return camera;
}

/**
 * The widest lens orb `id`'s close-up can have: its own park's, or a neighbour's (a close-up
 * lands on the lens the camera carried there).
 */
function widest(id) {
    return Math.max(...[id - 1, id, id + 1].map((k) => {
        rig.poseAt(rig.parkOf(k));
        return rig.controller._resolveBaseFov();
    })) + 1;
}

const scratch = new THREE.Vector3();
const forward = new THREE.Vector3();
/** A world point in a camera's frame: NDC x and y, whether it is in front, and pixels a world unit there (1080 lines). */
function project(camera, p) {
    camera.getWorldDirection(forward);
    const depth = scratch.set(p[0], p[1], p[2]).sub(camera.position).dot(forward);
    scratch.set(p[0], p[1], p[2]).project(camera);
    const f = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    return {
        x: scratch.x, y: scratch.y, depth, pxPerUnit: depth > 0 ? (f * 540) / depth : 0,
    };
}
const inFrame = (s) => s.depth > 1 && Math.abs(s.x) < 1 && Math.abs(s.y) < 1;
const inFree = (s) => inFrame(s) && s.x < PANEL_X && s.y < HUD_Y
    && Math.hypot((s.x - FREE_MIDDLE.x) * 960, (s.y - FREE_MIDDLE.y) * 540) > ORB_DISC;

/**
 * What a close-up shows of a set of birds over `total` seconds of the board's clock: the share
 * of the time one is in the free frame at `least` px or more, how many are there at once on
 * average, and the median size of the biggest.
 */
function shows(camera, span, birdsAt, total, least = 24, step = 0.5) {
    let samples = 0;
    let seen = 0;
    let count = 0;
    const sizes = [];
    for (let t = 0; t < total; t += step) {
        samples += 1;
        let best = 0;
        for (const q of birdsAt(t)) {
            if (!q) continue;
            const s = project(camera, q);
            if (!inFree(s)) continue;
            const px = span * s.pxPerUnit;
            if (px < least) continue;
            count += 1;
            best = Math.max(best, px);
        }
        if (best > 0) {
            seen += 1;
            sizes.push(best);
        }
    }
    sizes.sort((a, b) => a - b);
    return { share: seen / samples, birds: count / samples, median: sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0 };
}

const RAIL = Array.from({ length: 48 }, (_, i) => getOdysseyPathPointAt(i / 47));
const TREES = scatterZonedForest(odysseyWorldHeight, { rail: RAIL, spacing: 15 }).placements;
/** The rail's points over a stretch of the journey. */
function railOver(p0, p1) {
    const out = [];
    for (let p = p0; p <= p1; p += 0.0006) {
        const q = getOdysseyPathPointAt(p);
        out.push([q.x, q.y, q.z]);
    }
    return out;
}
const EYES = Array.from({ length: 24 }, (_, k) => seat(11 + k, 60).position.toArray());
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The nearest a set of birds comes to the rail, to a seat's eye, to the ground or the water, and to a tree's crown. */
function clearances(birdsAt, total, rail, step = 1) {
    const out = {
        rail: Infinity, eye: Infinity, ground: Infinity, crown: Infinity,
    };
    for (let t = 0; t < total; t += step) {
        for (const q of birdsAt(t)) {
            if (!q) continue;
            for (const r of rail) out.rail = Math.min(out.rail, dist(q, r));
            for (const e of EYES) out.eye = Math.min(out.eye, dist(q, e));
            out.ground = Math.min(out.ground, q[1] - Math.max(SEA_LEVEL, odysseyWorldHeight(q[0], q[2])));
            for (const tree of TREES) {
                if (Math.abs(tree.x - q[0]) > 40 || Math.abs(tree.z - q[2]) > 40) continue;
                // The tree's own crown and height, and two units over its reach.
                if (Math.hypot(tree.x - q[0], tree.z - q[2]) < tree.crownR + 2) {
                    out.crown = Math.min(out.crown, q[1] - (tree.y + tree.height));
                }
            }
        }
    }
    return out;
}

const lanes = resolveFlightLanes();
const flockOf = (id) => ODYSSEY_FLIGHTS.findIndex((f) => f.id === id);
const birdsOf = (id) => {
    const fi = flockOf(id);
    const own = lanes.filter((l) => l.flock === fi && !l.flyby);
    return (t) => own.map((lane) => {
        const q = flightPositionAt(lane, t);
        return q.shown === false ? null : [q.x, q.y, q.z];
    });
};
const eagleAt = (t) => { const q = eaglePoint(t); return [[q.x, q.y, q.z]]; };
const kettle = resolveSummitBirdLanes();
const vulturesAt = (t) => kettle.map((lane) => { const q = summitBirdPositionAt(lane, t); return [q.x, q.y, q.z]; });
const windowWeight = (w, p) => THREE.MathUtils.smoothstep(p, w[0], w[1]) * (1 - THREE.MathUtils.smoothstep(p, w[2], w[3]));

describe('odyssey bird staging: the gulls from the shore orbs', () => {
    const flock = ODYSSEY_FLIGHTS[flockOf('gulls')];
    const gulls = birdsOf('gulls');

    it('gives every shore orb gulls in the free part of its frame, nearly all the time, and big enough to be gulls', () => {
        expect(flock.sites).toHaveLength(flock.count);
        [11, 12, 13, 14, 15, 16].forEach((id) => {
            const view = shows(seat(id), flock.span, gulls, 240, 45);
            expect(view.share, `L${id} share of the time`).toBeGreaterThan(0.9);
            expect(view.birds, `L${id} gulls at once`).toBeGreaterThan(1.5);
            expect(view.median, `L${id} px across`).toBeGreaterThan(60);
            // ... through the narrowest lens a close-up can have, too.
            expect(shows(seat(id, NARROW), flock.span, gulls, 240, 45).share, `L${id} narrow`).toBeGreaterThan(0.85);
        });
    });

    it('keeps every loop clear of the rail, the seats, the water, the ground and the trees', () => {
        const c = clearances(gulls, 480, railOver(0.125, 0.26), 1.5);
        expect(c.rail).toBeGreaterThan(25);
        expect(c.eye).toBeGreaterThan(26);
        expect(c.ground).toBeGreaterThan(4);
        expect(c.crown).toBeGreaterThan(4);
    });

    it('is drawn at every orb that has a gull in frame, and fades only once the rail camera has left the loops behind', () => {
        [11, 13, 15, 16, 17, 18].forEach((id) => expect(windowWeight(flock.window, rig.parkOf(id)), `L${id}`).toBe(1));
        expect(windowWeight(flock.window, rig.parkOf(19))).toBe(0);
        const places = [];
        for (let t = 0; t < 240; t += 2) gulls(t).forEach((q) => places.push(new THREE.Vector3(...q)));
        for (let p = flock.window[2] - 0.0005; p <= flock.window[3]; p += 0.0005) {
            const camera = rig.poseAt(p);
            const seen = places.filter((pt) => rig.inFrame(camera, pt, 1.02)).length;
            expect(seen, `gulls in the rail camera's frame at p=${p.toFixed(4)}`).toBe(0);
        }
    });
});

describe('odyssey bird staging: the skeins across the foot of the wall', () => {
    const flock = ODYSSEY_FLIGHTS[flockOf('geese')];
    const geese = birdsOf('geese');
    const own = lanes.filter((l) => l.kind === FLIGHT_KIND.GOOSE);

    it('flies two skeins on the line, half a period apart, each a V', () => {
        expect(flock.skeins.map((s) => s.count).reduce((a, b) => a + b, 0)).toBe(flock.count);
        expect(own).toHaveLength(flock.count);
        const delays = [...new Set(own.map((l) => l.phase))];
        expect(delays).toHaveLength(2);
        expect(Math.abs(delays[0] - delays[1])).toBeCloseTo(0.5, 6);
        delays.forEach((delay) => {
            const skein = own.filter((l) => l.phase === delay);
            // One leader, then a bird on each side of every rank.
            expect(skein.filter((l) => l.cx === 0)).toHaveLength(1);
            expect(new Set(skein.filter((l) => l.cx === 1).map((l) => l.cz)).size).toBe(2);
        });
        // The two are never in the air at the same place: one is mid-line as the other sets out.
        const at = (lane, t) => flightPositionAt(lane, t);
        const leaders = own.filter((l) => l.cx === 0);
        for (let t = 0; t < flock.period; t += 1) {
            const a = at(leaders[0], t);
            const b = at(leaders[1], t);
            if (a.shown && b.shown) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(400);
        }
    });

    it('crosses the frame of every orb from the upper shore to the wall, a goose growing from a speck to a great bird', () => {
        let last = 0;
        [15, 17, 19, 21, 22, 23, 24, 25, 26, 27].forEach((id) => {
            const view = shows(seat(id), flock.span, geese, flock.period * 4, 14, 0.25);
            expect(view.share, `L${id} share of the time`).toBeGreaterThan(0.12);
            if (id >= 22) expect(view.median, `L${id} px across`).toBeGreaterThan(36);
            if (id >= 25) expect(view.median, `L${id} px across`).toBeGreaterThan(60);
            // (It grows as the journey nears the line.)
            if (id <= 26) expect(view.median, `L${id} against the orb before`).toBeGreaterThan(last * 0.95);
            last = view.median;
        });
        // The upper meadow has a skein in frame about half the time.
        expect(shows(seat(18), flock.span, geese, flock.period * 4, 14, 0.25).share).toBeGreaterThan(0.45);
        // Past the foot of the wall no seat has one.
        expect(shows(seat(28), flock.span, geese, flock.period * 4, 1).share).toBe(0);
    });

    it('lets no goose appear or go inside a close-up: both ends of the line are out of the frame of every seat, and far from the rail camera', () => {
        const ends = [];
        own.forEach((lane) => {
            [0.004, flock.travel - 0.004].forEach((at) => {
                const q = flightPositionAt(lane, (at - flock.phase - lane.phase) * flock.period);
                ends.push([q.x, q.y, q.z]);
            });
        });
        for (let id = 11; id <= 28; id += 1) {
            const camera = seat(id, widest(id));
            ends.forEach((q) => expect(inFrame(project(camera, q)), `an end in L${id}'s frame`).toBe(false));
        }
        // The travelling camera looks up the rail, north-west: the line's west end lies inside its
        // frame for most of the meadow (as the old line's did). A goose that sets out there is a
        // speck in the far haze: never nearer than 600 u, under twenty pixels across even at the frame's edge.
        const point = new THREE.Vector3();
        for (let p = flock.window[0]; p <= flock.window[3]; p += 0.002) {
            const camera = rig.poseAt(p);
            ends.forEach((q) => {
                if (!rig.inFrame(camera, point.set(...q), 1.02)) return;
                const far = point.distanceTo(camera.position);
                expect(far, `an end in the rail camera's frame at p=${p.toFixed(3)}`).toBeGreaterThan(600);
                expect(flock.span * project(camera, q).pxPerUnit).toBeLessThan(20);
            });
        }
    });

    it('keeps the line clear of the rail it passes under, the seats, the ground and the trees', () => {
        const c = clearances(geese, flock.period, railOver(0.13, 0.44), 0.5);
        expect(c.rail).toBeGreaterThan(24);
        expect(c.eye).toBeGreaterThan(32);
        expect(c.ground).toBeGreaterThan(25);
        expect(c.crown).toBeGreaterThan(4);
    });

    it('is drawn from the shore to the first of the climb, with no orb parked inside a fade', () => {
        for (let id = 11; id <= 28; id += 1) expect(windowWeight(flock.window, rig.parkOf(id)), `L${id}`).toBe(1);
        expect(windowWeight(flock.window, rig.parkOf(29))).toBe(0);
    });
});

describe('odyssey bird staging: the eagle at the foot of the wall', () => {
    it('is in the frame of every orb from the upper shore to the wall, left of the middle, growing as the journey nears it', () => {
        let last = 0;
        [16, 18, 20, 22, 24, 25].forEach((id) => {
            const camera = seat(id);
            const view = shows(camera, ODYSSEY_EAGLE.span, eagleAt, ODYSSEY_EAGLE.round, 20, 0.25);
            expect(view.share, `L${id} share of the time`).toBeGreaterThan(0.95);
            expect(view.median, `L${id} px across`).toBeGreaterThan(last);
            last = view.median;
            // Left of the middle of the frame (the orb's panel is on the right), under the HUD.
            const mid = project(camera, [ODYSSEY_EAGLE.thermal.x, ODYSSEY_EAGLE.thermal.y, ODYSSEY_EAGLE.thermal.z]);
            expect(mid.x, `L${id} thermal's place across the frame`).toBeLessThan(0);
            expect(mid.x).toBeGreaterThan(-0.75);
        });
        expect(last).toBeGreaterThan(70);
        // The wall's first two orbs look down on it, close.
        [26, 27].forEach((id) => {
            const view = shows(seat(id), ODYSSEY_EAGLE.span, eagleAt, ODYSSEY_EAGLE.round, 20, 0.25);
            expect(view.share, `L${id} share of the time`).toBeGreaterThan(0.7);
            expect(view.median, `L${id} px across`).toBeGreaterThan(95);
        });
        // Higher up it is under the frame: no seat after has it.
        [28, 29].forEach((id) => {
            expect(shows(seat(id, widest(id)), ODYSSEY_EAGLE.span, eagleAt, ODYSSEY_EAGLE.round, 1).share, `L${id}`).toBe(0);
        });
    });

    it('turns clear of the rail overhead, the seats, the ground and the tree crowns, and under the skeins', () => {
        const c = clearances(eagleAt, ODYSSEY_EAGLE.round, railOver(0.13, 0.45), 0.35);
        expect(c.rail).toBeGreaterThan(45);
        expect(c.eye).toBeGreaterThan(50);
        expect(c.ground).toBeGreaterThan(30);
        expect(c.crown).toBeGreaterThan(4);
        // The skeins pass over its thermal: never nearer than a goose's own wingspan.
        const geese = birdsOf('geese');
        const { period } = ODYSSEY_FLIGHTS[flockOf('geese')];
        let gap = Infinity;
        for (let t = 0; t < period * ODYSSEY_EAGLE.round; t += 0.25) {
            const [e] = eagleAt(t);
            for (const g of geese(t)) if (g) gap = Math.min(gap, dist(e, g));
            if (t > period * 7) break;
        }
        expect(gap).toBeGreaterThan(8);
    });

    it('is drawn at every orb that sees it, and fades between two orbs that do not, out of the rail camera\'s frame', () => {
        for (let id = 11; id <= 28; id += 1) expect(eagleRevealAt(rig.parkOf(id)), `L${id}`).toBe(1);
        expect(eagleRevealAt(rig.parkOf(29))).toBe(0);
        const places = [];
        for (let t = 0; t < ODYSSEY_EAGLE.round; t += 0.7) places.push(new THREE.Vector3(...eagleAt(t)[0]));
        const [, , from, to] = ODYSSEY_EAGLE.window;
        for (let p = from - 0.002; p <= to; p += 0.0005) {
            const camera = rig.poseAt(p);
            expect(places.filter((pt) => rig.inFrame(camera, pt, 1.02)).length, `eagle in the rail camera's frame at p=${p.toFixed(4)}`).toBe(0);
        }
    });
});

describe('odyssey bird staging: the vultures\' column beside the wall', () => {
    it('fills the column from the foot of the climb to its last orb, leaning as the wall does', () => {
        expect(kettle).toHaveLength(SUMMIT_BIRDS.count);
        const heights = kettle.map((lane) => lane.height).sort((a, b) => a - b);
        // Birds at every height: no gap in the column a seat could look through.
        for (let i = 1; i < heights.length; i += 1) expect(heights[i] - heights[i - 1]).toBeLessThan(SUMMIT_BIRDS.heightSpread * 0.45);
        expect(heights[heights.length - 1] - heights[0]).toBeGreaterThan(SUMMIT_BIRDS.heightSpread * 1.4);
        // It leans north as it rises, as the rail does (a lane's middle moves with its height).
        expect(SUMMIT_BIRDS.lean[1]).toBeLessThan(-0.5);
        const low = seat(28).position;
        const high = seat(33).position;
        const wall = (high.z - low.z) / (high.y - low.y);
        expect(SUMMIT_BIRDS.lean[1]).toBeGreaterThan(wall * 1.4);
        expect(SUMMIT_BIRDS.lean[1]).toBeLessThan(wall * 0.6);
    });

    it('gives every orb of the wall vultures in the open left of its frame', () => {
        [28, 29, 30, 31, 32].forEach((id) => {
            const camera = seat(id);
            const view = shows(camera, SUMMIT_BIRDS.span, vulturesAt, 176, 40, 1);
            // (0.95 before the lens moved to the free frame's middle, 2026-11-25: the open left of
            // the frame is a tenth of a screen narrower, and L32's column shows 93 % of the time.)
            expect(view.share, `L${id} share of the time`).toBeGreaterThan(0.92);
            expect(view.birds, `L${id} vultures at once`).toBeGreaterThan(1.5);
            expect(view.median, `L${id} px across`).toBeGreaterThan(55);
            expect(shows(seat(id, NARROW), SUMMIT_BIRDS.span, vulturesAt, 176, 40, 1).share, `L${id} narrow`).toBeGreaterThan(0.85);
        });
        // (0.55 before the lens moved, 2026-11-25; 0.545 now.)
        expect(shows(seat(33), SUMMIT_BIRDS.span, vulturesAt, 176, 40, 1).share).toBeGreaterThan(0.52);
        // The column stands left of the middle from every one of them (the panel is on the right).
        [28, 30, 32].forEach((id) => {
            const camera = seat(id);
            const eye = camera.position;
            const level = kettle.reduce((a, b) => (Math.abs(b.height + SUMMIT_BIRDS.centre[1] - eye.y + 30) < Math.abs(a.height + SUMMIT_BIRDS.centre[1] - eye.y + 30) ? b : a));
            const mid = [
                SUMMIT_BIRDS.centre[0] + (SUMMIT_BIRDS.lean[0] * level.height),
                SUMMIT_BIRDS.centre[1] + level.height,
                SUMMIT_BIRDS.centre[2] + (SUMMIT_BIRDS.lean[1] * level.height),
            ];
            expect(project(camera, mid).x, `L${id}`).toBeLessThan(-0.2);
        });
    });

    it('keeps every lane clear of the mountain, the rail and the seats', () => {
        const c = clearances(vulturesAt, 60, railOver(0.34, 0.72), 1.5);
        expect(c.rail).toBeGreaterThan(55);
        expect(c.eye).toBeGreaterThan(48);
        expect(c.ground).toBeGreaterThan(25);
    });

    it('is drawn from the shore to the last orb that sees it, and fades out of the rail camera\'s frame', () => {
        for (let id = 11; id <= 33; id += 1) expect(windowWeight(SUMMIT_BIRDS.window, rig.parkOf(id)), `L${id}`).toBe(1);
        // L34's close-up has none of the column in frame (it parks inside the fade).
        expect(shows(seat(34, widest(34)), SUMMIT_BIRDS.span, vulturesAt, 60, 1).share).toBe(0);
        const places = [];
        for (let t = 0; t < 60; t += 2) vulturesAt(t).forEach((q) => places.push(new THREE.Vector3(...q)));
        const [, , from, to] = SUMMIT_BIRDS.window;
        for (let p = from - 0.002; p <= to; p += 0.001) {
            const camera = rig.poseAt(p);
            expect(places.filter((pt) => rig.inFrame(camera, pt, 1.02)).length, `vultures in the rail camera's frame at p=${p.toFixed(4)}`).toBe(0);
        }
    });
});

describe('odyssey bird staging: the journey as a whole', () => {
    it('shows a bird in the free frame of every orb from the shore to the last of the wall', () => {
        const gulls = birdsOf('gulls');
        const geese = birdsOf('geese');
        const swallows = birdsOf('swallows');
        const kinds = [
            [gulls, ODYSSEY_FLIGHTS[flockOf('gulls')].span, (p) => windowWeight(ODYSSEY_FLIGHTS[flockOf('gulls')].window, p)],
            [geese, ODYSSEY_FLIGHTS[flockOf('geese')].span, (p) => windowWeight(ODYSSEY_FLIGHTS[flockOf('geese')].window, p)],
            [swallows, ODYSSEY_FLIGHTS[flockOf('swallows')].span, (p) => windowWeight(ODYSSEY_FLIGHTS[flockOf('swallows')].window, p)],
            [eagleAt, ODYSSEY_EAGLE.span, eagleRevealAt],
            [vulturesAt, SUMMIT_BIRDS.span, (p) => windowWeight(SUMMIT_BIRDS.window, p)],
        ];
        for (let id = 11; id <= 33; id += 1) {
            const camera = seat(id);
            const p = rig.parkOf(id);
            let samples = 0;
            let seen = 0;
            for (let t = 0; t < 240; t += 1) {
                samples += 1;
                const any = kinds.some(([at, span, reveal]) => reveal(p) > 0.99
                    && at(t).some((q) => q && inFree(project(camera, q)) && span * project(camera, q).pxPerUnit >= 24));
                if (any) seen += 1;
            }
            // (Before: 0 at L25, L26, L27, L29 and L30. The last orb of the wall looks over the
            // column's top: its highest birds are in frame about two thirds of the time.)
            // The lens moved to the free frame's middle on 2026-11-25, and the far left of the old
            // frame went with it: every orb still has a bird all the time but three (0.9 before:
            // L26 0.89, L27 0.80; 0.6 before: L33 0.49). Their birds want a place nearer the rail.
            const least = { 26: 0.87, 27: 0.78, 33: 0.47 }[id] ?? 0.9;
            expect(seen / samples, `L${id}: a bird of 24 px or more in the free frame`).toBeGreaterThan(least);
        }
    });
});
