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
    Fn, abs, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, int, length, max, mix, normalize,
    positionWorld, pow, sin, smoothstep, step, uniform, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    TAU, clamp01, smooth, waterDepth,
} from './koi-pond-core.js';
import { CHAIN_GOLD } from './koi-pond-light.js';

// ── The dragon ──────────────────────────────────────────────────────────────────────────────

/** Metres between the spine's points. */
const SPINE_STEP = 0.115;
const BODY_SIDES = 10;
const WHISKER_REACH = 16;

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
    const head = 0.085 + 0.115 * smooth(0, 0.03, f) - 0.05 * smooth(0.045, 0.1, f);
    const body = 0.125 * smooth(0.06, 0.16, f) * (1 - smooth(0.55, 1, f) ** 1.4 * 0.86);
    return Math.max(head * (1 - smooth(0.05, 0.12, f)), body) + 0.012;
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
        // Vertices carry: which spine point (aRib.x), where round the body (aRib.y, radians),
        // what they are (aRib.z: 0 skin, 1 mane, 2 whisker) and a 0..1 spread (aRib.w).
        const ribs = [];
        const indices = [];
        const add = (seg, around, kind, spread) => {
            ribs.push(seg, around, kind, spread);
            return ribs.length / 4 - 1;
        };
        for (let i = 0; i < segments; i += 1) {
            for (let k = 0; k < BODY_SIDES; k += 1) add(i, (k / BODY_SIDES) * TAU, 0, 0);
        }
        for (let i = 0; i < segments - 1; i += 1) {
            for (let k = 0; k < BODY_SIDES; k += 1) {
                const a = i * BODY_SIDES + k;
                const b = i * BODY_SIDES + ((k + 1) % BODY_SIDES);
                indices.push(a, a + BODY_SIDES, b, b, a + BODY_SIDES, b + BODY_SIDES);
            }
        }
        // The mane: a ribbon standing on the back, from the crown to the tail.
        const maneStart = ribs.length / 4;
        for (let i = 2; i < segments; i += 1) {
            add(i, 0, 1, 0);
            add(i, 0, 1, 1);
        }
        for (let i = 0; i < segments - 3; i += 1) {
            const a = maneStart + i * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        // Two whiskers from the snout, trailing back along the body.
        [-1, 1].forEach((sideSign) => {
            const start = ribs.length / 4;
            for (let i = 0; i < WHISKER_REACH; i += 1) {
                add(1 + i, sideSign, 2, 0);
                add(1 + i, sideSign, 2, 1);
            }
            for (let i = 0; i < WHISKER_REACH - 1; i += 1) {
                const a = start + i * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        });
        const geometry = new THREE.BufferGeometry();
        // (Positions are made in the vertex shader; the attribute only has to exist.)
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ribs.length / 4) * 3), 3));
        geometry.setAttribute('aRib', new THREE.BufferAttribute(new Float32Array(ribs), 4));
        geometry.setIndex(indices);
        this.geometry = geometry;

        const aRib = attribute('aRib', 'vec4');
        const { spineNode } = this;
        const last = segments - 1;
        const frame = () => {
            const i = floor(aRib.x.add(0.5)).toInt();
            const here = spineNode.element(i);
            const ahead = spineNode.element(max(i.sub(int(1)), int(0)));
            const behind = spineNode.element(clamp(i.add(int(1)), int(0), int(last)));
            const tangent = normalize(ahead.xyz.sub(behind.xyz).add(vec3(1e-4, 0, 0)));
            const side = normalize(cross(tangent, vec3(0, 1, 0)).add(vec3(0, 0, 1e-4)));
            const lift = normalize(cross(side, tangent));
            return {
                here, tangent, side, lift,
            };
        };
        const along = () => aRib.x.div(last);

        const place = Fn(() => {
            const {
                here, tangent, side, lift,
            } = frame();
            const f = along();
            const isSkin = step(aRib.z, 0.5);
            const isMane = step(0.5, aRib.z).mul(step(aRib.z, 1.5));
            const isWhisker = step(1.5, aRib.z);
            const grow = this.uPresence.sqrt();
            const radius = here.w.mul(grow);
            // Skin: an oval section, a little deeper than wide.
            const skin = side.mul(cos(aRib.y).mul(radius)).add(lift.mul(sin(aRib.y).mul(radius).mul(1.12)));
            // Mane: tall on the neck, low along the back, a fan again at the tail; it streams.
            const tall = float(0.3).mul(exp(f.mul(-9.0))).add(0.075).add(smoothstep(0.82, 1.0, f).mul(0.24))
                .mul(grow);
            const wave = sin(f.mul(40.0).sub(u.time.mul(5.0))).mul(0.045).mul(aRib.w);
            const mane = lift.mul(radius.mul(0.9).add(tall.mul(aRib.w))).add(side.mul(wave)).sub(tangent.mul(aRib.w.mul(tall).mul(0.5)));
            // Whiskers: out from the lip, then streaming back along the flanks.
            const k = aRib.x.sub(1.0).div(WHISKER_REACH);
            const reach = float(0.14).add(k.mul(0.42)).add(sin(k.mul(7.0).sub(u.time.mul(3.4))).mul(0.06).mul(k));
            const whisker = side.mul(aRib.y.mul(reach).mul(grow)).add(lift.mul(aRib.w.mul(0.022).sub(k.mul(0.05))));
            const offset = skin.mul(isSkin).add(mane.mul(isMane)).add(whisker.mul(isWhisker));
            return here.xyz.add(offset);
        })();
        const vNormal = varying(Fn(() => {
            const { side, lift } = frame();
            const round = side.mul(cos(aRib.y)).add(lift.mul(sin(aRib.y)));
            return normalize(mix(side, round, step(aRib.z, 0.5)));
        })(), 'vDragonNormal');
        const vRib = varying(aRib, 'vDragonRib');

        const paint = Fn(() => {
            const point = positionWorld.toVar();
            const f = vRib.x.div(last);
            const around = vRib.y;
            const kind = vRib.z;
            const isSkin = step(kind, 0.5).toVar();
            const normal = normalize(vNormal).toVar();
            const view = normalize(cameraPosition.sub(point)).toVar();
            // Scales: plates in offset rows, each a pearl with a gold edge.
            const row = vRib.x.mul(1.7);
            const col = around.div(TAU).mul(11.0).add(floor(row).mul(0.5));
            const plate = vec2(fract(col), fract(row));
            const edge = smoothstep(0.0, 0.3, plate.x).mul(smoothstep(0.0, 0.3, plate.x.oneMinus())).mul(smoothstep(0.0, 0.42, plate.y));
            // Pearl-jade along the back, gold under the belly.
            const belly = smoothstep(0.2, -0.75, sin(around));
            const pearl = mix(vec3(0.06, 0.5, 0.4), vec3(0.3, 0.92, 0.72), edge);
            const gold = vec3(...CHAIN_GOLD);
            const skin = mix(mix(gold.mul(1.25), pearl, edge.mul(0.85).add(0.1)), gold.mul(1.2), belly.mul(0.8));
            const ribbon = mix(gold.mul(1.5), vec3(1.0, 0.95, 0.8), vRib.w);
            const body = mix(ribbon, skin, isSkin);
            // Light runs down the body from the head, pulse after pulse.
            const run = sin(f.mul(26.0).sub(u.time.mul(4.2)).add(this.uPulse)).mul(0.5).add(0.5);
            const rim = pow(float(1.0).sub(clamp(abs(dot(normal, view)), 0.0, 1.0)), 2.0);
            // Its eyes: one either side of the crown.
            const eyeAcross = abs(abs(around.sub(Math.PI * 0.5)).sub(0.85));
            const eye = float(1.0).sub(smoothstep(0.1, 0.24, length(vec2(vRib.x.sub(2.3).mul(0.42), eyeAcross)))).mul(isSkin);
            const under = smoothstep(0.012, -0.012, point.y);
            const gathered = mix(float(1.0), light.caustic(point), under);
            const burn = float(0.5).add(run.mul(0.45)).add(rim.mul(0.9)).add(u.glow.mul(0.3));
            const colour = body.mul(burn).mul(mix(float(1.25), gathered.mul(0.5).add(0.6), under))
                .add(vec3(1.0, 0.92, 0.7).mul(eye.mul(7.0)));
            return vec4(colour.mul(this.uPresence).mul(u.breath.mul(0.5).add(0.5)), 1.0);
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
