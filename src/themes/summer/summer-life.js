/**
 * Summer — what lives in the evening air.
 *
 * Butterflies working the flowers of the meadow and swallows hunting low over the lake.
 * Every path is a closed-form function of its own clock, so all of it runs in two vertex
 * shaders on both backends with a few numbers of CPU work a frame. A line clear sends the
 * butterflies up; a big one startles the swallows too. Each kind's clock runs a little faster
 * the hotter play runs (update()), so a quick hand sets the swallows hunting faster and the
 * butterflies dancing quicker: the clock is integrated, so a quickening never jumps a wing or
 * a path, and nor does a startle's quicker wingbeat (its phase is integrated too).
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cos, cross, dot, float, instancedBufferAttribute, mix, normalize, positionGeometry, sin, smoothstep,
    uniform, uniformArray, vec3,
} from 'three/tsl';
import { SUMMER_VIEWS, summerEye } from './summer-composition.js';
import { summerMeadowCover } from './summer-meadow.js';
import { summerGroundHeight } from './summer-terrain.js';

const TAU = Math.PI * 2;
// Brimstone, cabbage white, common blue, small tortoiseshell, orange tip.
const WING_COLOURS = [0xf6e24a, 0xf7f4ea, 0x6f93f2, 0xe8792a, 0xf4efe0];

/** A butterfly flying toward -Z: two wings hinged on the body line; `wing` is -1, 0 (hinge) or 1. */
function createButterflyGeometry() {
    const positions = [];
    const wings = [];
    [-1, 1].forEach((side) => {
        // Fore wing and hind wing, each a triangle from the body out.
        [[[0, 0, -0.5], [0.92, 0, -0.62], [0.62, 0, 0.12]], [[0, 0, -0.5], [0.62, 0, 0.12], [0, 0, 0.36]],
            [[0, 0, 0.36], [0.62, 0, 0.12], [0.5, 0, 0.72]]].forEach((triangle) => {
            triangle.forEach(([x, y, z]) => {
                positions.push(x * side, y, z);
                wings.push(x > 0 ? side : 0);
            });
        });
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('wing', new THREE.Float32BufferAttribute(wings, 1));
    return geometry;
}

/** A swallow gliding toward -Z: slim body, swept wings, forked tail; `wing` runs 0 (body) to 1 (tip). */
function createSwallowGeometry() {
    const triangles = [
        [[0, 0, -0.34, 0], [-0.045, 0, 0, 0], [0.045, 0, 0, 0]],
        [[-0.045, 0, 0, 0], [-0.1, 0, 0.5, 0], [0, 0, 0.26, 0]],
        [[0.045, 0, 0, 0], [0, 0, 0.26, 0], [0.1, 0, 0.5, 0]],
        [[-0.045, 0, 0, 0], [0, 0, 0.26, 0], [0.045, 0, 0, 0]],
    ];
    [-1, 1].forEach((side) => {
        triangles.push(
            [[side * 0.04, 0, -0.14, 0], [side * 0.46, 0, -0.02, 0.5], [side * 0.04, 0, 0.06, 0]],
            [[side * 0.46, 0, -0.02, 0.5], [side * 0.98, 0, 0.3, 1], [side * 0.42, 0, 0.1, 0.5]],
            [[side * 0.04, 0, 0.06, 0], [side * 0.46, 0, -0.02, 0.5], [side * 0.42, 0, 0.1, 0.5]],
        );
    });
    const positions = [];
    const wings = [];
    triangles.forEach((triangle) => triangle.forEach(([x, y, z, wing]) => {
        positions.push(x, y, z);
        wings.push(wing);
    }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('wing', new THREE.Float32BufferAttribute(wings, 1));
    return geometry;
}

export class SummerLife {
    constructor({ light, tier, rng = Math.random }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.group = new THREE.Group();
        this.group.name = 'SummerLife';
        this.uFlutter = uniform(0);
        this.uStartle = uniform(0);
        /** The butterflies' and the swallows' own clocks: time, plus what play has hurried them. */
        this.uButterflyClock = uniform(0);
        this.uSwallowClock = uniform(0);
        /** The swallows' wingbeat phase (radians, integrated in update(), wrapped to a turn). */
        this.uFlap = uniform(0);
        this.hurried = { butterflies: 0, swallows: 0 };
        this.owned = [];
        this.butterflies = 0;
        this.swallows = 0;
    }

    build() {
        this.buildButterflies();
        this.buildSwallows();
        return this;
    }

    buildButterflies() {
        const { light, rng } = this;
        const count = Math.max(0, Math.floor(this.tier.butterflies));
        this.butterflies = count;
        if (!count) return;
        const [eyeX, , eyeZ] = summerEye(SUMMER_VIEWS.landscape);
        const homes = new Float32Array(count * 4); // x, y, z, seed
        const looks = new Float32Array(count * 4); // colour, size, beat, range
        for (let i = 0; i < count; i += 1) {
            let x = 0;
            let z = 0;
            for (let attempt = 0; attempt < 30; attempt += 1) {
                const depth = 3 + rng() ** 1.3 * 22;
                const angle = (rng() * 2 - 1) * 0.74;
                x = eyeX + Math.sin(angle) * depth;
                z = eyeZ - Math.cos(angle) * depth;
                if (summerMeadowCover(x, z) > 0.5) break;
            }
            homes.set([x, summerGroundHeight(x, z) + 0.75 + rng() * 0.6, z, rng()], i * 4);
            looks.set(
                [Math.floor(rng() * WING_COLOURS.length), 0.055 + rng() * 0.04, 15 + rng() * 9, 1.2 + rng() * 2.4],
                i * 4,
            );
        }
        const home = instancedBufferAttribute(new THREE.InstancedBufferAttribute(homes, 4));
        const look = instancedBufferAttribute(new THREE.InstancedBufferAttribute(looks, 4));
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'SummerButterflies';
        // The path runs on the butterflies' own clock; the wings beat on the scene's.
        const t = this.uButterflyClock;
        const beatTime = light.uTime;
        const phase = home.w.mul(TAU);
        // A butterfly never flies straight: it loops from flower to flower and bobs as it goes.
        const reach = look.w.mul(this.uFlutter.mul(1.4).add(1));
        const rate = home.w.mul(0.3).add(0.34);
        const path = (time) => vec3(
            sin(time.mul(rate).add(phase)).mul(reach)
                .add(sin(time.mul(rate).mul(2.3).add(phase.mul(1.7))).mul(reach.mul(0.4))),
            sin(time.mul(rate).mul(1.9).add(phase.mul(2.1))).mul(0.34)
                .add(sin(time.mul(7.3).add(phase.mul(5))).mul(0.07)),
            cos(time.mul(rate).mul(0.8).add(phase.mul(1.3))).mul(reach)
                .add(cos(time.mul(rate).mul(2.7).add(phase)).mul(reach.mul(0.35))),
        );
        const lifted = vec3(0, this.uFlutter.mul(home.w.mul(1.6).add(0.8)), 0);
        const position = home.xyz.add(path(t)).add(lifted);
        const flat = path(t.add(0.12)).sub(path(t)).mul(vec3(1, 0, 1)).add(vec3(0.0001, 0, 0.0002));
        const heading = normalize(flat);
        const right = normalize(cross(heading, vec3(0, 1, 0)));
        // Wings clap over the back, then open flat: the beat lives mostly above the body.
        const wing = attribute('wing', 'float');
        const beat = sin(beatTime.mul(look.z).add(phase.mul(9))).mul(0.62).add(0.52);
        const span = positionGeometry.x.mul(look.y);
        const local = vec3(span.mul(cos(beat)), span.abs().mul(sin(beat)), positionGeometry.z.mul(look.y));
        material.positionNode = position.add(right.mul(local.x)).add(vec3(0, local.y, 0)).sub(heading.mul(local.z));
        // Rounded: read interpolated, a colour index a bit under itself truncated to the one before.
        const wingColour = look.x.add(0.5).toInt();
        const tone = uniformArray(WING_COLOURS.map((hex) => new THREE.Color(hex))).element(wingColour);
        // Lit from either side, a little darker at the wing's root, and glowing against the sun.
        const shade = wing.abs().mul(0.3).add(0.7);
        const lit = tone.mul(shade)
            .mul(light.uSunColor.mul(0.3).mul(light.sunlight()).add(light.ambient(vec3(0, 1, 0))));
        material.colorNode = light.haze(lit, { world: position });
        const mesh = new THREE.InstancedMesh(createButterflyGeometry(), material, count);
        mesh.name = 'SummerButterflies';
        // They keep to the meadow, whose image the lake never shows (the swallows over the
        // water stay in the mirror).
        mesh.userData.unmirrored = true;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.group.add(mesh);
        this.owned.push(material, mesh.geometry);
    }

    buildSwallows() {
        const { light, rng } = this;
        const count = Math.max(0, Math.floor(this.tier.birds));
        this.swallows = count;
        if (!count) return;
        const data = new Float32Array(count * 4); // seed, lane, height, size
        for (let i = 0; i < count; i += 1) data.set([rng(), rng(), rng(), 0.55 + rng() * 0.3], i * 4);
        const bird = instancedBufferAttribute(new THREE.InstancedBufferAttribute(data, 4));
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'SummerSwallows';
        // The paths run on the swallows' own clock, the rhythm of beat and glide on the scene's.
        const t = this.uSwallowClock;
        const rhythm = light.uTime;
        const phase = bird.x.mul(TAU);
        // Swallows quarter the cove in long figures of eight, low over the water, and
        // tower when something startles them.
        const rate = bird.x.mul(0.16).add(0.3);
        const wide = bird.y.mul(40).add(26).mul(this.uStartle.mul(0.5).add(1));
        const deep = bird.y.mul(22).add(16);
        const path = (time) => vec3(
            sin(time.mul(rate).add(phase)).mul(wide).add(6),
            sin(time.mul(rate).mul(2).add(phase.mul(1.3))).mul(bird.z.mul(2.4).add(0.8)).add(bird.z.mul(7).add(2.4))
                .add(this.uStartle.mul(bird.x.mul(14).add(6))),
            sin(time.mul(rate).mul(2).add(phase.mul(2))).mul(deep).sub(52),
        );
        const position = path(t);
        const heading = normalize(path(t.add(0.1)).sub(position).add(vec3(0.0001, 0, 0)));
        const right = normalize(cross(heading, vec3(0, 1, 0)));
        const up = cross(right, heading);
        const wing = attribute('wing', 'float');
        // A few quick beats, then a glide; a startled bird only beats, and faster: the beat's
        // phase is integrated on the CPU (update()), so a startle that comes or goes never jumps it.
        const beating = smoothstep(-0.2, 0.4, sin(rhythm.mul(1.1).add(bird.x.mul(40)))).max(this.uStartle);
        const flap = sin(this.uFlap.add(bird.x.mul(31))).mul(beating)
            .add(float(0.12).mul(beating.oneMinus()));
        // Bank into the turn.
        const bank = dot(normalize(path(t.add(0.4)).sub(position)), right).mul(0.9);
        const local = positionGeometry.add(vec3(0, wing.mul(flap).mul(0.3), 0)).mul(bird.w);
        const tilted = up.add(right.mul(bank));
        material.positionNode = position.add(right.mul(local.x)).add(tilted.mul(local.y)).sub(heading.mul(local.z))
            .add(tilted.mul(local.x.mul(bank).mul(-0.5)));
        // Blue-black above; seen against the evening they are almost silhouettes.
        material.colorNode = light.haze(mix(vec3(0.02, 0.025, 0.045), vec3(0.09, 0.07, 0.06), wing.mul(0.3)), {
            world: position,
        });
        const mesh = new THREE.InstancedMesh(createSwallowGeometry(), material, count);
        mesh.name = 'SummerSwallows';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.group.add(mesh);
        this.owned.push(material, mesh.geometry);
    }

    /**
     * One frame. `worn` is the world's reading (SummerWorld.wear): the flutter and the startle
     * eased so a clear lifts the butterflies and a quad the swallows over a moment instead of in
     * one frame, how hot play runs, and Reduce motion's share; without it the frame is read as is.
     */
    update(frame = {}, dt = 0, worn = null, time = this.light.uTime.value) {
        const read = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const motion = worn && Number.isFinite(worn.motion) ? read(worn.motion) : 1;
        const level = read(worn?.level);
        const fever = read(worn?.fever);
        const flutter = read(worn ? worn.flutter : frame.flutter);
        const startle = read(worn ? worn.flock : frame.flock);
        // Reduce motion keeps them close to their rounds: a startle or a fever moves them less.
        this.uFlutter.value = flutter * motion;
        this.uStartle.value = startle * motion;
        const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
        // A quick hand hurries them: the swallows hunt faster, the butterflies dance quicker.
        this.hurried.butterflies += step * (level * 0.5 + fever * 0.6) * motion;
        this.hurried.swallows += step * (level * 0.55 + fever * 0.5) * motion;
        const now = Number.isFinite(time) ? time : 0;
        this.uButterflyClock.value = now + this.hurried.butterflies;
        this.uSwallowClock.value = now + this.hurried.swallows;
        this.uFlap.value = (this.uFlap.value + step * (13 + 5 * this.uStartle.value)) % TAU;
    }

    /** Back to their own pace (a seek, a new session). */
    reset() {
        this.hurried.butterflies = 0;
        this.hurried.swallows = 0;
        this.uFlap.value = 0;
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
