/**
 * Fall — sky and air.
 *
 * The sky dome and its cloud deck, banks of ground mist, dust that only shows where the
 * sun reaches it, gossamer that glints between the grass stems, and a few wandering wisps. All of it reads the shared light rig, so the
 * forest dissolves into exactly the colour that is behind it and the motes sparkle in the
 * same shafts the shadow map carves.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, clamp, color, cos, cross, dot, exp, float, instancedBufferAttribute, length, max,
    mix, normalize, positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uv, vec2, vec3,
} from 'three/tsl';
import { fallTerrainHeight } from './fall-terrain.js';

const TAU = Math.PI * 2;

export class FallAtmosphere {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'FallAir';
        this.owned = [];
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
        this.buildWisps();
        return this;
    }

    /**
     * A clear autumn sky late in the afternoon: clean blue overhead, gold low toward the sun and
     * a rose haze opposite, under a loose deck of fair-weather cloud seen from below. The low
     * sun lights the deck's undersides gold on its own side and rose away from it, its bodies
     * stay a soft lavender grey, and thin edges near the sun take a silver lining.
     */
    buildSky() {
        const { light } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            side: THREE.BackSide, fog: false, depthWrite: false,
        }));
        material.name = 'FallSkyDome';
        material.colorNode = Fn(() => {
            const direction = normalize(positionWorld.sub(cameraPosition)).toVar();
            const up = direction.y.toVar();
            const sunward = saturate(dot(direction, light.uSunDir)).toVar();
            const flat = normalize(vec2(direction.x, direction.z).add(vec2(0.0001, 0)));
            const toward = dot(flat, normalize(vec2(light.uSunDir.x, light.uSunDir.z))).mul(0.5).add(0.5).toVar();
            const disc = pow(sunward, 2600).mul(9).add(pow(sunward, 320).mul(0.9));

            // The deck, as a plane above the grove. A slow warp folds it into rows and heaps;
            // it thins out below about ten degrees, where a flat deck would read as dashes.
            const plane = vec2(direction.x, direction.z).div(up.add(0.11));
            const drift = vec2(light.uTime.mul(0.0011), light.uTime.mul(0.0004));
            const warp = light.noise(plane.mul(0.045).add(drift.mul(0.4))).rg.sub(0.5).mul(1.3);
            const q = plane.mul(vec2(0.11, 0.16)).add(warp).add(drift).toVar();
            const broad = light.noise(q);
            const fine = light.noise(q.mul(2.6).add(vec2(0.31, 0.17)));
            const shape = broad.g.mul(0.52).add(broad.b.mul(0.27)).add(fine.b.mul(0.13)).add(fine.a.mul(0.08));
            const deck = smoothstep(0.07, 0.3, up);
            const density = smoothstep(0.48, 0.78, shape).mul(deck).toVar();

            // Light on the deck: the undersides take the low sun, gold on its side, rose away
            // from it; the thick middles stay in their own shade; thin edges near the sun glow.
            const warmSide = pow(toward, 2.2).toVar();
            const underside = mix(vec3(0.42, 0.25, 0.25), vec3(1.5, 0.8, 0.34), warmSide);
            const body = mix(vec3(0.15, 0.13, 0.17), vec3(0.42, 0.3, 0.24), warmSide);
            const thin = float(1).sub(density).toVar();
            const cloud = mix(body, underside, thin.mul(0.7).add(0.18))
                .add(light.uSunColor.mul(pow(sunward, 7).mul(thin).mul(density.mul(1.6))));
            const clear = light.sky(direction);
            return mix(clear, cloud, density.mul(0.88)).add(light.uSunColor.mul(disc));
        })();
        const sky = new THREE.Mesh(this.own(new THREE.SphereGeometry(420, 32, 20)), material);
        sky.name = 'FallSky';
        sky.renderOrder = -100;
        sky.frustumCulled = false;
        sky.matrixAutoUpdate = false;
        this.sky = sky;
        this.group.add(sky);
    }

    /** Low banks of mist between the trunks; where the sun finds them they turn gold. */
    buildMist() {
        const { light } = this;
        const geometry = this.own(new THREE.PlaneGeometry(1, 1));
        const depths = [-104, -76, -52, -31, -15].slice(5 - this.tier.mist);
        depths.forEach((z, index) => {
            const material = this.own(new THREE.MeshBasicNodeMaterial({
                transparent: true, depthWrite: false, fog: false,
            }));
            material.name = `FallMistBank ${index}`;
            const st = uv();
            const world = positionWorld;
            const scroll = light.uTime.mul(0.006 + index * 0.0015);
            const billow = light.noise(vec2(world.x.mul(0.011).add(scroll), st.y.mul(0.5).add(index * 0.37))).r.mul(0.6)
                .add(light.noise(vec2(world.x.mul(0.034).sub(scroll.mul(1.6)), st.y.mul(1.3))).g.mul(0.4));
            const band = exp(st.y.sub(0.3).pow2().mul(-9)).mul(smoothstep(0, 0.12, st.y));
            const sides = smoothstep(0, 0.14, st.x).mul(smoothstep(0, 0.14, st.x.oneMinus()));
            const sun = light.sunlight();
            const direction = normalize(world.sub(cameraPosition));
            const sunward = saturate(dot(direction, light.uSunDir));
            const lit = light.uHazeCool.mul(1.5)
                .add(light.uHazeWarm.mul(sun).mul(pow(sunward, 2).mul(0.9).add(0.14)))
                .add(light.uHazeWarm.mul(light.uWarmth).mul(0.2));
            material.colorNode = lit;
            material.opacityNode = smoothstep(0.34, 0.8, billow).mul(band).mul(sides).mul(-z > 60 ? 0.5 : 0.36);
            const mist = new THREE.Mesh(geometry, material);
            const width = 150 + -z * 1.7;
            const height = 9 + -z * 0.11;
            mist.position.set(0, fallTerrainHeight(0, z) + height * 0.28, z);
            mist.scale.set(width, height, 1);
            mist.name = `FallMistBank ${index}`;
            mist.renderOrder = 10 + index;
            mist.frustumCulled = false;
            mist.updateMatrix();
            mist.matrixAutoUpdate = false;
            this.group.add(mist);
        });
    }

    /** Dust and pollen: invisible in shade, a slow sparkle wherever a shaft crosses it. */
    buildMotes() {
        const { light, rng } = this;
        const count = this.tier.motes;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const z = 11 - rng() ** 1.4 * 58;
            const x = (rng() * 2 - 1) * (10 + (11 - z) * 0.62);
            data.set([x, fallTerrainHeight(x, z) + 0.4 + rng() * 9, z, rng()], i * 4);
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
        const size = mote.w.mul(0.05).add(0.035);
        material.positionNode = positionLocal.mul(size).add(mote.xyz).add(drift);
        const disc = saturate(float(1).sub(length(uv().sub(0.5)).mul(2)));
        const twinkle = sin(t.mul(mote.w.mul(2).add(1.3)).add(phase.mul(7))).mul(0.4).add(0.6);
        // Dust between the eye and the sun scatters it forward and shines; side-lit dust is faint.
        const toward = pow(saturate(dot(normalize(positionWorld.sub(cameraPosition)), light.uSunDir)), 6);
        material.colorNode = light.uSunColor.mul(0.5).add(light.uHazeWarm.mul(light.uGlow));
        material.opacityNode = disc.pow2().mul(twinkle).mul(toward.mul(1.4).add(0.45))
            .mul(light.sunlight().mul(0.95).add(light.uGlow.mul(0.35)));
        const motes = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        motes.name = 'FallSunMotes';
        motes.renderOrder = 30;
        motes.frustumCulled = false;
        motes.matrixAutoUpdate = false;
        this.group.add(motes);
    }

    /**
     * Gossamer: silk threads strung between the grass and the low boughs near the eye, sagging a
     * little and breathing with the wind. A thread is invisible until it catches the sun: a fibre
     * flashes where the sun's half-vector stands square to it, and glows when it hangs between
     * the eye and the sun; a slow shimmer runs along it. Each thread is a ribbon turned to the
     * eye and widened with distance, so it stays about a pixel across wherever it hangs.
     */
    buildGossamer() {
        const { light, rng } = this;
        const count = this.tier.gossamer || 0;
        if (!count) return;
        const rows = 19;
        const vertices = count * rows * 2;
        const position = new Float32Array(vertices * 3);
        const tangent = new Float32Array(vertices * 3);
        const strand = new Float32Array(vertices * 3); // along the thread, its seed, its side (-1 or 1)
        const index = new Uint32Array(count * (rows - 1) * 6);
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const p = new THREE.Vector3();
        const q = new THREE.Vector3();
        let vertex = 0;
        let corner = 0;
        for (let i = 0; i < count; i += 1) {
            // Threads keep to the two sides of the board and to the near ground, where a hairline shows.
            const side = i % 2 === 0 ? -1 : 1;
            const z = 7 - rng() ** 1.3 * 24;
            const x = side * (2.2 + rng() * (9 + Math.max(0, -z) * 0.35));
            a.set(x, fallTerrainHeight(x, z) + 0.2 + rng() * 1.3, z);
            const heading = (rng() - 0.5) * 1.3;
            const span = 0.8 + rng() ** 1.5 * 3.2;
            const bx = a.x - Math.cos(heading) * span * side;
            const bz = a.z + Math.sin(heading) * span;
            b.set(bx, fallTerrainHeight(bx, bz) + 0.2 + rng() * 1.3, bz);
            const sag = span * (0.03 + rng() * 0.07);
            const seed = rng();
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
        const breath = belly.mul(force.mul(0.16).add(0.02)).mul(swing.add(0.35));
        const lift = sin(t.mul(0.9).add(seed.mul(9))).mul(belly).mul(0.025);
        const centre = positionLocal.add(vec3(light.uWindDir.x.mul(breath), lift, light.uWindDir.z.mul(breath)));
        const fibre = normalize(attribute('aTangent', 'vec3'));
        const toEye = cameraPosition.sub(centre);
        // A tiny fixed offset keeps the cross product defined when a thread points at the eye.
        const across = normalize(cross(fibre, normalize(toEye)).add(vec3(0, 1e-6, 0)));
        const width = max(length(toEye).mul(0.0009), 0.0025);
        material.positionNode = centre.add(across.mul(width.mul(thread.z)));

        const view = normalize(cameraPosition.sub(positionWorld));
        const half = normalize(view.add(light.uSunDir));
        const square = dot(fibre, half);
        const flash = pow(saturate(float(1).sub(square.mul(square))), 48);
        const backlit = pow(saturate(dot(view.negate(), light.uSunDir)), 5);
        const shimmer = sin(t.mul(0.8).sub(along.mul(31)).add(seed.mul(40))).mul(0.5).add(0.5);
        const reach = float(1).sub(smoothstep(9, 24, length(cameraPosition.sub(positionWorld))));
        const gleam = flash.mul(0.9).add(backlit.mul(0.28)).mul(shimmer.pow2().mul(0.75).add(0.25));
        material.colorNode = light.uSunColor.mul(gleam).mul(reach).mul(light.sunlight())
            .mul(light.uGlow.mul(0.8).add(0.42));
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

    /** A handful of drifting lights near the ferns; combos call them out of hiding. */
    buildWisps() {
        const { light, rng } = this;
        const count = this.tier.wisps;
        const data = new Float32Array(count * 4);
        for (let i = 0; i < count; i += 1) {
            const side = i % 2 === 0 ? -1 : 1;
            const z = 8 - rng() * 36;
            const x = side * (4.5 + rng() * 17);
            data.set([x, fallTerrainHeight(x, z) + 0.5 + rng() * 2.6, z, rng()], i * 4);
        }
        const wisp = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        }));
        material.name = 'FallWisps';
        const t = light.uTime;
        const phase = wisp.w.mul(TAU);
        const stir = light.uGlow.mul(1.6).add(1);
        const wander = vec3(
            sin(t.mul(0.31).add(phase)).mul(1.5).add(sin(t.mul(0.83).add(phase.mul(3))).mul(0.3)),
            sin(t.mul(0.47).add(phase.mul(1.9))).mul(0.6).add(light.uGlow.mul(1.1)),
            cos(t.mul(0.27).add(phase.mul(1.3))).mul(1.5),
        ).mul(stir);
        const breath = sin(t.mul(0.7).add(phase.mul(5))).mul(0.5).add(0.5);
        const size = breath.mul(0.16).add(0.3).add(light.uGlow.mul(0.2));
        material.positionNode = positionGeometry.mul(size).add(positionLocal.sub(positionGeometry))
            .add(wisp.xyz).add(wander);
        const radius = length(uv().sub(0.5)).mul(2);
        const core = saturate(float(1).sub(radius)).pow(3);
        const halo = exp(radius.mul(-3.2)).mul(saturate(float(1).sub(radius)));
        material.colorNode = mix(color(0xffc46a), color(0x7ff0d8), wisp.w).mul(1.6);
        material.opacityNode = core.add(halo.mul(0.45)).mul(breath.mul(0.35).add(0.2).add(light.uGlow.mul(0.6)));
        const wisps = new THREE.InstancedMesh(this.own(new THREE.PlaneGeometry(1, 1)), material, count);
        wisps.name = 'FallWisps';
        wisps.renderOrder = 31;
        wisps.frustumCulled = false;
        wisps.matrixAutoUpdate = false;
        this.group.add(wisps);
    }

    update() {}

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
