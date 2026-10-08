/**
 * Forest — the floor of the old wood.
 *
 * The land is one analytic height function: a plateau of old trees, cut by a ride that runs
 * from the eye toward the moon, dips where the mist gathers and then falls away into a
 * valley; and a knoll on the right where a tree once fell. The same function places every
 * tree, fern and stone. The floor is moss, needle litter and granite; moonlight lies
 * on it in patches cut by the shadow map, dew sparkles where it does, and the forest's own
 * light (see ForestLight.glow) runs across it. As a combo wakes the forest, threads of
 * foxfire light up through the moss.
 */
import * as THREE from 'three/webgpu';
import {
    abs, cameraPosition, color, dot, length, mix, normalWorld, normalize, positionWorld, pow, reflect, saturate, sin,
    smoothstep, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { forestRide } from './forest-plan.js';

export const FOREST_BOUNDS = Object.freeze({
    minX: -260, maxX: 260, minZ: -380, maxZ: 40,
});
/** Where the foxfire threads spread from: the foot of the board, out in the glade. */
export const FOREST_HEARTH = Object.freeze({ x: 0, z: -4 });

/** The mossy knoll on the right where an old spruce fell. */
export const FOREST_KNOLL = Object.freeze({ x: 12.5, z: -13 });

const { smoothstep: ramp } = THREE.MathUtils;

/**
 * 0 on the ride's floor, 1 up on the plateau where the old trees stand. The opening widens
 * with distance, so beyond the glade it becomes the whole valley.
 */
export function forestPlateau(x, z) {
    const { s, d } = forestRide(x, z);
    const along = Math.max(0, s);
    return ramp(Math.abs(d), 8 + along * 0.05, 28 + along * 0.32);
}

/** Height of the ground. */
export function forestGroundHeight(x, z) {
    const { s, d } = forestRide(x, z);
    const roll = 0.28 * Math.sin(x * 0.071 + z * 0.043 + 0.6) + 0.19 * Math.sin(x * 0.13 - z * 0.097 + 2.1)
        + 0.07 * Math.sin(x * 0.41 + z * 0.33);
    // The ride dips a little where the mist gathers, then falls away into the valley.
    const hollow = -0.55 * Math.exp(-((((s - 27) / 17) ** 2) + ((d / 9) ** 2)));
    const knoll = 1.05 * Math.exp(-((((x - FOREST_KNOLL.x) / 6.5) ** 2) + (((z - FOREST_KNOLL.z) / 7.5) ** 2)));
    const plateau = forestPlateau(x, z);
    const rise = Math.min(9, 0.045 * Math.max(0, s - 36));
    const valley = 16 * ramp(s, 66, 210);
    return roll + hollow + knoll + plateau * rise - (1 - plateau) * valley;
}

/** Grid lines that are close together around the camera and widen with distance. */
function gridLines(min, max, denseMin, denseMax, denseStep, growth) {
    const lines = [];
    for (let value = denseMin; value <= denseMax + 1e-6; value += denseStep) lines.push(value);
    let step = denseStep;
    for (let value = denseMax; value < max;) {
        step *= growth;
        value = Math.min(max, value + step);
        lines.push(value);
    }
    step = denseStep;
    for (let value = denseMin; value > min;) {
        step *= growth;
        value = Math.max(min, value - step);
        lines.unshift(value);
    }
    return lines;
}

export class ForestTerrain {
    constructor({ light, tier }) {
        this.light = light;
        this.tier = tier;
        this.group = new THREE.Group();
        this.group.name = 'ForestFloor';
        this.owned = [];
        // How far the foxfire has spread from the hearth, in metres.
        this.uThreads = uniform(0);
    }

    height(x, z) {
        return forestGroundHeight(x, z);
    }

    build() {
        const {
            minX, maxX, minZ, maxZ,
        } = FOREST_BOUNDS;
        const xs = gridLines(minX, maxX, -32, 32, 0.5, 1.1);
        const zs = gridLines(minZ, maxZ, -42, 20, 0.5, 1.1);
        const positions = new Float32Array(xs.length * zs.length * 3);
        for (let row = 0; row < zs.length; row += 1) {
            for (let column = 0; column < xs.length; column += 1) {
                positions.set(
                    [xs[column], forestGroundHeight(xs[column], zs[row]), zs[row]],
                    (row * xs.length + column) * 3,
                );
            }
        }
        const indices = [];
        for (let row = 0; row < zs.length - 1; row += 1) {
            for (let column = 0; column < xs.length - 1; column += 1) {
                const a = row * xs.length + column;
                const b = a + 1;
                const c = a + xs.length;
                indices.push(a, c, b, b, c, c + 1);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'ForestGround';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        this.group.add(mesh);
        this.owned.push(geometry, material);
        this.mesh = mesh;
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'ForestGroundMaterial';
        const world = positionWorld;
        const coarse = light.noise(world.xz.mul(0.023));
        const fine = light.noise(world.xz.mul(0.29));
        const fleck = light.noise(world.xz.mul(1.9).add(fine.rg.mul(0.5)));
        // Forest floor: deep feather moss, drifts of needle litter, grey granite showing through.
        const moss = mix(color(0x0b1808), color(0x2c4616), fine.g.mul(0.6).add(coarse.b.mul(0.4)));
        const litter = mix(color(0x1d120a), color(0x48321b), fleck.r);
        const floor = mix(moss, litter, smoothstep(0.5, 0.76, fleck.g.mul(0.5).add(coarse.r.mul(0.5))));
        const granite = mix(color(0x26282c), color(0x5b6068), fine.a).mul(fleck.b.mul(0.4).add(0.75));
        const smooth = normalize(normalWorld);
        const bare = smoothstep(0.62, 0.8, coarse.g.mul(0.6).add(fine.b.mul(0.3)).add(smooth.y.oneMinus().mul(1.6)));
        const albedo = mix(floor, granite, bare);

        const normal = normalize(smooth.add(vec3(fine.r.sub(0.5), 0, fine.g.sub(0.5)).mul(0.6)));
        const view = normalize(cameraPosition.sub(world));
        const moon = light.moonlight();
        const facing = saturate(dot(normal, light.uMoonDir)).mul(1.7).add(0.03);
        // Dew: a soft sheen toward the moon, and single drops that flash as the eye moves.
        const mirror = saturate(dot(reflect(view.negate(), normal), light.uMoonDir));
        const sheen = pow(mirror, 14).mul(fleck.a.mul(0.6).add(0.25));
        const drops = light.noise(world.xz.mul(7.3));
        const wink = sin(light.uTime.mul(drops.g.mul(2.4).add(0.8)).add(drops.r.mul(40))).mul(0.5).add(0.5);
        const sparkle = smoothstep(0.83, 0.93, drops.b).mul(wink.pow2()).mul(pow(mirror, 2).mul(0.9).add(0.1))
            .mul(bare.oneMinus());
        const glow = light.glow(world);
        const cool = light.night(albedo);
        let lit = cool.mul(light.moonColour()).mul(facing).mul(moon)
            .add(light.moonColour().mul(sheen.mul(0.03).add(sparkle.mul(0.45))).mul(moon))
            .add(cool.mul(light.ambient(normal)).mul(1.15))
            // Moss is dark, but damp: it throws back more of a light held close to it.
            .add(albedo.mul(1.7).add(0.01).mul(glow));
        if (this.tier.pulses > 0) {
            // Foxfire: threads of cold light branching through the moss, spreading from the
            // foot of the board as the forest wakes and pulsing slowly outward.
            const away = length(world.xz.sub(vec2(FOREST_HEARTH.x, FOREST_HEARTH.z)));
            const strand = abs(light.noise(world.xz.mul(0.085).add(fine.rg.mul(0.05))).g.sub(0.5));
            const twig = abs(light.noise(world.xz.mul(0.31).add(coarse.rg.mul(0.2))).b.sub(0.5));
            const thread = smoothstep(0.0, 0.017, strand).oneMinus().mul(0.9)
                .add(smoothstep(0.0, 0.014, twig).oneMinus().mul(0.5)
                    .mul(smoothstep(0.02, 0.16, strand).oneMinus()));
            const reached = smoothstep(this.uThreads.sub(7), this.uThreads, away).oneMinus()
                .mul(smoothstep(0.0, 0.5, this.uThreads));
            const travel = sin(away.mul(0.9).sub(light.uTime.mul(2.2))).mul(0.5).add(0.5);
            const foxfire = vec3(0.1, 1.0, 0.62).mul(thread).mul(reached).mul(travel.mul(0.7).add(0.3))
                .mul(light.uWake.mul(0.9).add(0.1))
                .mul(bare.oneMinus());
            lit = lit.add(foxfire.mul(0.34));
        }
        // fragmentNode, not colorNode: the ground casts into the shadow map it reads.
        material.fragmentNode = vec4(light.haze(lit, { world, glow }), 1);
        return material;
    }

    /** `wake` 0..1: how far the foxfire threads have spread through the moss. */
    update(frame = {}) {
        const wake = Number.isFinite(frame.wake) ? THREE.MathUtils.clamp(frame.wake, 0, 1) : 0;
        this.uThreads.value = wake <= 0 ? 0 : 6 + wake * 46;
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
