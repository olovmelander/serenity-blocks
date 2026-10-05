/**
 * Chiral Gold — the great ring.
 *
 * Behind the towers a ring of gold stands half sunk in the water, arching over the board. It is
 * three open bands nested one inside the next (each a torc: an open ring with a bead on either
 * end), turning in their common plane in alternating senses, so at rest it reads as one ring
 * whose gaps drift.
 *
 * A chain of clears opens it: one band after another leaves the plane and the ring becomes an
 * armillary sphere turning about the board, faster with every step. A clear sends a pair of
 * comets over the arch from both feet, one each way, to cross at the crown. The four-line strike
 * sets the whole ring alight from the crown down.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    dot,
    exp,
    float,
    floor,
    mix,
    normalView,
    positionViewDirection,
    pow,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import {
    AURUM,
    COMET_SLOTS,
    STAGE,
    TAU,
    cgPart,
} from './chiral-gold-tsl.js';

/** The three bands, outermost first: radius, tube, arc (turns), and the sense each one turns in. */
export const BANDS = Object.freeze([
    Object.freeze({
        radius: STAGE.ring.radius, tube: 0.13, arc: 0.93, sense: 1,
    }),
    Object.freeze({
        radius: STAGE.ring.radius - 0.5, tube: 0.08, arc: 0.9, sense: -1,
    }),
    Object.freeze({
        radius: STAGE.ring.radius - 0.9, tube: 0.05, arc: 0.86, sense: 1,
    }),
]);

/** Angle (radians, from +X, counter-clockwise) a band's arc starts at when its spin is 0. */
const arcStart = (band) => -Math.PI / 2 + ((1 - band.arc) * TAU) / 2;

/** Wrap an angle into (−π, π]. */
const wrapPi = (x) => x.sub(floor(x.add(Math.PI).div(TAU)).mul(TAU));

function bandMaterial(u, band, index, spin) {
    const material = new THREE.MeshStandardNodeMaterial();
    material.name = `ChiralGoldBand${index}`;
    material.fog = false;
    material.metalness = 1;
    material.roughness = 0.16;
    const st = uv();
    const brush = u.noise(vec2(st.x.mul(band.radius * 1.4), st.y.mul(2.0))).r;
    material.colorNode = index === 1 ? u.alloyB : mix(u.alloyA, u.alloyC, index * 0.5);
    material.metalnessNode = float(1.0);
    material.roughnessNode = float(0.11).add(brush.mul(0.14));

    // The angle of this fragment round the ring as the hall sees it.
    const phi = st.x.mul(band.arc * TAU).add(arcStart(band)).add(spin);
    let comets = float(0.0);
    for (let i = 0; i < COMET_SLOTS; i++) {
        const A = u.cometA[i];
        // Each band takes the comet a breath after the one outside it.
        const age = u.time.sub(A.x).sub(index * 0.05);
        const head = A.w.add(A.y.mul(age));
        const d = wrapPi(phi.sub(head)).mul(A.y.sign());
        const lead = exp(d.mul(d).mul(-900.0));
        const tail = exp(d.mul(5.5)).mul(step(d, 0.0));
        const env = exp(age.mul(-0.85)).mul(step(0.0, age)).mul(A.z);
        comets = comets.add(lead.mul(2.2).add(tail).mul(env));
    }
    // The four-line strike lights the ring from the crown down both sides.
    const aAge = u.time.sub(u.aurum.x).sub(AURUM.hush);
    const fromCrown = abs(wrapPi(phi.sub(Math.PI / 2)));
    const lit = smoothstep(0.0, 0.5, aAge.mul(7.0).sub(fromCrown)).mul(step(0.0, aAge));
    const blaze = lit.mul(exp(aAge.mul(-0.5))).mul(u.aurum.y);
    const rim = pow(float(1.0).sub(abs(dot(normalView, positionViewDirection))), 2.0);
    const hot = mix(u.glow, vec3(1.0, 0.93, 0.78), 0.55);
    material.emissiveNode = hot.mul(comets.mul(brush.mul(0.6).add(0.7)).mul(3.2))
        .add(u.glow.mul(u.heat).mul(rim.mul(1.3).add(0.12)))
        .add(hot.mul(blaze).mul(brush.mul(0.8).add(0.6)).mul(1.2))
        .add(u.glow.mul(u.audio.w).mul(rim).mul(0.3))
        .mul(u.emit);
    return material;
}

/**
 * @param {object} u
 * @param {{ ringSegments: number }} tier
 * @returns {{ group: THREE.Group, bands: object[], parts: object[] }}
 */
export function createRing(u, tier) {
    const group = new THREE.Group();
    group.name = 'ChiralGoldRing';
    group.position.set(0, STAGE.ring.y, STAGE.ring.z);
    const parts = [];
    const beadGeometry = new THREE.SphereGeometry(1, 14, 10);
    const beadMaterial = new THREE.MeshStandardNodeMaterial();
    beadMaterial.name = 'ChiralGoldTorcEnds';
    beadMaterial.fog = false;
    beadMaterial.metalness = 1;
    beadMaterial.roughness = 0.08;
    beadMaterial.colorNode = u.alloyA;
    beadMaterial.metalnessNode = float(1.0);
    beadMaterial.roughnessNode = float(0.08);
    beadMaterial.emissiveNode = u.glow.mul(u.heat.mul(0.8)).mul(u.emit);

    const bands = BANDS.map((band, index) => {
        const spin = uniform(0);
        const pivot = new THREE.Group();
        pivot.name = `ChiralGoldBandPivot${index}`;
        const geometry = new THREE.TorusGeometry(band.radius, band.tube, 10, tier.ringSegments, band.arc * TAU);
        geometry.rotateZ(arcStart(band));
        const part = cgPart(`ChiralGoldBand${index}`, geometry, bandMaterial(u, band, index, spin), 0, true);
        pivot.add(part.mesh);
        // A torc's two ends.
        for (let end = 0; end < 2; end++) {
            const a = arcStart(band) + end * band.arc * TAU;
            const bead = new THREE.Mesh(beadGeometry, beadMaterial);
            bead.name = `ChiralGoldTorcEnd${index}${end}`;
            bead.position.set(Math.cos(a) * band.radius, Math.sin(a) * band.radius, 0);
            bead.scale.setScalar(band.tube * 1.7);
            bead.frustumCulled = false;
            part.mesh.add(bead);
        }
        group.add(pivot);
        parts.push(part);
        return {
            ...band, index, pivot, mesh: part.mesh, spin, angle: 0, tiltX: 0, tiltY: 0,
        };
    });
    parts.push({
        mesh: null, material: beadMaterial, geometry: beadGeometry, reflected: true,
    });
    return { group, bands, parts };
}

/**
 * Place the bands for this frame. `spinAngle` is the ring's accumulated turn (radians);
 * `open[i]` is 0..1, how far band i has left the common plane; `time` drives the tumble.
 */
export function poseRing(ring, spinAngle, open, time) {
    for (let i = 0; i < ring.bands.length; i++) {
        const band = ring.bands[i];
        const o = open[i] || 0;
        band.angle = spinAngle * band.sense * (1 + i * 0.35) + i * 1.9;
        band.mesh.rotation.z = band.angle;
        band.spin.value = band.angle;
        // Out of the plane each band tumbles on its own axis: an armillary sphere.
        const rate = 0.16 + i * 0.07;
        band.tiltX = o * (0.3 + 0.14 * Math.sin(time * rate + i * 2.1)) * (i % 2 ? -1 : 1);
        band.tiltY = o * (0.26 * Math.sin(time * rate * 1.37 + i * 1.3) + (i === 1 ? 0.3 : -0.22));
        band.pivot.rotation.set(band.tiltX, band.tiltY, 0);
    }
}
