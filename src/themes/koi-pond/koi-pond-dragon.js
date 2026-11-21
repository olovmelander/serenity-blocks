/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the dragon.
 *
 * What a koi becomes when it has climbed the falls. A long chain of clears wakes it in the basin
 * under the board: it rises and swims the ring round the card, a body of jade scales edged in
 * gold, mane and whiskers trailing, its back arching out of the water as it goes. A four-line
 * clear makes it rear.
 *
 * Its body is a function of one number (how far round it has swum), so it needs no history; the
 * vertex shader lofts a tube along a spine of points the CPU supplies.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, cross, dot, float, floor, fract, fwidth, int, max, mix, normalize,
    positionGeometry, positionWorld, pow, sin, smoothstep, step, uniform, uniformArray, varying, vec3, vec4,
} from 'three/tsl';
import {
    TAU, clamp01, smooth, waterDepth,
} from './koi-pond-core.js';
import { CHAIN_GOLD } from './koi-pond-light.js';

// ── The dragon ──────────────────────────────────────────────────────────────────────────────

/** Metres between the spine's points. */
const SPINE_STEP = 0.115;
const BODY_SIDES = 14;
const SKIN = 0;
const FIN = 1;
const HORN = 2;
const WHISKER = 3;
const EYE = 4;
const BROW = 5;

/** The ring it swims (centre and radii, metres): a little outside the koi's own. */
export const DRAGON_RING = Object.freeze({
    x: 0, z: -0.05, radiusX: 3.15, radiusZ: 2.2,
});

/** Where the dragon's spine is at angle `theta` round its ring. Writes x, y, z into `out`. */
export function dragonPath(theta, time, out) {
    const rx = DRAGON_RING.radiusX + 0.5 * Math.sin(theta * 3 + 0.6);
    const rz = DRAGON_RING.radiusZ + 0.32 * Math.sin(theta * 2 + 1.9);
    // A sideways shimmy runs down the body as it swims.
    const shimmy = 0.11 * Math.sin(theta * 9 - time * 2.6);
    const x = DRAGON_RING.x + Math.cos(theta) * (rx + shimmy);
    const z = DRAGON_RING.z + Math.sin(theta) * (rz + shimmy);
    // It rides in arches: four times round the ring its back comes up through the surface.
    let y = -0.47 + 0.4 * Math.sin(theta * 4 + 0.9);
    const bed = -waterDepth(x, z) + 0.24;
    if (y < bed) y = bed;
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
}

/** Body radius along the spine (0 = snout, 1 = tail tip), metres. */
export function dragonGirth(f) {
    return 0.01 + 0.134 * (1 - smooth(0.48, 1, f)) + 0.015 * (1 - smooth(0.12, 0.5, f));
}

/** Sculpted in a straight pose; each vertex records the spine joint that carries it. */
function buildDragonGeometry(segments) {
    const positions = [];
    const ribs = [];
    const indices = [];
    const last = segments - 1;
    const vertex = (joint, x, y, z, around, part, tip = 0) => {
        positions.push(x - joint * SPINE_STEP, y, z);
        ribs.push(joint, around, part, tip);
        return ribs.length / 4 - 1;
    };
    const bridge = (a, b, count, reverse = false) => {
        for (let k = 0; k < count - 1; k++) {
            if (reverse) indices.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
            else indices.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
        }
    };

    // A blunt upturned muzzle opens into flat cheek plates, a crowned forehead and a narrow
    // neck. The skull has the same length on a short and a long dragon.
    const sections = [
        // joint, longitudinal offset, height, half-width, upper and lower half-depth.
        [0, 0.201, 0.022, 0.004, 0.004, 0.004], [0, 0.184, 0.018, 0.081, 0.041, 0.024],
        [0, 0.133, 0.008, 0.113, 0.061, 0.037], [0, 0.064, -0.006, 0.113, 0.054, 0.038],
        [0, 0, 0.003, 0.127, 0.094, 0.051], [1, 0, 0.009, 0.191, 0.146, 0.088],
        [2, 0, 0.012, 0.206, 0.153, 0.101], [3, 0, 0.009, 0.15, 0.12, 0.093],
        [4, 0, 0.004, 0.115, 0.102, 0.086],
    ];
    for (let i = 5; i < segments; i++) {
        const r = dragonGirth(i / last);
        sections.push([i, 0, 0, r, r * 1.08, r * 0.87]);
    }
    sections.forEach(([joint, x, y, width, up, down], index) => {
        const start = ribs.length / 4;
        for (let k = 0; k <= BODY_SIDES; k++) {
            const angle = (k / BODY_SIDES) * TAU;
            const top = Math.sin(angle);
            vertex(joint, x, y + top * (top > 0 ? up : down), Math.cos(angle) * width, angle, SKIN);
        }
        if (index > 0) bridge(start - BODY_SIDES - 1, start, BODY_SIDES + 1);
    });

    // Curved tapered tubes carry the cheeks, eyes, whiskers and forked antlers. Their cross
    // sections follow the local tangent so even the tips read from above and cast a shadow.
    const branch = (joint, part, waypoints, mirror, sides = 7) => {
        const points = waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z * mirror));
        points.forEach((p, i) => {
            const axis = new THREE.Vector3().subVectors(
                points[Math.min(i + 1, points.length - 1)],
                points[Math.max(0, i - 1)],
            ).normalize();
            const right = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
            const up = new THREE.Vector3().crossVectors(right, axis);
            const radius = waypoints[i][3];
            const start = ribs.length / 4;
            for (let k = 0; k <= sides; k++) {
                const angle = (k / sides) * TAU;
                const a = radius * Math.cos(angle);
                const b = radius * Math.sin(angle);
                vertex(
                    joint,
                    p.x + right.x * a + up.x * b,
                    p.y + right.y * a + up.y * b,
                    p.z + right.z * a + up.z * b,
                    angle,
                    part,
                    i / (points.length - 1),
                );
            }
            if (i) bridge(start - sides - 1, start, sides + 1, true);
        });
    };
    for (const side of [-1, 1]) {
        branch(2, HORN, [[0.02, 0.102, 0.107, 0.045], [-0.02, 0.186, 0.151, 0.042],
            [-0.127, 0.262, 0.219, 0.035], [-0.188, 0.333, 0.294, 0.022],
            [-0.257, 0.40, 0.305, 0.0015]], side);
        branch(2, HORN, [[-0.094, 0.247, 0.206, 0.027], [-0.064, 0.307, 0.247, 0.020],
            [-0.029, 0.343, 0.251, 0.0015]], side);
        branch(1, EYE, [[-0.051, 0.090, 0.139, 0.003], [-0.018, 0.097, 0.152, 0.032],
            [0.016, 0.096, 0.156, 0.034], [0.049, 0.080, 0.14, 0.004]], side, 10);
        branch(1, BROW, [[0.069, 0.090, 0.126, 0.008], [0.037, 0.125, 0.13, 0.031],
            [-0.029, 0.146, 0.143, 0.035], [-0.092, 0.145, 0.19, 0.017],
            [-0.144, 0.153, 0.208, 0.002]], side);
        branch(0, WHISKER, [[0.122, 0.005, 0.076, 0.017], [0.164, 0.008, 0.165, 0.016],
            [0.171, 0.065, 0.228, 0.014], [0.085, 0.104, 0.293, 0.013],
            [-0.105, 0.098, 0.378, 0.009], [-0.322, 0.058, 0.43, 0.006],
            [-0.487, 0.028, 0.411, 0.0015]], side, 5);
    }

    // Curled, ribbed leaf-like fins. A narrow ridge on each catches the gold of the lantern.
    const blade = (joint, side, base, rise, reach, sweep, width) => {
        const span = Math.hypot(sweep, reach);
        const baseSide = side * base;
        for (let i = 0; i <= 6; i++) {
            const t = i / 6;
            const fan = (0.24 * (1 - t) + Math.sin(Math.PI * t) ** 0.86) * width;
            const x = -sweep * t * (0.6 + 0.4 * t);
            const y = base * 0.6 + rise * Math.sin(t * Math.PI * 0.53);
            const z = baseSide + side * reach * t;
            const start = ribs.length / 4;
            for (let k = -1; k <= 1; k++) {
                vertex(
                    joint,
                    x + k * fan * (reach / span),
                    y + (1 - Math.abs(k)) * fan * 0.56,
                    z + k * fan * side * (sweep / span),
                    k,
                    FIN,
                    t,
                );
            }
            if (i) bridge(start - 3, start, 3, side > 0);
        }
    };
    for (const side of [-1, 1]) {
        blade(2, side, 0.13, 0.108, 0.219, 0.27, 0.066);
        blade(3, side, 0.105, 0.139, 0.191, 0.32, 0.074);
        blade(4, side, 0.085, 0.109, 0.138, 0.32, 0.055);
        blade(last - 2, side, 0.012, 0.068, 0.184, 0.41, 0.052);
    }
    for (let i = 5; i < segments - 3; i += 3) {
        const f = i / last;
        const radius = dragonGirth(f);
        blade(i, i % 2 ? 1 : -1, radius * 0.5, radius + 0.055, 0.046, 0.215, radius * 0.36);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aRib', new THREE.Float32BufferAttribute(ribs, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

export class Dragon {
    /**
     * @param {PondLight} light
     * @param {number} segments   spine points (the tier's `dragon`)
     */
    constructor(light, segments) {
        this.light = light;
        this.segments = Math.max(16, Math.floor(segments));
        this.length = this.segments * SPINE_STEP;
        this.spine = Array.from({ length: this.segments }, () => new THREE.Vector4(0, -3, 0, 0.1));
        this.spineNode = uniformArray(this.spine, 'vec4');
        this.uPresence = uniform(0);
        this.uPulse = uniform(0);
        this.theta = 0.6;
        this.presence = 0;
        this.arch = 0;
        this._p = [0, 0, 0];
        this.build();
    }

    build() {
        const { light, segments } = this;
        const { u } = light;
        const geometry = buildDragonGeometry(segments);
        this.geometry = geometry;
        const joint = attribute('aRib', 'vec4');
        const last = segments - 1;
        const i = floor(joint.x.add(0.5)).toInt();
        const here = this.spineNode.element(i);
        const ahead = this.spineNode.element(max(i.sub(int(1)), int(0)));
        const behind = this.spineNode.element(clamp(i.add(int(1)), int(0), int(last)));
        const tangent = normalize(ahead.xyz.sub(behind.xyz).add(vec3(0.0001, 0, 0)));
        const side = normalize(cross(tangent, vec3(0, 1, 0)).add(vec3(0, 0, 0.0001)));
        const lift = normalize(cross(side, tangent));
        const inFrame = (x, y, z) => tangent.mul(x).add(lift.mul(y)).add(side.mul(z));
        const place = Fn(() => {
            const fin = step(0.5, joint.z).mul(step(joint.z, 1.5));
            const whisker = step(2.5, joint.z).mul(step(joint.z, 3.5));
            const waving = joint.w.mul(joint.w).mul(fin.mul(0.023).add(whisker.mul(0.052)));
            const flutter = sin(joint.x.mul(0.57).add(joint.w.mul(4.6)).sub(u.time.mul(3.5))).mul(waving);
            const x = positionGeometry.x.add(joint.x.mul(SPINE_STEP));
            const local = inFrame(x, positionGeometry.y.add(flutter), positionGeometry.z);
            return here.xyz.add(local.mul(this.uPresence.sqrt()));
        })();
        const n = attribute('normal', 'vec3');
        const vNormal = varying(inFrame(n.x, n.y, n.z), 'vDragonNormal');
        const vRib = varying(joint, 'vDragonRib');
        const paint = Fn(() => {
            const point = positionWorld.toVar();
            const f = vRib.x.div(last);
            const around = vRib.y;
            const part = vRib.z;
            const tip = clamp(vRib.w, 0.0, 1.0);
            const normal = normalize(vNormal.add(vec3(0, 0.0001, 0))).toVar();
            const view = normalize(cameraPosition.sub(point)).toVar();
            const gold = vec3(...CHAIN_GOLD);
            // The trailing scallop of each jade plate. Let the pattern merge into the smooth
            // stone at a distance and along the snout, instead of drawing a luminous net.
            const band = around.mul(7 / TAU).toVar();
            const arc = fract(band).sub(0.5);
            const plate = vRib.x.mul(0.83).add(floor(band).mul(0.5)).sub(arc.mul(arc).mul(1.42)).toVar();
            const foot = fwidth(vRib.x).mul(0.83).add(fwidth(around).mul(7 / TAU));
            const readable = smoothstep(0.28, 0.8, foot).oneMinus().mul(smoothstep(3.6, 6.4, vRib.x));
            const incised = smoothstep(0.035, 0.16, abs(fract(plate.add(0.5)).sub(0.5))).oneMinus().mul(readable);
            const top = sin(around).toVar();
            const body = mix(vec3(0.045, 0.17, 0.12), vec3(0.076, 0.38, 0.235), top.mul(0.5).add(0.5)).toVar();
            const belly = smoothstep(0.08, 0.86, top.negate());
            body.assign(mix(body, vec3(0.38, 0.29, 0.12), belly.mul(0.8)));
            body.mulAssign(incised.mul(-0.33).add(1.0));
            const carving = cos(plate.mul(TAU)).mul(0.026).add(0.022).mul(readable);
            body.addAssign(vec3(0.6, 0.79, 0.5).mul(carving));
            const ridge = smoothstep(0.14, 0.92, tip);
            const crest = mix(vec3(0.015, 0.2, 0.14), vec3(0.52, 0.30, 0.075), ridge.mul(ridge));
            const horn = mix(vec3(0.31, 0.205, 0.086), vec3(0.83, 0.65, 0.35), ridge);
            const enamel = mix(vec3(0.029, 0.08, 0.062), vec3(0.98, 0.58, 0.086), smoothstep(0.20, 0.42, tip));
            const pupil = smoothstep(0.055, 0.16, abs(tip.sub(0.56))).oneMinus();
            const eye = mix(enamel, vec3(0.008, 0.027, 0.026), pupil);
            const albedo = mix(body, crest, step(0.5, part)).toVar();
            albedo.assign(mix(albedo, horn, step(1.5, part)));
            albedo.assign(mix(albedo, vec3(0.47, 0.31, 0.125), step(2.5, part)));
            albedo.assign(mix(albedo, eye, step(3.5, part)));
            albedo.assign(mix(albedo, vec3(0.145, 0.35, 0.235), step(4.5, part)));
            const under = smoothstep(-0.024, 0.03, point.y).oneMinus();
            const gathered = mix(float(1), clamp(light.caustic(point), 0.6, 1.65), under.mul(0.46));
            const wrap = clamp(dot(normal, u.moonDir).mul(0.53).add(0.58), 0.22, 1.0);
            const diffuse = mix(vec3(0.86, 0.92, 0.87), u.moonColor, 0.36).mul(wrap.mul(0.74).add(0.27)).mul(gathered);
            const half = normalize(u.moonDir.add(view));
            const gloss = pow(max(dot(normal, half), 0.0), 27.0);
            const rim = abs(dot(normal, view)).oneMinus().clamp(0.0, 1.0).pow2();
            const moving = sin(f.mul(17.0).sub(u.time.mul(3.0)).add(this.uPulse)).mul(0.5).add(0.5);
            const edge = vec3(0.12, 0.32, 0.24).mul(rim.mul(0.35)).add(gold.mul(gloss.mul(0.24)));
            const colour = albedo.mul(diffuse.add(u.skyAmbient).add(light.lantern(point, normal)))
                .add(edge).add(albedo.mul(moving.mul(0.10).add(u.glow.mul(0.095))));
            return vec4(colour.mul(this.uPresence).mul(u.breath.mul(0.45).add(0.55)), 1);
        });

        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'Koi Pond — the dragon';
        material.positionNode = place;
        material.fragmentNode = paint();
        this.material = material;
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.name = 'Koi Pond — the dragon';
        this.mesh.frustumCulled = false;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = false;
        // Always drawn (with nothing to it while it sleeps), so that the first long chain does
        // not stall the game compiling its pipeline.
    }

    reset() {
        this.theta = 0.6;
        this.presence = 0;
        this.arch = 0;
        this.uPresence.value = 0;
    }

    /**
     * Advance the dragon.
     * @param {number} dt
     * @param {number} time
     * @param {number} wanted   0..1: how present it should be
     * @param {number} haste    0..1: how hard it swims
     * @param {number} arch     0..1: how high it throws its arches (a four-line clear)
     */
    step(dt, time, wanted, haste = 0, arch = 0) {
        this.presence += (wanted - this.presence) * (1 - Math.exp(-dt * (wanted > this.presence ? 1.1 : 0.7)));
        if (this.presence < 0.004 && wanted <= 0) {
            this.presence = 0;
            this.uPresence.value = 0;
            return;
        }
        this.arch += (arch - this.arch) * (1 - Math.exp(-dt * 2.2));
        const speed = 1.55 + haste * 1.1;
        this.theta += (speed / 2.7) * dt;
        this.time = time;
        this.write();
    }

    /** Lay the spine along the ring behind the head. */
    write() {
        const { segments, spine } = this;
        const stepAngle = SPINE_STEP / 2.7;
        const sunk = (1 - clamp01(this.presence)) ** 2 * 2.4;
        for (let i = 0; i < segments; i += 1) {
            const f = i / (segments - 1);
            const p = dragonPath(this.theta - i * stepAngle, this.time || 0, this._p);
            // A four-line clear: the arches rear out of the water.
            const reared = this.arch * 0.75 * Math.max(0, Math.sin((this.theta - i * stepAngle) * 4 + 0.9));
            spine[i].set(p[0], p[1] + reared - sunk, p[2], dragonGirth(f));
        }
        this.uPresence.value = clamp01(this.presence);
    }

    /** The head's place on the pond, and every `stride`-th point of the body (x, y, z). */
    point(i, out) {
        const v = this.spine[Math.max(0, Math.min(this.segments - 1, i))];
        out[0] = v.x;
        out[1] = v.y;
        out[2] = v.z;
        return out;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
