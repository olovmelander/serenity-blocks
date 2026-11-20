/**
 * Painted Ages — the pennants up the stair (painted-ages-pennants.js) and the parts the living
 * pass added to the world: where the flags hang along a rail (a pure function, tried on rails
 * made here and on the walk the world really builds), and the devils' and pennants' meshes in a
 * built world.
 */
import { readFileSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';
import {
    PAINTED_AGES_PARTS, PaintedAgesWorld, REST_RIG, fovForAspect,
} from '../../src/themes/painted-ages/painted-ages-world.js';
import { FIELDS, FIELD_ORDER } from '../../src/themes/painted-ages/painted-ages-core.js';
import { PENNANT, createPennants, pennantFlags } from '../../src/themes/painted-ages/painted-ages-pennants.js';
import { DEVILS } from '../../src/themes/painted-ages/painted-ages-tsl.js';
import { decodeField, groundHeight } from '../../src/themes/painted-ages/painted-ages-field.js';
import { decodePng } from '../../scripts/painted-ages/png.mjs';

const worlds = [];
const preparedBy = {};
let fields;

beforeAll(() => {
    fields = {};
    for (const name of FIELD_ORDER) {
        const file = new URL(`../../src/themes/painted-ages/assets/badlands-${name}.png`, import.meta.url);
        const { rgba } = decodePng(readFileSync(file));
        fields[name] = { ...decodeField(rgba, FIELDS[name]), size: FIELDS[name].size, source: 'asset' };
    }
    fields.source = 'asset';
});

afterEach(() => {
    worlds.splice(0).forEach((world) => world.dispose());
});

function makeWorld(quality = 'Low') {
    preparedBy[quality] ||= PaintedAgesWorld.prepareSync(quality, fields);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fovForAspect(16 / 9), 16 / 9, REST_RIG.near, REST_RIG.far);
    const world = new PaintedAgesWorld({
        scene, quality, capture: true, prepared: preparedBy[quality],
    }).build();
    worlds.push(world);
    world.bindCamera(camera);
    world.setViewport(1600, 900, 16 / 9);
    world.seek(10);
    world.updateCamera(camera, { time: 10, delta: 0 });
    world.update({ time: 10, delta: 0 }, camera);
    return { scene, camera, world };
}

// ── A polyline in plan, and a point against it ────────────────────────────────────

/** Cumulative length of a polyline of `{ x, z }` posts, in plan. */
function lengthsOf(line) {
    const out = [0];
    for (let i = 1; i < line.length; i += 1) {
        out.push(out[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
    }
    return out;
}
/**
 * The nearest point of the polyline to (x, z): its distance in plan, how far along the line it
 * lies, the line's height there (if the posts carry `y`) and its heading.
 */
function nearestOn(line, lengths, x, z) {
    let best = { distance: Infinity };
    for (let i = 0; i < line.length - 1; i += 1) {
        const a = line[i];
        const b = line[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len2 = dx * dx + dz * dz;
        if (!(len2 > 0)) continue;
        const f = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
        const distance = Math.hypot(x - (a.x + dx * f), z - (a.z + dz * f));
        if (distance < best.distance) {
            const len = Math.sqrt(len2);
            best = {
                distance, along: lengths[i] + f * len, y: a.y + (b.y - a.y) * f, ax: dx / len, az: dz / len,
            };
        }
    }
    return best;
}

/**
 * A walk like the overlook's: posts every 2.2 m along a line that bends both ways and climbs in
 * decks and flights, a lamp on every `every`-th post from `first` on (so posts stand before the
 * first lamp and after the last).
 */
function walk({
    posts = 70, step = 2.2, every = 11, first = 6, last = posts - 5,
} = {}) {
    const rail = [];
    let x = 3;
    let z = -8;
    let y = 160;
    let heading = -0.4;
    for (let i = 0; i < posts; i += 1) {
        rail.push({
            x, y, z, lamp: i >= first && i <= last && (i - first) % every === 0,
        });
        heading += 0.09 * Math.sin(i * 0.37) + (i % 17 === 0 ? 0.5 : 0);
        x += Math.sin(heading) * step;
        z -= Math.cos(heading) * step;
        // A deck, then a flight up, then a deck, then a few steps down.
        if (i % 12 < 4) y += 0.02;
        else y += i % 24 < 12 ? 0.55 : -0.2;
    }
    return rail;
}

/** Every flag of a rail with what it hangs on: the nearest point of the rail and the span it is in. */
function hung(rail, pitch = undefined) {
    const lengths = lengthsOf(rail);
    const lampsAt = rail.map((post, i) => (post.lamp ? lengths[i] : null)).filter((s) => s !== null);
    const flags = pitch === undefined ? pennantFlags(rail) : pennantFlags(rail, pitch);
    return {
        lengths,
        lampsAt,
        flags: flags.map((flag) => {
            const on = nearestOn(rail, lengths, flag.x, flag.z);
            const { along } = on;
            const within = (s, i) => i < lampsAt.length - 1 && along >= s - 1e-6 && along <= lampsAt[i + 1] + 1e-6;
            const span = lampsAt.findIndex(within);
            return {
                ...flag, on, span, above: flag.y - on.y,
            };
        }),
    };
}

describe('Painted Ages pennants: where the flags hang (pennantFlags)', () => {
    it('hangs flags only between two lamps, on the rail\'s own line', () => {
        const rail = walk();
        const { flags, lampsAt } = hung(rail);
        expect(lampsAt.length).toBeGreaterThanOrEqual(5);
        expect(flags.length).toBeGreaterThan(100);
        for (const flag of flags) {
            // On the line, bend for bend (never strung straight across a corner).
            expect(flag.on.distance, 'off the rail').toBeLessThan(0.05);
            // Between the first lamp and the last, inside one span.
            expect(flag.on.along).toBeGreaterThan(lampsAt[0]);
            expect(flag.on.along).toBeLessThan(lampsAt[lampsAt.length - 1]);
            expect(flag.span).toBeGreaterThanOrEqual(0);
            // Its heading is the rail's there, a unit vector on the ground.
            expect(Math.hypot(flag.ax, flag.az)).toBeCloseTo(1, 9);
            expect(flag.ax * flag.on.ax + flag.az * flag.on.az).toBeGreaterThan(0.98);
            for (const key of ['x', 'y', 'z', 'ax', 'az']) expect(Number.isFinite(flag[key]), key).toBe(true);
        }
        // Every span between two lamps has its string.
        for (let span = 0; span < lampsAt.length - 1; span += 1) {
            expect(flags.filter((flag) => flag.span === span).length, `span ${span}`).toBeGreaterThan(5);
        }
    });

    it('ties the string high at the lamps and lets it sag to its lowest mid-span, between low and head', () => {
        expect(PENNANT.head).toBeGreaterThan(PENNANT.low);
        expect(PENNANT.low).toBeGreaterThan(PENNANT.drop); // a cloth at the lowest point still clears the deck
        const { flags, lampsAt } = hung(walk());
        for (const flag of flags) {
            expect(flag.above).toBeGreaterThanOrEqual(PENNANT.low - 1e-6);
            expect(flag.above).toBeLessThanOrEqual(PENNANT.head + 1e-6);
        }
        for (let span = 0; span < lampsAt.length - 1; span += 1) {
            const string = flags.filter((flag) => flag.span === span).sort((a, b) => a.on.along - b.on.along);
            const middle = (lampsAt[span] + lampsAt[span + 1]) / 2;
            const fromMiddle = (flag) => Math.abs(flag.on.along - middle);
            const lowest = string.reduce((a, b) => (b.above < a.above ? b : a));
            // The lowest flag is the one nearest the middle, and it hangs at rail height.
            const nearestMiddle = string.reduce((a, b) => (fromMiddle(b) < fromMiddle(a) ? b : a));
            expect(fromMiddle(lowest)).toBeLessThanOrEqual(fromMiddle(nearestMiddle) + 1e-6);
            expect(lowest.above).toBeLessThan(PENNANT.low + 0.05 * (PENNANT.head - PENNANT.low));
            // The first and the last hang near the lamps' heads.
            for (const end of [string[0], string[string.length - 1]]) {
                expect(end.above).toBeGreaterThan(PENNANT.head - 0.2 * (PENNANT.head - PENNANT.low));
            }
            // Down to the middle, then up again: one sag, no ripple in the string itself.
            const at = string.indexOf(lowest);
            for (let i = 1; i < string.length; i += 1) {
                const step = string[i].above - string[i - 1].above;
                if (i <= at) expect(step, `span ${span}, flag ${i} (down)`).toBeLessThanOrEqual(1e-9);
                else expect(step, `span ${span}, flag ${i} (up)`).toBeGreaterThanOrEqual(-1e-9);
            }
        }
    });

    it('spaces the flags about a pitch apart, and a doubled pitch gives about half of them', () => {
        const rail = walk();
        const { flags, lampsAt } = hung(rail);
        for (let span = 0; span < lampsAt.length - 1; span += 1) {
            const string = flags.filter((flag) => flag.span === span).sort((a, b) => a.on.along - b.on.along);
            for (let i = 1; i < string.length; i += 1) {
                const gap = string[i].on.along - string[i - 1].on.along;
                // Never closer than a pitch (cloths would overlap), never a gap of two.
                expect(gap, `span ${span}, flag ${i}`).toBeGreaterThanOrEqual(PENNANT.pitch - 1e-6);
                expect(gap, `span ${span}, flag ${i}`).toBeLessThan(2 * PENNANT.pitch);
            }
        }
        expect(PENNANT.pitch).toBeGreaterThanOrEqual(PENNANT.width); // side by side, not over each other
        const sparse = pennantFlags(rail, PENNANT.pitch * 2);
        expect(sparse.length / flags.length).toBeGreaterThan(0.4);
        expect(sparse.length / flags.length).toBeLessThan(0.6);
        // The default pitch is PENNANT.pitch.
        expect(pennantFlags(rail, PENNANT.pitch)).toEqual(pennantFlags(rail));
        // The sparser string still hangs on the rail, between its lamps.
        for (const flag of hung(rail, PENNANT.pitch * 2).flags) {
            expect(flag.on.distance).toBeLessThan(0.05);
            expect(flag.span).toBeGreaterThanOrEqual(0);
            expect(flag.above).toBeGreaterThanOrEqual(PENNANT.low - 1e-6);
            expect(flag.above).toBeLessThanOrEqual(PENNANT.head + 1e-6);
        }
    });

    it('follows a rail whatever its shape: straight, a hairpin, a steep flight', () => {
        const straight = Array.from({ length: 30 }, (_, i) => ({
            x: i * 2, y: 100, z: 5, lamp: i % 10 === 0,
        }));
        const hairpin = Array.from({ length: 40 }, (_, i) => ({
            x: 20 * Math.cos(i * 0.16), y: 50 + i * 0.3, z: 20 * Math.sin(i * 0.16), lamp: i % 8 === 0,
        }));
        const flight = Array.from({ length: 30 }, (_, i) => ({
            x: 0, y: 10 + i * 1.5, z: -i * 2, lamp: i % 9 === 2,
        }));
        for (const [name, rail] of Object.entries({ straight, hairpin, flight })) {
            const { flags } = hung(rail);
            expect(flags.length, name).toBeGreaterThan(20);
            for (const flag of flags) {
                expect(flag.on.distance, name).toBeLessThan(0.05);
                expect(flag.span, name).toBeGreaterThanOrEqual(0);
                expect(flag.above, name).toBeGreaterThanOrEqual(PENNANT.low - 1e-6);
                expect(flag.above, name).toBeLessThanOrEqual(PENNANT.head + 1e-6);
            }
        }
    });

    it('gives none for a rail with fewer than two lamps, and does not touch the rail it reads', () => {
        const none = walk().map((post) => ({ ...post, lamp: false }));
        const one = none.map((post, i) => ({ ...post, lamp: i === 20 }));
        expect(pennantFlags(none)).toEqual([]);
        expect(pennantFlags(one)).toEqual([]);
        expect(pennantFlags([])).toEqual([]);
        expect(pennantFlags([{
            x: 0, y: 0, z: 0, lamp: true,
        }])).toEqual([]);
        const rail = walk();
        const copy = structuredClone(rail);
        pennantFlags(rail);
        expect(rail).toEqual(copy);
        // The same rail gives the same flags (no dice in it).
        expect(pennantFlags(rail)).toEqual(pennantFlags(copy));
    });
});

describe('Painted Ages pennants: the mesh', () => {
    it('is one quad a flag, pinned along its top edge, in the cloths\' colours in turn', () => {
        const { world } = makeWorld();
        const rail = walk();
        const flags = pennantFlags(rail);
        const part = createPennants(world.u, world.textures, rail, world.tier);
        try {
            expect(part.mesh.isMesh).toBe(true);
            expect(part.mesh.material.isNodeMaterial).toBe(true);
            expect(part.count).toBe(part.flags.length);
            const full = world.tier.props > 0;
            expect(part.count).toBe(full ? flags.length : pennantFlags(rail, PENNANT.pitch * 2).length);
            const { position, aFlag, aTint } = part.mesh.geometry.attributes;
            expect(position.count).toBe(part.count * 4);
            expect(part.mesh.geometry.index.count).toBe(part.count * 6);
            for (let n = 0; n < part.count; n += 1) {
                const flag = part.flags[n];
                const corners = [n * 4, n * 4 + 1, n * 4 + 2, n * 4 + 3].map((v) => ({
                    x: position.getX(v), y: position.getY(v), z: position.getZ(v), free: aFlag.getX(v),
                }));
                const pinned = corners.filter((corner) => corner.free === 0);
                const free = corners.filter((corner) => corner.free === 1);
                expect(pinned).toHaveLength(2);
                expect(free).toHaveLength(2);
                // The pinned edge lies on the string at the flag's point; the cloth hangs down from it.
                for (const corner of pinned) {
                    expect(corner.y).toBeCloseTo(flag.y, 3);
                    expect(Math.hypot(corner.x - flag.x, corner.z - flag.z)).toBeCloseTo(PENNANT.width / 2, 3);
                }
                for (const corner of free) expect(corner.y).toBeCloseTo(flag.y - PENNANT.drop, 3);
            }
            // More than one colour, each a real colour.
            const tints = new Set();
            for (let n = 0; n < part.count; n += 1) {
                tints.add([aTint.getX(n * 4), aTint.getY(n * 4), aTint.getZ(n * 4)].map((v) => v.toFixed(3)).join());
            }
            expect(tints.size).toBeGreaterThanOrEqual(3);
            for (let i = 0; i < aTint.array.length; i += 1) {
                expect(aTint.array[i]).toBeGreaterThanOrEqual(0);
                expect(aTint.array[i]).toBeLessThanOrEqual(1);
            }
            for (const attribute of [position, aFlag, aTint]) {
                expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
            }
        } finally {
            part.dispose();
        }
    });

    it('is still a mesh, drawing nothing, for a rail with no lamps', () => {
        const { world } = makeWorld();
        const rail = walk().map((post) => ({ ...post, lamp: false }));
        for (const given of [rail, []]) {
            const part = createPennants(world.u, world.textures, given, world.tier);
            try {
                expect(part.mesh.isMesh).toBe(true);
                expect(part.mesh.material.isNodeMaterial).toBe(true);
                expect(part.count).toBe(0);
                expect(part.flags).toEqual([]);
                expect(part.mesh.geometry.index.count).toBe(0);
                expect(Array.from(part.mesh.geometry.attributes.position.array).every(Number.isFinite)).toBe(true);
                expect(Number.isFinite(part.mesh.geometry.boundingSphere.radius)).toBe(true);
            } finally {
                part.dispose();
            }
        }
    });
});

describe('Painted Ages: the parts the living pass added to a built world', () => {
    it('carries the pennants in the props part, strung along the walk between its lamps', () => {
        const { world } = makeWorld('Low');
        const { props } = world.parts;
        const mesh = props.meshes.find((m) => m.name === 'PaintedAgesPennants');
        expect(mesh).toBeTruthy();
        expect(mesh).toBe(props.pennants.mesh);
        expect(mesh.parent).toBe(world.root);
        expect(mesh.material.isNodeMaterial).toBe(true);
        expect(mesh.material.fog).toBe(false);
        const { flags } = props.pennants;
        expect(flags.length).toBeGreaterThan(100);
        expect(mesh.geometry.index.count).toBe(flags.length * 6);
        // The walk's centre line, and its lamps (the halos' warm ones).
        const crest = props.crest.map((p) => ({ x: p.x, y: p.y, z: p.z }));
        const lengths = lengthsOf(crest);
        const lamps = props.glows.filter((glow) => glow[4] === 1).map(([x, y, z]) => ({
            x, y, z, on: nearestOn(crest, lengths, x, z),
        }));
        expect(lamps.length).toBeGreaterThanOrEqual(3);
        const firstLamp = Math.min(...lamps.map((lamp) => lamp.on.along));
        const lastLamp = Math.max(...lamps.map((lamp) => lamp.on.along));
        for (const flag of flags) {
            const on = nearestOn(crest, lengths, flag.x, flag.z);
            // Beside the deck on the lamps' side (about a metre from the walk's middle), never out over the slope.
            expect(on.distance).toBeGreaterThan(0.4);
            expect(on.distance).toBeLessThan(1.6);
            expect(on.along).toBeGreaterThan(firstLamp - 1.5);
            expect(on.along).toBeLessThan(lastLamp + 1.5);
            // Over the ground at about a rail's to a lamp's height: never in it, never high in the air.
            const over = flag.y - groundHeight(fields, flag.x, flag.z, true);
            expect(over).toBeGreaterThan(PENNANT.low);
            expect(over).toBeLessThan(PENNANT.head + 6);
        }
        // Every lamp has a flag tied close by, at about the height of its head.
        for (const lamp of lamps) {
            const away = (flag) => Math.hypot(flag.x - lamp.x, flag.z - lamp.z);
            const nearest = flags.reduce((a, b) => (away(b) < away(a) ? b : a));
            expect(away(nearest)).toBeLessThan(2 * PENNANT.pitch);
            expect(Math.abs(nearest.y - lamp.y)).toBeLessThan(0.5);
        }
    });

    it('keeps the pennants at Minimal, about half as many', () => {
        const low = makeWorld('Low').world.parts.props.pennants.count;
        const minimal = makeWorld('Minimal').world.parts.props.pennants.count;
        expect(minimal).toBeGreaterThan(50);
        expect(minimal / low).toBeGreaterThan(0.4);
        expect(minimal / low).toBeLessThan(0.6);
    });

    it('lists the devils among the parts, one card a devil, drawn over the land and the sky', () => {
        expect(PAINTED_AGES_PARTS).toContain('devils');
        const { world } = makeWorld();
        expect(world.getState().parts).toContain('devils');
        const { mesh } = world.parts.devils;
        expect(mesh.name).toBe('PaintedAgesDevils');
        expect(mesh.parent).toBe(world.root);
        expect(mesh.material.isNodeMaterial).toBe(true);
        expect(mesh.geometry.attributes.position.count).toBe(DEVILS * 4);
        expect(mesh.geometry.index.count).toBe(DEVILS * 6);
        // Its cards move in the vertex stage, so it may never be culled by where its buffer says it is.
        expect(mesh.frustumCulled).toBe(false);
        expect(mesh.material.transparent).toBe(true);
        expect(mesh.material.depthWrite).toBe(false);
        expect(mesh.renderOrder).toBeGreaterThan(world.parts.land.mesh.renderOrder);
        expect(mesh.renderOrder).toBeGreaterThan(world.parts.sky.mesh.renderOrder);
        // Each card's corners carry their own devil's row.
        const slots = Array.from(mesh.geometry.attributes.aSlot.array);
        for (let i = 0; i < DEVILS; i += 1) expect(slots.slice(i * 4, i * 4 + 4)).toEqual([i, i, i, i]);
    });

    it('hides and shows the devils and the pennants with showOnlyParts', () => {
        const { world } = makeWorld();
        const devils = world.parts.devils.mesh;
        const pennants = world.parts.props.pennants.mesh;
        expect(devils.visible).toBe(true);
        expect(pennants.visible).toBe(true);
        world.showOnlyParts(['land', 'sky']);
        expect(devils.visible).toBe(false);
        expect(pennants.visible).toBe(false);
        world.showOnlyParts(['devils']);
        expect(devils.visible).toBe(true);
        expect(world.parts.land.mesh.visible).toBe(false);
        expect(pennants.visible).toBe(false);
        world.showOnlyParts(['props']);
        expect(devils.visible).toBe(false);
        world.parts.props.meshes.forEach((mesh) => expect(mesh.visible, mesh.name).toBe(true));
        world.showOnlyParts(PAINTED_AGES_PARTS);
        for (const name of PAINTED_AGES_PARTS) {
            const part = world.parts[name];
            for (const mesh of part.meshes || [part.mesh]) expect(mesh.visible, name).toBe(true);
        }
    });
});
