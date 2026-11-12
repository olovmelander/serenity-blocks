/**
 * MaterialX noise in a GENERATED shader, found by what it is, not by what it is called.
 *
 * three's MaterialX noises (`mx_noise_*`, `mx_fractal_noise_*`, `mx_worley_noise_*`,
 * `mx_cell_noise_*`, `mx_unifiednoise*`) hash their lattice with integer arithmetic that the
 * shader compiler inlines at every evaluation: 20 evaluations made one pipeline take 7.3 s to
 * compile (the skill's gotcha #80). Theme shaders must not hold them, and the shader gates check.
 *
 * Until 2026-11 they checked by NAME: `/mx_\w+/` on the generated WGSL and GLSL. On three r187
 * that finds nothing, whatever the shader holds: three now writes those functions under
 * generated names (`fn61`, `fn63`, …), so a material built on `mx_noise_float` passed every one
 * of 41 gates. A check that cannot fail is not a check.
 *
 * So this one is calibrated against the installed three each time it runs. It builds a small
 * material on every MaterialX noise three exports, notes which functions those shaders define,
 * takes away the ones a shader without MaterialX noise defines too, and then looks for the rest
 * in the shader it is given. The generated names differ from one three version to the next and
 * are never written down here; within one process a function keeps its name, which is all this
 * needs. `tests/unit/materialx-noise-gate.test.js` proves it fires on every family on both
 * backends and stays quiet on the repo's own noise, so the next change in three turns that test
 * red instead of turning the gates blind again.
 *
 * It reads generated text only. The ban on the SOURCE (`/\bmx_\w+\s*[(,]/` in a theme's own
 * test) is a separate check and still stands.
 */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { build } from './tsl-node-build.js';

/** The exports this gate is about. Colour helpers (`mx_hsvtorgb`, …) are not noise. */
const NOISE_EXPORT = /^mx_(?:noise|fractal_noise|worley_noise|cell_noise|unifiednoise)/;

/** Return types a GLSL function three emits can have. */
const GLSL_TYPE = '(?:float|int|uint|bool|void|[iub]?vec[234]|mat[234](?:x[234])?)';
const WGSL_DEFINITION = /^[ \t]*fn[ \t]+([A-Za-z_]\w*)[ \t]*\(/gm;
const GLSL_DEFINITION = new RegExp(`^[ \\t]*${GLSL_TYPE}[ \\t]+([A-Za-z_]\\w*)[ \\t]*\\([^;{}]*\\)[ \\t]*\\{`, 'gm');

/**
 * The functions a WGSL or GLSL module defines, `main` aside.
 * @param {string} shader
 * @returns {Set<string>}
 */
export function definedFunctions(shader) {
    const names = new Set();
    const text = String(shader ?? '');
    for (const match of text.matchAll(WGSL_DEFINITION)) names.add(match[1]);
    for (const match of text.matchAll(GLSL_DEFINITION)) names.add(match[1]);
    names.delete('main');
    return names;
}

function shaderOf(node) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = TSL.Fn(() => TSL.vec4(TSL.vec4(node()).x, 0.0, 0.0, 1.0))();
    const built = build(THREE.WGSLNodeBuilder, new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material));
    return built.thrown ? null : `${built.vertex}\n${built.fragment}`;
}

/** Ways to call a MaterialX node whose signature we do not want to know: the first that builds wins. */
const ARGUMENTS = [
    () => [TSL.positionLocal],
    () => [TSL.uv()],
    () => [TSL.int(0), TSL.positionLocal],
    () => [TSL.int(0), TSL.uv()],
    () => [TSL.positionLocal.x],
];

let calibration = null;

/**
 * What the installed three defines for MaterialX noise, by building it.
 * @returns {{ names: Set<string>, families: Map<string, Set<string>>, skipped: string[] }}
 *   `names`: every function that only a MaterialX noise shader defines; `families`: the same per
 *   export (an export no argument shape could build is in `skipped`)
 */
export function materialXNoiseCalibration() {
    if (calibration) return calibration;
    const exportsOf = (wanted) => Object.keys(TSL).filter((name) => name.startsWith('mx_') && typeof TSL[name] === 'function' && wanted(name)).sort();
    const tryAll = (name, keep) => {
        let builtOnce = false;
        for (const args of ARGUMENTS) {
            let text = null;
            try {
                text = shaderOf(() => TSL[name](...args()));
            } catch {
                text = null;
            }
            if (text === null) continue;
            builtOnce = true;
            keep(definedFunctions(text));
        }
        return builtOnce;
    };

    // What a shader WITHOUT MaterialX noise defines: three's own helpers, and MaterialX's
    // non-noise ones. Nothing here may count as noise.
    const control = new Set();
    const add = (names) => names.forEach((name) => control.add(name));
    for (const node of [
        () => TSL.positionLocal.x,
        () => TSL.hash(TSL.positionLocal.x.mul(10.0).floor().add(100.0)),
        () => TSL.rand(TSL.uv()),
        () => TSL.triNoise3D(TSL.positionLocal, TSL.float(0.2), TSL.float(1.0)),
        () => TSL.interleavedGradientNoise(TSL.screenCoordinate.xy),
    ]) {
        const text = shaderOf(node);
        if (text !== null) add(definedFunctions(text));
    }
    for (const name of exportsOf((n) => !NOISE_EXPORT.test(n))) tryAll(name, add);

    const families = new Map();
    const skipped = [];
    const names = new Set();
    for (const name of exportsOf((n) => NOISE_EXPORT.test(n))) {
        const own = new Set();
        const built = tryAll(name, (defined) => defined.forEach((fn) => { if (!control.has(fn)) own.add(fn); }));
        if (!built) { skipped.push(name); continue; }
        families.set(name, own);
        own.forEach((fn) => names.add(fn));
    }
    calibration = { names, families, skipped };
    return calibration;
}

/**
 * The MaterialX noise functions a generated shader defines (WGSL or GLSL, one stage or several
 * joined). Empty when it holds none.
 * @param {string} shader
 * @returns {string[]}
 */
export function materialXNoiseFunctions(shader) {
    const { names } = materialXNoiseCalibration();
    return [...definedFunctions(shader)].filter((name) => names.has(name));
}

/**
 * Whether a generated shader holds MaterialX noise.
 * @param {string} shader
 */
export function hasMaterialXNoise(shader) {
    return materialXNoiseFunctions(shader).length > 0;
}
