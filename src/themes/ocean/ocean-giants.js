/**
 * Ocean — the large animals: humpbacks and their calves, blue whales, dolphins, whale sharks,
 * hammerheads, mantas, eagle rays, green turtles and ocean sunfish.
 *
 * Their bodies come from the creature pack (ocean-creatures.js; built in Blender from numbers),
 * one instanced draw per kind, all with ONE material (one pipeline). Where each animal is comes
 * from the world (ocean-world.js, from the routes in ocean-visits.js), written each frame as four
 * rows per animal into its kind's instance buffer (attributes aRow0..3):
 *   (x, y, z, metres)  (forward xyz, stroke phase)  (up xyz, presence)  (beat, turn, variant, _)
 * metres 0 = not in the water.
 *
 * The vertex stage swims each body plan from what its vertices carry (place along the body, part,
 * how far out along a fin, where the fin turns from):
 *   whales    the body beats up and down in a wave that grows toward the flukes, the flukes pitch
 *             a quarter-beat behind, the head dips against it, the long flippers scull and drift
 *   fish      the same wave sideways, the head swaying against the tail
 *   rays      a wave runs out along each wing and back across its chord while the body heaves
 *             against the wingbeat, and the tail whips
 *   turtle    the front flippers row (down and back, up and forward, feathering as they turn), the
 *             rear ones steer, the head nods
 *   sunfish   the tall fins above and below scull from side to side together
 * and every body bends into the turn it is swimming.
 *
 * The fragment stage paints each kind (countershading, the throat's grooves, white flippers, a
 * whale shark's spots and stripes, an eagle ray's rings, a manta's white shoulders or its black
 * morph, a turtle's plates or a hawksbill's tortoiseshell...), lights it with the sea's light
 * (caustics on its back), gives wet skin a sheen and lays the water between it and the eye over
 * it; an animal still on its way in (presence < 1) is only a shape in the blue.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    reflect,
    round,
    select,
    sin,
    smoothstep,
    uniformArray,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SURFACE, ocBackdrop, ocHash21, ocLight, ocPart, ocSong, ocThrough,
} from './ocean-tsl.js';
import {
    CAST, KINDS,
} from './ocean-visits.js';

/** Rows per animal (vec4 instance attributes aRow0..3). */
const ROWS = 4;

/** The water is a little clearer for the giants than for the reef (they must read far out). */
const CLARITY = 0.72;

/**
 * Per kind, how it swims:
 *   A = (body wave's height at the tail / wing's height at the tip, its wavenumber along the body
 *        / out along the wing, flipper or fin amplitude, how far the head moves against the tail)
 *   B = (flukes' extra pitch / the wing's wave back across the chord, body heave / turtle's sweep,
 *        flippers' slow drift / turtle's feathering, rear flippers)
 */
const SWIM = {
    humpback: [[0.06, 4.6, 0.12, 0.12], [0.42, 0, 0.3, 0]],
    blueWhale: [[0.045, 4.3, 0.07, 0.1], [0.34, 0, 0.12, 0]],
    dolphin: [[0.075, 4.2, 0.12, 0.12], [0.5, 0, 0.15, 0]],
    whaleShark: [[0.075, 5.2, 0.06, 0.18], [0, 0, 0.1, 0]],
    hammerhead: [[0.085, 6.2, 0.07, 0.2], [0, 0, 0.08, 0]],
    manta: [[0.15, 1.3, 0, 0], [2.4, 0.12, 0, 0]],
    eagleRay: [[0.19, 1.6, 0, 0], [2.2, 0.1, 0, 0]],
    turtle: [[0, 0, 0.62, 0], [0.4, 0.6, 0.6, 0.25]],
    sunfish: [[0, 0, 0.6, 0], [0, 0, 0, 0]],
};

/**
 * Per kind, its colours (scene-linear) and how they lie:
 *   back (rgb, mottling), belly (rgb, where the line between them falls on the rest normal's y),
 *   a (rgb, pattern scale), b (rgb, pattern strength).
 */
const SKINS = {
    humpback: [[0.024, 0.028, 0.036, 0.35], [0.5, 0.52, 0.53, -0.25], [0.2, 0.21, 0.23, 1], [0.66, 0.68, 0.68, 1]],
    blueWhale: [[0.11, 0.15, 0.21, 0.8], [0.26, 0.31, 0.36, -0.45], [0.16, 0.2, 0.25, 1], [0.2, 0.24, 0.3, 0]],
    dolphin: [[0.095, 0.11, 0.135, 0.15], [0.6, 0.62, 0.64, -0.1], [0.045, 0.052, 0.068, 1], [0.5, 0.5, 0.5, 0]],
    whaleShark: [[0.05, 0.075, 0.105, 0.25], [0.56, 0.58, 0.58, -0.35], [0.008, 0.009, 0.011, 1], [0.025, 0.032, 0.04, 1]],
    hammerhead: [[0.17, 0.165, 0.145, 0.25], [0.6, 0.6, 0.58, -0.2], [0.17, 0.165, 0.145, 1], [0.5, 0.5, 0.5, 0]],
    manta: [[0.011, 0.012, 0.016, 0.1], [0.68, 0.7, 0.7, -0.05], [0.6, 0.62, 0.63, 1], [0.04, 0.04, 0.05, 1]],
    eagleRay: [[0.018, 0.024, 0.04, 0.2], [0.7, 0.72, 0.72, -0.05], [0.58, 0.6, 0.6, 1], [0.5, 0.5, 0.5, 0]],
    turtle: [[0.15, 0.1, 0.035, 0.4], [0.46, 0.41, 0.23, -0.3], [0.11, 0.12, 0.085, 1], [0.36, 0.34, 0.24, 1]],
    sunfish: [[0.19, 0.205, 0.22, 0.6], [0.46, 0.48, 0.49, -0.6], [0.06, 0.06, 0.065, 1], [0.03, 0.03, 0.035, 1]],
};

const table4 = (src, index) => uniformArray(KINDS.map((kind) => new THREE.Vector4(...src[kind][index])), 'vec4');

const rotX = (v, a) => {
    const c = cos(a).toVar();
    const s = sin(a).toVar();
    return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
};
const rotY = (v, a) => {
    const c = cos(a).toVar();
    const s = sin(a).toVar();
    return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
};
const rotZ = (v, a) => {
    const c = cos(a).toVar();
    const s = sin(a).toVar();
    return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);
};

/** The body wave at a place along it: how far it stands off its line (units of its length). */
const bodyWave = (s, phase, amp, K, recoil, from) => {
    const env = pow(clamp(s.sub(from).div(float(1).sub(from)), 0.0, 1.0), 1.6)
        .sub(float(1.0).sub(smoothstep(0.0, 0.35, s)).mul(recoil));
    return env.mul(amp).mul(sin(phase.sub(s.mul(K))));
};

/** A cell pattern: (distance to the nearest of a jittered grid of points, that point's own number). */
const cells = (st) => {
    const i = floor(st);
    const f = fract(st);
    const jitter = vec2(ocHash21(i), ocHash21(i.add(17.3)));
    const d = length(f.sub(jitter.mul(0.6).add(0.2)));
    return vec2(d, ocHash21(i.add(41.7)));
};

/**
 * Build the material every kind shares.
 * @param {object} u    the sea's uniforms
 */
function createGiantMaterial(u) {
    const swimA = table4(SWIM, 0);
    const swimB = table4(SWIM, 1);
    const skinBack = table4(SKINS, 0);
    const skinBelly = table4(SKINS, 1);
    const skinA = table4(SKINS, 2);
    const skinB = table4(SKINS, 3);

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OceanGiants';
    material.side = THREE.FrontSide;
    material.fog = false;
    material.toneMapped = false;

    const aShape = attribute('aShape', 'vec4');
    const aPivot = attribute('aPivot', 'vec4');
    const vNormal = varying(vec3(0.0, 1.0, 0.0), 'vGiantN');
    const vRestN = varying(vec3(0.0, 1.0, 0.0), 'vGiantRestN');
    const vLook = varying(vec4(0.0), 'vGiantLook');

    material.positionNode = Fn(() => {
        const R0 = attribute('aRow0', 'vec4');
        const R1 = attribute('aRow1', 'vec4');
        const R2 = attribute('aRow2', 'vec4');
        const R3 = attribute('aRow3', 'vec4');
        const kindF = round(aShape.w.mul(255.0));
        const kind = int(kindF);
        const code = round(aShape.y.mul(255.0));
        const part = floor(code.div(3.0).add(0.01));
        const s = aShape.x;
        const w = aShape.z;
        const pivot = aPivot.xyz;
        const phase = R1.w;
        const beat = R3.x;
        const turn = R3.y;
        const A = swimA.element(kind);
        const B = swimB.element(kind);
        const sgn = select(pivot.x.greaterThanEqual(0.0), float(1.0), float(-1.0));
        const isPart = (n) => float(1.0).sub(smoothstep(0.0, 0.5, abs(part.sub(n))));
        const local = positionGeometry.toVar();
        const nrm = attribute('normal', 'vec3').toVar();
        const root = smoothstep(0.0, 0.3, w);

        If(kindF.lessThan(2.5), () => {
            // ── Whales: up and down ──
            const flip = isPart(1).mul(root);
            // (A rotation of nothing everywhere but the flippers: the angle is zero off them.)
            const fin = A.z.mul(beat).mul(sin(phase.mul(0.5).add(0.8)))
                .add(B.z.mul(sin(phase.mul(0.11).add(R3.z.mul(6.0))))).mul(sgn)
                .mul(flip);
            local.assign(pivot.add(rotZ(local.sub(pivot), fin)));
            nrm.assign(rotZ(nrm, fin));
            const amp = A.x.mul(beat);
            const h = bodyWave(s, phase, amp, A.y, A.w, 0.22);
            const h2 = bodyWave(s.add(0.01), phase, amp, A.y, A.w, 0.22);
            const slope = h2.sub(h).div(0.01);
            // The flukes pitch a quarter-beat behind the stroke, from where they meet the body.
            const isTail = isPart(2);
            const pitch = B.x.mul(beat).mul(cos(phase.sub(A.y.mul(0.92)))).mul(isTail);
            const behind = max(float(-0.41).sub(local.z), 0.0);
            local.addAssign(vec3(0.0, h.add(behind.mul(pitch)), 0.0));
            nrm.assign(rotX(nrm, atan(slope.add(pitch))));
        }).ElseIf(kindF.lessThan(4.5), () => {
            // ── Fish: side to side ──
            const fins = isPart(1).add(isPart(5)).mul(root);
            const scull = A.z.mul(sin(phase.add(1.2))).mul(sgn).mul(fins);
            local.assign(pivot.add(rotZ(local.sub(pivot), scull)));
            nrm.assign(rotZ(nrm, scull));
            const amp = A.x.mul(beat.mul(0.6).add(0.4));
            const h = bodyWave(s, phase, amp, A.y, A.w, 0.12);
            const h2 = bodyWave(s.add(0.01), phase, amp, A.y, A.w, 0.12);
            local.addAssign(vec3(h, 0.0, 0.0));
            nrm.assign(rotY(nrm, atan(h2.sub(h).div(0.01)).negate()));
        }).ElseIf(kindF.lessThan(6.5), () => {
            // ── Rays: the wings fly ──
            const span = clamp(abs(local.x).div(0.5), 0.0, 1.0);
            const wing = pow(smoothstep(0.12, 1.0, span), 1.25);
            const chord = float(0.2).sub(local.z);
            const amp = A.x.mul(beat);
            const flap = (dx, dz) => {
                const sp = clamp(abs(local.x.add(dx)).div(0.5), 0.0, 1.0);
                const wg = pow(smoothstep(0.12, 1.0, sp), 1.25);
                return wg.mul(amp).mul(sin(phase.sub(sp.mul(A.y)).sub(chord.sub(dz).mul(B.x))));
            };
            const y0 = wing.mul(amp).mul(sin(phase.sub(span.mul(A.y)).sub(chord.mul(B.x))));
            const fx = flap(0.01, 0.0).sub(y0).div(0.01);
            const fz = flap(0.0, 0.01).sub(y0).div(0.01);
            const heave = B.y.mul(amp).negate().mul(sin(phase));
            // The tail whips a little behind the wingbeat; the horns curl.
            const isTail = isPart(2);
            const whip = sin(phase.mul(1.3).sub(s.mul(7.0))).mul(0.04).mul(beat).mul(smoothstep(0.45, 1.0, s))
                .mul(isTail);
            const curl = isPart(4).mul(w).mul(sin(phase.mul(1.7))).mul(0.012);
            // (Pulled in a little as it lifts, so a wing keeps its length.)
            const tuck = sgn.mul(y0.mul(y0)).div(max(abs(positionGeometry.x), 0.06)).mul(0.5);
            local.addAssign(vec3(whip.sub(tuck), y0.add(heave).add(curl), 0.0));
            nrm.assign(normalize(vec3(nrm.x.sub(fx.mul(nrm.y)), nrm.y, nrm.z.sub(fz.mul(nrm.y)))));
        }).ElseIf(kindF.lessThan(7.5), () => {
            // ── Turtle: the front flippers row and feather, the rear ones steer, the head nods ──
            const front = isPart(1);
            const rear = isPart(5);
            const head = isPart(4);
            const v = local.sub(pivot).toVar();
            const n = nrm.toVar();
            If(front.greaterThan(0.5), () => {
                const lift = A.z.mul(beat).mul(sin(phase)).mul(sgn).mul(root);
                const sweep = A.w.mul(beat).mul(sin(phase.sub(0.9))).mul(sgn).mul(root);
                const twist = B.y.mul(beat).mul(cos(phase)).mul(w);
                v.assign(rotY(rotZ(rotX(v, twist), lift), sweep));
                n.assign(rotY(rotZ(rotX(n, twist), lift), sweep));
            });
            If(rear.greaterThan(0.5), () => {
                const steer = B.w.mul(sin(phase.add(1.2))).mul(sgn).mul(root);
                const dip = B.w.mul(0.6).mul(sin(phase.add(0.4))).mul(sgn).mul(root);
                v.assign(rotZ(rotY(v, steer), dip));
                n.assign(rotZ(rotY(n, steer), dip));
            });
            If(head.greaterThan(0.5), () => {
                const nod = sin(phase.add(0.6)).mul(0.07).mul(w);
                v.assign(rotX(v, nod));
                n.assign(rotX(n, nod));
            });
            // (v is unchanged off the moving parts, so this puts every other vertex back where it was.)
            local.assign(pivot.add(v));
            nrm.assign(n);
            local.addAssign(vec3(0.0, sin(phase.mul(2.0).sub(0.5)).mul(0.006).mul(beat), 0.0));
        })
            .Else(() => {
            // ── Sunfish: the tall fins scull together ──
                const tall = isPart(3).add(isPart(5)).mul(smoothstep(0.0, 0.2, w));
                const sweep = A.z.mul(beat).mul(sin(phase)).mul(w.mul(0.6).add(0.4)).mul(tall);
                const pect = isPart(1).mul(root);
                const flutter = sin(phase.mul(2.0)).mul(0.5).mul(sgn).mul(pect);
                local.assign(pivot.add(rotY(rotZ(local.sub(pivot), sweep), flutter)));
                nrm.assign(rotY(rotZ(nrm, sweep), flutter));
                const wobble = sin(phase.add(s.mul(2.0))).mul(0.012).mul(s)
                    .add(sin(phase.mul(1.5).add(local.y.mul(12.0))).mul(0.012).mul(isPart(2)));
                local.addAssign(vec3(wobble, 0.0, 0.0));
            });

        // Every body bends into its turn (nose and tail toward the inside of it).
        const bend = s.sub(0.4);
        local.subAssign(vec3(turn.mul(0.5).mul(bend).mul(bend), 0.0, 0.0));
        nrm.assign(rotY(nrm, atan(turn.mul(bend))));

        // Into the world: its own frame from its heading and its up.
        const f = normalize(R1.xyz);
        const side = normalize(cross(R2.xyz, f));
        const up = cross(f, side);
        vRestN.assign(attribute('normal', 'vec3'));
        vNormal.assign(normalize(side.mul(nrm.x).add(up.mul(nrm.y)).add(f.mul(nrm.z))));
        vLook.assign(vec4(R3.z, R2.w, 0.0, 0.0));
        return R0.xyz.add(side.mul(local.x).add(up.mul(local.y)).add(f.mul(local.z)).mul(R0.w));
    })();

    material.colorNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(vNormal).toVar();
        const toEye = cameraPosition.sub(P);
        const dist = length(toEye);
        const V = toEye.div(max(dist, 1e-3));
        const kindF = round(aShape.w.mul(255.0));
        const kind = int(kindF);
        const skin = attribute('aSkin', 'vec4');
        const rp = positionGeometry;
        const variant = vLook.x;
        const back = skinBack.element(kind);
        const belly = skinBelly.element(kind);
        const accA = skinA.element(kind);
        const accB = skinB.element(kind);
        const up = vRestN.y;
        // Countershaded: dark above, pale below, the line where this kind's falls.
        const shade = smoothstep(belly.w.sub(0.28), belly.w.add(0.28), up);
        const mottle = u.noise(rp.xz.mul(3.1).add(rp.y.mul(1.7)).add(variant.mul(7.0))).r;
        const albedo = mix(belly.rgb, back.rgb, shade).mul(mottle.sub(0.5).mul(back.w).add(1.0)).toVar();
        const mA = skin.y;
        const mB = skin.z;
        const eye = skin.w;

        If(kindF.lessThan(0.5), () => {
            // Humpback: the throat's long grooves; white flippers, white under the flukes,
            // freckled black (more or less white from one animal to the next).
            const grooves = sin(rp.x.mul(260.0)).mul(0.5).add(0.5);
            albedo.assign(mix(albedo, accA.rgb.mul(grooves.mul(0.6).add(0.55)), mA));
            const freckle = smoothstep(0.55, 0.7, u.noise(rp.xz.mul(9.0).add(variant)).g);
            const white = mB.mul(variant.mul(0.5).add(0.5));
            albedo.assign(mix(albedo, mix(accB.rgb, back.rgb, freckle.mul(0.8)), white));
        }).ElseIf(kindF.lessThan(1.5), () => {
            // Blue whale: mottled blue-grey, paler pleats under the throat.
            const mot = smoothstep(0.35, 0.75, u.noise(rp.xz.mul(7.0).add(rp.y.mul(3.0))).b);
            albedo.assign(mix(albedo, albedo.mul(1.55).add(0.02), mot.mul(0.6)));
            albedo.assign(mix(albedo, accA.rgb.mul(sin(rp.x.mul(300.0)).mul(0.25).add(1.0)), mA.mul(0.8)));
        }).ElseIf(kindF.lessThan(2.5), () => {
            // Dolphin: the darker cape over the back.
            albedo.assign(mix(albedo, accA.rgb, mA.mul(0.85)));
        }).ElseIf(kindF.lessThan(3.5), () => {
            // Whale shark: rows of pale spots on the dark back, thin pale bars between them.
            const around = atan(rp.x, rp.y);
            const st = vec2(rp.z.mul(46.0), around.mul(6.5));
            const c = cells(st);
            const spots = float(1.0).sub(smoothstep(0.17, 0.24, c.x));
            const bars = smoothstep(0.06, 0.0, abs(fract(rp.z.mul(15.0).add(around.mul(0.12))).sub(0.5)).sub(0.44)).mul(0.6);
            const onBack = smoothstep(-0.2, 0.25, up);
            albedo.assign(mix(albedo, belly.rgb.mul(0.9), max(spots, bars).mul(onBack).mul(0.85)));
            albedo.assign(mix(albedo, accA.rgb, mA));
            albedo.assign(mix(albedo, accB.rgb, mB.mul(smoothstep(0.3, 0.7, sin(rp.z.mul(120.0)).mul(0.5).add(0.5)))));
        })
            .ElseIf(kindF.lessThan(4.5), () => {
            // Hammerhead: plain bronze-grey, a little darker toward the fins' tips.
                albedo.mulAssign(float(1.0).sub(smoothstep(0.6, 1.0, aShape.z).mul(0.35)));
            })
            .ElseIf(kindF.lessThan(5.5), () => {
            // Manta: white shoulders on the black back, gill slits, a few dark spots on the belly;
            // one in six is the black morph, dark all over.
                albedo.assign(mix(albedo, accA.rgb, mA));
                const slits = smoothstep(0.35, 0.5, sin(rp.z.mul(260.0)).mul(0.5).add(0.5));
                albedo.assign(mix(albedo, accB.rgb, mB.mul(slits)));
                const c = cells(rp.xz.mul(26.0).add(variant.mul(13.0)));
                const dots = float(1.0).sub(smoothstep(0.08, 0.13, c.x)).mul(step01(c.y.sub(0.7)));
                albedo.assign(mix(albedo, accB.rgb, dots.mul(float(1.0).sub(shade)).mul(smoothstep(0.17, 0.14, abs(rp.x)))));
                const black = smoothstep(0.82, 0.86, variant);
                albedo.assign(mix(albedo, mix(back.rgb, vec3(0.06, 0.065, 0.07), float(1.0).sub(shade).mul(0.7)), black));
            })
            .ElseIf(kindF.lessThan(6.5), () => {
            // Eagle ray: white spots and rings on the deep blue-black back.
                const c = cells(rp.xz.mul(34.0));
                const ring = smoothstep(0.05, 0.0, abs(c.x.sub(0.15)).sub(0.02)).mul(step01(c.y.sub(0.55)));
                const spot = float(1.0).sub(smoothstep(0.1, 0.15, c.x)).mul(step01(float(0.55).sub(c.y)));
                albedo.assign(mix(albedo, accA.rgb, max(ring, spot).mul(mA).mul(smoothstep(0.42, 0.36, abs(rp.z)))));
            })
            .ElseIf(kindF.lessThan(7.5), () => {
            // Turtle: plates on the shell (dark seams, rays from each plate's heart), the plastron
            // pale, scaled skin with paler edges; some are hawksbills, amber and black.
                const plates = cells(vec2(rp.x.mul(7.5), rp.z.mul(6.5)));
                const seam = smoothstep(0.42, 0.52, plates.x);
                const rays = sin(atan(fract(rp.x.mul(7.5)).sub(0.5), fract(rp.z.mul(6.5)).sub(0.5)).mul(9.0)).mul(0.5).add(0.5);
                const hawk = smoothstep(0.55, 0.6, variant);
                const greenShell = mix(back.rgb, back.rgb.mul(2.0), rays.mul(0.4).add(mottle.mul(0.3)));
                const tortoise = mix(
                    vec3(0.3, 0.13, 0.025),
                    vec3(0.03, 0.02, 0.012),
                    smoothstep(0.42, 0.62, u.noise(rp.xz.mul(5.0).add(plates.y)).g),
                );
                const shell = mix(greenShell, tortoise, hawk).mul(float(1.0).sub(seam.mul(0.55)));
                const scales = cells(rp.xz.mul(40.0).add(rp.y.mul(13.0)));
                const hide = mix(accA.rgb, accB.rgb, smoothstep(0.3, 0.5, scales.x));
                const notShell = max(float(1.0).sub(mA).sub(mB), 0.0);
                albedo.assign(shell.mul(mA).add(belly.rgb.mul(mB)).add(hide.mul(notShell)));
            })
            .Else(() => {
            // Sunfish: silver with pale blotches, the gill and the mouth dark.
                const blot = smoothstep(0.55, 0.75, u.noise(rp.zy.mul(4.0).add(variant.mul(5.0))).a);
                albedo.assign(mix(albedo, belly.rgb.mul(1.15), blot.mul(0.5)));
                albedo.assign(mix(albedo, accB.rgb, max(mA, mB)));
            });
        // The eye: dark and wet.
        albedo.assign(mix(albedo, vec3(0.006, 0.006, 0.008), eye));

        const ao = skin.x.mul(0.75).add(0.25);
        // The sea's light, but the sand's glow from below fades with height over it (an animal
        // swimming high gets little of it) and the water's own blue comes up from the deep in its
        // place: seen from the reef a giant is a darker shape on the bright water, its belly blue.
        const breathK = u.breath.mul(0.6).add(0.4);
        const below = clamp(N.y.negate(), 0.0, 1.0);
        const sandGlow = u.bounce.mul(float(0.5).sub(N.y.mul(0.5))).mul(breathK);
        const high = float(1.0).sub(exp(max(P.y.sub(1.5), 0.0).mul(-0.25)));
        const lit = ocLight(u, { N, P, wrap: 0.32 }).sub(sandGlow.mul(high))
            .add(u.deep.mul(below.mul(0.35)).mul(breathK));
        const col = albedo.mul(lit).mul(ao).toVar();
        // Wet skin takes a sheen of the light from above (not a turtle's shell, not much a ray's back).
        const depth = max(float(SURFACE).sub(P.y), 0.0);
        const sheenK = select(kindF.greaterThan(6.5), float(0.25), float(1.0));
        const R = reflect(V.negate(), N);
        const sheen = pow(clamp(dot(R, u.sunDir), 0.0, 1.0), 24.0).mul(float(0.22).add(eye.mul(0.3))).mul(sheenK);
        col.addAssign(u.sun.mul(sheen).mul(smoothstep(-0.2, 0.4, N.y)).mul(ocThrough(u, depth).mul(0.6).add(0.4))
            .mul(u.breath.mul(0.6).add(0.4)));
        // A rim of the water's own light round the silhouette, so a far animal keeps its shape, and
        // the sun along its upper edge (the way a whale seen from below is a dark shape with a lit
        // back): the shape reads, and which way is up.
        const rim = float(1.0).sub(clamp(dot(N, V), 0.0, 1.0));
        col.addAssign(u.halo.mul(rim.mul(rim).mul(rim)).mul(0.12));
        const crest = rim.mul(rim).mul(smoothstep(0.0, 0.7, N.y)).mul(ocThrough(u, depth).mul(0.7).add(0.3));
        col.addAssign(u.sun.mul(crest).mul(0.32).mul(breathK));
        // A humpback's song lights the water round it, and the animal in it.
        If(kindF.lessThan(0.5), () => {
            col.addAssign(u.glow.mul(ocSong(u, P)).mul(0.25));
        });
        const water = ocBackdrop(u, V.negate());
        const seen = mix(water, col, ocThrough(u, dist.mul(CLARITY)));
        return vec4(mix(water, seen, vLook.y), 1.0);
    })();
    return material;
}

/** 1 where x ≥ 0 (a hard edge for pattern choices). */
function step01(x) {
    return select(x.greaterThanEqual(0.0), float(1.0), float(0.0));
}

/** Floats per animal in its kind's instance buffer: the four rows the shaders read. */
const STRIDE = ROWS * 4;

/** An animal's rows set to "not in the water" (metres 0 collapses it to its place). */
function park(data, at) {
    data.fill(0, at, at + STRIDE);
    data[at + 1] = -100;
    data[at + 6] = -1;
    data[at + 9] = 1;
}

/**
 * Every kind of large animal, as scene parts, from the creature pack.
 *
 * Each kind's animals carry their rows as instance attributes of its own (one interleaved buffer:
 * `aRow0..3`), not in a uniform array: the material is shared by every kind's draw, and a
 * uniform buffer changed each frame and read by several draws is not one each of them is sure to
 * see fresh on the WebGPU backend (the first kinds swam, the rest stayed parked).
 * Returns { parts: { [kind]: part }, set(kind, i, pose), clear(kind, from), commit(counts), live() }.
 * @param {object} u
 * @param {{ kinds: object }} pack   what ocean-creatures.js parsed
 */
export function createGiants(u, pack) {
    const material = createGiantMaterial(u);
    const parts = {};
    const rows = {};
    KINDS.forEach((kind) => {
        const body = pack?.kinds?.[kind];
        if (!body) return;
        const { slots } = CAST[kind];
        const geometry = new THREE.InstancedBufferGeometry();
        Object.keys(body.geometry.attributes).forEach((k) => geometry.setAttribute(k, body.geometry.attributes[k]));
        geometry.setIndex(body.geometry.index);
        const data = new Float32Array(slots * STRIDE);
        for (let i = 0; i < slots; i++) park(data, i * STRIDE);
        const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
        buffer.setUsage(THREE.DynamicDrawUsage);
        for (let r = 0; r < ROWS; r++) geometry.setAttribute(`aRow${r}`, new THREE.InterleavedBufferAttribute(buffer, 4, r * 4));
        geometry.instanceCount = 1;
        geometry.name = `OceanGiant:${kind}`;
        const part = ocPart(`giant:${kind}`, geometry, material, 8);
        part.slots = slots;
        part.triangles = body.triangles;
        part.buffer = buffer;
        // (The material is shared: dispose it once, below.)
        part.material = null;
        parts[kind] = part;
        rows[kind] = data;
    });
    return {
        parts,
        material,
        /** Stand the `i`th animal of a kind at a pose (null = out of the water). */
        set(kind, i, pose) {
            if (!parts[kind] || i < 0 || i >= CAST[kind].slots) return;
            const data = rows[kind];
            const at = i * STRIDE;
            if (!pose || !(pose.scale > 0)) {
                park(data, at);
                return;
            }
            data[at] = pose.x;
            data[at + 1] = pose.y;
            data[at + 2] = pose.z;
            data[at + 3] = pose.scale;
            data[at + 4] = pose.fx;
            data[at + 5] = pose.fy;
            data[at + 6] = pose.fz;
            data[at + 7] = pose.phase;
            data[at + 8] = pose.ux;
            data[at + 9] = pose.uy;
            data[at + 10] = pose.uz;
            data[at + 11] = pose.presence ?? 1;
            data[at + 12] = pose.beat ?? 1;
            data[at + 13] = pose.turn ?? 0;
            data[at + 14] = pose.variant ?? 0;
            data[at + 15] = 0;
        },
        /** Park every slot of a kind from `from` on (the frame's leftovers). */
        clear(kind, from = 0) {
            if (!parts[kind]) return;
            for (let i = from; i < CAST[kind].slots; i++) park(rows[kind], i * STRIDE);
        },
        /** Send this frame's rows, and draw only as many of each kind as are in the water. */
        commit(counts) {
            Object.keys(parts).forEach((kind) => {
                const n = counts?.[kind] ?? CAST[kind].slots;
                const part = parts[kind];
                part.geometry.instanceCount = Math.max(1, n);
                part.buffer.needsUpdate = true;
            });
        },
        /** Where the `i`th animal of a kind is (x, y, z, metres), or null when it is not in the water. */
        where(kind, i = 0) {
            const data = rows[kind];
            if (!data || i < 0 || i >= CAST[kind].slots || !(data[i * STRIDE + 3] > 0)) return null;
            const at = i * STRIDE;
            return {
                x: data[at], y: data[at + 1], z: data[at + 2], metres: data[at + 3],
            };
        },
        live() {
            const out = {};
            KINDS.forEach((kind) => {
                let n = 0;
                if (parts[kind]) {
                    for (let i = 0; i < CAST[kind].slots; i++) if (rows[kind][i * STRIDE + 3] > 0) n += 1;
                }
                out[kind] = n;
            });
            return out;
        },
        dispose() {
            material.dispose();
            Object.values(parts).forEach((p) => p.geometry.dispose());
        },
    };
}
