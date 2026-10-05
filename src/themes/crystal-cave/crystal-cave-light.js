/**
 * Crystal Cave — the light every surface shares.
 *
 * One palette of five mineral families, one environment that the crystals reflect and
 * refract, one haze. Materials stay unlit and read these nodes, so an event that raises
 * a family is seen at once in the crystals, in the light they throw on the rock and in
 * their reflection in the pool.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, dot, exp, float, floor, fract, length, max, mix, sin, smoothstep, step, texture, uniform, uniformArray,
    vec2, vec3, vec4,
} from 'three/tsl';

/** Mineral families. A crystal, its baked light and a tetromino colour share an index. */
export const GEM_FAMILIES = Object.freeze([
    Object.freeze({ id: 'aqua', hex: 0x3fe3e4 }),
    Object.freeze({ id: 'amethyst', hex: 0xc463fb }),
    Object.freeze({ id: 'sapphire', hex: 0x4a7dff }),
    Object.freeze({ id: 'rose', hex: 0xff6fb5 }),
    Object.freeze({ id: 'amber', hex: 0xffb650 }),
]);
export const FAMILY_COUNT = GEM_FAMILIES.length;

/** Directional lobes of the far field: [direction, colour, sharpness]. */
const ENV_LOBES = Object.freeze([
    {
        dir: [0.0, 0.14, -1.0], color: [1.0, 0.8, 0.52], gain: 1.5, sharp: 46,
    }, // sanctuary
    {
        dir: [-0.42, 0.78, -0.46], color: [0.62, 0.8, 1.0], gain: 1.8, sharp: 70,
    }, // skylight
    {
        dir: [-0.92, 0.12, -0.3], color: [0.1, 0.8, 0.72], gain: 0.34, sharp: 3,
    }, // left wall
    {
        dir: [0.92, 0.12, -0.3], color: [0.55, 0.26, 1.0], gain: 0.34, sharp: 3,
    }, // right wall
]);

function lcg(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/**
 * A tiling 256² RGBA noise: R smooth fbm, G ridged fbm, B white noise, A a second fbm.
 * Built once on the CPU so both backends sample identical values.
 */
export function createCaveNoiseTexture(seed = 8317) {
    const size = 256;
    const random = lcg(seed);
    const lattice = (cells) => ({ cells, values: Float32Array.from({ length: cells * cells }, random) });
    const sets = [[4, 8, 16, 32, 64], [6, 12, 24, 48, 96]].map((octaves) => octaves.map(lattice));
    const sample = ({ cells, values }, x, y) => {
        const px = (x / size) * cells;
        const py = (y / size) * cells;
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const fx = px - ix;
        const fy = py - iy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const at = (dx, dy) => values[((iy + dy) % cells) * cells + ((ix + dx) % cells)];
        return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy;
    };
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let smooth = 0;
            let ridged = 0;
            let second = 0;
            let weight = 0.5;
            for (let octave = 0; octave < 5; octave += 1) {
                const a = sample(sets[0][octave], x, y);
                smooth += a * weight;
                ridged += (1 - Math.abs(a * 2 - 1)) * weight;
                second += sample(sets[1][octave], x, y) * weight;
                weight *= 0.5;
            }
            const offset = (y * size + x) * 4;
            data[offset] = Math.round(Math.min(1, smooth / 0.96875) * 255);
            data[offset + 1] = Math.round(Math.min(1, ridged / 0.96875) * 255);
            data[offset + 2] = Math.round(random() * 255);
            data[offset + 3] = Math.round(Math.min(1, second / 0.96875) * 255);
        }
    }
    const result = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    result.name = 'Crystal Cave — mineral noise';
    result.wrapS = THREE.RepeatWrapping;
    result.wrapT = THREE.RepeatWrapping;
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.needsUpdate = true;
    return result;
}

/**
 * @returns the shared uniforms and TSL helpers. Nothing here owns a scene object.
 */
export function createCaveLight() {
    const noise = createCaveNoiseTexture();
    const familyColors = GEM_FAMILIES.map((family) => new THREE.Color(family.hex));
    const uniforms = {
        time: uniform(0),
        /** Per-family brightness; 1 at rest, raised and decayed by the reaction director. */
        familyLevel: uniformArray(new Array(FAMILY_COUNT).fill(1), 'float'),
        familyColor: uniformArray(familyColors, 'color'),
        /** Whole-cave excitement, 0..1. */
        energy: uniform(0),
        /** Sustained combo hum, 0..1. */
        resonance: uniform(0),
        /** A flash from the board, seen by every facet that faces the player. */
        flashColor: uniform(new THREE.Color(0xffffff)),
        flash: uniform(0),
        hazeColor: uniform(new THREE.Color(0x0b1626)),
        hazeDensity: uniform(0.0105),
    };

    const lobeDir = ENV_LOBES.map((lobe) => new THREE.Vector3(...lobe.dir).normalize());
    const lobeColor = ENV_LOBES.map((lobe) => new THREE.Vector3(...lobe.color).multiplyScalar(lobe.gain));

    /** rgb: the board's flash; a: whole-cave gain. Read once per fragment and handed on. */
    const eventLight = vec4(uniforms.flashColor.mul(uniforms.flash), uniforms.energy.mul(0.55).add(1));

    /**
     * The far field as seen along a world direction: a pool-lit floor, a dark vault with
     * pin-point glow-worms, and a few broad lobes for the lit parts of the cavern.
     * `spread` widens every lobe (1 = mirror, larger = rougher). A real WGSL function
     * (it is called many times per fragment), so it may not touch a uniform or a
     * texture: r186 emits those unbound inside laid-out functions. Pass `eventLight`.
     */
    const environment = Fn(([direction, spread, event]) => {
        const up = direction.y;
        const floorGlow = vec3(0.012, 0.085, 0.092).mul(smoothstep(0.15, -0.75, up));
        const vault = vec3(0.012, 0.011, 0.03).mul(smoothstep(-0.2, 0.8, up).mul(0.7).add(0.3));
        const result = floorGlow.add(vault).toVar();
        ENV_LOBES.forEach((lobe, index) => {
            const amount = exp(dot(direction, vec3(lobeDir[index])).sub(1).mul(float(lobe.sharp).div(spread)));
            result.addAssign(vec3(lobeColor[index]).mul(amount).div(spread));
        });
        // Glow-worms: one hashed cell in forty carries a point of light.
        const grid = direction.xz.div(direction.y.abs().add(1)).mul(46);
        const cell = floor(grid);
        const chance = fract(sin(dot(cell, vec2(127.1, 311.7))).mul(43758.5453));
        const spot = length(fract(grid).sub(0.5));
        const star = step(0.975, chance).mul(smoothstep(0.42, 0.05, spot)).mul(smoothstep(-0.05, 0.35, up));
        result.addAssign(vec3(0.45, 0.95, 1.0).mul(star).mul(float(6).div(spread)));
        // The board flashes from the player's side of the cave.
        result.addAssign(event.rgb.mul(max(direction.z, 0).pow(2)).mul(1.6));
        return result.mul(event.a);
    }).setLayout({
        name: 'caveEnvironment',
        type: 'vec3',
        inputs: [
            { name: 'direction', type: 'vec3' },
            { name: 'spread', type: 'float' },
            { name: 'event', type: 'vec4' },
        ],
    });

    /** Exponential distance haze with a brighter, cooler band above the pool. */
    const haze = (colour, distance, height) => {
        const band = smoothstep(9, -7, height).mul(0.55).add(0.75);
        const amount = float(1).sub(exp(distance.mul(uniforms.hazeDensity).mul(band).negate()));
        const tint = mix(uniforms.hazeColor, uniforms.hazeColor.mul(vec3(1.5, 2.1, 2.3)), smoothstep(6, -7, height));
        return mix(colour, tint.mul(uniforms.energy.mul(0.35).add(1)), amount);
    };

    /** Two skewed 2D lookups stand in for a 3D noise without a volume texture. */
    const noise3 = (point) => texture(noise, point.xy.add(point.z.mul(vec2(0.37, 0.61)))).r
        .add(texture(noise, point.zy.mul(1.31).add(point.x.mul(vec2(0.53, 0.29)))).a)
        .mul(0.5);

    let disposed = false;
    return {
        uniforms,
        noise,
        environment,
        eventLight,
        haze,
        noise3,
        familyColors,
        dispose() {
            if (disposed) return;
            disposed = true;
            noise.dispose();
        },
    };
}
