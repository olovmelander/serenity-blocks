/**
 * Sakura Twilight — the two foxes.
 *
 * They keep to the stepping-stone path across the knoll: one ambles a stretch, stops to
 * look out over the lake, and moves on; a hard gust (or a big clear) sets them running.
 * The animated model is the glTF sample fox; here it is lit by the garden's own rig (moon,
 * sky and lanterns) instead of scene lights, so it sits in the picture on both backends.
 */
import * as THREE from 'three/webgpu';
import {
    cameraPosition, dot, float, length, normalWorld, normalize, positionWorld, pow, saturate, smoothstep, texture, uv,
    varying, vec3, vec4,
} from 'three/tsl';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { sakuraPathZ, sakuraTerrainHeight } from './sakura-terrain.js';

const CLIPS = Object.freeze({ idle: 'Survey', walk: 'Walk', run: 'Run' });
const SPEED = Object.freeze({ idle: 0, walk: 0.95, run: 3.3 });
const PATH_HALF_SPAN = 10.8;
const FOX_PLAN = Object.freeze([
    { x: -7.4, scale: 0.0096, lane: 0.35 },
    { x: 8.6, scale: 0.0086, lane: -0.3 },
]);

export class SakuraFoxes {
    /** `fox` is the parsed glTF ({ scene, animations }) or null when it failed to load. */
    constructor({ light, fox, rng = Math.random }) {
        this.light = light;
        this.fox = fox;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SakuraFoxes';
        this.owned = [];
        this.foxes = [];
        this.startled = 0;
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    createFurMaterial(source) {
        const { light } = this;
        // The sample fox ships without normals: they are taken from the faces themselves.
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.flatShading = true;
        material.name = 'SakuraFoxFur';
        const fur = source?.map ? texture(source.map, uv()).rgb : vec3(0.72, 0.3, 0.1);
        const world = positionWorld;
        const normal = normalize(normalWorld);
        const view = normalize(cameraPosition.sub(world));
        const facing = saturate(dot(normal, light.uMoonDir).mul(0.7).add(0.3));
        // A fox between the eye and the moon is drawn round with a silver edge.
        const rim = pow(saturate(dot(normal, view)).oneMinus(), 2.5)
            .mul(saturate(dot(view, light.uMoonDir).negate().mul(0.6).add(0.55)));
        const lamp = varying(light.lamps(positionWorld));
        const lit = fur.mul(light.uMoonColor).mul(facing.add(rim.mul(1.3))).mul(light.moonlight())
            .add(fur.mul(light.ambient(normal)).mul(1.7))
            .add(fur.mul(lamp).mul(1.2));
        material.colorNode = vec4(light.haze(lit, { world }), 1);
        return material;
    }

    /** A soft dark patch under each fox: the static shadow map cannot follow them. */
    createShadeMaterial() {
        const material = this.own(new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false,
        }));
        material.name = 'SakuraFoxShade';
        material.colorNode = vec3(0.004, 0.004, 0.012);
        material.opacityNode = smoothstep(0, 1, saturate(float(1).sub(length(uv().sub(0.5)).mul(2)))).mul(0.5);
        return material;
    }

    build() {
        if (!this.fox?.scene) return this;
        const clips = new Map((this.fox.animations || []).map((clip) => [clip.name, clip]));
        let fur = null;
        const shadeGeometry = this.own(new THREE.PlaneGeometry(1, 1));
        shadeGeometry.rotateX(-Math.PI / 2);
        const shadeMaterial = this.createShadeMaterial();
        FOX_PLAN.forEach((plan, index) => {
            const model = SkeletonUtils.clone(this.fox.scene);
            model.name = `SakuraFox ${index}`;
            model.scale.setScalar(plan.scale);
            model.traverse((child) => {
                if (!child.isMesh) return;
                // Both foxes wear one material built from the model's own texture.
                if (!fur) fur = this.createFurMaterial(Array.isArray(child.material) ? child.material[0] : child.material);
                Object.assign(child, {
                    material: fur, castShadow: false, receiveShadow: false, frustumCulled: false,
                });
            });
            const mixer = new THREE.AnimationMixer(model);
            const actions = {};
            Object.entries(CLIPS).forEach(([state, name]) => {
                const clip = clips.get(name);
                if (clip) actions[state] = mixer.clipAction(clip);
            });
            const shade = new THREE.Mesh(shadeGeometry, shadeMaterial);
            shade.name = `SakuraFoxShade ${index}`;
            shade.scale.set(0.5, 1, 1.15);
            shade.renderOrder = 2;
            this.group.add(model, shade);
            const fox = {
                model,
                mixer,
                actions,
                shade,
                plan,
                state: 'idle',
                x: plan.x,
                target: plan.x,
                heading: index ? -1 : 1,
                yaw: 0,
                wait: 1.5 + this.rng() * 3,
            };
            actions.idle?.play();
            this.place(fox, 0);
            this.foxes.push(fox);
        });
        return this;
    }

    setState(fox, state) {
        if (fox.state === state) return;
        const next = fox.actions[state];
        const previous = fox.actions[fox.state];
        if (next) {
            next.reset();
            next.setEffectiveTimeScale(1);
            next.setEffectiveWeight(1);
            if (previous) next.crossFadeFrom(previous, 0.35, true);
            next.play();
        }
        fox.state = state;
    }

    /** Put a fox on the path at its x, turned along it. */
    place(fox, dt) {
        const z = sakuraPathZ(fox.x) + fox.plan.lane;
        const y = sakuraTerrainHeight(fox.x, z);
        const ahead = sakuraPathZ(fox.x + fox.heading * 0.4) + fox.plan.lane;
        // Standing still, a fox turns to look out over the water.
        const wanted = fox.state === 'idle'
            ? Math.PI + fox.heading * 0.5
            : Math.atan2(fox.heading * 0.4, ahead - z);
        let delta = wanted - fox.yaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        fox.yaw += dt > 0 ? delta * (1 - Math.exp(-dt * 5)) : delta;
        fox.model.position.set(fox.x, y, z);
        fox.model.rotation.set(0, fox.yaw, 0);
        fox.shade.position.set(fox.x, y + 0.03, z);
        fox.shade.rotation.y = fox.yaw;
    }

    update(dt, frame = {}) {
        if (!this.foxes.length || !Number.isFinite(dt) || dt <= 0) return;
        const gust = Number.isFinite(frame.gust) ? frame.gust : 0;
        // A hard gust startles them once; they settle before it can happen again.
        this.startled = Math.max(0, this.startled - dt);
        const startle = gust > 0.6 && this.startled === 0;
        if (startle) this.startled = 5;
        const still = Number.isFinite(frame.hush) && frame.hush > 0.5;
        this.foxes.forEach((fox) => {
            if (startle) {
                fox.target = fox.x + (fox.x > 0 ? -1 : 1) * (5 + this.rng() * 6);
                this.setState(fox, 'run');
            }
            if (fox.state === 'idle') {
                fox.wait -= dt;
                if (fox.wait <= 0 && !still) {
                    const reach = 3 + this.rng() * 8;
                    let direction = this.rng() < 0.5 ? -1 : 1;
                    // Near an end of the path there is only one way to go.
                    if (Math.abs(fox.x) > PATH_HALF_SPAN - 3) direction = -Math.sign(fox.x);
                    fox.target = fox.x + direction * reach;
                    this.setState(fox, 'walk');
                }
            }
            if (fox.state !== 'idle') {
                fox.target = THREE.MathUtils.clamp(fox.target, -PATH_HALF_SPAN, PATH_HALF_SPAN);
                const remaining = fox.target - fox.x;
                fox.heading = Math.sign(remaining) || fox.heading;
                const stride = SPEED[fox.state] * dt;
                if (Math.abs(remaining) <= stride) {
                    fox.x = fox.target;
                    fox.wait = 2.5 + this.rng() * 6;
                    this.setState(fox, 'idle');
                } else fox.x += fox.heading * stride;
            }
            this.place(fox, dt);
            fox.mixer.update(dt);
        });
    }

    /** Back to the opening pose (the playground replays time from zero). */
    reset() {
        this.startled = 0;
        this.foxes.forEach((fox, index) => {
            this.setState(fox, 'idle');
            fox.mixer.setTime(0);
            Object.assign(fox, {
                x: fox.plan.x, target: fox.plan.x, heading: index ? -1 : 1, wait: 1.5 + this.rng() * 3,
            });
            this.place(fox, 0);
        });
    }

    dispose() {
        this.foxes.forEach((fox) => {
            fox.mixer.stopAllAction();
            fox.mixer.uncacheRoot(fox.model);
            fox.model.traverse((child) => {
                if (child.isSkinnedMesh) child.skeleton?.dispose();
            });
        });
        this.foxes.length = 0;
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
