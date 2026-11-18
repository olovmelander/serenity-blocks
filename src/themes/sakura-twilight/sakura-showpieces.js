/**
 * Sakura Twilight — the garden's showpieces: what each kind of play has that no other has.
 *
 * Petals answer every lock and every clear (sakura-petal-director.js). On top of them each event
 * has an instrument of its own, so no two read as "more petals":
 *
 *   hard drop      the piece goes through the card into the lake: a crown of spray stands up on
 *                  the water beside the board, taller the further the piece fell
 *   twist          a double helix of lit petals winds itself up beside the board, turns, opens
 *                  and lets go
 *   four lines     hanafubuki: a blizzard of petals streams through the whole garden on the wind,
 *                  from the eye to the far shore (the same layer is the petal wind's own weather)
 *   back-to-back   the gate wakes: light stands in the torii and its reflection in the lake, taller
 *                  for every one in a row
 *   perfect clear  the star fox comes down: a spirit light leaves the Fox among the stars, crosses
 *                  the sky over the mountain trailing sparks and goes through the gate, which blazes
 *
 * Everything here is stateless on the GPU: a few numbers per slot in a uniform array, the motion
 * closed-form in the vertex stage, so launching one rewrites one row and nothing is allocated. A
 * launch takes a spent slot, else the one with the least of its life left; nothing in flight is
 * ever cut short. Light that adds is drawn additively; the blizzard's petals are solid.
 *
 * Nothing is parked invisible: a showpiece at rest is drawn with every vertex folded onto a
 * point (no fragment is shaded), so its pipeline is built with the rest of the garden and its
 * first appearance in play compiles nothing.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, cos, cross, exp, float, fract, instancedBufferAttribute, int, length, max, mix, normalize,
    positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uniform, uniformArray, uv, vec2,
    vec3, vec4,
} from 'three/tsl';
import { SAKURA_TORII } from './sakura-composition.js';
import { SAKURA_CONSTELLATIONS } from './sakura-sky.js';
import { SAKURA_WATER_LEVEL, sakuraTerrainHeight } from './sakura-terrain.js';

const TAU = Math.PI * 2;

/** A small seeded generator of its own (mulberry32): the showpieces take none of the garden's chances. */
function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/** Crowns of spray that can stand on the lake at once. */
export const SAKURA_SPLASH_SLOTS = 6;
const SPLASH_DROPS = 26;
/** A crown has fallen back by then (its last drop lands inside a second). */
export const SAKURA_SPLASH_SECONDS = 1.25;
/** Helices that can turn beside the board at once. */
export const SAKURA_HELIX_SLOTS = 3;
const HELIX_PETALS = 84;
export const SAKURA_HELIX_SECONDS = 2.7;
/** The star fox: its sparks, how long it is in the sky and how long its light lingers at the gate. */
const SPIRIT_SPARKS = 110;
export const SAKURA_SPIRIT_FLIGHT = 2.9;
export const SAKURA_SPIRIT_SECONDS = 7.5;
/** The box the blizzard streams through, about the eye: x, y, z as [low, high] in metres. */
const BLIZZARD_BOX = Object.freeze({ x: [-30, 30], y: [0.4, 15], z: [-36, 9] });
/** The gate's light: how wide and tall its shaft stands (metres, before the gate's own scale). */
const GATE_SHAFT = Object.freeze({ width: 13, height: 52 });

/** Offset of a camera-facing sprite vertex around `centre` (TSL); `size` may be a vec2. */
function billboard(centre, sizeX, sizeY = sizeX) {
    const toEye = normalize(cameraPosition.sub(centre));
    const right = normalize(cross(vec3(0, 1, 0), toEye));
    const up = cross(toEye, right);
    return centre.add(right.mul(positionGeometry.x.mul(sizeX))).add(up.mul(positionGeometry.y.mul(sizeY)));
}

function skyDirection(azimuth, elevation, target = new THREE.Vector3()) {
    const a = THREE.MathUtils.degToRad(azimuth);
    const e = THREE.MathUtils.degToRad(elevation);
    return target.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/** Where the gate stands and how tall (its crossbeam is some 7.6 m up at scale 1). */
export function sakuraGatePlace() {
    const { x, z, scale } = SAKURA_TORII;
    const foot = Math.max(SAKURA_WATER_LEVEL, sakuraTerrainHeight(x, z));
    return {
        x, z, foot, top: foot + 7.6 * scale, scale,
    };
}

/**
 * The star fox's way down, as the three points of a curve: out of the Fox among the stars, over
 * the mountain's shoulder, and into the gate. `eye` is where the garden is seen from.
 */
export function sakuraSpiritPath(eye = [0, 4.3, 16]) {
    const fox = SAKURA_CONSTELLATIONS.find((figure) => figure.name === 'The Fox') || SAKURA_CONSTELLATIONS[0];
    const from = skyDirection(fox.at[0], fox.at[1]).multiplyScalar(620).add(new THREE.Vector3(eye[0], eye[1], eye[2]));
    const gate = sakuraGatePlace();
    const to = new THREE.Vector3(gate.x, gate.foot + (gate.top - gate.foot) * 0.55, gate.z);
    // It swings out over the mountain's left flank before it stoops on the gate: the Fox, the
    // summit and the gate stand almost in one line from the eye, and a straight fall would run
    // down the board's edge behind the foxfire.
    const over = skyDirection(fox.at[0] - 10, fox.at[1] - 8).multiplyScalar(300)
        .add(new THREE.Vector3(eye[0], eye[1], eye[2]));
    return { from, over, to };
}

export class SakuraShowpieces {
    /**
     * @param {object} o
     * @param {object} o.light  the garden's light rig
     * @param {object} o.tier   the quality tier (its `blizzard` is how many petals stream)
     * @param {object} [o.blossoms] the flower pack (its `petal_far` is the blizzard's petal)
     * @param {() => number} [o.rng] its own chances (seeded: the garden's sequence is left alone)
     */
    constructor({
        light, tier, blossoms = null, rng = mulberry32(0x5a6b),
    }) {
        this.light = light;
        this.tier = tier;
        this.blossoms = blossoms;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraShowpieces';
        this.owned = [];
        // Crowns of spray: x, z, birth, strength.
        this.splashData = Array.from({ length: SAKURA_SPLASH_SLOTS }, () => new THREE.Vector4(0, 0, -1000, 0));
        this.uSplash = uniformArray(this.splashData, 'vec4');
        // Helices: x, foot y, z, birth; and strength, which way it turns, how tall.
        this.helixData = Array.from({ length: SAKURA_HELIX_SLOTS }, () => new THREE.Vector4(0, 0, 0, -1000));
        this.helixLook = Array.from({ length: SAKURA_HELIX_SLOTS }, () => new THREE.Vector4(0, 1, 5, 0));
        this.uHelix = uniformArray(this.helixData, 'vec4');
        this.uHelixLook = uniformArray(this.helixLook, 'vec4');
        // The blizzard: how much of it is in the air (0..1) and how far the wind has carried it.
        this.uBlizzard = uniform(0);
        this.uCarried = uniform(0);
        this.carriedAt = Number.NaN;
        // The gate's light (0 dark .. 1.6) and the star fox (birth, power).
        this.uGate = uniform(0);
        this.uSpirit = uniform(new THREE.Vector2(-1000, 0));
        this.path = sakuraSpiritPath();
        this.gate = sakuraGatePlace();
        this.arrived = true;
        /** Called once as the star fox goes through the gate: (x, z, power). */
        this.onArrive = null;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.quad = this.own(new THREE.PlaneGeometry(1, 1));
        this.buildSplash();
        this.buildHelix();
        this.buildBlizzard();
        this.buildGate();
        this.buildSpirit();
        return this;
    }

    lightMaterial(name) {
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = name;
        return material;
    }

    /** Spray standing up where a hard-dropped piece went into the lake. */
    buildSplash() {
        const { light } = this;
        const perSlot = SPLASH_DROPS + 1;
        const count = SAKURA_SPLASH_SLOTS * perSlot;
        const data = new Float32Array(count * 4); // slot, two chances, kind (0 a drop, 1 the spout)
        for (let i = 0; i < count; i += 1) {
            const drop = i % perSlot;
            data.set([Math.floor(i / perSlot), this.rng(), this.rng(), drop === SPLASH_DROPS ? 1 : 0], i * 4);
        }
        const part = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.lightMaterial('SakuraSplash');
        const slot = this.uSplash.element(int(part.x.add(0.5)));
        const age = light.uTime.sub(slot.z);
        const strength = slot.w;
        const live = max(age, 0).sign().mul(max(float(SAKURA_SPLASH_SECONDS).sub(age), 0).sign());
        // A drop leaves the water on a throw of its own and falls back: a crown, then rain.
        const angle = part.y.mul(TAU);
        const out = part.z.mul(1.2).add(0.45).mul(strength.mul(0.9).add(0.5));
        const throwUp = fract(part.y.mul(7.31)).mul(2.6).add(2.3).mul(strength.sqrt());
        const height = throwUp.mul(age).sub(age.mul(age).mul(4.9));
        const flying = max(height, 0).sign();
        const drop = vec3(
            slot.x.add(cos(angle).mul(out).mul(age)),
            float(SAKURA_WATER_LEVEL + 0.04).add(max(height, 0)),
            slot.y.add(sin(angle).mul(out).mul(age)),
        );
        // The spout in the middle stands up at once and sinks back within half a second.
        const stand = sin(saturate(age.div(0.5)).mul(Math.PI)).mul(strength.mul(1.5).add(0.6));
        const spout = vec3(slot.x, float(SAKURA_WATER_LEVEL).add(stand.mul(0.5)), slot.y);
        const kind = part.w;
        const dropSize = fract(part.z.mul(13.7)).mul(0.12).add(0.1).mul(strength.mul(0.6).add(0.7))
            .mul(flying);
        const centre = mix(drop, spout, kind);
        material.positionNode = billboard(
            centre,
            mix(dropSize, strength.mul(0.5).add(0.45), kind).mul(live),
            mix(dropSize, stand.add(0.05), kind).mul(live),
        );
        const st = uv().sub(0.5);
        const reach = length(st).mul(2);
        const bead = exp(reach.mul(reach).mul(-7)).mul(saturate(float(1).sub(reach)));
        const column = exp(st.x.mul(st.x).mul(-26)).mul(saturate(float(1).sub(st.y.abs().mul(2)))).mul(0.7);
        const fade = saturate(float(1).sub(age.div(SAKURA_SPLASH_SECONDS)));
        // Water in moonlight, with a blush of the ring's rose in it.
        material.colorNode = light.uMoonColor.mul(1.5).add(vec3(0.5, 0.26, 0.4))
            .mul(mix(bead, column, kind)).mul(fade.mul(0.7).add(0.3))
            .mul(live)
            .mul(strength.mul(0.5).add(0.6));
        const mesh = new THREE.InstancedMesh(this.quad, material, count);
        mesh.name = 'SakuraSplash';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 24;
        this.splashMesh = mesh;
        this.group.add(mesh);
    }

    /** A crown of spray at world (x, z) on the lake; `strength` 0..1 is how far the piece fell. */
    splash(x, z, strength = 0.6) {
        if (!(strength > 0) || !Number.isFinite(x) || !Number.isFinite(z)) return false;
        const now = this.light.uTime.value;
        let chosen = 0;
        let least = Infinity;
        for (let index = 0; index < SAKURA_SPLASH_SLOTS; index += 1) {
            const age = now - this.splashData[index].z;
            const left = age >= SAKURA_SPLASH_SECONDS || age < 0 ? 0
                : this.splashData[index].w * (1 - age / SAKURA_SPLASH_SECONDS);
            if (left < least) {
                least = left;
                chosen = index;
            }
        }
        this.splashData[chosen].set(x, z, now, Math.min(1, Math.max(0.15, strength)));
        return true;
    }

    /** The twist's double helix of lit petals. */
    buildHelix() {
        const { light } = this;
        const count = SAKURA_HELIX_SLOTS * HELIX_PETALS;
        const data = new Float32Array(count * 4); // slot, how far up its strand, which strand, a chance
        const perStrand = HELIX_PETALS / 2;
        for (let i = 0; i < count; i += 1) {
            const within = i % HELIX_PETALS;
            data.set([
                Math.floor(i / HELIX_PETALS), ((within % perStrand) + 0.5) / perStrand, within < perStrand ? 0 : 1,
                this.rng(),
            ], i * 4);
        }
        const part = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.lightMaterial('SakuraHelix');
        const index = int(part.x.add(0.5));
        const slot = this.uHelix.element(index);
        const look = this.uHelixLook.element(index);
        const age = light.uTime.sub(slot.w);
        const live = max(age, 0).sign().mul(max(float(SAKURA_HELIX_SECONDS).sub(age), 0).sign());
        const along = part.y;
        // It winds itself up from the ground, turns as one, then opens out and lets go.
        const grown = smoothstep(0, 0.6, age);
        const opened = smoothstep(1.35, 2.5, age);
        const shown = saturate(grown.mul(1.04).sub(along.mul(0.98)).mul(14));
        const angle = part.z.mul(Math.PI).add(along.mul(TAU * 2.3)).add(age.mul(4.6)).mul(look.y);
        const radius = along.mul(0.7).add(0.38).mul(grown.mul(0.35).add(0.65)).mul(opened.mul(1.8).add(1));
        const centre = vec3(
            slot.x.add(cos(angle).mul(radius)),
            slot.y.add(along.mul(look.z).mul(grown.mul(0.7).add(0.3))).add(opened.mul(along).mul(1.4)),
            // (Flattened toward the eye, so it reads as a helix from where the game stands.)
            slot.z.add(sin(angle).mul(radius).mul(0.55)),
        );
        const fade = opened.oneMinus();
        const size = part.w.mul(0.16).add(0.24).mul(shown).mul(fade.mul(0.6).add(0.4))
            .mul(look.x)
            .mul(live);
        material.positionNode = billboard(centre, size);
        // A petal of light: a pointed oval turned its own way, in a halo.
        const st = uv().sub(0.5);
        const turn = part.w.mul(TAU).add(age.mul(part.w.mul(4).add(2)));
        const turned = vec2(
            st.x.mul(cos(turn)).sub(st.y.mul(sin(turn))),
            st.x.mul(sin(turn)).add(st.y.mul(cos(turn))),
        );
        const reach = length(st).mul(2);
        const blade = exp(turned.x.mul(turned.x).mul(30).add(turned.y.mul(turned.y).mul(120)).negate());
        const halo = exp(reach.mul(reach).mul(-5)).mul(0.16);
        const glint = sin(light.uTime.mul(part.w.mul(9).add(7)).add(part.w.mul(53))).mul(0.2).add(0.8);
        // Rose at its foot, gold-white at its head.
        const colour = mix(vec3(1.9, 0.5, 0.95), vec3(2.3, 1.55, 1.2), along);
        material.colorNode = colour.mul(blade.add(halo)).mul(saturate(float(1).sub(reach)))
            .mul(shown).mul(fade)
            .mul(glint)
            .mul(live)
            .mul(look.x);
        const mesh = new THREE.InstancedMesh(this.quad, material, count);
        mesh.name = 'SakuraHelix';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 29;
        this.helixMesh = mesh;
        this.group.add(mesh);
    }

    /**
     * Wind a helix up at world (x, y, z) (its foot); `side` is which way it turns (the side of the
     * board the twist was on), `height` how tall it stands.
     */
    helix(x, y, z, side = 1, strength = 1, height = 5) {
        if (!(strength > 0) || ![x, y, z].every(Number.isFinite)) return false;
        const now = this.light.uTime.value;
        let chosen = 0;
        let oldest = -Infinity;
        for (let index = 0; index < SAKURA_HELIX_SLOTS; index += 1) {
            const age = now - this.helixData[index].w;
            const spent = age >= SAKURA_HELIX_SECONDS || age < 0 ? Infinity : age;
            if (spent > oldest) {
                oldest = spent;
                chosen = index;
            }
        }
        this.helixData[chosen].set(x, y, z, now);
        this.helixLook[chosen].set(Math.min(1.3, Math.max(0.3, strength)), side < 0 ? -1 : 1, Math.max(2, height), 0);
        return true;
    }

    /** The blizzard: petals streaming through the whole garden on the wind. */
    buildBlizzard() {
        const { light } = this;
        const count = Math.max(0, Math.round(this.tier.blizzard || 0));
        const petal = this.blossoms?.meshes?.petal_far || this.blossoms?.meshes?.petal;
        if (!count || !petal) return;
        const homes = new Float32Array(count * 4); // where in the box it starts, and its chance
        const looks = new Float32Array(count * 4); // its rank, its size, its tone, how it tumbles
        for (let i = 0; i < count; i += 1) {
            homes.set([this.rng(), this.rng(), this.rng(), this.rng()], i * 4);
            looks.set([(i + 0.5) / count, 0.15 + this.rng() * 0.13, this.rng(), this.rng()], i * 4);
        }
        const home = instancedBufferAttribute(new THREE.InstancedBufferAttribute(homes, 4));
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(looks, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SakuraPetalBlizzard';
        const t = light.uTime;
        const box = BLIZZARD_BOX;
        const span = [box.x[1] - box.x[0], box.y[1] - box.y[0], box.z[1] - box.z[0]];
        const seed = home.w;
        // Each petal rides the wind across the box and comes round; it sinks, side-slipping.
        const fall = seed.mul(0.7).add(0.75);
        const slip = sin(t.mul(seed.mul(1.6).add(1.1)).add(seed.mul(41)));
        const ride = light.uWindDir.mul(this.uCarried.mul(seed.mul(0.5).add(0.75)));
        const x = fract(home.x.add(ride.x.div(span[0])).add(slip.mul(0.012))).mul(span[0]).add(box.x[0]);
        const y = fract(home.y.sub(t.mul(fall).div(span[1]))).mul(span[1]).add(box.y[0]);
        const z = fract(home.z.add(ride.z.div(span[2])).add(slip.mul(0.008))).mul(span[2]).add(box.z[0]);
        const centre = vec3(x, y.add(slip.mul(0.25)), z);
        // More of them as the blizzard thickens; each grows in rather than appearing.
        const shown = saturate(this.uBlizzard.sub(look.x.mul(0.94)).mul(9));
        // (None right at the lens, none where the box comes round, none at the ground.)
        const near = smoothstep(1.5, 6, length(centre.sub(cameraPosition)));
        const inside = smoothstep(box.x[0], box.x[0] + 4, x).mul(smoothstep(box.x[1] - 4, box.x[1], x).oneMinus())
            .mul(smoothstep(box.y[0], box.y[0] + 1.2, y)).mul(smoothstep(box.y[1] - 2, box.y[1], y).oneMinus())
            .mul(smoothstep(box.z[0], box.z[0] + 5, z));
        const size = look.y.mul(shown).mul(near).mul(inside);
        // It tumbles about two axes as it goes.
        const roll = t.mul(look.w.mul(3.4).add(2.2)).add(seed.mul(TAU));
        const pitch = t.mul(look.w.mul(2.1).add(1.3)).add(seed.mul(17));
        const local = positionGeometry.mul(size);
        const rolled = vec3(
            local.x.mul(cos(roll)).sub(local.y.mul(sin(roll))),
            local.x.mul(sin(roll)).add(local.y.mul(cos(roll))),
            local.z,
        );
        const tipped = vec3(
            rolled.x,
            rolled.y.mul(cos(pitch)).sub(rolled.z.mul(sin(pitch))),
            rolled.y.mul(sin(pitch)).add(rolled.z.mul(cos(pitch))),
        );
        material.positionNode = positionLocal.sub(positionGeometry).add(tipped).add(centre);
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const petalColour = mix(vec3(1.0, 0.86, 0.9), vec3(1.0, 0.56, 0.72), look.z);
        // Lit like a petal in the air, without the shadow map: the sky, the moon behind it, and the
        // blossom's own glow when the garden answers the game.
        const through = pow(saturate(view.dot(light.uMoonDir).negate()), 3);
        const lit = petalColour.mul(light.ambient(vec3(0, 1, 0)).mul(1.7)
            .add(light.uMoonColor.mul(through.mul(0.9).add(0.2)))
            .add(vec3(1.0, 0.5, 0.7).mul(light.uGlow.mul(0.45))));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        const mesh = new THREE.InstancedMesh(petal, material, count);
        mesh.name = 'SakuraPetalBlizzard';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.blizzardMesh = mesh;
        this.group.add(mesh);
    }

    /** The light that stands in the gate, and the glow at its feet. */
    buildGate() {
        const { light, gate } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        const material = this.lightMaterial('SakuraGateLight');
        const width = GATE_SHAFT.width * gate.scale;
        const height = GATE_SHAFT.height * gate.scale;
        const foot = vec3(gate.x, gate.foot, gate.z);
        // The shaft turns to the eye about its own upright, and stands on the water.
        const toEye = normalize(vec3(cameraPosition.x.sub(gate.x), 0, cameraPosition.z.sub(gate.z)));
        const right = cross(vec3(0, 1, 0), toEye);
        const power = this.uGate;
        // (Dark, the shaft is folded onto its foot: nothing of it is shaded.)
        const lit = max(power.sub(0.004), 0).sign();
        material.positionNode = foot
            .add(right.mul(positionGeometry.x.mul(width).mul(lit)))
            .add(vec3(0, 1, 0).mul(positionGeometry.y.add(0.5).mul(height).mul(lit)));
        const st = uv();
        const across = st.x.sub(0.5).mul(2);
        const rise = st.y;
        const t = light.uTime;
        // A core the width of the gate inside a soft sheath; brightest in the gate itself and
        // thinning into the sky; the light climbs.
        const core = exp(across.mul(across).mul(-70)).add(exp(across.mul(across).mul(-9)).mul(0.36));
        const stand = pow(rise.oneMinus(), 1.6).mul(smoothstep(0.0, 0.03, rise))
            .mul(smoothstep(0.0, 0.5, power.sub(rise.mul(0.9))));
        const climb = light.noise(vec2(across.mul(0.11).add(0.3), rise.mul(1.4).sub(t.mul(0.33)))).g.mul(0.7).add(0.55);
        const colour = mix(vec3(2.0, 0.78, 0.5), vec3(1.0, 1.15, 1.9), smoothstep(0.02, 0.5, rise));
        material.colorNode = colour.mul(core).mul(stand).mul(climb).mul(power)
            .mul(0.5)
            .mul(saturate(float(1).sub(across.abs())));
        const shaft = new THREE.Mesh(geometry, material);
        shaft.name = 'SakuraGateLight';
        shaft.frustumCulled = false;
        shaft.matrixAutoUpdate = false;
        shaft.renderOrder = 21;
        this.gateMesh = shaft;
        this.group.add(shaft);
        // And a low warm glow about the gate's feet, on the water.
        const pool = this.lightMaterial('SakuraGateGlow');
        pool.positionNode = billboard(vec3(gate.x, gate.foot + 2.4 * gate.scale, gate.z), lit.mul(15 * gate.scale));
        const reach = length(uv().sub(0.5)).mul(2);
        pool.colorNode = vec3(2.0, 0.8, 0.5).mul(exp(reach.mul(reach).mul(-4.5))).mul(saturate(float(1).sub(reach)))
            .mul(power)
            .mul(0.16);
        const glow = new THREE.Mesh(geometry, pool);
        glow.name = 'SakuraGateGlow';
        glow.frustumCulled = false;
        glow.matrixAutoUpdate = false;
        glow.renderOrder = 21;
        this.gateGlow = glow;
        this.group.add(glow);
    }

    /** The star fox: a head of cold fire and the sparks it trails, on its way down to the gate. */
    buildSpirit() {
        const { light, path } = this;
        const data = new Float32Array(SPIRIT_SPARKS * 2); // how far behind the head (0 the head), a chance
        for (let i = 0; i < SPIRIT_SPARKS; i += 1) data.set([i / (SPIRIT_SPARKS - 1), this.rng()], i * 2);
        const part = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 2));
        const material = this.lightMaterial('SakuraStarFox');
        const t = light.uTime;
        const age = t.sub(this.uSpirit.x);
        const power = this.uSpirit.y;
        const live = max(age, 0).sign().mul(max(float(SAKURA_SPIRIT_FLIGHT + 1.2).sub(age), 0).sign());
        // The head eases out of the stars, gathers speed and stoops on the gate.
        const flown = saturate(age.div(SAKURA_SPIRIT_FLIGHT));
        const head = flown.mul(flown).mul(float(3).sub(flown.mul(2)));
        const behind = part.x;
        // Each spark is where the head was a little earlier; the trail shortens as it arrives.
        const at = saturate(head.sub(behind.mul(0.42).mul(float(1).sub(head.mul(0.55)))));
        const a = vec3(path.from.x, path.from.y, path.from.z);
        const b = vec3(path.over.x, path.over.y, path.over.z);
        const c = vec3(path.to.x, path.to.y, path.to.z);
        const one = at.oneMinus();
        const point = a.mul(one.mul(one)).add(b.mul(one.mul(at).mul(2))).add(c.mul(at.mul(at)));
        const far = length(point.sub(cameraPosition));
        // The sparks shake loose of the line the further behind they are.
        const shake = vec3(
            sin(part.y.mul(TAU).add(t.mul(part.y.mul(5).add(3)))),
            sin(part.y.mul(31).add(t.mul(part.y.mul(4).add(2.5)))),
            sin(part.y.mul(57).add(t.mul(3.3))),
        ).mul(behind.mul(far).mul(0.02));
        const centre = point.add(shake);
        // Seen sizes: the head a degree and a half across, the sparks dwindling behind it.
        const begun = max(head.sub(behind.mul(0.02)), 0).sign();
        const gone = smoothstep(SAKURA_SPIRIT_FLIGHT, SAKURA_SPIRIT_FLIGHT + 1.0, age).oneMinus();
        const seen = mix(float(0.075), part.y.mul(0.02).add(0.011), smoothstep(0.0, 0.05, behind))
            .mul(float(1).sub(behind.mul(0.55))).mul(power.mul(0.4).add(0.6));
        material.positionNode = billboard(centre, far.mul(seen).mul(live).mul(begun).mul(gone));
        const reach = length(uv().sub(0.5)).mul(2);
        const spark = exp(reach.mul(reach).mul(-16)).add(exp(reach.mul(-4)).mul(0.2))
            .mul(saturate(float(1).sub(reach)));
        const flicker = sin(t.mul(part.y.mul(17).add(11)).add(part.y.mul(91))).mul(0.3).add(0.7);
        // Cold fire at its head, rose and then gold down the trail.
        const colour = mix(
            mix(vec3(1.3, 1.9, 2.6), vec3(2.2, 0.8, 1.3), smoothstep(0.0, 0.35, behind)),
            vec3(2.0, 1.3, 0.6),
            smoothstep(0.4, 1.0, behind),
        );
        material.colorNode = colour.mul(spark).mul(flicker).mul(float(1).sub(behind.mul(0.75)))
            .mul(live)
            .mul(gone)
            .mul(power);
        const mesh = new THREE.InstancedMesh(this.quad, material, SPIRIT_SPARKS);
        mesh.name = 'SakuraStarFox';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 31;
        this.spiritMesh = mesh;
        this.group.add(mesh);
    }

    /** Send the star fox down through the gate. One at a time: a second waits out the first. */
    spirit(power = 1) {
        const now = this.light.uTime.value;
        const age = now - this.uSpirit.value.x;
        if (age >= 0 && age < SAKURA_SPIRIT_FLIGHT) return false;
        this.uSpirit.value.set(now, Math.min(1.3, Math.max(0.4, power)));
        this.arrived = false;
        return true;
    }

    /** How brightly the star fox has left the gate burning, `age` seconds after it set out. */
    static afterglow(age) {
        if (!(age >= SAKURA_SPIRIT_FLIGHT - 0.15) || age >= SAKURA_SPIRIT_SECONDS) return 0;
        const since = age - (SAKURA_SPIRIT_FLIGHT - 0.15);
        const rise = Math.min(1, since / 0.3);
        return rise * rise * (3 - 2 * rise) * Math.exp(-Math.max(0, since - 0.3) / 1.7)
            * Math.min(1, (SAKURA_SPIRIT_SECONDS - age) / 1.2);
    }

    reset() {
        this.splashData.forEach((slot) => slot.set(0, 0, -1000, 0));
        this.helixData.forEach((slot) => slot.set(0, 0, 0, -1000));
        this.uSpirit.value.set(-1000, 0);
        this.uGate.value = 0;
        this.uBlizzard.value = 0;
        this.arrived = true;
    }

    /**
     * The frame's showpieces. `frame` is the reactions' frame: `blizzard` (the four-line storm),
     * `corona` (back-to-backs in a row: the gate's light), `fever`; `stream` is how much of the
     * blizzard the air itself keeps going (the petal wind's weather).
     */
    update(time, dt, frame = {}, stream = 0) {
        const clamp = (value, top = 1) => (Number.isFinite(value) ? Math.max(0, Math.min(top, value)) : 0);
        const { light } = this;
        // The blizzard rides the wind: how far it has been carried is the wind's own sum, so a
        // change of wind never jumps a petal.
        const now = light.uTime.value;
        const step = now - this.carriedAt;
        this.carriedAt = now;
        const speed = 1.2 + light.uWind.value * 9 + light.uGust.value * 2.5;
        if (step > 0 && step <= 0.5) this.uCarried.value += step * speed;
        else if (step !== 0) this.uCarried.value = now * (1.2 + 0.24 * 9);
        const motion = Number.isFinite(frame.motion) ? clamp(frame.motion) : 1;
        this.uBlizzard.value = clamp(Math.max(clamp(stream), clamp(frame.blizzard), 0.22 * clamp(frame.fever)))
            * (0.45 + 0.55 * motion);
        // The gate: back-to-backs light it, and the star fox leaves it blazing.
        const spiritAge = now - this.uSpirit.value.x;
        const blaze = SakuraShowpieces.afterglow(spiritAge) * this.uSpirit.value.y;
        this.uGate.value = Math.min(1.6, Math.max(clamp(frame.corona, 1.6) * 0.72, blaze * 1.6));
        if (!this.arrived && spiritAge >= SAKURA_SPIRIT_FLIGHT) {
            this.arrived = true;
            this.onArrive?.(this.gate.x, this.gate.z, this.uSpirit.value.y);
        }
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
