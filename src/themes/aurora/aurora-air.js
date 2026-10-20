/**
 * Diamond dust: ice crystals hanging in the still air in front of the eye. Each is a point
 * that flares for a moment when one of its faces turns the display toward the eye, so the
 * air sparkles in the aurora's own colour — a magenta pulse overhead makes the crystals
 * under it flash magenta.
 *
 * A fixed field of crystals drifts on a slow wind through a box anchored to the RESTING
 * eye and wraps at its walls: the field is endless, parallax is right while the camera
 * breathes, and nothing is allocated after the build. Position, size and glint are all
 * computed in the vertex stage from one seed per crystal.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, dot, exp, float, fract,
    instancedBufferAttribute, length, max, min, normalize, positionGeometry, sin, smoothstep, uv,
    varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';

/** The drifting volume, world units: width across the view, height above the water, depth. */
export const AIR_BOX = Object.freeze({
    width: 240, height: 30, depth: 140, near: 3,
});
/** Wind through the box, units per second: across the view, falling, toward the eye. */
export const AIR_WIND = Object.freeze([0.55, -0.16, 0.12]);
/** Apparent size, in 1080-line pixels, of a crystal one unit from the eye. */
const SIZE_AT_ONE = 26;

/** Deterministic seeds: three placement fractions and a glint phase per crystal. */
export function buildAirSeeds(count, random) {
    const seeds = new Float32Array(Math.max(0, Math.floor(count)) * 4);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = random();
    return seeds;
}

export class AuroraAir {
    /**
     * @param {object} options
     * @param {THREE.Object3D} options.parent
     * @param {object} options.preset quality preset (`dustCount`)
     * @param {object} options.uniforms shared world uniforms (time, viewHeight, aspect, auroraLight)
     * @param {import('./aurora-atmosphere.js').AuroraAtmosphere} options.atmosphere
     * @param {Function} options.random seeded generator
     * @param {number[]} options.eye resting eye position [x, y, z]
     */
    constructor({
        parent, preset, uniforms, atmosphere, random, eye = [0, 8, 0],
    }) {
        this.disposed = false;
        this.count = Math.max(0, Math.floor(preset.dustCount ?? 0));
        this.mesh = null;
        this.geometry = null;
        this.material = null;
        if (this.count === 0) return;
        const u = uniforms;
        const seedData = new THREE.InstancedBufferAttribute(buildAirSeeds(this.count, random), 4);
        const seeds = instancedBufferAttribute(seedData);
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        });
        this.material.name = 'Aurora — diamond dust';

        const vColor = varyingProperty('vec3', 'auroraAirColor');
        this.material.vertexNode = Fn(() => {
            // Where the crystal is now: its seed spread over the box, carried by the wind and
            // wrapped at the walls, with a slow wobble of its own.
            const wobble = sin(u.time.mul(0.6).add(seeds.w.mul(40))).mul(0.35 / AIR_BOX.width);
            const fx = fract(seeds.x.add(u.time.mul(AIR_WIND[0] / AIR_BOX.width)).add(wobble)).toVar();
            const fy = fract(seeds.y.add(u.time.mul(AIR_WIND[1] / AIR_BOX.height))).toVar();
            const fz = fract(seeds.z.add(u.time.mul(AIR_WIND[2] / AIR_BOX.depth))).toVar();
            const world = vec3(
                fx.sub(0.5).mul(AIR_BOX.width).add(eye[0]),
                fy.mul(AIR_BOX.height).add(0.4),
                float(eye[2] - AIR_BOX.near).sub(fz.oneMinus().mul(AIR_BOX.depth)),
            ).toVar();
            const toCrystal = world.sub(cameraPosition).toVar();
            const distance = max(length(toCrystal), 0.5).toVar();
            // Fade at the walls so a wrapping crystal never pops, and right in front of the lens.
            const edge = (f) => smoothstep(0, 0.06, f).mul(float(1).sub(smoothstep(0.94, 1, f)));
            const presence = edge(fx).mul(edge(fy)).mul(edge(fz)).mul(smoothstep(2.5, 6, distance));
            // Apparent size floors at a pixel and a half; a far crystal drawn larger than it is
            // gives up some of its brightness, as a glint dims with distance.
            const scale = u.viewHeight.div(1080).toVar();
            const pixels = float(SIZE_AT_ONE).div(distance).mul(scale);
            const drawn = min(max(pixels, max(scale, 1).mul(1.5)), scale.mul(3.6)).toVar();
            const energy = min(pixels.div(drawn), 1).mul(0.75).add(0.25);

            // The glint: a face mirrors the display to the eye for a brief moment. The phase
            // turns with time and with the angle the crystal is seen at, so the air sparkles
            // as the eye drifts. Repeated squaring keeps the power off pow()'s edge cases.
            const view = toCrystal.div(distance);
            const facet = normalize(vec3(seeds.w.sub(0.5), seeds.x.sub(0.5), seeds.y.sub(0.5).add(1e-3)));
            const phase = seeds.w.mul(628.3).add(u.time.mul(seeds.z.mul(0.9).add(0.35))).add(dot(view, facet).mul(36));
            const s = max(sin(phase), 0);
            const s2 = s.mul(s);
            const s4 = s2.mul(s2);
            const s8 = s4.mul(s4);
            const flare = s8.mul(s8);
            const shine = flare.mul(5).add(0.06);
            // The colour of what the crystal mirrors: the aurora above it, with a cold core.
            const light = vec3(0.32, 0.4, 0.5).add(u.auroraLight.mul(3)).add(atmosphere.auroraAbove(world).mul(0.55));
            vColor.assign(light.mul(shine).mul(presence).mul(energy));

            const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1)).toVar();
            const size = drawn.div(u.viewHeight).mul(2);
            const offset = positionGeometry.xy.mul(vec2(size.div(u.aspect), size));
            return vec4(clip.xy.add(offset.mul(clip.w)), clip.z, clip.w);
        })();
        this.material.colorNode = Fn(() => {
            const p = uv().sub(0.5).mul(2);
            const r2 = dot(p, p);
            return vColor.mul(exp(r2.mul(-4)).add(exp(r2.mul(-1.4)).mul(0.08)));
        })();

        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count);
        this.mesh.name = 'Aurora — diamond dust';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 10;
        parent.add(this.mesh);
    }

    getDiagnostics() {
        return { crystals: this.mesh ? this.count : 0 };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.mesh?.removeFromParent();
        this.mesh?.dispose();
        this.geometry?.dispose();
        this.material?.dispose();
        this.mesh = null;
    }
}
