/**
 * What the installed three's node builder does with the shapes the skill's emission rules are
 * about (`.claude/skills/webgpu-threejs-tsl/gotchas/tsl-emission.md`, "The model").
 *
 * The skill teaches these as facts about the pinned three, and one of them changed without
 * notice between releases: up to r186 a value first built inside one branch read ZERO in the
 * others (gotchas #68, #171, #205, #209, #212, #239); r187 writes it again in every scope that
 * reads it. Nothing in the migration guide or the upgrade record said so; it was found by
 * building the shapes. So the shapes are built here, with no GPU, and each rule is held to what
 * the builder really emits. When a three bump turns one of these red, the builder changed:
 * re-read "The model" and the rows it cites, and correct them in the bump commit (ADR-0018).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, attribute, float, int, normalWorld, normalize, positionWorld, select, uniform, uniformArray,
    varying, vec3, vec4,
} from 'three/tsl';
import { build, unassignedReads } from './helpers/tsl-node-build.js';

const kind = () => attribute('aKind', 'float');
const sun = vec3(0.3, 0.8, 0.5);
const rows = uniformArray([new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()], 'vec4');
const count = uniform(0, 'int');

function meshWith(setup) {
    const material = new THREE.MeshBasicNodeMaterial();
    setup(material);
    const geometry = new THREE.SphereGeometry(1, 8, 8);
    geometry.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
    return new THREE.Mesh(geometry, material);
}

/** The body of the fragment's main(), one statement a line, comments dropped. */
function fragmentMain(mesh) {
    const built = build(THREE.WGSLNodeBuilder, mesh);
    expect(built.thrown, String(built.thrown?.stack ?? '')).toBeUndefined();
    expect(built.heard).toEqual([]);
    const main = built.fragment.split('@fragment')[1];
    return { built, lines: main.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//')) };
}

describe('TSL emission on the installed three (the skill\'s "model")', () => {
    it('computes a pinned value once, before the branch', () => {
        const { lines, built } = fragmentMain(meshWith((material) => {
            material.colorNode = Fn(() => {
                const N = normalize(normalWorld).toVar();
                const leaf = normalize(N.add(vec3(0.0, 0.4, 0.0))).dot(sun).mul(0.5).add(0.5);
                const bark = N.dot(sun).max(0.0);
                return vec4(vec3(select(kind().greaterThan(0.5), leaf, bark)), 1.0);
            })();
        }));
        const firstIf = lines.findIndex((line) => line.startsWith('if '));
        const assignments = lines.filter((line) => line.startsWith('normalWorld ='));
        expect(assignments.length).toBe(1);
        expect(lines.findIndex((line) => line.startsWith('normalWorld ='))).toBeLessThan(firstIf);
        expect(unassignedReads(built.fragment)).toEqual([]);
    });

    it('writes an unpinned shared value again in each branch (the cost of not pinning)', () => {
        const { lines, built } = fragmentMain(meshWith((material) => {
            material.colorNode = Fn(() => {
                const leaf = normalize(normalWorld.add(vec3(0.0, 0.4, 0.0))).dot(sun).mul(0.5).add(0.5);
                const bark = normalWorld.dot(sun).max(0.0);
                return vec4(vec3(select(kind().greaterThan(0.5), leaf, bark)), 1.0);
            })();
        }));
        // r187: one assignment per arm. (r186 assigned in the first arm only: the other read zero.)
        expect(lines.filter((line) => line.startsWith('normalWorld =')).length).toBe(2);
        expect(unassignedReads(built.fragment)).toEqual([]);
    });

    it('does not leave a branch reading zero in the shapes of gotchas #68, #171, #209 and #239', () => {
        const moduleLevelVar = positionWorld.mul(0.5).toVar();
        const sharedByTwoRoots = positionWorld.y.mul(0.1).toVar();
        const perInstance = attribute('aKind', 'float').mul(2.0).toVar();
        const direction = vec3(0.3, 0.8, 0.5).normalize();
        const shapes = {
            'a module-level toVar read in both arms of an If/Else': (material) => {
                material.colorNode = Fn(() => {
                    const out = vec3(0).toVar();
                    If(kind().greaterThan(0.5), () => { out.assign(moduleLevelVar.add(1.0)); })
                        .Else(() => { out.assign(moduleLevelVar.mul(2.0)); });
                    return vec4(out, 1.0);
                })();
            },
            'a value shared by two graph roots': (material) => {
                material.transparent = true;
                material.colorNode = Fn(() => {
                    const out = vec3(0).toVar();
                    If(kind().greaterThan(0.5), () => { out.assign(vec3(sharedByTwoRoots)); });
                    return vec4(out, 1.0);
                })();
                material.opacityNode = sharedByTwoRoots.add(0.2);
            },
            'two varyings that share a per-instance value': (material) => {
                const a = varying(Fn(() => {
                    const sum = float(0).toVar();
                    Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'a' }, ({ a: i }) => {
                        sum.addAssign(rows.element(i).x.mul(perInstance));
                    });
                    return sum;
                })(), 'probeA');
                const b = varying(Fn(() => perInstance.add(1.0))(), 'probeB');
                material.colorNode = vec4(a, b, 0, 1);
            },
            'a module-level constant direction read inside a branch and outside it': (material) => {
                material.colorNode = Fn(() => {
                    const out = float(0).toVar();
                    If(kind().greaterThan(0.5), () => { out.assign(normalWorld.dot(direction)); });
                    return vec4(vec3(out.add(positionWorld.normalize().dot(direction))), 1.0);
                })();
            },
        };
        for (const [name, setup] of Object.entries(shapes)) {
            const built = build(THREE.WGSLNodeBuilder, meshWith(setup));
            expect(built.thrown, `${name}: ${built.thrown?.stack ?? ''}`).toBeUndefined();
            expect(unassignedReads(built.vertex), `${name} (vertex)`).toEqual([]);
            expect(unassignedReads(built.fragment), `${name} (fragment)`).toEqual([]);
        }
    });

    it('still emits a value where it is USED: one read after an assign sees the new value (gotcha #200)', () => {
        const march = (pin) => meshWith((material) => {
            material.colorNode = Fn(() => {
                const prev = float(0).toVar();
                const sum = float(0).toVar();
                Loop({ start: int(0), end: int(4), type: 'int', condition: '<' }, ({ i }) => {
                    const t = i.toFloat().mul(0.25);
                    const ds = pin ? t.sub(prev).toVar() : t.sub(prev);
                    prev.assign(t);
                    sum.addAssign(ds);
                });
                return vec4(vec3(sum), 1.0);
            })();
        });
        const body = (mesh) => {
            const { lines } = fragmentMain(mesh);
            const from = lines.findIndex((line) => line.startsWith('for '));
            return lines.slice(from + 1, lines.indexOf('}', from));
        };
        // Unpinned: the subtraction is written inside the sum, after prev was overwritten.
        const unpinned = body(march(false));
        expect(unpinned.at(-1)).toMatch(/-\s*nodeVar\d+/);
        // Pinned: the step is its own statement, and it comes before the overwrite.
        const pinned = body(march(true));
        const step = pinned.findIndex((line) => /^nodeVar\d+ = \(.* - nodeVar\d+ \);$/.test(line));
        expect(step, pinned.join('\n')).toBeGreaterThanOrEqual(0);
        expect(pinned.at(-1)).not.toMatch(/-\s*nodeVar\d+/);
    });

    it('still calls a helper again for each read of its unpinned result (gotcha #228)', () => {
        const field = Fn(([pIn]) => vec3(pIn.x, pIn.y, pIn.x.mul(pIn.y)))
            .setLayout({ name: 'probe_field', type: 'vec3', inputs: [{ name: 'pIn', type: 'vec3' }] });
        const calls = (pin) => {
            const { built } = fragmentMain(meshWith((material) => {
                material.colorNode = Fn(() => {
                    const least = float(1).toVar();
                    const total = float(0).toVar();
                    Loop(4, () => {
                        const height = pin ? field(positionWorld).x.toVar() : field(positionWorld).x;
                        least.assign(height.min(least));
                        total.addAssign(height.max(0.01));
                    });
                    return vec4(vec3(least.mul(total)), 1.0);
                })();
            }));
            return built.fragment.split('@fragment')[1].match(/probe_field\(/g)?.length ?? 0;
        };
        expect(calls(false)).toBe(2);
        expect(calls(true)).toBe(1);
    });

    it('still drops a Loop built outside any Fn, without a word (gotcha #230)', () => {
        const { lines } = fragmentMain(meshWith((material) => {
            const shade = float(1).toVar();
            Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'c' }, ({ c: i }) => {
                shade.mulAssign(rows.element(i).z);
            });
            material.colorNode = vec4(vec3(shade), 1.0);
        }));
        expect(lines.some((line) => line.startsWith('for '))).toBe(false);
    });

    it('still throws on an If outside any Fn', () => {
        expect(() => If(kind().greaterThan(0.5), () => {})).toThrow();
    });
});
