/**
 * Parhelion shader gate — no GPU needed.
 *
 * Every material the effect draws (the sky dome, the snow, the Vigil Stone and its rim, the far
 * stones, the diamond dust, the glint pool, the hound pillars and the avenue's pillars) is built
 * through three's own node builders against a stub renderer: the WGSL one the WebGPU backend uses
 * and the GLSL one of the WebGL2 fallback, at the richest tier the theme defaults to and at the
 * leanest. A graph one builder cannot turn into a shader (a var first built inside one branch, a
 * helper handed a uniform it was never given, a node glued into a string) throws, warns or shows
 * in the text here instead of leaving a part undrawn on someone's machine.
 *
 * What it cannot see: the WGSL and GLSL are not compiled (Tint, the driver), so a shader the
 * browser rejects can still pass, and nothing here says the picture is right. Sizes and noise
 * counts are tests/unit/parhelion-shader-size.test.js's.
 */

import {
    beforeAll, describe, expect, it,
} from 'vitest';
import * as THREE from 'three/webgpu';

import { FAR_STONES } from '../../src/playground/effects/parhelion-composition.js';
import { buildFarStoneMeshes, buildStoneGeometry } from '../../src/playground/effects/parhelion-geometry.js';
import * as materials from '../../src/playground/effects/parhelion-materials.js';
import * as particles from '../../src/playground/effects/parhelion-particles.js';
import {
    GROUND_RING,
    PARHELION_OPTICS_TIERS,
    ParhelionOpticsState,
} from '../../src/themes/parhelion/sim/parhelion-optics-state.js';
import { materialXNoiseFunctions } from './helpers/materialx-noise.js';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const TIERS = ['High', 'Minimal'];
const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const STAGES = ['vertex', 'fragment'];
/** The fleet's stage budget; the dome's own (tighter) one is the size test's. */
const STAGE_BUDGET = 48 * 1024;

/**
 * Words WGSL reserves (or keeps as keywords) and GLSL reserves that read like ordinary parameter
 * names (the list of tests/unit/murmuration-shaders.test.js). Not every reserved word: the ones a
 * helper is likely to be given.
 */
const RESERVED = new Set([
    'from', 'of', 'in', 'out', 'inout', 'input', 'output', 'type', 'set', 'get', 'use', 'target',
    'filter', 'smooth', 'flat', 'sample', 'patch', 'common', 'shared', 'static', 'self', 'this',
    'match', 'mod', 'module', 'move', 'new', 'null', 'pass', 'precise', 'resource', 'with', 'where',
    'meta', 'macro', 'layout', 'active', 'attribute', 'varying', 'uniform', 'buffer', 'texture',
    'fn', 'let', 'var', 'const', 'override', 'struct', 'enable', 'requires', 'switch', 'case',
    'default', 'loop', 'continuing', 'discard', 'return', 'true', 'false', 'bitcast',
]);

/** Every laid-out function a WGSL stage defines (the entry point aside): name, parameters, body. */
const WGSL_FN = /^fn (\w+)\s*\(([^)]*)\)[^{]*\{([\s\S]*?)^\}/gm;
/** Every function a GLSL stage defines: name, parameters. */
const GLSL_FN = /^(?:float|int|uint|bool|[iub]?vec[234]|mat[234]) (\w+)\s*\(([^)]*)\)\s*\{/gm;

/** The parameter names in a helper's signature, either language. */
const paramNames = (params) => params.split(',').map((p) => p.trim()).filter(Boolean)
    .map((p) => (p.includes(':') ? p.split(':')[0] : p.split(/\s+/).at(-1)).trim());

/** What a helper's body names that is neither an argument nor a local: uniforms, arrays, textures. */
const captures = (body) => body.match(/nodeUniform\d+|NodeBuffer_\w+|\bobject\.\w+|\brender\.\w+|texture\w*\(/g);

/** smoothstep() calls whose two edges are the same constant: a hard error in WGSL. */
function equalEdges(shader) {
    const number = '(-?\\d+(?:\\.\\d*)?(?:e[-+]?\\d+)?)';
    return [...shader.matchAll(new RegExp(`smoothstep\\(\\s*${number}\\s*,\\s*${number}\\s*,`, 'g'))]
        .filter((m) => Number(m[1]) === Number(m[2])).map((m) => m[0]);
}

/** A screen-space derivative, as either language spells it (implicit-LOD texture reads too). */
const DERIVATIVE = /\b(?:fwidth|dpdx|dpdy|dFdx|dFdy)(?:Fine|Coarse)?\s*\(|\btextureSample\s*\(|\btexture\s*\(/;

/**
 * Lines of a fragment stage that take a screen-space derivative (or call a function that does)
 * inside a branch or a loop whose condition is not a uniform alone. A derivative is only defined
 * where every pixel of a 2 × 2 quad runs the same code: inside a per-pixel branch WGSL refuses it
 * (derivative uniformity) and GLSL leaves its value undefined, which shows as sparkle along the
 * branch's edge. A branch on uniforms and constants alone is the same for every pixel and is let
 * through.
 * @param {string} shader one fragment stage, WGSL or GLSL
 * @returns {string[]} one line per offence
 */
function derivativesInPixelBranches(shader) {
    const lines = shader.split('\n').map((raw) => raw.trim());
    const count = (line, brace) => line.split(brace).length - 1;
    const header = /^(?:fn (\w+)\s*\(|(?:void|float|int|uint|bool|[iub]?vec[234]|mat[234]) (\w+)\s*\()/;

    // Pass 1: the functions that take a derivative themselves, then the ones that call those.
    const bodies = new Map();
    let name = null;
    let depth = 0;
    lines.forEach((line) => {
        if (depth === 0) {
            const match = line.match(header);
            if (match && !line.endsWith(';')) {
                name = match[1] || match[2];
                bodies.set(name, []);
            }
        } else if (name) bodies.get(name).push(line);
        depth += count(line, '{') - count(line, '}');
        if (depth === 0 && line.endsWith('}')) name = null;
    });
    const calls = (line, names) => names.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(line));
    const tainted = [...bodies].filter(([, body]) => body.some((line) => DERIVATIVE.test(line))).map(([fn]) => fn);
    for (let grew = true; grew;) {
        grew = false;
        bodies.forEach((body, fn) => {
            if (tainted.includes(fn) || !body.some((line) => calls(line, tainted))) return;
            tainted.push(fn);
            grew = true;
        });
    }

    // A condition every pixel answers alike: uniforms, a loop's own counter and numbers.
    const uniformOnly = (condition) => (condition
        .replace(/\b\d+(?:\.\d*)?(?:e[-+]?\d+)?[uf]?\b/gi, ' ')
        .match(/[A-Za-z_]\w*(?:\.\w+)*/g) || [])
        .every((word) => /^(?:(?:object|render)\.)?nodeUniform\d+(?:\.\w+)*$/.test(word)
            || /^(?:var|let|int|uint|i32|u32|[ijk])$/.test(word));

    // Pass 2: every line under an open per-pixel block.
    const found = [];
    const stack = [];
    lines.forEach((line, index) => {
        if (stack.some((block) => block.pixel) && (DERIVATIVE.test(line) || calls(line, tainted))) {
            found.push(`line ${index + 1}: ${line.slice(0, 140)}`);
        }
        let closed = null;
        for (let k = count(line, '}'); k > 0; k--) closed = stack.pop();
        if (!line.endsWith('{')) return;
        const control = line.match(/\b(?:if|for|while|switch)\s*\((.*)\)\s*\{$/);
        const orElse = /^\}\s*else\b/.test(line) && closed?.pixel === true;
        stack.push({ pixel: orElse || (control ? !uniformOnly(control[1]) : false) });
    });
    return found;
}

/** A seeded [0, 1) generator for the dust's attributes (never Math.random). */
function lcg(seed = 7) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Every drawable the effect builds at a tier, by the name its material is created under. */
function drawables(tierName) {
    const tier = materials.resolveParhelionTier(tierName);
    const caps = PARHELION_OPTICS_TIERS[tierName];
    const u = materials.createSharedUniforms();
    const { geometry: stone } = buildStoneGeometry();
    const snow = new THREE.PlaneGeometry(100, 100, 1, 1);
    snow.rotateX(-Math.PI / 2);
    const bursts = particles.createBurstUniforms(caps.burstSlots);
    const dust = particles.PARHELION_DUST_COUNTS[tier.name];
    return {
        createDomeMaterial: new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), materials.createDomeMaterial(u, tier)),
        createSnowMaterial: new THREE.Mesh(snow, materials.createSnowMaterial(u, tier)),
        createStoneMaterial: new THREE.Mesh(stone, materials.createStoneMaterial(u, tier)),
        createStoneRimMaterial: new THREE.Mesh(stone, materials.createStoneRimMaterial(u)),
        // One instanced mesh a menhir kind, all on one material: the first stands for them all.
        createFarStoneMaterial: buildFarStoneMeshes(materials.createFarStoneMaterial(u, tier), FAR_STONES)[0],
        createDustMaterial: particles.buildDustSprite(
            particles.createDustMaterial(u, { minimal: !tier.post }),
            { count: 32, near: dust.near > 0 ? 4 : 0 },
            lcg(),
        ),
        createGlintMaterial: particles.buildGlintSprite(
            particles.createGlintMaterial(u, bursts, caps.perSlot),
            caps.burstSlots * caps.perSlot,
        ),
        createPillarMaterial: new THREE.Mesh(
            particles.buildPillarGeometry(caps.pillars),
            particles.createPillarMaterial(u, { glitter: tier.post }),
        ),
        createAvenueMaterial: new THREE.Mesh(
            particles.buildAvenueGeometry(FAR_STONES),
            particles.createAvenueMaterial(u),
        ),
    };
}

/** The material factories the two modules export: none may dodge the gate. */
const FACTORIES = [...Object.keys(materials), ...Object.keys(particles)]
    .filter((name) => /^create\w+Material$/.test(name)).sort();

describe.each(TIERS)('parhelion shaders at %s', (quality) => {
    let parts;
    /** factory → backend → { vertex, fragment, heard } | { thrown, heard } */
    const built = {};

    beforeAll(() => {
        parts = drawables(quality);
        Object.keys(parts).forEach((name) => {
            built[name] = {};
            BACKENDS.forEach(([label, Builder]) => {
                built[name][label] = build(Builder, parts[name]);
            });
        });
    });

    it('builds every material the modules can make', () => {
        // A factory added to either module must be given a drawable here, or it dodges the gate.
        expect(Object.keys(parts).sort()).toEqual(FACTORIES);
        expect(FACTORIES.length).toBeGreaterThanOrEqual(9);
        Object.keys(parts).forEach((name) => {
            expect(parts[name].material.isNodeMaterial, name).toBe(true);
        });
    });

    it('gives every kind of far stone the attributes the one far-stone build stands for', () => {
        const meshes = buildFarStoneMeshes(parts.createFarStoneMaterial.material, FAR_STONES);
        expect(meshes.length).toBeGreaterThanOrEqual(1);
        const names = (mesh) => Object.keys(mesh.geometry.attributes).sort();
        meshes.forEach((mesh) => {
            expect(mesh.isInstancedMesh, mesh.name).toBe(true);
            expect(mesh.material, mesh.name).toBe(parts.createFarStoneMaterial.material);
            expect(names(mesh), mesh.name).toEqual(names(parts.createFarStoneMaterial));
        });
        expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(FAR_STONES.length);
    });

    it.each(FACTORIES)('%s builds for WebGPU and for the WebGL2 fallback without a word', (name) => {
        expect(built[name], `${name} has no drawable in this gate`).toBeDefined();
        BACKENDS.forEach(([label]) => {
            const out = built[name][label];
            expect(out.thrown, `${name}, ${label}: ${out.thrown?.stack ?? ''}`).toBeUndefined();
            expect(out.heard, `${name}, ${label}`).toEqual([]);
            STAGES.forEach((stage) => {
                const code = out[stage];
                const where = `${name}, ${label} ${stage}`;
                expect(typeof code, where).toBe('string');
                expect(code.length, where).toBeGreaterThan(200);
                // A feature unrolled in JS instead of looped shows up here as a module of 100 KB.
                expect(Buffer.byteLength(code), where).toBeLessThan(STAGE_BUDGET);
                // A number that was not one when it was written into the text.
                expect(code, where).not.toMatch(/\bNaN\b|\bInfinity\b/);
                // A node concatenated as a string.
                expect(code, where).not.toMatch(/object Object/);
                expect(code, where).not.toMatch(/\bundefined\b/);
                expect(equalEdges(code), where).toEqual([]);
            });
            expect(materialXNoiseFunctions(`${out.vertex}${out.fragment}`), `${name}, ${label}`).toEqual([]);
        });
        expect(built[name].WGSL.vertex).toMatch(/@vertex/);
        expect(built[name].WGSL.fragment).toMatch(/@fragment/);
        expect(built[name].GLSL.vertex).toMatch(/void main\(\)/);
        expect(built[name].GLSL.fragment).toMatch(/void main\(\)/);
    });

    it.each(FACTORIES)('%s reads no var before an assignment has certainly run', (name) => {
        // The trap a uniform If() sets: a toVar() first built inside one branch and read after it.
        STAGES.forEach((stage) => {
            expect(unassignedReads(built[name].WGSL[stage]), `${name} ${stage}`).toEqual([]);
        });
    });

    it('gives no laid-out helper a parameter named with a reserved word', () => {
        const offenders = [];
        const seen = new Set();
        Object.keys(built).forEach((name) => {
            STAGES.forEach((stage) => {
                [...built[name].WGSL[stage].matchAll(WGSL_FN), ...built[name].GLSL[stage].matchAll(GLSL_FN)]
                    .forEach((m) => {
                        seen.add(m[1]);
                        paramNames(m[2]).forEach((param) => {
                            if (RESERVED.has(param)) offenders.push(`${name} ${stage}: ${m[1]}(${param})`);
                        });
                    });
            });
        });
        expect(offenders).toEqual([]);
        // The scan saw the helpers it is about (the night's and the stars' among them).
        expect([...seen]).toEqual(expect.arrayContaining(['ph_night', 'ph_stars', 'ph_fog', 'ph_ridge']));
    });

    it('writes each shared helper once a stage, as a function of its arguments alone', () => {
        Object.keys(built).forEach((name) => {
            STAGES.forEach((stage) => {
                const found = [...built[name].WGSL[stage].matchAll(WGSL_FN)]
                    .filter((m) => /^(?:ph|od)_/.test(m[1]));
                expect(new Set(found.map((m) => m[1])).size, `${name} ${stage}`).toBe(found.length);
                found.forEach((m) => {
                    // A function with a layout is written once and reused by the materials built
                    // after it: a uniform it closed over is declared only in the first of them.
                    expect(captures(m[3]), `${m[1]} in ${name}'s ${stage} stage`).toBeNull();
                });
            });
        });
    });

    // The dome and the snow are where the pass put its branches (the night, the rays, the rings).
    it.each([
        'createDomeMaterial', 'createSnowMaterial',
    ])('%s takes no derivative inside a per-pixel branch', (name) => {
        BACKENDS.forEach(([label]) => {
            expect(derivativesInPixelBranches(built[name][label].fragment), `${name}, ${label}`).toEqual([]);
        });
    });
});

describe('parhelion uniforms of the living pass, at rest', () => {
    // The optics state cannot import the materials (they pull in three), so the two keep the same
    // resting numbers by hand: a material built with no runtime behind it (a preview, an icon
    // bake, these gates) must draw the plain a fresh optics state describes.
    const u = materials.createSharedUniforms();
    const { out } = new ParhelionOpticsState('High');
    const float32 = (vector) => vector.toArray().map(Math.fround);

    it('holds a ground row for every ring the optics state can write, all of them spent', () => {
        expect(materials.GROUND_SLOTS).toBe(GROUND_RING.slots);
        expect(u.groundSlots).toHaveLength(GROUND_RING.slots);
        expect(out.ground).toHaveLength(GROUND_RING.slots * 4);
        expect(u.uGroundCount.value).toBe(out.groundCount);
        u.groundSlots.forEach((row, i) => {
            expect(row.toArray(), `row ${i}`).toEqual(Array.from(out.ground.slice(i * 4, i * 4 + 4)));
        });
    });

    it('rests the night, the air, the shafts, the level\'s band and the avenue where a fresh state does', () => {
        expect(u.uNight.value).toBe(out.night);
        expect(u.uDusk.value).toBe(out.dusk);
        expect(u.uStars.value).toBe(out.stars);
        expect(u.uNacre.value).toBe(out.nacre);
        expect(float32(u.uAir.value)).toEqual(Array.from(out.air));
        expect(float32(u.uRays.value)).toEqual(Array.from(out.rays));
        expect(float32(u.uSweep.value)).toEqual(Array.from(out.sweep));
        expect(float32(u.uAvenue.value)).toEqual(Array.from(out.avenue));
    });

    // Was FAULT 9 (nit) (found by this test, fixed 2026-11-20; what follows is what the code did then): uStoneStars rests at 0.5 in the uniform bag and at 0.42 in the optics state
    // (STONE_STARS_REST). The effect primes every uniform before its first frame, so no player
    // sees it; a material drawn without the runtime shows a fifth more stars in the stone.
    it('rests the stone\'s stars where a fresh state does', () => {
        expect(u.uStoneStars.value).toBeCloseTo(out.stoneStars, 6);
    });
});

describe('parhelion avenue pillars', () => {
    const geometry = particles.buildAvenueGeometry(FAR_STONES);
    const lane = geometry.getAttribute('aLane');
    const rank = geometry.getAttribute('aRank');
    const hue = geometry.getAttribute('aHue');

    it('stands one quad over every far stone, each corner knowing its stone, its turn and its light', () => {
        expect(geometry.getAttribute('position').count).toBe(FAR_STONES.length * 4);
        expect(geometry.index.count).toBe(FAR_STONES.length * 6);
        expect(materials.createSharedUniforms().uFarStones.array).toHaveLength(FAR_STONES.length);
        FAR_STONES.forEach((stone, i) => {
            for (let corner = 0; corner < 4; corner++) {
                const at = i * 4 + corner;
                expect(lane.getX(at), `stone ${i}`).toBe(i);
                expect(rank.getX(at), `stone ${i}`).toBe(rank.getX(i * 4));
                expect(hue.getX(at), `stone ${i}`).toBe(hue.getX(i * 4));
            }
            expect(hue.getX(i * 4)).toBeGreaterThanOrEqual(0);
            expect(hue.getX(i * 4)).toBeLessThanOrEqual(1);
        });
    });

    it('runs the wave out from the nearest stone to the farthest, no two stones on one beat', () => {
        const distanceAt = [];
        const hueAt = [];
        FAR_STONES.forEach((stone, i) => {
            const place = rank.getX(i * 4);
            expect(Number.isInteger(place) && place >= 0 && place < FAR_STONES.length, `stone ${i}`).toBe(true);
            expect(distanceAt[place], `rank ${place} given twice`).toBeUndefined();
            distanceAt[place] = Math.hypot(stone[0], stone[1]);
            hueAt[place] = hue.getX(i * 4);
        });
        for (let place = 1; place < FAR_STONES.length; place++) {
            expect(distanceAt[place], `rank ${place}`).toBeGreaterThanOrEqual(distanceAt[place - 1]);
            // Each stone's light differs from the one before it in the wave.
            expect(hueAt[place], `rank ${place}`).not.toBe(hueAt[place - 1]);
        }
    });
});

describe('the derivative scan itself', () => {
    it('finds a derivative under a per-pixel branch, directly or through a helper, in both languages', () => {
        const wgsl = [
            'fn ph_edge ( p : f32 ) -> f32 {',
            'return fwidth( p );',
            '}',
            'fn main() -> f32 {',
            'var nodeVar0 : f32;',
            'if ( ( nodeVarying1.x > 0.5 ) ) {',
            'nodeVar0 = ph_edge( nodeVarying1.y );',
            '}',
            'if ( ( object.nodeUniform3 > 0.004 ) ) {',
            'nodeVar0 = dpdx( nodeVarying1.y );',
            '}',
            'return nodeVar0;',
            '}',
        ].join('\n');
        expect(derivativesInPixelBranches(wgsl)).toEqual(['line 7: nodeVar0 = ph_edge( nodeVarying1.y );']);
        const glsl = [
            'void main() {',
            'float nodeVar0;',
            'if ( ( nodeUniform4 > 0.5 ) ) {',
            'nodeVar0 = 1.0;',
            '} else {',
            'nodeVar0 = dFdy( nodeVarying1.y );',
            '}',
            'if ( ( nodeVarying1.x > 0.5 ) ) {',
            'nodeVar0 = dFdx( nodeVarying1.y );',
            '} else {',
            'nodeVar0 = fwidth( nodeVarying1.x );',
            '}',
            'for ( int i = 0; i < nodeUniform2; i ++ ) {',
            'nodeVar0 += fwidth( nodeVarying1.y );',
            '}',
            'for ( int i = 0; i < int( nodeVarying1.x ); i ++ ) {',
            'nodeVar0 += fwidth( nodeVarying1.y );',
            '}',
            '}',
        ].join('\n');
        expect(derivativesInPixelBranches(glsl)).toEqual([
            'line 9: nodeVar0 = dFdx( nodeVarying1.y );',
            'line 11: nodeVar0 = fwidth( nodeVarying1.x );',
            'line 17: nodeVar0 += fwidth( nodeVarying1.y );',
        ]);
    });
});
