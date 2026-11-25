/**
 * Fall — drawing the leaves in the air.
 *
 * One instanced draw of the maple leaf mesh. Positions and orientations come straight from
 * FallLeafSim's typed arrays; the blades are lit as thin translucent surfaces by the shared
 * light rig, so a falling leaf flares gold as it crosses a sun shaft. Leaves spawned by
 * gameplay can also glow like embers while a long combo holds, and in hot play every leaf in
 * the air turns from gold toward crimson.
 *
 * A leaf's light is held under a ceiling that keeps its hue (the brightest channel is brought
 * down to the ceiling and the others with it): a hundred thrown leaves crossing the sun's glare
 * at once stay gold and orange instead of blooming into one cream mass. An ember is heat at the
 * leaf's edge, in a deep saturated orange, over a blade that has darkened: never a white wash.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cross, dot, faceDirection, float, instancedBufferAttribute, max, mix, normalGeometry,
    normalize, positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uniform, uv, varying,
    vec3, vec4,
} from 'three/tsl';
import { FallLeafSim } from './fall-leaf-sim.js';
import { fallTerrainHeight } from './fall-terrain.js';

const MAPLE = [0x5c0a08, 0xa8200a, 0xd0560c, 0xdc9416];
const OAK = [0x4a1c0a, 0x7c3a0c, 0xa8620f, 0xc08a1c];
const BIRCH = [0xb8780c, 0xd8a012, 0xe8c226, 0xdcd04a];
const RESERVE_SHARE = 0.38;
/** How far down its colour ramp a leaf slides at a full turn of play (FallLight.uTurn). */
const TURN_SHIFT = 0.32;
/** What a fully turned leaf keeps of its backlit glow, per channel (deeper, redder). */
const TURN_GLOW = Object.freeze([1.0, 0.58, 0.34]);
/** How much less light a fully turned leaf lets through, and the colour its embers burn. */
const TURN_DIM = 0.45;
const TURN_EMBER = Object.freeze([2.3, 0.36, 0.03]);
/** The colour an ember burns before the leaves have turned, and how far the blade under it darkens. */
const EMBER = Object.freeze([2.4, 0.62, 0.07]);
const EMBER_CHAR = 0.5;
/** The most light a leaf gives back (its brightest channel): a thrown leaf, and one the grove let fall. */
const LEAF_CEILING = Object.freeze({ thrown: 2.3, fallen: 3.4 });

function ramp(stops, t) {
    const scaled = t.mul(stops.length - 1);
    let result = color(stops[0]);
    for (let i = 1; i < stops.length; i += 1) {
        result = mix(result, color(stops[i]), smoothstep(i - 1, i, scaled));
    }
    return result;
}

/** Rotate a vector by a unit quaternion (TSL). */
function rotate(vector, quaternion) {
    const axis = quaternion.xyz;
    return vector.add(cross(axis, cross(axis, vector).add(vector.mul(quaternion.w))).mul(2));
}

export class FallLeaves {
    constructor({
        light, foliage, tier, rng = Math.random, crownPoints = null,
    }) {
        this.light = light;
        this.foliage = foliage;
        this.tier = tier;
        this.rng = rng;
        this.crownPoints = crownPoints;
        this.group = new THREE.Group();
        this.group.name = 'FallLeavesInTheAir';
        this.uHeat = uniform(0);
        this.owned = [];
    }

    build() {
        const count = this.tier.leaves;
        this.sim = new FallLeafSim({
            count,
            reserve: Math.round(count * RESERVE_SHARE),
            rng: this.rng,
            groundHeight: fallTerrainHeight,
            crownPoints: this.crownPoints,
        });
        const geometry = this.foliage.meshes.leaf_maple;
        if (!geometry) throw new Error('[Fall] The foliage pack has no "leaf_maple" mesh.');
        const { sim, light } = this;
        this.positions = new THREE.InstancedBufferAttribute(sim.outPosition, 4);
        this.rotations = new THREE.InstancedBufferAttribute(sim.outRotation, 4);
        this.positions.setUsage(THREE.DynamicDrawUsage);
        this.rotations.setUsage(THREE.DynamicDrawUsage);
        const lookData = new Float32Array(count * 4); // tone, species, event leaf, random
        for (let i = 0; i < count; i += 1) {
            const roll = this.rng();
            let species = 0;
            if (roll > 0.8) species = 2;
            else if (roll > 0.58) species = 1;
            lookData.set([this.rng(), species, i >= sim.ambient ? 1 : 0, this.rng()], i * 4);
        }
        const place = instancedBufferAttribute(this.positions);
        const turn = instancedBufferAttribute(this.rotations);
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(lookData, 4));
        const paint = attribute('color', 'vec4');
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'FallLeavesInTheAir';
        const local = rotate(positionGeometry.mul(place.w), turn);
        material.positionNode = positionLocal.sub(positionGeometry).add(local).add(place.xyz);
        const blade = normalize(varying(rotate(normalGeometry, turn))).mul(float(faceDirection));

        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        // As play heats the leaves turn: every one slides down its ramp, gold toward crimson.
        const tone = saturate(look.x.add(paint.r.sub(0.5).mul(0.2)).sub(light.uTurn.mul(TURN_SHIFT)));
        const leaf = mix(
            mix(ramp(MAPLE, tone), ramp(OAK, tone), saturate(look.y)),
            ramp(BIRCH, tone),
            saturate(look.y.sub(1)),
        );
        const vein = smoothstep(0.02, 0.09, uv().x.sub(0.5).abs()).mul(0.14).add(0.86);
        const albedo = leaf.mul(vein).mul(paint.b);
        // Turned leaves burn deeper when the sun is behind them: less gold, more flame.
        const glowing = pow(leaf, vec3(0.78)).mul(vec3(1.3, 1.08, 0.66))
            .mul(mix(vec3(1), vec3(...TURN_GLOW), light.uTurn));
        const sun = light.sunlight();
        const facing = dot(blade, light.uSunDir);
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3);
        const front = albedo.mul(saturate(facing.mul(0.6).add(0.4)));
        // A turned leaf lets less light through: it glows deep instead of washing out to cream.
        const back = glowing.mul(saturate(facing.negate()).mul(0.6).add(through.mul(1.3)))
            .mul(float(1).sub(light.uTurn.mul(TURN_DIM)));
        // Embers: leaves thrown by a long combo burn at their edges, redder as the leaves turn. The
        // heat is the rim's alone (the outer part of the blade, by its tip weight), the blade under
        // it darkens, and the colour is a deep orange with almost no blue: it reads as fire, not light.
        const flicker = sin(light.uTime.mul(9).add(look.w.mul(40))).mul(0.25).add(0.75);
        const burning = this.uHeat.mul(look.z);
        const rim = smoothstep(0.4, 0.95, paint.r);
        const ember = mix(vec3(...EMBER), vec3(...TURN_EMBER), light.uTurn).mul(burning).mul(flicker).mul(rim);
        const sunlit = front.add(back).mul(light.uSunColor).mul(sun)
            .add(albedo.mul(light.ambient(blade)).mul(1.5))
            .add(glowing.mul(light.uSunColor).mul(0.03))
            .mul(float(1).sub(burning.mul(EMBER_CHAR)));
        // The ceiling that keeps the hue: the brightest channel comes down to it, the others with it.
        const ceiling = mix(float(LEAF_CEILING.fallen), float(LEAF_CEILING.thrown), look.z);
        const peak = max(max(sunlit.r, sunlit.g), max(sunlit.b, 0.0001));
        const lit = sunlit.mul(ceiling.div(max(peak, ceiling))).add(ember);
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'FallLeavesInTheAir';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(material);
        return this;
    }

    reset() {
        this.sim?.reset();
        this.markDirty();
    }

    markDirty() {
        if (this.positions) this.positions.needsUpdate = true;
        if (this.rotations) this.rotations.needsUpdate = true;
    }

    update(dt, env, heat = 0) {
        if (!this.sim) return;
        this.uHeat.value = Number.isFinite(heat) ? Math.max(0, Math.min(1, heat)) : 0;
        this.sim.step(dt, env);
        this.markDirty();
    }

    dispose() {
        this.mesh?.dispose();
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.sim = null;
        this.mesh = null;
    }
}
