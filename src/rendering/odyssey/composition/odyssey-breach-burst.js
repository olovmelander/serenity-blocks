/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE BREACH (Odyssey masterpiece pass, 2026-11-17) — bursting through the surface of the sea.
 *
 * The audit: "The breach: stills show water, then the island. It needs to be a MOMENT." The trip
 * now lingers at the waterline (transitions/odyssey-travel-measure.js); this is what happens
 * there, fired by the EYE crossing sea level (the renderer's own rule for its spray: the eye's
 * height, not a progress constant) and played on the clock, so it finishes whatever the camera
 * does next:
 *
 *   THE CROWN   a ring of water thrown up round the place the eye came out: a few hundred drops
 *               on their own arcs (out and up, then gravity), each drawn out along its flight.
 *               It stands in the WORLD where the breach happened, so the climb leaves it behind
 *               and it falls back into the sea below the frame.
 *   THE SHEET   the water the lens brought up with it, running off: a streaked film over the
 *               whole view at the instant of the crossing, gone in half a second, and then what
 *               clings to the glass: beads running down it, each at its own pace with a thin
 *               wet tail behind it.
 *   THE LIGHT   the daylight flooding in: a soft veil of light that is strongest at the crossing
 *               and gone in half a second (through `flashScale`, ADR-0021).
 *
 * Going DOWN through the surface (the trip back to orb 10) the same drops are air: a curtain of
 * bubbles dragged under with the eye, rising past it.
 *
 * One instanced draw for the drops and one quad for the sheet, both only submitted while a burst
 * is live (a few seconds per crossing). Reduced motion plays the light alone.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, exp, float, floor, fract,
    hash, length, max, mix, positionLocal, sin, smoothstep, step as tslStep, texture, uniform, uv, varying, vec2, vec3,
} from 'three/tsl';
import { flashScale } from '../../../utils/photosensitivity.js';
import { prefersReducedMotion } from '../../../themes/shared/reduced-motion.js';

export const BREACH_BURST = Object.freeze({
    /** A step of the eye's height larger than this in one update is a teleport, not a crossing. */
    maxStep: 40,
    crown: Object.freeze({
        count: 280,
        lowCount: 140,
        /** Seconds a drop lives (each its own). */
        life: Object.freeze([0.9, 2.2]),
        /** The ring it is born on round the eye (u), and how fast it flies out and up (u/s). */
        ring: Object.freeze([2.0, 9.5]),
        out: Object.freeze([1.0, 6.0]),
        up: Object.freeze([7.0, 17.0]),
        /** The crown is thrown this far ahead of the eye along its way (u): it bursts in the view. */
        ahead: 7.5,
        gravity: 15,
        /** A drop's breadth (u) and how far its speed draws it out (u per u/s). */
        size: Object.freeze([0.05, 0.17]),
        stretch: 0.08,
        /** How long the latest drops wait (s): the crown rises as a wave, not all at once. */
        stagger: 0.16,
    }),
    bubbles: Object.freeze({
        life: Object.freeze([1.4, 2.6]),
        ring: Object.freeze([0.9, 4.2]),
        depth: Object.freeze([0.6, 9.0]),
        rise: Object.freeze([1.6, 5.0]),
        size: Object.freeze([0.05, 0.16]),
    }),
    sheet: Object.freeze({
        /** Seconds the water takes to run off the lens. */
        life: 1.7,
        /** How fast a bead runs down (frame heights per second): the slowest and the fastest. */
        drain: Object.freeze([0.85, 1.9]),
        /** The film at the crossing, the streaks in it, and how fast both clear (1/s). */
        film: 0.06,
        streaks: 0.18,
        filmDecay: 2.6,
        /** The columns the lens is cut into, the tails' and the beads' strength. */
        columns: 19,
        rivulets: 0.20,
        beads: 0.40,
    }),
    light: Object.freeze({ gain: 0.24, decay: 4.0 }),
});

/**
 * Which way the eye crossed the surface between two updates: 1 up, -1 down, 0 not at all (or a
 * step too large to be a crossing).
 */
export function surfaceCrossing(prevY, y, seaLevel, maxStep = BREACH_BURST.maxStep) {
    if (!Number.isFinite(prevY) || !Number.isFinite(y) || Math.abs(y - prevY) >= maxStep) return 0;
    if (prevY < seaLevel && y >= seaLevel) return 1;
    if (prevY >= seaLevel && y < seaLevel) return -1;
    return 0;
}

/** How long a burst of `kind` (1 up, -1 down) is drawn for (s). */
export function breachBurstLife(kind, spec = BREACH_BURST) {
    return kind > 0
        ? Math.max(spec.crown.life[1] + spec.crown.stagger, spec.sheet.life)
        : spec.bubbles.life[1] + 0.2;
}

/** The light's strength `age` seconds after the crossing (before the photosensitivity scale). */
export function breachLight(age, spec = BREACH_BURST) {
    if (!Number.isFinite(age) || age < 0) return 0;
    return spec.light.gain * Math.exp(-age * spec.light.decay);
}

/**
 * A drop's place relative to the breach point, `t` seconds after the crossing: the CPU twin of
 * the vertex stage (seeds 0..1). Returns null before it is born.
 */
export function crownDropAt(seedA, seedB, seedC, seedD, t, spec = BREACH_BURST.crown, out = { x: 0, y: 0, z: 0 }) {
    const tt = t - (seedD * spec.stagger);
    if (tt < 0) return null;
    const ang = seedA * Math.PI * 2;
    const r = spec.ring[0] + ((spec.ring[1] - spec.ring[0]) * seedB)
        + ((spec.out[0] + ((spec.out[1] - spec.out[0]) * ((seedC * 7.1) % 1))) * tt);
    const vy = spec.up[0] + ((spec.up[1] - spec.up[0]) * seedC);
    out.x = Math.cos(ang) * r;
    out.y = (vy * tt) - (0.5 * spec.gravity * tt * tt);
    out.z = Math.sin(ang) * r;
    return out;
}

/**
 * @param {object} o
 * @param {number} o.seaLevel
 * @param {*} o.noiseTex the world's tiling detail texture (b = value noise)
 * @param {(colour: *) => *} o.gradeLight the world's grade for light
 * @param {string} [o.quality] 'high' | 'low'
 */
export function createOdysseyBreachBurst({
    seaLevel, noiseTex, gradeLight, quality = 'high',
}) {
    const B = BREACH_BURST;
    const group = new THREE.Group();
    group.name = 'odyssey-breach-burst';
    group.visible = false;
    const uAge = uniform(0);
    const uOrigin = uniform(new THREE.Vector3(0, seaLevel, 0));
    /** 0 = the crown (up through the surface), 1 = bubbles (down through it). */
    const uKind = uniform(0);
    const uLight = uniform(0);
    const uSheet = uniform(0);

    // ── the drops ──
    const count = quality === 'low' ? B.crown.lowCount : B.crown.count;
    const dropGeo = new THREE.InstancedBufferGeometry();
    {
        const quadGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
        dropGeo.setIndex(quadGeo.index);
        dropGeo.setAttribute('position', quadGeo.attributes.position);
        dropGeo.setAttribute('uv', quadGeo.attributes.uv);
        const seeds = new Float32Array(count * 4);
        const rand01 = (n) => {
            let h = Math.imul(n ^ 0x51ed270b, 2654435761);
            h = Math.imul(h ^ (h >>> 13), 1274126177);
            return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
        };
        for (let i = 0; i < count * 4; i += 1) seeds[i] = rand01(i + 11);
        dropGeo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(seeds, 4));
        dropGeo.instanceCount = count;
        quadGeo.dispose();
    }
    const dropMat = new THREE.MeshBasicNodeMaterial();
    {
        const C = B.crown;
        const A = B.bubbles;
        const sd = attribute('aDrop', 'vec4');
        const ang = sd.x.mul(Math.PI * 2);
        const flat = vec2(cos(ang), sin(ang));
        // The crown: out and up, then gravity (crownDropAt is the CPU twin).
        const tt = max(uAge.sub(sd.w.mul(C.stagger)), float(0));
        const vOut = mix(float(C.out[0]), float(C.out[1]), fract(sd.z.mul(7.1)));
        const vUp = mix(float(C.up[0]), float(C.up[1]), sd.z);
        const rCrown = mix(float(C.ring[0]), float(C.ring[1]), sd.y).add(vOut.mul(tt));
        const yCrown = vUp.mul(tt).sub(tt.mul(tt).mul(0.5 * C.gravity));
        const velCrown = vec3(flat.x.mul(vOut), vUp.sub(tt.mul(C.gravity)), flat.y.mul(vOut));
        // The bubbles: born under the surface round the eye, rising, wobbling.
        const rise = mix(float(A.rise[0]), float(A.rise[1]), sd.y);
        const wob = sin(uAge.mul(5.0).add(sd.z.mul(40))).mul(0.18);
        const rBub = mix(float(A.ring[0]), float(A.ring[1]), fract(sd.z.mul(3.3))).add(wob);
        const yBub = mix(float(A.depth[0]), float(A.depth[1]), sd.w).negate().add(rise.mul(uAge));
        const centre = uOrigin.add(vec3(
            flat.x.mul(mix(rCrown, rBub, uKind)),
            mix(yCrown, yBub, uKind),
            flat.y.mul(mix(rCrown, rBub, uKind)),
        ));
        const vel = mix(velCrown, vec3(0, 1, 0), uKind);
        const speed = length(vel);
        const along = vel.div(max(speed, float(1e-3)));
        const toEye = cameraPosition.sub(centre);
        const side0 = cross(along, toEye);
        const side = side0.div(max(length(side0), float(1e-3)));
        const size = mix(
            mix(float(C.size[0]), float(C.size[1]), sd.y.mul(sd.y)),
            mix(float(A.size[0]), float(A.size[1]), sd.y.mul(sd.y)),
            uKind,
        );
        // Drawn out along its flight (a bubble stays round).
        const longer = size.mul(float(1).add(speed.mul(C.stretch / C.size[1]).mul(float(1).sub(uKind))));
        dropMat.positionNode = centre
            .add(side.mul(positionLocal.x.mul(size)))
            .add(along.mul(positionLocal.y.mul(longer)));
        const lifeS = mix(
            mix(float(C.life[0]), float(C.life[1]), fract(sd.x.mul(5.7))),
            mix(float(A.life[0]), float(A.life[1]), fract(sd.x.mul(5.7))),
            uKind,
        );
        const ageT = clamp(mix(tt, uAge, uKind).div(lifeS), 0, 1);
        const rel = centre.y.sub(uOrigin.y);
        // A drop is gone when it falls back into the sea; a bubble when it reaches the surface.
        const inPlay = mix(
            smoothstep(float(-0.5), float(0.05), rel),
            float(1).sub(smoothstep(float(-0.6), float(-0.05), rel)),
            uKind,
        );
        const born = mix(smoothstep(float(0.0), float(0.03), uAge.sub(sd.w.mul(C.stagger))), float(1), uKind);
        const vFade = varying(
            float(1).sub(smoothstep(float(0.55), float(1.0), ageT)).mul(inPlay).mul(born),
            'vBreachDropFade',
        );
        const dUv = uv();
        const dR = length(dUv.sub(vec2(0.5)).mul(2));
        const dot2 = float(1).sub(smoothstep(float(0.25), float(1.0), dR));
        const ringP = smoothstep(float(0.45), float(0.72), dR).mul(float(1).sub(smoothstep(float(0.72), float(1.0), dR)))
            .add(dot2.mul(0.22));
        dropMat.colorNode = gradeLight(mix(vec3(0.94, 0.98, 1.0).mul(1.15), vec3(0.72, 0.95, 1.0), uKind));
        dropMat.opacityNode = mix(dot2.mul(0.9), ringP.mul(0.8), uKind).mul(vFade);
        dropMat.alphaTest = 0.01;
        dropMat.transparent = true;
        dropMat.depthWrite = false;
        dropMat.side = THREE.DoubleSide;
        dropMat.fog = false;
    }
    const dropMesh = new THREE.Mesh(dropGeo, dropMat);
    dropMesh.name = 'odyssey-breach-drops';
    dropMesh.frustumCulled = false;
    dropMesh.renderOrder = 14;
    group.add(dropMesh);

    // ── the sheet on the lens, and the light ──
    const sheetMat = new THREE.MeshBasicNodeMaterial();
    {
        const S = B.sheet;
        // The camera's own basis from the view matrix (rows of its rotation), as the spray does.
        const camR = vec3(cameraViewMatrix.element(0).x, cameraViewMatrix.element(1).x, cameraViewMatrix.element(2).x);
        const camU = vec3(cameraViewMatrix.element(0).y, cameraViewMatrix.element(1).y, cameraViewMatrix.element(2).y);
        const camF = vec3(cameraViewMatrix.element(0).z, cameraViewMatrix.element(1).z, cameraViewMatrix.element(2).z)
            .negate();
        const ahead = 0.42;
        const halfW = float(ahead * 1.04).div(cameraProjectionMatrix.element(0).x);
        const halfH = float(ahead * 1.04).div(cameraProjectionMatrix.element(1).y);
        sheetMat.positionNode = cameraPosition
            .add(camF.mul(ahead))
            .add(camR.mul(positionLocal.x.mul(2).mul(halfW)))
            .add(camU.mul(positionLocal.y.mul(2).mul(halfH)));
        const sUv = uv();
        const x = clamp(sUv.x, 0, 1);
        const y = clamp(sUv.y, 0, 1);
        // The film over the whole lens at the crossing, with the streaks running down in it: gone
        // in half a second (the eye is out; what is left is what clings to the glass).
        const run = texture(noiseTex, vec2(x.mul(0.43), y.mul(0.022).add(uAge.mul(0.06)))).b;
        const streak = smoothstep(float(0.55), float(0.80), run);
        const film = float(S.film).add(streak.mul(S.streaks)).mul(exp(uAge.mul(-S.filmDecay)));
        // What clings: rivulets. The lens is cut into columns, each with one bead of water that
        // runs down at its own pace, meandering a little, a thin tail of wet glass behind it.
        const cell = floor(x.mul(S.columns));
        const r1 = hash(cell.add(17.0));
        const r2 = hash(cell.add(71.0));
        const r3 = hash(cell.add(113.0));
        const head = float(1.12).add(r3.mul(0.25)).sub(uAge.mul(mix(float(S.drain[0]), float(S.drain[1]), r2)));
        const cx = cell.add(r1.mul(0.56).add(0.22)).div(S.columns)
            .add(sin(y.mul(21).add(r1.mul(40))).mul(0.0035));
        const wide = r2.mul(0.0018).add(0.0014);
        const dx = x.sub(cx).abs();
        const line = float(1).sub(smoothstep(wide.mul(0.45), wide, dx));
        const above = max(y.sub(head), float(0));
        const tail = line.mul(smoothstep(float(0.0), float(0.008), y.sub(head))).mul(exp(above.mul(-7.5)));
        const beadX = dx.div(wide.mul(1.9));
        const beadY = y.sub(head).div(0.009);
        const bead = exp(beadX.mul(beadX).add(beadY.mul(beadY)).negate());
        const fade = float(1).sub(smoothstep(float(S.life - 0.7), float(S.life), uAge));
        const water = film
            .add(tail.mul(S.rivulets).add(bead.mul(S.beads)).mul(fade).mul(tslStep(0.38, r3.add(r1).mul(0.5))))
            .mul(uSheet);
        // The light floods in: strongest at the crossing, a little more toward the top of the frame.
        const light = uLight.mul(y.mul(0.5).add(0.75));
        sheetMat.colorNode = gradeLight(mix(vec3(0.80, 0.94, 1.0), vec3(1.0, 0.98, 0.93), clamp(light.mul(2), 0, 1)).mul(1.1));
        sheetMat.opacityNode = clamp(water.add(light), 0, 0.92);
        sheetMat.transparent = true;
        sheetMat.depthWrite = false;
        sheetMat.depthTest = false;
        sheetMat.side = THREE.DoubleSide;
        sheetMat.fog = false;
    }
    const sheetMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), sheetMat);
    sheetMesh.name = 'odyssey-breach-sheet';
    sheetMesh.frustumCulled = false;
    sheetMesh.renderOrder = 60;
    group.add(sheetMesh);

    let prevY = null;
    let prevX = 0;
    let prevZ = 0;
    let start = null;
    let kind = 0;
    const state = { kind: 0, age: null };

    return {
        group,
        state,
        meshes: [dropMesh, sheetMesh],
        /**
         * @param {number} time the world's clock (s)
         * @param {{ x: number, y: number, z: number }|null} eye the eye's world position
         */
        update(time, eye) {
            const y = eye?.y;
            if (Number.isFinite(y)) {
                const crossed = prevY === null ? 0 : surfaceCrossing(prevY, y, seaLevel);
                if (crossed !== 0) {
                    kind = crossed;
                    start = time;
                    // The crown is thrown ahead along the eye's own way; the bubbles round it.
                    const dx = eye.x - prevX;
                    const dz = eye.z - prevZ;
                    const run = Math.hypot(dx, dz);
                    const lead = crossed > 0 && run > 1e-4 ? B.crown.ahead / run : 0;
                    uOrigin.value.set(eye.x + (dx * lead), seaLevel, eye.z + (dz * lead));
                }
                // Back under while the crown is up: the burst is over (the eye is in the water again).
                if (kind > 0 && start !== null && y < seaLevel - 0.6) start = null;
                if (kind < 0 && start !== null && y > seaLevel + 0.6) start = null;
                prevY = y;
                prevX = eye.x;
                prevZ = eye.z;
            }
            const age = start === null ? Infinity : time - start;
            const live = start !== null && age >= 0 && age < breachBurstLife(kind);
            if (!live) {
                if (start !== null && age >= breachBurstLife(kind)) start = null;
                group.visible = false;
                state.kind = 0;
                state.age = null;
                return;
            }
            const still = prefersReducedMotion();
            uAge.value = age;
            uKind.value = kind > 0 ? 0 : 1;
            uSheet.value = kind > 0 && !still ? 1 : 0;
            uLight.value = kind > 0 ? breachLight(age) * flashScale() : 0;
            dropMesh.visible = !still && dropMesh.userData.filterVisible !== false;
            sheetMesh.visible = kind > 0 && sheetMesh.userData.filterVisible !== false;
            group.visible = true;
            state.kind = kind;
            state.age = age;
        },
        dispose() {
            dropMat.dispose();
            sheetMat.dispose();
        },
    };
}
