/**
 * Fall — the hair of the red squirrel's plume.
 *
 * A squirrel's tail is hair: what makes its outline is not a surface but a soft fringe the light shines
 * through. The body (assets/squirrel.glb) carries the plume's solid shape; this adds its hair as cards:
 * four planes through the tail's axis, 45 degrees apart, each a strip of strands on both sides that
 * root in the plume's surface and sweep back toward the brush, past the solid by about half its
 * width, and close round the end in a rounded brush. Whichever way the tail is seen, two or three of
 * the planes face the eye and give it a fringe; a plane seen edge on fades out.
 *
 * The cards are measured from the body itself when it is built (the tail bones' bind pose gives the
 * axis, the tail's own vertices its outline in eight directions and their skin weights at each
 * station), and are skinned to the same skeleton with those weights, so the hair bends exactly as
 * the plume it grows from. The strands are drawn in the shader (no texture): alpha to coverage with
 * the scene's 4x MSAA (High and up) makes a fine translucent fringe of them; below High it is a clean
 * alpha cut. Lit as the coat is, they glow gold when the low sun is behind them.
 */

import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraPosition, dot, float, floor, fract, hash, mix, normalize, normalWorldGeometry, positionWorld,
    fwidth, pow, saturate, sin, smoothstep, step, tangentWorld, vec3,
} from 'three/tsl';
import { FALL_SLICE_MS, fallSlice } from './fall-slices.js';
import { drainSteps, stepClock } from '../shared/build-steps.js';

/** The tail bones, root to brush. */
export const PLUME_BONES = Object.freeze(['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6']);
/** Metres (life size) between stations along the tail, and the share of the plume's width the hair runs past it. */
const STEP = 0.005;
/** How far past the last joint the plume's brush may reach (metres, life size). */
const OVERRUN = 0.08;
const FRINGE = 0.62;
/** The hair's length is held within these (metres, life size). */
const FRINGE_MIN = 0.0045;
const FRINGE_MAX = 0.024;
/** How far the hair at the edge sweeps back toward the brush, for its length. */
const SWEEP = 0.85;
/** How far the brush runs on past the plume's end, for the hair's length there. */
const BRUSH = 1.4;
/** The card planes: their angles round the axis from straight across (radians). */
const PLANES = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
/** Strands a metre along the tail (life size), each card side. */
const STRANDS = 520;

const smoothstepJs = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

/**
 * The plume measured from the skinned body in its bind pose: stations along the tail's axis, each with
 * its frame, the solid's reach in eight directions round it, and the skin weights there.
 * @param {THREE.SkinnedMesh} body
 * @returns {null | {stations: object[], length: number, end: number}}
 */
export function measurePlume(body) {
    return drainSteps(measurePlumeSteps(body, stepClock(FALL_SLICE_MS)));
}

/**
 * measurePlume(), its walk over the body's vertices a time slice a step.
 * @param {THREE.SkinnedMesh} body
 * @param {{ due: () => boolean, restart: () => void }} clock
 */
export function* measurePlumeSteps(body, clock) {
    const geometry = body?.geometry;
    const skeleton = body?.skeleton;
    if (!geometry?.attributes?.position || !geometry.attributes.skinIndex || !skeleton) return null;
    const boneIndex = PLUME_BONES.map((name) => skeleton.bones.findIndex((bone) => bone.name === name));
    if (boneIndex.some((i) => i < 0)) return null;
    const tailBone = new Set(boneIndex);
    // The joints in the body's own (bind) space.
    const toMesh = body.bindMatrixInverse;
    const joints = boneIndex.map((i) => new THREE.Vector3().setFromMatrixPosition(
        new THREE.Matrix4().copy(skeleton.boneInverses[i]).invert().premultiply(toMesh),
    ));
    joints.push(joints[6].clone().add(joints[6].clone().sub(joints[5])));
    const lengths = [];
    const starts = [0];
    for (let k = 0; k < 7; k++) {
        lengths.push(joints[k + 1].distanceTo(joints[k]));
        starts.push(starts[k] + lengths[k]);
    }
    const length = starts[7];
    const axisAt = (k) => joints[k + 1].clone().sub(joints[k]).normalize();
    // The plume's own axes: across (the body's left, square to the tail) and its dorsal side.
    const frameAt = (axis) => {
        const across = new THREE.Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
        const dorsal = new THREE.Vector3().crossVectors(axis, across).normalize();
        return { across, dorsal };
    };

    // Each tail vertex: where along the tail, which way round, how far out, and its weights.
    const { position } = geometry.attributes;
    const { skinIndex } = geometry.attributes;
    const { skinWeight } = geometry.attributes;
    const bins = Math.ceil((length + OVERRUN) / STEP) + 1;
    const reach = Array.from({ length: bins }, () => new Float64Array(8));
    const weights = Array.from({ length: bins }, () => new Map());
    const seen = new Uint32Array(bins);
    const p = new THREE.Vector3();
    const rel = new THREE.Vector3();
    let end = 0;
    for (let v = 0; v < position.count; v++) {
        if ((v & 255) === 0) yield* fallSlice(clock, 'plume');
        let onTail = 0;
        for (let j = 0; j < 4; j++) {
            if (tailBone.has(skinIndex.getComponent(v, j))) onTail += skinWeight.getComponent(v, j);
        }
        if (onTail < 0.5) continue;
        p.fromBufferAttribute(position, v);
        let best = Infinity;
        let bestS = 0;
        let bestK = 0;
        for (let k = 0; k < 7; k++) {
            const a = axisAt(k);
            const t = Math.min(lengths[k] + (k === 6 ? OVERRUN : 0), Math.max(0, rel.copy(p).sub(joints[k]).dot(a)));
            const d = rel.copy(p).sub(joints[k]).addScaledVector(a, -t).lengthSq();
            if (d < best) {
                best = d;
                bestS = starts[k] + t;
                bestK = k;
            }
        }
        const axis = axisAt(bestK);
        const { across, dorsal } = frameAt(axis);
        rel.copy(p).sub(joints[bestK]);
        rel.addScaledVector(axis, -rel.dot(axis));
        const x = rel.dot(across);
        const y = rel.dot(dorsal);
        const b = Math.min(bins - 1, Math.round(bestS / STEP));
        for (let dir = 0; dir < 8; dir++) {
            const angle = (dir * Math.PI) / 4;
            const along = x * Math.cos(angle) + y * Math.sin(angle);
            const side = Math.abs(-x * Math.sin(angle) + y * Math.cos(angle));
            if (along > 0 && side < along * 0.42) reach[b][dir] = Math.max(reach[b][dir], along);
        }
        for (let j = 0; j < 4; j++) {
            const w = skinWeight.getComponent(v, j);
            if (w <= 0) continue;
            const bone = skinIndex.getComponent(v, j);
            weights[b].set(bone, (weights[b].get(bone) || 0) + w);
        }
        seen[b] += 1;
        end = Math.max(end, bestS);
    }
    if (!seen.some((n) => n > 0)) return null;
    // Fill the empty bins from their neighbours and smooth the outline a little.
    for (let dir = 0; dir < 8; dir++) {
        let last = -1;
        for (let b = 0; b < bins; b++) {
            if (reach[b][dir] > 0) {
                if (last >= 0 && b - last > 1) {
                    for (let f = last + 1; f < b; f++) {
                        const t = (f - last) / (b - last);
                        reach[f][dir] = reach[last][dir] * (1 - t) + reach[b][dir] * t;
                    }
                }
                last = b;
            }
        }
        const copy = reach.map((row) => row[dir]);
        for (let b = 1; b < bins - 1; b++) {
            reach[b][dir] = 0.25 * copy[b - 1] + 0.5 * copy[b] + 0.25 * copy[b + 1];
        }
    }
    let lastWeights = null;
    const stations = [];
    for (let b = 0; b < bins; b++) {
        const s = b * STEP;
        let seg = 0;
        while (seg < 6 && s > starts[seg + 1]) seg += 1;
        const axis = axisAt(seg);
        const centre = joints[seg].clone().addScaledVector(axis, s - starts[seg]);
        if (weights[b].size) {
            const top = [...weights[b].entries()].sort((a, c) => c[1] - a[1]).slice(0, 4);
            const total = top.reduce((sum, [, w]) => sum + w, 0) || 1;
            lastWeights = top.map(([bone, w]) => [bone, w / total]);
        }
        stations.push({
            s, centre, axis, ...frameAt(axis), reach: Array.from(reach[b]), weights: lastWeights,
        });
    }
    // Weights for the bins before the first measured one.
    const first = stations.find((station) => station.weights)?.weights;
    stations.forEach((station) => {
        if (!station.weights) station.weights = first;
    });
    return { stations, length, end };
}

/** The solid's reach toward `angle` round the axis at a station (between the eight measured). */
function reachToward(station, angle) {
    const f = (((angle / (Math.PI / 4)) % 8) + 8) % 8;
    const i = Math.floor(f);
    const t = f - i;
    return station.reach[i] * (1 - t) + station.reach[(i + 1) % 8] * t;
}

/**
 * The cards' geometry from a measured plume (in the body's bind space, life size).
 * @param {ReturnType<typeof measurePlume>} plume
 */
export function buildPlumeGeometry(plume) {
    const { stations, end } = plume;
    const last = stations.reduce((best, station) => (station.s <= end ? station : best), stations[0]);
    const width = (station) => Math.max(station.reach[0], station.reach[4], 1e-4);
    const fringeAt = (station) => Math.min(FRINGE_MAX, Math.max(FRINGE_MIN, FRINGE * width(station)))
        * (0.35 + 0.65 * smoothstepJs(0, 0.03, station.s));
    const brushLength = fringeAt(last) * BRUSH;
    // The stations the cards run through: along the plume, then on past its end for the brush.
    const rows = stations.filter((station) => station.s <= end).map((station) => ({
        station, s: station.s, fringe: fringeAt(station), brush: 1,
    }));
    for (let i = 1; i <= 6; i++) {
        const u = i / 6;
        rows.push({
            station: last, s: end + brushLength * u, fringe: fringeAt(last), brush: Math.sqrt(Math.max(0, 1 - u * u)),
        });
    }
    const positions = [];
    const normals = [];
    const tangents = [];
    const hair = [];
    const skinIndex = [];
    const skinWeight = [];
    const index = [];
    const pointOn = (row, offset, direction, r, out) => {
        const { station } = row;
        out.copy(station.centre).addScaledVector(station.axis, row.s - station.s + offset)
            .addScaledVector(direction, r);
        return out;
    };
    const point = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const cardNormal = new THREE.Vector3();
    PLANES.forEach((angle, plane) => {
        for (const side of [1, -1]) {
            const around = angle + (side < 0 ? Math.PI : 0);
            const seed = plane * 2 + (side < 0 ? 1 : 0);
            const base = positions.length / 3;
            rows.forEach((row) => {
                const { station } = row;
                direction.copy(station.across).multiplyScalar(Math.cos(around))
                    .addScaledVector(station.dorsal, Math.sin(around)).normalize();
                cardNormal.crossVectors(station.axis, direction).normalize();
                const solid = reachToward(station, around) * row.brush;
                const fringe = row.fringe * (0.55 + 0.45 * row.brush);
                // Three across the strip: just inside the solid, half way out, the strands' ends
                // (swept back toward the brush, more the further out).
                const across = [
                    [solid * 0.82, 0],
                    [solid + fringe * 0.5, fringe * SWEEP * 0.32],
                    [solid + fringe * 1.08, fringe * SWEEP],
                ];
                across.forEach(([r, sweep]) => {
                    pointOn(row, sweep, direction, r, point);
                    positions.push(point.x, point.y, point.z);
                    normals.push(direction.x, direction.y, direction.z);
                    tangents.push(cardNormal.x, cardNormal.y, cardNormal.z, 1);
                    hair.push(r - solid, row.s, fringe, seed);
                    const w = station.weights || [];
                    for (let j = 0; j < 4; j++) {
                        skinIndex.push(w[j] ? w[j][0] : 0);
                        skinWeight.push(w[j] ? w[j][1] : 0);
                    }
                });
            });
            for (let k = 0; k + 1 < rows.length; k++) {
                for (let j = 0; j < 2; j++) {
                    const a = base + k * 3 + j;
                    const b = base + (k + 1) * 3 + j;
                    index.push(a, b, a + 1, a + 1, b, b + 1);
                }
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('tangent', new THREE.Float32BufferAttribute(tangents, 4));
    geometry.setAttribute('hair', new THREE.Float32BufferAttribute(hair, 4));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geometry.setIndex(index);
    return geometry;
}

/** The hair's material: strands drawn in the shader, lit as the coat is. */
function createHairMaterial(light, { root, tip }) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
    material.name = 'FallSquirrelPlumeHair';
    material.alphaToCoverage = true;
    material.alphaTest = 0.4;
    const data = attribute('hair', 'vec4');
    const out = data.x;
    const along = data.y;
    const fringe = data.z;
    const seed = data.w;
    // Two coats of strands, each rooted along the tail at its own spacing: a dense short underfur
    // that fills the fringe's root, and longer guard hairs, fewer, that make its edge. Each strand has
    // its own length and tone, and thins to its tip.
    // (Each strand waves a little on its way out.)
    const wave = sin(out.mul(520).add(along.mul(37)).add(seed)).mul(0.18);
    const coat = (density, offset, shortest, longest, width) => {
        const w = along.mul(density).add(seed.mul(offset)).add(wave).add(4096);
        const strand = floor(w);
        const across = fract(w);
        const key = strand.add(seed.mul(9173)).add(offset * 101);
        const reach = fringe.mul(hash(key).mul(longest - shortest).add(shortest));
        const toTip = saturate(out.div(reach));
        // Its half-width (of the strand's slot): full at the root, a hair at the tip.
        const half = mix(float(width), float(width * 0.18), toTip);
        const centre = hash(key.add(17)).mul(0.4).add(0.3);
        const thread = smoothstep(half, half.mul(0.45), abs(across.sub(centre)));
        return { alpha: thread.mul(smoothstep(1.0, 0.82, toTip)), tone: hash(key.add(53)) };
    };
    const under = coat(STRANDS * 1.8, 0.37, 0.36, 0.72, 0.56);
    const middle = coat(STRANDS * 1.0, 0.53, 0.6, 0.95, 0.46);
    const guard = coat(STRANDS * 0.5, 0.71, 0.85, 1.15, 0.36);
    // At the root the hair is solid; it parts into strands on the way out.
    const apart = smoothstep(fringe.mul(0.12), fringe.mul(0.55), out);
    const combed = mix(float(1), under.alpha.max(middle.alpha).max(guard.alpha), apart);
    // Strands finer than about a pixel would sparkle as the tail moves: there the fringe fades to what
    // they add up to, a soft band thinning out to their ends.
    const fine = smoothstep(0.35, 0.9, fwidth(along.mul(STRANDS)));
    const band = smoothstep(fringe.mul(0.9), fringe.mul(0.2), out);
    const strands = mix(combed, band, fine);
    const inside = smoothstep(-0.004, -0.0012, out);
    const world = positionWorld;
    const V = normalize(cameraPosition.sub(world));
    const edgeOn = smoothstep(0.08, 0.38, abs(dot(normalize(tangentWorld), V)));
    material.opacityNode = strands.mul(edgeOn).mul(inside);

    // (The radial direction the card was built with, not turned over on its back side.)
    const N = normalize(normalWorldGeometry);
    const L = light.uSunDir;
    const sun = light.sunlight();
    const toward = saturate(out.div(fringe));
    const tone = mix(
        mix(under.tone, middle.tone, step(under.alpha, middle.alpha)),
        guard.tone,
        step(under.alpha.max(middle.alpha), guard.alpha),
    ).mul(0.3).add(0.85);
    const paint = mix(root, tip, smoothstep(0.0, 1.0, toward).mul(0.85)).mul(tone);
    const albedo = mix(vec3(dot(paint, vec3(0.2126, 0.7152, 0.0722))), paint, 0.8).mul(0.92);
    // Hair takes the light from all round its strand (wrapped far), and the sky.
    const wrap = saturate(dot(N, L).add(0.8).div(1.8));
    const direct = albedo.mul(light.uSunColor).mul(wrap.mul(1.25)).mul(sun);
    const ambient = albedo.mul(light.ambient(N)).mul(1.45);
    // Hair against the light glows: most out at the ends, where it is thinnest.
    const behind = saturate(dot(V, L).negate());
    const glow = pow(albedo, vec3(0.7)).mul(vec3(1.3, 1.05, 0.7));
    const shine = glow.mul(light.uSunColor).mul(pow(behind, 1.5).mul(toward.mul(0.9).add(0.45)))
        .mul(sun.mul(0.85).add(0.15));
    const lit = direct.add(ambient).add(shine).add(glow.mul(light.uSunColor).mul(light.uWarmth.mul(0.03)));
    material.colorNode = light.haze(lit, { world });
    return material;
}

/**
 * The plume's hair for a squirrel's skinned body, on the body's own skeleton.
 * @param {object} o
 * @param {THREE.SkinnedMesh} o.body
 * @param {import('./fall-light.js').FallLight} o.light
 * @param {{root: THREE.Color, tip: THREE.Color}} [o.colours]  linear colours at the hair's root and tip
 */
export function createPlumeHair({ body, light, colours }) {
    return drainSteps(createPlumeHairSteps({ body, light, colours }, stepClock(FALL_SLICE_MS)));
}

/** createPlumeHair(), a time slice a step: the plume measured, then its cards built. */
export function* createPlumeHairSteps({ body, light, colours }, clock) {
    const plume = yield* measurePlumeSteps(body, clock);
    if (!plume) return null;
    yield* fallSlice(clock, 'plume');
    const geometry = buildPlumeGeometry(plume);
    const root = colours?.root ?? new THREE.Color().setRGB(0.39, 0.068, 0.0103);
    const tip = colours?.tip ?? new THREE.Color().setRGB(0.71, 0.25, 0.05);
    const material = createHairMaterial(light, {
        root: vec3(root.r, root.g, root.b),
        tip: vec3(tip.r, tip.g, tip.b),
    });
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = 'FallSquirrelPlumeHair';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    mesh.scale.copy(body.scale);
    body.parent?.add(mesh);
    mesh.bind(body.skeleton, body.bindMatrix.clone());
    return {
        mesh,
        plume,
        triangles: geometry.index.count / 3,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
