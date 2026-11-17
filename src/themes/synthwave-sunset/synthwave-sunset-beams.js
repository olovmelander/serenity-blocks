/**
 * Synthwave Sunset — beams of light in the evening air: the searchlights that sweep up from the
 * pier at a new level, and the laser fan the wheel's hub throws for a back-to-back.
 *
 * One instanced additive draw. A beam is a long quad from its origin along its direction, turned
 * about that axis to face the eye and widening along its length (a searchlight's cone, a laser's
 * hair of a spread). Its light is brightest along its core and near its lamp and thins out toward
 * its end, with the dust it crosses drifting through it. It writes premultiplied light with
 * alpha 0, so it adds to the frame and leaves the reflection pass's alpha alone: the sea mirrors
 * the beams.
 *
 * The world moves the beams on the CPU (ten of them: three small buffer writes a frame while any
 * is lit, none otherwise). A dark beam has no width, so it covers no pixel; the draw itself stays
 * in the scene from the start, so its pipeline is built with the world and the first level-up
 * does not stall on it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    cross,
    exp,
    float,
    modelWorldMatrix,
    cameraViewMatrix,
    cameraProjectionMatrix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    uv,
    vec4,
} from 'three/tsl';
import { flatVarying } from '../shared/flat-varying.js';

/** Beams the draw holds: the level's searchlights and the back-to-back's lasers together. */
export const BEAM_SLOTS = 10;

function instanced(count, itemSize) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
}

/**
 * Per beam:
 *   iBeamA (x, y, z, width m)        origin and its width there
 *   iBeamB (dx, dy, dz, length m)    unit direction and length
 *   iBeamC (r, g, b, spread)         colour (linear, HDR; black = dark) and how much wider it
 *                                    grows per metre along
 */
function createBeamMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveBeams';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;
    material.side = THREE.DoubleSide;

    const A = attribute('iBeamA', 'vec4');
    const B = attribute('iBeamB', 'vec4');
    const C = attribute('iBeamC', 'vec4');
    // The quad's x runs across the beam (−0.5..0.5), its y along it (−0.5..0.5 → 0..1).
    const along = positionGeometry.y.add(0.5);
    const across = positionGeometry.x;
    const origin = modelWorldMatrix.mul(vec4(A.xyz, 1.0)).xyz;
    const centre = origin.add(B.xyz.mul(B.w.mul(along)));
    const side = normalize(cross(B.xyz, cameraPosition.sub(centre)));
    const width = A.w.add(C.w.mul(B.w).mul(along));
    const world = centre.add(side.mul(across.mul(width)));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

    const colour = flatVarying(C.xyz, 'vBeamColour');
    material.colorNode = Fn(() => {
        const q = uv();
        const x = q.x.sub(0.5).mul(2.0);
        const { y } = q;
        // A bright core in a soft sheath; strongest near the lamp, gone by the far end.
        const core = exp(x.mul(x).mul(-9.0)).mul(0.7).add(exp(x.mul(x).mul(-2.2)).mul(0.3));
        const reach = smoothstep(0.0, 0.03, y).mul(float(1.0).sub(smoothstep(0.35, 1.0, y)).mul(0.75).add(0.25))
            .mul(float(1.0).sub(smoothstep(0.82, 1.0, y)));
        // Dust drifting through the beam.
        const dust = sin(y.mul(37.0).sub(u.time.mul(1.7))).mul(sin(y.mul(11.0).add(u.time.mul(0.6)))).mul(0.12)
            .add(0.88);
        return colour.mul(core).mul(reach).mul(dust);
    })();
    material.outputNode = vec4(material.colorNode, 0.0);
    return material;
}

export class Beams {
    /**
     * @param {object} u  world uniforms (time)
     * @param {object} [opts]
     * @param {number} [opts.mirrorLayer]
     */
    constructor(u, { mirrorLayer } = {}) {
        const geometry = new THREE.PlaneGeometry(1, 1);
        this.iA = instanced(BEAM_SLOTS, 4);
        this.iB = instanced(BEAM_SLOTS, 4);
        this.iC = instanced(BEAM_SLOTS, 4);
        for (let i = 0; i < BEAM_SLOTS; i += 1) {
            this.iB.array[i * 4 + 1] = 1;
            this.iB.array[i * 4 + 3] = 1;
        }
        geometry.setAttribute('iBeamA', this.iA);
        geometry.setAttribute('iBeamB', this.iB);
        geometry.setAttribute('iBeamC', this.iC);
        this.mesh = new THREE.InstancedMesh(geometry, createBeamMaterial(u), BEAM_SLOTS);
        this.mesh.name = 'SynthwaveBeams';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 26;
        if (Number.isInteger(mirrorLayer)) this.mesh.layers.enable(mirrorLayer);
        /** Whether any beam is lit (the world skips its sweep while none is). */
        this.lit = false;
        this.dirty = false;
    }

    /**
     * Set beam `i`: its origin, unit direction, length and widths (m), its colour and level
     * (0 = dark).
     */
    set(i, origin, dir, length, width, spread, color, level) {
        const o = i * 4;
        const a = this.iA.array;
        const b = this.iB.array;
        const c = this.iC.array;
        a[o] = origin.x; a[o + 1] = origin.y; a[o + 2] = origin.z; a[o + 3] = width;
        b[o] = dir.x; b[o + 1] = dir.y; b[o + 2] = dir.z; b[o + 3] = length;
        const k = Math.max(0, level);
        c[o] = color.r * k; c[o + 1] = color.g * k; c[o + 2] = color.b * k; c[o + 3] = spread;
        if (k > 1e-4) this.lit = true;
        this.dirty = true;
    }

    /** Darken beam `i` (no light and no width: it covers no pixel). */
    off(i) {
        const c = this.iC.array;
        const o = i * 4;
        if (c[o] === 0 && c[o + 1] === 0 && c[o + 2] === 0 && c[o + 3] === 0) return;
        c[o] = 0; c[o + 1] = 0; c[o + 2] = 0; c[o + 3] = 0;
        this.iA.array[o + 3] = 0;
        this.dirty = true;
    }

    /** Start a frame's writes: beams set after this decide whether any is lit. */
    begin() {
        this.lit = false;
    }

    /** Upload what changed. */
    commit() {
        if (!this.dirty) return;
        this.iA.needsUpdate = true;
        this.iB.needsUpdate = true;
        this.iC.needsUpdate = true;
        this.dirty = false;
    }

    clear() {
        for (let i = 0; i < BEAM_SLOTS; i += 1) this.off(i);
        this.lit = false;
        this.commit();
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
