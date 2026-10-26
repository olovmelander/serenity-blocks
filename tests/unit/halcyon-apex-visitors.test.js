/**
 * Halcyon Apex — the visitors: the hulls, the schedule, the routes as the rest camera sees them,
 * the world's handling of them, and their two materials built through both node builders.
 */
import {
    describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three/webgpu';
import { context } from 'three/tsl';
import { HalcyonApexWorld, REST_RIG } from '../../src/themes/halcyon-apex/halcyon-apex-world.js';
import { SITE, compositionFor } from '../../src/themes/halcyon-apex/halcyon-apex-core.js';
import { fallbackLayout } from '../../src/themes/halcyon-apex/halcyon-apex-composition.js';
import {
    FIRST_VISIT,
    LAMP_SLOTS,
    VISITOR_KIND,
    VISITOR_KINDS,
    VISITOR_LAMPS,
    VISITOR_ROUTE,
    VISITOR_ROUTES,
    VISIT_SLOT,
    buildHulls,
    scheduleRoutes,
    slotVisit,
    visitAt,
    visitorPose,
} from '../../src/themes/halcyon-apex/halcyon-apex-visitor-plan.js';
import { VISITOR_WARM_FRAMES } from '../../src/themes/halcyon-apex/halcyon-apex-visitors.js';

vi.setConfig({ testTimeout: 60000 });

function makeWorld(quality = 'Minimal', width = 1600, height = 900) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, REST_RIG.near, REST_RIG.far);
    const world = new HalcyonApexWorld({ scene, quality, capture: true }).build();
    world.bindCamera(camera);
    world.setViewport(width, height, width / height);
    world.setLayout(fallbackLayout(width, height), width / height);
    world.seek(0);
    return { scene, camera, world };
}

function step(world, camera, time, delta = 1 / 60) {
    const sim = { time, delta };
    world.updateCamera(camera, sim);
    world.update(sim, camera);
}

/** The frame the world hands the visitors (as world.update builds it). */
function frameOf(world) {
    const comp = compositionFor(world.aspect);
    return {
        yaw: comp.yaw,
        upright: 1 - comp.wide,
        eye: REST_RIG.height,
        halcyonTop: [world.halcyon[0], world.halcyon[1] + SITE.halcyon.half, world.halcyon[2]],
    };
}

describe('the visitors\' hulls', () => {
    const hulls = buildHulls();

    it('lie in one buffer, one contiguous range per kind, covering it exactly', () => {
        expect(hulls.ranges).toHaveLength(VISITOR_KINDS.length);
        let next = 0;
        hulls.ranges.forEach(([start, count], kind) => {
            expect(start, VISITOR_KINDS[kind]).toBe(next);
            expect(count % 3, VISITOR_KINDS[kind]).toBe(0);
            expect(count, VISITOR_KINDS[kind]).toBeGreaterThan(90);
            for (let i = start; i < start + count; i++) expect(hulls.part[i * 4 + 2]).toBe(kind);
            next += count;
        });
        expect(next).toBe(hulls.vertexCount);
        expect(hulls.vertexCount).toBeLessThan(16000);
    });

    it('face outward: every triangle winds the way its normals point, and the normals are unit length', () => {
        let wrong = 0;
        let crooked = 0;
        const { position: p, normal: n } = hulls;
        for (let i = 0; i < hulls.vertexCount; i += 3) {
            const u = [0, 1, 2].map((c) => p[(i + 1) * 3 + c] - p[i * 3 + c]);
            const v = [0, 1, 2].map((c) => p[(i + 2) * 3 + c] - p[i * 3 + c]);
            const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const sum = [0, 1, 2].map((c) => n[i * 3 + c] + n[(i + 1) * 3 + c] + n[(i + 2) * 3 + c]);
            if (cross[0] * sum[0] + cross[1] * sum[1] + cross[2] * sum[2] <= 0) wrong += 1;
            for (let k = 0; k < 3; k++) {
                const l = Math.hypot(n[(i + k) * 3], n[(i + k) * 3 + 1], n[(i + k) * 3 + 2]);
                if (Math.abs(l - 1) > 1e-3) crooked += 1;
            }
        }
        expect(wrong).toBe(0);
        expect(crooked).toBe(0);
    });

    it('are the sizes they are meant to be (metres)', () => {
        const extent = (kind) => {
            const [start, count] = hulls.ranges[VISITOR_KIND[kind]];
            const lo = [Infinity, Infinity, Infinity];
            const hi = [-Infinity, -Infinity, -Infinity];
            for (let i = start; i < start + count; i++) {
                for (let c = 0; c < 3; c++) {
                    lo[c] = Math.min(lo[c], hulls.position[i * 3 + c]);
                    hi[c] = Math.max(hi[c], hulls.position[i * 3 + c]);
                }
            }
            return hi.map((h, c) => h - lo[c]);
        };
        expect(extent('saucer')[0]).toBeCloseTo(15, 1);
        expect(extent('triangle')[2]).toBeGreaterThan(34);
        expect(extent('cigar')[0]).toBeCloseTo(198.5, 0);
        expect(extent('orbs')[1]).toBeCloseTo(2.2, 1);
        expect(extent('capsule')[0]).toBeCloseTo(13, 1);
    });

    it('carry no more lamps than the sprite pool holds, and the triangle\'s lamps hang below its belly', () => {
        VISITOR_KINDS.forEach((kind) => expect(VISITOR_LAMPS[kind].length, kind).toBeLessThanOrEqual(LAMP_SLOTS));
        VISITOR_LAMPS.triangle.forEach((lamp) => expect(lamp.at[1]).toBeLessThan(-0.6));
    });
});

describe('the schedule', () => {
    it('opens with the saucer some fifteen seconds in, the slow triangle under reduced motion', () => {
        expect(visitAt(FIRST_VISIT - 0.5)).toBeNull();
        expect(visitAt(FIRST_VISIT + 2)?.route.name).toBe('saucer');
        expect(visitAt(FIRST_VISIT + 2, true)?.route.name).toBe('triangle');
    });

    it('sends about one visitor a minute, never two at once, every route in turn', () => {
        const visits = [];
        for (let k = 0; k < 72; k++) {
            const v = slotVisit(k);
            if (v) visits.push(v);
        }
        // An hour: about one a minute.
        expect(visits.length).toBeGreaterThan(45);
        expect(visits.length).toBeLessThan(72);
        for (let i = 1; i < visits.length; i++) {
            expect(visits[i].start).toBeGreaterThan(visits[i - 1].start + visits[i - 1].route.duration + 4);
        }
        const names = new Set(visits.slice(0, 14).map((v) => v.route.name));
        expect([...names].sort()).toEqual(VISITOR_ROUTES.map((r) => r.name).sort());
        // A visit stays inside its slot, so visitAt only ever looks at one.
        visits.forEach((v) => {
            const slot = Math.floor(v.start / VISIT_SLOT);
            expect(v.start + v.route.duration).toBeLessThan((slot + 1) * VISIT_SLOT);
        });
    });

    it('is a function of the clock alone', () => {
        for (let t = 0; t < 900; t += 7.3) {
            const a = visitAt(t);
            const b = visitAt(t);
            expect(a?.route.name ?? null).toBe(b?.route.name ?? null);
            expect(a?.age ?? null).toBe(b?.age ?? null);
        }
    });

    it('flies only the slow routes under reduced motion', () => {
        expect(scheduleRoutes(true).every((r) => r.calm)).toBe(true);
        for (let k = 0; k < 40; k++) {
            const v = slotVisit(k, true);
            if (v) expect(v.route.calm, v.route.name).toBe(true);
        }
    });
});

describe('the routes, as the rest camera sees them', () => {
    const { world } = makeWorld();
    const camera = world.restCamera();
    const layout = fallbackLayout(1600, 900);
    const card = layout.cards[0];
    const { hud } = layout;
    const frame = frameOf(world);
    const ndc = new THREE.Vector3();
    /** Where a world point shows (fractions, y down), or null off screen / behind. */
    const screen = (p) => {
        ndc.set(p[0], p[1], p[2]).project(camera);
        if (ndc.z > 1 || Math.abs(ndc.x) > 0.98 || Math.abs(ndc.y) > 0.98) return null;
        return { x: ndc.x * 0.5 + 0.5, y: 0.5 - ndc.y * 0.5 };
    };
    const inside = (s, r) => s.x > r.x0 && s.x < r.x1 && s.y > r.y0 && s.y < r.y1;

    it.each(VISITOR_ROUTES.map((r) => [r.name, r]))('%s is seen clear of the card and the HUD for a while', (name, route) => {
        let clear = 0;
        const dt = 0.05;
        for (let age = 0; age <= route.duration; age += dt) {
            const pose = visitorPose(route, age, frame);
            const at = pose.units ? pose.units[0] : pose.p;
            const s = screen(at);
            if (s && pose.presence > 0.5 && !inside(s, card) && !inside(s, hud)) clear += dt;
        }
        const least = { mothership: 14, triangle: 9 }[name] ?? 4;
        expect(clear, `${name}: ${clear.toFixed(1)} s in view`).toBeGreaterThan(least);
    });

    it('rise into the sky over the card on an upright screen (the Halcyon is off its edge there)', () => {
        const { world: tall } = makeWorld('Minimal', 430, 850);
        const cam = tall.restCamera();
        const tallCard = fallbackLayout(430, 850).cards[0];
        const tallFrame = frameOf(tall);
        expect(tallFrame.upright).toBeGreaterThan(0.99);
        const v3 = new THREE.Vector3();
        VISITOR_ROUTES.filter((r) => r.name !== 'halcyon').forEach((route) => {
            let clear = 0;
            for (let age = 0; age <= route.duration; age += 0.05) {
                const pose = visitorPose(route, age, tallFrame);
                v3.set(...(pose.units ? pose.units[0] : pose.p)).project(cam);
                const s = { x: v3.x * 0.5 + 0.5, y: 0.5 - v3.y * 0.5 };
                const shown = v3.z < 1 && Math.abs(v3.x) < 0.98 && Math.abs(v3.y) < 0.98;
                if (shown && pose.presence > 0.5 && !inside(s, tallCard)) clear += 0.05;
            }
            expect(clear, `${route.name}: ${clear.toFixed(1)} s in view`).toBeGreaterThan(3);
        });
        tall.dispose();
    });

    it('keeps the hovering visitors above the water and clear of the masonry they hang near', () => {
        const { capsule } = VISITOR_ROUTE;
        for (let age = 0; age < capsule.duration; age += 0.1) {
            const { p } = visitorPose(capsule, age, frame);
            expect(p[1]).toBeGreaterThan(8);
        }
        const { orbs } = VISITOR_ROUTE;
        for (let age = 0; age < orbs.duration; age += 0.1) {
            visitorPose(orbs, age, frame).units.forEach((at) => expect(at[1]).toBeGreaterThan(2));
        }
        // The halcyon saucer hangs over the diamond's top, and its beam reaches down to it.
        const visit = visitorPose(VISITOR_ROUTE.halcyon, 8, frame);
        expect(visit.beam).toBeGreaterThan(0.99);
        expect(visit.p[1]).toBeGreaterThan(frame.halcyonTop[1] + 12);
        expect(Math.hypot(visit.p[0] - frame.halcyonTop[0], visit.p[2] - frame.halcyonTop[2])).toBeLessThan(1.5);
        expect(visit.beamTo[1]).toBeLessThan(frame.halcyonTop[1]);
    });

    it('fly smoothly: no jump between frames except where a visitor leaves in a blink', () => {
        VISITOR_ROUTES.forEach((route) => {
            let last = visitorPose(route, 0, frame).p;
            for (let age = 1 / 120; age <= route.duration; age += 1 / 120) {
                const { p } = visitorPose(route, age, frame);
                const moved = Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
                // 1/120 s at the fastest a visitor cruises (some 500 m/s for the far ones).
                if (route.warp === undefined || age < route.warp) expect(moved, `${route.name} at ${age.toFixed(2)}`).toBeLessThan(4.5);
                last = p;
            }
        });
    });
});

describe('the world and its visitors', () => {
    it('builds both parts on every tier, in the lagoon\'s mirror', () => {
        ['Minimal', 'High'].forEach((quality) => {
            const { world } = makeWorld(quality);
            expect(world.parts.visitors, quality).toBeTruthy();
            expect(world.parts.visitorLights, quality).toBeTruthy();
            expect(world.parts.visitors.mesh.layers.mask).toBe(1);
            expect(world.parts.visitorLights.mesh.layers.mask).toBe(1);
            expect(world.parts.visitors.mesh.castShadow).toBe(false);
            world.dispose();
        });
    });

    it('draws every hull out of sight while its pipelines are built, then nothing until a visit', () => {
        const { world, camera } = makeWorld();
        const hulls = world.parts.visitors;
        step(world, camera, 1);
        expect(hulls.mesh.visible).toBe(true);
        expect(hulls.geometry.drawRange.count).toBe(hulls.geometry.getAttribute('position').count);
        hulls.mesh.updateMatrixWorld(true);
        expect(new THREE.Vector3().setFromMatrixPosition(hulls.mesh.matrixWorld).y).toBeLessThan(-1000);
        for (let i = 0; i < VISITOR_WARM_FRAMES + 5; i++) step(world, camera, 1 + i / 60);
        expect(hulls.mesh.visible).toBe(false);
        expect(world.parts.visitorLights.mesh.visible).toBe(false);
        expect(world.getState().visitor).toBeNull();
        world.dispose();
    });

    it('shows the scheduled visitor, drawing only its hull, the same after a seek as after a run', () => {
        const { world, camera } = makeWorld();
        const t = FIRST_VISIT + 6;
        for (let time = 0; time <= t; time += 1 / 30) step(world, camera, time, 1 / 30);
        step(world, camera, t, 0);
        const ran = world.parts.visitors.mesh.matrixWorld.clone();
        const state = world.getState().visitor;
        expect(state).toMatchObject({ route: 'saucer', kind: 'saucer' });
        const [start, count] = buildHulls().ranges[VISITOR_KIND.saucer];
        expect(world.parts.visitors.geometry.drawRange).toEqual({ start, count });
        expect(world.parts.visitors.mesh.visible).toBe(true);

        world.seek(t);
        step(world, camera, t, 0);
        expect(world.parts.visitors.mesh.matrixWorld.equals(ran)).toBe(true);
        world.dispose();
    });

    it('flies a called visitor over the schedule, and a seek forgets it', () => {
        const { world, camera } = makeWorld();
        expect(world.callVisitor('orbs', 30)).toBe(true);
        expect(world.callVisitor('nobody', 30)).toBe(false);
        world.callVisitor('mothership', 30);
        step(world, camera, 40);
        expect(world.getState().visitor).toMatchObject({ route: 'mothership', kind: 'cigar' });
        // Its lamps are lit, in the pool's first slots.
        const lights = world.parts.visitorLights.material;
        expect(lights).toBeTruthy();
        world.seek(40);
        step(world, camera, 40);
        expect(world.getState().visitor?.route ?? null).not.toBe('mothership');
        world.dispose();
    });
});

// ── The two materials through both node builders ────────────────────────────────

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

function build(Builder, object) {
    const builder = new Builder(object, stubRenderer());
    builder.scene = new THREE.Scene();
    builder.camera = new THREE.PerspectiveCamera();
    builder.context.material = object.material;
    builder.material = object.material;
    builder.build();
    return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

/** Reads of a var (or a normal builtin) where no assignment to it has certainly run. */
function unassignedReads(wgsl) {
    const NAMES = /\b(nodeVar\d+|normalViewGeometry|normalView|normalWorld)\b/g;
    const found = [];
    let stack = null;
    let header = false;
    wgsl.split('\n').forEach((raw, index) => {
        const line = raw.trim();
        if (!stack) {
            if (/^fn \w+\s*\(/.test(line)) header = true;
            if (header && /\{$/.test(line)) {
                header = false;
                stack = [{ kind: 'fn', set: new Set() }];
            }
            return;
        }
        const check = (text) => {
            (text.match(NAMES) || []).forEach((name) => {
                if (stack.some((block) => block.set.has(name))) return;
                found.push(`${name}, line ${index + 1}: ${line.slice(0, 120)}`);
            });
        };
        if (/^if\s*\(.*\)\s*\{$/.test(line)) {
            check(line);
            stack.push({ kind: 'if', set: new Set() });
        } else if (/^\}\s*else\s*\{$/.test(line)) {
            const branch = stack.pop();
            stack.push({ kind: 'else', set: new Set(), ifSet: branch.set });
        } else if (/^(for\s*\(.*\)|loop)\s*\{$/.test(line)) {
            check(line);
            stack.push({ kind: 'loop', set: new Set() });
        } else if (line === '}') {
            const block = stack.pop();
            if (block.kind === 'fn') stack = null;
            else if (block.kind === 'else') {
                block.set.forEach((name) => {
                    if (block.ifSet.has(name)) stack[stack.length - 1].set.add(name);
                });
            }
        } else if (!/^var\s+\w+\s*:[^=]*;$/.test(line)) {
            const assignment = line.match(/^(?:var\s+)?(nodeVar\d+|normalViewGeometry|normalView|normalWorld)\s*(?::[^=]*)?=(?!=)\s*(.*)$/);
            if (assignment) {
                check(assignment[2]);
                stack[stack.length - 1].set.add(assignment[1]);
            } else check(line);
        }
    });
    return found;
}

describe('the visitors\' materials', () => {
    const { world } = makeWorld('High');
    const parts = ['visitors', 'visitorLights'].map((name) => [name, world.parts[name].mesh]);

    it.each(parts)('%s builds on WGSL and GLSL without a word, NaN, equal edges or an unassigned read', (name, mesh) => {
        [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]].forEach(([label, Builder]) => {
            const heard = [];
            const listen = (...args) => heard.push(args.map(String).join(' ').slice(0, 300));
            const warn = vi.spyOn(console, 'warn').mockImplementation(listen);
            const error = vi.spyOn(console, 'error').mockImplementation(listen);
            let out;
            try {
                out = build(Builder, mesh);
            } finally {
                warn.mockRestore();
                error.mockRestore();
            }
            expect(heard, `${name} ${label}`).toEqual([]);
            ['vertex', 'fragment'].forEach((stage) => {
                const code = out[stage];
                expect(code.length, `${name} ${label} ${stage}`).toBeGreaterThan(200);
                expect(Buffer.byteLength(code), `${name} ${label} ${stage} size`).toBeLessThan(48 * 1024);
                expect(code, `${name} ${label} ${stage}`).not.toMatch(/\bNaN\b|\bInfinity\b|object Object/);
                const equal = [...code.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)].filter((m) => Number(m[1]) === Number(m[2]));
                expect(equal, `${name} ${label} ${stage}`).toEqual([]);
            });
            if (label === 'WGSL') expect(unassignedReads(out.fragment), name).toEqual([]);
        });
    });
});
