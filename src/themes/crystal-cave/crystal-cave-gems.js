/**
 * Crystal Cave — the crystals.
 *
 * Every crystal is the same convex solid: a hexagonal prism closed by a six-faced
 * termination. Because the solid is known exactly, the fragment shader does not fake
 * its interior: it refracts the view ray at the facet, follows it through the stone
 * from face to face (total internal reflection included), and gathers what the ray
 * meets on the way — absorption by path length, the fire along the axis, growth
 * phantoms parallel to the termination, and thin rainbow fractures. One draw call,
 * no backdrop pass, identical on WebGPU and the WebGL2 backend.
 *
 * Spaces: "canonical" is the unit solid (side planes at distance 1, shoulder at y = 1,
 * apex at y = 1 + tau); "rigid" is canonical scaled by the instance (world units,
 * crystal-aligned); world is rigid rotated and translated.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, dot, exp,
    float, fract, fwidth, int, length, max, min, mix, normalize, positionGeometry, pow, reflect, smoothstep, sqrt, step,
    texture, uv, varying, vec2, vec3, vec4, viewportTexture,
} from 'three/tsl';

const TAU = Math.PI * 2;
/** Quartz-like index; the three values disperse the first exit into colour. */
const IOR = 1.55;
const IOR_SPECTRUM = Object.freeze([1.5, 1.55, 1.615]);
const F0 = ((IOR - 1) / (IOR + 1)) ** 2;
/** Sharpness of the luminous filament on a crystal's axis (canonical radius ≈ 1/sqrt). */
const FILAMENT = 24;
const SIDES = Object.freeze(Array.from({ length: 6 }, (_, index) => {
    const angle = (index / 6) * TAU;
    return Object.freeze({ c: Math.cos(angle), s: Math.sin(angle) });
}));

/** Floats per crystal in the packed instance record (see `packCrystal`). */
export const GEM_STRIDE = 16;
/** A crystal's pulse of light falls as exp(-PULSE_DECAY · seconds). */
export const PULSE_DECAY = 1.15;
/** The most light a stone rings with, however many pulses pile up (a lone pulse peaks near 1.2). */
export const PULSE_CEILING = 1.35;

/**
 * Ring a crystal: a pulse of `strength` starting at `at` (seconds; may be ahead of `now`),
 * joined to what it still rings. Per crystal the state holds one pulse (start, strength) and a
 * carry (`[3]`): earlier light, kept on the same start and the same decay, so it reads as
 * `carry · exp(-PULSE_DECAY · (t − start))` at every t — before the start too. Nothing an
 * earlier pulse lit goes dark when a later one is scheduled, and a weak pulse never cuts a
 * strong one.
 * @param {Float32Array|Float64Array} state four floats per crystal: start, strength, growth, carry
 */
export function ringCrystal(state, index, at, strength, now = at) {
    const offset = index * 4;
    const start = state[offset];
    const held = state[offset + 1];
    const carry = state[offset + 3];
    const hit = Math.max(0, strength);
    if (start > now && start <= at) {
        // A pulse already on its way lands first: this one rides with it.
        state[offset + 1] = Math.min(PULSE_CEILING, held + hit);
        return;
    }
    if (start > at) {
        // The waiting pulse lands later: this one rings now, through the carry.
        state[offset + 3] = Math.min(PULSE_CEILING, carry + hit * Math.exp(-(start - at) * PULSE_DECAY));
        return;
    }
    // What still rings carries on under the new pulse, and adds to it.
    const ringing = (held + carry) * Math.exp(-(at - start) * PULSE_DECAY);
    state[offset] = at;
    state[offset + 1] = hit;
    state[offset + 3] = ringing < 1e-3 ? 0 : Math.min(ringing, Math.max(0, PULSE_CEILING - hit));
}

/**
 * The canonical solid without its base (the base is always inside rock).
 * `position.y === 2` marks the apex; the vertex stage moves it per instance.
 * `aFace` = (cos, sin, isTermination) of the face a vertex belongs to.
 */
export function createGemGeometry() {
    const cornerRadius = 1 / Math.cos(Math.PI / 6);
    const corner = (index) => {
        const angle = ((index + 0.5) / 6) * TAU;
        return [Math.cos(angle) * cornerRadius, Math.sin(angle) * cornerRadius];
    };
    const positions = [];
    const faces = [];
    const uvs = [];
    const push = (x, y, z, face, u, v) => {
        positions.push(x, y, z);
        faces.push(...face);
        uvs.push(u, v);
    };
    SIDES.forEach((side, index) => {
        const [x0, z0] = corner(index - 1);
        const [x1, z1] = corner(index);
        const shaft = [side.c, side.s, 0];
        push(x1, 0, z1, shaft, 1, 0);
        push(x0, 0, z0, shaft, 0, 0);
        push(x0, 1, z0, shaft, 0, 1);
        push(x1, 0, z1, shaft, 1, 0);
        push(x0, 1, z0, shaft, 0, 1);
        push(x1, 1, z1, shaft, 1, 1);
        const termination = [side.c, side.s, 1];
        push(x1, 1, z1, termination, 1, 0);
        push(x0, 1, z0, termination, 0, 0);
        push(0, 2, 0, termination, 0.5, 1);
    });
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(faces, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return geometry;
}

/**
 * Write one crystal into the packed record.
 * @param {Float32Array} target
 * @param {number} index
 * @param {object} crystal position {x,y,z}, quaternion {x,y,z,w}, radius, depth (second
 *   radius), height, tip (termination height, world units), apex {x,z} offset in
 *   canonical units, family, glow, seed.
 */
export function packCrystal(target, index, crystal) {
    const o = index * GEM_STRIDE;
    target[o] = crystal.x;
    target[o + 1] = crystal.y;
    target[o + 2] = crystal.z;
    target[o + 3] = crystal.radius;
    target[o + 4] = crystal.qx;
    target[o + 5] = crystal.qy;
    target[o + 6] = crystal.qz;
    target[o + 7] = crystal.qw;
    target[o + 8] = crystal.height;
    target[o + 9] = crystal.depth ?? crystal.radius;
    target[o + 10] = crystal.tip / crystal.height;
    target[o + 11] = crystal.seed ?? 0;
    target[o + 12] = crystal.apexX ?? 0;
    target[o + 13] = crystal.apexZ ?? 0;
    target[o + 14] = crystal.family ?? 0;
    target[o + 15] = crystal.glow ?? 1;
}

// Breadth and termination length by mineral. Aqua forms broad short-capped blades, amethyst
// has deep pyramidal crowns, sapphire grows narrow spars, rose forms plates, amber long lances.
const HABITS = [[1.27, 0.76], [1.03, 1.58], [0.83, 1.08], [1.54, 0.92], [0.90, 1.78]];

/** Pack the facets used by the gem field and the pool reflection bake. The apex stays at its authored anchor. */
export function packMineralCrystal(target, index, crystal) {
    packCrystal(target, index, crystal);
    const o = index * GEM_STRIDE;
    const [breadth, crown] = HABITS[crystal.family] ?? HABITS[0];
    const reach = crystal.height + crystal.tip;
    // Subpixel druzy and new shoots retain their compact cuts.
    const strength = THREE.MathUtils.smoothstep(reach, 0.8, 3.8);
    const variation = (crystal.seed ?? 0.5) - 0.5;
    const width = 1 + strength * (breadth - 1 + variation * 0.11);
    // Descending lances have a longer termination. A horizontal spar retains its family's cut.
    const down = Math.max(0, 2 * (crystal.qx ** 2 + crystal.qz ** 2) - 1);
    const tip = Math.min(reach * 0.56, crystal.tip * (crown + down * 0.26 + variation * 0.24));
    const height = reach - THREE.MathUtils.lerp(crystal.tip, tip, strength);
    // Equal cross-sectional area and the same physical apex, including its sideways offset.
    target[o + 3] *= width;
    target[o + 8] = height;
    target[o + 9] /= width;
    target[o + 10] = (reach - height) / height;
    target[o + 12] /= width;
    target[o + 13] *= width;
}

/**
 * Schlick's Fresnel term. Written with products, not pow(): a cosine a hair above 1
 * makes pow() see a negative base, and one NaN pixel blacks out the whole bloom chain.
 */
function schlick(cosine) {
    const grazing = clamp(float(1).sub(cosine), 0, 1);
    const squared = grazing.mul(grazing);
    return float(F0).add(float(1 - F0).mul(squared.mul(squared).mul(grazing)));
}

const rotate = Fn(([v, q]) => {
    const t = cross(q.xyz, v).mul(2);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
}).setLayout({
    name: 'gemRotate',
    type: 'vec3',
    inputs: [{ name: 'v', type: 'vec3' }, { name: 'q', type: 'vec4' }],
});

/**
 * Where a ray that starts inside the solid leaves it.
 * `origin` and `direction` are canonical (direction is the rigid unit direction divided
 * by the scale, so the returned distance is in world units). Returns the canonical,
 * unnormalised outward normal of the exit plane in xyz and the distance in w.
 */
const traceExit = Fn(([origin, direction, shape]) => {
    const tau = shape.x;
    const apex = vec3(shape.y, tau.add(1), shape.z);
    const best = vec4(0, -1, 0, 1e6).toVar();
    const consider = (normal, slack) => {
        const approach = dot(normal, direction);
        const distance = max(slack, 0).div(max(approach, 1e-6));
        If(approach.greaterThan(1e-6).and(distance.lessThan(best.w)), () => {
            best.assign(vec4(normal, distance));
        });
    };
    SIDES.forEach(({ c, s }) => {
        const side = vec3(c, 0, s);
        consider(side, float(1).sub(dot(side, origin)));
        const lean = shape.y.mul(c).add(shape.z.mul(s));
        const termination = vec3(tau.mul(c), float(1).sub(lean), tau.mul(s));
        consider(termination, dot(termination, apex.sub(origin)));
    });
    consider(vec3(0, -1, 0), origin.y);
    return best;
}).setLayout({
    name: 'gemTraceExit',
    type: 'vec4',
    inputs: [
        { name: 'origin', type: 'vec3' },
        { name: 'direction', type: 'vec3' },
        { name: 'shape', type: 'vec3' },
    ],
});

/**
 * How far past the exit the ray would have met the next face, in world units: small where
 * the exit lands near an edge of its face, so the far facets' edges can be drawn inside the
 * stone. Same planes and inputs as `traceExit`; `first` is its distance.
 */
const exitEdgeGap = Fn(([origin, direction, shape, first]) => {
    const tau = shape.x;
    const apex = vec3(shape.y, tau.add(1), shape.z);
    const second = float(1e6).toVar();
    const consider = (normal, slack) => {
        const approach = dot(normal, direction);
        const distance = max(slack, 0).div(max(approach, 1e-6));
        If(approach.greaterThan(1e-6).and(distance.greaterThan(first.add(1e-4))).and(distance.lessThan(second)), () => {
            second.assign(distance);
        });
    };
    SIDES.forEach(({ c, s }) => {
        const side = vec3(c, 0, s);
        consider(side, float(1).sub(dot(side, origin)));
        const lean = shape.y.mul(c).add(shape.z.mul(s));
        const termination = vec3(tau.mul(c), float(1).sub(lean), tau.mul(s));
        consider(termination, dot(termination, apex.sub(origin)));
    });
    consider(vec3(0, -1, 0), origin.y);
    return second.sub(first);
}).setLayout({
    name: 'gemExitEdgeGap',
    type: 'float',
    inputs: [
        { name: 'origin', type: 'vec3' },
        { name: 'direction', type: 'vec3' },
        { name: 'shape', type: 'vec3' },
        { name: 'first', type: 'float' },
    ],
});

/** Signed depth below the termination faces, in canonical heights (0 on the faces). */
const terminationDepth = Fn(([point, shape]) => {
    const tau = shape.x;
    const apex = vec3(shape.y, tau.add(1), shape.z);
    const depth = float(-1e6).toVar();
    SIDES.forEach(({ c, s }) => {
        const lean = shape.y.mul(c).add(shape.z.mul(s));
        const rise = float(1).sub(lean);
        const termination = vec3(tau.mul(c), rise, tau.mul(s));
        depth.assign(max(depth, dot(termination, point.sub(apex)).div(rise)));
    });
    return depth;
}).setLayout({
    name: 'gemTerminationDepth',
    type: 'float',
    inputs: [{ name: 'point', type: 'vec3' }, { name: 'shape', type: 'vec3' }],
});

/**
 * @param {object} options
 * @param {object} options.light shared cave light (`createCaveLight`)
 * @param {number} options.capacity crystals the field can hold
 * @param {number} [options.bounces] internal ray segments (1–4)
 * @param {boolean} [options.dispersion] split the first exit into three wavelengths
 * @param {boolean} [options.inclusions] phantoms and rainbow fractures
 * @param {boolean} [options.seeThrough] the first exit sees the cave behind the stone (a copy
 *   of the frame drawn so far), refracted, instead of the fixed far field alone
 */
export function createGemField({
    light, capacity, bounces = 3, dispersion = true, inclusions = true, seeThrough = false,
}) {
    const count = Math.max(1, Math.floor(capacity));
    const u = light.uniforms;
    const geometry = createGemGeometry();
    const record = new Float32Array(count * GEM_STRIDE);
    const state = new Float32Array(count * 4);
    const buffer = new THREE.InstancedInterleavedBuffer(record, GEM_STRIDE);
    const field = (name, offset) => {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
        return attribute(name, 'vec4');
    };
    const iPlace = field('iPlace', 0); // position, radius
    const iQuat = field('iQuat', 4);
    const iDims = field('iDims', 8); // height, depth, tau, seed
    const iLook = field('iLook', 12); // apex x, apex z, family, glow
    const stateAttribute = new THREE.InstancedBufferAttribute(state, 4);
    stateAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('iState', stateAttribute); // pulse start, pulse strength, growth, spare
    const iState = attribute('iState', 'vec4');
    geometry.instanceCount = 0;

    // ---- vertex stage -------------------------------------------------------------
    const isApex = step(1.5, positionGeometry.y);
    const canonical = vec3(
        positionGeometry.x.add(isApex.mul(iLook.x)),
        min(positionGeometry.y, 1).add(isApex.mul(iDims.z)),
        positionGeometry.z.add(isApex.mul(iLook.y)),
    );
    const scale = vec3(iPlace.w, iDims.x, iDims.y).mul(iState.z);
    const world = rotate(canonical.mul(scale), iQuat).add(iPlace.xyz);
    const conjugate = vec4(iQuat.xyz.negate(), iQuat.w);

    const vCanonical = varying(canonical, 'vGemCanonical');
    const vWorld = varying(world, 'vGemWorld');
    const vEye = varying(rotate(cameraPosition.sub(iPlace.xyz), conjugate), 'vGemEye');
    const vScale = varying(scale, 'vGemScale');
    const vQuat = varying(iQuat, 'vGemQuat');
    const vShape = varying(vec3(iDims.z, iLook.x, iLook.y), 'vGemShape');
    const vLook = varying(vec4(iLook.z, iLook.w, iDims.w, iState.w), 'vGemLook');
    const vPulse = varying(iState.xy, 'vGemPulse');
    const vFace = varying(attribute('aFace', 'vec3'), 'vGemFace');

    // ---- fragment stage -----------------------------------------------------------
    // The frame behind the stones, one copy per render target (the pool's mirror draws them too,
    // into a smaller target: a shared copy would be resized under the main pass).
    const backdrop = seeThrough ? viewportTexture() : null;
    const shade = Fn(() => {
        const shape = vShape.toVar();
        const size = vScale.toVar();
        const girth = size.x.add(size.z).mul(0.5).toVar();
        const seed = vLook.z.toVar();
        const family = int(vLook.x.add(0.5));
        const level = u.familyLevel.element(family).toVar();
        const tint = vec3(u.familyColor.element(family)).toVar();
        const origin = vCanonical.toVar();
        const rigid = origin.mul(size).toVar();
        const view = normalize(rigid.sub(vEye)).toVar();
        const event = light.eventLight.toVar();
        const sky = light.skyLight.toVar();
        const far = (direction, spread) => light.environment(rotate(direction, vQuat), float(spread), event, sky);
        // Where the stone sits in the world: its entry point less the canonical offset.
        const centre = vWorld.sub(rotate(vCanonical.mul(vScale), vQuat)).toVar();

        // The facet we entered through, with the fine horizontal striae real prism
        // faces carry and a softened edge so facets do not meet as a razor line.
        const lean = shape.y.mul(vFace.x).add(shape.z.mul(vFace.y));
        const shaftNormal = vec3(vFace.x, 0, vFace.y);
        const tipNormal = vec3(shape.x.mul(vFace.x), float(1).sub(lean), shape.x.mul(vFace.y));
        const facet = normalize(mix(shaftNormal, tipNormal, vFace.z).div(size)).toVar();
        const grain = light.noise3(vec3(rigid.y.mul(0.9), seed.mul(7.3), rigid.x.add(rigid.z).mul(0.07))).toVar();
        const striae = grain.sub(0.5).mul(0.11).mul(float(1).sub(vFace.z));
        const normal = normalize(facet.add(vec3(0, striae, 0))).toVar();

        // Edges of a cut stone catch light: a line a pixel or two wide, whatever the distance.
        const distance = length(vWorld.sub(cameraPosition)).toVar();
        const local = uv();
        const inset = local.y.mul(0.5).mul(vFace.z);
        const faceWidth = girth.mul(1.155).mul(float(1).sub(local.y.mul(vFace.z)));
        const toSide = min(local.x.sub(inset), float(1).sub(local.x).sub(inset)).div(float(1).sub(inset.mul(2)).max(0.001))
            .mul(faceWidth);
        const toShoulder = mix(float(1).sub(local.y), local.y.mul(shape.x.mul(1.4)), vFace.z).mul(size.y);
        const hair = max(distance.mul(0.0019), girth.mul(0.01));
        const edge = float(1).sub(smoothstep(hair.mul(0.35), hair, min(toSide, toShoulder))).toVar();

        // Reflection off the facet.
        const cosIn = clamp(dot(view.negate(), normal), 0, 1).toVar();
        const fresnelIn = schlick(cosIn).toVar();
        const mirrored = far(reflect(view, normal), 1);

        // Refract into the stone.
        const eta = float(1 / IOR);
        const inside = normalize(view.mul(eta)
            .add(normal.mul(eta.mul(cosIn).sub(sqrt(max(float(1).sub(eta.mul(eta).mul(float(1).sub(cosIn.mul(cosIn)))), 0))))))
            .toVar();

        // Body colour: how much of each wavelength survives one girth of travel.
        // Iron and other trace minerals collect in late growth. The outer point is richly
        // coloured while the earliest quartz at the foot transmits a cooler, milkier light.
        const height = clamp(origin.y.div(shape.x.add(1)), 0, 1).toVar();
        const body = mix(vec3(1), tint, smoothstep(0.10, 0.83, height).mul(0.22).add(0.73)).toVar();
        const fire = mix(tint, vec3(1), 0.12).toVar();
        // The carpet of small points glows less than the stones of size: in the rock they read
        // as glinting mineral, not as lamps (a third of the light at the smallest).
        const small = float(1).sub(smoothstep(0.2, 0.75, girth)).toVar();
        // (The hour above the cave sets how strongly the stones glow: most when the shaft has gone.)
        const glow = vLook.y.mul(level).mul(mix(float(1), float(0.32), small)).mul(u.stoneGlow).toVar();
        const age = max(u.time.sub(vPulse.x), 0).toVar();
        // A pulse may be scheduled ahead (a wave reaches each crystal in turn). What an earlier
        // pulse still rings is carried beside it (vLook.w, kept on the same start and decay), so
        // a wave on its way never puts out a stone that is still ringing.
        const ring = vPulse.y.mul(exp(age.mul(-PULSE_DECAY))).mul(step(vPulse.x, u.time)).toVar();
        const pulse = ring.add(vLook.w.mul(exp(min(vPulse.x.sub(u.time), 4).mul(PULSE_DECAY)))).toVar();
        const crest = age.mul(1.9).toVar();
        const breath = cos(u.time.mul(0.55).add(seed.mul(TAU))).mul(0.14).add(0.86).toVar();

        /**
         * Light gathered along one straight run through the stone. The fire is a thin
         * filament on the axis, so its integral along a line is a Gaussian in the
         * closest approach: exact parallax, no ray marching.
         */
        const gather = (start, run, reach) => {
            const lateral = dot(run.xz, run.xz).add(1e-5);
            const nearest = clamp(dot(start.xz, run.xz).negate().div(lateral), 0, reach);
            const closest = start.add(run.mul(nearest));
            const miss = dot(closest.xz, closest.xz);
            const chord = min(sqrt(float(Math.PI / FILAMENT).div(lateral)), reach).div(girth);
            // Brightest where the stone leaves the rock, a steady ember higher up.
            const root = exp(closest.y.max(0).mul(-2.6)).mul(1.7).add(0.3);
            const band = exp(closest.y.sub(crest).div(0.17).pow2().negate());
            // The standing bands climb faster as play heats (the world drives the phase).
            const hum = cos(closest.y.mul(size.y).mul(1.7).sub(u.humPhase)).mul(0.5).add(0.5)
                .mul(u.resonance);
            // At rest a slow band of light climbs each stone, out of step with its neighbours.
            const climb = fract(u.time.mul(0.055).add(seed.mul(7.31))).mul(1.5).sub(0.2);
            const idle = exp(closest.y.sub(climb).div(0.24).pow2().negate()).mul(0.55);
            const filament = exp(miss.mul(-FILAMENT)).mul(chord);
            const middle = start.add(run.mul(reach.mul(0.5)));
            const halo = exp(dot(middle.xz, middle.xz).mul(-2.2)).mul(reach.div(girth)).mul(0.022);
            return filament.mul(root.add(idle).mul(breath).mul(glow).mul(2.12)
                .add(band.mul(ring).mul(9))
                .add(pulse.mul(2.6))
                .add(hum.mul(glow).mul(2.2)))
                .add(halo.mul(glow.add(pulse.mul(2))));
        };

        const radiance = vec3(0).toVar();
        const through = vec3(1).toVar();
        const point = origin.toVar();
        const heading = inside.toVar();

        for (let bounce = 0; bounce < bounces; bounce += 1) {
            const step3 = heading.div(size).toVar();
            const hit = traceExit(point, step3, shape).toVar();
            const span = hit.w.div(girth).toVar();
            const half = pow(body, vec3(min(span, 1.7).mul(0.5)));
            radiance.addAssign(through.mul(half).mul(fire).mul(gather(point, step3, hit.w)));
            if (bounce === 0) {
                // The far facets' edges, seen through the clear body: fine lines of caught light.
                const gap = exitEdgeGap(point, step3, shape, hit.w);
                const line = float(1).sub(smoothstep(hair.mul(0.45), hair.mul(1.5), gap));
                radiance.addAssign(through.mul(half).mul(line)
                    .mul(fire.mul(glow.mul(0.28).add(pulse.mul(1.1)).add(0.07)).add(far(heading, 2).mul(0.4))));
            }

            if (bounce === 0 && inclusions) {
                // Earlier tips enclosed in the present one. Quartz records alternating clear
                // and cloudy growth along those planes. Amethyst has broader chevrons, beryl
                // finer bands. One footprint-softened sample follows the actual refracted ray.
                const sample = point.add(step3.mul(hit.w.mul(0.48))).toVar();
                const amethyst = max(float(1).sub(abs(vLook.x.sub(1))), 0);
                const cycles = float(3.1).sub(amethyst.mul(1.05)).add(seed.mul(0.65));
                const patch = light.noise3(sample.mul(vec3(0.30, 0.53, 0.36)).add(seed.mul(11))).toVar();
                const layers = terminationDepth(sample, shape).negate().div(shape.x.add(1)).mul(cycles)
                    .add(seed.mul(1.7))
                    .add(patch.sub(0.5).mul(0.22))
                    .toVar();
                const phase = abs(fract(layers).sub(0.5)).toVar();
                const width = amethyst.mul(0.023).add(0.024).add(clamp(fwidth(layers), 0.005, 0.10));
                const border = float(1).sub(smoothstep(0, width, phase));
                const cloudy = float(1).sub(smoothstep(0, 0.22, phase));
                const veil = border.mul(amethyst.mul(0.17).add(0.16)).add(cloudy.mul(0.12))
                    .mul(smoothstep(0.40, 0.65, patch))
                    .mul(float(1).sub(small.mul(0.9)));
                radiance.addAssign(through.mul(mix(tint, vec3(0.82, 0.9, 1), 0.32)).mul(veil)
                    .mul(glow.mul(0.63).add(pulse.mul(0.85)).add(0.17)));

                // A healed fracture: a plane inside the stone that flashes thin-film colour.
                const tilt = seed.mul(37.7);
                const crack = normalize(vec3(cos(tilt), cos(seed.mul(91.3)).mul(0.9), cos(tilt.add(1.9))));
                const offset = fract(seed.mul(5.7)).mul(0.5).add(0.25);
                const rate = dot(crack, step3).toVar();
                const safeRate = max(abs(rate), 1e-6).mul(mix(float(-1), float(1), step(0, rate)));
                const reach = dot(crack, vec3(0, offset, 0).sub(point)).div(safeRate).toVar();
                const crossing = point.add(step3.mul(clamp(reach, 0, hit.w))).mul(size);
                const film = light.noise3(crossing.mul(0.11).add(seed.mul(3.1))).toVar();
                const inStone = step(0, reach).mul(step(reach, hit.w)).mul(float(1).sub(small)).toVar();
                const present = smoothstep(0.5, 0.72, film).mul(inStone);
                const filmPhase = dot(heading, normalize(crack.div(size))).mul(1.6).add(film.mul(1.3));
                const spectrum = cos(vec3(0, 0.33, 0.67).add(filmPhase).mul(TAU)).mul(0.5).add(0.5);
                radiance.addAssign(through.mul(spectrum).mul(present)
                    .mul(glow.mul(0.16).add(pulse.mul(0.5)).add(0.07)));

                // Fluid trapped along a healed plane leaves feather-like traces. Sample at
                // the ray/plane crossing: inclusions seen through neighbouring faces shift
                // against one another as the eye moves, while a polished face stays clear.
                const fluidUV = vec2(crossing.x.add(crossing.z.mul(0.63)), crossing.y.mul(0.46)
                    .sub(crossing.z.mul(0.37))).mul(0.19).add(seed.mul(9.7));
                const fluid = texture(light.noise, fluidUV).ra.toVar();
                const feather = abs(fluid.x.sub(0.51));
                const threads = float(1).sub(smoothstep(0.005, fwidth(fluid.x).add(0.026), feather));
                const pocket = smoothstep(0.42, 0.58, film).mul(smoothstep(0.39, 0.62, fluid.y)).mul(inStone);
                const pearl = mix(fire, vec3(0.76, 0.89, 1.0), 0.53);
                radiance.addAssign(pearl.mul(through).mul(pocket).mul(threads.mul(0.48).add(0.046))
                    .mul(glow.mul(0.61).add(0.22)));
            }

            through.mulAssign(pow(body, vec3(min(span, 1.7))));
            point.assign(point.add(step3.mul(hit.w)));

            const wall = normalize(hit.xyz.div(size)).toVar();
            const cosOut = clamp(dot(heading, wall), 0, 1).toVar();
            const sin2 = float(IOR * IOR).mul(float(1).sub(cosOut.mul(cosOut))).toVar();
            const cosT = sqrt(max(float(1).sub(sin2), 0)).toVar();
            const escapes = step(sin2, 0.9999).toVar();
            const fresnelOut = mix(float(1), schlick(cosT), escapes).toVar();
            // Through the base the ray meets the luminous root, not the cave.
            const rooted = smoothstep(0.5, 0.9, hit.y.negate());
            const leave = (index) => {
                const s2 = float(index * index).mul(float(1).sub(cosOut.mul(cosOut)));
                const ct = sqrt(max(float(1).sub(s2), 0));
                return normalize(heading.mul(index).sub(wall.mul(float(index).mul(cosOut).sub(ct))));
            };
            const seen = vec3(0).toVar();
            if (bounce === 0 && seeThrough) {
                // The first exit looks at the cave behind the stone: the frame drawn so far (rock,
                // pool, the sky's light), at the point a metre or two along the refracted ray,
                // one read per wavelength with dispersion. Off screen it falls back to the far field.
                const exitWorld = rotate(point.mul(size), vQuat).add(centre).toVar();
                const behind = (index) => {
                    const direction = rotate(leave(index), vQuat);
                    const ahead = exitWorld.add(direction.mul(girth.mul(2.2).add(1.6)));
                    const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(ahead, 1)));
                    const ndc = clip.xy.div(max(clip.w, 1e-3));
                    const at = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
                    const margin = min(min(at.x, at.y), min(float(1).sub(at.x), float(1).sub(at.y)));
                    const onScreen = smoothstep(0, 0.04, margin)
                        .mul(step(0, clip.w));
                    const frame = backdrop.sample(clamp(at, 0.001, 0.999)).rgb;
                    return mix(far(leave(index), 1), frame.mul(1.15).add(far(leave(index), 1).mul(0.35)), onScreen);
                };
                if (dispersion) {
                    seen.assign(vec3(behind(IOR_SPECTRUM[0]).r, behind(IOR_SPECTRUM[1]).g, behind(IOR_SPECTRUM[2]).b));
                } else {
                    seen.assign(behind(IOR));
                }
            } else if (bounce === 0 && dispersion) {
                seen.assign(vec3(
                    far(leave(IOR_SPECTRUM[0]), 1).r,
                    far(leave(IOR_SPECTRUM[1]), 1).g,
                    far(leave(IOR_SPECTRUM[2]), 1).b,
                ));
            } else {
                seen.assign(far(leave(IOR), 1.6));
            }
            const rootLight = fire.mul(glow.mul(0.42).add(pulse.mul(1.2)).add(0.02))
                .mul(exp(dot(point.xz, point.xz).mul(-1.6)));
            radiance.addAssign(through.mul(float(1).sub(fresnelOut)).mul(mix(seen, rootLight, rooted)));
            through.mulAssign(fresnelOut);
            heading.assign(reflect(heading, wall));
        }
        // Whatever is still bouncing is spread through the body as a soft inner light.
        radiance.addAssign(through.mul(body).mul(far(heading, 3)));

        // The foot of a crystal is milky where it leaves the rock.
        const milk = float(1).sub(smoothstep(0.02, grain.mul(0.19).add(0.15), height)).mul(0.74);
        const frosted = body.mul(far(normal, 6).mul(2.2)
            .add(fire.mul(glow.mul(0.42).add(pulse.mul(0.5)))));
        const worldNormal = rotate(facet, vQuat);
        const skyFace = max(dot(worldNormal, vec3(-0.42, 0.78, -0.46)), 0).toVar();
        const stone = mix(radiance.mul(skyFace.mul(0.35).add(0.77)), frosted, milk);

        // Crisp glints: a facet that mirrors the skylight (or the far heart) flashes whole,
        // so facets flicker on and off as the view drifts.
        const bounceWorld = rotate(reflect(view, normal), vQuat).toVar();
        const toSky = clamp(dot(bounceWorld, vec3(-0.4, 0.79, -0.46)), 0, 1);
        const toHeart = clamp(dot(bounceWorld, vec3(0.0, 0.14, -0.99)), 0, 1);
        const glintLight = vec3(0.82, 0.92, 1.0).mul(pow(toSky, 900).mul(26))
            .add(vec3(1.0, 0.78, 0.5).mul(pow(toHeart, 600).mul(10)));
        // As the crystal turns away from the opening the dark prism face meets a pale sky
        // reflection along its ridge. The termination retains the sharper mirror flash.
        const polish = mix(tint, u.skyTint, 0.62).mul(skyFace).mul(u.skyLevel)
            .mul(edge.mul(0.24).add(pow(toSky, 18).mul(0.43)));
        const surface = mirrored.mul(fresnelIn.mul(2.4).add(edge.mul(0.3))).add(polish)
            .add(glintLight.mul(fresnelIn.mul(3).add(0.15)))
            .add(fire.mul(edge).mul(glow.mul(0.07).add(pulse.mul(0.9))));
        const colour = stone.mul(float(1).sub(fresnelIn)).mul(mix(float(1), float(0.6), small)).add(surface);
        return vec4(light.haze(colour, distance, vWorld.y), 1);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'Crystal Cave — traced crystal';
    material.positionNode = world;
    material.fragmentNode = shade();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Crystal Cave — crystals';
    mesh.frustumCulled = false;
    // After the rock among the solids, so the copy of the frame it looks through holds the rock.
    if (seeThrough) mesh.renderOrder = 1;

    let used = 0;
    let disposed = false;
    return {
        mesh,
        material,
        capacity: count,
        get count() { return used; },
        /** Replace the whole field. Crystals beyond the capacity are dropped. */
        setCrystals(crystals) {
            used = Math.min(count, crystals.length);
            for (let index = 0; index < used; index += 1) {
                packMineralCrystal(record, index, crystals[index]);
                state.set([-1000, 0, crystals[index].growth ?? 1, 0], index * 4);
            }
            buffer.needsUpdate = true;
            stateAttribute.needsUpdate = true;
            geometry.instanceCount = used;
        },
        /**
         * A pulse of light at a crystal's root, starting at `time` (it may be ahead of `now`).
         * It joins whatever the stone still rings instead of restarting it (see `ringCrystal`).
         */
        pulse(index, time, strength, now = time) {
            if (!(index >= 0 && index < used)) return;
            ringCrystal(state, index, time, strength, now);
            stateAttribute.needsUpdate = true;
        },
        /**
         * A wave of pulses: crystal `i` starts at `time + delays[i]` (seconds). Entries
         * that are not finite are left alone. A stone still ringing keeps its light until the
         * wave arrives and adds to it.
         */
        pulseWave(time, delays, strength) {
            const limit = Math.min(used, delays.length);
            for (let index = 0; index < limit; index += 1) {
                const delay = delays[index];
                if (!(delay >= 0)) continue;
                ringCrystal(state, index, time + delay, strength, time);
            }
            stateAttribute.needsUpdate = true;
        },
        /** Forget every pulse (a replay starts clean). */
        clearPulses() {
            for (let index = 0; index < used; index += 1) {
                state[index * 4] = -1000;
                state[index * 4 + 1] = 0;
                state[index * 4 + 3] = 0;
            }
            stateAttribute.needsUpdate = true;
        },
        /** Growth factor 0..1 (the whole crystal scales from its root). */
        setGrowth(index, growth) {
            if (!(index >= 0 && index < used)) return;
            state[index * 4 + 2] = growth;
            stateAttribute.needsUpdate = true;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
