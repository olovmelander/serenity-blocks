/**
 * Voltage Storm — the collector towers.
 *
 * A tower is a lattice mast that narrows as it climbs, a stack of capacitor rings round its upper
 * third, a toroid electrode over an insulator column and a finial where lightning strikes; guy
 * wires run from its waist into the water. It is generated here, one unit tall, and instanced
 * (the plan gives each its place and height), so the silhouette is the same at every tier.
 *
 * The towers are the board's instrument. A lock's charge lights a tower's rings from the bottom
 * up in the piece's colour and they hold it; a strike turns every ring white, then dark. The
 * metal itself is nearly black: at rest a tower is a silhouette against the strip of clear sky,
 * and a stroke is what shows its structure.
 *
 * Two meshes share the geometry: the towers, and their images in the water (the same vertices
 * turned upside down in the vertex stage, drawn "over" the water with a shimmer).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    instanceIndex,
    int,
    length,
    max,
    mix,
    normalLocal,
    normalize,
    positionGeometry,
    positionLocal,
    pow,
    reflect,
    sin,
    smoothstep,
    step,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    STORM, TOWER, TOWER_MAX, TOWER_RINGS, vsFxMaterial, vsPart, vsQuadGeometry,
} from './voltage-storm-tsl.js';

/** Vertex "part" ids: what a vertex belongs to. */
export const TOWER_PART = Object.freeze({
    steel: 0, electrode: 1, finial: 2, ring: 3,
});

/** Half the lattice's width at a height (fraction of the tower's height). */
export function latticeHalf(y) {
    const t = Math.max(0, Math.min(1, y / TOWER.mast));
    return TOWER.neckHalf + (TOWER.footHalf - TOWER.neckHalf) * (1 - t) ** 1.7;
}

/** The storeys' heights: tall at the foot, short under the electrode. */
export function latticeLevels(storeys = 9) {
    const levels = [];
    for (let i = 0; i <= storeys; i++) levels.push(TOWER.mast * (1 - (1 - i / storeys) ** 1.35));
    return levels;
}

/** The height of capacitor ring `k`. */
export function ringHeight(k) {
    return TOWER.ringLo + ((TOWER.ringHi - TOWER.ringLo) * k) / (TOWER_RINGS - 1);
}

/** One tower, one unit tall, standing on y = 0. */
export function buildTowerGeometry() {
    const positions = [];
    const normals = [];
    const parts = [];
    const indices = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const up = new THREE.Vector3();
    const corner = new THREE.Vector3();
    const normal = new THREE.Vector3();

    /** A square beam from `p` to `q`, `thick` wide (four flat faces, no caps). */
    const beam = (p, q, thick, part = TOWER_PART.steel) => {
        a.set(p[0], p[1], p[2]);
        b.set(q[0], q[1], q[2]);
        dir.subVectors(b, a).normalize();
        side.set(0, 1, 0);
        if (Math.abs(dir.y) > 0.92) side.set(1, 0, 0);
        side.cross(dir).normalize();
        up.crossVectors(dir, side).normalize();
        const h = thick / 2;
        const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let f = 0; f < 4; f++) {
            const c0 = ring[f];
            const c1 = ring[(f + 1) % 4];
            normal.set(0, 0, 0).addScaledVector(side, c0[0] + c1[0]).addScaledVector(up, c0[1] + c1[1]).normalize();
            const base = positions.length / 3;
            [[a, c0], [a, c1], [b, c1], [b, c0]].forEach(([end, c]) => {
                corner.copy(end).addScaledVector(side, c[0] * h).addScaledVector(up, c[1] * h);
                positions.push(corner.x, corner.y, corner.z);
                normals.push(normal.x, normal.y, normal.z);
                parts.push(part);
            });
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    };
    /** A three geometry, moved into place. */
    const solid = (geometry, matrix, part) => {
        const g = geometry.index ? geometry.toNonIndexed() : geometry;
        g.applyMatrix4(matrix);
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        const base = positions.length / 3;
        for (let i = 0; i < p.count; i++) {
            positions.push(p.getX(i), p.getY(i), p.getZ(i));
            normals.push(n.getX(i), n.getY(i), n.getZ(i));
            parts.push(part);
            indices.push(base + i);
        }
        g.dispose();
        if (g !== geometry) geometry.dispose();
    };
    const move = (x, y, z, turnX = 0) => new THREE.Matrix4()
        .makeRotationX(turnX)
        .setPosition(x, y, z);

    // ── The lattice ──
    const levels = latticeLevels();
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < levels.length; i++) {
        const y = levels[i];
        const w = latticeHalf(y);
        const thick = 0.0052 + 0.0052 * (1 - y / TOWER.mast);
        // The storey's girdle.
        for (let c = 0; c < 4; c++) {
            const p = corners[c];
            const q = corners[(c + 1) % 4];
            beam([p[0] * w, y, p[1] * w], [q[0] * w, y, q[1] * w], thick * 0.7);
        }
        if (i === levels.length - 1) break;
        const y1 = levels[i + 1];
        const w1 = latticeHalf(y1);
        for (let c = 0; c < 4; c++) {
            const p = corners[c];
            const q = corners[(c + 1) % 4];
            // The leg, and the cross on this face.
            beam([p[0] * w, y, p[1] * w], [p[0] * w1, y1, p[1] * w1], thick);
            beam([p[0] * w, y, p[1] * w], [q[0] * w1, y1, q[1] * w1], thick * 0.5);
            beam([q[0] * w, y, q[1] * w], [p[0] * w1, y1, p[1] * w1], thick * 0.5);
        }
    }
    // Footings and guy wires.
    corners.forEach((c) => {
        const w = latticeHalf(0);
        solid(new THREE.BoxGeometry(0.03, 0.02, 0.03), move(c[0] * w, 0.008, c[1] * w), TOWER_PART.steel);
        const waist = TOWER.mast * 0.62;
        const ww = latticeHalf(waist);
        beam([c[0] * ww, waist, c[1] * ww], [c[0] * 0.4, 0, c[1] * 0.4], 0.0026);
    });

    // ── Capacitor rings ──
    for (let k = 0; k < TOWER_RINGS; k++) {
        const y = ringHeight(k);
        const radius = latticeHalf(y) * 1.5 + 0.022;
        solid(new THREE.TorusGeometry(radius, 0.0095, 6, 28), move(0, y, 0, Math.PI / 2), TOWER_PART.ring + k);
        // Four struts hold it to the mast.
        corners.forEach((c) => {
            const w = latticeHalf(y);
            beam([c[0] * w, y, c[1] * w], [c[0] * radius * 0.72, y, c[1] * radius * 0.72], 0.004);
        });
    }

    // ── Insulator column, electrode, finial ──
    const neckTop = TOWER.toroid - 0.006;
    solid(
        new THREE.CylinderGeometry(0.011, 0.016, neckTop - TOWER.mast, 8, 1, true),
        move(0, (neckTop + TOWER.mast) / 2, 0),
        TOWER_PART.steel,
    );
    for (let d = 0; d < 4; d++) {
        const y = TOWER.mast + ((neckTop - TOWER.mast) * (d + 0.5)) / 4;
        solid(new THREE.CylinderGeometry(0.026, 0.03, 0.006, 12), move(0, y, 0), TOWER_PART.steel);
    }
    solid(
        new THREE.TorusGeometry(TOWER.toroidRadius, TOWER.toroidTube, 12, 40),
        move(0, TOWER.toroid, 0, Math.PI / 2),
        TOWER_PART.electrode,
    );
    solid(
        new THREE.SphereGeometry(TOWER.toroidRadius * 0.74, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
        new THREE.Matrix4().makeScale(1, 0.42, 1).setPosition(0, TOWER.toroid, 0),
        TOWER_PART.electrode,
    );
    const finialBase = TOWER.toroid + TOWER.toroidRadius * 0.3;
    solid(
        new THREE.CylinderGeometry(0.0012, 0.0068, TOWER.tip - finialBase, 6, 1, true),
        move(0, (TOWER.tip + finialBase) / 2, 0),
        TOWER_PART.finial,
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
    geometry.setIndex(indices);
    return geometry;
}

/** The way to the brightest part of the horizon strip (the towers' only standing light). */
const GLOW_WAY = Object.freeze([Math.sin(STORM.glowAzimuth) * 0.99, 0.1, -Math.cos(STORM.glowAzimuth) * 0.99]);
/** Metres of rain and distance that take a tower two thirds of the way to the haze. */
const HAZE_REACH = 2500;

/**
 * @param {object} u       shared storm uniforms
 * @param {Array<{x:number,z:number,height:number,yaw:number}>} towers  the plan's towers
 * @param {object} options
 * @param {boolean} options.mirror  build the mirror images instead
 */
export function createTowers(u, towers, { mirror = false } = {}) {
    const geometry = buildTowerGeometry();
    const count = Math.max(1, Math.min(TOWER_MAX, towers.length));
    let material;
    if (mirror) {
        material = vsFxMaterial('VoltageStormTowerMirror');
        // The image is turned over in the vertex stage, which turns its winding too.
        material.side = THREE.BackSide;
    } else {
        material = new THREE.MeshBasicNodeMaterial();
        material.name = 'VoltageStormTowers';
        material.fog = false;
    }
    const part = attribute('aPart', 'float');
    const vWorld = varyingProperty('vec3', 'vsTowerWorld');
    const vNormal = varyingProperty('vec3', 'vsTowerNormal');
    /** (part id, height along the tower 0..1, tower index, _) */
    const vPart = varyingProperty('vec4', 'vsTowerPart');

    material.positionNode = Fn(() => {
        // positionLocal / normalLocal already carry the instance's matrix (three r185+).
        const world = vec3(positionLocal).toVar();
        const n = vec3(normalLocal).toVar();
        if (mirror) {
            // Upside down under the water, shivering more the deeper the image lies.
            world.assign(vec3(
                world.x.add(sin(world.y.mul(0.33).add(u.time.mul(1.7))).mul(world.y.mul(0.006).add(0.05))),
                world.y.negate(),
                world.z,
            ));
            n.assign(vec3(n.x, n.y.negate(), n.z));
        }
        vWorld.assign(world);
        vNormal.assign(n);
        vPart.assign(vec4(part, positionGeometry.y, float(instanceIndex), 0.0));
        return world;
    })();

    const shade = Fn(() => {
        const n = normalize(vNormal).toVar();
        const index = int(vPart.z.add(0.5));
        const held = u.towers.element(index.mul(3).add(1));
        const state = u.towers.element(index.mul(3).add(2));
        const id = vPart.x;
        const view = normalize(cameraPosition.sub(vWorld)).toVar();
        const glowWay = vec3(GLOW_WAY[0], GLOW_WAY[1], GLOW_WAY[2]);

        // ── The metal: rain-light from all round, the strip's light from behind ──
        const facing = max(dot(n, glowWay), 0.0);
        const wet = pow(max(dot(reflect(view.negate(), n), glowWay), 0.0), 18.0);
        const ambient = u.haze.mul(n.y.mul(0.4).add(1.1)).mul(2.6)
            .add(u.horizon.mul(facing.mul(1.3).add(wet.mul(2.2))));
        const col = u.steel.mul(ambient).mul(u.breath.mul(0.5).add(0.5)).toVar();

        // ── Every live stroke lights it ──
        const struck = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(u.flashCount), type: 'int', condition: '<', name: 'tf',
        }, ({ tf }) => {
            const at = u.flashes.element(tf.mul(2));
            const light = u.flashes.element(tf.mul(2).add(1));
            const away = at.xyz.sub(vWorld);
            const dist2 = dot(away, away);
            const way = away.div(max(dist2.sqrt(), 0.01));
            const fall = float(1.0).div(float(1.0).add(dist2.div(at.w.mul(at.w))));
            const diffuse = max(dot(n, way), 0.0).mul(0.75).add(0.25);
            const gloss = pow(max(dot(reflect(view.negate(), n), way), 0.0), 14.0);
            struck.addAssign(light.xyz.mul(fall).mul(diffuse.add(gloss.mul(1.6))));
        });
        col.addAssign(struck.mul(u.steel.mul(7.0).add(0.03)));

        // ── What the tower holds ──
        const isRing = step(TOWER_PART.ring - 0.5, id);
        const isElectrode = step(0.5, id).mul(float(1.0).sub(step(1.5, id)));
        const isFinial = step(1.5, id).mul(float(1.0).sub(step(2.5, id)));
        const k = id.sub(TOWER_PART.ring).div(TOWER_RINGS);
        // The rings fill from the bottom; the top one lit breathes.
        const filled = smoothstep(k.sub(0.02), k.add(0.1), held.w.mul(1.06));
        const breathe = sin(u.time.mul(2.4).sub(k.mul(5.0)).add(vPart.z)).mul(0.14).add(0.86);
        // A lock's pulse climbs the stack.
        const pulseAge = u.time.sub(state.y);
        const climb = k.sub(pulseAge.mul(3.4)).mul(5.5);
        const pulse = exp(climb.mul(climb).negate()).mul(state.z).mul(step(0.0, pulseAge))
            .mul(exp(max(pulseAge, 0.0).mul(-2.2)));
        const tint = max(held.xyz, vec3(1e-4));
        const hue = tint.div(max(tint.x, max(tint.y, tint.z)));
        const ringLight = hue.mul(filled.mul(breathe).mul(2.3).add(pulse.mul(7.0)))
            .add(u.corona.mul(0.018))
            .add(vec3(1.0, 0.97, 1.0).mul(state.x.mul(9.0)));
        // The electrode: polished, so it carries the strip and the strokes on its rim.
        const rimK = float(1.0).sub(clamp(dot(n, view), 0.0, 1.0));
        const rim = rimK.mul(rimK).mul(rimK);
        const electrode = u.horizon.mul(rim.mul(0.3).mul(facing.mul(0.8).add(0.2)))
            .add(struck.mul(rim.mul(0.6).add(0.06)))
            .add(u.corona.mul(state.w.mul(0.5)))
            .add(hue.mul(held.w.mul(0.16)))
            .add(vec3(1.0, 0.97, 1.0).mul(state.x.mul(6.0)));
        const finial = u.corona.mul(state.w.mul(2.6).mul(smoothstep(0.92, 1.0, vPart.y)))
            .add(vec3(1.0, 0.97, 1.0).mul(state.x.mul(14.0)));
        col.addAssign(ringLight.mul(isRing).add(electrode.mul(isElectrode)).add(finial.mul(isFinial)).mul(u.breath));

        // ── Rain and distance ──
        const dist = length(cameraPosition.sub(vWorld));
        const veil = float(1.0).sub(exp(dist.div(-HAZE_REACH)));
        col.assign(mix(col, u.haze.mul(1.15).add(u.veil.mul(0.14)), veil.mul(0.94)));

        if (!mirror) return vec4(col, 1.0);
        // The image: broken by the ripples where the view ray meets the water, fading with depth.
        const eye = cameraPosition;
        const k2 = eye.y.div(max(eye.y.sub(vWorld.y), 0.01));
        const surface = eye.xz.add(vWorld.xz.sub(eye.xz).mul(k2));
        const ripple = u.noise(surface.mul(0.045).add(vec2(u.time.mul(0.05), 0.0))).r
            .mul(u.noise(surface.mul(0.011).sub(u.time.mul(0.013))).g.mul(0.9).add(0.55));
        const alpha = clamp(ripple.mul(1.9).sub(0.12), 0.0, 1.0).mul(0.86)
            .mul(exp(abs(vWorld.y).mul(-0.0035)));
        return vec4(col.mul(0.85).mul(alpha), alpha);
    });

    material.colorNode = shade();

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = material.name;
    mesh.frustumCulled = false;
    mesh.renderOrder = mirror ? -40 : 0;
    const place = (list) => {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const yAxis = new THREE.Vector3(0, 1, 0);
        const s = new THREE.Vector3();
        const p = new THREE.Vector3();
        for (let i = 0; i < count; i++) {
            const t = list[i] || list[list.length - 1];
            q.setFromAxisAngle(yAxis, t.yaw || 0);
            s.set(t.height, t.height, t.height);
            p.set(t.x, 0, t.z);
            m.compose(p, q, s);
            mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
    };
    place(towers);
    return {
        mesh, material, geometry, count, place,
    };
}

// ── Glows ───────────────────────────────────────────────────────────────────────

/**
 * Two soft lights per tower, always facing the lens: the halo round the electrode (what the tower
 * holds, the corona a chain raises, the white of a strike) and the point of fire on the finial.
 */
export function createTowerGlows(u, count) {
    const n = Math.max(1, Math.min(TOWER_MAX, count)) * 2;
    const aGlow = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) aGlow.set([Math.floor(i / 2), i % 2], i * 2);
    const geometry = vsQuadGeometry(n, { aGlow: [aGlow, 2] });
    const glow = attribute('aGlow', 'vec2');
    const material = vsFxMaterial('VoltageStormGlows', { depthTest: false });
    const vLight = varyingProperty('vec4', 'vsGlowLight');

    material.vertexNode = Fn(() => {
        const index = int(glow.x.add(0.5));
        const place = u.towers.element(index.mul(3));
        const held = u.towers.element(index.mul(3).add(1));
        const state = u.towers.element(index.mul(3).add(2));
        const isTip = step(0.5, glow.y);
        const height = place.z;
        const y = height.mul(mix(float(TOWER.toroid), float(TOWER.tip), isTip));
        const world = vec3(place.x, y, place.y);
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toVar();
        const tint = max(held.xyz, vec3(1e-4));
        const hue = tint.div(max(tint.x, max(tint.y, tint.z)));
        const white = vec3(1.0, 0.97, 1.0);
        // The halo: what it holds and its corona; the tip: fire on the point.
        const halo = hue.mul(held.w.mul(0.2)).add(u.corona.mul(state.w.mul(0.34))).add(white.mul(state.x.mul(0.5)));
        const tip = u.corona.mul(state.w.mul(1.1)).add(white.mul(state.x.mul(2.2)));
        const light = mix(halo, tip, isTip).mul(place.w).mul(u.breath);
        const radius = height.mul(mix(
            float(0.17).add(state.x.mul(0.09)),
            float(0.045).add(state.w.mul(0.06)).add(state.x.mul(0.09)),
            isTip,
        ));
        const dist = length(cameraPosition.sub(world));
        const veil = exp(dist.div(-HAZE_REACH * 1.6));
        vLight.assign(vec4(light.mul(veil), 1.0));
        const px = max(radius.div(max(clip.w, 1.0).mul(u.pixelAngle)), 1.5);
        const half = u.viewport.mul(0.5);
        return vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    })();
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d2 = dot(q, q);
        const soft = exp(d2.mul(-4.5)).add(exp(d2.mul(-22.0)).mul(0.8))
            .mul(float(1.0).sub(smoothstep(0.7, 1.0, d2.sqrt())));
        return vec4(vLight.xyz.mul(soft), 0.0);
    })();
    const part = vsPart('VoltageStormGlows', geometry, material, 30);
    part.count = n;
    return part;
}
