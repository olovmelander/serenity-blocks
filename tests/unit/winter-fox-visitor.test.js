/**
 * Winter — the visitor: the second arctic fox, of the other coat, that comes and goes at the back
 * of the snowfield (VisitorMind in winter-fox-visitor.js; its body is createFox(…, { second: true })
 * in winter-fox.js, in the blue coat).
 *
 * Its mind and its way need no GPU. Its body's three materials (its skin, its coat of fur and the
 * shadow it lays on the snow, which the snow's own material does not know of) are built through
 * three's WGSL and GLSL node builders against a stub renderer, as winter-shaders.test.js builds
 * the fox's: a graph one backend cannot write throws or warns here.
 */

import { readFileSync } from 'node:fs';
import {
    afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FOX_COATS, createFox } from '../../src/themes/winter/winter-fox.js';
import {
    FOX_WANDER_STOPS, RoamingFoxMind, VISITOR_AWAY, VISITOR_ERRANDS, VISITOR_MEET, VISITOR_STOPS, VisitorMind,
} from '../../src/themes/winter/winter-fox-mind.js';
import { FOX_BONES, FOX_RIG, VISITOR_RIG } from '../../src/themes/winter/winter-fox-rig.js';
import {
    FOX_SCALE, FRAME_TREES, bakeNoise, bearingFor, createNoiseTexture, createShadowTexture, createWinterUniforms,
    groundHeight, landDistance,
} from '../../src/themes/winter/winter-tsl.js';
import { materialXNoiseFunctions } from './helpers/materialx-noise.js';

const DT = 1 / 60;
const REST = Object.freeze({ power: 0, surge: 0, aurora: 0 });
const ASPECTS = [16 / 9, 4 / 3, 21 / 9];
const fractionOf = (x, z, aspect) => Math.abs(x / -z) / Math.tan(bearingFor(1, aspect));
const treesFor = (aspect) => FRAME_TREES.map(([fraction, dist]) => {
    const az = bearingFor(fraction, aspect);
    return [Math.sin(az) * dist, -Math.cos(az) * dist];
});

function run(mind, from, seconds, each = null) {
    const steps = Math.round(seconds / DT);
    let time = from;
    for (let i = 1; i <= steps; i++) {
        time = from + i * DT;
        mind.step(DT, time, REST);
        each?.(mind, time);
    }
    return time;
}

/** Step until `done(mind)`; the time it came true (fails the test if it never does). */
function runUntilTrue(mind, from, done, limit, each = null) {
    const steps = Math.round(limit / DT);
    for (let i = 1; i <= steps; i++) {
        const time = from + i * DT;
        each?.(mind, time);
        mind.step(DT, time, REST);
        if (done(mind)) return time;
    }
    throw new Error(`not within ${limit} s (mode ${mind.mode}, errand ${mind.errand})`);
}
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

describe('winter visitor: its comings and goings', () => {
    /** Its visits over a night: the side of the frame it came in by and went out by, and where it was then. */
    function comings(seed, seconds = 1800, aspect = 16 / 9) {
        const mind = new VisitorMind(aspect, seed);
        const visits = [];
        let visit = null;
        let last = null;
        run(mind, 0, seconds, (m) => {
            if (!m.away && !visit) {
                visit = { in: Math.sign(m.pose.x), at: fractionOf(m.pose.x, m.pose.z, aspect), path: [] };
            }
            if (m.away && visit) {
                visit.out = Math.sign(last[0]);
                visit.left = fractionOf(last[0], last[1], aspect);
                visits.push(visit);
                visit = null;
            }
            if (!m.away) {
                last = [m.pose.x, m.pose.z];
                if (m.present) visit.path.push([m.pose.x, m.pose.z]);
            }
        });
        return visits;
    }

    it('comes in from beyond either side of the frame and leaves by either: never by one way', () => {
        const all = [];
        for (const seed of [0xb1ce, 5, 777]) {
            const visits = comings(seed);
            expect(visits.length, `seed ${seed}`).toBeGreaterThanOrEqual(8);
            all.push(...visits);
        }
        // From beyond the frame, out of sight, and away again beyond it.
        all.forEach((visit) => {
            expect(visit.at).toBeGreaterThan(1.1);
            expect(visit.left).toBeGreaterThan(1.1);
        });
        // In by the left and by the right; out by the left and by the right; across and back.
        expect(all.some((visit) => visit.in < 0) && all.some((visit) => visit.in > 0)).toBe(true);
        expect(all.some((visit) => visit.out < 0) && all.some((visit) => visit.out > 0)).toBe(true);
        expect(all.filter((visit) => visit.out !== visit.in).length).toBeGreaterThan(all.length * 0.2);
        expect(all.filter((visit) => visit.out === visit.in).length).toBeGreaterThan(all.length * 0.2);
        // No two visits go the same way: where each spends its time differs.
        const middles = all.filter((visit) => visit.path.length > 60).map((visit) => [
            visit.path.reduce((sum, [x]) => sum + x, 0) / visit.path.length,
            visit.path.reduce((sum, [, z]) => sum + z, 0) / visit.path.length,
        ]);
        const spread = Math.max(...middles.map(([x]) => x)) - Math.min(...middles.map(([x]) => x));
        expect(spread).toBeGreaterThan(6);
    });

    it('roams the back of the snowfield, behind the fox\'s snow and in front of the shore', () => {
        const visitor = new VisitorMind();
        const fox = new RoamingFoxMind();
        expect(visitor.range.near).toBeGreaterThan(fox.range.far - 3);
        expect(visitor.range.far).toBeGreaterThan(fox.range.far + 3);
        ASPECTS.forEach((aspect) => {
            const { range } = new VisitorMind(aspect);
            for (let f = -0.85; f <= 0.85; f += 0.1) {
                const [x, z] = range.place(f, range.far);
                expect(landDistance(x, z), `${aspect.toFixed(2)} at ${f.toFixed(1)}`).toBeGreaterThan(1);
            }
        });
    });
});

describe('winter visitor: its mind', () => {
    /** Half an hour of the visitor: when it was in sight, what it stopped for and where. */
    function visits(seed, seconds = 1800, aspect = 16 / 9) {
        const mind = new VisitorMind(aspect, seed);
        const trees = treesFor(aspect);
        const stops = [];
        let inSight = 0;
        let comings = 0;
        let was = false;
        let { mode } = mind;
        let nearestTree = Infinity;
        let offSnow = 0;
        run(mind, 0, seconds, (m) => {
            const here = m.present && !m.away;
            if (here) {
                inSight += DT;
                trees.forEach(([x, z]) => {
                    nearestTree = Math.min(nearestTree, Math.hypot(m.pose.x - x, m.pose.z - z));
                });
                if (landDistance(m.pose.x, m.pose.z) < 2) offSnow += 1;
            }
            if (here && !was) comings += 1;
            was = here;
            if (m.mode === 'idle' && mode !== 'idle' && m.next) {
                stops.push({ what: m.next.join('+'), fraction: fractionOf(m.pose.x, m.pose.z, aspect), here });
            }
            ({ mode } = m);
        });
        return {
            mind, stops, inSight, comings, nearestTree, offSnow, seconds,
        };
    }

    it('is the arctic fox, a little smaller, roaming as the fox does, with a seed of its own', () => {
        const visitor = new VisitorMind();
        const fox = new RoamingFoxMind();
        expect(visitor).toBeInstanceOf(RoamingFoxMind);
        expect(visitor.rig).toBe(VISITOR_RIG);
        expect(VISITOR_RIG.bones).toBe(FOX_BONES);
        expect(VISITOR_RIG.scale).toBeLessThan(FOX_RIG.scale);
        expect(VISITOR_RIG.scale).toBeGreaterThan(FOX_RIG.scale * 0.85);
        expect(VISITOR_RIG.lengths).toEqual(FOX_RIG.lengths);
        expect(visitor.seed).not.toBe(fox.seed);
        expect(visitor.course.height).toBe(groundHeight);
        // It does what the fox does when it stops, but for what needs the fox's room.
        expect(VISITOR_STOPS.length).toBeGreaterThan(FOX_WANDER_STOPS.length - 6);
        VISITOR_STOPS.forEach((stop) => {
            expect(FOX_WANDER_STOPS).toContain(stop);
            expect(stop[2].then).toBeUndefined();
        });
        // It sets out to do less of what the fox does, and never romps.
        expect(Object.keys(VISITOR_ERRANDS)).not.toContain('play');
        // It begins away, out of sight, and leaves no prints.
        expect(visitor.away).toBe(true);
        expect(visitor.present).toBe(false);
        expect(visitor.paces.pawPrints).toBe(0);
    });

    it('comes and goes: in sight for part of the night, away for the rest, again and again', () => {
        for (const seed of [0xb1ce, 5, 777]) {
            const {
                inSight, comings, seconds, stops, nearestTree, offSnow, mind,
            } = visits(seed);
            const label = `seed ${seed}`;
            expect(inSight / seconds, label).toBeGreaterThan(0.25);
            expect(inSight / seconds, label).toBeLessThan(0.7);
            expect(comings, label).toBeGreaterThanOrEqual(8);
            // It stops where it can be seen, on the open snow, and for many kinds of thing.
            expect(stops.length, label).toBeGreaterThanOrEqual(20);
            stops.forEach((stop) => {
                expect(stop.here, `${label}: ${stop.what}`).toBe(true);
                expect(Math.abs(stop.fraction), `${label}: ${stop.what}`).toBeLessThan(1);
            });
            expect(new Set(stops.map((stop) => stop.what)).size, label).toBeGreaterThanOrEqual(10);
            // Clear of the trees and on the snow all the while it is in sight.
            expect(nearestTree, label).toBeGreaterThan(1.3);
            expect(offSnow, label).toBe(0);
            expect(Number.isFinite(mind.pose.x + mind.pose.z + mind.pose.heading), label).toBe(true);
        }
    });

    it('stands and waits behind the viewer: nothing of it moves and it tells the world nothing', () => {
        const mind = new VisitorMind(16 / 9, 5);
        let waits = 0;
        let longest = 0;
        let since = null;
        let held = null;
        run(mind, 0, 900, (m, time) => {
            if (m.away) {
                if (since === null) {
                    since = time;
                    held = { ...m.pose };
                    waits += 1;
                }
                expect(m.present).toBe(false);
                expect(m.events).toHaveLength(0);
                expect(m.pose.x).toBe(held.x);
                expect(m.pose.z).toBe(held.z);
                expect(m.pose.z).toBeGreaterThan(0);
            } else if (since !== null) {
                longest = Math.max(longest, time - since);
                since = null;
            }
        });
        expect(waits).toBeGreaterThanOrEqual(3);
        expect(longest).toBeGreaterThan(VISITOR_AWAY[0] - 0.1);
        expect(longest).toBeLessThan(VISITOR_AWAY[1] + 0.1);
    });

    it('keeps off the fox: pulls up short of one in its way, makes a stop of the wait, and turns back', () => {
        const mind = new VisitorMind(16 / 9, 5);
        mind.arrive(0, 0);
        let time = 0;
        const under = (m) => m.mode === 'gait' && m.speed > 1 && m.present && !m.away;
        time = runUntilTrue(mind, time, under, 30);
        // (The way it was going when it pulled up before the fox.)
        let came = null;
        // A fox standing on its way, six metres on.
        const [x, z] = mind.course.at(mind.s + 6, [0, 0, 0]);
        let nearest = Infinity;
        const seen = new Set();
        const steps = Math.round(40 / DT);
        for (let i = 1; i <= steps && mind.errand !== 'back'; i++) {
            time += DT;
            expect(mind.keepOff(x, z, time) || time >= mind.heedFrom - 15).toBe(true);
            if (came === null && mind.blockedSince !== null) came = mind.pose.heading;
            nearest = Math.min(nearest, Math.hypot(mind.pose.x - x, mind.pose.z - z));
            if (mind.mode === 'idle' && mind.act) seen.add(mind.act.join('+'));
            mind.step(DT, time, REST);
        }
        // It stopped short of it (a body's length and more), did something there, and then turned back.
        expect(nearest).toBeGreaterThan(VISITOR_MEET.room - 0.8);
        expect(nearest).toBeLessThan(VISITOR_MEET.room + 1.5);
        expect([...seen].some((what) => VISITOR_MEET.stops.some((acts) => acts.join('+') === what))).toBe(true);
        expect(mind.errand).toBe('back');
        // On its way back the fox behind it is nothing to it.
        time = runUntilTrue(mind, time, (m) => m.mode === 'gait' && m.speed > 1, 20, (m, now) => m.keepOff(x, z, now));
        run(mind, time, 1, (m, now) => m.keepOff(x, z, now));
        // (Back across the frame the way it came: the other way along it, turned well round.)
        expect(Math.sign(Math.sin(mind.pose.heading))).toBe(-Math.sign(Math.sin(came)));
        expect(Math.abs(wrapAngle(mind.pose.heading - came))).toBeGreaterThan(1.2);
        expect(mind.ahead).toBe(Infinity);
        // A fox off to one side of its way, or behind it, is not in its way at all.
        const free = new VisitorMind(16 / 9, 5);
        free.arrive(0, 0);
        time = runUntilTrue(free, 0, under, 30);
        const { pose } = free;
        const side = [pose.x + Math.cos(pose.heading) * 4, pose.z - Math.sin(pose.heading) * 4];
        expect(free.keepOff(side[0], side[1], time)).toBe(false);
        const behind = [pose.x - Math.sin(pose.heading) * 3, pose.z - Math.cos(pose.heading) * 3];
        expect(free.keepOff(behind[0], behind[1], time)).toBe(false);
        expect(free.ahead).toBe(Infinity);
    });

    it('is the same night from the same seed, and can be set on its way for a capture', () => {
        const a = visits(5, 600);
        const b = visits(5, 600);
        expect(b.stops).toEqual(a.stops);
        expect(b.inSight).toBe(a.inSight);
        expect({ ...b.mind.pose, plant: null, over: null }).toEqual({ ...a.mind.pose, plant: null, over: null });
        expect(visits(6, 600).stops).not.toEqual(a.stops);
        // Sent on its way it comes into sight from the left within a few seconds.
        const mind = new VisitorMind(16 / 9, 5);
        mind.arrive(0, 0);
        expect(mind.away).toBe(false);
        let came = null;
        run(mind, 0, 12, (m, time) => {
            if (came === null && m.present && fractionOf(m.pose.x, m.pose.z, 16 / 9) < 1) came = time;
        });
        expect(came).not.toBeNull();
        expect(came).toBeLessThan(10);
        expect(mind.pose.x).toBeLessThan(0);
        // A frame that changes shape lays its snow out anew and keeps it going.
        mind.setAspect(3 / 4);
        expect(mind.range.aspect).toBe(3 / 4);
        run(mind, 12, 20);
        expect(Number.isFinite(mind.pose.x + mind.pose.z + mind.pose.heading)).toBe(true);
    });
});

// ── Its body ────────────────────────────────────────────────────────────────────

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];

function stubRenderer() {
    return {
        contextNode: context(),
        lighting: { enabled: false },
        backend: {
            device: null,
            capabilities: { getUniformBufferLimit: () => 65536 },
            extensions: { has: () => false },
            utils: { getTextureSampleData: () => ({ samples: 1, primarySamples: 1, isMSAA: false }) },
            compatibilityMode: false,
        },
        getRenderTarget: () => null,
        getMRT: () => null,
        shadowMap: { enabled: false, type: 0 },
        capabilities: {},
        library: { fromMaterial: (m) => m },
        nodes: {},
        getOutputRenderTarget: () => null,
        currentColorSpace: 'srgb',
        outputColorSpace: 'srgb',
        toneMapping: 0,
        xr: { enabled: false },
        debug: { checkShaderErrors: false, diagnostics: { keywords: true } },
        getUniformBufferLimit: () => 65536,
        hasFeature: () => false,
        isOutputTarget: false,
        logarithmicDepthBuffer: false,
        reverseDepth: false,
        highPrecision: false,
    };
}

function buildShaders(Builder, mesh) {
    const builder = new Builder(mesh, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = mesh.material;
    builder.material = mesh.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

describe('winter visitor: its body', () => {
    let u;
    let textures;
    let fox;
    let visitor;
    /** A fox's mesh by name, or (with none) its skin: the skinned mesh that is not its fur. */
    const named = (part, name) => {
        let found = null;
        const skin = (object) => object.isSkinnedMesh && object.name !== 'WinterFoxFur';
        const wanted = (object) => (name ? object.name === name : skin(object));
        part.mesh.traverse((object) => {
            if (!found && object.isMesh && wanted(object)) found = object;
        });
        return found;
    };
    const readFox = () => {
        const file = readFileSync(new URL('../../src/themes/winter/assets/arctic-fox.glb', import.meta.url));
        return new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
    };

    beforeAll(async () => {
        const gltf = await readFox();
        const noise = createNoiseTexture(bakeNoise());
        const shadow = createShadowTexture(new Uint8Array(4).fill(255), 2);
        textures = [noise, shadow];
        u = createWinterUniforms({ noise, shadow });
        // In the world's own order: the fox first, then the visitor from the same model.
        fox = createFox(u, gltf, { shells: 14 });
        visitor = createFox(u, gltf, {
            shells: 6, coat: FOX_COATS.blue, rig: VISITOR_RIG, second: true,
        });
    });
    afterAll(() => {
        visitor.dispose();
        fox.dispose();
        textures.forEach((texture) => texture.dispose());
    });

    it('wears the other coat: darker fur, a paler belly, and less of the moon through its outline', () => {
        const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        expect(visitor.coat).toBe(FOX_COATS.blue);
        expect(fox.coat).toBe(FOX_COATS.white);
        expect(luma(FOX_COATS.blue.fur)).toBeLessThan(luma(FOX_COATS.white.fur) * 0.4);
        expect(luma(FOX_COATS.blue.under)).toBeGreaterThan(luma(FOX_COATS.blue.fur));
        expect(FOX_COATS.blue.sheen).toBeLessThan(FOX_COATS.white.sheen);
        expect(FOX_COATS.blue.fluff).toBeLessThan(FOX_COATS.white.fluff);
        Object.values(FOX_COATS).forEach((coat) => {
            ['fur', 'under', 'skin', 'ear'].forEach((key) => {
                expect(coat[key].every((c) => c >= 0 && c <= 1), key).toBe(true);
            });
        });
    });

    it('is drawn from the fox\'s own mesh on bones of its own, in fewer shells, with a shadow of its own', () => {
        const skin = named(fox);
        const other = named(visitor);
        const fur = named(visitor, 'WinterFoxFur');
        const shadow = named(visitor, 'WinterFoxShadow');
        expect(other.isSkinnedMesh).toBe(true);
        expect(other).not.toBe(skin);
        expect(other.skeleton).not.toBe(skin.skeleton);
        expect(other.skeleton.bones).toHaveLength(FOX_BONES.length);
        // One mesh's worth of vertices for both foxes and both coats.
        Object.keys(skin.geometry.attributes).forEach((key) => {
            expect(other.geometry.attributes[key], key).toBe(skin.geometry.attributes[key]);
            expect(fur.geometry.attributes[key], key).toBe(skin.geometry.attributes[key]);
        });
        expect(fur.geometry.instanceCount).toBe(6);
        expect(visitor.shells).toBe(6);
        expect(fur.skeleton).toBe(other.skeleton);
        // Three materials of its own: none is the fox's.
        expect(other.material).not.toBe(skin.material);
        expect(fur.material).not.toBe(fox.furMaterial);
        expect(shadow).toBeTruthy();
        expect(shadow.material.transparent).toBe(true);
        expect(shadow.material.depthWrite).toBe(false);
        // The fox itself lays no shadow of its own (the snow's material lays it).
        expect(named(fox, 'WinterFoxShadow')).toBeNull();
        // Only one fox's fur is on each skeleton.
        let furs = 0;
        visitor.mesh.traverse((object) => {
            if (object.name === 'WinterFoxFur') furs += 1;
        });
        expect(furs).toBe(1);
    });

    it('stands where its own mind says, at its own size, its shadow on the snow toward the viewer', () => {
        const mind = new VisitorMind(16 / 9, 5);
        mind.arrive(0, 0);
        run(mind, 0, 9);
        const before = named(fox).skeleton.bones.map((bone) => bone.quaternion.clone());
        visitor.update(mind.pose);
        const pivot = visitor.mesh.getObjectByName('WinterFox');
        expect(pivot.position.x).toBeCloseTo(mind.pose.x, 9);
        expect(pivot.position.z).toBeCloseTo(mind.pose.z, 9);
        expect(pivot.scale.x).toBeCloseTo(VISITOR_RIG.scale, 12);
        expect(pivot.scale.x).toBeLessThan(FOX_SCALE);
        const shadow = named(visitor, 'WinterFoxShadow');
        const moon = u.moonDir.value;
        expect(shadow.position.x).toBeCloseTo(mind.pose.x - moon.x * 0.55, 9);
        expect(shadow.position.z).toBeCloseTo(mind.pose.z - moon.z * 0.55, 9);
        expect(shadow.position.y).toBeCloseTo(groundHeight(shadow.position.x, shadow.position.z) + 0.03, 9);
        // Posing it stirs no bone of the fox.
        named(fox).skeleton.bones.forEach((bone, i) => expect(bone.quaternion.angleTo(before[i])).toBe(0));
    });

    it.each(['skin', 'fur', 'shadow'])('builds its %s for WebGPU and the WebGL2 fallback without a word', (which) => {
        const mesh = named(visitor, { fur: 'WinterFoxFur', shadow: 'WinterFoxShadow' }[which]);
        const warn = vi.spyOn(console, 'warn');
        const error = vi.spyOn(console, 'error');
        BACKENDS.forEach(([label, Builder]) => {
            const heard = [];
            const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 400));
            warn.mockImplementation(listen);
            error.mockImplementation(listen);
            const out = buildShaders(Builder, mesh);
            expect(heard, `${which}, ${label}`).toEqual([]);
            for (const stage of ['vertex', 'fragment']) {
                expect(out[stage].length, `${which}, ${label} ${stage}`).toBeGreaterThan(200);
                expect(Buffer.byteLength(out[stage]), `${which}, ${label} ${stage}`).toBeLessThan(48 * 1024);
            }
            expect(materialXNoiseFunctions(`${out.vertex}${out.fragment}`), `${which}, ${label}`).toEqual([]);
        });
        warn.mockRestore();
        error.mockRestore();
    });

    it('lets go of what is its own and leaves the fox its mesh', async () => {
        const gltf = await readFox();
        const first = createFox(u, gltf, { shells: 3 });
        const second = createFox(u, gltf, {
            shells: 2, coat: FOX_COATS.blue, rig: VISITOR_RIG, second: true,
        });
        const shared = named(first).geometry;
        const disposed = vi.fn();
        shared.addEventListener('dispose', disposed);
        second.dispose();
        expect(disposed).not.toHaveBeenCalled();
        first.dispose();
        expect(disposed).toHaveBeenCalledTimes(1);
    });
});
