/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Stellar Seal renderer (the lock hero, plan §4.7)
 *
 * When a piece locks, each of its filled CELLS ignites from its own centre and
 * plays one connected anticipation → core → outline → release beat. This is the
 * "cell-accurate stellar-seal lock" — the piece feels made of the same stellar
 * material as the sky, but crisper and more solid than any background effect.
 *
 * Built fresh with DEFINED-ORDER smoothsteps (edge0 < edge1) throughout, per the
 * pinned r181 guidance the plan calls out; it does not reuse the shared shockwave
 * renderer's reversed masks. A small instanced additive billboard pool (mirrors the
 * proven shockwave-renderer vertex pattern), dirty-gated + visibility-gated so an
 * idle board pays no upload or draw.
 *
 * Envelope over a ~0.5 s life (normalized age 0..1):
 *   0.00–0.16  anticipation — a faint ring gathers inward (motes inhale), rim cools
 *   0.16–0.44  seal — the cell ignites and compresses to a crisp hot core
 *   0.25–0.80  outline — one thin connected ring travels outward
 *   0.44–1.00  release — the core fades as its energy hands off to the sky wave
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    float,
    length,
    mix,
    positionLocal,
    smoothstep,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';

export const SEAL_LIFETIME = 0.5; // seconds — the full anticipation→release beat
const DEFAULT_POOL = 16; // a piece is ≤4 cells; headroom for overlapping locks
const WARM_CORE = [1.0, 0.95, 0.86]; // hot-white stellar core before the accent tint

export function createStellarSeal(options = {}) {
    const count = Math.max(4, Math.floor(options.pool ?? DEFAULT_POOL));
    const uTime = uniform(0);
    const uIntensity = uniform(options.intensity ?? 1.0);

    // Per-slot state (Float32Arrays shared with the instanced attributes).
    const origin = new Float32Array(count * 3);
    const birth = new Float32Array(count).fill(-1000);
    const invLife = new Float32Array(count).fill(1 / SEAL_LIFETIME);
    const sizeArr = new Float32Array(count); // 0 = inactive → zero-area quad
    const color = new Float32Array(count * 3);

    // Quad in [-1,1] → positionLocal.xy is normalized radius space (as in shockwaves).
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
    ], 3));

    const aOrigin = new THREE.InstancedBufferAttribute(origin, 3);
    const aBirth = new THREE.InstancedBufferAttribute(birth, 1);
    const aInvLife = new THREE.InstancedBufferAttribute(invLife, 1);
    const aSize = new THREE.InstancedBufferAttribute(sizeArr, 1);
    const aColor = new THREE.InstancedBufferAttribute(color, 3);
    const attrs = [aOrigin, aBirth, aInvLife, aSize, aColor];
    attrs.forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aOrigin', aOrigin);
    geometry.setAttribute('aBirth', aBirth);
    geometry.setAttribute('aInvLife', aInvLife);
    geometry.setAttribute('aSize', aSize);
    geometry.setAttribute('aColor', aColor);
    geometry.instanceCount = count;

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false, // reads over the board like a UI cue
    });

    material.vertexNode = Fn(() => {
        const org = attribute('aOrigin', 'vec3');
        const size = attribute('aSize', 'float');
        const vp = cameraViewMatrix.mul(vec4(org, 1.0)).toVar();
        const off = positionLocal.xy.mul(size); // collapses to a point when size=0
        vp.x.addAssign(off.x);
        vp.y.addAssign(off.y);
        return cameraProjectionMatrix.mul(vp);
    })();

    const colorNode = Fn(() => {
        const b = attribute('aBirth', 'float');
        const inv = attribute('aInvLife', 'float');
        const accent = attribute('aColor', 'vec3');

        const d = length(positionLocal.xy); // 0 centre → ~1.41 corner
        const age = uTime.sub(b).mul(inv).clamp(0.0, 1.0);

        // Life envelope: quick ignite, gentle release (both defined-order).
        const ignite = smoothstep(0.0, 0.14, age);
        const release = float(1.0).sub(smoothstep(0.42, 1.0, age));
        const env = ignite.mul(release);

        // Hot core — bright, sharpened, compressing slightly as it seals.
        const coreR = mix(float(0.34), float(0.18), smoothstep(0.0, 0.35, age));
        const coreDisc = float(1.0).sub(smoothstep(0.0, coreR, d));
        const core = coreDisc.mul(coreDisc); // pow2 → crisp hot centre

        // Soft luminous halo so the seal reads as light even without a post-bloom pass.
        const halo = float(1.0).sub(smoothstep(0.0, 1.2, d)).mul(0.55);

        // Anticipation: a faint ring gathers inward, only in the first ~0.22 of life.
        const gatherR = mix(float(1.1), float(0.35), smoothstep(0.0, 0.22, age));
        const gatherBand = float(1.0).sub(smoothstep(0.0, 0.12, abs(d.sub(gatherR))));
        const gatherWindow = float(1.0).sub(smoothstep(0.1, 0.24, age));
        const gather = gatherBand.mul(gatherWindow).mul(0.5);

        // One thin connected outline ring traveling outward.
        const ringR = smoothstep(0.2, 0.85, age).mul(1.1);
        const ringBand = float(1.0).sub(smoothstep(0.0, 0.07, abs(d.sub(ringR))));
        const ringWindow = smoothstep(0.18, 0.28, age).mul(float(1.0).sub(smoothstep(0.7, 1.0, age)));
        const outline = ringBand.mul(ringWindow).mul(0.8);

        // Compose: warm hot core tinted toward the piece accent; halo + outline near the accent.
        const coreCol = mix(vec3(WARM_CORE[0], WARM_CORE[1], WARM_CORE[2]), accent, 0.3);
        const bodyBright = core.mul(2.4).add(halo).mul(env).mul(uIntensity);
        const bright = bodyBright.add(gather.mul(env)).add(outline);
        const rgb = mix(accent, coreCol, core.clamp(0.0, 1.0)).mul(bright);
        return vec4(rgb.clamp(0.0, 3.0), bright.clamp(0.0, 1.0));
    })();

    material.colorNode = colorNode;
    material.emissiveNode = colorNode.rgb; // MRT-selective bloom picks up the seal glow
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 9; // above shockwaves/meteors — it is the board-anchored hero
    mesh.visible = false; // idle: hidden until the first ignite

    let time = 0;
    let cursor = 0;
    let dirty = false;

    const isSlotActive = (i) => (time - birth[i]) * invLife[i] < 1;

    const activeCount = () => {
        let n = 0;
        for (let i = 0; i < count; i += 1) if (isSlotActive(i)) n += 1;
        return n;
    };

    const takeSlot = () => {
        for (let i = 0; i < count; i += 1) if (!isSlotActive(i)) return i;
        const s = cursor;
        cursor = (cursor + 1) % count;
        return s;
    };

    return {
        mesh,
        material,
        uniforms: { uTime, uIntensity },

        /**
         * Ignite a seal at each cell centre. cells: [{x,y,z}]; opts.accent [r,g,b],
         * opts.size world radius, opts.strength scales brightness.
         */
        ignite(cells, opts = {}) {
            if (!Array.isArray(cells) || !cells.length) return;
            const accent = opts.accent || [0.66, 0.78, 1.0]; // cool starlight default
            const size = opts.size ?? 0.62;
            const strength = opts.strength ?? 1.0;
            for (const cell of cells) {
                const i = takeSlot();
                origin[i * 3] = cell.x || 0;
                origin[i * 3 + 1] = cell.y || 0;
                origin[i * 3 + 2] = cell.z || 0;
                birth[i] = time;
                invLife[i] = 1 / (opts.lifetime ?? SEAL_LIFETIME);
                sizeArr[i] = size * (0.9 + 0.2 * strength);
                color[i * 3] = accent[0];
                color[i * 3 + 1] = accent[1];
                color[i * 3 + 2] = accent[2];
            }
            dirty = true;
            mesh.visible = true;
        },

        update(t) {
            time = t;
            uTime.value = t;
            // Collapse just-expired slots once (so the renderer hides them), then gate
            // uploads/visibility: an idle pool pays no queue traffic and no draw call.
            let active = false;
            for (let i = 0; i < count; i += 1) {
                if (isSlotActive(i)) { active = true; } else if (sizeArr[i] !== 0) { sizeArr[i] = 0; dirty = true; }
            }
            if (dirty) {
                attrs.forEach((a) => { a.needsUpdate = true; });
                dirty = false;
            }
            mesh.visible = active;
        },

        hasActive() { return activeCount() > 0; },

        /** Clear the pool (deterministic reset for capture/seek). */
        clear() {
            birth.fill(-1000);
            sizeArr.fill(0);
            cursor = 0;
            dirty = true;
            mesh.visible = false;
        },

        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
