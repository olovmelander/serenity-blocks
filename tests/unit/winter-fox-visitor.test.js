/**
 * Winter — the visitor: the second arctic fox, of the other coat, that comes and goes at the back
 * of the snowfield (VisitorMind in winter-fox-mind.js; its body is createFox(…, { second: true })
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
    FOX_WANDER_STOPS, FoxMind, VISITOR_AWAY, VISITOR_MEET, VISITOR_STOPS, VISITOR_WAY, VisitorMind, visitorWay,
} from '../../src/themes/winter/winter-fox-mind.js';
import { FOX_BONES, FOX_RIG, VISITOR_RIG } from '../../src/themes/winter/winter-fox-rig.js';
import {
    FOX_SCALE, FRAME_TREES, bakeNoise, bearingFor, createNoiseTexture, createShadowTexture, createWinterUniforms,
    foxRound, groundHeight, landDistance,
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

describe('winter visitor: its way', () => {
    it('is a lane across the back of the snowfield, out of the frame at both ends and closed behind the viewer', () => {
        ASPECTS.forEach((aspect) => {
            const way = visitorWay(aspect);
            const trees = treesFor(aspect);
            const round = foxRound(aspect);
            let furthestRound = 0;
            for (let i = 0; i < round.count; i++) {
                furthestRound = Math.max(furthestRound, Math.hypot(round.points[i * 3], round.points[i * 3 + 1]));
            }
            let seen = 0;
            let behind = 0;
            let nearestTree = Infinity;
            let widest = 0;
            for (let i = 0; i < way.count; i++) {
                const x = way.points[i * 3];
                const z = way.points[i * 3 + 1];
                const next = ((i + 1) % way.count) * 3;
                // Sampled evenly: one closed line.
                const step = Math.hypot(way.points[next] - x, way.points[next + 1] - z);
                expect(step).toBeLessThan((way.length / way.count) * 1.05);
                if (z > 0) behind += 1;
                if (z < 0 && fractionOf(x, z, aspect) < 1) {
                    seen += 1;
                    // In sight it is on the snow, beyond the fox's round, clear of every framing tree.
                    expect(landDistance(x, z), `aspect ${aspect}`).toBeGreaterThan(3);
                    expect(Math.hypot(x, z), `aspect ${aspect}`).toBeGreaterThan(furthestRound - 2.5);
                    for (let k = 0; k < trees.length; k++) {
                        nearestTree = Math.min(nearestTree, Math.hypot(trees[k][0] - x, trees[k][1] - z));
                    }
                }
                if (z < 0) widest = Math.max(widest, fractionOf(x, z, aspect));
            }
            expect(seen, `aspect ${aspect}`).toBeGreaterThan(way.count * 0.15);
            expect(behind, `aspect ${aspect}`).toBeGreaterThan(way.count * 0.15);
            expect(nearestTree, `aspect ${aspect}`).toBeGreaterThan(1.9);
            expect(widest, `aspect ${aspect}`).toBeGreaterThan(1.3);
            // Where it waits is behind the viewer; where it likes to stop is in sight.
            const at = (distance) => {
                const i = Math.round((distance / way.length) * way.count) % way.count;
                return [way.points[i * 3], way.points[i * 3 + 1]];
            };
            expect(at(way.gate)[1], `aspect ${aspect}`).toBeGreaterThan(5);
            way.stations.forEach((station) => {
                const [x, z] = at(station);
                expect(z).toBeLessThan(0);
                expect(fractionOf(x, z, aspect)).toBeLessThan(0.95);
            });
        });
        expect(VISITOR_WAY[0][0]).toBeLessThan(-1.3);
        expect(VISITOR_WAY[VISITOR_WAY.length - 1][0]).toBeGreaterThan(1.3);
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

    it('is the arctic fox, a little smaller, with a seed and a way of its own', () => {
        const visitor = new VisitorMind();
        const fox = new FoxMind(foxRound(16 / 9), 0xf0c5, { wander: true });
        const kind = (mind) => Object.getPrototypeOf(Object.getPrototypeOf(mind));
        expect(kind(visitor)).toBe(kind(fox));
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
        // It begins behind the viewer, out of sight, and leaves no prints.
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
            expect(inSight / seconds, label).toBeGreaterThan(0.2);
            expect(inSight / seconds, label).toBeLessThan(0.65);
            expect(comings, label).toBeGreaterThanOrEqual(6);
            // It stops where it can be seen, on the open snow, and for many kinds of thing.
            expect(stops.length, label).toBeGreaterThanOrEqual(6);
            stops.forEach((stop) => {
                expect(stop.here, `${label}: ${stop.what}`).toBe(true);
                expect(stop.fraction, `${label}: ${stop.what}`).toBeLessThan(1);
            });
            expect(new Set(stops.map((stop) => stop.what)).size, label).toBeGreaterThanOrEqual(5);
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
        let time = run(mind, 0, 8);
        expect(mind.mode).toBe('gait');
        const goingRight = Math.sin(mind.pose.heading) > 0;
        // A fox standing on its way, six metres on.
        const [x, z] = mind.course.at(mind.s + 6, [0, 0, 0]);
        let nearest = Infinity;
        const seen = new Set();
        const turnsBefore = mind.walk.turns.length;
        const meet = (m, now) => {
            expect(m.keepOff(x, z, now) || now >= m.heedFrom - 15).toBe(true);
            nearest = Math.min(nearest, Math.hypot(m.pose.x - x, m.pose.z - z));
            if (m.mode === 'idle' && m.act) seen.add(m.act.join('+'));
        };
        const steps = Math.round(40 / DT);
        for (let i = 1; i <= steps && mind.walk.turns.length === turnsBefore; i++) {
            time += DT;
            meet(mind, time);
            mind.step(DT, time, REST);
        }
        // It stopped short of it (a body's length and more), did something there, and then turned back.
        expect(nearest).toBeGreaterThan(VISITOR_MEET.room - 0.8);
        expect(nearest).toBeLessThan(VISITOR_MEET.room + 1.5);
        expect([...seen].some((what) => VISITOR_MEET.stops.some((acts) => acts.join('+') === what))).toBe(true);
        expect(mind.walk.turns.length).toBe(turnsBefore + 1);
        // On its way back the fox behind it is nothing to it.
        time = run(mind, time, 12, (m, now) => m.keepOff(x, z, now));
        expect(Math.sin(mind.pose.heading) > 0).toBe(!goingRight);
        expect(mind.speed).toBeGreaterThan(0.4);
        expect(mind.ahead).toBe(Infinity);
        // A fox off to one side of its way, or behind it, is not in its way at all.
        const free = new VisitorMind(16 / 9, 5);
        free.arrive(0, 0);
        time = run(free, 0, 8);
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
        // A frame that changes shape lays its way out anew and keeps it going.
        mind.setAspect(3 / 4);
        expect(mind.way.length).not.toBe(a.mind.way.length);
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
