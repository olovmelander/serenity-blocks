/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the fish.
 *
 * One mesh, drawn once per koi: a lofted body (the plump torpedo of a pond-raised nishikigoi)
 * with a forked tail, broad pectoral fins, pelvic fins and a dorsal ridge. It is shaped for the
 * way it is seen — from above — and it swims in the vertex shader: a wave runs down the spine
 * and out through the tail, the body arcs into its turns and rolls a little with them, the
 * pectorals scull, the fins trail.
 *
 * Its skin is painted in the fragment shader from the varieties' own recipes — a white ground
 * with islands of red (kohaku), the same with ink (sanke), black with red and white (showa),
 * one red sun on the crown (tancho), plain metal (ogon, platinum), a blue net over the back
 * (asagi) — each fish with its own islands, from the pond's noise field. Under water the moon
 * reaches it through the surface, so caustics crawl over its back.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, dot, float, floor, fract, fwidth, length, max, mix, normalize,
    positionGeometry, positionWorld, pow, sign, sin, smoothstep, step, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { CHAIN_GOLD } from './koi-pond-light.js';

/** Floats per koi in the two instance buffers. */
export const KOI_LOOK_STRIDE = 20;
export const KOI_LIVE_STRIDE = 12;

/** Body wave: how many radians of phase lie between nose and tail tip. */
const WAVE_NUMBER = 5.6;

// ── Geometry ────────────────────────────────────────────────────────────────────────────────

/** Half-width, upper and lower half-height of the body along the spine (fractions of length). */
const PROFILE = [
    // s,     width,  up,     down
    [0.0, 0.0, 0.0, 0.0],
    [0.012, 0.028, 0.016, 0.017],
    [0.04, 0.053, 0.034, 0.032],
    [0.09, 0.075, 0.056, 0.05],
    [0.16, 0.088, 0.078, 0.07],
    [0.25, 0.099, 0.094, 0.084],
    [0.34, 0.102, 0.099, 0.088],
    [0.44, 0.094, 0.092, 0.08],
    [0.54, 0.078, 0.078, 0.066],
    [0.63, 0.058, 0.06, 0.05],
    [0.7, 0.04, 0.045, 0.038],
    [0.755, 0.024, 0.034, 0.03],
    [0.78, 0.014, 0.028, 0.026],
];
const BODY_END = 0.78;
const RING_SEGMENTS = 14;
const RINGS_PER_SPAN = 2;

function profileAt(s) {
    for (let i = 1; i < PROFILE.length; i += 1) {
        if (s <= PROFILE[i][0]) {
            const a = PROFILE[i - 1];
            const b = PROFILE[i];
            const t = (s - a[0]) / (b[0] - a[0]);
            const k = t * t * (3 - 2 * t);
            return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
        }
    }
    const last = PROFILE[PROFILE.length - 1];
    return [last[1], last[2], last[3]];
}

/**
 * The koi, one unit long: nose at x = +0.5, tail tip at x = −0.5, y up, z to its right.
 * Attributes: position, normal, aBody (s along the spine, around/fan coordinate −1..1, part,
 * flex 0 at a fin's root → 1 at its tip) and aFin (offset from the fin's root; zero on the body).
 * Parts: 0 body, 1 tail, 2 pectoral, 3 pelvic, 4 dorsal, 5 barbel.
 */
export function buildKoiGeometry() {
    const positions = [];
    const body = [];
    const fin = [];
    const indices = [];
    const vertex = (x, y, z, s, around, part, flex, fx = 0, fy = 0, fz = 0) => {
        positions.push(x, y, z);
        body.push(s, around, part, flex);
        fin.push(fx, fy, fz);
        return positions.length / 3 - 1;
    };

    // ── Body: rings of an egg-shaped section, a little flatter under the belly ──
    const stations = [];
    for (let i = 1; i < PROFILE.length; i += 1) {
        for (let k = 0; k < RINGS_PER_SPAN; k += 1) {
            stations.push(PROFILE[i - 1][0] + ((PROFILE[i][0] - PROFILE[i - 1][0]) * k) / RINGS_PER_SPAN);
        }
    }
    stations.push(BODY_END);
    const ringStart = [];
    stations.forEach((s) => {
        const [w, up, down] = profileAt(s);
        ringStart.push(positions.length / 3);
        for (let k = 0; k <= RING_SEGMENTS; k += 1) {
            // a = 0 on the dorsal ridge, ±π under the belly.
            const a = -Math.PI + (k / RING_SEGMENTS) * Math.PI * 2;
            const side = Math.sin(a);
            const top = Math.cos(a);
            const z = w * Math.sign(side) * Math.abs(side) ** 0.82;
            const y = (top >= 0 ? up : down) * Math.sign(top) * Math.abs(top) ** 0.9 + (up - down) * 0.2;
            vertex(0.5 - s, y, z, s, a / Math.PI, 0, 0);
        }
    });
    for (let r = 0; r < stations.length - 1; r += 1) {
        for (let k = 0; k < RING_SEGMENTS; k += 1) {
            const a = ringStart[r] + k;
            const b = ringStart[r + 1] + k;
            // (Wound so that the computed normals point OUT of the body: its back is lit from above.)
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }

    // ── A fan-shaped fin from a root point: radius R(θ) over a grid of θ x r ──
    const fan = ({
        root, part, heading, tilt, halfAngle, radius, raysN = 8, ringsN = 5, sAt, mirror = 1,
    }) => {
        const start = positions.length / 3;
        for (let j = 0; j <= ringsN; j += 1) {
            const r = j / ringsN;
            for (let i = 0; i <= raysN; i += 1) {
                const f = (i / raysN) * 2 - 1; // −1..1 across the fan
                // Each ray curves on its way out of the shoulder. The narrower trailing
                // membrane curls back further, while the two tail lobes sweep away from the fork.
                const bend = part === 1 ? -f * 0.18 : 0.34 + f * 0.12;
                const theta = heading + f * halfAngle + bend * r * r;
                const reach = radius(f) * r * (1 - 0.018 * (i % 2) * r * r);
                // In the fin's own plane (x back/forward, z out), then tilted about the x axis.
                const fx = Math.cos(theta) * reach;
                const out = Math.sin(theta) * reach;
                const cup = part === 1 ? 0.012 : 0.025;
                const fy = Math.sin(tilt) * out + (1 - f * f) * r * (1 - r) * cup * 3.8
                    + f * Math.sin(Math.PI * r * 0.75) * r * cup;
                const fz = Math.cos(tilt) * out * mirror;
                const x = root[0] + fx;
                const y = root[1] + fy;
                const z = root[2] * (part === 1 ? 1 : mirror) + fz;
                vertex(x, y, z, sAt(x), f, part, r, fx, fy, fz);
            }
        }
        for (let j = 0; j < ringsN; j += 1) {
            for (let i = 0; i < raysN; i += 1) {
                const a = start + j * (raysN + 1) + i;
                const b = a + raysN + 1;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    };
    const sOf = (x) => 0.5 - x;

    // Tail: two lobes splayed left and right of the spine with a notch between them, lifted
    // into a shallow V. It is the tail of a long-finned koi: it flows.
    fan({
        root: [0.5 - 0.745, 0.004, 0],
        part: 1,
        heading: Math.PI,
        tilt: 0,
        halfAngle: 0.9,
        radius: (f) => {
            const lobe = Math.abs(f);
            const crest = lobe < 0.64 ? lobe / 0.64 : (1 - lobe) / 0.36;
            return 0.105 - 0.042 * lobe + 0.202 * crest ** 1.22;
        },
        raysN: 24,
        ringsN: 6,
        sAt: sOf,
    });
    // Give the tail its dihedral: the lobes rise away from the middle.
    for (let i = 0; i < positions.length / 3; i += 1) {
        if (body[i * 4 + 2] === 1) {
            const rise = Math.abs(positions[i * 3 + 2]) * 0.49;
            positions[i * 3 + 1] += rise;
            fin[i * 3 + 1] += rise;
        }
    }
    // Pectorals: broad paddles from behind the gill plates, swept back and a little down.
    [1, -1].forEach((mirror) => {
        fan({
            root: [0.5 - 0.224, -0.025, 0.068],
            part: 2,
            heading: 1.98,
            tilt: -0.39,
            halfAngle: 0.78,
            radius: (f) => 0.028 + 0.169 * (1 - f * f) ** 0.76 * (1 - f * 0.14),
            raysN: 14,
            ringsN: 5,
            sAt: sOf,
            mirror,
        });
        // Pelvics: small, under the belly.
        fan({
            root: [0.5 - 0.5, -0.06, 0.05],
            part: 3,
            heading: 2.5,
            tilt: -0.5,
            halfAngle: 0.42,
            radius: (f) => 0.018 + 0.089 * (1 - f * f) ** 0.76,
            raysN: 8,
            ringsN: 3,
            sAt: sOf,
            mirror,
        });
    });
    // Dorsal: a ridge along the back, tallest in front.
    {
        const start = positions.length / 3;
        const s0 = 0.31;
        const s1 = 0.62;
        const cols = 12;
        const rows = 2;
        for (let j = 0; j <= rows; j += 1) {
            for (let i = 0; i <= cols; i += 1) {
                const f = i / cols;
                const s = s0 + (s1 - s0) * f;
                const [, up, down] = profileAt(s);
                const baseY = up + (up - down) * 0.2 - 0.004;
                const tall = 0.048 * Math.sin(Math.min(1, f * 5) * Math.PI * 0.5) * (1 - f) ** 1.15
                    * (0.91 + 0.09 * Math.cos(i * Math.PI));
                const h = (j / rows) * tall;
                const lean = h * (0.24 + 0.16 * Math.sin(f * Math.PI * 1.5));
                vertex(0.5 - s - h * 0.65, baseY + h, lean, s, f * 2 - 1, 4, j / rows, -h * 0.65, h, lean);
            }
        }
        for (let j = 0; j < rows; j += 1) {
            for (let i = 0; i < cols; i += 1) {
                const a = start + j * (cols + 1) + i;
                const b = a + cols + 1;
                indices.push(a, a + 1, b, b, a + 1, b + 1);
            }
        }
    }

    // The barbels sweep back from the corners of a carp's mouth.
    for (const side of [-1, 1]) {
        const start = positions.length / 3;
        for (let i = 0; i <= 5; i += 1) {
            const t = i / 5;
            const s = 0.032 + 0.046 * t * t;
            const z = side * (0.035 + 0.055 * t - 0.014 * t * t);
            const y = -0.009 - 0.008 * t + 0.004 * t * t;
            const width = 0.0036 * (1 - 0.9 * t);
            vertex(0.5 - s - width, y, z, s, side * 0.44, 5, 0);
            vertex(0.5 - s + width, y, z, s, side * 0.44, 5, 0);
            if (i > 0) {
                const a = start + 2 * (i - 1);
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('aBody', new THREE.BufferAttribute(new Float32Array(body), 4));
    geometry.setAttribute('aFin', new THREE.BufferAttribute(new Float32Array(fin), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    // Fins are lit from both sides; give them the normal of their own plane, pointing up.
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i += 1) {
        const part = body[i * 4 + 2];
        // The duplicated point at each fan root and the very tip of the nose have zero area.
        if (normals.getX(i) === 0 && normals.getY(i) === 0 && normals.getZ(i) === 0) {
            normals.setXYZ(i, part === 0 ? 1 : 0, part === 0 ? 0 : 1, 0);
        } else if (part !== 0 && part !== 4 && normals.getY(i) < 0) {
            normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
        }
    }
    return geometry;
}

// ── Varieties ───────────────────────────────────────────────────────────────────────────────

const WHITE = [0.9, 0.85, 0.76];
const HI = [0.86, 0.046, 0.016]; // the vermilion of a kohaku
const BENI = [1, 0.245, 0.027]; // persimmon orange
const SUMI = [0.01, 0.014, 0.026];
const GOLD = [0.98, 0.54, 0.075];
const PLATINUM = [0.82, 0.86, 0.9];
const SLATE = [0.16, 0.26, 0.4];
const LEMON = [0.95, 0.74, 0.16];

/**
 * How each variety is painted. `mark` / `ink` are coverage thresholds on the noise field
 * (lower = more covered, above 1 = none); style 1 = one sun on the crown, 2 = a net of scales.
 */
export const KOI_VARIETIES = Object.freeze([
    {
        name: 'kohaku', weight: 5, base: WHITE, markColour: HI, mark: 0.47, inkColour: SUMI, ink: 2, metal: 0.1, style: 0,
    },
    {
        name: 'sanke', weight: 3, base: WHITE, markColour: HI, mark: 0.5, inkColour: SUMI, ink: 0.68, metal: 0.1, style: 0,
    },
    {
        name: 'showa', weight: 2, base: SUMI, markColour: HI, mark: 0.46, inkColour: WHITE, ink: 0.6, metal: 0.05, style: 0,
    },
    {
        name: 'tancho', weight: 2, base: WHITE, markColour: HI, mark: 2, inkColour: SUMI, ink: 2, metal: 0.15, style: 1,
    },
    {
        name: 'ogon', weight: 3, base: GOLD, markColour: LEMON, mark: 0.62, inkColour: SUMI, ink: 2, metal: 1, style: 0,
    },
    {
        name: 'platinum', weight: 2, base: PLATINUM, markColour: WHITE, mark: 0.6, inkColour: SUMI, ink: 2, metal: 1, style: 0,
    },
    {
        name: 'asagi', weight: 2, base: SLATE, markColour: BENI, mark: 2, inkColour: SUMI, ink: 2, metal: 0.2, style: 2,
    },
    {
        name: 'benigoi', weight: 2, base: BENI, markColour: HI, mark: 0.55, inkColour: SUMI, ink: 2, metal: 0.25, style: 0,
    },
    {
        name: 'bekko', weight: 1, base: LEMON, markColour: GOLD, mark: 0.6, inkColour: SUMI, ink: 0.63, metal: 0.3, style: 0,
    },
]);

/**
 * Write one koi's look into the static instance buffer.
 * @param {Float32Array} out
 * @param {number} index
 * @param {object} koi   { variety, length, seedU, seedV, fins, girth, tone }
 */
export function writeKoiLook(out, index, koi) {
    const v = KOI_VARIETIES[koi.variety] || KOI_VARIETIES[0];
    const o = index * KOI_LOOK_STRIDE;
    const tone = koi.tone ?? 1;
    out[o] = v.base[0] * tone;
    out[o + 1] = v.base[1] * tone;
    out[o + 2] = v.base[2] * tone;
    out[o + 3] = koi.length;
    out[o + 4] = v.markColour[0];
    out[o + 5] = v.markColour[1];
    out[o + 6] = v.markColour[2];
    out[o + 7] = v.mark + (koi.markBias ?? 0);
    out[o + 8] = v.inkColour[0];
    out[o + 9] = v.inkColour[1];
    out[o + 10] = v.inkColour[2];
    out[o + 11] = v.ink;
    out[o + 12] = koi.seedU;
    out[o + 13] = koi.seedV;
    out[o + 14] = v.metal;
    out[o + 15] = v.style;
    out[o + 16] = koi.fins ?? 1;
    out[o + 17] = koi.girth ?? 1;
    out[o + 18] = 0;
    out[o + 19] = 0;
}

// ── The drawn school ────────────────────────────────────────────────────────────────────────

/**
 * @param {PondLight} light
 * @param {number} count           koi in the pond
 * @returns {{ mesh, geometry, material, look:Float32Array, live:Float32Array, commit():void }}
 */
export function createKoi(light, count) {
    const { u } = light;
    const base = buildKoiGeometry();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(base.getIndex());
    ['position', 'normal', 'aBody', 'aFin'].forEach((name) => geometry.setAttribute(name, base.getAttribute(name)));
    geometry.instanceCount = count;

    const look = new Float32Array(count * KOI_LOOK_STRIDE);
    const live = new Float32Array(count * KOI_LIVE_STRIDE);
    const lookBuffer = new THREE.InstancedInterleavedBuffer(look, KOI_LOOK_STRIDE);
    const liveBuffer = new THREE.InstancedInterleavedBuffer(live, KOI_LIVE_STRIDE);
    liveBuffer.setUsage(THREE.DynamicDrawUsage);
    [['aBase', 0], ['aMark', 4], ['aInk', 8], ['aTrait', 12], ['aBuild', 16]].forEach(([name, offset]) => {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(lookBuffer, 4, offset));
    });
    [['aPose', 0], ['aSwim', 4], ['aState', 8]].forEach(([name, offset]) => {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(liveBuffer, 4, offset));
    });

    const aBody = attribute('aBody', 'vec4');
    const aFin = attribute('aFin', 'vec3');
    const aBase = attribute('aBase', 'vec4');
    const aMark = attribute('aMark', 'vec4');
    const aInk = attribute('aInk', 'vec4');
    const aTrait = attribute('aTrait', 'vec4');
    const aBuild = attribute('aBuild', 'vec4');
    const aPose = attribute('aPose', 'vec4');
    const aSwim = attribute('aSwim', 'vec4');
    const aState = attribute('aState', 'vec4');

    /** The swimming body: returns the world position, or the world normal. */
    const swim = (wantNormal) => Fn(() => {
        const s = aBody.x;
        const part = aBody.z;
        const flex = aBody.w;
        const isBody = step(part, 0.5);
        const isTail = step(0.5, part).mul(step(part, 1.5));
        const isPectoral = step(1.5, part).mul(step(part, 2.5));
        const isDorsal = step(3.5, part);
        const phase = aSwim.x;
        const amp = aSwim.y;
        const curve = aSwim.z;
        const side = sign(positionGeometry.z);

        // Fins hinge at their roots: longer on a long-finned fish, and the pectorals scull.
        const root = positionGeometry.sub(aFin);
        const stroke = phase.mul(0.43).add(aTrait.x.mul(5.1)).add(side.mul(1.28)).sub(flex.mul(0.85))
            .toVar();
        const rowing = sin(stroke).mul(amp.mul(0.27).add(0.22));
        const spread = aState.z.mul(0.48).add(rowing).add(side.mul(curve).mul(0.22)).mul(isPectoral);
        const mirrored = aFin.z.mul(side);
        const finX = aFin.x.mul(cos(spread)).add(mirrored.mul(sin(spread)));
        const finZ = mirrored.mul(cos(spread)).sub(aFin.x.mul(sin(spread))).mul(side);
        const lift = cos(stroke).mul(amp.mul(0.025).add(0.021)).mul(isPectoral).toVar();
        const flap = flex.mul(flex).mul(lift);
        const grown = mix(float(1.0), aBuild.x, step(0.5, part).mul(isDorsal.oneMinus()));
        const p = root.add(vec3(finX, aFin.y.add(flap), finZ).mul(grown)).toVar();
        const girth = mix(float(1.0), aBuild.y, isBody);
        p.y.mulAssign(girth);
        p.z.mulAssign(girth);

        // The wave down the spine: small at the head, wide through the tail, later in the fins.
        const lag = flex.mul(isTail.mul(0.8).add(isDorsal.mul(1.1)));
        const along = float(WAVE_NUMBER).mul(s).add(lag);
        const reach = float(0.01).add(s.mul(s).mul(0.115)).mul(isTail.mul(flex).mul(0.5).add(1.0));
        const bend = s.sub(0.3);
        const lateral = amp.mul(reach).mul(sin(phase.sub(along))).add(curve.mul(bend).mul(abs(bend)).mul(0.62));
        p.z.addAssign(lateral.mul(isDorsal.mul(flex).mul(0.6).add(1.0)));
        // The tail's lobes ride up and down as it sweeps.
        p.y.addAssign(isTail.mul(flex).mul(aBody.y).mul(sin(phase.sub(along).sub(1.3))).mul(amp)
            .mul(0.035));

        // dz/dx of that wave: a sheared section turns its normal with it.
        const dzds = amp.mul(
            s.mul(0.23).mul(sin(phase.sub(along))).sub(reach.mul(WAVE_NUMBER).mul(cos(phase.sub(along)))),
        ).add(curve.mul(abs(bend)).mul(1.24));
        const n = attribute('normal', 'vec3').toVar();
        n.x.addAssign(n.z.mul(dzds));
        n.z.subAssign(side.mul(lift).mul(flex).mul(7.0));

        // Roll into the turn, take its length, pitch (a leap), then its heading and place.
        const roll = aState.x;
        const pitch = aSwim.w;
        const heading = aPose.w;
        const turn = (v) => {
            const y1 = v.y.mul(cos(roll)).sub(v.z.mul(sin(roll)));
            const z1 = v.y.mul(sin(roll)).add(v.z.mul(cos(roll)));
            const x2 = v.x.mul(cos(pitch)).sub(y1.mul(sin(pitch)));
            const y2 = v.x.mul(sin(pitch)).add(y1.mul(cos(pitch)));
            return vec3(
                x2.mul(cos(heading)).sub(z1.mul(sin(heading))),
                y2,
                x2.mul(sin(heading)).add(z1.mul(cos(heading))),
            );
        };
        if (wantNormal) return normalize(turn(n));
        return turn(p.mul(aBase.w).mul(aState.w)).add(aPose.xyz);
    })();

    const vNormal = varying(swim(true), 'vKoiNormal');
    const vBody = varying(aBody, 'vKoiBody');

    const paint = Fn(() => {
        const point = positionWorld.toVar();
        const s = vBody.x;
        const around = vBody.y;
        const part = vBody.z;
        const flex = vBody.w;
        const isBody = step(part, 0.5).toVar();
        const isFin = isBody.oneMinus().toVar();
        const dorsal = step(3.5, part).mul(step(part, 4.5));
        const style = floor(aTrait.w.add(0.5)).toVar();
        const isCrowned = step(0.5, style).mul(step(style, 1.5));
        const isNetted = step(1.5, style);

        // ── Markings: islands of colour from the pond's noise field, each fish its own ──
        const pigmentAround = mix(around, float(0), dorsal);
        const st = vec2(s.mul(1.5).add(aTrait.x), pigmentAround.mul(0.34).add(aTrait.y));
        const broad = light.noise.sample(st);
        const second = light.noise.sample(st.mul(2.3).add(vec2(0.37, 0.61)));
        const flank = float(1.0).sub(smoothstep(0.5, 0.93, abs(around))).mul(isBody).add(isFin.mul(float(1.0).sub(flex.mul(0.75))));
        const markField = broad.r.mul(0.76).add(second.g.mul(0.24));
        const islands = smoothstep(aMark.w.sub(0.03), aMark.w.add(0.03), markField).mul(flank);
        // Tancho: one round sun on the crown of the head.
        const crown = float(1.0).sub(smoothstep(0.042, 0.056, length(vec2(s.sub(0.118), around.mul(0.085))))).mul(isBody);
        const marked = mix(islands, crown, isCrowned).toVar();
        const inkField = second.r.mul(0.62).add(broad.g.mul(0.38));
        const inked = smoothstep(aInk.w.sub(0.028), aInk.w.add(0.028), inkField)
            .mul(float(1.0).sub(smoothstep(0.72, 1.0, abs(around)).mul(isBody)));

        const skin = mix(mix(aBase.rgb, aMark.rgb, marked), aInk.rgb, inked).toVar();
        // Each row overlaps its neighbour by half a scale. The curved trailing edge catches
        // the moon. Once a plate is smaller than a pixel the scales read as a satin surface.
        const row = around.mul(8.5).toVar();
        const across = fract(row).sub(0.5).toVar();
        const along = s.mul(24.0).add(floor(row).mul(0.5));
        const arch = along.sub(across.mul(across).mul(1.65)).toVar();
        const seam = abs(fract(arch.add(0.5)).sub(0.5));
        const footprint = fwidth(s).mul(24.0).add(fwidth(around).mul(8.5)).toVar();
        const aa = clamp(footprint.mul(0.42), 0.025, 0.32);
        const lip = smoothstep(0.015, aa.add(0.085), seam).oneMinus();
        const resolved = smoothstep(0.32, 0.86, footprint).oneMinus();
        const scaled = smoothstep(0.15, 0.23, s).mul(isBody).toVar();
        const scallop = resolved.mul(scaled).toVar();
        const plateLight = lip.oneMinus().toVar();
        skin.mulAssign(float(1.0).sub(lip.mul(scallop).mul(0.22)));
        // Asagi: the net IS the pattern — pale blue plates edged in slate, a red belly.
        const netted = mix(aBase.rgb.mul(1.4).add(vec3(0.045, 0.07, 0.1)), aBase.rgb.mul(0.37), lip.mul(resolved));
        const redBelly = smoothstep(0.52, 0.8, abs(around)).mul(isBody).add(isFin.mul(float(1.0).sub(flex.mul(0.6))));
        skin.assign(mix(skin, mix(netted, aMark.rgb, redBelly), isNetted.mul(scaled.mul(isBody).add(isFin))));
        // Pearly gill covers and a short crease curve away from the eye toward the shoulder.
        const belly = smoothstep(0.62, 0.98, abs(around)).mul(isBody).mul(isNetted.oneMinus());
        skin.assign(mix(skin, skin.mul(0.5).add(0.36), belly.mul(0.55)));
        const cheek = abs(around).toVar();
        const gill = s.sub(float(0.182).sub(cheek.sub(0.35).pow2().mul(0.25))).toVar();
        const cover = smoothstep(0.1, 0.31, cheek).mul(smoothstep(0.6, 0.75, cheek).oneMinus()).mul(isBody);
        const crease = smoothstep(0.001, 0.011, abs(gill)).oneMinus().mul(cover);
        skin.mulAssign(crease.mul(-0.47).add(1.0));
        const cheekPearl = smoothstep(0.0, 0.021, abs(gill.add(0.018))).oneMinus().mul(cover);
        skin.addAssign(vec3(0.18, 0.125, 0.085).mul(cheekPearl));
        const eyeUv = vec2(s.sub(0.078), cheek.sub(0.40).mul(0.205)).toVar();
        const eyeRadius = length(eyeUv).toVar();
        const eye = smoothstep(0.018, 0.025, eyeRadius).oneMinus().mul(isBody);
        const pupil = smoothstep(0.011, 0.017, eyeRadius).oneMinus();
        const glint = smoothstep(0.002, 0.007, length(eyeUv.add(vec2(0.005, 0.006)))).oneMinus();
        skin.assign(mix(skin, mix(vec3(0.29, 0.16, 0.055), vec3(0.007, 0.01, 0.017), pupil).add(glint.mul(0.85)), eye));
        // Light between the fin rays picks up the cool water. Their fan is widest toward the
        // tips, where a soft ivory edge shows against the bed even on a white fish.
        const rayWave = cos(around.mul(24.0).add(flex.mul(flex).mul(1.9)));
        const ray = smoothstep(0.57, 0.98, rayWave).mul(smoothstep(0.18, 0.54, flex));
        const veil = mix(skin.mul(0.71), vec3(0.29, 0.39, 0.37), flex.mul(0.64));
        const tip = smoothstep(0.71, 0.98, flex).mul(0.26);
        const membrane = mix(veil, skin.mul(0.7).add(vec3(0.19, 0.15, 0.09)), ray.mul(0.58).add(tip));
        skin.assign(mix(skin, membrane, isFin.mul(smoothstep(0.02, 0.59, flex))));

        // ── Light ──
        const under = smoothstep(0.012, -0.012, point.y).toVar();
        const depth = max(point.y.negate(), 0.0).toVar();
        const normal = normalize(vNormal).toVar();
        const view = normalize(cameraPosition.sub(point)).toVar();
        const toMoon = normalize(mix(u.moonDir, normalize(vec3(u.underSlope.x, 1.0, u.underSlope.y)), under)).toVar();
        const ndl = dot(normal, toMoon).toVar();
        // The body wraps the light round its back; a fin is lit from either face.
        const finLight = abs(ndl).mul(0.35).add(0.48).add(dorsal.mul(0.19));
        const wrapped = mix(clamp(ndl.mul(0.72).add(0.28), 0.0, 1.0), finLight, isFin);
        const lit = light.moonlight().toVar();
        // (Held below the bed's brightest lines: a white koi must keep its markings.)
        const gathered = mix(float(1.0), light.caustic(point).min(2.2), under).toVar();
        const sink = light.downwelling(depth);
        // (The koi are the picture: the moon on them is a shade whiter than on the stones.)
        const moon = mix(u.moonColor, vec3(1.0, 0.95, 0.88), 0.62).mul(wrapped).mul(gathered).mul(lit)
            .mul(sink)
            .mul(1.2)
            .mul(u.breath.mul(0.8).add(0.2));
        const ambient = mix(u.skyAmbient, u.waterAmbient, under).mul(normal.y.mul(0.3).add(0.7)).mul(1.5);
        const lamp = light.lantern(point, normal).mul(1.3);
        const band = light.ringLight(point.xz).mul(1.5);
        // Wet skin: a soft bar of moon along the back, harder on the metallic fish.
        const half = normalize(toMoon.add(view));
        const gloss = clamp(dot(normal, half), 0.0, 1.0);
        const metal = aTrait.z;
        const rear = fract(arch).toVar();
        const facet = smoothstep(0.035, 0.18, rear).mul(smoothstep(0.18, 0.46, rear).oneMinus());
        const scaleFlash = facet.mul(scallop).mul(plateLight).mul(pow(gloss, 9.0));
        const sheen = pow(gloss, mix(float(26.0), float(60.0), metal)).mul(mix(float(0.22), float(1.0), metal))
            .mul(isBody.mul(0.85).add(0.15)).mul(lit)
            .mul(gathered)
            .mul(mix(float(1.6), float(1.0), under));
        // A chain of clears: the koi take fire from inside — the markings first, then the rim.
        const rim = float(1.0).sub(clamp(abs(dot(normal, view)), 0.0, 1.0));
        const fire = vec3(...CHAIN_GOLD).mul(aState.y).mul(marked.mul(0.2).add(rim.mul(rim).mul(1.1)).add(0.03))
            .add(skin.mul(aState.y).mul(0.28));

        const silver = mix(vec3(0.93, 0.85, 0.7), skin.add(0.07), metal)
            .mul(scaleFlash).mul(metal.mul(0.4).add(0.085));
        const colour = skin.mul(moon.add(ambient).add(lamp).add(band))
            .add(mix(u.moonColor, skin.add(0.2), metal.mul(0.7)).mul(sheen).mul(sink))
            .add(silver.mul(lit).mul(sink).mul(u.breath))
            .add(fire);
        return vec4(colour, 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'Koi Pond — koi';
    material.positionNode = swim(false);
    // (A caster's shading must live in fragmentNode: its colorNode would run in the shadow pass.)
    material.fragmentNode = paint();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — koi';
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrixWorld(true);

    return {
        mesh,
        geometry,
        material,
        look,
        live,
        count,
        /** Upload this frame's poses. */
        commit() {
            liveBuffer.needsUpdate = true;
        },
        commitLook() {
            lookBuffer.needsUpdate = true;
        },
        dispose() {
            base.dispose();
        },
    };
}
