/**
 * Strip three.js's `triNoise3D` out of the build.
 *
 * three r187 ships a TSL `triNoise3D` (its `src/nodes/math/TriNoise3D.js`, inlined in
 * `build/three.webgpu.nodes.js` and `build/three.tsl.js`). three credits it to a small repository
 * that carries no licence of its own and names an earlier shader as its source, whose terms could
 * not be confirmed. The game never calls it, but three exports its whole TSL namespace, so its body
 * reaches the bundle anyway. This plugin replaces the body with a stub that returns 0, keeping the
 * export (and its type layout) so nothing that imports the namespace breaks.
 *
 * The function is found by its declaration line. If a three update moves or rewrites it while its
 * loop is still there (TRI_NOISE_FINGERPRINTS), the build fails, so it cannot slip back into a
 * release unnoticed. scripts/pages-artifact-check.mjs and scripts/packaged-app-check.mjs look for
 * the same fingerprints in the built bundle.
 */

export const TRI_NOISE_DECLARATION = 'const triNoise3D = /*@__PURE__*/ Fn( ( [ position, speed, time ] ) => {';
const TRI_NOISE_LAYOUT = "}, { position: 'vec3', speed: 'float', time: 'float', return: 'float' } );";
const STUB = 'const triNoise3D = /*@__PURE__*/ Fn( () => float( 0.0 ), '
    + "{ position: 'vec3', speed: 'float', time: 'float', return: 'float' } ); "
    + '// body removed at build time (scripts/vite-plugins/strip-three-tri-noise.mjs)';

/** The noise loop's own steps, as they read in source and after minification. */
export const TRI_NOISE_FINGERPRINTS = Object.freeze([
    'mulAssign( 1.8 )',
    'addAssign( 0.14 )',
    'mulAssign(1.8)',
    'addAssign(.14)',
]);

const THREE_BUILD = /node_modules[\\/]three[\\/]build[\\/]three\.(webgpu|webgpu\.nodes|tsl)\.js$/;

/**
 * The noise loop's fingerprints found in a text, in TRI_NOISE_FINGERPRINTS order.
 * @param {string} text
 * @returns {string[]}
 */
export function findTriNoiseFingerprints(text) {
    return TRI_NOISE_FINGERPRINTS.filter((fingerprint) => text.includes(fingerprint));
}

/**
 * Replace the body of `triNoise3D` in one of three's build files.
 * @param {string} code
 * @returns {{ code: string, removed: string }} `removed` is '' when the file holds no such function.
 */
export function stripTriNoise(code) {
    const start = code.indexOf(TRI_NOISE_DECLARATION);
    if (start < 0) {
        const present = findTriNoiseFingerprints(code);
        if (present.length > 0) {
            throw new Error(
                '[strip-three-tri-noise] three still holds the triNoise3D loop '
                + `(${present.join(', ')}) but its declaration moved; update the plugin.`,
            );
        }
        return { code, removed: '' };
    }
    const layoutAt = code.indexOf(TRI_NOISE_LAYOUT, start);
    if (layoutAt < 0 || layoutAt - start > 2000) {
        throw new Error('[strip-three-tri-noise] could not find the end of triNoise3D after its declaration.');
    }
    const end = layoutAt + TRI_NOISE_LAYOUT.length;
    const removed = code.slice(start, end);
    const out = code.slice(0, start) + STUB + code.slice(end);
    if (findTriNoiseFingerprints(removed).length === 0 || findTriNoiseFingerprints(out).length > 0) {
        throw new Error('[strip-three-tri-noise] triNoise3D was not removed cleanly.');
    }
    return { code: out, removed };
}

/** Vite/Rollup plugin: build only (the dev server never ships). */
export function createStripThreeTriNoisePlugin() {
    return {
        name: 'strip-three-tri-noise',
        apply: 'build',
        transform(code, id) {
            if (!THREE_BUILD.test(id)) return null;
            const { code: out, removed } = stripTriNoise(code);
            return removed ? { code: out, map: null } : null;
        },
    };
}
