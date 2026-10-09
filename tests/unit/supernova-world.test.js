import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    LOOP_BEAT, REST_RIG, SUPERNOVA_PARTS, SURGE_COOL, SupernovaWorld, fovForAspect,
} from '../../src/themes/supernova/supernova-world.js';
import {
    BLAST_SHELLS, COLLAPSE_HOLD, CRITICAL_COMBO, DEG, FRONT_GAP, IMPACT_SLOTS, LOOP_SLOTS, NOVA_REARM, PALETTE_DRIFT,
    PALETTE_HOLD, REKINDLE, RING, ROW_FLIGHT, SHELL_ROWS, SHELL_STRIDE, STAR, STREAM_SLOTS, SUPERNOVA_PALETTES,
    heatForCombo, paletteDrift, pieceColor, starAnchors,
} from '../../src/themes/supernova/supernova-core.js';
import { QUALITY, QUALITY_NAMES } from '../../src/themes/supernova/supernova-quality.js';
import { NOISE3_SIZE } from '../../src/themes/supernova/supernova-tsl.js';
import { boardPoint, cardUnion, fallbackLayout } from '../../src/themes/supernova/supernova-composition.js';
import { STREAM_TAIL, streamPoint } from '../../src/themes/supernova/supernova-fx.js';
import { loopPoint } from '../../src/themes/supernova/supernova-loops.js';

// Every world bakes the same noise volume from the same seed (a third of a second each): the
// file bakes each one once. The bytes are what the real function returns.
vi.mock('../../src/themes/supernova/supernova-tsl.js', async (importOriginal) => {
    const actual = await importOriginal();
    const baked = new Map();
    return {
        ...actual,
        bakeNoise3D: (seed = 1987, size = actual.NOISE3_SIZE) => {
            const key = `${seed}/${size}`;
            if (!baked.has(key)) baked.set(key, actual.bakeNoise3D(seed, size));
            return baked.get(key);
        },
    };
});
// A busy machine needs more than the default for the longer runs.
vi.setConfig({ testTimeout: 30000 });

function makeWorld(quality = 'Minimal', {
    width = 1600, height = 900, live = true, capture = true, time = 10,
} = {}) {
    const scene = new THREE.Scene();
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, REST_RIG.near, REST_RIG.far);
    const world = new SupernovaWorld({ scene, quality, capture }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, aspect);
    // As the theme does on its first frame: the live rects, or null when no board is on screen.
    world.setLayout(live ? fallbackLayout(width, height) : null, aspect);
    settle(world, camera, time);
    return { scene, camera, world };
}

/** The capture's recipe: jump the clock, then draw that moment with the simulation frozen. */
function settle(world, camera, time) {
    world.seek(time);
    world.updateCamera(camera, { time, delta: 0 });
    world.update({ time, delta: 0 }, camera);
}

/** Advance the world from its current time by `seconds` in `steps` equal frames. */
function run(world, camera, seconds, steps = Math.max(1, Math.round(seconds * 60)), each = null) {
    const t0 = world.time;
    for (let i = 1; i <= steps; i++) {
        const sim = { time: t0 + (seconds * i) / steps, delta: seconds / steps };
        world.updateCamera(camera, sim);
        world.update(sim, camera);
        if (each) each(world);
    }
}

/** Run to an absolute moment of the world clock. */
function runTo(world, camera, time, each = null) {
    const seconds = time - world.time;
    if (seconds > 1e-9) run(world, camera, seconds, Math.max(1, Math.round(seconds * 60)), each);
}

/** A pool's per-instance array. */
function instanced(part, name) {
    const attribute = part.geometry.getAttribute(name);
    return { array: attribute.array, count: attribute.count, attribute };
}

/** Slots of a pool whose timestamp (component 3 of `name`) says they have been used. */
function used(part, name) {
    const { array, count } = instanced(part, name);
    const out = [];
    for (let i = 0; i < count; i++) if (array[i * 4 + 3] > -50) out.push(i);
    return out;
}

const four = (array, slot) => Array.from(array.subarray(slot * 4, slot * 4 + 4));

/** Every stream sent and not yet overwritten, as the shader reads it. */
function streamsOf(world) {
    const from = instanced(world.streams, 'aFrom').array;
    const ctrl = instanced(world.streams, 'aCtrl').array;
    const to = instanced(world.streams, 'aTo').array;
    const tint = instanced(world.streams, 'aTint').array;
    return used(world.streams, 'aFrom').map((slot) => {
        const [fx, fy, fz, time] = four(from, slot);
        const [bx, by, bz, flight] = four(ctrl, slot);
        const [dx, dy, dz, kind] = four(to, slot);
        const [r, g, b, size] = four(tint, slot);
        return {
            from: [fx, fy, fz], time, bow: [bx, by, bz], flight, dir: [dx, dy, dz], kind, rgb: [r, g, b], size,
        };
    });
}

/**
 * Every prominence raised and not yet overwritten: (mid of the arch, birth), oldest first. Which
 * slot an arch takes depends on what stood in the pool before, so they are never told by slot.
 */
function loopsOf(world) {
    const foot = instanced(world.loops, 'aFoot').array;
    return used(world.loops, 'aFoot').map((slot) => {
        const [x, y, z, time] = four(foot, slot);
        return { slot, mid: [x, y, z], time };
    }).sort((a, b) => a.time - b.time || a.slot - b.slot);
}

/** Births of every spark thrown and not yet overwritten. */
function sparkBirths(world) {
    const { array } = instanced(world.sparks, 'aBirth');
    return used(world.sparks, 'aBirth').map((slot) => array[slot * 4 + 3]);
}

/** A world point on screen (fractions, y down). */
function onScreen([x, y, z], camera) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return { x: p.x * 0.5 + 0.5, y: 0.5 - p.y * 0.5 };
}

/**
 * What the world lands, and when: every impact, shock and detonation as it is applied. The world
 * reuses the event it hands them, so each is copied.
 */
function watchLandings(world) {
    const log = [];
    for (const name of ['impact', 'shock', 'detonate']) {
        const apply = world[name].bind(world);
        world[name] = (event) => {
            log.push({
                name,
                time: event.time,
                amount: event.amount,
                lines: event.lines,
                rgb: [...event.rgb],
                dir: [...event.dir],
                frame: world.time,
            });
            return apply(event);
        };
    }
    return log;
}

/** What the world has promised for a later moment: every schedule() call, in order. */
function watchPromises(world) {
    const log = [];
    const schedule = world.schedule.bind(world);
    world.schedule = (kind, time, detail = {}) => {
        const kept = schedule(kind, time, detail);
        log.push({
            kind, time, kept, amount: detail.amount ?? 1, lines: detail.lines ?? 1,
        });
        return kept;
    };
    return log;
}

/** Row `r` of the shell table as the nebula's shader reads it. */
function shellRow(world, r) {
    const rows = world.u.shellRows;
    const o = r * SHELL_STRIDE;
    return {
        radius: rows[o].x, skin: rows[o].y, rgb: [rows[o + 1].x, rows[o + 1].y, rows[o + 1].z], gain: rows[o + 1].w,
    };
}

/** Every number in the live rows of the shell table. */
const shellTable = (world) => world.u.shellRows
    .slice(0, world.u.shellCount.value * SHELL_STRIDE)
    .flatMap((row) => row.toArray());

/** Fronts the world has sent that have left the star by now. */
const frontsOut = (world) => world.fronts.filter((front) => front.strength > 0 && front.birth <= world.time);

/** Names of every uniform, shell row and bead row holding a number that is not finite. */
function notFinite(world) {
    const bad = [];
    const check = (name, value) => {
        let list = null;
        if (typeof value === 'number') list = [value];
        else if (value && typeof value.toArray === 'function') list = value.toArray();
        if (list && list.some((v) => !Number.isFinite(v))) bad.push(name);
    };
    for (const [name, node] of Object.entries(world.u)) {
        if (Array.isArray(node)) node.forEach((entry, i) => check(`${name}[${i}]`, entry?.value ?? entry));
        else if (node && typeof node === 'object' && 'value' in node) check(name, node.value);
    }
    const post = world.getPostState();
    for (const [name, value] of Object.entries(post)) {
        if (typeof value === 'number') check(`post.${name}`, value);
        else Object.entries(value).forEach(([key, v]) => check(`post.${name}.${key}`, v));
    }
    return bad;
}

/** Names of every pool attribute holding a number that is not finite. */
function poolsNotFinite(world) {
    const bad = [];
    for (const name of ['streams', 'loops', 'sparks']) {
        for (const attribute of Object.keys(world[name].geometry.attributes)) {
            if (Array.from(world[name].geometry.getAttribute(attribute).array).some((v) => !Number.isFinite(v))) {
                bad.push(`${name}.${attribute}`);
            }
        }
    }
    return bad;
}

const bottom = (lines) => Array.from({ length: lines }, (_, i) => 19 - i);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('supernova world: build', () => {
    it('builds every tier from node materials only, with the whole picture and every event', () => {
        for (const quality of QUALITY_NAMES) {
            const { scene, world } = makeWorld(quality);
            const tier = QUALITY[quality];
            const materials = new Set();
            scene.traverse((object) => {
                if (object.material) materials.add(object.material);
            });
            expect(materials.size).toBe(SUPERNOVA_PARTS.length);
            for (const material of materials) {
                expect(material.isNodeMaterial, material.name).toBe(true);
                expect(material.isShaderMaterial, material.name).not.toBe(true);
                // Nothing writes depth: the sky is drawn first, the gas over it, every light on top.
                expect(material.depthWrite, material.name).toBe(false);
            }
            // The whole picture and every event, on every tier; every part answers to a name the
            // capture flag can address.
            expect(Object.keys(world.parts).sort()).toEqual([...SUPERNOVA_PARTS].sort());
            for (const name of SUPERNOVA_PARTS) {
                expect(world.parts[name].mesh.parent, name).toBe(world.root);
                expect(world.parts[name].mesh.material, name).toBe(world.parts[name].material);
            }
            // The pools are sized by the tier; what gameplay throws has the same room on every tier.
            expect(world.parts.embers.count).toBe(tier.embers);
            expect(world.parts.embers.geometry.instanceCount).toBe(tier.embers);
            expect(world.sparks.count).toBe(tier.sparks);
            expect(world.sparks.geometry.instanceCount).toBe(tier.sparks);
            expect(world.loops.count).toBe(Math.min(tier.loops, LOOP_SLOTS));
            expect(world.loops.geometry.instanceCount).toBe(world.loops.count);
            expect(world.streams.count).toBe(STREAM_SLOTS);
            expect(world.u.impactA).toHaveLength(IMPACT_SLOTS);
            expect(world.u.shellRows).toHaveLength(SHELL_ROWS * SHELL_STRIDE);
            expect(world.u.beadRows).toHaveLength(RING.beads);
            expect(world.getState()).toMatchObject({
                quality, embers: tier.embers, sparks: tier.sparks, shells: tier.shells, pending: 0, combo: 0,
            });
            expect(notFinite(world)).toEqual([]);
            world.dispose();
        }
    });

    it('lists its parts in the order they are drawn: the sky, the gas, the star, then what gameplay throws', () => {
        const { world } = makeWorld('Low');
        const orders = SUPERNOVA_PARTS.map((name) => world.parts[name].mesh.renderOrder);
        for (let i = 1; i < orders.length; i++) expect(orders[i], SUPERNOVA_PARTS[i]).toBeGreaterThan(orders[i - 1]);
        expect(SUPERNOVA_PARTS[0]).toBe('sky');
        expect(SUPERNOVA_PARTS.indexOf('nebula')).toBeLessThan(SUPERNOVA_PARTS.indexOf('star'));
        for (const name of ['streams', 'sparks']) {
            expect(SUPERNOVA_PARTS.indexOf(name), name).toBeGreaterThan(SUPERNOVA_PARTS.indexOf('loops'));
        }
        world.dispose();
    });

    it('never needs a frustum test or a matrix update for its parts', () => {
        const { world } = makeWorld('Low');
        for (const name of SUPERNOVA_PARTS) {
            expect(world.parts[name].mesh.frustumCulled, name).toBe(false);
            expect(world.parts[name].mesh.matrixAutoUpdate, name).toBe(false);
        }
        world.dispose();
    });

    it('starts with every gameplay pool dormant, and only the star\'s own prominences standing', () => {
        const { world } = makeWorld('High');
        expect(used(world.streams, 'aFrom')).toEqual([]);
        expect(used(world.sparks, 'aBirth')).toEqual([]);
        // The prominences that would be standing at this moment, each born on the star's own beat.
        const loops = loopsOf(world);
        expect(loops.length).toBeGreaterThan(0);
        expect(loops.length).toBeLessThanOrEqual(world.loops.count);
        for (const loop of loops) {
            expect(loop.time).toBeLessThanOrEqual(world.time);
            const beats = loop.time / LOOP_BEAT;
            expect(Math.abs(beats - Math.round(beats))).toBeLessThan(1e-4);
            expect(Math.hypot(...loop.mid)).toBeCloseTo(1, 5);
        }
        for (const slot of world.u.impactA) expect(slot.value.w).toBeLessThan(0);
        for (const slot of world.u.impactC) expect(slot.value.w).toBe(0);
        expect(world.u.impactsLive.value).toBe(0);
        expect(frontsOut(world)).toEqual([]);
        expect(world.u.echo.value.y).toBe(0);
        expect(world.u.pulsar.value.x).toBe(0);
        world.dispose();
    });

    it('bakes one small tileable noise volume on the CPU, the same for a seed, centred in every channel', async () => {
        const { world } = makeWorld('Minimal');
        expect(world.textures).toHaveLength(1);
        const [noise] = world.textures;
        expect(noise.isData3DTexture).toBe(true);
        expect(world.u.noiseTex).toBe(noise);
        const { width, height, depth } = noise.image;
        expect([width, height, depth]).toEqual([NOISE3_SIZE, NOISE3_SIZE, NOISE3_SIZE]);
        expect(NOISE3_SIZE).toBe(64);
        expect(noise.image.data).toBeInstanceOf(Uint8Array);
        expect(noise.image.data).toHaveLength(NOISE3_SIZE ** 3 * 4);
        expect(noise.format).toBe(THREE.RGBAFormat);
        expect(noise.type).toBe(THREE.UnsignedByteType);
        expect([noise.wrapS, noise.wrapT, noise.wrapR]).toEqual([
            THREE.RepeatWrapping, THREE.RepeatWrapping, THREE.RepeatWrapping,
        ]);
        expect(noise.generateMipmaps).toBe(false);
        // Each field is centred on a half with room either side, so a threshold means the same
        // thing in every channel.
        const { data } = noise.image;
        const cells = data.length / 4;
        for (let c = 0; c < 4; c++) {
            let sum = 0;
            let squares = 0;
            let low = 255;
            let high = 0;
            for (let i = c; i < data.length; i += 4) {
                sum += data[i];
                squares += data[i] * data[i];
                if (data[i] < low) low = data[i];
                if (data[i] > high) high = data[i];
            }
            const mean = sum / cells / 255;
            const deviation = Math.sqrt(squares / cells / 255 / 255 - mean * mean);
            expect(mean, `channel ${c}`).toBeGreaterThan(0.48);
            expect(mean, `channel ${c}`).toBeLessThan(0.52);
            expect(deviation, `channel ${c}`).toBeGreaterThan(0.1);
            expect(deviation, `channel ${c}`).toBeLessThan(0.26);
            expect(low, `channel ${c}`).toBeLessThan(64);
            expect(high, `channel ${c}`).toBeGreaterThan(191);
        }
        // The same seed bakes the same bytes; another seed, another volume. (The function itself,
        // not this file's memo of it.)
        const { bakeNoise3D: bake } = await vi.importActual('../../src/themes/supernova/supernova-tsl.js');
        const small = bake(7, 32);
        expect(small).toHaveLength(32 ** 3 * 4);
        expect(bake(7, 32)).not.toBe(small);
        expect(Buffer.compare(Buffer.from(bake(7, 32)), Buffer.from(small))).toBe(0);
        expect(Buffer.compare(Buffer.from(bake(8, 32)), Buffer.from(small))).not.toBe(0);
        // What the world was given is that function's volume for its seed.
        expect(Buffer.compare(Buffer.from(bake(world.seed)), Buffer.from(data))).toBe(0);
        // The four channels are four different fields.
        let same = 0;
        for (let i = 0; i < small.length; i += 4) if (small[i] === small[i + 1] && small[i] === small[i + 2]) same += 1;
        expect(same).toBeLessThan(small.length / 4 / 20);
        world.dispose();
    });

    it('draws only the named parts when asked', () => {
        const { world } = makeWorld('Low');
        world.showOnlyParts(['sky', 'star', 'no-such-part']);
        for (const name of SUPERNOVA_PARTS) {
            expect(world.parts[name].mesh.visible, name).toBe(name === 'sky' || name === 'star');
        }
        world.showOnlyParts(SUPERNOVA_PARTS);
        expect(SUPERNOVA_PARTS.every((name) => world.parts[name].mesh.visible)).toBe(true);
        world.dispose();
    });

    it('releases every geometry, material and texture, leaves the scene and survives a second dispose', () => {
        const { scene, camera, world } = makeWorld('Medium');
        expect(scene.children).toContain(world.root);
        const disposals = [];
        Object.values(world.parts).forEach((part) => {
            disposals.push(vi.spyOn(part.geometry, 'dispose'), vi.spyOn(part.material, 'dispose'));
        });
        world.textures.forEach((texture) => disposals.push(vi.spyOn(texture, 'dispose')));
        expect(disposals).toHaveLength(SUPERNOVA_PARTS.length * 2 + 1);
        expect(world.disposed).toBe(false);
        world.dispose();
        expect(world.disposed).toBe(true);
        expect(scene.children).toHaveLength(0);
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        expect(world.parts).toEqual({});
        expect(world.textures).toEqual([]);
        for (const key of ['u', 'loops', 'streams', 'sparks']) expect(world[key], key).toBeNull();
        expect(() => world.dispose()).not.toThrow();
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
        // A late frame or a late event after retirement is harmless.
        expect(() => {
            world.updateCamera(camera, { time: 11, delta: 0.016 });
            world.update({ time: 11, delta: 0.016 }, camera);
            world.onLock({ u: 0.5 });
            world.onLock({ screen: { x: 0.2, y: 0.8 }, hardDrop: true });
            world.onClear({ lines: 4 });
            world.onCombo(3);
            world.onCombo(CRITICAL_COMBO);
            world.onCombo(0);
            world.levelUp(2);
            world.levelUp(3, { silent: true });
            world.setViewport(800, 600, 800 / 600);
            world.setLayout(null);
            world.setReducedMotion(true);
            world.showOnlyParts(['sky']);
            world.resetSession();
            world.seek(3);
        }).not.toThrow();
        expect(world.getState()).toMatchObject({
            shells: 0, loops: 0, embers: 0, sparks: 0, counts: { locks: 0, clears: 0, streams: 0 },
        });
    });
});

describe('supernova world: the star\'s place, pose and camera', () => {
    it('holds its horizontal view, clamped for very wide and very tall frames', () => {
        const horizontal = (aspect) => (2 * Math.atan(Math.tan((fovForAspect(aspect) * DEG) / 2) * aspect)) / DEG;
        expect(horizontal(16 / 9)).toBeCloseTo(REST_RIG.hFov, 6);
        expect(horizontal(1.5)).toBeCloseTo(REST_RIG.hFov, 6);
        expect(fovForAspect(0.46)).toBe(REST_RIG.maxFov);
        expect(fovForAspect(2.6)).toBe(REST_RIG.minFov);
        for (const junk of [NaN, undefined, Infinity, 0, -2]) {
            const fov = fovForAspect(junk);
            expect(fov).toBeGreaterThanOrEqual(REST_RIG.minFov);
            expect(fov).toBeLessThanOrEqual(REST_RIG.maxFov);
        }
    });

    it('hangs the star where the composition wants it, about as large as it says, wide frame or phone', () => {
        for (const [width, height] of [[1600, 900], [460, 1000], [2400, 1000], [1024, 768]]) {
            const { world } = makeWorld('Minimal', { width, height });
            const aspect = width / height;
            const anchors = starAnchors(aspect);
            expect(world.anchors).toEqual(anchors);
            const rest = world.restCamera();
            const centre = world.u.centre.value;
            const at = onScreen(centre.toArray(), rest);
            expect(at.x, `${width}x${height}`).toBeCloseTo(anchors.x, 6);
            expect(at.y, `${width}x${height}`).toBeCloseTo(anchors.y, 6);
            expect(centre.length()).toBeCloseTo(world.distance, 9);
            expect(world.getState().distance).toBe(world.distance);
            // Its disc on screen, in screen heights (measured up the screen from its centre): what
            // the composition asks, however far off the lens's axis the star hangs.
            const top = onScreen([centre.x, centre.y + STAR.radius, centre.z], rest);
            const radius = at.y - top.y;
            expect(radius / anchors.radius, `${width}x${height}`).toBeCloseTo(1, 6);
            world.dispose();
        }
    });

    it('recomposes when the frame changes shape', () => {
        const { camera, world } = makeWorld('Minimal');
        const wide = world.u.centre.value.clone();
        const wideDistance = world.distance;
        world.setViewport(460, 1000, 0.46);
        expect(world.aspect).toBe(0.46);
        expect(world.anchors).toEqual(starAnchors(0.46));
        expect(world.u.centre.value.distanceTo(wide)).toBeGreaterThan(1);
        expect(world.distance).not.toBe(wideDistance);
        expect(world.u.viewport.value.toArray()).toEqual([460, 1000]);
        // The star climbs above the card: its heart is on the centre line, near the top.
        camera.aspect = 0.46;
        camera.updateProjectionMatrix();
        world.setReducedMotion(true);
        run(world, camera, 0.1, 2);
        expect(world.getState().heart.x).toBeCloseTo(0.5, 5);
        expect(world.getState().heart.y).toBeCloseTo(starAnchors(0.46).y, 5);
        // No board on screen: events aim at where the solo board would be in this frame.
        world.setLayout(null);
        world.setViewport(1600, 900, 16 / 9);
        expect(world.layout).toEqual(fallbackLayout((16 / 9) * 1000, 1000));
        // Nonsense leaves the frame as it was.
        world.setViewport(0, -5, NaN);
        expect(world.aspect).toBeCloseTo(16 / 9, 12);
        expect(world.u.viewport.value.toArray()).toEqual([1600, 900]);
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('turns the star about a leaning axis on the world clock, in a frame that is a rigid turn', () => {
        const { camera, world } = makeWorld('Minimal');
        const rot = world.u.starRot.value;
        const inverse = world.u.starInv.value;
        // A rotation, and its inverse beside it.
        expect(rot.determinant()).toBeCloseTo(1, 9);
        const product = rot.clone().multiply(inverse);
        [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, i) => expect(product.elements[i]).toBeCloseTo(value, 9));
        // The world's two frame changes undo each other.
        const there = world.toStarFrame(new THREE.Vector3(0.36, 0.48, 0.8));
        expect(Math.hypot(...there)).toBeCloseTo(1, 9);
        const back = world.toWorld(there, new THREE.Vector3());
        [0.36, 0.48, 0.8].forEach((value, i) => expect(back.getComponent(i)).toBeCloseTo(value, 9));
        // Its axis leans from the screen's up without lying down.
        const axis = new THREE.Vector3(0, 1, 0).applyMatrix3(rot);
        expect(axis.y).toBeGreaterThan(0.6);
        expect(axis.y).toBeLessThan(0.99);
        // At rest the turn is the clock's: seek puts it where a run would have brought it.
        expect(world.getState().spin).toBeCloseTo(10 * STAR.spin, 12);
        run(world, camera, 5);
        expect(world.getState().spin).toBeCloseTo(15 * STAR.spin, 9);
        const turned = world.u.starRot.value.clone();
        settle(world, camera, 15);
        expect(world.getState().spin).toBeCloseTo(15 * STAR.spin, 12);
        for (let i = 0; i < 9; i++) expect(world.u.starRot.value.elements[i]).toBeCloseTo(turned.elements[i], 9);
        world.dispose();
    });

    it('stands the ring round the star, leaned back from the line of sight', () => {
        const { world } = makeWorld('Low');
        const ring = world.parts.ring.mesh;
        const major = new THREE.Vector3();
        const minor = new THREE.Vector3();
        const normal = new THREE.Vector3();
        ring.matrixWorld.extractBasis(major, minor, normal);
        for (const basis of [major, minor, normal]) expect(basis.length()).toBeCloseTo(1, 9);
        expect(major.dot(minor)).toBeCloseTo(0, 9);
        expect(major.dot(normal)).toBeCloseTo(0, 9);
        expect(minor.dot(normal)).toBeCloseTo(0, 9);
        const centre = new THREE.Vector3().setFromMatrixPosition(ring.matrixWorld);
        expect(centre.distanceTo(world.u.centre.value)).toBeCloseTo(0, 9);
        // Neither face-on nor edge-on: an ellipse with a near half and a far half.
        const toEye = world.u.centre.value.clone().normalize().negate();
        const lean = Math.acos(Math.abs(normal.dot(toEye)));
        expect(lean).toBeGreaterThan(RING.inclination - 0.15);
        expect(lean).toBeLessThan(RING.inclination + 0.15);
        world.dispose();
    });

    it('finds the world point under a screen point', () => {
        const { camera, world } = makeWorld('Minimal');
        for (const [sx, sy, depth] of [[0.5, 0.5, 10], [0.1, 0.9, 4], [0.93, 0.07, 30]]) {
            const point = world.screenToWorld(sx, sy, depth, [0, 0, 0]);
            const at = onScreen(point, camera);
            expect(at.x).toBeCloseTo(sx, 6);
            expect(at.y).toBeCloseTo(sy, 6);
            expect(new THREE.Vector3(...point).distanceTo(camera.position)).toBeCloseTo(depth, 6);
        }
        // Before a camera is bound there is still an answer.
        const unbound = new SupernovaWorld({ scene: new THREE.Scene(), quality: 'Minimal' }).build();
        expect(unbound.screenToWorld(0.3, 0.3, 7, [0, 0, 0])).toEqual([0, 0, -7]);
        unbound.dispose();
        world.dispose();
    });

    it('drifts and leans the view with the pointer, and the star slides the other way', () => {
        const { camera, world } = makeWorld('Minimal');
        const at = (pointerX, pointerY) => {
            const sim = {
                time: world.time, delta: 0, pointerX, pointerY,
            };
            world.updateCamera(camera, sim);
            world.update(sim, camera);
            return { position: camera.position.clone(), heart: world.getState().heart };
        };
        const rest = at(0, 0);
        const right = at(1, 0);
        const down = at(0, 1);
        expect(right.position.x).toBeGreaterThan(rest.position.x);
        expect(right.heart.x).toBeLessThan(rest.heart.x);
        expect(down.position.y).toBeLessThan(rest.position.y);
        expect(down.heart.y).toBeLessThan(rest.heart.y);
        // It never leaves the frame it was composed for by much.
        expect(Math.abs(right.heart.x - rest.heart.x)).toBeLessThan(0.08);
        // The long lens and its planes are the rig's.
        expect(camera.fov).toBeCloseTo(fovForAspect(16 / 9), 9);
        expect(camera.near).toBe(REST_RIG.near);
        expect(camera.far).toBe(REST_RIG.far);
        // It drifts by itself too.
        at(0, 0);
        const before = camera.position.clone();
        run(world, camera, 20, 40);
        expect(camera.position.distanceTo(before)).toBeGreaterThan(1e-3);
        world.dispose();
    });

    it('keeps the camera still under reduced motion, and puts the star exactly on its anchor', () => {
        const { camera, world } = makeWorld('Low');
        world.setReducedMotion(true);
        world.onClear({ lines: 4 });
        let moved = 0;
        let widest = 0;
        run(world, camera, 3, 180, () => {
            const sim = {
                time: world.time, delta: 0, pointerX: 1, pointerY: -1,
            };
            world.updateCamera(camera, sim);
            moved = Math.max(moved, camera.position.length());
            widest = Math.max(widest, Math.abs(camera.fov - fovForAspect(16 / 9)));
        });
        expect(world.getState().counts.novas).toBe(1);
        expect(moved).toBe(0);
        expect(widest).toBe(0);
        const anchors = starAnchors(16 / 9);
        expect(world.getState().heart.x).toBeCloseTo(anchors.x, 6);
        expect(world.getState().heart.y).toBeCloseTo(anchors.y, 6);
        world.dispose();
    });

    it('pushes the lens in on a blow and lets it go', () => {
        const { camera, world } = makeWorld('Low');
        const rest = fovForAspect(16 / 9);
        world.onLock({ u: 0.4, rows: [19], hardDrop: true });
        run(world, camera, 1 / 60, 1);
        run(world, camera, 1 / 60, 1);
        expect(camera.fov).toBeLessThan(rest);
        expect(camera.position.z).toBeGreaterThan(0);
        run(world, camera, 4);
        expect(camera.fov).toBeCloseTo(rest, 3);
        world.dispose();
    });
});

describe('supernova world: locks', () => {
    it('sends a stream from the card\'s edge into the star, which answers where and when it lands', () => {
        const { camera, world } = makeWorld('High');
        const promises = watchPromises(world);
        const landings = watchLandings(world);
        const standing = world.tier.shells;
        const colour = pieceColor('#ff0033');
        const t0 = world.time;
        world.onLock({ u: 0.3, rows: [12, 11], color: '#ff0033' });
        expect(world.getState().counts).toMatchObject({
            locks: 1, streams: 1, impacts: 0, fronts: 0,
        });
        // One stream, promised a landing a moment on.
        expect(promises).toHaveLength(1);
        expect(promises[0].kept).toBe(true);
        const land = promises[0].time;
        expect(land).toBeGreaterThan(t0 + 0.1);
        expect(land).toBeLessThan(t0 + 1.5);
        expect(world.getState().pending).toBe(1);
        const streams = streamsOf(world);
        expect(streams).toHaveLength(1);
        const [stream] = streams;
        expect(stream.time).toBeCloseTo(t0, 4);
        expect(stream.flight).toBeCloseTo(land - t0, 5);
        expect(stream.kind).toBe(0);
        stream.rgb.forEach((channel, c) => expect(channel).toBeCloseTo(colour[c], 5));
        expect(Math.hypot(...stream.dir)).toBeCloseTo(1, 5);
        // It leaves the card's left edge (the star is left of the card) at the piece's own height.
        const card = cardUnion(world.layout);
        const [board] = world.layout.boards;
        expect(world.getState().heart.x).toBeLessThan(card.x0);
        const start = onScreen(stream.from, camera);
        expect(start.x).toBeCloseTo(card.x0, 4);
        expect(start.y).toBeCloseTo(boardPoint(board, 0.3, 11).y, 4);
        // In front of the star, between it and the eye.
        const depth = new THREE.Vector3(...stream.from).distanceTo(camera.position);
        expect(depth).toBeGreaterThan(0);
        expect(depth).toBeLessThan(world.distance);

        // Until it lands, the star has not been touched.
        runTo(world, camera, land - 0.03);
        expect(landings).toEqual([]);
        for (const slot of world.u.impactA) expect(slot.value.w).toBe(-100);
        expect(world.u.impactsLive.value).toBe(0);
        expect(frontsOut(world)).toEqual([]);
        expect(world.getState()).toMatchObject({ shells: standing, pulse: 0, counts: { impacts: 0 } });

        // It lands: once, as of its own moment, whichever frame noticed.
        runTo(world, camera, land + 0.03);
        expect(landings).toHaveLength(1);
        expect(landings[0]).toMatchObject({ name: 'impact', time: land, amount: 1 });
        expect(landings[0].frame).toBeGreaterThanOrEqual(land);
        expect(landings[0].frame - land).toBeLessThan(1 / 60 + 1e-9);
        const written = world.u.impactA.filter((slot) => slot.value.w > -50);
        expect(written).toHaveLength(1);
        const index = world.u.impactA.indexOf(written[0]);
        const place = written[0].value;
        expect(place.w).toBe(land);
        expect(Math.hypot(place.x, place.y, place.z)).toBeCloseTo(1, 9);
        // Where the stream was aimed, in the star's own frame.
        stream.dir.forEach((component, c) => expect(place.getComponent(c)).toBeCloseTo(component, 5));
        const mark = world.u.impactC[index].value;
        expect([mark.x, mark.y, mark.z]).toEqual(colour);
        expect(mark.w).toBeGreaterThan(0);
        expect(world.u.impactsLive.value).toBe(1);
        // On the side of the star the eye can see.
        const normal = new THREE.Vector3(place.x, place.y, place.z).applyMatrix3(world.u.starRot.value);
        const toEye = camera.position.clone().sub(world.u.centre.value).normalize();
        expect(normal.dot(toEye)).toBeGreaterThan(0);
        // A prominence rises from the spot, in the piece's colour...
        const raised = loopsOf(world).filter((loop) => Math.abs(loop.time - land) < 1e-4);
        expect(raised).toHaveLength(1);
        raised[0].mid.forEach((component, c) => expect(component).toBeCloseTo(place.getComponent(c), 5));
        const look = four(instanced(world.loops, 'aLook').array, raised[0].slot);
        look.slice(0, 3).forEach((channel, c) => expect(channel).toBeCloseTo(colour[c], 5));
        // ...sparks fly from it...
        expect(sparkBirths(world).filter((birth) => Math.abs(birth - land) < 1e-4).length).toBeGreaterThan(0);
        // ...and its colour runs out through the nebula as an echo.
        const echoes = frontsOut(world);
        expect(echoes).toHaveLength(1);
        expect(echoes[0].birth).toBe(land);
        expect(echoes[0].rgb).toEqual(colour);
        expect(world.getState()).toMatchObject({
            shells: standing + 1, pending: 0, counts: { impacts: 1, fronts: 1, streams: 1 },
        });
        const echo = shellRow(world, standing);
        expect(echo.rgb).toEqual(colour);
        expect(echo.gain).toBeGreaterThan(0);
        expect(echo.radius).toBeGreaterThan(STAR.radius);
        expect(world.getState().pulse).toBeGreaterThan(0);
        // The echo fades from the table; the mark stays on the star a while.
        run(world, camera, 12, 240);
        expect(world.getState().shells).toBe(standing);
        expect(world.u.impactsLive.value).toBe(1);
        run(world, camera, 30, 300);
        expect(world.u.impactsLive.value).toBe(0);
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('throws a few sparks where a stream tears away from the card', () => {
        const { camera, world } = makeWorld('High');
        const t0 = world.time;
        world.onLock({ u: 0.3, rows: [12], color: '#00ff88' });
        const born = sparkBirths(world).filter((birth) => Math.abs(birth - t0) < 1e-4);
        expect(born.length).toBeGreaterThan(0);
        expect(born.length).toBeLessThan(world.sparks.count / 20);
        // They start where the stream does.
        const [stream] = streamsOf(world);
        const first = four(instanced(world.sparks, 'aBirth').array, used(world.sparks, 'aBirth')[0]);
        stream.from.forEach((component, c) => expect(first[c]).toBeCloseTo(component, 4));
        run(world, camera, 0.1);
        world.dispose();
    });

    it('sends three streams on a hard drop and hits harder with the one in the middle', () => {
        const hard = makeWorld('High');
        const soft = makeWorld('High');
        const promises = watchPromises(hard.world);
        const landings = watchLandings(hard.world);
        hard.world.onLock({
            u: 0.6, rows: [15], hardDrop: true, color: '#64dcff',
        });
        soft.world.onLock({ u: 0.6, rows: [15], color: '#64dcff' });
        expect(hard.world.getState().counts).toMatchObject({ locks: 1, streams: 3 });
        expect(soft.world.getState().counts).toMatchObject({ locks: 1, streams: 1 });
        expect(promises).toHaveLength(3);
        expect(promises[0].amount).toBeGreaterThan(promises[1].amount);
        expect(promises[1].amount).toBe(promises[2].amount);
        // Three starts, close together, the first where a plain lock would leave.
        const streams = streamsOf(hard.world);
        expect(streams).toHaveLength(3);
        const starts = streams.map((stream) => onScreen(stream.from, hard.camera));
        const plain = onScreen(streamsOf(soft.world)[0].from, soft.camera);
        expect(starts[0].x).toBeCloseTo(plain.x, 5);
        expect(starts[0].y).toBeCloseTo(plain.y, 5);
        for (const start of starts.slice(1)) {
            const apart = Math.hypot(start.x - starts[0].x, start.y - starts[0].y);
            expect(apart).toBeGreaterThan(0.005);
            expect(apart).toBeLessThan(0.06);
        }
        expect(Math.hypot(starts[1].x - starts[2].x, starts[1].y - starts[2].y)).toBeGreaterThan(0.005);
        expect(streams[0].size).toBeGreaterThan(streams[1].size);
        // The blow is felt at once, harder than a plain lock's.
        run(hard.world, hard.camera, 1 / 60, 1);
        run(soft.world, soft.camera, 1 / 60, 1);
        expect(hard.world.getPostState().kick).toBeGreaterThan(soft.world.getPostState().kick);
        expect(hard.world.getPostState().flash).toBeGreaterThan(soft.world.getPostState().flash);
        // All three land, each on its own spot, the middle one hardest.
        run(hard.world, hard.camera, 1.2);
        expect(landings.map((landing) => landing.name)).toEqual(['impact', 'impact', 'impact']);
        expect(hard.world.getState().counts).toMatchObject({ impacts: 3, fronts: 3 });
        const marks = hard.world.u.impactC.map((slot) => slot.value.w).filter((w) => w > 0).sort((a, b) => b - a);
        expect(marks).toHaveLength(3);
        expect(marks[0]).toBeGreaterThan(marks[1]);
        const spots = hard.world.u.impactA.filter((slot) => slot.value.w > -50).map((slot) => slot.value);
        expect(new Set(spots.map((spot) => spot.w)).size).toBe(3);
        const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        expect(apart(spots[0], spots[1])).toBeGreaterThan(1e-3);
        expect(apart(spots[1], spots[2])).toBeGreaterThan(1e-3);
        hard.world.dispose();
        soft.world.dispose();
    });

    it('raises one prominence for one piece: a hard drop\'s two side streams raise none', () => {
        const hard = makeWorld('High');
        const soft = makeWorld('High');
        const landings = watchLandings(hard.world);
        hard.world.onLock({
            u: 0.6, rows: [15], hardDrop: true, color: '#64dcff',
        });
        soft.world.onLock({ u: 0.6, rows: [15], color: '#64dcff' });
        // Inside one of the star's own beats, so every arch raised is a landing's.
        run(hard.world, hard.camera, 1.2);
        run(soft.world, soft.camera, 1.2);
        expect(landings).toHaveLength(3);
        const raised = (made) => loopsOf(made.world).filter((loop) => loop.time > 10);
        expect(raised(soft)).toHaveLength(1);
        expect(raised(hard)).toHaveLength(1);
        // It stands where the middle stream (the hard one) came down, when it did.
        const middle = landings.reduce((a, b) => (b.amount > a.amount ? b : a));
        expect(raised(hard)[0].time).toBeCloseTo(middle.time, 4);
        raised(hard)[0].mid.forEach((component, c) => expect(component).toBeCloseTo(middle.dir[c], 5));
        // The two beside it still mark the star, throw their sparks and send their echo.
        expect(hard.world.u.impactC.filter((slot) => slot.value.w > 0)).toHaveLength(3);
        expect(hard.world.getState().counts).toMatchObject({ impacts: 3, fronts: 3 });
        for (const landing of landings) {
            const thrown = sparkBirths(hard.world).filter((birth) => Math.abs(birth - landing.time) < 1e-4);
            expect(thrown.length).toBeGreaterThan(0);
        }
        hard.world.dispose();
        soft.world.dispose();
    });

    it('leaves by the edge of the card that faces the star: its top on a phone', () => {
        const { camera, world } = makeWorld('Low', { width: 460, height: 1000 });
        const card = cardUnion(world.layout);
        const [board] = world.layout.boards;
        const { heart } = world.getState();
        expect(heart.x).toBeGreaterThan(card.x0);
        expect(heart.x).toBeLessThan(card.x1);
        expect(heart.y).toBeLessThan(card.y0);
        world.onLock({ u: 0.3, rows: [10], color: '#ffdd00' });
        const start = onScreen(streamsOf(world)[0].from, camera);
        expect(start.x).toBeCloseTo(boardPoint(board, 0.3, 10).x, 4);
        expect(start.y).toBeCloseTo(card.y0, 4);
        // The cleared rows go the same way, spread along the edge instead of stacked on one point.
        world.onClear({ rows: [19, 18, 17], lines: 3 });
        const rows = streamsOf(world).filter((s) => s.kind === 1).map((stream) => onScreen(stream.from, camera));
        expect(rows).toHaveLength(3);
        for (const row of rows) expect(row.y).toBeCloseTo(card.y0, 4);
        for (let i = 1; i < rows.length; i++) expect(rows[i].x - rows[i - 1].x).toBeGreaterThan(0.02);
        // Round the middle of the board, inside the card's width.
        expect((rows[0].x + rows[2].x) / 2).toBeCloseTo((board.x0 + board.x1) / 2, 4);
        expect(rows[1].x).toBeCloseTo((board.x0 + board.x1) / 2, 4);
        expect(rows[0].x).toBeGreaterThan(card.x0);
        expect(rows[2].x).toBeLessThan(card.x1);
        run(world, camera, 1.5);
        expect(world.getState().counts).toMatchObject({ impacts: 1, clears: 1 });
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('spreads a hard drop\'s side streams along the edge they leave by, on a phone as in a wide frame', () => {
        const starts = (width, height) => {
            const { camera, world } = makeWorld('Low', { width, height });
            world.onLock({ u: 0.4, rows: [10], hardDrop: true });
            const points = streamsOf(world).map((stream) => onScreen(stream.from, camera));
            const card = cardUnion(world.layout);
            world.dispose();
            return { points, card };
        };
        // Beside the card: all three on its left edge, one above the middle one and one below.
        const wide = starts(1600, 900);
        expect(wide.points).toHaveLength(3);
        for (const point of wide.points) expect(point.x).toBeCloseTo(wide.card.x0, 4);
        expect(wide.points[1].y).toBeLessThan(wide.points[0].y - 0.005);
        expect(wide.points[2].y).toBeGreaterThan(wide.points[0].y + 0.005);
        // On a phone: all three on its top edge, one left of the middle one and one right. None
        // starts inside the card or above it.
        const phone = starts(460, 1000);
        expect(phone.points).toHaveLength(3);
        for (const point of phone.points) expect(point.y).toBeCloseTo(phone.card.y0, 4);
        expect(phone.points[1].x).toBeLessThan(phone.points[0].x - 0.005);
        expect(phone.points[2].x).toBeGreaterThan(phone.points[0].x + 0.005);
        // Evenly either side.
        expect(phone.points[0].x - phone.points[1].x).toBeCloseTo(phone.points[2].x - phone.points[0].x, 4);
        expect(wide.points[0].y - wide.points[1].y).toBeCloseTo(wide.points[2].y - wide.points[0].y, 4);
    });

    it('picks the edge from where the star stands against the cards, or the piece\'s own place behind them', () => {
        const { world } = makeWorld('Low');
        const { heart } = world.getState();
        const layout = (card, board) => ({
            cardCount: 1, cards: [card], hud: null, boards: [board, null, null, null, null],
        });
        const launch = (card, board, u, row) => {
            world.setLayout(layout(card, board));
            return { ...world.launchPoint(0, u, row) };
        };
        const point = (board, u, row) => boardPoint(board, u, row, { x: 0, y: 0 });
        // The card left of the star: its right edge, at the row's height.
        let card = {
            x0: 0.02, y0: 0.2, x1: 0.12, y1: 0.8,
        };
        let board = {
            x0: 0.03, y0: 0.3, x1: 0.11, y1: 0.78,
        };
        expect(launch(card, board, 0.3, 7)).toEqual({ x: card.x1, y: point(board, 0.3, 7).y, top: false });
        // The card above the star: its foot, at the piece's column (`top`: a column sets its place).
        card = {
            x0: heart.x - 0.1, y0: 0.02, x1: heart.x + 0.1, y1: heart.y - 0.1,
        };
        board = {
            x0: heart.x - 0.08, y0: 0.05, x1: heart.x + 0.08, y1: heart.y - 0.12,
        };
        expect(launch(card, board, 0.7, 3)).toEqual({ x: point(board, 0.7, 3).x, y: card.y1, top: true });
        // The card below the star: its top, at the piece's column.
        card = {
            x0: heart.x - 0.1, y0: heart.y + 0.1, x1: heart.x + 0.1, y1: 0.98,
        };
        board = {
            x0: heart.x - 0.08, y0: heart.y + 0.15, x1: heart.x + 0.08, y1: 0.95,
        };
        expect(launch(card, board, 0.2, 3)).toEqual({ x: point(board, 0.2, 3).x, y: card.y0, top: true });
        // The star behind the card: the stream leaves from the piece itself.
        card = {
            x0: heart.x - 0.1, y0: heart.y - 0.2, x1: heart.x + 0.3, y1: heart.y + 0.2,
        };
        board = {
            x0: heart.x, y0: heart.y - 0.15, x1: heart.x + 0.2, y1: heart.y + 0.15,
        };
        expect(launch(card, board, 0.5, 12)).toEqual({ ...point(board, 0.5, 12), top: false });
        // Several cards: the edge is their union's, the row is the player's own board's.
        const boards = [null, {
            x0: 0.4, y0: 0.3, x1: 0.5, y1: 0.8,
        }, {
            x0: 0.7, y0: 0.1, x1: 0.8, y1: 0.6,
        }, null, null];
        world.setLayout({
            cardCount: 2,
            cards: [{
                x0: 0.38, y0: 0.2, x1: 0.52, y1: 0.85,
            }, {
                x0: 0.68, y0: 0.05, x1: 0.82, y1: 0.65,
            }],
            hud: null,
            boards,
        });
        expect({ ...world.launchPoint(2, 0.5, 4) }).toEqual({ x: 0.38, y: point(boards[2], 0.5, 4).y, top: false });
        // A player with no board of its own borrows the first on screen.
        expect({ ...world.launchPoint(4, 0.5, 4) }).toEqual({ x: 0.38, y: point(boards[1], 0.5, 4).y, top: false });
        // Cards and no board at all: still a point on screen.
        world.setLayout({
            cardCount: 1, cards: [card], hud: null, boards: [null, null, null, null, null],
        });
        const lost = world.launchPoint(0, 0.5, 4);
        expect(Number.isFinite(lost.x) && Number.isFinite(lost.y)).toBe(true);
        world.dispose();
    });

    /**
     * Fault in the fix for the side streams: launchPoint() returns early when there is no board
     * and leaves `top` as the last call set it, so after a launch from a card's top edge a
     * hard drop with no board on screen is still spread sideways. One `out.top = false` before
     * the early return.
     */
    it('says nothing leaves by a top edge when there is no board to leave', () => {
        const { world } = makeWorld('Low', { width: 460, height: 1000 });
        expect(world.launchPoint(0, 0.5, 5).top).toBe(true);
        world.setLayout({
            cardCount: 1, cards: [cardUnion(world.layout)], hud: null, boards: [null, null, null, null, null],
        });
        expect(world.launchPoint(0, 0.5, 5).top).toBe(false);
        world.dispose();
    });

    it('aims from a click when it is given one, and from the solo board\'s place when no board is on screen', () => {
        const { camera, world } = makeWorld('Low', { live: false });
        expect(world.getState().layoutLive).toBe(false);
        world.onLock({ screen: { x: 0.7, y: 0.25 }, color: '#ff00ff' });
        let [stream] = streamsOf(world);
        let start = onScreen(stream.from, camera);
        expect(start.x).toBeCloseTo(0.7, 4);
        expect(start.y).toBeCloseTo(0.25, 4);
        // A malformed click falls back to the board; with no board, to where the solo board would hang.
        settle(world, camera, 10);
        world.onLock({ screen: { x: 'left', y: 0.4 }, u: 0.5, rows: [19] });
        [stream] = streamsOf(world);
        start = onScreen(stream.from, camera);
        const solo = fallbackLayout((16 / 9) * 1000, 1000);
        expect(start.x).toBeCloseTo(solo.cards[0].x0, 4);
        expect(start.y).toBeCloseTo(boardPoint(solo.boards[0], 0.5, 19).y, 4);
        // A click sends a clear's rows from the click too.
        settle(world, camera, 10);
        world.onClear({ lines: 3, screen: { x: 0.6, y: 0.6 } });
        const rows = streamsOf(world);
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe(1);
        start = onScreen(rows[0].from, camera);
        expect(start.x).toBeCloseTo(0.6, 4);
        expect(start.y).toBeCloseTo(0.6, 4);
        run(world, camera, 1);
        expect(world.getState().counts.fronts).toBe(3);
        expect(notFinite(world)).toEqual([]);
        expect(poolsNotFinite(world)).toEqual([]);
        world.dispose();
    });

    it('remembers the last few impacts as a ring of slots and never grows a pool', () => {
        const { camera, world } = makeWorld('High');
        const landings = watchLandings(world);
        const colours = [
            '#64dcff', '#ffaa00', '#ff0033', '#00ff88', '#ff00ff', '#0088ff', '#ffdd00', '#ffffff',
        ];
        for (let i = 0; i < IMPACT_SLOTS + 2; i++) {
            world.onLock({ u: (i * 0.37) % 1, rows: [19 - i], color: colours[i] });
            run(world, camera, 0.3);
        }
        run(world, camera, 1.5);
        const times = landings.filter((landing) => landing.name === 'impact').map((landing) => landing.time);
        expect(times).toHaveLength(IMPACT_SLOTS + 2);
        expect(world.getState().counts.impacts).toBe(IMPACT_SLOTS + 2);
        // The slots hold the last ones to land.
        const held = world.u.impactA.map((slot) => slot.value.w).sort((a, b) => a - b);
        expect(held).toEqual(times.slice(-IMPACT_SLOTS).sort((a, b) => a - b));
        expect(world.u.impactA).toHaveLength(IMPACT_SLOTS);
        expect(streamsOf(world).length).toBeLessThanOrEqual(STREAM_SLOTS);
        expect(loopsOf(world).length).toBeLessThanOrEqual(world.loops.count);
        expect(world.getState().shells).toBeLessThanOrEqual(SHELL_ROWS);
        world.dispose();
    });

    it('reads a row or a column that is not a number as the floor row, the middle column', () => {
        const cases = [
            [1600, 900, { rows: [NaN], u: 0.5 }],
            [1600, 900, { rows: ['a'], u: 0.5 }],
            [1600, 900, { rows: [undefined] }],
            [460, 1000, { rows: [10], u: NaN }],
            [460, 1000, { rows: [10], u: 'x' }],
        ];
        for (const [width, height, lock] of cases) {
            const { camera, world } = makeWorld('Low', { width, height });
            const card = cardUnion(world.layout);
            const [board] = world.layout.boards;
            world.onLock(lock);
            // Beside the card the row sets the height; above it the column sets the place.
            const start = onScreen(streamsOf(world)[0].from, camera);
            if (width > height) {
                expect(start.x).toBeCloseTo(card.x0, 4);
                expect(start.y).toBeCloseTo(boardPoint(board, 0.5, 19).y, 4);
            } else {
                expect(start.x).toBeCloseTo(boardPoint(board, 0.5, 10).x, 4);
                expect(start.y).toBeCloseTo(card.y0, 4);
            }
            world.onClear({ rows: [NaN, 'b'], lines: 2 });
            run(world, camera, 1.5);
            expect(world.getState().counts).toMatchObject({ impacts: 1, clears: 1 });
            expect(notFinite(world), JSON.stringify(lock)).toEqual([]);
            expect(poolsNotFinite(world), JSON.stringify(lock)).toEqual([]);
            world.dispose();
        }
    });
});

describe('supernova world: clears', () => {
    it('sends the cleared rows into the star, which answers with a shock: one front per line', () => {
        const answers = [];
        for (const lines of [1, 2, 3]) {
            const { camera, world } = makeWorld('High');
            const promises = watchPromises(world);
            const landings = watchLandings(world);
            const standing = world.tier.shells;
            const card = cardUnion(world.layout);
            const [board] = world.layout.boards;
            const t0 = world.time;
            world.onClear({ rows: bottom(lines), lines });
            expect(world.getState().counts).toMatchObject({ clears: 1, streams: lines, fronts: 0 });
            // The rows leave the card's edge, each at its own height, faster and whiter than a piece.
            const streams = streamsOf(world);
            expect(streams).toHaveLength(lines);
            streams.forEach((stream, i) => {
                expect(stream.kind).toBe(1);
                expect(stream.flight).toBeGreaterThanOrEqual(ROW_FLIGHT - 1e-6);
                expect(stream.flight).toBeLessThan(ROW_FLIGHT + 0.1);
                const start = onScreen(stream.from, camera);
                expect(start.x).toBeCloseTo(card.x0, 4);
                expect(start.y).toBeCloseTo(boardPoint(board, 0.5, 19 - i).y, 4);
                expect(Math.min(...stream.rgb)).toBeGreaterThan(0.39);
            });
            // A row only arrives: the one thing promised is the star's answer.
            expect(promises).toHaveLength(1);
            expect(promises[0]).toMatchObject({ kept: true, lines });
            expect(promises[0].time).toBeCloseTo(t0 + ROW_FLIGHT, 9);
            const arrive = promises[0].time;
            runTo(world, camera, arrive - 0.02);
            expect(landings).toEqual([]);
            expect(world.getState().shells).toBe(standing);
            // The shock: every front of it is sent at once, each leaving a beat after the last.
            let most = 0;
            runTo(world, camera, arrive + lines * FRONT_GAP + 0.1, () => {
                most = Math.max(most, world.getState().shells);
                expect(world.getState().shells).toBe(standing + frontsOut(world).length);
            });
            expect(landings).toHaveLength(1);
            expect(landings[0]).toMatchObject({ name: 'shock', time: arrive, lines });
            const fronts = world.fronts.filter((front) => front.strength > 0).sort((a, b) => a.birth - b.birth);
            expect(fronts).toHaveLength(lines);
            fronts.forEach((front, k) => {
                expect(front.birth).toBeCloseTo(arrive + k * FRONT_GAP, 9);
                expect(front.rgb).toEqual(landings[0].rgb);
                if (k > 0) expect(front.strength).toBeLessThan(fronts[k - 1].strength);
            });
            expect(most).toBe(standing + lines);
            expect(world.getState().counts).toMatchObject({
                fronts: lines, impacts: 0, novas: 0, aftershocks: 0,
            });
            // Each front runs outward, the first ahead of the next.
            const radii = Array.from({ length: lines }, (_, k) => shellRow(world, standing + k).radius);
            for (let k = 1; k < lines; k++) expect(radii[k]).toBeLessThan(radii[k - 1]);
            const before = radii[0];
            run(world, camera, 0.2);
            expect(shellRow(world, standing).radius).toBeGreaterThan(before);
            // The star swells with it, the lens is pushed and the sky answers.
            expect(world.getState().storm).toBeGreaterThan(0);
            expect(world.u.skyPulse.value).toBeGreaterThan(0);
            // Long after, the nebula holds only its standing shells again.
            run(world, camera, 25, 500);
            expect(world.getState().shells).toBe(standing);
            expect(notFinite(world)).toEqual([]);
            answers.push({ rgb: landings[0].rgb, amount: landings[0].amount });
            world.dispose();
        }
        // One, two and three lines answer in different colours, ever harder.
        expect(answers[0].rgb).not.toEqual(answers[1].rgb);
        expect(answers[1].rgb).not.toEqual(answers[2].rgb);
        expect(answers[0].rgb).not.toEqual(answers[2].rgb);
        expect(answers[1].amount).toBeGreaterThan(answers[0].amount);
        expect(answers[2].amount).toBeGreaterThan(answers[1].amount);
        for (const answer of answers) expect(Math.max(...answer.rgb)).toBeCloseTo(1, 9);
    });

    it('names the rows from the bottom when it is given none, and counts lines it is given oddly', () => {
        const { camera, world } = makeWorld('Low');
        const promises = watchPromises(world);
        const [board] = world.layout.boards;
        world.onClear({ lines: 2 });
        const starts = streamsOf(world).map((stream) => onScreen(stream.from, camera).y);
        expect(starts).toHaveLength(2);
        expect(starts[0]).toBeCloseTo(boardPoint(board, 0.5, 19).y, 4);
        expect(starts[1]).toBeCloseTo(boardPoint(board, 0.5, 18).y, 4);
        for (const lines of [0, -3, NaN, 'x', undefined, null]) world.onClear({ lines });
        world.onClear({ lines: '3' });
        world.onClear({ lines: 2.6 });
        expect(promises.map((promise) => promise.lines)).toEqual([2, 1, 1, 1, 1, 1, 1, 3, 3]);
        expect(world.getState().counts.clears).toBe(9);
        run(world, camera, 1);
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('makes every standing shell flare as the front crosses it, the inner ones first', () => {
        const struck = makeWorld('High');
        const calm = makeWorld('High');
        const standing = struck.world.tier.shells;
        // One line, one front: each shell flares once, when the front reaches it.
        struck.world.onClear({ rows: bottom(1), lines: 1 });
        const flared = Array.from({ length: standing }, () => ({ most: 1, since: null }));
        for (let frame = 0; frame < 360; frame++) {
            run(struck.world, struck.camera, 1 / 60, 1);
            run(calm.world, calm.camera, 1 / 60, 1);
            for (let k = 0; k < standing; k++) {
                const lit = shellRow(struck.world, k);
                const dark = shellRow(calm.world, k);
                // The same shell in both worlds: only its light differs.
                expect(lit.radius).toBe(dark.radius);
                expect(lit.gain).toBeGreaterThanOrEqual(dark.gain);
                if (dark.gain > 0.02) {
                    const ratio = lit.gain / dark.gain;
                    flared[k].most = Math.max(flared[k].most, ratio);
                    flared[k].radius = lit.radius;
                    if (flared[k].since === null && ratio > 1.2) flared[k].since = struck.world.time;
                }
            }
        }
        const reached = flared.filter((entry) => entry.radius !== undefined).sort((a, b) => a.radius - b.radius);
        expect(reached.length).toBeGreaterThanOrEqual(standing - 1);
        for (const entry of reached) {
            expect(entry.most).toBeGreaterThan(1.2);
            expect(entry.since).toBeGreaterThan(10 + ROW_FLIGHT);
        }
        for (let i = 1; i < reached.length; i++) expect(reached[i].since).toBeGreaterThan(reached[i - 1].since);
        // And it takes the front's colour while it flares: by then every shell is back to its own.
        run(struck.world, struck.camera, 25, 500);
        run(calm.world, calm.camera, 25, 500);
        for (let k = 0; k < standing; k++) {
            const lit = shellRow(struck.world, k);
            const dark = shellRow(calm.world, k);
            expect(lit.gain).toBeCloseTo(dark.gain, 6);
            lit.rgb.forEach((channel, c) => expect(channel).toBeCloseTo(dark.rgb[c], 6));
        }
        struck.world.dispose();
        calm.world.dispose();
    });

    it('flares the ring as a front passes through it', () => {
        const { camera, world } = makeWorld('High');
        expect(world.u.ring.value.y).toBe(0);
        world.onClear({ rows: bottom(2), lines: 2 });
        let most = 0;
        let when = 0;
        run(world, camera, 1.5, 180, () => {
            if (world.u.ring.value.y > most) {
                most = world.u.ring.value.y;
                when = world.time;
            }
        });
        expect(most).toBeGreaterThan(0);
        // It flares after the rows arrive, while the first front is still near the star.
        expect(when).toBeGreaterThan(10 + ROW_FLIGHT);
        expect(when).toBeLessThan(10 + ROW_FLIGHT + 1);
        run(world, camera, 25, 500);
        expect(world.u.ring.value.y).toBeCloseTo(0, 6);
        world.dispose();
    });

    it('winds the corona up on a T-spin and lets it spring back', () => {
        const { camera, world } = makeWorld('High');
        const calm = makeWorld('High');
        calm.world.setReducedMotion(true);
        const landings = watchLandings(world);
        for (const made of [{ camera, world }, calm]) made.world.onClear({ rows: bottom(2), lines: 2, tspin: true });
        // Nothing winds until the rows arrive: the corona, its thin front and the sky all answer
        // with the shock, not with the clear.
        run(world, camera, ROW_FLIGHT - 0.02);
        expect(world.getState()).toMatchObject({ twist: 0, storm: 0, counts: { fronts: 0 } });
        expect(world.u.skyPulse.value).toBe(0);
        let wound = 0;
        let woundCalm = 0;
        run(world, camera, 1, 120, () => {
            wound = Math.max(wound, Math.abs(world.u.twist.value));
        });
        run(calm.world, calm.camera, 1, 120, () => {
            woundCalm = Math.max(woundCalm, Math.abs(calm.world.u.twist.value));
        });
        expect(wound).toBeGreaterThan(0.05);
        expect(Math.abs(world.getState().twist)).toBeLessThan(wound);
        // Reduced motion winds it far less.
        expect(woundCalm).toBeGreaterThan(0);
        expect(woundCalm).toBeLessThan(wound * 0.2);
        // One thin front more than the two lines send, born with them as the rows arrive.
        expect(landings.map((landing) => landing.name)).toEqual(['shock']);
        expect(world.getState().counts.fronts).toBe(3);
        const born = world.fronts
            .filter((front) => front.strength > 0)
            .map((front) => front.birth)
            .sort((a, b) => a - b);
        expect(born[0]).toBeCloseTo(10 + ROW_FLIGHT, 9);
        expect(born[1]).toBeCloseTo(10 + ROW_FLIGHT, 9);
        expect(born[2]).toBeCloseTo(10 + ROW_FLIGHT + FRONT_GAP, 9);
        run(world, camera, 6);
        expect(Math.abs(world.getState().twist)).toBeLessThan(1e-3);
        expect(Math.abs(world.u.twist.value)).toBeLessThan(1e-3);
        // A long frame cannot blow the spring up.
        world.onClear({ lines: 1, tspin: true });
        run(world, camera, 30, 6);
        expect(Math.abs(world.getState().twist)).toBeLessThan(1);
        world.dispose();
        calm.world.dispose();
    });

    it('keeps a clear\'s fronts running when the echoes of later locks need slots: the faintest gives way', () => {
        const { camera, world } = makeWorld('High');
        const t0 = world.time;
        const arrive = t0 + ROW_FLIGHT;
        const ofTheClear = () => world.fronts.filter((front) => front.strength > 0
            && front.birth >= arrive - 1e-9 && front.birth <= arrive + 2 * FRONT_GAP + 1e-9);
        world.onLock({
            u: 0.3, rows: [19, 18, 17], hardDrop: true, color: '#ff0033',
        });
        world.onClear({ rows: bottom(3), lines: 3 });
        // Hard drop after hard drop: three echoes each, more than there are slots for.
        for (let i = 0; i < 4; i++) {
            run(world, camera, 0.35);
            world.onLock({
                u: 0.6, rows: [19], hardDrop: true, color: '#00ff88',
            });
        }
        run(world, camera, 0.2);
        // 1.6 s after the clear its three fronts still carry most of their light, and are still there.
        expect(world.getState().counts.fronts).toBeGreaterThan(world.fronts.length);
        expect(ofTheClear()).toHaveLength(3);
        for (const front of ofTheClear()) {
            expect(world.frontLight(front, world.time)).toBeGreaterThan(front.strength * 0.3);
        }
        // A front not yet born is not taken for a dead one: the shock's later fronts wait their
        // turn while a run of weaker fronts, more than there is room for, is sent past them.
        settle(world, camera, 10);
        world.onClear({ rows: bottom(3), lines: 3, tspin: true });
        run(world, camera, ROW_FLIGHT + 0.02);
        expect(world.fronts.filter((front) => front.birth > world.time)).toHaveLength(2);
        const sent = world.fronts
            .filter((front) => front.strength > 0)
            .map((front) => `${front.birth}/${front.strength}`);
        expect(sent).toHaveLength(4);
        for (let i = 0; i < world.fronts.length; i++) {
            world.onCombo(3);
            world.onCombo(0);
        }
        run(world, camera, 3 * FRONT_GAP);
        const left = world.fronts.map((front) => `${front.birth}/${front.strength}`);
        for (const front of sent) expect(left).toContain(front);
        world.dispose();
    });

    it('drops a newcomer fainter than every front already running, and puts none out for it', () => {
        const { camera, world } = makeWorld('High');
        const light = (front) => (front.birth > world.time ? front.strength : world.frontLight(front, world.time));
        const running = () => world.fronts.map((front) => `${front.birth}/${front.strength}`);
        // With room to spare even the faintest front is sent.
        world.front({ birth: world.time, strength: 0.02, rgb: [1, 1, 1] });
        expect(world.getState().counts.fronts).toBe(1);
        // Every slot taken by a bright front, each a little brighter than the last.
        settle(world, camera, 10);
        for (let i = 0; i < world.fronts.length; i++) {
            world.front({ birth: world.time, strength: 1 + i * 0.1, rgb: [1, 1, 1] });
        }
        run(world, camera, 0.1);
        const faintest = Math.min(...world.fronts.map(light));
        expect(faintest).toBeGreaterThan(0.5);
        const before = running();
        const sent = world.getState().counts.fronts;
        expect(sent).toBe(world.fronts.length);
        expect(new Set(before).size).toBe(world.fronts.length);
        // Fainter than all of them: not sent, not counted, and nothing is put out for it.
        world.front({ birth: world.time, strength: faintest * 0.5, rgb: [0, 1, 0] });
        expect(running()).toEqual(before);
        expect(world.getState().counts.fronts).toBe(sent);
        // Through gameplay too: a chain breaking sends a soft front, fainter than these.
        world.onCombo(2);
        world.onCombo(0);
        expect(running()).toEqual(before);
        expect(world.getState().counts.fronts).toBe(sent);
        // One brighter than the faintest takes the faintest's place, and only its place.
        const weakest = world.fronts.find((front) => light(front) === faintest);
        const gone = `${weakest.birth}/${weakest.strength}`;
        world.front({ birth: world.time, strength: faintest * 1.5, rgb: [1, 0, 0] });
        const after = running();
        expect(after).not.toContain(gone);
        expect(after.filter((front) => !before.includes(front))).toHaveLength(1);
        expect(before.filter((front) => !after.includes(front))).toEqual([gone]);
        expect(weakest.rgb).toEqual([1, 0, 0]);
        expect(world.getState().counts.fronts).toBe(sent + 1);
        expect(world.getState().shells).toBeLessThanOrEqual(SHELL_ROWS);
        world.dispose();
    });
});

describe('supernova world: four lines', () => {
    it('falls in on itself, detonates, and leaves a pulsar while a new star kindles', () => {
        const { camera, world } = makeWorld('High');
        const promises = watchPromises(world);
        const landings = watchLandings(world);
        const standing = world.tier.shells;
        // Something for the detonation to take with it: a lock's mark and its prominence.
        world.onLock({ u: 0.4, rows: [19], color: '#ff00ff' });
        run(world, camera, 1.2);
        expect(world.u.impactC.some((slot) => slot.value.w > 0)).toBe(true);
        expect(world.getState().loops).toBeGreaterThan(0);
        const rest = world.getState();
        const restPost = { ...world.getPostState() };
        expect(world.canDetonate()).toBe(true);

        const t0 = world.time;
        world.onClear({ rows: bottom(4), lines: 4 });
        const arrive = t0 + ROW_FLIGHT;
        const flashAt = arrive + COLLAPSE_HOLD;
        // The four rows go in; the star is promised a detonation, not a shock.
        expect(streamsOf(world).filter((stream) => stream.kind === 1)).toHaveLength(4);
        expect(promises.at(-1).time).toBeCloseTo(flashAt, 9);
        // The flash to come is kept apart from the last one: nothing has happened to the star yet.
        expect(world.nova.next).toBeCloseTo(flashAt, 9);
        expect(world.nova.birth).toBeLessThan(0);
        expect(world.canDetonate()).toBe(false);
        expect(world.getState().novaAge).toBeGreaterThan(1000);

        // Until the rows arrive the star is whole.
        runTo(world, camera, arrive - 0.01);
        expect(world.getPostState().fall).toBe(0);
        expect(world.getState().starRadius / rest.starRadius).toBeGreaterThan(0.97);
        expect(world.getState().counts.novas).toBe(0);

        // The fall: it shrinks faster and faster, the nebula holds its breath, the picture is drawn in.
        let radius = world.getState().starRadius;
        let fall = 0;
        const frames = Math.round((COLLAPSE_HOLD - 0.03) * 120);
        run(world, camera, COLLAPSE_HOLD - 0.03, frames, () => {
            const now = world.getState();
            expect(now.starRadius).toBeLessThan(radius);
            radius = now.starRadius;
            const pull = world.getPostState().fall;
            expect(pull).toBeGreaterThanOrEqual(fall);
            fall = pull;
            expect(fall).toBeLessThanOrEqual(1);
            expect(now.counts.novas).toBe(0);
        });
        expect(radius).toBeLessThan(rest.starRadius * 0.6);
        expect(fall).toBeGreaterThan(0.5);
        expect(world.getState().breath).toBeLessThan(0.5);
        expect(world.u.breath.value).toBe(world.getState().breath);
        expect(world.getPostState().rays).toBeLessThan(restPost.rays);
        expect(landings.filter((landing) => landing.name === 'detonate')).toEqual([]);

        // The flash.
        runTo(world, camera, flashAt + 0.02);
        const flashes = landings.filter((landing) => landing.name === 'detonate');
        expect(flashes).toHaveLength(1);
        expect(flashes[0].time).toBeCloseTo(flashAt, 9);
        const birth = flashes[0].time;
        const now = world.getState();
        expect(now.counts).toMatchObject({ novas: 1, clears: 1, aftershocks: 0 });
        // Now it has happened: the flash is the star's last, and none is to come.
        expect(world.nova.birth).toBe(birth);
        expect(world.nova.next).toBe(Infinity);
        expect(now.novaAge).toBeGreaterThanOrEqual(0);
        expect(now.novaAge).toBeLessThan(0.1);
        expect(now.starRadius).toBeLessThan(rest.starRadius * 0.4);
        expect(now.surge).toBeGreaterThan(0);
        const post = world.getPostState();
        expect(post.fall).toBe(0);
        expect(post.flash).toBeGreaterThan(0.6);
        expect(post.kick).toBeGreaterThan(0.6);
        expect(post.exposure).toBeLessThan(restPost.exposure);
        expect(post.exposure).toBeGreaterThan(0);
        // Its fireball is in the table (behind the fronts it sent), and its echo is on the far clouds.
        expect(now.shells).toBeGreaterThanOrEqual(standing + BLAST_SHELLS);
        expect(now.shells).toBeLessThanOrEqual(SHELL_ROWS);
        const blast = Array.from({ length: BLAST_SHELLS }, (_, j) => shellRow(world, now.shells - BLAST_SHELLS + j));
        for (let j = 1; j < BLAST_SHELLS; j++) expect(blast[j].radius).toBeGreaterThan(blast[j - 1].radius);
        for (const shell of blast) expect(shell.gain).toBeGreaterThan(0);
        expect(world.u.echo.value.x).toBe(birth);
        expect(world.u.echo.value.y).toBeGreaterThan(0);
        // The old star's surface is gone, and its prominences with it.
        for (const slot of world.u.impactC) expect(slot.value.w).toBe(0);
        expect(world.u.impactsLive.value).toBe(0);
        expect(now.loops).toBe(0);
        // Most of the ejecta pool is thrown at once.
        const thrown = sparkBirths(world).filter((time) => time >= birth - 1e-4 && time <= birth + 0.5);
        expect(thrown.length).toBeGreaterThan(world.sparks.count * 0.5);
        expect(thrown.length).toBeLessThanOrEqual(world.sparks.count);
        // No pulsar inside the flash.
        expect(world.u.pulsar.value.x).toBe(0);

        // The blast wave bends the picture, running out from the star.
        run(world, camera, 0.3);
        const ripple = { ...world.getPostState().ripple };
        expect(ripple.strength).toBeGreaterThan(0);
        expect(ripple.radius).toBeGreaterThan(0);
        run(world, camera, 0.3);
        expect(world.getPostState().ripple.radius).toBeGreaterThan(ripple.radius);
        expect(world.getPostState().heart).toBe(world.heart);

        // What is left is a pulsar, sweeping, while the new star swells back.
        runTo(world, camera, birth + 1.5);
        expect(world.u.pulsar.value.x).toBeGreaterThan(0);
        const phase = world.u.pulsar.value.y;
        let last = world.getState().starRadius;
        const samples = [];
        runTo(world, camera, birth + REKINDLE, () => samples.push(world.getState().starRadius));
        expect(world.u.pulsar.value.y).toBeGreaterThan(phase);
        for (let i = 30; i < samples.length; i += 30) {
            expect(samples[i]).toBeGreaterThan(last - 0.02);
            last = samples[i];
        }
        expect(world.getState().starRadius / rest.starRadius).toBeGreaterThan(0.94);
        expect(world.getState().starRadius / rest.starRadius).toBeLessThan(1.06);
        // The star has its own prominences again.
        expect(world.getState().loops).toBeGreaterThan(0);
        runTo(world, camera, birth + REKINDLE + 1);
        expect(world.u.pulsar.value.x).toBe(0);
        // Long after, nothing of it is left in the nebula or in the picture.
        runTo(world, camera, birth + 40);
        expect(world.getState().shells).toBe(standing);
        expect(world.getPostState().ripple.strength).toBeLessThan(1e-6);
        expect(world.getPostState().exposure).toBeCloseTo(1, 3);
        expect(world.getState().surge).toBeLessThan(1e-3);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('answers a second four lines too soon with an aftershock, and goes off again once it has rearmed', () => {
        const { camera, world } = makeWorld('High');
        const landings = watchLandings(world);
        world.onClear({ rows: bottom(4), lines: 4 });
        run(world, camera, 1);
        expect(world.getState().counts.novas).toBe(1);
        const { birth } = world.nova;
        const { fronts } = world.getState().counts;
        // Three seconds on: no second fall, a shock of four fronts instead.
        runTo(world, camera, birth + 3);
        world.onClear({ rows: bottom(4), lines: 4 });
        expect(world.nova).toMatchObject({ birth, next: Infinity });
        run(world, camera, 1.5);
        expect(landings.map((landing) => landing.name)).toEqual(['detonate', 'shock']);
        expect(landings[1].lines).toBe(4);
        expect(world.getState().counts).toMatchObject({
            novas: 1, aftershocks: 1, clears: 2, fronts: fronts + 4,
        });
        expect(world.getPostState().fall).toBe(0);
        // Just short of the rearm it is still an aftershock; past it, the star goes off again.
        runTo(world, camera, birth + NOVA_REARM - 0.5);
        expect(world.canDetonate()).toBe(false);
        world.onClear({ lines: 4 });
        run(world, camera, 1);
        expect(world.getState().counts).toMatchObject({ novas: 1, aftershocks: 2 });
        expect(world.canDetonate()).toBe(true);
        world.onClear({ lines: 4 });
        expect(world.canDetonate()).toBe(false);
        run(world, camera, 1);
        expect(world.getState().counts).toMatchObject({ novas: 2, aftershocks: 2, clears: 4 });
        expect(landings.map((landing) => landing.name)).toEqual(['detonate', 'shock', 'shock', 'detonate']);
        world.dispose();
    });

    it('goes off on a perfect clear of any size, harder than on four lines', () => {
        const perfect = makeWorld('Low');
        const plain = makeWorld('Low');
        const blasts = [perfect, plain].map(({ world }) => watchLandings(world));
        perfect.world.onClear({ rows: [19], lines: 1, perfect: true });
        plain.world.onClear({ rows: bottom(4), lines: 4 });
        expect(streamsOf(perfect.world)).toHaveLength(1);
        run(perfect.world, perfect.camera, 1);
        run(plain.world, plain.camera, 1);
        expect(blasts[0].map((landing) => landing.name)).toEqual(['detonate']);
        expect(blasts[1].map((landing) => landing.name)).toEqual(['detonate']);
        expect(blasts[0][0].amount).toBeGreaterThan(blasts[1][0].amount);
        expect(perfect.world.u.echo.value.y).toBeGreaterThan(plain.world.u.echo.value.y);
        expect(perfect.world.getState().surge).toBeGreaterThan(plain.world.getState().surge);
        // A T-spin on the same clear winds the corona with the flash, not during the hush before it.
        const both = makeWorld('Low');
        const winds = watchLandings(both.world);
        both.world.onClear({
            lines: 4, tspin: true, perfect: true,
        });
        const flashAt = both.world.nova.next;
        runTo(both.world, both.camera, flashAt - 0.01);
        expect(both.world.getState()).toMatchObject({ twist: 0, storm: 0 });
        let wound = 0;
        run(both.world, both.camera, 1, 60, () => {
            wound = Math.max(wound, Math.abs(both.world.getState().twist));
        });
        expect(wound).toBeGreaterThan(0.05);
        expect(winds.map((landing) => landing.name)).toEqual(['detonate']);
        expect(both.world.getState().counts.novas).toBe(1);
        // Its thin front leaves with the flash's three.
        expect(both.world.fronts.filter((front) => front.birth === flashAt)).toHaveLength(2);
        expect(both.world.getState().counts.fronts).toBe(4);
        perfect.world.dispose();
        plain.world.dispose();
        both.world.dispose();
    });

    it('falls from the size it has when it goes off again while still kindling', () => {
        const { camera, world } = makeWorld('High');
        world.onClear({ lines: 4 });
        const first = world.nova.next;
        runTo(world, camera, first + NOVA_REARM + 0.5);
        expect(world.nova).toMatchObject({ birth: first, next: Infinity });
        const before = {
            radius: world.getState().starRadius, pulsar: world.u.pulsar.value.x, heat: world.u.heat.value,
        };
        expect(before.radius).toBeLessThan(0.9);
        expect(before.pulsar).toBeGreaterThan(0);
        const t0 = world.time;
        world.onClear({ lines: 4 });
        // The last flash is still the last flash: the next one is kept beside it.
        const second = world.nova.next;
        expect(second).toBeCloseTo(t0 + ROW_FLIGHT + COLLAPSE_HOLD, 9);
        expect(world.nova.birth).toBe(first);
        run(world, camera, 1 / 60, 1);
        // One frame on, before the rows have even arrived, nothing has jumped.
        expect(Math.abs(world.getState().starRadius - before.radius)).toBeLessThan(0.02);
        expect(world.u.pulsar.value.x).toBeGreaterThan(before.pulsar * 0.9);
        expect(world.u.heat.value).toBeGreaterThan(before.heat * 0.9);
        // It keeps kindling until the rows arrive, then falls from the size it has: never a jump,
        // up or down, and the pulsar sweeps until the star it is in goes off.
        let radius = world.getState().starRadius;
        let step = 0;
        let most = radius;
        const watchSize = () => {
            const now = world.getState().starRadius;
            step = Math.max(step, Math.abs(now - radius));
            most = Math.max(most, now);
            radius = now;
        };
        const until = (time) => run(world, camera, time - world.time, Math.round((time - world.time) * 120), watchSize);
        until(second - 0.01);
        expect(world.getState().counts.novas).toBe(1);
        expect(world.u.pulsar.value.x).toBeGreaterThan(0);
        expect(radius).toBeLessThan(before.radius * 0.5);
        until(second + 0.1);
        expect(world.getState().counts.novas).toBe(2);
        expect(world.nova).toMatchObject({ birth: second, next: Infinity });
        expect(world.u.pulsar.value.x).toBe(0);
        expect(step).toBeLessThan(0.08);
        expect(most).toBeLessThan(before.radius + 0.03);
        world.dispose();
    });

    it('counts the aftershock of a perfect clear of any size', () => {
        const { camera, world } = makeWorld('Low');
        world.onClear({ lines: 4 });
        run(world, camera, 3);
        world.onClear({ lines: 1, perfect: true });
        run(world, camera, 1);
        expect(world.getState().counts).toMatchObject({ novas: 1, aftershocks: 1 });
        // A plain clear in the same window is a shock, not an aftershock.
        world.onClear({ lines: 3 });
        run(world, camera, 1);
        expect(world.getState().counts).toMatchObject({ novas: 1, aftershocks: 1, clears: 3 });
        world.dispose();
    });
});

describe('supernova world: the chain', () => {
    it('heats the star with the chain and cools it when the chain breaks', () => {
        const { camera, world } = makeWorld('High');
        world.onCombo(5);
        const target = heatForCombo(5);
        let { heat } = world.getState();
        run(world, camera, 1.5, 90, () => {
            const now = world.getState().heat;
            expect(now).toBeGreaterThan(heat);
            expect(now).toBeLessThanOrEqual(target);
            expect(world.u.heat.value).toBeGreaterThanOrEqual(now);
            heat = now;
        });
        run(world, camera, 4);
        expect(world.getState().heat).toBeCloseTo(target, 3);
        // A hot star turns and boils faster, and the iris closes a little.
        const turned = world.getState().spin;
        run(world, camera, 2);
        expect(world.getState().spin - turned).toBeGreaterThan(2 * STAR.spin * 1.2);
        expect(world.getPostState().exposure).toBeLessThan(1);
        expect(world.u.coronaGain.value).toBeGreaterThan(1);
        // A longer chain is hotter still; a broken one cools, more slowly than it heated.
        world.onCombo(7);
        run(world, camera, 4);
        expect(world.getState().heat).toBeCloseTo(heatForCombo(7), 3);
        world.onCombo(0);
        ({ heat } = world.getState());
        run(world, camera, 1.5, 90, () => {
            const now = world.getState().heat;
            expect(now).toBeLessThan(heat);
            expect(now).toBeGreaterThanOrEqual(0);
            heat = now;
        });
        expect(heat).toBeGreaterThan(heatForCombo(7) * 0.1);
        run(world, camera, 12);
        expect(world.getState().heat).toBeLessThan(0.01);
        world.dispose();
    });

    it('lights one more bead for every step, spread round the ring, and never more than it has', () => {
        const { camera, world } = makeWorld('High');
        const lit = () => world.u.beadRows.map((row, i) => (row.w > 0.5 ? i : -1)).filter((i) => i >= 0);
        const frame = () => world.update({ time: world.time, delta: 0 }, camera);
        frame();
        expect(lit()).toEqual([]);
        const order = [];
        let last = [];
        const newly = (now, before) => now.filter((bead) => !before.includes(bead));
        for (let combo = 1; combo <= RING.beads + 3; combo++) {
            world.onCombo(combo);
            frame();
            const now = lit();
            expect(now).toHaveLength(Math.min(combo, RING.beads));
            expect(world.getState().beads).toBe(now.length);
            // Every bead lit before is still lit.
            for (const bead of last) expect(now).toContain(bead);
            const fresh = newly(now, last);
            if (combo <= RING.beads) {
                expect(fresh).toHaveLength(1);
                order.push(fresh[0]);
            } else expect(fresh).toEqual([]);
            // A short chain is already spread round the ring: no two of its beads are neighbours.
            if (combo >= 2 && combo <= 5) {
                for (const a of now) {
                    for (const b of now) {
                        const apart = Math.abs(a - b) % RING.beads;
                        if (a !== b) expect(Math.min(apart, RING.beads - apart)).toBeGreaterThan(1);
                    }
                }
            }
            last = now;
        }
        expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: RING.beads }, (_, i) => i));
        // A full ring flares.
        const full = world.u.ring.value.y;
        world.seek(10);
        world.onCombo(RING.beads - 1);
        frame();
        expect(world.u.ring.value.y).toBeLessThan(full);
        // Every bead has a colour, whether lit or not.
        for (const row of world.u.beadRows) {
            expect(Math.max(row.x, row.y, row.z)).toBeGreaterThan(0);
            expect(Number.isFinite(row.w)).toBe(true);
        }
        world.dispose();
    });

    it('lights its beads at once and lets them go out one after another, the last lit first', () => {
        const { camera, world } = makeWorld('High', { capture: false });
        // Which bead each step lights, from a frozen capture of the same ring.
        const still = makeWorld('High');
        const order = [];
        for (let combo = 1; combo <= 5; combo++) {
            still.world.onCombo(combo);
            still.world.update({ time: 10, delta: 0 }, still.camera);
            const now = still.world.u.beadRows.map((row, i) => (row.w > 0.5 ? i : -1)).filter((i) => i >= 0);
            order.push(now.find((bead) => !order.includes(bead)));
        }
        still.world.dispose();
        world.onCombo(5);
        expect(world.getState().beads).toBe(0);
        run(world, camera, 0.5);
        expect(world.getState().beads).toBe(5);
        world.onCombo(0);
        const went = new Map();
        run(world, camera, 3, 360, () => {
            for (const bead of order) if (!went.has(bead) && world.beadLit[bead] < 0.5) went.set(bead, world.time);
        });
        expect(went.size).toBe(5);
        for (let step = 1; step < order.length; step++) {
            expect(went.get(order[step]), `step ${step + 1}`).toBeLessThan(went.get(order[step - 1]));
        }
        expect(world.getState().beads).toBe(0);
        world.dispose();
    });

    it('throws up a prominence on every step of a chain and lets its breath go when the chain breaks', () => {
        const { camera, world } = makeWorld('High');
        const standing = world.tier.shells;
        const raisedAt = (time) => loopsOf(world).filter((loop) => Math.abs(loop.time - time) < 1e-4).length;
        // The first clear of a chain is not yet a chain.
        world.onCombo(1);
        expect(raisedAt(world.time)).toBe(0);
        run(world, camera, 0.5);
        world.onCombo(2);
        expect(raisedAt(world.time)).toBe(1);
        run(world, camera, 0.5);
        world.onCombo(3);
        expect(raisedAt(world.time)).toBe(1);
        // Told the same step again, or a lower one, it does nothing.
        const loops = loopsOf(world).length;
        world.onCombo(3);
        world.onCombo(2);
        expect(loopsOf(world)).toHaveLength(loops);
        run(world, camera, 1);
        expect(world.getState().counts.fronts).toBe(0);
        // The chain breaks: one soft front, and every light dips for a moment.
        const t0 = world.time;
        world.onCombo(0);
        expect(world.getState().counts.fronts).toBe(1);
        expect(world.fronts.filter((front) => front.strength > 0).map((front) => front.birth)).toEqual([t0]);
        let least = 1;
        run(world, camera, 0.5, 60, () => {
            least = Math.min(least, world.getState().breath);
        });
        expect(least).toBeLessThan(0.95);
        expect(least).toBeGreaterThan(0.5);
        expect(world.getState().shells).toBe(standing + 1);
        run(world, camera, 4);
        expect(world.getState().breath).toBeCloseTo(1, 4);
        // A chain of one that ends is not a chain breaking.
        world.onCombo(1);
        world.onCombo(0);
        expect(world.getState().counts.fronts).toBe(1);
        world.dispose();
    });

    it('goes off by itself when the chain reaches its critical step, once', () => {
        const { camera, world } = makeWorld('High');
        const promises = watchPromises(world);
        const landings = watchLandings(world);
        for (let combo = 1; combo < CRITICAL_COMBO; combo++) {
            world.onCombo(combo);
            run(world, camera, 0.3);
        }
        expect(promises).toEqual([]);
        expect(world.canDetonate()).toBe(true);
        const t0 = world.time;
        world.onCombo(CRITICAL_COMBO);
        expect(promises).toHaveLength(1);
        expect(promises[0].time).toBeCloseTo(t0 + COLLAPSE_HOLD, 9);
        expect(world.canDetonate()).toBe(false);
        // The chain goes on: the star has already been set off.
        for (let combo = CRITICAL_COMBO + 1; combo <= CRITICAL_COMBO + 4; combo++) {
            world.onCombo(combo);
            run(world, camera, 0.3);
        }
        expect(promises).toHaveLength(1);
        expect(landings.map((landing) => landing.name)).toEqual(['detonate']);
        expect(world.getState().counts.novas).toBe(1);
        // It breaks and is built again before the star has rearmed: nothing.
        world.onCombo(0);
        world.onCombo(CRITICAL_COMBO);
        run(world, camera, 1);
        expect(world.getState().counts.novas).toBe(1);
        // And again once it has: a second detonation.
        runTo(world, camera, world.nova.birth + NOVA_REARM + 0.2);
        world.onCombo(0);
        world.onCombo(CRITICAL_COMBO);
        run(world, camera, 1);
        expect(world.getState().counts.novas).toBe(2);
        world.dispose();
    });

    it('waits for the rows of the clear that set it off, and gives that clear\'s shock up for the flash', () => {
        const { camera, world } = makeWorld('High');
        const promises = watchPromises(world);
        const landings = watchLandings(world);
        world.onCombo(CRITICAL_COMBO - 1);
        run(world, camera, 3);
        // As the director delivers them: the clear, then the chain's new length.
        const t0 = world.time;
        world.onClear({ rows: bottom(2), lines: 2 });
        expect(world.getState().pending).toBe(1); // its shock
        world.onCombo(CRITICAL_COMBO);
        // The shock is given up: the one thing due is the flash, a fall after the rows arrive.
        const flashAt = t0 + ROW_FLIGHT + COLLAPSE_HOLD;
        expect(world.getState().pending).toBe(1);
        expect(promises).toHaveLength(2);
        expect(promises[1].time).toBeCloseTo(flashAt, 9);
        expect(world.nova.next).toBeCloseTo(flashAt, 9);
        expect(world.canDetonate()).toBe(false);
        // Nothing falls while the rows are in flight...
        runTo(world, camera, t0 + ROW_FLIGHT - 0.01, () => {
            expect(world.getPostState().fall).toBe(0);
        });
        expect(world.getState().starRadius).toBeGreaterThan(0.95);
        // ...then it falls, in a hush nothing breaks...
        let pull = 0;
        runTo(world, camera, flashAt - 0.01, () => {
            pull = Math.max(pull, world.getPostState().fall);
            expect(landings).toEqual([]);
        });
        expect(pull).toBeGreaterThan(0.5);
        expect(world.getState().counts.fronts).toBe(0);
        // ...and goes off: the flash is the clear's whole answer.
        run(world, camera, 0.5);
        expect(landings.map((landing) => landing.name)).toEqual(['detonate']);
        expect(landings[0].time).toBeCloseTo(flashAt, 9);
        expect(world.getState().counts).toMatchObject({
            novas: 1, clears: 1, aftershocks: 0, fronts: 3,
        });
        // A clear whose rows have already arrived is not waited for, and its shock is not undone.
        runTo(world, camera, world.nova.birth + NOVA_REARM + 0.2);
        world.onCombo(0);
        world.onCombo(CRITICAL_COMBO - 1);
        landings.length = 0;
        world.onClear({ rows: bottom(1), lines: 1 });
        run(world, camera, ROW_FLIGHT + 0.05);
        expect(landings.map((landing) => landing.name)).toEqual(['shock']);
        world.onCombo(CRITICAL_COMBO);
        expect(world.nova.next).toBeCloseTo(world.time + COLLAPSE_HOLD, 9);
        run(world, camera, 1);
        expect(landings.map((landing) => landing.name)).toEqual(['shock', 'detonate']);
        expect(world.getState().counts.novas).toBe(2);
        world.dispose();
    });

    /**
     * Fault in the fix for the critical chain: the shock it cancels carried the T-spin's flag, and
     * beginCollapse() is called there without `twist`. A T-spin that takes the chain to its
     * critical step never winds the corona: no twist, no thin front, no answer from the sky.
     * Carry the cancelled shock's FLAG_TSPIN into beginCollapse(…, 1.15, twist).
     */
    it('still winds the corona when the clear that reaches the critical step is a T-spin', () => {
        const { camera, world } = makeWorld('High');
        world.onCombo(CRITICAL_COMBO - 1);
        run(world, camera, 3);
        world.onClear({ rows: bottom(2), lines: 2, tspin: true });
        world.onCombo(CRITICAL_COMBO);
        let wound = 0;
        run(world, camera, 1.5, 180, () => {
            wound = Math.max(wound, Math.abs(world.getState().twist));
        });
        expect(world.getState().counts.novas).toBe(1);
        expect(wound).toBeGreaterThan(0.05);
        // The flash's three fronts and the T-spin's thin one.
        expect(world.getState().counts.fronts).toBe(4);
        world.dispose();
    });

    it('holds a chain silently for a capture: its heat and its beads, with nothing happening', () => {
        const { camera, world } = makeWorld('High');
        const promises = watchPromises(world);
        const held = CRITICAL_COMBO + 2;
        const arches = loopsOf(world).length;
        world.onCombo(held, { silent: true });
        expect(world.getState().combo).toBe(held);
        // No pulse, no flash, no arch; and however long the chain, the star is not set off.
        expect(promises).toEqual([]);
        expect(world.canDetonate()).toBe(true);
        expect(world.nova.next).toBe(Infinity);
        expect(loopsOf(world)).toHaveLength(arches);
        world.update({ time: world.time, delta: 0 }, camera);
        expect(world.getState()).toMatchObject({
            heat: heatForCombo(held), beads: Math.min(RING.beads, held), pulse: 0, counts: { fronts: 0 },
        });
        expect(world.getPostState().flash).toBe(0);
        run(world, camera, 9, 90);
        expect(world.getState().counts.novas).toBe(0);
        expect(world.getState().starRadius).toBeGreaterThan(0.9);
        expect(world.u.pulsar.value.x).toBe(0);
        // Letting it go silently is silent too: no parting front, no dip.
        world.onCombo(0, { silent: true });
        expect(world.getState()).toMatchObject({ combo: 0, counts: { fronts: 0 } });
        world.onCombo('x', { silent: true });
        world.onCombo(-4, { silent: true });
        expect(world.getState().combo).toBe(0);
        // The same call without the flag is the event: this chain sets the star off.
        world.onCombo(held);
        expect(promises).toHaveLength(1);
        expect(world.canDetonate()).toBe(false);
        world.dispose();
    });
});

describe('supernova world: levels', () => {
    it('burns the next element on a level change and eases the picture into its colours', () => {
        const { camera, world } = makeWorld('High');
        const [first, second] = SUPERNOVA_PALETTES;
        expect(world.getState()).toMatchObject({ level: 1, palette: first.name });
        world.u.gasA.value.toArray().forEach((channel, c) => expect(channel).toBeCloseTo(first.gasA[c], 9));
        world.levelUp(2);
        expect(world.getState()).toMatchObject({ level: 2, palette: second.name });
        // A front leaves in the new element's colour, and the sky answers.
        expect(world.getState().counts.fronts).toBe(1);
        expect(world.fronts.find((front) => front.strength > 0).rgb).toEqual(second.rim);
        // The uniforms are on their way, not there yet.
        run(world, camera, 0.5);
        expect(second.gasA[1]).not.toBe(first.gasA[1]);
        const part = (world.u.gasA.value.y - first.gasA[1]) / (second.gasA[1] - first.gasA[1]);
        expect(part).toBeGreaterThan(0.05);
        expect(part).toBeLessThan(0.95);
        expect(world.u.skyPulse.value).toBeGreaterThan(0);
        run(world, camera, 12);
        for (const [key, node] of [['gasA', world.u.gasA], ['starMid', world.u.starMid], ['rim', world.u.rim],
            ['skyB', world.u.skyB], ['void', world.u.voidCol]]) {
            node.value.toArray().forEach((channel, c) => expect(channel, key).toBeCloseTo(second[key][c], 3));
        }
        world.dispose();
    });

    it('changes at once when told to do it silently, cycles through its elements and ignores nonsense', () => {
        const { camera, world } = makeWorld('Low');
        world.levelUp(4, { silent: true });
        world.update({ time: world.time, delta: 0 }, camera);
        const oxygen = SUPERNOVA_PALETTES[3];
        expect(world.getState()).toMatchObject({ level: 4, palette: oxygen.name, counts: { fronts: 0 } });
        for (const [key, node] of [['gasB', world.u.gasB], ['starHot', world.u.starHot], ['skyA', world.u.skyA]]) {
            node.value.toArray().forEach((channel, c) => expect(channel, key).toBeCloseTo(oxygen[key][c], 9));
        }
        expect(world.getState().storm).toBe(0);
        const names = [];
        for (let level = 1; level <= SUPERNOVA_PALETTES.length * 2; level++) {
            world.levelUp(level, { silent: true });
            names.push(world.getState().palette);
        }
        const cycle = SUPERNOVA_PALETTES.map((palette) => palette.name);
        expect(names).toEqual([...cycle, ...cycle]);
        for (const junk of [undefined, null, NaN, 'x', 0, -5]) {
            world.levelUp(junk, { silent: true });
            expect(world.getState()).toMatchObject({ level: 1, palette: cycle[0] });
        }
        world.levelUp('3', { silent: true });
        expect(world.getState().level).toBe(3);
        world.levelUp(2.6, { silent: true });
        expect(world.getState().level).toBe(3);
        world.dispose();
    });

    it('reads a level that is not a finite number as the first, and keeps a huge one in range', () => {
        const { camera, world } = makeWorld('Low');
        expect(() => {
            for (const junk of [Infinity, -Infinity]) {
                world.levelUp(3, { silent: true });
                world.levelUp(junk);
                expect(world.getState()).toMatchObject({ level: 1, palette: SUPERNOVA_PALETTES[0].name });
                world.levelUp(3, { silent: true });
                world.levelUp(junk, { silent: true });
                expect(world.getState()).toMatchObject({ level: 1, palette: SUPERNOVA_PALETTES[0].name });
            }
            world.levelUp(1e300, { silent: true });
            run(world, camera, 0.5);
        }).not.toThrow();
        expect(Number.isSafeInteger(world.getState().level)).toBe(true);
        expect(SUPERNOVA_PALETTES.map((palette) => palette.name)).toContain(world.getState().palette);
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('turns its colours slowly through the cycle with time alone, whatever the level', () => {
        const { camera, world } = makeWorld('Low');
        const [hydrogen, helium, carbon] = SUPERNOVA_PALETTES;
        // It holds a palette for the first part of every turn...
        runTo(world, camera, PALETTE_DRIFT * PALETTE_HOLD * 0.9);
        expect(world.getState()).toMatchObject({ level: 1, palette: hydrogen.name, paletteBlend: 0 });
        world.u.rim.value.toArray().forEach((channel, c) => expect(channel).toBeCloseTo(hydrogen.rim[c], 6));
        // ...then drifts: three quarters through the turn it is between the two, with no event at all.
        runTo(world, camera, PALETTE_DRIFT * 0.75);
        const mid = world.getState();
        expect(mid).toMatchObject({ level: 1, paletteNext: helium.name });
        expect(mid.paletteBlend).toBeGreaterThan(0.2);
        expect(mid.paletteBlend).toBeLessThan(0.95);
        expect(mid.counts).toMatchObject({ locks: 0, clears: 0, fronts: 0 });
        const part = (world.u.rim.value.x - hydrogen.rim[0]) / (helium.rim[0] - hydrogen.rim[0]);
        expect(part).toBeGreaterThan(0.15);
        expect(part).toBeLessThan(0.98);
        // A turn later it rests on the next palette, still on the first level.
        runTo(world, camera, PALETTE_DRIFT * 1.2);
        expect(world.getState()).toMatchObject({
            level: 1, palette: helium.name, paletteNext: carbon.name, paletteBlend: 0,
        });
        world.u.gasB.value.toArray().forEach((channel, c) => expect(channel).toBeCloseTo(helium.gasB[c], 3));
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('never jumps as it drifts: a frame moves no colour by more than a hair', () => {
        const { camera, world } = makeWorld('Low');
        let worst = 0;
        // Through the end of one turn and the start of the next.
        settle(world, camera, PALETTE_DRIFT * 0.9);
        let last = world.u.gasA.value.toArray();
        run(world, camera, PALETTE_DRIFT * 0.3, Math.round(PALETTE_DRIFT * 0.3 * 30), () => {
            const now = world.u.gasA.value.toArray();
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(now[c] - last[c]));
            last = now;
        });
        expect(worst).toBeLessThan(0.01);
        world.dispose();
    });

    it('moves one palette on from wherever time has carried it when the level changes', () => {
        const { camera, world } = makeWorld('Low');
        const names = SUPERNOVA_PALETTES.map((palette) => palette.name);
        settle(world, camera, PALETTE_DRIFT * 2.1); // two turns on: the third palette, at level 1
        expect(world.getState()).toMatchObject({ level: 1, palette: names[2], paletteBlend: 0 });
        world.levelUp(2, { silent: true });
        expect(world.getState()).toMatchObject({ level: 2, palette: names[3] });
        // A new run starts again at level 1 and keeps the hue clock: the colours do not snap back.
        world.resetSession();
        expect(world.getState()).toMatchObject({ level: 1, palette: names[2] });
        world.dispose();
    });
});

describe('supernova world: time', () => {
    const script = (world, camera, fps) => {
        world.onLock({
            u: 0.3, rows: [17, 16], hardDrop: true, color: '#ffc050',
        });
        world.onClear({ rows: bottom(2), lines: 2 });
        world.onCombo(3);
        run(world, camera, 1.5, Math.round(1.5 * fps));
        world.onClear({ rows: bottom(4), lines: 4 });
        world.onCombo(4);
        run(world, camera, 2, Math.round(2 * fps));
        world.onLock({ u: 0.8, rows: [12], color: '#8090e0' });
        world.levelUp(2);
        run(world, camera, 1.5, Math.round(1.5 * fps));
    };
    const POST_KEYS = ['flash', 'kick', 'rays', 'streak', 'bloomBoost', 'exposure', 'fall'];
    const births = (part, name) => used(part, name).map((slot) => instanced(part, name).array[slot * 4 + 3]);
    /** Everything a frame is drawn from. */
    const flat = (value) => (typeof value === 'object' ? Object.values(value) : value);
    const snapshot = (world, camera) => [
        ...Object.values(world.getState()).flatMap(flat),
        ...POST_KEYS.map((key) => world.getPostState()[key]),
        ...Object.values(world.getPostState().ripple),
        ...world.u.impactA.flatMap((slot) => slot.value.toArray()),
        ...world.u.impactC.flatMap((slot) => slot.value.toArray()),
        ...shellTable(world),
        ...world.u.beadRows.flatMap((row) => row.toArray()),
        ...world.fronts.flatMap((front) => [front.birth, front.strength, ...front.rgb]),
        ...world.u.echo.value.toArray(),
        ...world.u.pulsar.value.toArray(),
        ...world.u.ring.value.toArray(),
        ...world.u.starRot.value.toArray(),
        ...world.parts.ring.mesh.matrixWorld.toArray(),
        ...streamsOf(world).flatMap((stream) => [
            ...stream.from, stream.time, ...stream.bow, stream.flight, ...stream.dir, stream.kind, ...stream.rgb,
            stream.size,
        ]),
        ...births(world.sparks, 'aBirth'),
        ...loopsOf(world).flatMap((loop) => [loop.time, ...loop.mid]),
        world.u.heat.value, world.u.starR.value, world.u.boil.value, world.u.flow.value, world.u.breath.value,
        world.u.twist.value, world.u.starGain.value, world.u.coronaGain.value, world.u.haze.value,
        world.flow, world.drift, world.boil,
        ...camera.matrixWorld.toArray(),
    ];

    it('reaches the same state at 30 and at 240 frames a second', () => {
        const slow = makeWorld('Low');
        const fast = makeWorld('Low');
        script(slow.world, slow.camera, 30);
        script(fast.world, fast.camera, 240);
        const a = slow.world.getState();
        const b = fast.world.getState();
        expect(a.time).toBeCloseTo(b.time, 9);
        expect(a.counts).toEqual(b.counts);
        expect(a.counts).toMatchObject({
            locks: 2, clears: 2, novas: 1, impacts: 4,
        });
        expect(a).toMatchObject({
            combo: b.combo, level: b.level, palette: b.palette, shells: b.shells, pending: b.pending, beads: b.beads,
        });
        // What eases toward a target agrees whatever the frame rate.
        for (const key of ['heat', 'breath']) expect(a[key], key).toBeCloseTo(b[key], 3);
        // What an event set and the frames have decayed since is close (how close: see the
        // fault below, which waits on the order update() does things in).
        for (const key of ['surge', 'storm', 'pulse']) expect(a[key], key).toBeCloseTo(b[key], 2);
        expect(a.surge).toBeGreaterThan(0);
        // What is integrated frame by frame is close, not identical.
        for (const key of ['twist', 'spin', 'starRadius']) expect(a[key], key).toBeCloseTo(b[key], 2);
        expect(slow.world.flow / fast.world.flow).toBeCloseTo(1, 1);
        // The afterglow's push on the nebula is integrated exactly: a detonation hurls the
        // shells as far at any frame rate.
        expect(slow.world.drift / fast.world.drift).toBeCloseTo(1, 2);
        expect(slow.world.ringTurn).toBeCloseTo(fast.world.ringTurn, 9);
        expect(a.heart.x).toBeCloseTo(b.heart.x, 3);
        expect(a.heart.y).toBeCloseTo(b.heart.y, 3);
        const postA = slow.world.getPostState();
        const postB = fast.world.getPostState();
        for (const key of POST_KEYS) expect(postA[key], key).toBeCloseTo(postB[key], 2);
        expect(postA.ripple.strength).toBeCloseTo(postB.ripple.strength, 6);
        expect(postA.ripple.radius).toBeCloseTo(postB.ripple.radius, 6);
        // Event slots hold timestamps and places: identical whatever the frame rate.
        for (let i = 0; i < IMPACT_SLOTS; i++) {
            const one = slow.world.u.impactA[i].value.toArray();
            const two = fast.world.u.impactA[i].value.toArray();
            expect(one[3], `impact ${i}`).toBe(two[3]);
            for (let k = 0; k < 3; k++) expect(one[k], `impact ${i}[${k}]`).toBeCloseTo(two[k], 2);
        }
        expect(slow.world.fronts.map((front) => front.birth)).toEqual(fast.world.fronts.map((front) => front.birth));
        expect(slow.world.u.echo.value.toArray()).toEqual(fast.world.u.echo.value.toArray());
        expect(slow.world.nova.birth).toBe(fast.world.nova.birth);
        slow.world.dispose();
        fast.world.dispose();
    });

    /**
     * Fault in the fix that runs the queue first in update(): what an event sets is already as
     * of now (each handler allows for how late the frame noticed it), and the six decays a few
     * lines on then take a whole frame off it again. A detonation landing exactly on a frame
     * shows a flash of 0.875 at 30 frames a second, 0.936 at 60 and 0.984 at 240 (kick 0.81 /
     * 0.90 / 0.97; surge 0.990 / 0.995 / 0.999), and so does every impact, shock and T-spin.
     * Move the six `*= Math.exp(-dt / …)` lines above `this.runPending(t)`: the life-stage
     * reads can stay after it. Allowing for it in detonate() alone would leave the others.
     */
    it('answers an event as strongly whichever frame notices it', () => {
        const flashSeen = (fps) => {
            const { camera, world } = makeWorld('Low');
            const landings = watchLandings(world);
            world.onClear({ lines: 4 });
            let seen = null;
            run(world, camera, 1, fps, () => {
                if (!seen && landings.length) {
                    seen = {
                        late: world.time - landings[0].time, amount: landings[0].amount, surge: world.getState().surge,
                    };
                }
            });
            world.dispose();
            return seen;
        };
        for (const fps of [30, 60, 240]) {
            const seen = flashSeen(fps);
            // The overdrive cools from the flash's own moment, exactly.
            expect(seen.surge, `${fps} fps`).toBeCloseTo(seen.amount * Math.exp(-seen.late / SURGE_COOL), 9);
        }
        // And so the same script leaves the same overdrive at any frame rate.
        const slow = makeWorld('Low');
        const fast = makeWorld('Low');
        script(slow.world, slow.camera, 30);
        script(fast.world, fast.camera, 240);
        expect(slow.world.getState().surge).toBeCloseTo(fast.world.getState().surge, 9);
        expect(slow.world.getState().pulse).toBeCloseTo(fast.world.getState().pulse, 4);
        slow.world.dispose();
        fast.world.dispose();
    });

    it('replays a frame: the same seek and the same steps give the same star on two worlds', () => {
        const one = makeWorld('Medium');
        const two = makeWorld('Medium');
        for (const made of [one, two]) {
            settle(made.world, made.camera, 37);
            script(made.world, made.camera, 60);
        }
        expect(one.world.getState()).toEqual(two.world.getState());
        expect(shellTable(one.world)).toEqual(shellTable(two.world));
        expect(shellTable(one.world).length).toBeGreaterThan(one.world.tier.shells * SHELL_STRIDE * 4 - 1);
        const first = snapshot(one.world, one.camera);
        expect(first.length).toBeGreaterThan(400);
        expect(snapshot(two.world, two.camera)).toEqual(first);
        // Where every prominence stands, too.
        for (const name of ['aFoot', 'aArc', 'aLook', 'aMisc']) {
            const arch = (world) => Array.from(instanced(world.loops, name).array);
            expect(arch(one.world), name).toEqual(arch(two.world));
        }
        one.world.dispose();
        two.world.dispose();
    });

    it('replays a frame on one world whatever came before', () => {
        const { camera, world } = makeWorld('Low');
        script(world, camera, 60);
        const first = snapshot(world, camera);
        // Something else entirely in between...
        world.onCombo(9);
        world.onLock({ u: 0.5, rows: [3], hardDrop: true });
        world.onClear({ lines: 3, tspin: true });
        world.setReducedMotion(true);
        run(world, camera, 3);
        world.setReducedMotion(false);
        // ...then the capture's recipe again.
        settle(world, camera, 10);
        script(world, camera, 60);
        const again = snapshot(world, camera);
        expect(again).toHaveLength(first.length);
        let worst = 0;
        for (let i = 0; i < first.length; i++) {
            if (typeof first[i] === 'number') worst = Math.max(worst, Math.abs(first[i] - again[i]));
            else expect(again[i]).toBe(first[i]);
        }
        expect(worst).toBeLessThan(1e-9);
        world.dispose();
    });

    it('stands the same prominences after a seek whatever the camera did before', () => {
        const fresh = makeWorld('High');
        const worn = makeWorld('High');
        for (let i = 1; i <= 120; i++) {
            const sim = {
                time: 10 + i / 60, delta: 1 / 60, pointerX: 1, pointerY: -1,
            };
            worn.world.updateCamera(worn.camera, sim);
            worn.world.update(sim, worn.camera);
        }
        fresh.world.seek(50);
        worn.world.seek(50);
        // Until a frame says otherwise, the eye is where the rest camera stands.
        const a = loopsOf(fresh.world);
        const b = loopsOf(worn.world);
        expect(a.length).toBeGreaterThan(0);
        expect(b).toHaveLength(a.length);
        a.forEach((loop, i) => {
            expect(b[i].time).toBe(loop.time);
            loop.mid.forEach((component, c) => expect(b[i].mid[c]).toBe(component));
        });
        // The ring is stood the same way too.
        const ringOf = (made) => made.world.parts.ring.mesh.matrixWorld.toArray();
        expect(ringOf(worn)).toEqual(ringOf(fresh));
        fresh.world.dispose();
        worn.world.dispose();
    });

    it('drops every event in flight when it seeks, and puts the star where the clock says', () => {
        const { camera, world } = makeWorld('High');
        const standing = world.tier.shells;
        world.onLock({ u: 0.4, rows: [10], hardDrop: true });
        world.onClear({ lines: 4, tspin: true });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 1);
        expect(world.getState().counts).toMatchObject({ locks: 1, clears: 1, novas: 1 });
        expect(used(world.streams, 'aFrom').length).toBeGreaterThan(0);
        expect(used(world.sparks, 'aBirth').length).toBeGreaterThan(0);
        world.onLock({ u: 0.7, rows: [4] });
        expect(world.getState().pending).toBe(1);

        world.seek(30);
        expect(world.getState()).toMatchObject({
            time: 30,
            combo: 0,
            heat: 0,
            surge: 0,
            storm: 0,
            pulse: 0,
            twist: 0,
            breath: 1,
            level: 1,
            palette: SUPERNOVA_PALETTES[0].name,
            pending: 0,
            beads: 0,
            counts: {
                locks: 0, clears: 0, novas: 0, streams: 0, impacts: 0, fronts: 0, aftershocks: 0,
            },
        });
        expect(world.getState().spin).toBeCloseTo(30 * STAR.spin, 12);
        expect(world.canDetonate()).toBe(true);
        expect(world.nova).toMatchObject({ next: Infinity, twist: false });
        expect(used(world.streams, 'aFrom')).toEqual([]);
        expect(used(world.sparks, 'aBirth')).toEqual([]);
        expect(world.fronts.every((front) => front.strength === 0)).toBe(true);
        for (const slot of world.u.impactA) expect(slot.value.w).toBe(-100);
        for (const slot of world.u.impactC) expect(slot.value.w).toBe(0);
        expect(world.u.echo.value.y).toBe(0);
        // The nebula's table is whole at once, before any frame is drawn: its standing shells.
        expect(world.getState().shells).toBe(standing);
        expect(world.getState().starRadius).toBeGreaterThan(0.95);
        // Only the prominences the star would have of its own stand, each born on its beat before now.
        const loops = loopsOf(world);
        expect(loops.length).toBeGreaterThan(0);
        for (const loop of loops) expect(loop.time).toBeLessThanOrEqual(30);
        // The next frame draws a star at rest.
        world.updateCamera(camera, { time: 30, delta: 0 });
        world.update({ time: 30, delta: 0 }, camera);
        expect(world.getState().shells).toBe(standing);
        expect(world.getState().starRadius).toBeGreaterThan(0.95);
        expect(world.getState().starRadius).toBeLessThan(1.05);
        expect(world.u.pulsar.value.x).toBe(0);
        // The colours are where the hue clock says: just into hydrogen's turn toward helium.
        const [hydrogen, helium] = SUPERNOVA_PALETTES;
        const { blend } = paletteDrift(1, 30);
        expect(blend).toBeGreaterThan(0);
        expect(blend).toBeLessThan(0.05);
        world.u.gasA.value.toArray().forEach((channel, c) => expect(channel)
            .toBeCloseTo(hydrogen.gasA[c] + (helium.gasA[c] - hydrogen.gasA[c]) * blend, 9));
        expect(world.getPostState()).toMatchObject({
            flash: 0, kick: 0, fall: 0, bloomBoost: 0, exposure: 1,
        });
        expect(world.getPostState().ripple.strength).toBe(0);
        // The same events again land as they did the first time: the dice are reset too.
        const fresh = makeWorld('High');
        settle(fresh.world, fresh.camera, 30);
        for (const made of [{ camera, world }, fresh]) {
            made.world.onLock({ u: 0.4, rows: [10], color: '#00ff88' });
            run(made.world, made.camera, 1);
        }
        const impacts = (made) => made.u.impactA.map((slot) => slot.value.toArray());
        expect(impacts(world)).toEqual(impacts(fresh.world));
        // A negative moment is the beginning.
        world.seek(-5);
        expect(world.getState().time).toBe(0);
        fresh.world.dispose();
        world.dispose();
    });

    it('starts a new run with the star at rest and still turning', () => {
        const { camera, world } = makeWorld('High', { capture: false });
        const standing = world.tier.shells;
        world.onLock({ u: 0.4, rows: [10], hardDrop: true });
        world.onClear({ lines: 4 });
        world.onCombo(6);
        world.levelUp(3);
        run(world, camera, 2);
        world.onLock({ u: 0.2, rows: [8] });
        const readClocks = () => ({
            time: world.time,
            spin: world.spin,
            boil: world.boil,
            flow: world.flow,
            drift: world.drift,
            ringTurn: world.ringTurn,
        });
        const clocks = readClocks();
        expect(clocks.spin).not.toBeCloseTo(clocks.time * STAR.spin, 3); // the chain and the surge have turned it on
        world.resetSession();
        // Every event is forgotten...
        expect(world.getState()).toMatchObject({
            combo: 0,
            heat: 0,
            surge: 0,
            pending: 0,
            beads: 0,
            level: 1,
            palette: SUPERNOVA_PALETTES[0].name,
            counts: {
                locks: 0, clears: 0, novas: 0, impacts: 0,
            },
        });
        expect(world.canDetonate()).toBe(true);
        expect(used(world.streams, 'aFrom')).toEqual([]);
        expect(used(world.sparks, 'aBirth')).toEqual([]);
        expect(world.fronts.every((front) => front.strength === 0)).toBe(true);
        for (const slot of world.u.impactC) expect(slot.value.w).toBe(0);
        // ...and the clocks are where they were: nothing jumps.
        expect(readClocks()).toEqual(clocks);
        expect(loopsOf(world).length).toBeGreaterThan(0);
        // The nebula's table is whole at once (a reset comes from a handler, between frames).
        expect(world.getState().shells).toBe(standing);
        expect(world.nova).toMatchObject({ next: Infinity, twist: false });
        run(world, camera, 1 / 60, 1);
        expect(world.getState().shells).toBe(standing);
        expect(world.u.ring.value.z).toBeGreaterThan(clocks.ringTurn);
        expect(world.u.ring.value.z - clocks.ringTurn).toBeLessThan(0.01);
        expect(world.getState().starRadius).toBeGreaterThan(0.95);
        expect(world.u.pulsar.value.x).toBe(0);
        expect(world.spin).toBeGreaterThan(clocks.spin);
        // The next run's first four lines detonate as the first run's did.
        world.onClear({ lines: 4 });
        run(world, camera, 1);
        expect(world.getState().counts).toMatchObject({ novas: 1, clears: 1 });
        world.dispose();
    });

    it('keeps every event under reduced motion, with shorter flights, a shorter fall and slower clocks', () => {
        const calm = makeWorld('High');
        const full = makeWorld('High');
        calm.world.setReducedMotion(true);
        const landings = watchLandings(calm.world);
        for (const { world } of [calm, full]) {
            world.onLock({ u: 0.3, rows: [12], color: '#64dcff' });
            world.onClear({ rows: bottom(2), lines: 2 });
        }
        const flights = (world) => streamsOf(world).map((stream) => stream.flight);
        for (const flight of flights(calm.world)) expect(flight).toBeLessThan(0.2);
        expect(Math.max(...flights(calm.world))).toBeLessThan(Math.max(...flights(full.world)));
        expect(Math.min(...flights(calm.world))).toBeLessThan(Math.min(...flights(full.world)));
        // No sparks where the stream tears away: one burst fewer, never one event fewer.
        expect(sparkBirths(calm.world)).toEqual([]);
        expect(sparkBirths(full.world).length).toBeGreaterThan(0);
        const turned = { calm: calm.world.spin, full: full.world.spin };
        run(calm.world, calm.camera, 1);
        run(full.world, full.camera, 1);
        expect(landings.map((landing) => landing.name)).toEqual(['shock', 'impact']);
        expect(calm.world.getState().counts).toMatchObject({ impacts: 1, fronts: 3, clears: 1 });
        expect(calm.world.getState().counts).toEqual(full.world.getState().counts);
        // The clocks run slower.
        expect(calm.world.spin - turned.calm).toBeGreaterThan(0);
        expect(calm.world.spin - turned.calm).toBeLessThan((full.world.spin - turned.full) * 0.5);
        // Four lines: a shorter fall, a gentler pull on the picture, and still a detonation.
        const pull = { calm: 0, full: 0 };
        const fallsFor = { calm: 0, full: 0 };
        for (const [name, made] of [['calm', calm], ['full', full]]) {
            const t0 = made.world.time;
            made.world.onClear({ lines: 4 });
            fallsFor[name] = made.world.nova.next - t0;
            run(made.world, made.camera, 1.5, 180, () => {
                pull[name] = Math.max(pull[name], made.world.getPostState().fall);
            });
        }
        expect(fallsFor.calm).toBeGreaterThan(0);
        expect(fallsFor.calm).toBeLessThan(fallsFor.full);
        expect(pull.calm).toBeGreaterThan(0);
        expect(pull.calm).toBeLessThan(pull.full * 0.5);
        expect(calm.world.getState().counts.novas).toBe(1);
        expect(full.world.getState().counts.novas).toBe(1);
        expect(calm.world.getPostState().ripple.strength).toBeLessThan(full.world.getPostState().ripple.strength);
        expect(notFinite(calm.world)).toEqual([]);
        calm.world.dispose();
        full.world.dispose();
    });

    it('turns the ring on a clock of its own, which switching reduced motion does not jump', () => {
        const { camera, world } = makeWorld('Low', { time: 600 });
        const turn = () => world.u.ring.value.z;
        // Ten minutes in, the ring has turned a long way.
        expect(turn()).toBeGreaterThan(1);
        const start = turn();
        run(world, camera, 1);
        const full = turn() - start;
        expect(full).toBeGreaterThan(0);
        // Switched to reduced motion it goes on from where it was, more slowly.
        world.setReducedMotion(true);
        const switched = turn();
        run(world, camera, 1 / 60, 1);
        expect(turn() - switched).toBeGreaterThan(0);
        expect(turn() - switched).toBeLessThan(full / 30);
        run(world, camera, 1);
        expect(turn() - switched).toBeLessThan(full);
        // And back the same way.
        world.setReducedMotion(false);
        const back = turn();
        run(world, camera, 1 / 60, 1);
        expect(turn() - back).toBeGreaterThan(0);
        expect(turn() - back).toBeLessThan(full / 30);
        world.dispose();
    });

    it('snaps to its targets in a frame with no time in it only for a capture', () => {
        const live = makeWorld('Low', { capture: false });
        const still = makeWorld('Low');
        for (const { camera, world } of [live, still]) {
            world.onCombo(5);
            run(world, camera, 0.1);
            world.onCombo(0);
            run(world, camera, 0.05);
        }
        const before = live.world.getState();
        const beads = Array.from(live.world.beadLit);
        expect(before.heat).toBeGreaterThan(0);
        expect(before.breath).toBeLessThan(1);
        expect(Math.max(...beads)).toBeGreaterThan(0);
        for (const { camera, world } of [live, still]) world.update({ time: world.time, delta: 0 }, camera);
        // The capture is drawn settled: the chain is over, so the star is cold and the beads are out.
        expect(still.world.getState()).toMatchObject({ heat: 0, beads: 0 });
        expect(Math.max(...still.world.beadLit)).toBe(0);
        // A live world's frame with no time in it moves nothing: no heat, no bead, no breath.
        expect(live.world.getState().heat).toBe(before.heat);
        expect(live.world.getState().breath).toBe(before.breath);
        expect(Array.from(live.world.beadLit)).toEqual(beads);
        live.world.dispose();
        still.world.dispose();
    });

    it('raises a prominence of its own on every beat, never in a frozen frame', () => {
        const { camera, world } = makeWorld('High');
        const count = () => loopsOf(world).filter((loop) => loop.time > 10).length;
        // Frozen frames: nothing new, however often they are drawn.
        for (let i = 0; i < 5; i++) world.update({ time: 10, delta: 0 }, camera);
        expect(count()).toBe(0);
        // Three beats on, three more have risen, each on the frame that crossed its beat.
        const beat = Math.floor(10 / LOOP_BEAT);
        runTo(world, camera, (beat + 3) * LOOP_BEAT + 0.1);
        const born = loopsOf(world).filter((loop) => loop.time > 10).map((loop) => loop.time).sort((a, b) => a - b);
        expect(born).toHaveLength(3);
        born.forEach((time, i) => {
            expect(time).toBeGreaterThanOrEqual((beat + 1 + i) * LOOP_BEAT - 1e-4);
            expect(time).toBeLessThan((beat + 1 + i) * LOOP_BEAT + 1 / 60 + 1e-4);
        });
        expect(world.getState().loops).toBeGreaterThan(0);
        expect(world.getState().loops).toBeLessThanOrEqual(world.loops.count);
        // A hot star throws two a beat.
        world.onCombo(6);
        run(world, camera, 3);
        const before = loopsOf(world).map((loop) => loop.time);
        const next = (Math.floor(world.time / LOOP_BEAT) + 1) * LOOP_BEAT;
        runTo(world, camera, next + 0.05);
        const fresh = loopsOf(world).map((loop) => loop.time).filter((time) => !before.includes(time));
        expect(fresh).toHaveLength(2);
        world.dispose();
    });

    it('writes nothing to its pools while nothing happens', () => {
        const { camera, world } = makeWorld('Low');
        const watched = [
            [world.streams, 'aFrom'], [world.sparks, 'aBirth'], [world.loops, 'aFoot'], [world.parts.embers, 'aSeed'],
        ].map(([part, name]) => {
            const { attribute } = instanced(part, name);
            return [name, attribute, attribute.version];
        });
        // Inside one of the star's beats: no event, no prominence, no upload.
        const nextBeat = (Math.floor(world.time / LOOP_BEAT) + 1) * LOOP_BEAT;
        runTo(world, camera, nextBeat - 0.1);
        for (const [name, attribute, version] of watched) expect(attribute.version, name).toBe(version);
        // A lock writes its stream at once, and the star's answer when it lands.
        const [streams, sparks, loops, embers] = watched;
        settle(world, camera, 10);
        const settled = watched.map(([, attribute]) => attribute.version);
        world.onLock({ u: 0.2, rows: [9], color: '#ffa8d0' });
        expect(streams[1].version).toBeGreaterThan(settled[0]);
        expect(loops[1].version).toBe(settled[2]);
        run(world, camera, 1);
        expect(sparks[1].version).toBeGreaterThan(settled[1]);
        expect(loops[1].version).toBeGreaterThan(settled[2]);
        // The wind's motes are never rewritten: they ride the clocks.
        expect(embers[1].version).toBe(embers[2]);
        world.dispose();
    });

    it('stays finite and at rest through twenty idle minutes', () => {
        const { camera, world } = makeWorld('Low', { capture: false });
        const standing = world.tier.shells;
        let most = 0;
        let radiusLow = Infinity;
        let radiusHigh = 0;
        run(world, camera, 1200, 1200 * 30, () => {
            most = Math.max(most, world.u.shellCount.value);
            radiusLow = Math.min(radiusLow, world.starR);
            radiusHigh = Math.max(radiusHigh, world.starR);
        });
        expect(most).toBe(standing);
        expect(radiusLow).toBeGreaterThan(0.95);
        expect(radiusHigh).toBeLessThan(1.05);
        expect(notFinite(world)).toEqual([]);
        expect(poolsNotFinite(world)).toEqual([]);
        expect(world.getState()).toMatchObject({
            pending: 0, combo: 0, heat: 0, surge: 0, breath: 1, shells: standing,
        });
        expect(world.getState().loops).toBeGreaterThan(0);
        expect(world.getState().loops).toBeLessThanOrEqual(world.loops.count);
        // The shells have drifted on, and the table still holds whole rows.
        for (let k = 0; k < standing; k++) {
            const shell = shellRow(world, k);
            expect(shell.radius).toBeGreaterThan(STAR.radius);
            expect(shell.gain).toBeGreaterThanOrEqual(0);
        }
        expect(world.getPostState()).toMatchObject({
            flash: 0, kick: 0, fall: 0, exposure: 1,
        });
        world.dispose();
    });

    it('returns to its resting look long after the last event', () => {
        const { camera, world } = makeWorld('Low');
        const calm = makeWorld('Low');
        script(world, camera, 60);
        world.onCombo(0);
        world.levelUp(1, { silent: true });
        run(world, camera, 70, 70 * 30);
        expect(world.getState()).toMatchObject({ combo: 0, pending: 0, beads: 0 });
        const settled = world.getState();
        for (const key of ['heat', 'surge', 'storm', 'pulse', 'twist']) expect(settled[key], key).toBeCloseTo(0, 4);
        expect(world.getState().breath).toBeCloseTo(1, 6);
        expect(world.getState().shells).toBe(world.tier.shells);
        expect(world.u.pulsar.value.x).toBe(0);
        expect(world.u.impactsLive.value).toBe(0);
        expect(world.u.heat.value).toBeCloseTo(0, 3);
        expect(world.u.starGain.value).toBeCloseTo(1, 3);
        expect(world.getPostState().exposure).toBeCloseTo(1, 3);
        expect(world.getPostState().flash).toBeCloseTo(0, 6);
        expect(world.getPostState().fall).toBe(0);
        expect(world.getPostState().ripple.strength).toBeLessThan(1e-9);
        // The post is asked for what a star that has never been touched asks for.
        settle(calm.world, calm.camera, 10);
        const untouched = calm.world.getPostState();
        for (const key of POST_KEYS) expect(world.getPostState()[key], key).toBeCloseTo(untouched[key], 3);
        expect(notFinite(world)).toEqual([]);
        world.dispose();
        calm.world.dispose();
    });
});

describe('supernova world: robustness', () => {
    it('takes junk in every event without throwing and without a number that is not finite', () => {
        const { camera, world } = makeWorld('Low');
        const junk = [undefined, null, NaN, 'x', {}, [], -1, 1e9, Infinity];
        expect(() => {
            world.onLock();
            world.onLock({});
            world.onClear();
            world.onClear({});
            world.onCombo();
            world.levelUp();
            for (const value of junk) {
                world.onLock({ color: value });
                world.onLock({ player: value });
                world.onLock({ screen: value });
                world.onLock({ screen: { x: value, y: 0.5 } });
                world.onLock({ screen: { x: 0.5, y: value } });
                world.onLock({ hardDrop: value });
                world.onLock({ rows: value });
                world.onClear({ lines: value });
                world.onClear({ rows: value });
                world.onClear({ player: value, tspin: value, perfect: false });
                world.onClear({ screen: { x: value, y: value } });
                world.onCombo(value);
                world.onCombo(value, { silent: true });
                world.levelUp(value);
                run(world, camera, 0.25, 5);
            }
            world.onLock({ rows: [] });
            world.onLock({ rows: [99] });
            world.onLock({ rows: [-99], u: 7 });
            world.onLock({ rows: [3], u: -7 });
            world.onClear({ rows: [], lines: 99 });
            world.onClear({ rows: [99, -99, 5, 6, 7, 8, 9], lines: 3 });
            world.onClear({ lines: 0 });
            world.setLayout(undefined);
            world.setLayout({});
            world.onLock({ rows: [4] });
            world.onClear({ lines: 2 });
            world.setLayout({ cards: [], boards: [] });
            world.onLock({ rows: [4] });
            run(world, camera, 3);
        }).not.toThrow();
        expect(notFinite(world)).toEqual([]);
        expect(poolsNotFinite(world)).toEqual([]);
        expect(world.getState().shells).toBeLessThanOrEqual(SHELL_ROWS);
        expect(world.getState().combo).toBeGreaterThanOrEqual(0);
        // Rows past the board's ends are clamped onto it.
        settle(world, camera, 10);
        world.setLayout(fallbackLayout(1600, 900));
        const [board] = world.layout.boards;
        world.onLock({ rows: [99] });
        world.onLock({ rows: [-99] });
        const [low, high] = streamsOf(world).map((stream) => onScreen(stream.from, camera).y);
        expect(low).toBeCloseTo(boardPoint(board, 0.5, 19).y, 4);
        expect(high).toBeCloseTo(boardPoint(board, 0.5, 0).y, 4);
        // At most four rows of a clear are sent, however many it names.
        settle(world, camera, 10);
        world.onClear({ rows: [19, 18, 17, 16, 15, 14], lines: 4 });
        expect(streamsOf(world)).toHaveLength(4);
        world.dispose();
    });

    it('survives two hundred locks in one frame without losing a clear or a detonation', () => {
        for (const first of ['clears', 'locks']) {
            const { camera, world } = makeWorld('High');
            const landings = watchLandings(world);
            // What each kind of event was promised: the moments queued, and how many were refused.
            const queued = { lock: [], clear: [] };
            const refused = { lock: 0, clear: 0 };
            let source = '';
            const schedule = world.schedule.bind(world);
            world.schedule = (kind, time, detail) => {
                const kept = schedule(kind, time, detail);
                if (kept) queued[source].push(time);
                else refused[source] += 1;
                return kept;
            };
            const clears = () => {
                source = 'clear';
                world.onClear({ rows: bottom(2), lines: 2, player: 1 });
                world.onClear({ rows: bottom(4), lines: 4 });
            };
            const locks = () => {
                source = 'lock';
                for (let i = 0; i < 200; i++) {
                    world.onLock({
                        u: (i % 10) / 10, rows: [19 - (i % 20)], color: '#ffaa00', hardDrop: i % 2 === 0,
                    });
                }
            };
            expect(() => {
                if (first === 'clears') clears();
                locks();
                if (first === 'locks') clears();
            }).not.toThrow();
            // The queue is full, not grown. A lock past its end is refused (its stream still
            // flies); a clear and a detonation never are.
            const room = world.pending.length;
            expect(world.getState().pending).toBe(room);
            expect(refused.clear, first).toBe(0);
            expect(queued.clear, first).toHaveLength(2);
            expect(queued.lock.length + refused.lock).toBe(400);
            expect(refused.lock).toBeGreaterThan(0);
            expect(queued.lock.length).toBe(first === 'locks' ? room : room - 2);
            expect(world.getState().counts).toMatchObject({ locks: 200, clears: 2, streams: 406 });
            expect(streamsOf(world)).toHaveLength(STREAM_SLOTS);
            expect(() => run(world, camera, 2)).not.toThrow();
            // The shock and the detonation both happened, each once; locks gave way, not they.
            const names = landings.map((landing) => landing.name);
            expect(names.filter((name) => name === 'shock'), first).toHaveLength(1);
            expect(names.filter((name) => name === 'detonate'), first).toHaveLength(1);
            const landed = landings.filter((landing) => landing.name === 'impact').map((landing) => landing.time);
            const impacts = landed.length;
            expect(impacts, first).toBe(room - 2);
            // The locks that gave way are the ones that would have landed last: the streams
            // nearest the star keep their answer.
            const soonest = [...queued.lock].sort((a, b) => a - b).slice(0, impacts);
            expect(landed).toEqual(soonest);
            expect(world.getState()).toMatchObject({ pending: 0, counts: { novas: 1, impacts } });
            // Whatever landed did so in the order of its own moment.
            const times = landings.map((landing) => landing.time);
            expect([...times].sort((a, b) => a - b)).toEqual(times);
            expect(world.getState().shells).toBeLessThanOrEqual(SHELL_ROWS);
            expect(notFinite(world)).toEqual([]);
            expect(poolsNotFinite(world)).toEqual([]);
            world.dispose();
        }
    });

    it('applies everything a long frame missed, each as of its own moment', () => {
        const { camera, world } = makeWorld('High');
        const landings = watchLandings(world);
        world.onLock({ u: 0.3, rows: [12], color: '#ff0033' });
        world.onClear({ lines: 4 });
        // One frame five seconds long.
        run(world, camera, 5, 1);
        expect(landings.map((landing) => landing.name).sort()).toEqual(['detonate', 'impact']);
        for (const landing of landings) expect(landing.time).toBeLessThan(11);
        expect(world.u.echo.value.x).toBe(world.nova.birth);
        expect(world.getState().counts).toMatchObject({ novas: 1, impacts: 1 });
        // The detonation's flash is as old as it is, not as new as the frame.
        expect(world.getPostState().flash).toBeLessThan(0.1);
        expect(world.getPostState().kick).toBeLessThan(0.1);
        expect(world.getState().surge).toBeLessThan(1);
        expect(world.getState().surge).toBeGreaterThan(0);
        expect(notFinite(world)).toEqual([]);
        world.dispose();
    });

    it('hands the post the same object every frame, with every field finite and in range', () => {
        const { camera, world } = makeWorld('High');
        const post = world.getPostState();
        expect(Object.keys(post).sort()).toEqual(
            ['bloomBoost', 'exposure', 'fall', 'flash', 'heart', 'kick', 'rays', 'ripple', 'streak'],
        );
        const check = () => {
            expect(world.getPostState()).toBe(post);
            expect(post.heart).toBe(world.heart);
            for (const key of ['flash', 'kick', 'rays', 'streak', 'bloomBoost', 'exposure', 'fall']) {
                expect(Number.isFinite(post[key]), key).toBe(true);
                expect(post[key], key).toBeGreaterThanOrEqual(0);
            }
            expect(post.exposure).toBeGreaterThan(0);
            expect(post.exposure).toBeLessThanOrEqual(1);
            expect(post.fall).toBeLessThanOrEqual(1);
            expect(post.flash).toBeLessThanOrEqual(1);
            expect(post.kick).toBeLessThanOrEqual(1);
            expect(Number.isFinite(post.ripple.radius) && post.ripple.radius >= 0).toBe(true);
            expect(post.ripple.strength).toBeGreaterThanOrEqual(0);
            expect(post.ripple.strength).toBeLessThanOrEqual(1);
            for (const axis of ['x', 'y']) {
                expect(post.heart[axis]).toBeGreaterThanOrEqual(-0.5);
                expect(post.heart[axis]).toBeLessThanOrEqual(1.5);
            }
        };
        check();
        world.onLock({ u: 0.3, rows: [12], hardDrop: true });
        world.onClear({ lines: 3, tspin: true });
        world.onCombo(CRITICAL_COMBO - 1);
        run(world, camera, 2, 120, check);
        world.onClear({ lines: 4, perfect: true });
        world.onCombo(CRITICAL_COMBO + 4);
        run(world, camera, 4, 240, check);
        world.onClear({ lines: 4 });
        world.levelUp(5);
        run(world, camera, 10, 300, check);
        world.dispose();
    });

    it('refuses a moment that is not a finite number in seek() and update()', () => {
        const { camera, world } = makeWorld('Low');
        const standing = world.tier.shells;
        world.onLock({ u: 0.3, rows: [12], color: '#ff0033' });
        run(world, camera, 0.2);
        // A frame at no moment is not a frame: nothing moves, nothing lands, nothing is poisoned.
        const before = {
            state: world.getState(), table: shellTable(world), time: world.u.time.value, flow: world.flow,
        };
        for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'soon']) {
            expect(() => world.update({ time: junk, delta: 1 / 60 }, camera)).not.toThrow();
        }
        expect(world.getState()).toEqual(before.state);
        expect(shellTable(world)).toEqual(before.table);
        expect(world.u.time.value).toBe(before.time);
        expect(world.flow).toBe(before.flow);
        expect(notFinite(world)).toEqual([]);
        // A frame of no length that is not a number is a frame of no length: the clock moves on.
        for (const junk of [NaN, Infinity, undefined, 'x', -1]) {
            const time = world.time + 0.05;
            world.updateCamera(camera, { time, delta: 0 });
            world.update({ time, delta: junk }, camera);
            expect(world.time).toBe(time);
        }
        expect(notFinite(world)).toEqual([]);
        // The lock in flight still lands when its moment comes.
        run(world, camera, 1);
        expect(world.getState().counts.impacts).toBe(1);
        // A seek to no moment is a seek to the beginning, drawn whole.
        for (const junk of [NaN, Infinity, -Infinity, undefined, null, 'soon']) {
            world.seek(junk);
            expect(world.time, String(junk)).toBe(0);
            expect(world.getState()).toMatchObject({ shells: standing, pending: 0, counts: { impacts: 0 } });
            expect(notFinite(world), String(junk)).toEqual([]);
        }
        world.updateCamera(camera, { time: 0, delta: 0 });
        world.update({ time: 0, delta: 0 }, camera);
        expect(world.getState().starRadius).toBeGreaterThan(0.95);
        expect(notFinite(world)).toEqual([]);
        expect(poolsNotFinite(world)).toEqual([]);
        world.dispose();
    });

    /**
     * Gap in the same fix: updateCamera() has no such guard. A moment that is not a number
     * leaves the bound camera's matrices NaN until the next good frame, and an event fired in
     * between (the theme flushes its director after updateCamera) is aimed through them.
     */
    it('leaves the camera where it was for a moment that is not a finite number', () => {
        const { camera, world } = makeWorld('Low');
        const before = camera.matrixWorld.toArray();
        world.updateCamera(camera, { time: NaN, delta: 0 });
        expect(camera.matrixWorld.toArray()).toEqual(before);
        world.onLock({ u: 0.3, rows: [12] });
        expect(poolsNotFinite(world)).toEqual([]);
        world.dispose();
    });
});

describe('supernova effects: closed forms', () => {
    it('flies a stream along an arc from the card to the star', () => {
        const from = [4, -2, -10];
        const mid = [1, 3, -14];
        const to = [-6, 0.5, -21];
        expect(streamPoint(from, mid, to, 0)).toEqual(from);
        expect(streamPoint(from, mid, to, 1)).toEqual(to);
        const half = streamPoint(from, mid, to, 0.5);
        half.forEach((value, i) => expect(value).toBeCloseTo(from[i] * 0.25 + mid[i] * 0.5 + to[i] * 0.25, 12));
        // It writes into what it is handed.
        const out = [0, 0, 0];
        expect(streamPoint(from, mid, to, 0.3, out)).toBe(out);
        expect(STREAM_TAIL).toBeGreaterThan(0);
        expect(STREAM_TAIL).toBeLessThan(1);
    });

    it('stands a prominence on the star: both feet on the surface, its top a height above', () => {
        const mid = [0, 0, 1];
        const tangent = [1, 0, 0];
        const span = 0.3;
        const height = 0.6;
        const footA = loopPoint(mid, tangent, span, height, 0, 0);
        const footB = loopPoint(mid, tangent, span, height, 0, 1);
        expect(Math.hypot(...footA)).toBeCloseTo(1, 12);
        expect(Math.hypot(...footB)).toBeCloseTo(1, 12);
        // The feet lie either side of the middle, the half-angle apart from it.
        expect(Math.acos(footA[2])).toBeCloseTo(span, 9);
        expect(footA[0]).toBeCloseTo(-footB[0], 12);
        const top = loopPoint(mid, tangent, span, height, 0, 0.5);
        expect(top).toEqual([0, 0, 1 + height].map((v) => expect.closeTo(v, 12)));
        // A lean tips the top sideways and leaves the feet where they are.
        const leaned = loopPoint(mid, tangent, span, height, 0.5, 0.5);
        expect(Math.abs(leaned[1])).toBeGreaterThan(0.1);
        expect(loopPoint(mid, tangent, span, height, 0.5, 0)).toEqual(footA.map((v) => expect.closeTo(v, 12)));
    });
});
