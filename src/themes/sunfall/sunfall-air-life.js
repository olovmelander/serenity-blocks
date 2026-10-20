/**
 * Sunfall — what moves through the air: dust in the sunfall, cave swiftlets, the Exhale cloud.
 *
 * - **Dust** drifts inside the column and is seen only where the sun is on it.
 * - **Swiftlets** cross the chamber in pairs on long arcs, dark specks that flare white-gold
 *   when they pass through the light (scale cues, never a flock).
 * - **The Exhale**: when a combo breaks, the gathered mist rises as one cloud from the deck up
 *   through the oculus, bigger and more golden for a longer chain.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    select,
    sin,
    smoothstep,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CANOPY_LEVEL, DECK, OCULUS_CENTER, OCULUS_RX, OCULUS_RZ, mulberry32,
} from './sunfall-core.js';
import { SUNFALL_LIGHT, sfSunMask } from './sunfall-tsl.js';

const additive = (material) => {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    return material;
};

export function createDustMaterial(u) {
    const M = attribute('aMote', 'vec4'); // q.x, q.y, phase, size
    const span = OCULUS_CENTER[1] - (CANOPY_LEVEL + 4);
    const vertex = Fn(() => {
        const S = u.sunDir;
        const s = fract(M.z.add(u.time.mul(0.0035)));
        const y = float(OCULUS_CENTER[1] - 2).sub(s.mul(span));
        const t = float(OCULUS_CENTER[1]).sub(y).div(max(S.y, 0.15));
        const drift = vec3(
            sin(u.time.mul(0.21).add(M.z.mul(40.0))),
            0.0,
            cos(u.time.mul(0.17).add(M.z.mul(31.0))),
        ).mul(2.0);
        const centre = vec3(
            float(OCULUS_CENTER[0]).add(M.x.mul(OCULUS_RX)),
            float(OCULUS_CENTER[1]),
            float(OCULUS_CENTER[2]).add(M.y.mul(OCULUS_RZ)),
        ).sub(S.mul(t)).add(drift).toVar();
        const lit = sfSunMask(u, centre);
        const toCam = cameraPosition.sub(centre);
        const dist = length(toCam);
        const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        const up = normalize(cross(toCam, right));
        const size = max(M.w, dist.mul(u.pixelAngle).mul(1.3)).mul(smoothstep(0.05, 0.3, lit));
        return centre.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size)));
    })();
    const color = Fn(() => {
        const r = length(uv().sub(0.5)).mul(2.0);
        const disc = clamp(float(1.0).sub(r), 0.0, 1.0);
        const twinkle = sin(u.time.mul(1.7).add(M.z.mul(91.0))).mul(0.35).add(0.65);
        const light = u.beamCore.mul(disc.mul(disc)).mul(twinkle).mul(SUNFALL_LIGHT.sun * 0.012)
            .mul(u.sunGain)
            .mul(float(1.0).add(u.comboLift));
        return vec4(light, 0.0);
    })();
    const material = additive(new THREE.MeshBasicNodeMaterial());
    material.positionNode = vertex;
    material.colorNode = color;
    material.outputNode = color;
    return material;
}

export function createSwiftMaterial(u) {
    const W = attribute('aSwift', 'vec4'); // radius, height, angular speed, phase
    const vertex = Fn(() => {
        const theta = u.time.mul(W.z).add(W.w);
        const r = W.x.mul(float(1.0).sub(u.comboLift.mul(0.25)));
        // Long arcs over the chamber, centred over the jungle, dipping and climbing.
        const centre = vec3(
            float(-90.0).add(cos(theta).mul(r)),
            W.y.add(sin(theta.mul(2.0)).mul(14.0)),
            float(-420.0).add(sin(theta).mul(r.mul(0.8))),
        );
        const way = select(W.z.greaterThan(0.0), float(1.0), float(-1.0));
        const along = vec3(sin(theta).negate(), cos(theta.mul(2.0)).mul(0.25), cos(theta).mul(0.8));
        const heading = normalize(along.mul(way));
        const side = normalize(cross(heading, vec3(0.0, 1.0, 0.0)));
        const flap = sin(u.time.mul(14.0).add(W.w.mul(7.0))).mul(abs(positionGeometry.x)).mul(0.5);
        const span = 0.55;
        return centre.add(side.mul(positionGeometry.x.mul(span)))
            .add(heading.mul(positionGeometry.z.mul(span)))
            .add(vec3(0.0, flap.mul(span), 0.0));
    })();
    const color = Fn(() => {
        const P = positionWorld;
        const lit = sfSunMask(u, P);
        return mix(vec3(0.012, 0.014, 0.016), u.beamCore.mul(SUNFALL_LIGHT.sun * 0.08), clamp(lit.mul(1.2), 0.0, 1.0));
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vertex;
    material.colorNode = color;
    material.side = THREE.DoubleSide;
    return material;
}

export function createExhaleMaterial(u, textures) {
    const color = Fn(() => {
        const st = uv();
        const p = st.sub(0.5).mul(2.0);
        const n = texture(textures.fbm, st.mul(1.3).add(vec2(u.exhaleAge.mul(0.05), u.time.mul(0.01)))).level(1);
        const r = length(p.mul(vec2(1.0, 1.25))).add(n.x.sub(0.5).mul(0.55));
        const body = smoothstep(0.95, 0.25, r).mul(mix(0.6, 1.2, n.y));
        const fade = u.exhalePulse.mul(smoothstep(0.0, 0.4, u.exhaleAge));
        const dens = clamp(body.mul(fade), 0.0, 1.0);
        const P = positionWorld;
        const lit = sfSunMask(u, P);
        const light = mix(vec3(0.16, 0.17, 0.17), vec3(1.0, 0.85, 0.55).mul(SUNFALL_LIGHT.sun * 0.06), lit)
            .mul(dens).mul(u.sunGain.mul(0.5).add(0.5));
        return vec4(light, dens.mul(0.55));
    });
    const material = new THREE.MeshBasicNodeMaterial();
    const out = color();
    material.colorNode = out;
    material.outputNode = out;
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    return material;
}

export function buildAirLife(world) {
    const { u, preset, textures } = world;
    const rng = mulberry32(world.seed ^ 0x7a1f);
    const disposables = [];
    const beam = new THREE.Group();
    beam.name = 'sunfall-dust';
    const birds = new THREE.Group();
    birds.name = 'sunfall-swiftlets';
    const mist = new THREE.Group();
    mist.name = 'sunfall-exhale';

    // Dust in the light.
    const motes = Math.max(40, Math.round((preset.moteCount || 600) * 0.5));
    const dustGeo = new THREE.PlaneGeometry(1, 1);
    dustGeo.deleteAttribute('normal');
    const md = new Float32Array(motes * 4);
    for (let i = 0; i < motes; i += 1) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * 0.95;
        md.set([Math.cos(a) * r, Math.sin(a) * r, rng(), 0.12 + rng() * 0.2], i * 4);
    }
    dustGeo.setAttribute('aMote', new THREE.InstancedBufferAttribute(md, 4));
    const dustMat = createDustMaterial(u);
    const dust = new THREE.InstancedMesh(dustGeo, dustMat, motes);
    dust.frustumCulled = false;
    dust.renderOrder = 43;
    beam.add(dust);
    disposables.push(dustGeo, dustMat);

    // Swiftlets.
    const { swifts } = world.plan;
    if (swifts.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            0, 0, 0.45, -1.2, 0.08, -0.15, 0, 0, -0.3,
            0, 0, 0.45, 0, 0, -0.3, 1.2, 0.08, -0.15,
        ]), 3));
        const sw = new Float32Array(swifts.length * 4);
        swifts.forEach((s, i) => sw.set([s.orbitR, s.orbitY, s.speed, s.phase], i * 4));
        geo.setAttribute('aSwift', new THREE.InstancedBufferAttribute(sw, 4));
        const mat = createSwiftMaterial(u);
        const mesh = new THREE.InstancedMesh(geo, mat, swifts.length);
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        birds.add(mesh);
        disposables.push(geo, mat);
    }

    // The Exhale cloud: rises from the deck's hole up through the oculus.
    const exhaleMat = createExhaleMaterial(u, textures);
    const exhaleGeo = new THREE.PlaneGeometry(1, 1);
    const exhale = new THREE.Mesh(exhaleGeo, exhaleMat);
    exhale.frustumCulled = false;
    exhale.renderOrder = 44;
    exhale.visible = false;
    mist.add(exhale);
    disposables.push(exhaleMat, exhaleGeo);
    const deckMid = (DECK.bottom + DECK.top) * 0.5;

    return {
        beam,
        birds,
        mist,
        update(snap) {
            const live = (snap?.exhalePulse ?? 0) > 0.002;
            exhale.visible = live;
            if (!live) return;
            const age = snap.exhaleAge ?? 0;
            const rise = Math.min(1, age / 3.4);
            const sd = snap.sunDir;
            const y = deckMid + rise * (OCULUS_CENTER[1] + 30 - deckMid);
            const t = (OCULUS_CENTER[1] - y) / Math.max(0.15, sd[1]);
            exhale.position.set(OCULUS_CENTER[0] - sd[0] * t, y, OCULUS_CENTER[2] - sd[2] * t);
            const size = 40 + 60 * Math.min(1, snap.exhalePulse);
            exhale.scale.set(size * 1.4, size, 1);
            exhale.quaternion.copy(world.camera.quaternion);
        },
        dispose() {
            disposables.forEach((d) => d.dispose());
        },
    };
}
