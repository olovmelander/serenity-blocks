/**
 * Fall — sky and air.
 *
 * The sky dome and its cloud deck (and, at night, its moon and stars), banks of mist between the
 * trunks and the ground mist of a still morning, gold dust that only shows where the sun reaches
 * it, rain falling through the light, dew on a few threads of gossamer, and the fireflies that come
 * out with the dusk. All of it reads the shared light rig, so the forest dissolves into exactly the
 * colour that is behind it and the dust sparkles in the same shafts the shadow map carves.
 *
 * What the airs (fall-airs.js) and the night (fall-moods.js) change here is read from the rig's
 * uniforms; what only shows in some air is hidden outright while it is out (update()).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, attribute, cameraPosition, clamp, color, cos, cross, dot, exp, float, floor, fract, hash,
    instancedBufferAttribute, length, max, mix, normalize, positionGeometry, positionLocal, positionWorld, pow,
    saturate, sin, smoothstep, step, uv, vec2, vec3,
} from 'three/tsl';
import { fallWorldTier } from './fall-airs.js';
import { FALL_SUN_DIRECTION } from './fall-light.js';
import { fallTerrainHeight } from './fall-terrain.js';

const TAU = Math.PI * 2;
/** How large the harvest moon stands (radians from its middle to its limb: about six of the real moon). */
const MOON_RADIUS = 0.052;
/** Where the near sheets of ground mist stand (z), nearest last. */
const GROUND_MIST = Object.freeze([-9, 0.5, 7]);
/** The column the rain falls through (m), and how fast (m/s). */
const RAIN_TOP = 15;
const RAIN_SPEED = 11;

/** A small seeded generator (mulberry32) for what this pass adds (the grove's own draws stay as they were). */
function seeded(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), state | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class FallAtmosphere {
    constructor({
        light, tier, rng = Math.random, quality = 'High',
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.worldTier = fallWorldTier(quality);
        this.group = new THREE.Group();
        this.group.name = 'FallAir';
        this.owned = [];
        this.groundMist = [];
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.buildSky();
        this.buildMist();
        this.buildMotes();
        this.buildGossamer();
        this.buildFireflies();
        this.buildRain();
        this.update();
        return this;
    }

    /**
     * A clear autumn sky late in the afternoon: clean blue overhead, gold low toward the sun and
     * a rose haze opposite, under a loose deck of fair-weather cloud seen from below. The low
     * sun lights the deck's undersides gold on its own side and rose away from it, its bodies
     * stay a soft lavender grey, and thin edges near the sun take a silver lining.
     *
     * The airs close the deck (a shower) and send scud racing under it (a windy day); a ground mist
     * takes the low sky. At night the harvest moon stands where the sun stood and the stars are out
     * in the gaps.
     */
    buildSky() {
        const { light } = this;
        const { stars } = this.worldTier;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'FallSkyDome';
        // The moon's own frame on the sky (the sun never moves, so neither does it).
        const moonRight = new THREE.Vector3().crossVectors(FALL_SUN_DIRECTION, new THREE.Vector3(0, 1, 0)).normalize();
        const moonUp = new THREE.Vector3().crossVectors(moonRight, FALL_SUN_DIRECTION).normalize();
        material.colorNode = Fn(() => {
            const direction = normalize(positionWorld.sub(cameraPosition)).toVar();
            const up = direction.y.toVar();
            const facing = dot(direction, light.uSunDir).toVar();
            const sunward = saturate(facing).toVar();
            const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
            const toward = dot(flat, normalize(vec2(light.uSunDir.x, light.uSunDir.z))).mul(0.5).add(0.5).toVar();
            const night = light.uNight.toVar();
            const disc = pow(sunward, 2600).mul(9).add(pow(sunward, 320).mul(0.9)).mul(night.oneMinus())
                .toVar();

            // The deck, as a plane above the grove. A slow warp folds it into rows and heaps;
            // it thins out below about ten degrees, where a flat deck would read as dashes.
            const plane = vec2(direction.x, direction.z).div(up.add(0.11)).toVar();
            const drift = vec2(light.uTime.mul(0.0011), light.uTime.mul(0.0004));
            const warp = light.noise(plane.mul(0.045).add(drift.mul(0.4))).rg.sub(0.5).mul(1.3);
            const q = plane.mul(vec2(0.11, 0.16)).add(warp).add(drift).toVar();
            const broad = light.noise(q);
            const fine = light.noise(q.mul(2.6).add(vec2(0.31, 0.17)));
            const shape = broad.g.mul(0.52).add(broad.b.mul(0.27)).add(fine.b.mul(0.13)).add(fine.a.mul(0.08));
            const deck = smoothstep(0.07, 0.3, up).toVar();
            // (An air closes the deck: both edges of the cut come down together.)
            const closing = light.uCover.mul(0.21);
            const density = smoothstep(float(0.48).sub(closing), float(0.78).sub(closing), shape).mul(deck).toVar();

            // Light on the deck: the undersides take the low sun, gold on its side, rose away
            // from it; the thick middles stay in their own shade; thin edges near the sun glow.
            const warmSide = pow(toward, 2.2).toVar();
            // (The light sets each of these: fall-moods.js.)
            const underside = mix(light.uCloudShade, light.uCloudLit, warmSide).toVar();
            const body = mix(light.uCloudBody, light.uCloudBodyWarm, warmSide).toVar();
            const thin = float(1).sub(density).toVar();
            const cloud = mix(body, underside, thin.mul(0.7).add(0.18))
                .add(light.uSunColor.mul(pow(sunward, 7).mul(thin).mul(density.mul(1.6)))).toVar();
            const sky = light.sky(direction).toVar();

            // Night: stars in the gaps, and the harvest moon where the sun stood. Both lie behind the
            // deck, so the cloud crosses them. (Skipped whole by day.)
            If(night.greaterThan(0.004), () => {
                if (stars) {
                    const cells = direction.mul(86).add(160).toVar();
                    const cell = floor(cells).toVar();
                    const id = cell.x.mul(157).add(cell.y.mul(113)).add(cell.z.mul(271)).toVar();
                    const speck = fract(cells).sub(0.5)
                        .sub(vec3(hash(id), hash(id.add(5)), hash(id.add(9))).sub(0.5).mul(0.6));
                    const lit = step(0.9, hash(id.add(13)));
                    const size = hash(id.add(17)).toVar();
                    const point = float(1).sub(smoothstep(0.05, size.mul(0.1).add(0.1), length(speck)));
                    const twinkle = sin(light.uTime.mul(size.mul(2.2).add(1.1)).add(size.mul(40))).mul(0.25).add(0.75);
                    const tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.7), hash(id.add(23)));
                    // (The low sky's own air puts the stars out toward the horizon, and the moon's glare round it.)
                    const seen = smoothstep(0.03, 0.3, up).mul(float(1).sub(smoothstep(0.9, 0.995, facing)));
                    sky.addAssign(tint.mul(point.mul(lit).mul(twinkle).mul(size.mul(1.5).add(0.5)).mul(seen)
                        .mul(night)
                        .mul(1.1)));
                }
                // The moon: a disc with a soft limb, darker toward it, and its seas; amber-white; a wide aureole.
                const mx = dot(direction, vec3(moonRight.x, moonRight.y, moonRight.z)).div(Math.sin(MOON_RADIUS));
                const my = dot(direction, vec3(moonUp.x, moonUp.y, moonUp.z)).div(Math.sin(MOON_RADIUS));
                const across = vec2(mx, my).toVar();
                const edge = Math.cos(MOON_RADIUS);
                const face = smoothstep(edge - 0.00009, edge + 0.00006, facing);
                const seas = light.noise(across.mul(0.11).add(vec2(0.37, 0.61))).g.mul(0.62)
                    .add(light.noise(across.mul(0.27).add(vec2(0.13, 0.29))).b.mul(0.38));
                const relief = mix(float(1), float(0.6), smoothstep(0.44, 0.62, seas))
                    .mul(float(1).sub(saturate(dot(across, across)).mul(0.22)));
                const aureole = pow(sunward, 420).mul(0.5).add(pow(sunward, 40).mul(0.07));
                sky.addAssign(vec3(1.0, 0.87, 0.64).mul(face.mul(relief).mul(5.2).add(aureole)).mul(night));
            });

            const composed = mix(sky, cloud, density.mul(0.88)).toVar();
            // Scud: fast low cloud under the deck on a windy day, in its own shade.
            const scudAt = plane.mul(vec2(0.2, 0.27)).add(vec2(light.uTime.mul(0.019), light.uTime.mul(0.006)));
            const scudShape = light.noise(scudAt).g.mul(0.62).add(light.noise(scudAt.mul(2.3)).b.mul(0.38));
            const scud = smoothstep(0.52, 0.76, scudShape).mul(deck).mul(light.uScud);
            composed.assign(mix(composed, mix(body, underside, 0.42).mul(0.92), scud.mul(0.72)));
            composed.addAssign(light.uSunColor.mul(disc));
            // A ground mist takes the low sky into its own air.
            const air = light.uHazeCool.add(light.uHazeWarm.mul(pow(sunward, 3).mul(0.55)));
            return mix(composed, air, saturate(light.uMist.mul(exp(max(up, 0).mul(-7)))).mul(0.86));
        })();
        const sky = new THREE.Mesh(this.own(new THREE.SphereGeometry(420, 32, 20)), material);
        sky.name = 'FallSky';
        // After the grove's solids, so only the sky that shows is shaded (it writes no depth).
        sky.renderOrder = 4;
        sky.frustumCulled = false;
        sky.matrixAutoUpdate = false;
        this.sky = sky;
        this.group.add(sky);
    }

    /**
     * Low banks of mist between the trunks; where the sun finds them they turn gold. In a ground
     * mist (an air) they fill, and nearer sheets rise between the eye and the great trees.
     */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        const lit = (world) => {
            const sun = light.sunlight();
            const direction = normalize(world.sub(cameraPosition));
            const sunward = saturate(dot(direction, light.uSunDir));
            return light.uHazeCool.mul(1.5)
                .add(light.uHazeWarm.mul(sun).mul(pow(sunward, 2).mul(0.9).add(0.14)))
                .add(light.uHazeWarm.mul(light.uWarmth).mul(0.2));
        };
        const bank = (name, index, z, strength, width, height, order) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = name;
            const st = uv();
            const world = positionWorld;
            const scroll = light.uTime.mul(0.006 + index * 0.0015);
            const billow = light.noise(vec2(world.x.mul(0.011).add(scroll), st.y.mul(0.5).add(index * 0.37))).r.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.034).sub(scroll.mul(1.6)), st.y.mul(1.3))).g.mul(0.4));
            const band = exp(st.y.sub(0.3).pow2().mul(-9)).mul(smoothstep(0, 0.12, st.y));
            const sides = smoothstep(0, 0.14, st.x).mul(smoothstep(0, 0.14, st.x.oneMinus()));
            material.colorNode = lit(world);
            material.opacityNode = strength(billow).mul(band).mul(sides);
            const mist = new THREE.Mesh(geometry, material);
            mist.position.set(0, fallTerrainHeight(0, z) + height * 0.28, z);
            mist.scale.set(width, height, 1);
            mist.name = name;
            mist.renderOrder = order;
            mist.frustumCulled = false;
            mist.updateMatrix();
            mist.matrixAutoUpdate = false;
            this.group.add(mist);
            return mist;
        };
        const depths = [-104, -76, -52, -31, -15].slice(5 - this.tier.mist);
        depths.forEach((z, index) => {
            // (At rest as it was; a ground mist fills the bank.)
            const rest = -z > 60 ? 0.5 : 0.36;
            bank(
                `FallMistBank ${index}`,
                index,
                z,
                (billow) => smoothstep(0.34, 0.8, billow).mul(light.uMist.mul(1.5).add(1)).mul(rest),
                150 + -z * 1.7,
                9 + -z * 0.11,
                10 + index,
            );
        });
        // The ground mist's own sheets, nearer the eye: there only in that air.
        GROUND_MIST.slice(GROUND_MIST.length - Math.min(GROUND_MIST.length, this.tier.mist)).forEach((z, index) => {
            this.groundMist.push(bank(
                `FallGroundMist ${index}`,
                5 + index,
                z,
                (billow) => smoothstep(0.2, 0.75, billow).mul(0.6).add(0.18).mul(light.uMist)
                    .mul(0.46),
                74 + (15 - z) * 2.2,
                // (Low: it lies on the floor, deeper the further off it stands.)
                2.5 + (7 - z) * 0.14,
                16 + index,
            ));
        });
    }

    /**
     * Dust and pollen: invisible in shade, a slow gold sparkle wherever a shaft crosses it; a few
     * drift near the eye as soft discs out of focus.
     */
    buildMotes() {
        const { light, rng } = this;
        const first = this.tier.motes;
        const count = Math.max(first, Math.round(first * this.worldTier.dust));
        const own = seeded(0x0d057);
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            // (The first motes are the grove's own, drawn as they always were.)
            const draw = i < first ? rng : own;
            const z = 11 - draw() ** 1.4 * 58;
            const x = (draw() * 2 - 1) * (10 + (11 - z) * 0.62);
            data.set([x, fallTerrainHeight(x, z) + 0.4 + draw() * 9, z, draw()], i * 4);
        }
        const mote = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'FallSunMotes';
        const t = light.uTime;
        const phase = mote.w.mul(TAU);
        const drift = vec3(
            sin(t.mul(0.23).add(phase)).mul(0.7).add(light.uWindDir.x.mul(light.uGust).mul(1.2)),
            sin(t.mul(0.17).add(phase.mul(2.3))).mul(0.45),
            cos(t.mul(0.19).add(phase.mul(1.7))).mul(0.6),
        );
        // One mote in eight is a soft disc out of focus; the rest are points of dust.
        const soft = step(0.875, fract(mote.w.mul(7.31)));
        const size = mote.w.mul(0.05).add(0.035).mul(soft.mul(3.2).add(1));
        material.positionNode = positionLocal.mul(size).add(mote.xyz).add(drift);
        const disc = saturate(float(1).sub(length(uv().sub(0.5)).mul(2)));
        const twinkle = sin(t.mul(mote.w.mul(2).add(1.3)).add(phase.mul(7))).mul(0.4).add(0.6);
        // Dust between the eye and the sun scatters it forward and shines; side-lit dust is faint.
        const toward = pow(saturate(dot(normalize(positionWorld.sub(cameraPosition)), light.uSunDir)), 6);
        material.colorNode = light.uSunColor.mul(vec3(0.5, 0.46, 0.36)).add(light.uHazeWarm.mul(light.uGlow));
        material.opacityNode = mix(disc.pow2(), disc.mul(0.24), soft).mul(twinkle).mul(toward.mul(1.4).add(0.45))
            .mul(light.sunlight().mul(0.95).add(light.uGlow.mul(0.35)))
            .mul(light.uDust);
        const motes = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        motes.name = 'FallSunMotes';
        motes.renderOrder = 30;
        motes.frustumCulled = false;
        motes.matrixAutoUpdate = false;
        this.group.add(motes);
    }

    /**
     * Gossamer: a few short threads of silk between the grass stems near the eye, hung with dew. A
     * thread is invisible until its dew catches the sun: a row of beads that glints where the sun's
     * half-vector stands square to the thread, a stretch of it at a time and only now and then.
     * (The first pass strung long bright threads, which read as scratches across the picture.)
     * Each is a ribbon turned to the eye and widened with distance, about a pixel across.
     */
    buildGossamer() {
        const { light, rng } = this;
        const strung = this.tier.gossamer || 0;
        const count = Math.round(strung * this.worldTier.threads);
        const rows = 13;
        const vertices = Math.max(1, count) * rows * 2;
        const position = new Float32Array(vertices * 3);
        const tangent = new Float32Array(vertices * 3);
        const strand = new Float32Array(vertices * 3); // along the thread, its seed, its side (-1 or 1)
        const index = new Uint32Array(Math.max(1, count) * (rows - 1) * 6);
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const p = new THREE.Vector3();
        const q = new THREE.Vector3();
        let vertex = 0;
        let corner = 0;
        for (let i = 0; i < strung; i += 1) {
            // (Every thread the first pass strung is still drawn from the generator; fewer are kept.)
            const side = i % 2 === 0 ? -1 : 1;
            const z = 7 - rng() ** 1.3 * 24;
            const x = side * (2.2 + rng() * (9 + Math.max(0, -z) * 0.35));
            const ay = fallTerrainHeight(x, z) + 0.2 + rng() * 1.3;
            const heading = (rng() - 0.5) * 1.3;
            const long = 0.8 + rng() ** 1.5 * 3.2;
            const lift = rng();
            const sagShare = 0.03 + rng() * 0.07;
            const seed = rng();
            if (i < count) {
                // Short: a hand's breadth to an arm's length (drawn 3 times life, as the grass is).
                const span = 0.35 + ((long - 0.8) / 3.2) * 0.85;
                a.set(x, Math.min(ay, fallTerrainHeight(x, z) + 0.95), z);
                const bx = a.x - Math.cos(heading) * span * side;
                const bz = a.z + Math.sin(heading) * span;
                b.set(bx, fallTerrainHeight(bx, bz) + 0.2 + lift * 0.75, bz);
                const sag = span * sagShare * 1.4;
                const first = vertex;
                for (let row = 0; row < rows; row += 1) {
                    const t = row / (rows - 1);
                    p.lerpVectors(a, b, t);
                    p.y -= sag * 4 * t * (1 - t);
                    // The slope of the sagging chord at t: the straight run plus the sag's derivative.
                    q.subVectors(b, a);
                    q.y -= sag * 4 * (1 - 2 * t);
                    q.normalize();
                    for (let edge = -1; edge <= 1; edge += 2) {
                        position.set([p.x, p.y, p.z], vertex * 3);
                        tangent.set([q.x, q.y, q.z], vertex * 3);
                        strand.set([t, seed, edge], vertex * 3);
                        vertex += 1;
                    }
                }
                for (let row = 0; row < rows - 1; row += 1) {
                    const base = first + row * 2;
                    index.set([base, base + 1, base + 2, base + 1, base + 3, base + 2], corner);
                    corner += 6;
                }
            }
        }
        if (!count) return;
        const geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
        geometry.setAttribute('aTangent', new THREE.Float32BufferAttribute(tangent, 3));
        geometry.setAttribute('aStrand', new THREE.Float32BufferAttribute(strand, 3));
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        geometry.computeBoundingSphere();
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            fog: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        }));
        material.name = 'FallGossamer';
        const t = light.uTime;
        const thread = attribute('aStrand', 'vec3');
        const along = thread.x;
        const seed = thread.y;
        // The middle of a thread swings with the breeze; its ends are held.
        const belly = along.mul(along.oneMinus()).mul(4);
        const force = light.uWind.add(light.uGust.mul(1.5));
        const swing = sin(t.mul(1.1).add(seed.mul(TAU))).mul(0.6).add(sin(t.mul(2.3).add(seed.mul(17)))).mul(0.25);
        const breath = belly.mul(force.mul(0.05).add(0.008)).mul(swing.add(0.35));
        const rise = sin(t.mul(0.9).add(seed.mul(9))).mul(belly).mul(0.01);
        const centre = positionLocal.add(vec3(light.uWindDir.x.mul(breath), rise, light.uWindDir.z.mul(breath)));
        const fibre = normalize(attribute('aTangent', 'vec3'));
        const toEye = cameraPosition.sub(centre);
        // A tiny fixed offset keeps the cross product defined when a thread points at the eye.
        const across = normalize(cross(fibre, normalize(toEye)).add(vec3(0, 1e-6, 0)));
        const width = max(length(toEye).mul(0.0008), 0.002);
        material.positionNode = centre.add(across.mul(width.mul(thread.z)));

        const view = normalize(cameraPosition.sub(positionWorld));
        const half = normalize(view.add(light.uSunDir));
        const square = dot(fibre, half);
        const flash = pow(saturate(float(1).sub(square.mul(square))), 40);
        const backlit = pow(saturate(dot(view.negate(), light.uSunDir)), 5);
        const range = length(cameraPosition.sub(positionWorld));
        // Dew: beads along the thread (their mean where a bead is under a pixel), lit a stretch at a
        // time by a slow window that travels the thread and is away most of the time.
        const beads = pow(sin(along.mul(74).add(seed.mul(40))).mul(0.5).add(0.5), 5);
        const dew = mix(beads, float(0.27), smoothstep(7, 15, range));
        const window = pow(sin(t.mul(0.31).add(seed.mul(TAU)).sub(along.mul(2.4))).mul(0.5).add(0.5), 4);
        const reach = float(1).sub(smoothstep(9, 22, range));
        const gleam = flash.mul(0.7).add(backlit.mul(0.12)).mul(dew.mul(0.9).add(0.06)).mul(window);
        // (More dew in a mist and after rain; play's glow still brightens it.)
        const wet = light.uMist.mul(1.1).add(light.uWet.mul(0.7)).add(light.uGlow.mul(0.8)).add(0.5);
        material.colorNode = light.uSunColor.mul(gleam).mul(reach).mul(light.sunlight()).mul(wet)
            .mul(0.6);
        // Soft across the ribbon (clamped: a sub-pixel strip extrapolates its varyings under MSAA).
        const lateral = clamp(thread.z, -1, 1);
        material.opacityNode = float(1).sub(lateral.mul(lateral));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'FallGossamer';
        mesh.renderOrder = 32;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.gossamer = mesh;
        this.group.add(mesh);
    }

    /**
     * Fireflies: small yellow-green lights low among the grass on both sides of the board, each
     * lit for a moment and dark for a few seconds on its own beat, wandering as it glows. Out with
     * the dusk and all night (FallLight.uGlim); a combo calls them out by day. (They take the place
     * of the first pass's wisps, which drifted as plain white dots through the afternoon: the same
     * numbers are drawn from the grove's generator and let go.)
     */
    buildFireflies() {
        const { light, rng } = this;
        for (let i = 0; i < this.tier.wisps * 4; i += 1) rng();
        const count = this.worldTier.fireflies;
        const own = seeded(0xf17ef1);
        const data = new Float32Array(count * 4);
        const beat = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const side = i % 2 === 0 ? -1 : 1;
            const z = 9 - own() ** 1.2 * 34;
            const x = side * (3.4 + own() * (16 + Math.max(0, -z) * 0.3));
            data.set([x, fallTerrainHeight(x, z) + 0.35 + own() ** 1.6 * 3.4, z, own()], i * 4);
            // Its beat: the period (s), where in it it is, how long it stays lit, its warmth.
            beat.set([2.6 + own() * 3.4, own(), 0.16 + own() * 0.16, own()], i * 4);
        }
        const fly = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const pace = instancedBufferAttribute(new THREE.InstancedBufferAttribute(beat, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'FallFireflies';
        const t = light.uTime;
        const phase = fly.w.mul(TAU);
        // They wander wider and rise as the glow builds: the eased glow (uStir), so an event
        // draws them out over a moment instead of throwing them a metre in one frame.
        const stir = light.uStir.mul(1.2).add(1);
        const wander = vec3(
            sin(t.mul(0.31).add(phase)).mul(1.3).add(sin(t.mul(0.83).add(phase.mul(3))).mul(0.3)),
            sin(t.mul(0.47).add(phase.mul(1.9))).mul(0.5).add(light.uStir.mul(0.8)),
            cos(t.mul(0.27).add(phase.mul(1.3))).mul(1.3),
        ).mul(stir);
        // Lit: up quickly, held, out slowly; dark the rest of its period.
        const turn = fract(t.div(pace.x).add(pace.y));
        const lit = smoothstep(0, 0.05, turn).mul(float(1).sub(smoothstep(pace.z, pace.z.add(0.2), turn)));
        const size = float(0.42).add(light.uStir.mul(0.12));
        material.positionNode = positionGeometry.mul(size).add(positionLocal.sub(positionGeometry))
            .add(fly.xyz).add(wander);
        const radius = length(uv().sub(0.5)).mul(2);
        const core = saturate(float(1).sub(radius.mul(4.5))).pow2();
        const halo = exp(radius.mul(-5.5)).mul(saturate(float(1).sub(radius)));
        material.colorNode = mix(color(0xb9f25a), color(0xffd86a), pace.w.mul(0.6)).mul(2.4);
        material.opacityNode = core.mul(1.6).add(halo.mul(0.5)).mul(lit).mul(light.uGlim);
        const flies = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        flies.name = 'FallFireflies';
        flies.renderOrder = 31;
        flies.frustumCulled = false;
        flies.matrixAutoUpdate = false;
        this.fireflies = flies;
        this.group.add(flies);
    }

    /**
     * Rain (a sun shower): fine drops falling fast through the grove on the slant of the wind, each
     * a long soft streak. A streak in the sun, between the eye and it, shines; one in a trunk's shade
     * is a grey thread. Closed form (a drop's height is its phase on the clock), drawn only while it
     * rains.
     */
    buildRain() {
        const { light } = this;
        const count = this.worldTier.rain;
        if (!count) return;
        const own = seeded(0x4a17);
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const z = 13 - own() ** 1.25 * 46;
            const x = (own() * 2 - 1) * (9 + (13 - z) * 0.62);
            // x, z, its phase in the fall, its own pace
            data.set([x, z, own(), 0.8 + own() * 0.4], i * 4);
        }
        const drop = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            fog: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        }));
        material.name = 'FallRain';
        const fallen = fract(drop.z.add(light.uTime.mul(drop.w).mul(RAIN_SPEED / RAIN_TOP)));
        // The wind carries the fall on its slant, more in a gust.
        const slant = light.uWind.mul(0.16).add(light.uGust.mul(0.1));
        const way = normalize(vec3(light.uWindDir.x.mul(slant), -1, light.uWindDir.z.mul(slant)));
        const head = vec3(drop.x, float(RAIN_TOP).sub(1.5), drop.y).add(way.mul(fallen.mul(RAIN_TOP)));
        const toEye = cameraPosition.sub(head);
        const across = normalize(cross(way, normalize(toEye)).add(vec3(0, 0, 1e-6)));
        const width = max(length(toEye).mul(0.0011), 0.006);
        material.positionNode = positionLocal.sub(positionGeometry).add(head)
            .add(way.mul(positionGeometry.y.mul(0.62)))
            .add(across.mul(positionGeometry.x.mul(width).mul(2)));
        const st = uv();
        const lateral = clamp(st.x.mul(2).sub(1), -1, 1);
        const taper = smoothstep(0, 0.25, st.y).mul(smoothstep(0, 0.6, st.y.oneMinus()));
        const view = normalize(positionWorld.sub(cameraPosition));
        const forward = pow(saturate(dot(view, light.uSunDir)), 4);
        const near = float(1).sub(smoothstep(26, 44, length(positionWorld.sub(cameraPosition))));
        material.colorNode = light.uSunColor.mul(forward.mul(0.5).add(0.05)).mul(light.sunlight())
            .add(light.uHazeCool.mul(0.55).add(light.uSkyLight.mul(0.2)));
        material.opacityNode = float(1).sub(lateral.mul(lateral)).mul(taper).mul(near)
            .mul(light.uRain)
            .mul(0.55);
        const rain = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        rain.name = 'FallRain';
        rain.renderOrder = 33;
        rain.frustumCulled = false;
        rain.matrixAutoUpdate = false;
        rain.visible = false;
        this.rain = rain;
        this.group.add(rain);
    }

    /** What only shows in some air or light is not drawn at all while it is out. */
    update() {
        const { light } = this;
        const misty = light.uMist.value > 0.01;
        for (const sheet of this.groundMist) sheet.visible = misty;
        if (this.rain) this.rain.visible = light.uRain.value > 0.01;
        if (this.fireflies) this.fireflies.visible = light.uGlim.value > 0.01;
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.groundMist.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
