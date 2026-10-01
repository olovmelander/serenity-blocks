/**
 * Nimbus Veil — atmosphere and gameplay FX: drifting golden motes, event sparkles, mist veils.
 *
 * Motion is analytic in the vertex stage (spawn state + age), so nothing is uploaded per frame:
 * a spawn writes one instance's attributes as a ranged upload, and the same code runs on both
 * WebGPURenderer backends. Motes and sparkles are instanced Sprites (THREE.Points would be one
 * pixel wide on WebGPU whatever the size node says).
 *
 * Additive materials write premultiplied colour with alpha 1 (AdditiveBlending is SrcAlpha, One).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    uv,
    vec2,
    vec3,
} from 'three/tsl';
import {
    RIG,
    nvFbm3,
    nvSunAlign,
    rgb,
} from './nimbus-veil-tsl.js';
import { SEA_HAZE } from './nimbus-veil-cloudsea.js';

function instanced(count, itemSize) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
}

/** Mark one instance dirty (ranged upload; ranges merge per frame in three). */
function touch(attr, index) {
    attr.addUpdateRange(index * attr.itemSize, attr.itemSize);
    attr.needsUpdate = true;
}

/** A four-point glint (soft core + cross flare) in sprite space, for motes and sparkles. */
const glint = (local, flare) => {
    const d = length(local);
    const core = exp(d.mul(d).mul(-9.0));
    const cross = exp(abs(local.x).mul(-26.0)).mul(exp(abs(local.y).mul(-3.2)))
        .add(exp(abs(local.y).mul(-26.0)).mul(exp(abs(local.x).mul(-3.2))));
    return core.add(cross.mul(flare)).mul(float(1.0).sub(smoothstep(0.85, 1.0, d)));
};

function createMotes(u, count, rand) {
    const material = new THREE.PointsNodeMaterial();
    material.name = 'NimbusMotes';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.sizeAttenuation = false;
    material.fog = false;

    const mote = attribute('iMote', 'vec4'); // x, y0, z, phase
    const look = attribute('iMoteLook', 'vec4'); // r, g, b, size px
    const t = u.time;
    const ph = mote.w;
    // Rise slowly through a 40-unit column and wrap; sway sideways a little.
    const rise = fract(t.mul(0.012).add(ph.mul(0.159))).mul(40.0);
    const pos = vec3(
        mote.x.add(sin(t.mul(0.09).add(ph)).mul(3.0)),
        mote.y.add(rise),
        mote.z.add(sin(t.mul(0.07).add(ph.mul(1.3))).mul(2.0)),
    );
    const dist = length(pos.sub(cameraPosition));
    material.positionNode = pos;
    material.sizeNode = look.w.mul(clamp(float(70.0).div(dist), 0.5, 2.0));
    material.colorNode = Fn(() => {
        const local = uv().sub(0.5).mul(2.0);
        const twinkle = sin(t.mul(float(1.1).add(ph.mul(0.13))).add(ph.mul(5.0))).mul(0.5).add(0.5);
        const riseT = rise.div(40.0);
        const wrapFade = smoothstep(0.0, 0.12, riseT).mul(float(1.0).sub(smoothstep(0.8, 1.0, riseT)));
        const fog = exp(dist.mul(SEA_HAZE * 1.4).negate());
        return look.xyz.mul(glint(local, twinkle.mul(0.5)).mul(twinkle.mul(0.6).add(0.4)).mul(wrapFade).mul(fog)
            .mul(0.9));
    })();
    material.opacityNode = float(1.0);

    const sprite = new THREE.Sprite(material);
    sprite.name = 'NimbusMotes';
    sprite.geometry = sprite.geometry.clone();
    const iMote = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const iMoteLook = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const palette = [0xffe6b3, 0xfff6e0, 0xffd0a0, 0xf6e2ff].map((h) => new THREE.Color(h));
    for (let i = 0; i < count; i += 1) {
        const phi = (rand() * 2 - 1) * 1.5;
        const d = 28 + rand() * 170;
        iMote.array.set([RIG.x + Math.sin(phi) * d, 2 + rand() * 18, RIG.z - Math.cos(phi) * d, rand() * 6.28], i * 4);
        const c = palette[Math.floor(rand() * palette.length)];
        iMoteLook.array.set([c.r, c.g, c.b, 3 + rand() * 4], i * 4);
    }
    sprite.geometry.setAttribute('iMote', iMote);
    sprite.geometry.setAttribute('iMoteLook', iMoteLook);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 40;
    return sprite;
}

function createSparkles(u, count) {
    const material = new THREE.PointsNodeMaterial();
    material.name = 'NimbusSparkles';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.sizeAttenuation = false;
    material.fog = false;

    const spawn = attribute('iSpawn', 'vec4'); // x, y, z, t0
    const vel = attribute('iVel', 'vec4'); // vx, vy, vz, life
    const look = attribute('iLook', 'vec4'); // r, g, b, size px
    const motion = attribute('iMotion', 'vec4'); // drag, lift, twinkle rate, phase
    const age = u.time.sub(spawn.w);
    const life = max(vel.w, 1e-3);
    const alive = step(0.0, age).mul(step(age, life));
    const lifeT = clamp(age.div(life), 0.0, 1.0);
    const drag = max(motion.x, 1e-3);
    const travel = float(1.0).sub(exp(age.mul(drag).negate())).div(drag);
    // Sparkles float: a gentle lift instead of gravity.
    material.positionNode = spawn.xyz.add(vel.xyz.mul(travel)).add(vec3(0.0, motion.y.mul(age).mul(age).mul(0.5), 0.0));
    const fadeIn = smoothstep(0.0, 0.08, lifeT);
    const fadeOut = pow(float(1.0).sub(lifeT), 0.9);
    material.sizeNode = look.w.mul(mix(float(1.3), float(0.7), lifeT)).mul(alive);
    material.colorNode = Fn(() => {
        const local = uv().sub(0.5).mul(2.0);
        const twinkle = sin(age.mul(motion.z).add(motion.w)).mul(0.5).add(0.5);
        return look.xyz.mul(glint(local, twinkle.mul(0.9).add(0.2)).mul(fadeIn.mul(fadeOut))
            .mul(twinkle.mul(0.5).add(0.6)).mul(2.4));
    })();
    material.opacityNode = float(1.0);

    const sprite = new THREE.Sprite(material);
    sprite.name = 'NimbusSparkles';
    sprite.geometry = sprite.geometry.clone();
    const iSpawn = instanced(count, 4);
    const iVel = instanced(count, 4);
    const iLook = instanced(count, 4);
    const iMotion = instanced(count, 4);
    for (let i = 0; i < count; i += 1) iSpawn.array[i * 4 + 3] = -1e6;
    sprite.geometry.setAttribute('iSpawn', iSpawn);
    sprite.geometry.setAttribute('iVel', iVel);
    sprite.geometry.setAttribute('iLook', iLook);
    sprite.geometry.setAttribute('iMotion', iMotion);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 41;
    return {
        sprite, iSpawn, iVel, iLook, iMotion,
    };
}

/**
 * Mist veils: wide bands hugging the cloud sea in front of the camera (in a group the world
 * turns with the view's yaw). fbm density scrolls sideways; warm toward the sun, lavender away.
 */
function createVeils(u, layers) {
    const group = new THREE.Group();
    group.name = 'NimbusVeils';
    const specs = [
        {
            d: 70, w: 230, h: 30, y: 6, k: 0.32, speed: 0.012,
        },
        {
            d: 140, w: 440, h: 46, y: 9, k: 0.26, speed: 0.008,
        },
    ].slice(0, layers);
    specs.forEach((spec, i) => {
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = `NimbusVeil${i}`;
        material.transparent = true;
        material.depthWrite = false;
        material.fog = false;
        const vu = uv();
        material.colorNode = Fn(() => {
            const V = normalize(positionWorld.sub(cameraPosition));
            const sa = nvSunAlign(V.z.div(max(length(vec2(V.x, V.z)), 1e-4)));
            return mix(rgb(0xd9c4e6, 0.95), rgb(0xffe2bc, 1.25), sa).mul(float(1.0).add(u.seaGlow.mul(0.2)));
        })();
        material.opacityNode = Fn(() => {
            const p = vec2(vu.x.mul(5.0).add(u.time.mul(spec.speed)).add(i * 3.7), vu.y.mul(1.6));
            const n = nvFbm3(p);
            const band = smoothstep(0.0, 0.35, vu.y).mul(float(1.0).sub(smoothstep(0.45, 1.0, vu.y)));
            const sides = smoothstep(0.0, 0.12, vu.x).mul(float(1.0).sub(smoothstep(0.88, 1.0, vu.x)));
            return smoothstep(0.38, 0.85, n).mul(band).mul(sides).mul(spec.k);
        })();
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, spec.h), material);
        mesh.position.set(0, spec.y - RIG.height, -spec.d);
        mesh.renderOrder = 30 - i;
        mesh.frustumCulled = false;
        group.add(mesh);
    });
    return group;
}

export class NimbusFx {
    /**
     * @param {object} u  shared world uniforms
     * @param {object} opts
     * @param {number} opts.motes
     * @param {number} opts.sparkles
     * @param {number} opts.veils
     * @param {() => number} opts.rand
     */
    constructor(u, {
        motes, sparkles, veils, rand,
    }) {
        this.group = new THREE.Group();
        this.group.name = 'NimbusFx';
        this.motes = motes > 0 ? createMotes(u, motes, rand) : null;
        this.sparkles = createSparkles(u, Math.max(1, sparkles));
        this.sparkCursor = 0;
        this.veils = veils > 0 ? createVeils(u, veils) : null;
        if (this.motes) this.group.add(this.motes);
        this.group.add(this.sparkles.sprite);
        if (this.veils) this.group.add(this.veils);
    }

    get sparkleCapacity() {
        return this.sparkles.iSpawn.count;
    }

    /**
     * Emit one sparkle: world position/velocity, life (s), THREE.Color, size (px), and its
     * motion (`drag` 1/s, `lift` units/s² upward, `twinkle` rate rad/s, `phase`).
     */
    spawnSparkle(t0, px, py, pz, vx, vy, vz, life, color, sizePx, motion = {}) {
        const {
            iSpawn, iVel, iLook, iMotion,
        } = this.sparkles;
        const i = this.sparkCursor;
        this.sparkCursor = (i + 1) % iSpawn.count;
        iSpawn.array.set([px, py, pz, t0], i * 4);
        iVel.array.set([vx, vy, vz, life], i * 4);
        iLook.array.set([color.r, color.g, color.b, sizePx], i * 4);
        iMotion.array.set([motion.drag ?? 1.2, motion.lift ?? 1.5, motion.twinkle ?? 9, motion.phase ?? 0], i * 4);
        touch(iSpawn, i);
        touch(iVel, i);
        touch(iLook, i);
        touch(iMotion, i);
    }

    clear() {
        const { iSpawn } = this.sparkles;
        for (let i = 0; i < iSpawn.count; i += 1) iSpawn.array[i * 4 + 3] = -1e6;
        iSpawn.clearUpdateRanges();
        iSpawn.needsUpdate = true;
    }

    dispose() {
        this.group.removeFromParent();
        this.group.traverse((obj) => {
            obj.geometry?.dispose();
            obj.material?.dispose();
        });
    }
}
