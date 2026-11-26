/**
 * Patterns of refracted light in the mist beside each bank. A stroke carries its two
 * ends in bank-width units, its offset around the spectrum, its width and its delay.
 * Both banks read the same cuts from their own edge of the board outward.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, exp, float, int,
    length, max, mix, positionGeometry, smoothstep, step, uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';

const cut = (x, y, endX, endY, hue, width, delay = 0) => [x, y, endX, endY, hue, width, delay];

// Two edges of light bound a hollow needle. The second edge grows from the bright
// shoulder after the first leaves it, so an entire facet never blinks into existence.
function needle(x, y, tipX, tipY, shoulder, hue, delay) {
    const neckX = x + (tipX - x) * 0.44;
    const neckY = y + (tipY - y) * 0.44 + shoulder;
    return [
        cut(x, y, tipX, tipY, hue, 0.76, delay),
        cut(x, y, neckX, neckY, hue + 0.065, 0.43, delay + 0.035),
        cut(neckX, neckY, tipX, tipY, hue + 0.105, 0.54, delay + 0.16),
    ];
}

/** Two translucent cleavages meet along the ridge. Their shoulders sit across the
 * growth axis, which gives even an upright crystal a lit face and a narrow return. */
function prism(x, y, tipX, tipY, width, hue, delay, light) {
    const dx = tipX - x;
    const dy = tipY - y;
    const inv = width / Math.hypot(dx, dy);
    const leftX = x + dx * 0.59 - dy * inv;
    const leftY = y + dy * 0.59 + dx * inv;
    const rightX = x + dx * 0.48 + dy * inv * 0.58;
    const rightY = y + dy * 0.48 - dx * inv * 0.58;
    return [
        [...cut(x, y, tipX, tipY, hue + 0.045, 1, delay + 0.035), leftX, leftY, light],
        [...cut(x, y, tipX, tipY, hue - 0.055, 1, delay + 0.065), rightX, rightY, light * 0.32],
        cut(x, y, tipX, tipY, hue, 0.56, delay),
        cut(x, y, leftX, leftY, hue + 0.065, 0.27, delay + 0.055),
        cut(leftX, leftY, tipX, tipY, hue + 0.09, 0.43, delay + 0.19),
        cut(rightX, rightY, tipX, tipY, hue - 0.045, 0.29, delay + 0.22),
    ];
}

const single = [
    cut(0, 0, 0.57, 0.045, 0, 1),
    cut(0.55, 0.045, 0.98, 0.018, 0.035, 0.85, 0.14),
    cut(0.53, 0.04, 0.82, 0.12, 0.1, 0.45, 0.17),
];
const double = [
    ...needle(0, 0, 0.97, 0.20, 0.05, 0.02, 0),
    ...needle(0, 0, 0.85, -0.14, -0.07, 0.18, 0.07),
];
const triple = [
    ...needle(0, 0, 0.74, 0.38, 0.075, -0.1, 0.06),
    ...needle(0, 0, 1, 0.085, 0.06, 0.04, 0),
    ...needle(0, 0, 0.69, -0.19, -0.05, 0.19, 0.11),
];
const quad = [
    ...needle(0, 0, 0.42, 0.60, 0.09, -0.22, 0.14),
    ...prism(0, 0, 0.76, 0.44, 0.041, -0.09, 0.065, 0.33),
    ...prism(0, 0, 1, 0.19, 0.054, 0.055, 0, 0.42),
    ...prism(0, 0, 0.91, -0.065, -0.038, 0.19, 0.095, 0.30),
    ...needle(0, 0, 0.64, -0.23, -0.08, 0.30, 0.17),
];
const crown = [
    ...prism(0.42, 0, 0.08, 0.62, 0.054, -0.17, 0.13, 0.43),
    ...prism(0.43, 0, 0.31, 0.96, 0.081, -0.07, 0.04, 0.55),
    ...prism(0.44, 0, 0.6, 1.14, 0.094, 0.035, 0, 0.74),
    ...prism(0.45, 0, 0.82, 0.82, 0.079, 0.15, 0.15, 0.57),
    ...prism(0.46, 0, 0.98, 0.46, 0.052, 0.26, 0.26, 0.43),
];
const drop = [
    cut(0.045, 0.85, 0.045, 0.015, 0, 1.15),
    cut(0.064, 0.58, 0.061, 0.012, 0.1, 0.5, 0.035),
    cut(0.045, 0, 0.31, 0.075, 0.035, 0.67, 0.17),
    cut(0.045, 0, 0.24, -0.045, 0.09, 0.45, 0.20),
];

const CAVE_CAUSTICS = Object.freeze({
    single, double, triple, quad, crown, drop,
});
export const CLEAR_CAUSTIC = Object.freeze(['single', 'single', 'double', 'triple', 'quad']);
const CAUSTIC_STROKES = Math.max(...Object.values(CAVE_CAUSTICS).map((strokes) => strokes.length));
const DECAY = 1.85;
const PRIORITY = Object.freeze({
    single: 1, double: 1, triple: 1, quad: 1.5, crown: 3, drop: 0.6,
});

/** Each copy holds one composition of optical edges. Birth and reach are per composition;
 * only a strike changes the instance data. Between events the strips collapse to zero area. */
export function createCaveCaustics({
    time, count, quadGeometry, additive,
}) {
    const place = Array.from({ length: count }, () => new THREE.Vector4(0, 0, 0, -100));
    const look = Array.from({ length: count }, () => new THREE.Vector4());
    const priorities = new Float32Array(count);
    const ids = Float32Array.from({ length: count * CAUSTIC_STROKES }, (_, i) => Math.floor(i / CAUSTIC_STROKES));
    const { geometry, attributes } = quadGeometry(ids.length, {
        iFan: { array: ids, size: 1 },
        iCut: { array: new Float32Array(ids.length * 4), size: 4, dynamic: true },
        iEdge: { array: new Float32Array(ids.length * 4), size: 4, dynamic: true },
        iFacet: { array: new Float32Array(ids.length * 3), size: 3, dynamic: true },
    });
    const id = int(attribute('iFan', 'float').add(0.5));
    const birth = uniformArray(place, 'vec4').element(id);
    const style = uniformArray(look, 'vec4').element(id); // signed span, height, strength, hue
    const line = attribute('iCut', 'vec4');
    const edge = attribute('iEdge', 'vec4'); // hue, width, delay, duration
    const facet = attribute('iFacet', 'vec3'); // shoulder in bank coordinates and light carried
    const isFace = step(0.001, facet.z);
    const elapsed = time.sub(birth.w).sub(edge.z);
    const age = clamp(elapsed, 0, 3);
    const live = step(0, elapsed).mul(step(elapsed, edge.w)).mul(step(0.01, edge.y));
    const head = smoothstep(0, 0.31, age).mul(live);
    const tail = smoothstep(edge.w.mul(0.52), max(edge.w, 0.01), age);
    const along = mix(tail, head, positionGeometry.x.add(0.5));
    const scale = style.xy;
    const vector = line.zw.sub(line.xy).mul(scale);
    const normal = vec2(vector.y.negate(), vector.x).div(max(length(vector), 0.001));
    const width = edge.y.mul(0.38).mul(clamp(abs(style.x).mul(0.095), 0.6, 1.4)).mul(live);
    const edgePoint = mix(line.xy, line.zw, along).mul(scale)
        .add(normal.mul(positionGeometry.y.mul(width)));
    const outer = mix(line.zw, facet.xy, uv().y);
    const facePoint = mix(line.xy, outer, along.mul(live)).mul(scale);
    const pos = mix(edgePoint, facePoint, isFace);
    const root = cameraViewMatrix.mul(vec4(birth.xyz, 1));
    const material = additive('Crystal Cave — split caustic');
    material.side = THREE.DoubleSide;
    material.vertexNode = cameraProjectionMatrix.mul(vec4(root.xyz.add(vec3(pos, 0)), 1));
    const across = uv().y.sub(0.5).mul(2);
    const fade = varying(style.z.mul(smoothstep(0, 0.06, age)).mul(exp(age.mul(-DECAY))).mul(live));
    const band = varying(style.w.add(edge.x));
    // A hair of white where light meets the facet, with separated wavelengths outside it.
    const rgb = cos(vec3(0, -0.333, 0.333).add(band).add(across.mul(0.12)).mul(Math.PI * 2)).mul(0.5).add(0.5);
    const taper = uv().x.mul(float(1).sub(uv().x)).mul(2.1).add(0.47);
    const lateral = across.div(taper);
    const core = exp(lateral.pow2().mul(-28));
    const body = exp(lateral.pow2().mul(-3.5));
    const tip = smoothstep(0.81, 0.99, uv().x).mul(float(1).sub(varying(head)).add(0.22));
    const planeLight = varying(facet.z).mul(uv().x.mul(0.43).add(uv().y.mul(0.15)).add(0.49));
    material.colorNode = mix(rgb, vec3(1), core.mul(0.32).mul(float(1).sub(varying(isFace)))).mul(1.9);
    material.opacityNode = mix(body.mul(0.46).add(core).mul(tip.add(1)), planeLight, varying(isFace)).mul(fade);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Crystal Cave — prismatic fans';
    mesh.frustumCulled = false;

    let cursor = 0;
    return {
        mesh,
        fire(origin, side, pattern, span, height, strength, now, hue) {
            const priority = PRIORITY[pattern];
            let weakest = Infinity;
            let slot = cursor;
            for (let offset = 0; offset < count; offset += 1) {
                const index = (offset + cursor) % count;
                const left = priorities[index] * Math.exp(-DECAY * Math.max(0, now - place[index].w));
                if (left < weakest) {
                    slot = index;
                    weakest = left;
                }
            }
            if (weakest > priority) return false;
            cursor = (slot + 1) % count;
            place[slot].set(origin.x, origin.y, origin.z, now);
            look[slot].set(side * span, height, strength, hue);
            priorities[slot] = priority;
            const cuts = CAVE_CAUSTICS[pattern];
            const start = slot * CAUSTIC_STROKES;
            const duration = pattern === 'crown' ? 1.95 : 1.27;
            for (let i = 0; i < CAUSTIC_STROKES; i += 1) {
                const stroke = cuts[i];
                if (stroke) {
                    attributes.iCut.setXYZW(start + i, stroke[0], stroke[1], stroke[2], stroke[3]);
                    attributes.iEdge.setXYZW(start + i, stroke[4], stroke[5], stroke[6], duration);
                    attributes.iFacet.setXYZ(start + i, stroke[7] ?? 0, stroke[8] ?? 0, stroke[9] ?? 0);
                } else {
                    attributes.iEdge.setXYZW(start + i, 0, 0, 0, 1);
                    attributes.iFacet.setXYZ(start + i, 0, 0, 0);
                }
            }
            attributes.iCut.needsUpdate = true;
            attributes.iEdge.needsUpdate = true;
            attributes.iFacet.needsUpdate = true;
            return true;
        },
        reset() {
            cursor = 0;
            priorities.fill(0);
            place.forEach((p) => p.set(0, 0, 0, -100));
        },
    };
}
