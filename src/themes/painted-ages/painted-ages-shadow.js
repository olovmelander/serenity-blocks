/**
 * Painted Ages — the land's own shadow (a GPU pass per field).
 *
 * The sun walks round the sky with the clock, so no shadow can be baked once. Each field has a
 * small render target holding the sun's visibility at every point of it: a march from the point
 * toward the sun across the land (all three fields, the finest that holds each step), soft by
 * the angle the ray clears the ground by. A target is re-painted only when the sun has moved by
 * more than a tenth of a degree since it was last painted, one field per frame, so the cost is a
 * fraction of a millisecond spread over a few frames.
 *
 * Targets are read with plain uv = (x − x0, z − z0) / span (render-target v = 0 is the top row on
 * both backends, and a QuadMesh's uv runs down the screen, so the pass writes exactly what a
 * later read at the same uv finds).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    clamp,
    float,
    max,
    min,
    mix,
    normalize,
    texture,
    uniform,
    uv,
    vec2,
    vec4,
} from 'three/tsl';
import { FIELDS, FIELD_ORDER } from './painted-ages-core.js';
import { fieldWeight, heightAt } from './painted-ages-tsl.js';

/** How far (metres) each field's march reaches toward the sun, and its first step. */
const REACH = Object.freeze({ near: 9000, mid: 16000, far: 26000 });
/** Penumbra: the angle (radians) over which the ground's edge softens the light. */
const SOFT = 0.03;

/** The sun's visibility at a world xz read from the three targets, blended like the land. */
export function shadowAt(targets, xz) {
    const read = (name) => {
        const f = FIELDS[name];
        return texture(targets[name], vec2(xz.x.sub(f.x0).div(f.span), xz.y.sub(f.z0).div(f.span))).x;
    };
    const wm = fieldWeight(FIELDS.mid, xz);
    const wn = fieldWeight(FIELDS.near, xz);
    return mix(mix(read('far'), read('mid'), wm), read('near'), wn);
}

export function createShadowPass(u, fieldTextures, tier) {
    const sun = uniform(new THREE.Vector3(0.6, 0.3, -0.7));
    const passes = {};
    for (const name of FIELD_ORDER) {
        const f = FIELDS[name];
        const size = tier.shadow[name];
        const target = new THREE.RenderTarget(size, size, {
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false,
            samples: 0,
        });
        target.texture.name = `painted-ages-shadow-${name}`;
        target.texture.wrapS = THREE.ClampToEdgeWrapping;
        target.texture.wrapT = THREE.ClampToEdgeWrapping;
        target.texture.magFilter = THREE.LinearFilter;
        target.texture.minFilter = THREE.LinearFilter;
        target.texture.generateMipmaps = false;
        target.texture.colorSpace = THREE.NoColorSpace;

        const cell = f.span / size;
        const steps = tier.shadowSteps;
        const reach = REACH[name];
        const first = cell * 1.1;
        const growth = (reach / first) ** (1 / steps);
        const material = new THREE.NodeMaterial();
        material.name = `PaintedAgesShadow-${name}`;
        material.depthTest = false;
        material.depthWrite = false;
        material.fragmentNode = Fn(() => {
            const st = uv();
            const xz = vec2(st.x.mul(f.span).add(f.x0), st.y.mul(f.span).add(f.z0)).toVar();
            const flat = max(vec2(sun.x, sun.z).length(), 1e-4);
            const along = normalize(vec2(sun.x, sun.z)).toVar();
            const rise = sun.y.div(flat).toVar();
            const h0 = heightAt(fieldTextures, xz).add(cell * 0.35).toVar();
            const vis = float(1.0).toVar();
            const dist = float(first).toVar();
            Loop(steps, () => {
                const q = xz.add(along.mul(dist));
                const ground = heightAt(fieldTextures, q);
                const ray = h0.add(rise.mul(dist));
                // How far the ray clears the ground, as an angle: soft over SOFT radians.
                const clear = ray.sub(ground).div(dist.mul(SOFT));
                vis.assign(min(vis, clamp(clear.mul(0.5).add(0.5), 0.0, 1.0)));
                dist.mulAssign(growth);
            });
            return vec4(vis, vis, vis, 1.0);
        })();
        const quad = new THREE.QuadMesh(material);
        quad.name = `PaintedAgesShadow-${name}`;
        passes[name] = {
            target, material, quad, painted: null, size,
        };
    }

    const textures = Object.fromEntries(FIELD_ORDER.map((name) => [name, passes[name].target.texture]));
    let cursor = 0;
    const last = new THREE.Vector3();
    let anyPainted = false;

    return {
        textures,
        passes,
        /**
         * Paint what is due: every field the first time, then one stale field per call (the
         * sun has moved more than `threshold` radians since that field was painted).
         * @returns {number} fields painted
         */
        render(renderer, sunDir, { threshold = 0.0018, all = false } = {}) {
            if (!renderer || typeof renderer.setRenderTarget !== 'function') return 0;
            const previous = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
            let painted = 0;
            const due = (pass) => !pass.painted || pass.painted.angleTo(sunDir) > threshold;
            for (let k = 0; k < FIELD_ORDER.length; k++) {
                const name = FIELD_ORDER[(cursor + k) % FIELD_ORDER.length];
                const pass = passes[name];
                if (!due(pass)) continue;
                sun.value.copy(sunDir);
                renderer.setRenderTarget(pass.target);
                pass.quad.render(renderer);
                pass.painted = (pass.painted || new THREE.Vector3()).copy(sunDir);
                painted++;
                if (!all && anyPainted) {
                    cursor = (cursor + k + 1) % FIELD_ORDER.length;
                    break;
                }
            }
            if (painted) {
                anyPainted = true;
                last.copy(sunDir);
            }
            renderer.setRenderTarget(previous);
            return painted;
        },
        /** Forget what was painted (a seek, a rebuilt device): everything is due again. */
        invalidate() {
            for (const name of FIELD_ORDER) passes[name].painted = null;
            anyPainted = false;
        },
        dispose() {
            for (const name of FIELD_ORDER) {
                passes[name].target.dispose();
                passes[name].material.dispose();
            }
        },
    };
}
