/**
 * Chiral Gold — the two towers.
 *
 * Each tower is a braid of three broad gold ribbons wound one way round a glowing core, inside a
 * cage of fine wire wound the other way, with beads of gold sliding along the wires. The left
 * tower is the mirror image of the right (x ↔ −x): they are the two hands of one form, and they
 * turn in opposite senses.
 *
 * The gold is a real metal. Its colour comes from what it reflects (the studio baked in
 * chiral-gold-tsl.js), so a ribbon turning in front of the camera drags soft boxes, strip lights
 * and pin lights across itself exactly as polished metal does.
 *
 * Gameplay reaches the towers as numbers in shared uniforms: pulses that run up and down the
 * ribbons from the height a piece struck at (the ribbons swell as a pulse passes and the beads it
 * crosses flash), a flare held after a clear, and the chain's heat, which lights each tower from
 * its core outward.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cos,
    dot,
    exp,
    float,
    fract,
    max,
    min,
    mix,
    normalLocal,
    normalView,
    normalize,
    positionGeometry,
    positionLocal,
    positionViewDirection,
    pow,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import {
    HELIX,
    PULSE_FADE,
    PULSE_SLOTS,
    PULSE_SPEED,
    PULSE_WIDTH,
    TAU,
    cgBell,
    cgPart,
    helixHeight,
    mulberry32,
    ribbonPoint,
    wirePoint,
} from './chiral-gold-tsl.js';

const HEIGHT = HELIX.top - HELIX.bottom;

/** Points round the ribbon's lens-shaped section. */
const SECTION = 12;
/** Sides of a wire. */
const WIRE_SIDES = 5;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};

/** Width of every ribbon along the tower: it breathes, and closes to a point above the frame. */
function ribbonTaper(s) {
    const t = Math.min(1, Math.max(0, (s - 0.84) / 0.16));
    return Math.sqrt(1 - t * t * (3 - 2 * t)) * 0.985 + 0.015;
}

/**
 * The three ribbons of one tower as a single mesh. Built right-handed; the left tower mirrors x
 * and reverses the winding.
 * Attributes: position, normal, uv (metres along, 0..1 round), aBraid (which ribbon).
 */
export function buildRibbonGeometry(segments, hand = 1) {
    const ring = SECTION + 1;
    const perRibbon = (segments + 1) * ring;
    const count = perRibbon * HELIX.ribbons;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const braid = new Float32Array(count);
    const index = new Uint32Array(segments * SECTION * 6 * HELIX.ribbons);
    let v = 0;
    let t = 0;
    const eps = 0.5 / segments;
    for (let k = 0; k < HELIX.ribbons; k++) {
        const base = v;
        let run = 0;
        let last = null;
        for (let i = 0; i <= segments; i++) {
            const s = i / segments;
            const c = ribbonPoint(s, k, 1);
            const tangent = norm(sub(ribbonPoint(s + eps, k, 1), ribbonPoint(s - eps, k, 1)));
            // Radial: straight out from the tower's axis, squared up against the tangent.
            const out = [c[0], 0, c[2]];
            const along = out[0] * tangent[0] + out[2] * tangent[2];
            const radial = norm([out[0] - tangent[0] * along, -tangent[1] * along, out[2] - tangent[2] * along]);
            const around = cross(tangent, radial);
            // The band rolls about its own length: now flat against the tower, now on edge.
            const roll = TAU * 0.74 * s + k * 1.35;
            const cr = Math.cos(roll);
            const sr = Math.sin(roll);
            const wide = [
                around[0] * cr + radial[0] * sr, around[1] * cr + radial[1] * sr, around[2] * cr + radial[2] * sr,
            ];
            const thin = cross(tangent, wide);
            const hw = HELIX.halfWidth[k] * (0.82 + 0.18 * Math.sin(TAU * 1.37 * s + k * 2.3)) * ribbonTaper(s);
            const ht = Math.min(HELIX.halfThickness, hw * 0.4);
            if (last) run += Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]);
            last = c;
            for (let j = 0; j < ring; j++) {
                const a = (j / SECTION) * TAU;
                const ca = Math.cos(a);
                const sa = Math.sin(a);
                // A lens: a broad, gently crowned face and a tight rounded edge.
                const px = Math.sign(ca) * Math.abs(ca) ** 0.6 * hw;
                const py = sa * ht;
                // The crown is exaggerated in the normal so a highlight glides across the face.
                const nx = ca * 0.3;
                const ny = sa;
                const n = norm([
                    wide[0] * nx + thin[0] * ny, wide[1] * nx + thin[1] * ny, wide[2] * nx + thin[2] * ny,
                ]);
                position[v * 3] = hand * (c[0] + wide[0] * px + thin[0] * py);
                position[v * 3 + 1] = c[1] + wide[1] * px + thin[1] * py;
                position[v * 3 + 2] = c[2] + wide[2] * px + thin[2] * py;
                normal[v * 3] = hand * n[0];
                normal[v * 3 + 1] = n[1];
                normal[v * 3 + 2] = n[2];
                uvs[v * 2] = run;
                uvs[v * 2 + 1] = j / SECTION;
                braid[v] = k;
                v += 1;
            }
        }
        for (let i = 0; i < segments; i++) {
            for (let j = 0; j < SECTION; j++) {
                const a = base + i * ring + j;
                const b = a + ring;
                if (hand > 0) {
                    index.set([a, a + 1, b, a + 1, b + 1, b], t);
                } else {
                    index.set([a, b, a + 1, a + 1, b, b + 1], t);
                }
                t += 6;
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aBraid', new THREE.BufferAttribute(braid, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
}

/** The wire cage of one tower as a single mesh. */
export function buildWireGeometry(segments, wires, hand = 1) {
    const ring = WIRE_SIDES + 1;
    const perWire = (segments + 1) * ring;
    const count = perWire * wires;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const braid = new Float32Array(count);
    const index = new Uint32Array(segments * WIRE_SIDES * 6 * wires);
    const rand = mulberry32(0xc41a);
    let v = 0;
    let t = 0;
    const eps = 0.5 / segments;
    for (let w = 0; w < wires; w++) {
        const base = v;
        const gauge = 0.009 + rand() * 0.008;
        for (let i = 0; i <= segments; i++) {
            const s = i / segments;
            const c = wirePoint(s, w, wires, 1);
            const tangent = norm(sub(wirePoint(s + eps, w, wires, 1), wirePoint(s - eps, w, wires, 1)));
            const side = norm(cross(tangent, [0, 1, 0.001]));
            const up = cross(side, tangent);
            const r = gauge * ribbonTaper(s);
            for (let j = 0; j < ring; j++) {
                const a = (j / WIRE_SIDES) * TAU;
                const ca = Math.cos(a);
                const sa = Math.sin(a);
                const n = [side[0] * ca + up[0] * sa, side[1] * ca + up[1] * sa, side[2] * ca + up[2] * sa];
                position[v * 3] = hand * (c[0] + n[0] * r);
                position[v * 3 + 1] = c[1] + n[1] * r;
                position[v * 3 + 2] = c[2] + n[2] * r;
                normal[v * 3] = hand * n[0];
                normal[v * 3 + 1] = n[1];
                normal[v * 3 + 2] = n[2];
                uvs[v * 2] = s * HEIGHT * 1.6;
                uvs[v * 2 + 1] = j / WIRE_SIDES;
                braid[v] = w % 3;
                v += 1;
            }
        }
        for (let i = 0; i < segments; i++) {
            for (let j = 0; j < WIRE_SIDES; j++) {
                const a = base + i * ring + j;
                const b = a + ring;
                // side × up = tangent here, so the section runs the other way round from the ribbon's.
                if (hand > 0) {
                    index.set([a, b, a + 1, a + 1, b, b + 1], t);
                } else {
                    index.set([a, a + 1, b, a + 1, b + 1, b], t);
                }
                t += 6;
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('aBraid', new THREE.BufferAttribute(braid, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
}

/** The pulses running through one tower at local height `y`: a node, evaluated per vertex. */
function pulseBand(u, hand, y) {
    let band = float(0.0);
    for (let i = 0; i < PULSE_SLOTS; i++) {
        const A = u.pulseA[i];
        const age = u.time.sub(A.y);
        // Two fronts leave the struck height, one climbing, one sinking.
        const d = abs(y.sub(A.x)).sub(age.mul(PULSE_SPEED));
        const mine = step(-0.5, A.w.mul(hand));
        const env = exp(age.mul(-PULSE_FADE)).mul(step(0.0, age)).mul(A.z).mul(mine);
        // A hard leading edge with a soft wake behind it.
        const front = cgBell(d.div(PULSE_WIDTH)).add(cgBell(d.add(PULSE_WIDTH * 1.6).div(PULSE_WIDTH * 2.6)).mul(0.3));
        band = band.add(front.mul(env));
    }
    // Several pulses crossing do not add up to a white-out.
    return min(band, 1.5);
}

/**
 * The gold of one tower's ribbons or wires.
 * @param {object} u     shared hall uniforms
 * @param {number} hand  −1 left tower, +1 right
 * @param {{ wire?: boolean }} [opts]
 */
export function createGoldMaterial(u, hand, { wire = false } = {}) {
    const material = new THREE.MeshStandardNodeMaterial();
    material.name = `ChiralGold${wire ? 'Wire' : 'Ribbon'}${hand < 0 ? 'L' : 'R'}`;
    material.side = THREE.FrontSide;
    material.fog = false;
    material.metalness = 1;
    material.roughness = 0.2;

    const braid = attribute('aBraid', 'float');
    const { y } = positionGeometry;
    const flare = hand < 0 ? u.flare.x : u.flare.y;

    // Per vertex: the tessellation along the tower is a few centimetres.
    const band = varying(pulseBand(u, hand, y), 'cgBand');

    const pick = (a, b, c) => mix(mix(a, b, step(0.5, braid)), c, step(1.5, braid));
    // A level-up pours the next alloy up the tower: the old one is still above the pour line.
    const poured = float(1.0).sub(smoothstep(u.pour.sub(0.5), u.pour.add(0.5), y));
    const alloy = mix(pick(u.prevA, u.prevB, u.prevC), pick(u.alloyA, u.alloyB, u.alloyC), poured);
    material.colorNode = alloy;
    material.metalnessNode = float(1.0);

    const st = uv();
    // Brushed along its length, with slow clouds of a finer and a coarser hand.
    const brush = u.noise(vec2(st.x.mul(0.22), st.y.mul(wire ? 1.0 : 5.0))).r;
    const cloud = u.noise(st.mul(vec2(0.045, 0.31))).g;
    material.roughnessNode = wire
        ? float(0.16).add(brush.mul(0.1))
        : float(0.1).add(brush.mul(0.15)).add(cloud.mul(0.08));

    // ── What the gold gives off itself ──
    // The core lights the faces turned toward it; the chain's heat turns it up.
    const inward = normalize(vec3(positionGeometry.x, 0.0, positionGeometry.z)).negate();
    const facing = max(dot(normalLocal, inward), 0.0);
    const breath = sin(u.time.mul(0.9).add(y.mul(0.7))).mul(0.15).add(0.85);
    const hearth = u.glow.mul(facing.mul(facing)).mul(u.heat.mul(0.8).add(0.2)).mul(breath);
    // A pulse is light running in the brushing: a pale gold front that cools to the alloy's glow.
    const hot = mix(u.glow, vec3(1.0, 0.86, 0.6), smoothstep(0.25, 1.0, band));
    const pulse = hot.mul(band).mul(brush.mul(0.9).add(0.55)).mul(wire ? 3.4 : 2.2);
    // After a clear the whole tower holds a glow, strongest on its edges.
    const rim = pow(float(1.0).sub(abs(dot(normalView, positionViewDirection))), 2.0);
    const held = u.glow.mul(flare).mul(rim.mul(0.75).add(brush.mul(0.08)).add(0.02)).mul(wire ? 1.6 : 1.0);
    material.emissiveNode = hearth.add(pulse).add(held).mul(u.emit);

    // The ribbons swell as a pulse passes.
    const swell = band.mul(wire ? 0.035 : 0.07).add(flare.mul(0.02));
    material.positionNode = positionLocal.add(vec3(positionGeometry.x, 0.0, positionGeometry.z).mul(swell));
    return material;
}

/**
 * Beads of gold sliding along the wires: tiny mirrors that each hold the whole studio.
 * Instances carry (wire, start, speed, size); their place is a function of the clock.
 */
export function createBeads(u, hand, count, wires) {
    const sphere = new THREE.SphereGeometry(1, 14, 10);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(sphere.getIndex());
    geometry.setAttribute('position', sphere.getAttribute('position'));
    geometry.setAttribute('normal', sphere.getAttribute('normal'));
    geometry.setAttribute('uv', sphere.getAttribute('uv'));
    const data = new Float32Array(count * 4);
    const rand = mulberry32(hand < 0 ? 0xbead1 : 0xbead2);
    for (let i = 0; i < count; i++) {
        data.set([
            Math.floor(rand() * wires),
            rand(),
            (0.012 + rand() * 0.02) * (rand() < 0.5 ? 1 : -1),
            0.035 + rand() ** 2.2 * 0.075,
        ], i * 4);
    }
    geometry.setAttribute('aBead', new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = count;

    const bead = attribute('aBead', 'vec4');
    const s = fract(bead.y.add(bead.z.mul(u.time)));
    const theta = s.mul(-TAU * HELIX.wireTurns).add(bead.x.mul(TAU / wires + 0.4));
    const r = cos(s.mul(TAU * HELIX.wireSwell).add(bead.x.mul(2.4))).mul(0.17).add(0.83).mul(HELIX.wireRadius);
    const sway = HELIX.sway * HELIX.radius;
    const sx = sin(s.mul(TAU * 0.62).add(0.4)).mul(sway);
    const sz = sin(s.mul(TAU * 0.41).add(1.9)).mul(sway * 0.7);
    const centre = vec3(
        cos(theta).mul(r).add(sx).mul(hand),
        s.mul(HEIGHT).add(HELIX.bottom),
        sin(theta).mul(r).add(sz),
    );
    // A bead shrinks to nothing at either end of its wire, and swells when a pulse crosses it.
    const ends = smoothstep(0.0, 0.03, s).mul(float(1.0).sub(smoothstep(0.8, 0.86, s)));
    const band = varying(pulseBand(u, hand, centre.y), 'cgBeadBand');
    const size = bead.w.mul(ends).mul(band.mul(0.8).add(1.0));

    const material = new THREE.MeshStandardNodeMaterial();
    material.name = `ChiralGoldBeads${hand < 0 ? 'L' : 'R'}`;
    material.fog = false;
    material.metalness = 1;
    material.roughness = 0.07;
    material.colorNode = mix(u.alloyA, u.alloyC, step(0.5, fract(bead.x.mul(0.37))));
    material.metalnessNode = float(1.0);
    material.roughnessNode = float(0.07);
    const flare = hand < 0 ? u.flare.x : u.flare.y;
    material.emissiveNode = mix(u.glow, vec3(1.0, 0.93, 0.78), 0.5)
        .mul(band.mul(5.0).add(flare.mul(0.6)).add(u.heat.mul(0.3)))
        .mul(u.emit);
    material.positionNode = positionGeometry.mul(size).add(centre);
    const part = cgPart(material.name, geometry, material, 2, true);
    part.dispose = () => sphere.dispose();
    return part;
}

/**
 * The core: a filament down the tower's axis and the column of light around it. An ember at
 * rest; a chain of clears brings it to white heat.
 */
export function createCore(u, hand) {
    const steps = 72;
    const points = [];
    for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        const a = HELIX.sway * HELIX.radius;
        points.push(new THREE.Vector3(
            hand * Math.sin(s * TAU * 0.62 + 0.4) * a,
            helixHeight(s),
            Math.sin(s * TAU * 0.41 + 1.9) * a * 0.7,
        ));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    // The filament is wound like the one in a lamp: a fine coil about the axis.
    const coil = [];
    const coilSteps = 520;
    for (let i = 0; i <= coilSteps; i++) {
        const s = i / coilSteps;
        const a = HELIX.sway * HELIX.radius;
        const w = s * TAU * 26 * hand;
        coil.push(new THREE.Vector3(
            hand * Math.sin(s * TAU * 0.62 + 0.4) * a + Math.cos(w) * 0.085,
            helixHeight(s),
            Math.sin(s * TAU * 0.41 + 1.9) * a * 0.7 + Math.sin(w) * 0.085,
        ));
    }
    const coilCurve = new THREE.CatmullRomCurve3(coil);
    const flare = hand < 0 ? u.flare.x : u.flare.y;
    const { y } = positionGeometry;
    const fadeTop = float(1.0).sub(smoothstep(HELIX.top - 3.2, HELIX.top - 0.4, y));
    const flicker = u.noise(vec2(y.mul(0.05).sub(u.time.mul(0.11)), u.time.mul(0.07).add(hand * 0.31))).b;
    const power = u.heat.mul(u.heat.mul(2.2).add(2.2)).add(0.55).add(flare.mul(1.4))
        .mul(flicker.mul(0.7).add(0.65))
        .mul(u.audio.x.mul(0.5).add(1.0));

    const filamentGeometry = new THREE.TubeGeometry(coilCurve, coilSteps, 0.011, 4, false);
    const filament = new THREE.MeshBasicNodeMaterial();
    filament.name = `ChiralGoldFilament${hand < 0 ? 'L' : 'R'}`;
    filament.fog = false;
    filament.colorNode = mix(u.glow, vec3(1.0, 0.9, 0.7), smoothstep(0.2, 1.0, u.heat).mul(0.6))
        .mul(power).mul(1.5).mul(fadeTop)
        .mul(u.emit);

    // A fat tube shaded by how squarely the eye meets it: brightest down its middle, gone at its
    // edge. It reads as a column of lit air and costs one additive draw.
    const haloGeometry = new THREE.TubeGeometry(curve, steps, 0.5, 10, false);
    const halo = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    });
    halo.name = `ChiralGoldCoreGlow${hand < 0 ? 'L' : 'R'}`;
    halo.fog = false;
    const square = abs(dot(normalView, positionViewDirection));
    halo.colorNode = u.glow.mul(pow(square, 3.0)).mul(power).mul(0.032).mul(fadeTop)
        .mul(u.emit);

    const parts = [
        cgPart(filament.name, filamentGeometry, filament, 1, true),
        cgPart(halo.name, haloGeometry, halo, 20, true),
    ];
    return parts;
}

/**
 * One tower: a group holding ribbons, wires, beads and core. The world places, scales and turns it.
 * @param {object} u
 * @param {number} hand  −1 left, +1 right
 * @param {{ segments: number, wires: number, beads: number }} tier
 */
export function createTower(u, hand, tier) {
    const group = new THREE.Group();
    group.name = hand < 0 ? 'ChiralGoldTowerLeft' : 'ChiralGoldTowerRight';
    const parts = [
        cgPart(
            `ChiralGoldRibbons${hand < 0 ? 'L' : 'R'}`,
            buildRibbonGeometry(tier.segments, hand),
            createGoldMaterial(u, hand),
            0,
            true,
        ),
    ];
    if (tier.wires > 0) {
        parts.push(cgPart(
            `ChiralGoldWires${hand < 0 ? 'L' : 'R'}`,
            buildWireGeometry(Math.round(tier.segments * 1.25), tier.wires, hand),
            createGoldMaterial(u, hand, { wire: true }),
            0,
            true,
        ));
        if (tier.beads > 0) parts.push(createBeads(u, hand, tier.beads, tier.wires));
    }
    parts.push(...createCore(u, hand));
    parts.forEach((part) => group.add(part.mesh));
    return { group, parts, hand };
}
