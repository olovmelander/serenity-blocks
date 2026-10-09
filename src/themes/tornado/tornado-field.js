/**
 * Tornado — the prairie: the field to the horizon, the wheat round the lens, the power line.
 *
 * The ground is one disc shaded per pixel: wheat lit by the low sun that shines in under the
 * storm, gusts crossing it as pale sheen, the funnel's long shadow lying away from the sun, the
 * gust rings a locked piece sends out and the dust front of a four-line clear. Round the lens the
 * same field is real geometry: stalks with ears, bent toward the funnel by the inflow and laid
 * flat by the same rings, so the picture has a foreground that moves.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { WORLD, mulberry32 } from './tornado-core.js';
import {
    FLASHES, RINGS, funnelCentreNode, noiseAt, tnGauss,
} from './tornado-tsl.js';

/** How far the stalks reach from the lens, metres. */
export const WHEAT_REACH = 58;
const WHEAT_NEAR = 1.3;

/** The gust rings' light and push at a ground point: (rgb glow, push 0..1). */
function ringsAt(u, p) {
    // A plain sum (no variables): the stalks build this in the vertex stage outside any Fn.
    let glow = vec3(0.0);
    let push = float(0.0);
    for (let i = 0; i < RINGS; i += 1) {
        const shape = u.rings.element(i * 2); // (x, z, radius, strength)
        const paint = u.rings.element(i * 2 + 1); // (rgb, width)
        const front = tnGauss(length(p.sub(shape.xy)).sub(shape.z).div(max(paint.w, 0.5))).mul(shape.w);
        glow = glow.add(paint.rgb.mul(front));
        push = push.add(front);
    }
    return { glow, push };
}

/** The dust front of a four-line clear: 0..1 at a ground point. */
function shockAt(u, p) {
    const fromFoot = length(p.sub(u.axis.xz));
    return tnGauss(fromFoot.sub(u.shock.x).div(u.shock.x.mul(0.06).add(26.0))).mul(u.shock.y);
}

function createGround({ u, noise }) {
    const geometry = new THREE.CircleGeometry(12000, 48);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.fragmentNode = Fn(() => {
        const p = positionWorld.xz.toVar();
        const far = length(positionWorld.sub(cameraPosition)).toVar();
        const sunXZ = normalize(u.sunDir.xz).toVar();

        // Gusts: pale sheen where the stalks lean and show their undersides.
        const g1 = texture(noise, p.div(95.0).add(u.gust)).r;
        const g2 = texture(noise, p.div(24.0).add(u.gust.mul(2.3))).g;
        const sheen = smoothstep(0.42, 0.8, g1).mul(g2.mul(0.5).add(0.5)).toVar();
        const grain = texture(noise, p.div(3.3)).a;
        // Cloud shadow: the deck lets the sun through in patches.
        const patch = texture(noise, p.div(1500.0).add(u.gust.mul(0.02))).b;
        const light = smoothstep(0.2, 0.75, patch).mul(0.55).add(0.45).mul(grain.mul(0.45).add(0.6))
            .toVar();
        light.addAssign(sheen.mul(0.3));

        // The funnel's shadow, lying away from the sun and widening.
        const rel = p.sub(funnelCentreNode(u, float(0.0)).xz).toVar();
        const along = dot(rel, sunXZ).negate().toVar();
        const across = rel.x.mul(sunXZ.y).sub(rel.y.mul(sunXZ.x));
        const width = along.mul(0.1).add(float(WORLD.radiusGround).mul(u.girth).mul(1.4));
        const shadow = smoothstep(0.0, 60.0, along).mul(tnGauss(across.div(width))).mul(exp(along.div(-1900.0)));
        light.mulAssign(shadow.mul(-0.72).add(1.0));

        const col = mix(u.wheatShade, u.wheatLit, clamp(light, 0.0, 1.3)).toVar();
        col.mulAssign(smoothstep(22.0, 62.0, far).mul(0.55).add(0.45));
        // Dust thickens toward the foot.
        col.assign(mix(col, u.dust.mul(0.8), exp(length(rel).div(-150.0)).mul(0.6)));

        const ring = ringsAt(u, p);
        col.addAssign(ring.glow.mul(0.22).add(u.wheatLit.mul(ring.push).mul(0.2)));
        const shock = shockAt(u, p);
        col.assign(mix(col, u.dust.mul(1.5).add(u.sun.mul(0.12)), clamp(shock, 0.0, 1.0).mul(0.8)));
        for (let i = 0; i < FLASHES; i += 1) {
            const f = u.flashes.element(i);
            const lit = exp(length(p.sub(f.xy)).div(max(f.w.mul(1.2), 1.0)).negate()).mul(f.z);
            col.addAssign(u.bolt.mul(lit).mul(0.13));
        }
        col.assign(mix(col, u.haze, exp(far.div(-2600.0)).oneMinus()));
        return vec4(col, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.name = 'tornado-ground';
    return mesh;
}

function createWheat({ u, noise, tier }) {
    // One stalk: a strip five rows tall, widened into an ear near the top.
    const rowsUp = 5;
    const positions = [];
    const index = [];
    for (let r = 0; r <= rowsUp; r += 1) {
        positions.push(-0.5, r / rowsUp, 0, 0.5, r / rowsUp, 0);
        if (r < rowsUp) {
            const o = r * 2;
            index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    const count = tier.wheat;
    const rand = mulberry32(4242);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
        // Dense underfoot, thinning with distance; a fan in front of the lens.
        const r = WHEAT_NEAR * (WHEAT_REACH / WHEAT_NEAR) ** rand();
        const a = (rand() - 0.5) * 2.05;
        data[i * 4] = Math.sin(a) * r;
        data[i * 4 + 1] = -Math.cos(a) * r;
        data[i * 4 + 2] = 0.78 + rand() * 0.34;
        data[i * 4 + 3] = rand();
    }
    geometry.setAttribute('aStalk', new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = count;

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    const stalk = attribute('aStalk', 'vec4');
    const root = vec2(stalk.x, stalk.y);
    const { y } = positionGeometry;
    const seed = stalk.w;
    const range = length(root);

    const gustRead = noiseAt(noise, root.div(95.0).add(u.gust)).r;
    const gust = smoothstep(0.35, 0.8, gustRead);
    const ring = ringsAt(u, root);
    const shock = shockAt(u, root);
    // Toward the funnel with the inflow, each stalk turned a little its own way.
    const inflow = normalize(u.axis.xz.sub(root));
    const stray = fract(seed.mul(13.7)).sub(0.5).mul(1.5);
    const toFunnel = vec2(
        inflow.x.mul(cos(stray)).sub(inflow.y.mul(sin(stray))),
        inflow.x.mul(sin(stray)).add(inflow.y.mul(cos(stray))),
    );
    const lean = float(0.12).add(gust.mul(0.5)).add(u.fury.mul(0.45)).mul(fract(seed.mul(5.3)).mul(0.9).add(0.55))
        .add(ring.push.mul(0.9))
        .add(shock.mul(1.4));
    const sway = sin(u.wind.mul(3.1).add(seed.mul(40.0)).add(stalk.x.mul(0.7))).mul(0.08);
    const bend = clamp(lean.add(sway), 0.0, 1.5);
    const tall = stalk.z.mul(smoothstep(WHEAT_REACH * 0.72, WHEAT_REACH, range).oneMinus());
    const tip = y.mul(y).mul(tall);
    // The ear: a bulge near the top; stalks further off are drawn wider so the field stays full.
    const ear = smoothstep(0.58, 0.8, y).mul(smoothstep(0.92, 1.0, y).mul(-0.75).add(1.0));
    const widthAt = float(0.0035).add(ear.mul(0.0125)).mul(range.mul(0.075).add(1.0));
    const across = normalize(vec3(u.camRight.x, 0.0, u.camRight.z));
    material.positionNode = vec3(root.x, 0.0, root.y)
        .add(across.mul(positionGeometry.x.mul(widthAt)))
        .add(vec3(0.0, y.mul(tall).mul(bend.mul(bend).mul(-0.26).add(1.0)), 0.0))
        .add(vec3(toFunnel.x, 0.0, toFunnel.y).mul(tip.mul(bend).mul(0.8)));

    const tone = varying(vec3(gust, ring.push.add(shock), seed));
    const earAt = varying(ear);
    const ringGlow = varying(ring.glow);
    material.fragmentNode = Fn(() => {
        const far = length(positionWorld.sub(cameraPosition));
        // Dark between the stalks, the ears catching the low sun from behind.
        const lift = smoothstep(0.25, 1.0, clamp(y, 0.0, 1.0)).mul(tone.z.mul(0.5).add(0.5))
            .mul(clamp(abs(positionGeometry.x).mul(2.0), 0.0, 1.0).mul(-0.35).add(1.0));
        const col = mix(u.wheatShade.mul(0.85), u.wheatLit.mul(1.05), lift).toVar();
        col.mulAssign(mix(vec3(0.86, 1.0, 0.78), vec3(1.12, 0.94, 0.8), fract(tone.z.mul(7.31))));
        col.mulAssign(tone.x.mul(0.6).add(0.7));
        col.addAssign(u.sun.mul(clamp(earAt, 0.0, 1.0)).mul(tone.z.mul(0.12).add(0.1)));
        col.addAssign(ringGlow.mul(0.22).mul(lift).add(u.wheatLit.mul(tone.y).mul(0.18)));
        col.assign(mix(col, u.haze, exp(far.div(-2600.0)).oneMinus()));
        return vec4(col, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    mesh.name = 'tornado-wheat';
    return mesh;
}

/**
 * A power line running out across the field toward the horizon right of the card: poles with a
 * cross-arm, wires sagging between them. Dark against the gap, for scale.
 */
function createPoles({ u, tier }) {
    const parts = [];
    const poleHeight = 11;
    const start = new THREE.Vector3(34, 0, -46);
    const step = new THREE.Vector3(26, 0, -92);
    const tops = [];
    for (let i = 0; i < tier.poles; i += 1) {
        const base = start.clone().addScaledVector(step, i);
        const tilt = (i % 3 === 1 ? 0.04 : -0.02) * (i + 1) * 0.4;
        const pole = new THREE.BoxGeometry(0.34, poleHeight, 0.34);
        pole.translate(0, poleHeight / 2, 0);
        pole.rotateZ(tilt);
        pole.translate(base.x, 0, base.z);
        const arm = new THREE.BoxGeometry(3.2, 0.22, 0.22);
        arm.translate(0, poleHeight - 0.9, 0);
        arm.rotateZ(tilt);
        arm.rotateY(0.28);
        arm.translate(base.x, 0, base.z);
        parts.push(pole, arm);
        tops.push(new THREE.Vector3(base.x - Math.sin(tilt) * (poleHeight - 0.9), poleHeight - 0.8, base.z));
    }
    // Wires: thin sagging strips between neighbouring tops (three per span).
    for (let i = 0; i + 1 < tops.length; i += 1) {
        for (let w = -1; w <= 1; w += 1) {
            const a = tops[i].clone().add(new THREE.Vector3(w * 1.35, 0, w * 0.38));
            const b = tops[i + 1].clone().add(new THREE.Vector3(w * 1.35, 0, w * 0.38));
            const segments = 8;
            const pts = [];
            for (let s = 0; s <= segments; s += 1) {
                const t = s / segments;
                const pt = a.clone().lerp(b, t);
                pt.y -= Math.sin(t * Math.PI) * 1.5;
                pts.push(pt);
            }
            const wire = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segments, 0.035 + i * 0.012, 3, false);
            parts.push(wire);
        }
    }
    // Merge by hand: positions only (the material needs nothing else).
    let total = 0;
    parts.forEach((g) => {
        total += (g.index ? g.index.count : g.attributes.position.count);
    });
    const merged = new Float32Array(total * 3);
    let o = 0;
    parts.forEach((g) => {
        const pos = g.attributes.position;
        const put = (vi) => {
            merged[o] = pos.getX(vi);
            merged[o + 1] = pos.getY(vi);
            merged[o + 2] = pos.getZ(vi);
            o += 3;
        };
        if (g.index) for (let i = 0; i < g.index.count; i += 1) put(g.index.getX(i));
        else for (let i = 0; i < pos.count; i += 1) put(i);
        g.dispose();
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3));
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.fragmentNode = Fn(() => {
        const far = length(positionWorld.sub(cameraPosition));
        const col = mix(vec3(0.012, 0.011, 0.012), u.haze, exp(far.div(-2600.0)).oneMinus());
        return vec4(col, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 14;
    mesh.name = 'tornado-poles';
    return mesh;
}

export function createField({ u, noise, tier }) {
    const ground = createGround({ u, noise });
    const wheat = createWheat({ u, noise, tier });
    const poles = createPoles({ u, tier });
    return {
        ground,
        wheat,
        poles,
        dispose() {
            [ground, wheat, poles].forEach((m) => {
                m.geometry.dispose();
                m.material.dispose();
            });
        },
    };
}
