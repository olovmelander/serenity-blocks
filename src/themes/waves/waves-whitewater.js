/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Waves — the white water where the lip lands.
 *
 * The lip comes down on the trough a few metres ahead of the eye and stands on it from there
 * back as a curtain (waves-water.js closes its tears as it lands and lays the carpet of foam on
 * the sea under it). Here is that white water as it stands in the air, in three kinds, each
 * puff on a loop of its own, closed form from the clock like the lip's rain (a held frame holds
 * every one of them where it is):
 *
 *   roll    billows along the foot of the curtain, on the tube's side of it: each heaves up,
 *           rolls in toward the face with the water under it and sinks back into the foam;
 *   burst   the touchdown itself, where the falling edge first meets the sea: heads of white
 *           water thrown up and out in front of the wave, about as high as the eye, that hang
 *           there and thin away;
 *   mist    what both leave in the air: wide thin veils that drift back over the wave with the
 *           wind and take the low sun.
 *
 * Unlike the spray (light added to the frame), white water COVERS what is behind it: over an
 * evening sea as bright as itself, added light does not show at all. A puff is drawn "over",
 * premultiplied (rgb × cover, cover), with the sun's glow through it added on top; the target's
 * alpha stays 1 under it.
 *
 * U.heave (0..1, eased by the world from every throw of the lip: a clear, a chain, a set wave)
 * throws the touchdown higher and wider and stands the roll taller: every line cleared is felt
 * where the wave meets the sea.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, clamp, dot, exp, float, fract, length, max, mix, normalize, positionGeometry, sin,
    smoothstep, step, texture, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { FLOW, mulberry32 } from './waves-core.js';
import { cameraRight, cameraUp, quads } from './waves-spray.js';

/** Which kind each puff is, in turn: half are the roll, three in ten the burst, the rest mist. */
export const WHITE_WATER_KINDS = Object.freeze([0, 1, 0, 2, 0, 1, 0, 1, 0, 2]);
/** How far back from the touchdown the roll runs along the foot of the curtain (metres). */
export const ROLL_REACH = 3.4;
/** How high a burst's head is thrown at rest, and with the lip throwing its hardest (metres). */
export const BURST_RISE = Object.freeze({ rest: [0.55, 1.2], heave: 1.7 });

/**
 * @param {object} p
 * @param {object} p.tier     quality tier (`whitewater` puffs)
 * @param {object} p.U        shared uniforms (time, sun, warm, heave, glowing, light)
 * @param {object} p.shape    createWaveShape()
 * @param {THREE.Texture} p.noise
 * @param {number} [p.seed]
 */
export function createWhiteWater({
    tier, U, shape, noise, seed = 13,
}) {
    const count = Math.max(WHITE_WATER_KINDS.length, tier.whitewater);
    const rand = mulberry32(seed * 9973 + 17);
    const seeds = new Float32Array(count * 4);
    const kinds = new Float32Array(count);
    const each = [0, 0, 0];
    const of = [0, 0, 0];
    for (let i = 0; i < count; i += 1) of[WHITE_WATER_KINDS[i % WHITE_WATER_KINDS.length]] += 1;
    for (let i = 0; i < count; i += 1) {
        const kind = WHITE_WATER_KINDS[i % WHITE_WATER_KINDS.length];
        kinds[i] = kind;
        // Each kind is spread evenly along its own stretch of the line.
        seeds[i * 4] = (each[kind] + rand()) / of[kind];
        each[kind] += 1;
        seeds[i * 4 + 1] = rand();
        seeds[i * 4 + 2] = rand();
        seeds[i * 4 + 3] = rand();
    }
    const { base, geometry } = quads(count);
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));

    const s = attribute('aSeed', 'vec4');
    const kind = attribute('aKind', 'float');
    const burstly = step(0.5, kind);
    const misty = step(1.5, kind);
    const pick = (roll, burst, mist) => mix(mix(roll, burst, burstly), mist, misty);
    const { heave } = U;

    const life = pick(s.z.mul(1.3).add(1.9), s.z.mul(1.6).add(2.6), s.z.mul(3.0).add(4.5));
    const phase = fract(s.z.mul(5.3).add(s.x.mul(2.7)).add(U.time.div(life)));
    const age = phase.mul(life);

    // ── The roll: along the foot of the curtain ──
    const footRoll = shape.point(float(1.0), shape.landing.add(0.15).sub(s.x.mul(ROLL_REACH)).negate()).position;
    const carried = float(1.0).sub(exp(age.mul(-1.5))).div(1.5);
    const rollAt = vec3(
        footRoll.x.add(0.06).add(s.y.mul(0.2)).add(s.w.mul(0.6).add(0.35).mul(carried)),
        s.w.mul(0.2).add(0.12).mul(heave.mul(0.7).add(1.0)).mul(sin(phase.mul(Math.PI)))
            .add(0.08),
        footRoll.z.add(age.mul(FLOW.z * 0.55)),
    );
    const rollSize = s.y.mul(0.26).add(0.24).add(phase.mul(0.3)).mul(heave.mul(0.15).add(1.0));
    const rollCover = smoothstep(0.0, 0.12, phase).mul(float(1.0).sub(smoothstep(0.5, 1.0, phase))).mul(0.95);

    // ── The burst: the touchdown ──
    const footBurst = shape.point(float(1.0), shape.landing.sub(0.6).add(s.x).negate()).position;
    const thrown = float(1.0).sub(exp(age.mul(-0.85))).div(0.85);
    const [low, high] = BURST_RISE.rest;
    const rise = s.w.mul((high - low) * 0.85)
        .add(low * 0.85)
        .mul(heave.mul(BURST_RISE.heave - 1).add(1.0));
    const burstAt = vec3(
        footBurst.x.sub(0.05).sub(s.y.mul(0.7).add(0.25).mul(thrown)),
        rise.mul(thrown).sub(age.mul(age).mul(0.035)).add(0.08),
        footBurst.z.add(s.y.sub(0.5).mul(0.5).mul(thrown)).add(age.mul(FLOW.z * 0.3)),
    );
    const burstSize = s.y.mul(0.22).add(0.26).add(thrown.mul(s.w.mul(0.3).add(0.36)).mul(heave.mul(0.22).add(1.0)));
    const burstCover = smoothstep(0.0, 0.08, phase).mul(float(1.0).sub(smoothstep(0.3, 1.0, phase))).mul(0.9);

    // ── The mist: what hangs in the air after them ──
    const footMist = shape.point(float(1.0), shape.landing.add(1.2).sub(s.x.mul(4.0)).negate()).position;
    const mistAt = vec3(
        footMist.x.sub(0.3).add(s.y.mul(0.8)).add(age.mul(0.12)),
        max(footMist.y, 0.0).add(0.5).add(s.w.mul(0.8)).add(age.mul(0.13)),
        footMist.z.add(age.mul(FLOW.z * 0.35)),
    );
    const mistSize = s.y.mul(0.9).add(1.1).add(age.mul(0.22));
    const mistCover = smoothstep(0.0, 0.25, phase).mul(float(1.0).sub(smoothstep(0.45, 1.0, phase)))
        .mul(heave.mul(0.05).add(0.055));

    const centre = pick(rollAt, burstAt, mistAt);
    const size = pick(rollSize, burstSize, mistSize);
    const cover = pick(rollCover, burstCover, mistCover);

    const material = new THREE.MeshBasicNodeMaterial({
        fog: false,
        transparent: true,
        depthWrite: false,
        // "Over", premultiplied: (One, OneMinusSrcAlpha).
        blending: THREE.NormalBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
    });
    material.name = 'waves-whitewater';
    material.positionNode = centre
        .add(cameraRight().mul(positionGeometry.x.mul(size).mul(mix(float(1.0), float(1.5), misty))))
        .add(cameraUp().mul(positionGeometry.y.mul(size)));

    // White under the whole sky, warmed by the low sun; and the sun THROUGH it, when it stands
    // behind: the white water at the touchdown lies almost under the evening sun.
    const toPuff = normalize(centre.sub(cameraPosition));
    const forward = clamp(dot(toPuff, U.sun), 0.0, 1.0);
    const f2 = forward.mul(forward);
    const f4 = f2.mul(f2);
    const warmer = mix(vec3(1.0), vec3(1.12, 1.0, 0.85), U.warm);
    // (As white as the foam the sea carries under it: dimmer, a heap of it is a cloud of dust.)
    const white = vec3(0.7, 0.84, 0.95).mul(U.light.skyTint)
        .add(U.light.sunTint.mul(vec3(0.46, 0.42, 0.34)).mul(f2.mul(0.9).add(0.35)))
        // The sea's own light, when the hour is dark: beaten water burns cold.
        .add(vec3(0.05, 0.5, 0.95).mul(U.glowing).mul(0.22))
        .mul(warmer);
    const f16 = f4.mul(f4).mul(f4).mul(f4);
    const through = vec3(2.2, 1.3, 0.55).mul(f16).mul(0.22).add(vec3(1.0, 0.62, 0.3).mul(f4.mul(f4)).mul(0.06))
        .mul(U.light.fireTint)
        .mul(warmer)
        .mul(mix(float(0.55), float(1.0), misty));
    const vWhite = varying(vec4(white, cover), 'vWaveWhite');
    const vThrough = varying(through.mul(cover), 'vWaveWhiteThrough');
    const vSeed = varying(vec4(s.x, s.y, phase, misty), 'vWaveWhiteSeed');
    material.outputNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const d = length(p);
        // A heap of white water, not a disc: the noise churns through it and tears its edge into
        // lobes, further as it thins (a veil of mist keeps a softer edge).
        const at = uv().mul(0.5).add(vec2(vSeed.x.mul(7.3), vSeed.y.mul(3.1)))
            .add(vec2(vSeed.z.mul(0.25), U.time.mul(-0.02)));
        // Three scales of it: the heap, its heads, and the froth that breaks its edge into spray
        // (two scales alone made a cumulus cloud of it when the lip throws hard and it stands tall).
        const heads = texture(noise, at.mul(3.1)).toVar();
        const froth = texture(noise, at.mul(8.3).add(0.17)).b;
        const lump = texture(noise, at).b.mul(0.48).add(heads.a.mul(0.32)).add(froth.mul(0.2)).toVar();
        const eaten = mix(mix(float(0.58), float(0.88), vSeed.z), float(0.5), vSeed.w);
        // (A crisp edge: soft all the way out, a heap of white water is a puff of smoke.)
        const torn = smoothstep(
            mix(float(0.14), float(-0.1), vSeed.w),
            mix(float(0.36), float(0.5), vSeed.w),
            lump.sub(d.mul(d).mul(eaten)),
        );
        const soft = float(1.0).sub(smoothstep(0.55, 1.0, d));
        const dense = torn.mul(soft).toVar();
        const a = dense.mul(vWhite.a);
        // Lit from the sky above it, its underside and its hollows in its own shade.
        const shade = mix(float(0.7), float(1.0), smoothstep(0.1, 0.9, uv().y))
            .mul(smoothstep(0.25, 0.7, heads.b).mul(0.26).add(0.72).add(froth.mul(0.1)));
        return vec4(vWhite.rgb.mul(shade).mul(a).add(vThrough.mul(dense)), a);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'waves-whitewater';
    mesh.frustumCulled = false;
    // After the water and what swims behind it, before the light that is added to the frame.
    mesh.renderOrder = 28;
    return {
        mesh,
        material,
        count,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            base.dispose();
            material.dispose();
        },
    };
}
