/**
 * Grainfields — the locks' sunbeams standing in the barley.
 *
 * Each lock tears a small gap in the deck (grainfields-reactions); the sun through it lights a
 * patch of the field (the shaders' deck shadow does that) and stands in the air as a beam: dust
 * and chaff over the field glowing in a column that rises from the stalks toward the sun. One
 * instanced open cylinder per gap, laid along the sun's ray from where the beam lands up to the
 * deck; its fragment measures how close the line of sight passes to the beam's axis, so the
 * column is soft-edged and brightest in its heart, and fades upward as the dust thins. The beam
 * walks over the field with the wind aloft (its gap rides with the deck).
 *
 * Additive, premultiplied (the target's alpha is left alone), no depth write: the barley in
 * front of a beam's foot hides it, the beam never hides anything.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    cross,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DECK } from './grainfields-core.js';
import { groundHeight } from './grainfields-plan.js';
import { MAX_GAPS, GrainfieldsReactions } from './grainfields-reactions.js';

/** How high the dust stands in a beam (metres: its glow falls off over this). */
const DUST_HEIGHT = 24;

export function createBeams(u, t, reactions) {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 24, 6, true);
    geometry.translate(0, 0.5, 0);
    const instanced = new THREE.InstancedBufferGeometry();
    instanced.index = geometry.index;
    instanced.setAttribute('position', geometry.attributes.position);
    const footData = new Float32Array(MAX_GAPS * 4);
    const lookData = new Float32Array(MAX_GAPS * 4);
    const foot = new THREE.InstancedBufferAttribute(footData, 4); // foot xyz, radius
    const look = new THREE.InstancedBufferAttribute(lookData, 4); // tint rgb, strength
    foot.setUsage(THREE.DynamicDrawUsage);
    look.setUsage(THREE.DynamicDrawUsage);
    instanced.setAttribute('aFoot', foot);
    instanced.setAttribute('aLook', look);
    instanced.instanceCount = 0;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsBeams';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;
    material.side = THREE.FrontSide;
    const aFoot = attribute('aFoot', 'vec4');
    const aLook = attribute('aLook', 'vec4');
    const vFoot = varying(vec4(0.0), 'gfBeamFoot');
    const vLook = varying(vec4(0.0), 'gfBeamLook');
    material.positionNode = Fn(() => {
        // The beam's axis runs from its foot up the sun's ray to the deck's base.
        const A = normalize(u.sunDir.max(vec3(-1.0, 0.035, -1.0)));
        const len = float(DECK.base).sub(aFoot.y).div(A.y);
        const side = normalize(cross(A, vec3(0.0, 0.0, 1.0)).add(vec3(1e-4, 0.0, 0.0)));
        const other = cross(A, side);
        const p = positionGeometry;
        vFoot.assign(aFoot);
        vLook.assign(aLook);
        const rise = p.y.mul(len).sub(2.0);
        // A finite solar disc spreads the penumbra as the shaft rises out of the dust.
        const width = aFoot.w.mul(1.65).add(max(rise.mul(A.y), 0.0).mul(0.018));
        return aFoot.xyz.add(A.mul(rise)).add(side.mul(p.x.mul(width))).add(other.mul(p.z.mul(width)));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const A = normalize(u.sunDir.max(vec3(-1.0, 0.035, -1.0)));
        const V = normalize(P.sub(u.eye)).toVar();
        // How close the line of sight passes to the axis (metres), and so how much dust it crosses.
        const n = cross(V, A);
        const nn = max(length(n), 1e-3);
        const d = dot(vFoot.xyz.sub(u.eye), n).abs().div(nn);
        const up = max(P.y.sub(vFoot.y), 0.0);
        const r = max(vFoot.w, 0.5).mul(1.65).add(up.mul(0.018));
        const radial = d.div(r).clamp(0.0, 1.0).toVar();
        const radius2 = radial.mul(radial);
        const falloff = radius2.oneMinus();
        const heart = exp(radius2.mul(-4.2)).mul(falloff.mul(falloff));
        // The dust thins with height over the field.
        // (Little of it reaches far up: a column standing in the barley, not a searchlight from the
        // sky; ten beams at once in play, each one's long upper reach summed into one pale haze.)
        const dust = exp(up.div(-DUST_HEIGHT)).mul(0.9).add(exp(up.div(-200.0)).mul(0.03));
        // Broad dust layers drift along the shaft. Filter them as field-scale
        // detail, so only the loose chaff makes individual glints.
        const veil = texture(t.noise, vFoot.xz.mul(0.0021).add(vec2(up.mul(0.0018), u.time.mul(0.0025)))).level(2).g;
        // Light scattered toward the eye: strongest looking up the beam toward the sun.
        const mu = clamp(dot(V, A), 0.0, 1.0);
        const m2 = mu.mul(mu);
        const phase = m2.mul(m2).mul(0.34).add(m2.mul(0.23)).add(0.45);
        // Sunlight first, the piece's pigment a breath in it (its motes carry the colour).
        const tint = mix(vec3(1.0, 0.96, 0.88), vLook.xyz.mul(1.3).add(0.15), 0.16);
        // Looking along a broad beam reveals more dust, but the light scattered by
        // a thick column levels off. At twilight a little afterglow reaches the dust.
        const column = vFoot.w.mul(0.028).add(0.12).min(0.46);
        const opticalDepth = column.mul(dust).mul(veil.mul(0.65).add(0.45)).div(nn.mul(0.45).add(0.55));
        const scattered = float(1.0).sub(exp(opticalDepth.negate()));
        const source = u.sun.mul(u.sunUp).add(u.glow.mul(u.day.oneMinus()).mul(0.18));
        const glow = source.mul(tint).mul(heart).mul(scattered).mul(phase)
            .mul(vLook.w)
            .mul(0.72);
        return vec4(glow, 0.0);
    })();
    // The light is added and the target's alpha left as it is.
    material.outputNode = vec4(material.colorNode.xyz, 0.0);
    const mesh = new THREE.Mesh(instanced, material);
    mesh.name = 'GrainfieldsBeams';
    mesh.frustumCulled = false;
    mesh.renderOrder = 25;

    return {
        mesh,
        meshes: [mesh],
        count: 0,
        update(time, dt, world) {
            const { gaps } = reactions;
            // The hotter play runs, the more dust the beams stand in (the world's surge).
            const glow = Number.isFinite(world?.beamGlow) ? world.beamGlow : 1;
            let n = 0;
            for (let i = 0; i < gaps.length && n < MAX_GAPS; i++) {
                const g = gaps[i];
                const strength = GrainfieldsReactions.gapStrength(g, time);
                if (strength <= 0.002) continue;
                // The beam walks slowly with the wind, its gap in the deck with it.
                const [dx, dz] = GrainfieldsReactions.gapShift(g, time);
                const fx = g.footX + dx;
                const fz = g.footZ + dz;
                const o = n * 4;
                footData[o] = fx;
                footData[o + 1] = groundHeight(fx, fz);
                footData[o + 2] = fz;
                footData[o + 3] = g.radius;
                lookData[o] = g.rgb[0];
                lookData[o + 1] = g.rgb[1];
                lookData[o + 2] = g.rgb[2];
                lookData[o + 3] = strength * glow;
                n += 1;
            }
            instanced.instanceCount = n;
            this.count = n;
            if (n) {
                foot.needsUpdate = true;
                look.needsUpdate = true;
            }
            mesh.visible = n > 0;
        },
        dispose() {
            geometry.dispose();
            instanced.dispose();
            material.dispose();
        },
    };
}
