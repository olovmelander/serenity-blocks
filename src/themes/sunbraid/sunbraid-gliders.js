/**
 * Sunbraid — the gliders: great sky rays riding the warm air over the valley (flight in
 * sunbraid-glide.js). A ray is a body with some depth between two thin crescent wings. Seen
 * against a sun its wings glow in that sun's colour with their veins dark across the light; from
 * below it takes the glare off the white floor; it beats its wings in a wave that runs out to the
 * tips and back along them, and its whip of a tail trails the stroke. Each throws three shadows
 * that sweep the white floor (the world writes their discs into the shadow rows every frame,
 * sunbraid-tsl.js sunVisibility).
 *
 * One instanced mesh. Per instance (an interleaved dynamic buffer): where it is and its span, how
 * it is turned (a quaternion: heading, bank, pitch), and its stroke (phase, how hard it beats, the
 * size of a pixel at its range, its ripple). The vertex stage bends the ray in its own frame and
 * hands the bent normal on; the instance matrices stay identity.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, clamp, cos, cross, dot, float, fract, fwidth, max, min, mix, normalGeometry,
    normalize, positionGeometry, positionWorld, pow, select, sign, sin, smoothstep, varying, vec3, vec4,
} from 'three/tsl';
import { MAX_GLIDERS, gliderAt } from './sunbraid-glide.js';
import { groundHeight } from './sunbraid-plan.js';
import { centroidVarying } from '../shared/centroid-varying.js';
import { TAU, haze, mist } from './sunbraid-tsl.js';

/**
 * The ray at unit span, nose toward −z: the nose and the body's rear on the axis (z), how far back
 * the wingtips sweep, the body's half-width and depth (both of the span), the wings' thickness at
 * the root, and the tail's length and width at its root.
 */
export const RAY = Object.freeze({
    nose: -0.25,
    rear: 0.22,
    tip: 0.14,
    body: 0.2,
    depth: 0.07,
    membrane: 0.006,
    tail: 0.62,
    tailWidth: 0.012,
});

/**
 * The stroke as drawn (unit span): how far the tips rise and fall at a full beat, the lag of the
 * wave out along the wing and back along the chord (radians across each), the glide's gull bend
 * (the shoulders rise about two thirds of `gull`, the tips droop back to a fifth of it: a ray
 * seen nearly edge-on still reads as wings), the ripple's height and its waves along the chord and
 * out along the wing, how far the body heaves against the wings, and the tail's swing.
 */
export const RAY_STROKE = Object.freeze({
    lift: 0.15,
    lagOut: 2.2,
    lagBack: 1.1,
    gull: 0.08,
    ripple: 0.01,
    rippleBack: 5,
    rippleOut: 2.5,
    heave: 0.02,
    tailSwing: 0.05,
});

/**
 * How a ray takes the light: the belly's and the back's colour; the light let through the wings;
 * how tight the glow is round a sun's disc seen through them (the three suns braid a few degrees
 * apart: a wider lobe summed them to white), how strong it is there, and how much of the light off
 * the floor and sky it drowns (against a sun a ray is a silhouette with glowing wings); how wide
 * the silver lining's lobe is; vein lines across the wing (and their width in vein spacings); the
 * wings' opacity at the tips.
 */
export const RAY_LOOK = Object.freeze({
    belly: Object.freeze([0.93, 0.9, 0.86]),
    back: Object.freeze([0.72, 0.71, 0.8]),
    through: Object.freeze([1.0, 0.9, 0.82]),
    glow: 300,
    backlit: 1.4,
    contre: 0.8,
    lining: 24,
    veins: 9,
    veinWidth: 0.07,
    tipOpacity: 0.8,
});

/** The leading and trailing edges' z at `s` (−1..1 across the span): a crescent. */
export function rayEdges(s) {
    const a = Math.abs(s);
    // Two small lobes either side of the mouth.
    const lobes = 0.035 * Math.exp(-(((a - 0.085) / 0.03) ** 2));
    const lead = RAY.nose + (RAY.tip - RAY.nose) * a * a - lobes;
    const trail = RAY.rear - 0.3 * a ** 0.9 + (RAY.tip - RAY.rear + 0.3) * a ** 3;
    return [lead, trail];
}

/** The ray's depth at (s, c) (c 0..1 from the leading edge back): the body, and the thin wings. */
function depthAt(s, c) {
    const a = Math.abs(s);
    const chordwise = Math.sin(Math.PI * c);
    const body = RAY.depth * Math.max(0, 1 - (a / RAY.body) ** 2) ** 0.7 * chordwise ** 0.6;
    const wing = RAY.membrane * (1 - a) * chordwise ** 0.5;
    return body + wing;
}

/**
 * A ray at unit span (nose toward −z): the back and the belly over one planform (they meet at its
 * outline), and the tail, a tapering ribbon back from the body. aShape = (s across −1..1, c along
 * 0..1, side +1 back / −1 belly / 0 tail, part 0 ray / 1 tail); aEdge = (distance in to the
 * outline, the chord there), both of the span.
 */
export function buildGliderGeometry(across = 40, along = 14) {
    const pos = [];
    const shape = [];
    const edge = [];
    const index = [];
    const cols = across + 1;
    for (const side of [1, -1]) {
        const base = pos.length / 3;
        for (let j = 0; j <= along; j++) {
            // Rows crowd toward the leading and trailing edges, where the depth turns.
            const c = 0.5 - 0.5 * Math.cos((Math.PI * j) / along);
            for (let i = 0; i <= across; i++) {
                const s = (i / across) * 2 - 1;
                const [lead, trail] = rayEdges(s);
                const chord = trail - lead;
                const depth = depthAt(s, c);
                // The back bulges more than the belly; the wings arch a little.
                const arch = 0.012 * Math.sin(Math.PI * c) * (1 - Math.abs(s));
                const y = arch + (side > 0 ? 0.6 : -0.4) * depth;
                pos.push(s * 0.5, y, lead + c * chord);
                shape.push(s, c, side, 0);
                edge.push(Math.min(c, 1 - c) * chord, chord);
            }
        }
        for (let j = 0; j < along; j++) {
            for (let i = 0; i < across; i++) {
                const a = base + j * cols + i;
                // Both faces wound outward (back up, belly down).
                if (side > 0) index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
                else index.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
            }
        }
    }
    // The tail: a tapering ribbon back from the body's rear.
    const base = pos.length / 3;
    const tailRows = 14;
    for (let j = 0; j <= tailRows; j++) {
        const v = j / tailRows;
        const w = RAY.tailWidth * (1 - v) ** 1.2 + 0.0015;
        const z = RAY.rear - 0.02 + v * RAY.tail;
        pos.push(-w, 0, z, w, 0, z);
        shape.push(-1, v, 0, 1, 1, v, 0, 1);
        edge.push(w, w, w, w);
    }
    for (let j = 0; j < tailRows; j++) {
        const a = base + j * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('aShape', new THREE.Float32BufferAttribute(shape, 4));
    geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    // The tail is a flat ribbon, and a vertex touched only by zero-area triangles (the wingtips)
    // has no normal: give each its face's.
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) {
        const side = shape[i * 4 + 2];
        if (side === 0 || Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) < 1e-6) {
            normals.setXYZ(i, 0, side < 0 ? -1 : 1, 0);
        }
    }
    return geometry;
}

/** v rotated by the unit quaternion q. */
const turn = (q, v) => {
    const t = cross(q.xyz, v).mul(2.0);
    return v.add(t.mul(q.w)).add(cross(q.xyz, t));
};

export function createGliders(u, t, count) {
    const n = Math.max(0, Math.min(MAX_GLIDERS, count));
    const geometry = buildGliderGeometry();
    // Per instance: (x, y, z, span), the turn (a quaternion), (beat 0..1, flap 0..1, a pixel at its
    // range in spans, ripple radians) — one dynamic buffer.
    const rows = new Float32Array(Math.max(1, n) * 12);
    const rowBuffer = new THREE.InstancedInterleavedBuffer(rows, 12, 1);
    rowBuffer.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aRayAt', new THREE.InterleavedBufferAttribute(rowBuffer, 4, 0));
    geometry.setAttribute('aRayTurn', new THREE.InterleavedBufferAttribute(rowBuffer, 4, 4));
    geometry.setAttribute('aRayBeat', new THREE.InterleavedBufferAttribute(rowBuffer, 4, 8));

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, transparent: true });
    const at = attribute('aRayAt', 'vec4');
    const spin = attribute('aRayTurn', 'vec4');
    const beat = attribute('aRayBeat', 'vec4');
    const shape = attribute('aShape', 'vec4');
    const outline = attribute('aEdge', 'vec2');
    const S = RAY_STROKE;

    // ── The stroke, in the ray's own frame (unit span) ──
    const s = shape.x;
    const c = shape.y;
    const side = shape.z;
    const isTail = shape.w;
    const a = abs(s);
    const phase = beat.x.mul(TAU);
    const flap = beat.y;
    const pixel = beat.z;
    // The beat: a wave out to the tips and back along the chord, the tips moving most.
    const wave = phase.sub(a.mul(S.lagOut)).sub(c.mul(S.lagBack));
    const reach = a.mul(a.sqrt());
    const stroke = flap.mul(S.lift);
    // A glide: the wings bent like a gull's (shoulders up, tips eased down), a slow ripple running
    // back along them.
    const hold = float(S.gull).mul(float(1.0).sub(flap.mul(0.7)));
    const bend = a.mul(float(3.2).sub(a.mul(float(4.4).sub(a.mul(1.4)))));
    const bendSlope = float(3.2).sub(a.mul(float(8.8).sub(a.mul(4.2))));
    const ripplePhase = beat.w.sub(c.mul(S.rippleBack)).sub(a.mul(S.rippleOut));
    const ripple = float(S.ripple).mul(float(1.0).sub(flap)).mul(a).mul(a);
    const heave = flap.mul(S.heave).mul(sin(phase.add(0.4))).negate();
    const lift = stroke.mul(reach).mul(sin(wave)).add(hold.mul(bend)).add(ripple.mul(sin(ripplePhase)))
        .add(heave);
    // Its slopes across (per unit s) and along (per unit c), for the bent normal.
    const dA = stroke.mul(a.sqrt().mul(1.5).mul(sin(wave)).sub(reach.mul(cos(wave)).mul(S.lagOut)))
        .add(hold.mul(bendSlope))
        .add(ripple.mul(sin(ripplePhase).mul(2.0).div(max(a, 1e-3)).sub(cos(ripplePhase).mul(S.rippleOut))));
    const dS = dA.mul(sign(s));
    const dC = stroke.mul(reach).mul(cos(wave)).mul(-S.lagBack)
        .sub(ripple.mul(cos(ripplePhase)).mul(S.rippleBack));
    // The tail trails the stroke and sways; it is never drawn thinner than about a pixel (then it
    // fades by as much instead).
    const v = c;
    const tailWidth = abs(positionGeometry.x);
    const tailDrawn = max(tailWidth, pixel.mul(0.7));
    const tailLift = flap.mul(S.tailSwing).add(0.015).mul(v.mul(v.sqrt())).mul(sin(phase.sub(v.mul(4.0))))
        .add(heave);
    const tailSway = v.mul(v).mul(0.03).mul(sin(beat.w.mul(0.4).sub(v.mul(3.0))));
    const bent = select(
        isTail.greaterThan(0.5),
        vec3(sign(s).mul(tailDrawn).add(tailSway), tailLift, positionGeometry.z),
        positionGeometry.add(vec3(0.0, lift, 0.0)),
    );
    const slopes = vec3(dS.mul(2.0).negate(), 0.0, dC.div(max(outline.y, 0.03)).negate()).mul(side);
    const bentNormal = select(isTail.greaterThan(0.5), normalGeometry, normalize(normalGeometry.add(slopes)));
    material.positionNode = turn(spin, bent.mul(at.w)).add(at.xyz);
    // (Taken inside the triangle: the wingtips are slivers, and MSAA extrapolates past them.)
    const normalOut = centroidVarying(turn(spin, bentNormal), 'vRayNormal');
    // How much of a pixel the tail covers, and the outline's distance in pixels.
    const tailCover = varying(tailWidth.div(tailDrawn), 'vRayTailCover');
    const edgePx = varying(outline.x.div(max(pixel, 1e-5)), 'vRayEdgePx');

    // ── The light ──
    const L = RAY_LOOK;
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const V = normalize(P.sub(u.eye)).toVar();
        const Nw = normalize(normalOut).toVar();
        // The face turned to the eye.
        const N = select(dot(Nw, V).lessThan(0.0), Nw, Nw.negate()).toVar();
        // The wings are thin (the body is not) and thinnest toward their tips.
        const wing = smoothstep(RAY.body * 0.45, RAY.body * 1.1, a).mul(float(1.0).sub(isTail)).toVar();
        // Veins fanning back from the body: dark across the light, a little pale against it. Never
        // thinner than a pixel (they fade instead), gone on the body and at the tips.
        const veinAt = a.mul(L.veins).add(c.mul(1.6));
        const veinPx = fwidth(veinAt).max(1e-4);
        const veinFrom = abs(fract(veinAt.add(0.5)).sub(0.5));
        const veinHalf = max(float(L.veinWidth), veinPx);
        const vein = float(1.0).sub(smoothstep(veinHalf.sub(veinPx), veinHalf.add(veinPx), veinFrom))
            .mul(float(L.veinWidth).div(veinHalf))
            .mul(wing)
            .mul(smoothstep(0.98, 0.7, a))
            .toVar();
        // A pale belly; the back is dusk-coloured at the body, paling to the tips.
        const back = mix(vec3(...L.back), vec3(...L.belly), a.mul(a.sqrt()));
        const albedo = select(side.lessThan(0.0), vec3(...L.belly), back).mul(float(1.0).add(vein.mul(0.08)))
            .toVar();
        // A pearl sheen that shifts with the angle on the thin wings.
        const facing = abs(dot(N, V));
        const film = cos(vec3(0.0, 2.1, 4.2).add(facing.mul(TAU * 1.7)).add(a.mul(2.0))).mul(0.5).add(0.5);
        albedo.assign(mix(albedo, albedo.mul(film.mul(0.5).add(0.75)), wing.mul(float(1.0).sub(facing)).mul(0.5)));
        // The body lets a little through too; the wings much more.
        const through = vec3(...L.through).mul(float(1.0).sub(vein.mul(0.85))).mul(mix(float(0.12), 1.0, wing))
            .toVar();
        const edgeGlow = float(1.0).sub(smoothstep(0.0, 5.0, edgePx)).mul(wing);
        // How nearly the eye looks toward each sun past the ray.
        const towardOf = (Sun) => pow(max(dot(V, Sun), 0.0), L.glow).toVar();
        const toward0 = towardOf(u.sun0);
        const toward1 = towardOf(u.sun1);
        const toward2 = towardOf(u.sun2);
        const lightOf = (Sun, C, toward) => {
            const front = max(dot(N, Sun), 0.0);
            // A sun on the far side of a wing shines through it; its disc seen through the wing
            // blazes in its own colour; near any sun the thin edges catch a silver lining.
            const behind = max(dot(N, Sun).negate(), 0.0);
            const near = pow(max(dot(V, Sun), 0.0), L.lining);
            const glow = behind.mul(0.25).add(toward.mul(L.backlit)).add(near.mul(edgeGlow).mul(0.8));
            return C.mul(albedo.mul(front.mul(0.6)).add(through.mul(glow)));
        };
        const sunlit = lightOf(u.sun0, u.col0, toward0).add(lightOf(u.sun1, u.col1, toward1))
            .add(lightOf(u.sun2, u.col2, toward2));
        // From below, the glare off the white floor; from above, the sky. Against a sun the light
        // coming through is all the eye sees of a ray (it is a silhouette with glowing wings).
        const contre = float(1.0).sub(max(toward0, max(toward1, toward2)).mul(L.contre));
        const bounce = u.groundLit.mul(0.75).mul(max(N.y.negate(), 0.0));
        const sky = mix(u.horizon, u.zenith, 0.5).mul(N.y.mul(0.2).add(0.3));
        const colour = sunlit.add(albedo.mul(bounce.add(sky)).mul(contre));
        // The wings thin to a little see-through at their tips; edges and the tail fade by how
        // much of a pixel they cover.
        const opacity = mix(float(1.0), L.tipOpacity, wing.mul(smoothstep(0.35, 1.0, a)));
        const cover = select(isTail.greaterThan(0.5), tailCover.mul(0.9), clamp(edgePx, 0.0, 1.0).mul(opacity));
        const vis = vec3(1.0, 1.0, 1.0);
        return vec4(haze(u, mist(u, colour, P, vis), P), min(cover, 1.0));
    })();
    material.fog = false;
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, n));
    mesh.count = n;
    mesh.name = 'Sunbraid gliders';
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;

    const state = {
        x: 0, y: 0, z: 0, hx: 0, hz: -1, bank: 0, pitch: 0, beat: 0, flap: 0, ripple: 0, span: 20,
    };
    const qn = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    const qp = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(0, 0, -1);
    const X = new THREE.Vector3(1, 0, 0);
    return {
        mesh,
        material,
        geometry,
        count: n,
        /**
         * Fly every glider to clock `time` (or the world's glide clock, which runs ahead of it as
         * play heats: the valley quickens); write their shadow discs into the rows.
         */
        update(time, dt, world) {
            const shadowRows = world.u.gliderRows;
            const clock = Number.isFinite(world.glideTime) ? world.glideTime : time;
            const eye = world.u.eye.value;
            const fov = (world._camera?.fov ?? 45) * (Math.PI / 180);
            const perMetre = (2 * Math.tan(fov / 2)) / Math.max(1, world.viewportHeight || 1080);
            for (let k = 0; k < n; k++) {
                gliderAt(k, clock, state);
                const y = groundHeight(state.x, state.z) + state.y;
                // Heading: the nose (−z) along the travel; then bank about the nose and pitch.
                qn.setFromAxisAngle(Y, Math.atan2(-state.hx, -state.hz));
                qb.setFromAxisAngle(Z, state.bank);
                qp.setFromAxisAngle(X, state.pitch);
                qn.multiply(qb).multiply(qp);
                const o = k * 12;
                rows[o] = state.x;
                rows[o + 1] = y;
                rows[o + 2] = state.z;
                rows[o + 3] = state.span;
                rows[o + 4] = qn.x;
                rows[o + 5] = qn.y;
                rows[o + 6] = qn.z;
                rows[o + 7] = qn.w;
                const still = world.reducedMotion;
                rows[o + 8] = still ? 0.25 : state.beat;
                rows[o + 9] = still ? 0 : state.flap;
                const range = Math.hypot(state.x - eye.x, y - eye.y, state.z - eye.z);
                rows[o + 10] = (range * perMetre) / state.span;
                rows[o + 11] = still ? 0 : state.ripple;
                // The shadow: a disc a little smaller than the wings (a crescent, not a plate).
                shadowRows[k].set(state.x, y, state.z, state.span * 0.3);
            }
            for (let k = n; k < shadowRows.length; k++) shadowRows[k].set(0, -1e5, 0, 0);
            world.u.gliderCount.value = n;
            rowBuffer.needsUpdate = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
