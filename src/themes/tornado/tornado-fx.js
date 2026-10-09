/**
 * Tornado — the lights of play: the sparks a locked piece feeds the funnel, and lightning.
 *
 * SPARKS. A locked piece throws a handful of sparks in its own colour from the card's edge, at
 * the piece's height. They are flown in the vertex stage: out over the field on a curve, into
 * the foot of the funnel, then wound up it and gone. Nothing is simulated: each spark's place
 * is a function of the flight's start time, so a frozen clock replays it exactly.
 *
 * LIGHTNING. A clear calls channels down from the cloud base. A channel is a strip of quads that
 * faces the eye, its points a random walk written when it strikes; its light is one number the
 * world plays (a first stroke and return strokes).
 */
import * as THREE from 'three/webgpu';
import {
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    exp,
    float,
    int,
    length,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import { TAU, WORLD, boltPath } from './tornado-core.js';
import {
    BOLTS, FLIGHTS, funnelCentreNode, funnelRadiusNode,
} from './tornado-tsl.js';

function createMotes({ u, tier }) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.attributes.position);
    geometry.setAttribute('uv', base.attributes.uv);
    const per = tier.motes;
    const count = per * FLIGHTS;
    const data = new Float32Array(count * 4);
    let seed = 99;
    const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    for (let i = 0; i < count; i += 1) {
        data[i * 4] = Math.floor(i / per);
        data[i * 4 + 1] = rand();
        data[i * 4 + 2] = rand();
        data[i * 4 + 3] = rand();
    }
    geometry.setAttribute('aMote', new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = count;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    const m = attribute('aMote', 'vec4');
    const slot = int(m.x.mul(2.0).add(0.5));
    const flight = u.flights.element(slot); // (origin, start)
    const paint = u.flights.element(slot.add(1)); // (rgb, power)
    const age = u.time.sub(flight.w).sub(m.y.mul(0.5));
    const span = m.z.mul(0.6).add(1.1);
    // Where it meets the funnel: low on the stem, somewhere round it.
    const meetH = m.w.mul(0.09).add(0.015);
    const meetAng = m.y.add(u.spin).mul(TAU);
    const meet = funnelCentreNode(u, meetH)
        .add(vec3(cos(meetAng), 0.0, sin(meetAng)).mul(funnelRadiusNode(u, meetH).mul(1.06)));
    const origin = flight.xyz;
    const sideways = normalize(cross(vec3(0.0, 1.0, 0.0), meet.sub(origin)));
    const high = mix(origin, meet, 0.4)
        .add(vec3(0.0, m.z.mul(46.0).add(12.0), 0.0))
        .add(sideways.mul(m.w.sub(0.5).mul(120.0)));
    /** The spark's place `back` seconds ago: out over the field, then wound up the stem. */
    const placeAt = (back) => {
        const at = age.sub(back);
        const f = clamp(at.div(span), 0.0, 1.0);
        const eased = f.mul(f);
        const flying = mix(mix(origin, high, eased), mix(high, meet, eased), eased);
        const wound = clamp(at.sub(span).div(2.4), 0.0, 1.0);
        const woundH = meetH.add(wound.mul(0.55));
        const woundAng = meetAng.add(wound.mul(m.z.mul(5.0).add(5.0)));
        const riding = funnelCentreNode(u, woundH)
            .add(vec3(cos(woundAng), 0.0, sin(woundAng)).mul(funnelRadiusNode(u, woundH).mul(1.04)));
        return mix(flying, riding, step(span, at));
    };
    // A streak from where it was a moment ago to where it is.
    const head = placeAt(float(0.0));
    const tail = placeAt(float(0.075));
    const alive = step(0.0, age)
        .mul(smoothstep(span.add(1.5), span.add(2.4), age).oneMinus())
        .mul(step(0.001, paint.w));
    const pixels = m.z.mul(1.7).add(1.9).mul(paint.w.mul(0.4).add(0.8));
    const centre = mix(tail, head, positionGeometry.x.add(0.5));
    const toEye = cameraPosition.sub(centre);
    const run = head.sub(tail).add(vec3(0.0, 1e-4, 0.0));
    const runDir = normalize(run);
    const aside = normalize(cross(runDir, toEye));
    const width = length(toEye).mul(u.pixelAngle).mul(pixels).mul(alive);
    material.positionNode = centre
        .add(runDir.mul(positionGeometry.x.mul(2.0)).mul(width))
        .add(aside.mul(positionGeometry.y.mul(2.0)).mul(width));

    const light = varying(vec4(paint.rgb.mul(paint.w), alive));
    const twinkle = varying(sin(u.time.mul(m.w.mul(20.0).add(14.0)).add(m.y.mul(40.0))).mul(0.3).add(0.85));
    const along = clamp(uv().x, 0.0, 1.0);
    const across = clamp(uv().y.sub(0.5).mul(2.0), -1.0, 1.0);
    const core = exp(across.mul(across).mul(-4.5)).mul(along.mul(along)).mul(smoothstep(0.0, 0.08, along.oneMinus()));
    material.outputNode = vec4(light.rgb.mul(core).mul(twinkle).mul(light.a).mul(4.2), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 60;
    mesh.name = 'tornado-motes';
    return { mesh, base };
}

/** The burst where a lock's sparks leave the card: a soft heart and a ring that opens. */
function createLaunch({ u }) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.setAttribute('position', base.attributes.position);
    geometry.setAttribute('uv', base.attributes.uv);
    const slots = new Float32Array(FLIGHTS);
    for (let i = 0; i < FLIGHTS; i += 1) slots[i] = i;
    geometry.setAttribute('aLaunch', new THREE.InstancedBufferAttribute(slots, 1));
    geometry.instanceCount = FLIGHTS;
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    const slot = int(attribute('aLaunch', 'float').mul(2.0).add(0.5));
    const flight = u.flights.element(slot);
    const paint = u.flights.element(slot.add(1));
    const age = u.time.sub(flight.w);
    const live = step(0.0, age).mul(step(age, 0.7)).mul(step(0.001, paint.w));
    const pixels = age.mul(150.0).add(26.0).mul(paint.w.mul(0.3).add(0.8));
    const size = length(flight.xyz.sub(cameraPosition)).mul(u.pixelAngle).mul(pixels).mul(live);
    material.positionNode = flight.xyz
        .add(u.camRight.mul(positionGeometry.x).add(u.camUp.mul(positionGeometry.y)).mul(size));
    const light = varying(vec4(paint.rgb, exp(age.mul(-6.5)).mul(live).mul(paint.w)));
    const away = uv().sub(0.5).mul(2.0);
    const r = clamp(away.dot(away), 0.0, 1.0).sqrt();
    const heart = exp(r.mul(r).mul(-7.0));
    const ring = exp(r.sub(0.74).mul(r.sub(0.74)).mul(-110.0));
    const shape = heart.mul(1.5).add(ring.mul(0.8)).mul(smoothstep(0.86, 1.0, r).oneMinus());
    material.outputNode = vec4(light.rgb.mul(shape).mul(light.a).mul(2.6), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 61;
    mesh.name = 'tornado-launch';
    return { mesh, base };
}

/** Points per channel: the trunk, then two branches. */
const TRUNK = 30;
const BRANCH = 11;
const POINTS = TRUNK + BRANCH * 2;

function createBolts({ u }) {
    const verts = BOLTS * POINTS * 2;
    const position = new Float32Array(verts * 3);
    const dir = new Float32Array(verts * 3);
    const side = new Float32Array(verts * 3); // (side, thickness, channel)
    const index = [];
    for (let b = 0; b < BOLTS; b += 1) {
        const strips = [[0, TRUNK], [TRUNK, BRANCH], [TRUNK + BRANCH, BRANCH]];
        strips.forEach(([first, n]) => {
            for (let i = 0; i < n; i += 1) {
                const p = b * POINTS + first + i;
                const t = i / (n - 1);
                for (let s = 0; s < 2; s += 1) {
                    const v = p * 2 + s;
                    side[v * 3] = s === 0 ? -1 : 1;
                    side[v * 3 + 1] = first === 0 ? 1 - t * 0.35 : 0.5 * (1 - t);
                    side[v * 3 + 2] = b;
                }
                if (i < n - 1) {
                    const o = p * 2;
                    index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
                }
            }
        });
    }
    const geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(position, 3);
    const dirAttr = new THREE.BufferAttribute(dir, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    dirAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('aDir', dirAttr);
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 3));
    geometry.setIndex(index);

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    const aDir = attribute('aDir', 'vec3');
    const aSide = attribute('aSide', 'vec3');
    const toEye = cameraPosition.sub(positionGeometry);
    const aside = normalize(cross(aDir, toEye));
    const light = u.bolts.element(int(aSide.z.add(0.5))).x;
    // Pixels wide at any range, a little wider while the stroke is at its brightest.
    const width = length(toEye).mul(u.pixelAngle).mul(aSide.y).mul(float(2.6).add(light.mul(1.2)));
    material.positionNode = positionGeometry.add(aside.mul(aSide.x).mul(width));
    const acrossV = varying(aSide.x);
    const power = varying(light.mul(aSide.y.mul(0.6).add(0.4)));
    const off = clamp(acrossV, -1.0, 1.0);
    const profile = exp(off.mul(off).mul(-5.0));
    const stroke = mix(u.bolt, vec3(1.0, 1.0, 1.0), profile.mul(0.6)).mul(profile).mul(power);
    material.outputNode = vec4(stroke.mul(26.0), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 62;
    mesh.name = 'tornado-bolts';

    const scratch = new Float32Array(TRUNK * 3);
    const branch = new Float32Array(BRANCH * 3);
    const writeStrip = (first, pts, n) => {
        for (let i = 0; i < n; i += 1) {
            const a = Math.max(0, i - 1);
            const c = Math.min(n - 1, i + 1);
            let dx = pts[c * 3] - pts[a * 3];
            let dy = pts[c * 3 + 1] - pts[a * 3 + 1];
            let dz = pts[c * 3 + 2] - pts[a * 3 + 2];
            const len = Math.hypot(dx, dy, dz) || 1;
            dx /= len;
            dy /= len;
            dz /= len;
            for (let s = 0; s < 2; s += 1) {
                const v = ((first + i) * 2 + s) * 3;
                position[v] = pts[i * 3];
                position[v + 1] = pts[i * 3 + 1];
                position[v + 2] = pts[i * 3 + 2];
                dir[v] = dx;
                dir[v + 1] = dy;
                dir[v + 2] = dz;
            }
        }
    };

    return {
        mesh,
        /** Write channel `slot` down onto (x, z). */
        strike(slot, x, z, rand) {
            const first = slot * POINTS;
            const top = [x + (rand() - 0.5) * 150, WORLD.cloudBase * 0.99, z + (rand() - 0.5) * 150];
            boltPath(rand, top, [x, 0, z], 8 + rand() * 7, TRUNK, scratch);
            writeStrip(first, scratch, TRUNK);
            for (let k = 0; k < 2; k += 1) {
                const at = Math.floor(TRUNK * (0.22 + rand() * 0.3));
                const from = [scratch[at * 3], scratch[at * 3 + 1], scratch[at * 3 + 2]];
                const reach = 70 + rand() * 90;
                const turn = rand() * TAU;
                const to = [
                    from[0] + Math.cos(turn) * reach,
                    from[1] * (0.35 + rand() * 0.3),
                    from[2] + Math.sin(turn) * reach,
                ];
                boltPath(rand, from, to, 6, BRANCH, branch);
                writeStrip(first + TRUNK + k * BRANCH, branch, BRANCH);
            }
            positionAttr.needsUpdate = true;
            dirAttr.needsUpdate = true;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export function createFx({ u, tier }) {
    const motes = createMotes({ u, tier });
    const launch = createLaunch({ u });
    const bolts = createBolts({ u });
    // One part: the bursts and the sparks they throw (the order sits on the meshes, not the group).
    const sparks = new THREE.Group();
    sparks.name = 'tornado-sparks';
    sparks.add(motes.mesh, launch.mesh);
    return {
        motes: sparks,
        bolts: bolts.mesh,
        strike: bolts.strike,
        dispose() {
            [motes, launch].forEach((part) => {
                part.mesh.geometry.dispose();
                part.base.dispose();
                part.mesh.material.dispose();
            });
            bolts.dispose();
        },
    };
}
