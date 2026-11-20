/**
 * Nimbus Veil — atmosphere and gameplay FX: drifting golden motes (and the ice glitter that
 * passes through them), event sparkles, the veils of mist over the deck. (The birds are a part
 * of their own: nimbus-veil-albatross.js.)
 *
 * Motion is analytic in the vertex stage (spawn state + age), so nothing is uploaded per frame:
 * a spawn writes one instance's attributes as a ranged upload, and the same code runs on both
 * WebGPURenderer backends. Motes and sparkles are instanced Sprites (THREE.Points would be one
 * pixel wide on WebGPU whatever the size node says).
 *
 * The additive sprites add their light with an alpha of zero (premultiplied, a custom output), so
 * the scene pass's alpha is left as it was under each sprite's whole square: a bird's mark there
 * (nimbus-veil-albatross.js) reaches the post.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    dot,
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
    vec4,
} from 'three/tsl';
import {
    RIG,
    nvFbm3,
    nvSunAlign,
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
    const arms = exp(abs(local.x).mul(-26.0)).mul(exp(abs(local.y).mul(-3.2)))
        .add(exp(abs(local.y).mul(-26.0)).mul(exp(abs(local.x).mul(-3.2))));
    return core.add(arms.mul(flare)).mul(float(1.0).sub(smoothstep(0.85, 1.0, d)));
};

function createMotes(u, count, rand) {
    const material = new THREE.PointsNodeMaterial();
    material.name = 'NimbusMotes';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.sizeAttenuation = false;
    material.fog = false;

    const mote = attribute('iMote', 'vec4'); // x, y0, z, phase
    const look = attribute('iMoteLook', 'vec4'); // r, g, b, size px
    const t = u.time;
    const ph = mote.w;
    // Rise slowly through a 40-unit column and wrap (on the flight clock: the air lifts faster as
    // play heats); sway sideways a little.
    const rise = fract(u.flight.mul(0.012).add(ph.mul(0.159))).mul(40.0);
    const pos = vec3(
        mote.x.add(sin(t.mul(0.09).add(ph)).mul(3.0)),
        mote.y.add(rise),
        mote.z.add(sin(t.mul(0.07).add(ph.mul(1.3))).mul(2.0)),
    );
    const dist = length(pos.sub(cameraPosition));
    material.positionNode = pos;
    material.sizeNode = look.w.mul(clamp(float(70.0).div(dist), 0.5, 2.0));
    const light = Fn(() => {
        const local = uv().sub(0.5).mul(2.0);
        const twinkle = sin(t.mul(float(1.1).add(ph.mul(0.13))).add(ph.mul(5.0))).mul(0.5).add(0.5);
        const riseT = rise.div(40.0);
        const wrapFade = smoothstep(0.0, 0.12, riseT).mul(float(1.0).sub(smoothstep(0.8, 1.0, riseT)));
        const fog = exp(dist.mul(SEA_HAZE * 1.4).negate());
        // Ice glitter passing (u.glitter): the motes toward the sun flash, each on its own beat.
        const toSun = max(dot(normalize(pos.sub(cameraPosition)), u.sunDir), 0.0);
        const s2 = toSun.mul(toSun);
        const flash = pow(sin(t.mul(float(5.0).add(ph.mul(0.9))).add(ph.mul(11.0))).mul(0.5).add(0.5), 6.0);
        const gain = u.moteGlow.mul(0.9).add(u.glitter.mul(s2.mul(s2)).mul(flash.mul(7.0).add(0.6)));
        return look.xyz.mul(glint(local, twinkle.mul(0.5)).mul(twinkle.mul(0.6).add(0.4)).mul(wrapFade).mul(fog)
            .mul(gain));
    })();
    material.outputNode = vec4(light, 0.0);

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
    material.premultipliedAlpha = true;
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
    const light = Fn(() => {
        const local = uv().sub(0.5).mul(2.0);
        const twinkle = sin(age.mul(motion.z).add(motion.w)).mul(0.5).add(0.5);
        return look.xyz.mul(glint(local, twinkle.mul(0.9).add(0.2)).mul(fadeIn.mul(fadeOut))
            .mul(twinkle.mul(0.5).add(0.6)).mul(2.4));
    })();
    material.outputNode = vec4(light, 0.0);

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
 * The veils: long bands of mist lying over the cloud sea at four depths, in a group the world
 * turns with the view's yaw. fbm density streams sideways on the flight clock; the air sets how
 * much of it there is (u.air.z: thin on a fair day, thick in mist, closing in at a run's end).
 * Lavender away from the sun, warm toward it, and looking INTO the sun the mist lights up: that
 * forward glow is what makes it read as a veil and not a smudge. Lower tiers take the near ones.
 */
const VEIL_SPECS = Object.freeze([
    {
        d: 60, w: 300, h: 24, y: 4, k: 0.42, speed: 0.016,
    },
    {
        d: 135, w: 640, h: 40, y: 7, k: 0.46, speed: 0.011,
    },
    {
        d: 270, w: 1250, h: 66, y: 11, k: 0.48, speed: 0.0075,
    },
    {
        d: 520, w: 2400, h: 120, y: 18, k: 0.44, speed: 0.005,
    },
]);

function createVeils(u, layers) {
    const group = new THREE.Group();
    group.name = 'NimbusVeils';
    VEIL_SPECS.slice(0, layers).forEach((spec, i) => {
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = `NimbusVeil${i}`;
        material.transparent = true;
        material.depthWrite = false;
        material.fog = false;
        const vu = uv();
        material.colorNode = Fn(() => {
            const V = normalize(positionWorld.sub(cameraPosition)).toVar();
            const sa = nvSunAlign(V.z.div(max(length(vec2(V.x, V.z)), 1e-4)));
            const toSun = max(dot(V, u.sunDir), 0.0);
            const c2 = toSun.mul(toSun);
            const c8 = c2.mul(c2).mul(c2).mul(c2);
            const lobe = c8.mul(c8).mul(u.day.mul(0.8).add(0.2));
            return mix(u.mood.veilA, u.mood.veilT, sa).mul(float(1.0).add(u.seaGlow.mul(0.2)))
                .add(u.mood.veilT.mul(lobe).mul(0.9));
        })();
        material.opacityNode = Fn(() => {
            // Long and low: a cell of the mist is five times as wide as it is tall.
            const p = vec2(
                vu.x.mul(spec.w / (spec.h * 3.4)).add(u.flight.mul(spec.speed)).add(i * 3.7),
                vu.y.mul(1.5).add(i * 1.3),
            );
            const n = nvFbm3(p);
            // More air, more veil: the threshold falls and the mist joins up.
            const thick = clamp(u.air.z, 0.0, 2.4);
            const thr = mix(float(0.66), float(0.26), clamp(thick.mul(0.55), 0.0, 1.0));
            const band = smoothstep(0.0, 0.3, vu.y).mul(float(1.0).sub(smoothstep(0.4, 1.0, vu.y)));
            const sides = smoothstep(0.0, 0.1, vu.x).mul(float(1.0).sub(smoothstep(0.9, 1.0, vu.x)));
            return smoothstep(thr, thr.add(0.36), n).mul(band).mul(sides).mul(spec.k)
                .mul(clamp(thick.mul(0.9).add(0.25), 0.0, 1.9));
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
     * @param {number} [opts.birds]
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
        /** When each sparkle slot's glint ends (CPU copy): a new glint takes a finished slot. */
        this.sparkEnd = new Float64Array(this.sparkles.iSpawn.count).fill(-1e6);
        this.veils = veils > 0 ? createVeils(u, veils) : null;
        if (this.motes) this.group.add(this.motes);
        this.group.add(this.sparkles.sprite);
        if (this.veils) this.group.add(this.veils);
    }

    get sparkleCapacity() {
        return this.sparkles.iSpawn.count;
    }

    /**
     * The slot for a glint starting at `t0`: the next finished one from the cursor, or, with
     * every glint still alive, the one closest to its end, so a burst never winks out the glints
     * of the one before mid-twinkle while older ones linger.
     */
    sparkleSlot(t0) {
        const end = this.sparkEnd;
        const n = end.length;
        let best = this.sparkCursor % n;
        let soonest = Infinity;
        for (let k = 0; k < n; k += 1) {
            const i = (this.sparkCursor + k) % n;
            if (end[i] <= t0) {
                best = i;
                break;
            }
            if (end[i] < soonest) {
                soonest = end[i];
                best = i;
            }
        }
        this.sparkCursor = (best + 1) % n;
        return best;
    }

    /**
     * Emit one sparkle: world position/velocity, life (s), THREE.Color, size (px), and its
     * motion (`drag` 1/s, `lift` units/s² upward, `twinkle` rate rad/s, `phase`).
     */
    spawnSparkle(t0, px, py, pz, vx, vy, vz, life, color, sizePx, motion = {}) {
        const {
            iSpawn, iVel, iLook, iMotion,
        } = this.sparkles;
        const i = this.sparkleSlot(t0);
        this.sparkEnd[i] = t0 + life;
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
        this.sparkEnd.fill(-1e6);
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
