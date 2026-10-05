/**
 * The ground the aurora stands over: a range of snow peaks baked from ridged noise, a
 * lake that mirrors the whole sky, and two snow banks with spruces framing the near corners.
 *
 * The lake is the second hero. On the upper tiers it is a true planar mirror (the scene
 * rendered once more from below the water); on the cheapest tiers it mirrors analytically:
 * the sky gradient, the curtain buffer read along the reflected ray, and the skyline from a
 * baked ridge profile. Both paths bend the mirror with the same ripples, so gameplay rings
 * travel through the reflected curtains on every tier.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, attribute, cameraPosition, clamp, dot, exp, float, length, max, mix, normalWorld,
    normalize, positionWorld, reflector, screenUV, sin, smoothstep, texture, uniformArray, vec2, vec3,
} from 'three/tsl';
import { fbm2, ridged2 } from './aurora-noise.js';
import { AURORA_COLORS } from './aurora-palette.js';

/** Far shore: where the lake meets the foot of the range. */
export const SHORE_Z = -640;
const RANGE_DEPTH = 2700;
/** The range grid fans out from the eye: half-width per unit of distance. */
const RANGE_FAN = 1.3;
/** Height of the tallest summits above the lake. */
const RANGE_PEAK = 700;
const LAKE_HALF_WIDTH = 5200;
const PROFILE_BINS = 512;
const PROFILE_MAX_ELEVATION = 0.4;
const DEG = Math.PI / 180;

/**
 * Where the range stands tall. Two hero massifs frame the board; the saddle between them
 * stays low behind it, with a farther chain closing the horizon.
 */
const MASSIFS = [
    {
        x: -900, z: -1650, weight: 1.0, spreadX: 430, spreadZ: 380,
    },
    {
        x: -2050, z: -1500, weight: 0.8, spreadX: 600, spreadZ: 420,
    },
    {
        x: -430, z: -1150, weight: 0.3, spreadX: 260, spreadZ: 200,
    },
    {
        x: -150, z: -2600, weight: 0.62, spreadX: 520, spreadZ: 380,
    },
    {
        x: 420, z: -2800, weight: 0.55, spreadX: 520, spreadZ: 380,
    },
    {
        x: 1080, z: -1800, weight: 1.05, spreadX: 430, spreadZ: 380,
    },
    {
        x: 2250, z: -1560, weight: 0.82, spreadX: 620, spreadZ: 420,
    },
    {
        x: 620, z: -1180, weight: 0.28, spreadX: 250, spreadZ: 190,
    },
];

const triple = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);
const smooth = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/** Height of the range above the lake at a world position. Negative = under water. */
export function rangeHeight(x, z, seed = 0) {
    const inland = SHORE_Z - z;
    if (inland <= 0) return -8;
    const warpX = x + 230 * (fbm2(x / 870, z / 870, { seed: seed + 5, octaves: 3 }) - 0.5);
    const warpZ = z + 230 * (fbm2(x / 870 + 31.7, z / 870 - 12.3, { seed: seed + 9, octaves: 3 }) - 0.5);
    let envelope = 0.27;
    for (const massif of MASSIFS) {
        const dx = (warpX - massif.x) / massif.spreadX;
        const dz = (warpZ - massif.z) / massif.spreadZ;
        envelope += massif.weight * Math.exp(-(dx * dx + dz * dz));
    }
    // The summits come from the ridges, not from the envelope: a massif is a place where
    // many sharp crests stand tall, never a smooth dome.
    const ridge = ridged2(warpX / 900, warpZ / 900, { seed: seed + 21, octaves: 5, sharpness: 2.2 });
    const crag = ridged2(warpX / 300, warpZ / 300, { seed: seed + 77, octaves: 4, sharpness: 2.4 });
    const grain = fbm2(warpX / 95, warpZ / 95, { seed: seed + 131, octaves: 2 }) - 0.5;
    const shape = ridge ** 1.35 * 0.9 + crag * (0.16 + 0.34 * ridge) + grain * 0.05;
    // The saddle behind the board, and a rise out of the water.
    const saddle = 1 - 0.36 * Math.exp(-((x / 560) ** 2)) * (1 - smooth(1500, 2400, inland) * 0.5);
    return RANGE_PEAK * Math.min(1.3, envelope) * shape * saddle * smooth(0, 300, inland) - 8;
}

/**
 * Height of the near snow banks: two spits reaching into the lake from the frame's lower
 * corners. The channel between them widens with distance, so the water runs to the eye.
 */
export function bankHeight(x, z, seed = 0) {
    const away = Math.max(0, -z);
    const side = smooth(11 + away * 0.3, 34 + away * 0.62, Math.abs(x));
    const near = 1 - smooth(40, 165, away);
    const mound = 5.6 + 3.4 * fbm2(x / 46, z / 46, { seed: seed + 301, octaves: 3 });
    return -1.6 + side * near * mound;
}

function buildGrid(columns, rows, place) {
    const count = columns * rows;
    const positions = new Float32Array(count * 3);
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const [x, y, z] = place(column / (columns - 1), row / (rows - 1));
            positions.set([x, y, z], (row * columns + column) * 3);
        }
    }
    const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
    let cursor = 0;
    for (let row = 0; row < rows - 1; row += 1) {
        for (let column = 0; column < columns - 1; column += 1) {
            const a = row * columns + column;
            const b = a + 1;
            const c = a + columns;
            const d = c + 1;
            indices.set([a, b, c, b, d, c], cursor);
            cursor += 6;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    return geometry;
}

/** Skyline elevation by azimuth as seen from below the water: the low tiers' mirror mask. */
export function bakeRidgeProfile(positions, eyeHeight) {
    const profile = new Float32Array(PROFILE_BINS);
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (y <= 0) continue;
        const bin = Math.round((Math.atan2(x, -z) / Math.PI + 0.5) * (PROFILE_BINS - 1));
        if (bin < 0 || bin >= PROFILE_BINS) continue;
        const elevation = Math.atan2(y + eyeHeight, Math.hypot(x, z));
        if (elevation > profile[bin]) profile[bin] = elevation;
    }
    const data = new Uint8Array(PROFILE_BINS * 4);
    for (let bin = 0; bin < PROFILE_BINS; bin += 1) {
        // Close single-bin gaps between grid columns, then quantise.
        const before = profile[Math.max(0, bin - 1)];
        const after = profile[Math.min(PROFILE_BINS - 1, bin + 1)];
        const elevation = Math.max(profile[bin], Math.min(before, after));
        data[bin * 4] = Math.round(Math.min(1, elevation / PROFILE_MAX_ELEVATION) * 255);
        data[bin * 4 + 3] = 255;
    }
    return data;
}

/**
 * One spruce, unit height: stacked skirts of drooping boughs. Every other rim vertex is
 * pulled in, so each skirt is a star of branches and the silhouette is ragged.
 */
function buildSpruceGeometry(random) {
    const triangles = [];
    const tiers = 12;
    const sides = 10;
    for (let tier = 0; tier < tiers; tier += 1) {
        const f = tier / (tiers - 1);
        const base = 0.08 + f * 0.8;
        const tierHeight = 0.2 - f * 0.1;
        const radius = 0.2 * (1 - f) ** 0.9 + 0.022;
        const apex = [0, base + tierHeight, 0];
        const rim = [];
        for (let side = 0; side < sides; side += 1) {
            const angle = (side / sides) * Math.PI * 2 + tier * 0.9;
            const bough = side % 2 === 0 ? 0.82 + random() * 0.36 : 0.5 + random() * 0.18;
            const droop = side % 2 === 0 ? 0.035 + random() * 0.03 : 0.004;
            rim.push([Math.cos(angle) * radius * bough, base - droop, Math.sin(angle) * radius * bough]);
        }
        for (let side = 0; side < sides; side += 1) {
            triangles.push(apex, rim[(side + 1) % sides], rim[side]);
        }
    }
    // Trunk: a thin prism from the ground into the lowest skirt.
    for (let side = 0; side < 5; side += 1) {
        const a = (side / 5) * Math.PI * 2;
        const b = ((side + 1) / 5) * Math.PI * 2;
        triangles.push(
            [Math.cos(a) * 0.022, 0, Math.sin(a) * 0.022],
            [0, 0.24, 0],
            [Math.cos(b) * 0.022, 0, Math.sin(b) * 0.022],
        );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triangles.flat()), 3));
    geometry.computeVertexNormals();
    return geometry;
}

export class AuroraLandscape {
    /**
     * @param {object} options
     * @param {THREE.Object3D} options.parent
     * @param {object} options.preset quality preset
     * @param {import('./aurora-curtains.js').AuroraCurtains} options.curtains
     * @param {THREE.Texture} options.noiseTexture shared noise tile (not owned)
     * @param {object} options.uniforms shared world uniforms (time, activity, auroraLight)
     * @param {Function} options.random seeded generator
     * @param {number} options.seed
     * @param {number} options.eyeHeight camera height above the lake
     */
    constructor({
        parent, preset, curtains, noiseTexture, uniforms, random, seed = 0, eyeHeight = 8,
    }) {
        this.parent = parent;
        this.preset = preset;
        this.uniforms = uniforms;
        this.seed = seed;
        this.eyeHeight = eyeHeight;
        this.disposed = false;
        this.group = new THREE.Group();
        this.group.name = 'Aurora — landscape';
        parent.add(this.group);
        this.geometries = new Set();
        this.materials = new Set();
        this.textures = new Set();
        this.reflection = null;

        const slots = Math.max(1, preset.rippleSlots);
        this.rippleSlots = slots;
        this.rippleCursor = 0;
        // x, z, birth time, strength — and tint with the ring's travel speed in w.
        this.rippleData = Array.from({ length: slots }, () => new THREE.Vector4(0, 0, -1000, 0));
        this.rippleTint = Array.from({ length: slots }, () => new THREE.Vector4(0.3, 1, 0.6, 26));

        this.createRange();
        this.createBanks();
        this.createSpruces(random);
        this.createLake(curtains, noiseTexture);
    }

    /**
     * Night light on snow and rock. Skylight is a cold blue from everywhere; the aurora
     * arrives from above, a little bleached, so snow facing the sky glows mint and every
     * slope facing away falls into blue shadow. Distance takes the rest into haze.
     */
    litSurface(albedo, normal, hazeStart, hazeLength) {
        const u = this.uniforms;
        const aurora = mix(u.auroraLight, vec3(dot(u.auroraLight, vec3(0.25, 0.6, 0.15))), 0.38);
        const overhead = max(dot(normal, vec3(0.12, 0.86, -0.3)), 0);
        const fill = max(dot(normal, vec3(0, 0.45, 0.9)), 0);
        const facing = abs(dot(normal, normalize(cameraPosition.sub(positionWorld))));
        const rim = float(1).sub(facing).pow(3).mul(max(normal.y, 0));
        const light = vec3(0.013, 0.022, 0.047).mul(normal.y.mul(0.55).add(0.45))
            .add(aurora.mul(overhead.mul(1.15).add(fill.mul(0.16)).add(rim.mul(0.5)).add(0.03)));
        const lit = albedo.mul(light);
        const distance = length(positionWorld.xz.sub(cameraPosition.xz));
        const haze = float(1).sub(exp(max(distance.sub(hazeStart), 0).div(-hazeLength)));
        const hazeColor = vec3(0.0042, 0.0092, 0.0205).add(aurora.mul(0.045));
        // Mist pools on the water and thins with height.
        const mist = exp(max(positionWorld.y, 0).div(-40)).mul(smoothstep(420, 1700, distance)).mul(0.4);
        return mix(mix(lit, hazeColor, haze.mul(0.84)), hazeColor.mul(1.5), mist);
    }

    createRange() {
        const { terrainColumns: columns, terrainRows: rows } = this.preset;
        const { seed } = this;
        const geometry = buildGrid(columns, rows, (u, v) => {
            // Rows crowd toward the shore, where the range is largest on screen, and the
            // columns fan out with distance so no vertex is spent outside the view.
            const z = SHORE_Z - RANGE_DEPTH * v ** 1.5;
            const x = (u * 2 - 1) * (120 - z * RANGE_FAN);
            return [x, rangeHeight(x, z, seed), z];
        });
        const positions = geometry.attributes.position.array;
        const normals = geometry.attributes.normal.array;
        const cover = new Float32Array(columns * rows * 2);
        for (let i = 0; i < columns * rows; i += 1) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];
            const flatness = normals[i * 3 + 1];
            // Snow lies on gentle ground and thins on steep faces, which stay bare rock.
            // Dark spruce forest fills the low slopes in patches.
            const snow = smooth(0.6, 0.86, flatness) * (0.7 + 0.3 * smooth(40, 220, y))
                + 0.16 * fbm2(x / 90, z / 90, { seed: seed + 411, octaves: 2 });
            const forest = (1 - smooth(50, 150, y)) * smooth(2, 14, y)
                * smooth(0.4, 0.6, fbm2(x / 260, z / 260, { seed: seed + 433, octaves: 3 }));
            cover[i * 2] = Math.max(0, Math.min(1, snow));
            cover[i * 2 + 1] = Math.max(0, Math.min(1, forest));
        }
        geometry.setAttribute('cover', new THREE.BufferAttribute(cover, 2));
        this.ridgeProfile = bakeRidgeProfile(positions, this.eyeHeight);

        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'Aurora — snow range';
        material.colorNode = Fn(() => {
            const normal = normalize(normalWorld).toVar();
            const mask = attribute('cover', 'vec2').toVar();
            const albedo = mix(
                mix(triple(AURORA_COLORS.rock), triple(AURORA_COLORS.snow), mask.x),
                vec3(0.011, 0.02, 0.019),
                mask.y,
            );
            return this.litSurface(albedo, normal, 520, 2600);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Aurora — snow range';
        mesh.matrixAutoUpdate = false;
        this.range = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    createBanks() {
        const { seed } = this;
        const geometry = buildGrid(84, 40, (u, v) => {
            const x = (u * 2 - 1) * 190;
            const z = 18 - 200 * v;
            return [x, bankHeight(x, z, seed), z];
        });
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'Aurora — snow banks';
        material.colorNode = Fn(() => {
            const normal = normalize(normalWorld).toVar();
            // Wind-packed snow: faint sastrugi in the hollows, none of it flat white.
            const drift = sin(positionWorld.x.mul(0.31).add(positionWorld.z.mul(0.23)))
                .mul(sin(positionWorld.z.mul(0.47).sub(positionWorld.x.mul(0.11))))
                .mul(0.07).add(0.93);
            return this.litSurface(triple(AURORA_COLORS.snow).mul(drift).mul(0.82), normal, 6000, 4000);
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Aurora — snow banks';
        mesh.matrixAutoUpdate = false;
        this.banks = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    createSpruces(random) {
        const count = Math.max(2, this.preset.treeCount);
        const geometry = buildSpruceGeometry(random);
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'Aurora — spruces';
        material.colorNode = Fn(() => {
            const normal = normalize(normalWorld).toVar();
            // Needles are near-black; only the snow lying on each bough takes the light.
            const snowed = smoothstep(0.35, 0.8, normal.y);
            const albedo = mix(vec3(0.0065, 0.012, 0.011), triple(AURORA_COLORS.snow).mul(0.6), snowed.mul(0.22));
            return this.litSurface(albedo, normal, 6000, 4000);
        })();
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = 'Aurora — spruces';
        const dummy = new THREE.Object3D();
        for (let i = 0; i < count; i += 1) {
            // Alternate banks. Trees stand along the frame's edges, the nearest ones tallest,
            // so they close the corners without ever crossing behind the board.
            const side = i % 2 === 0 ? -1 : 1;
            const rank = Math.floor(i / 2) / Math.max(1, Math.ceil(count / 2) - 1);
            const reach = 38 + rank * 100 + random() * 12;
            const azimuth = side * (35 + random() * 12 - rank * 5) * DEG;
            const x = Math.sin(azimuth) * reach;
            const z = -Math.cos(azimuth) * reach;
            const height = 22 - rank * 8 + random() * 6;
            dummy.position.set(x, Math.max(0, bankHeight(x, z, this.seed)) - 0.5, z);
            dummy.rotation.set((random() - 0.5) * 0.06, random() * Math.PI * 2, (random() - 0.5) * 0.06);
            dummy.scale.set(height * (0.9 + random() * 0.35), height, height * (0.9 + random() * 0.35));
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        this.spruces = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    createLake(curtains, noiseTexture) {
        const u = this.uniforms;
        const geometry = new THREE.PlaneGeometry(LAKE_HALF_WIDTH * 2, 900, 1, 1);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, SHORE_Z * 0.5 - 30);
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'Aurora — mirror lake';
        const ripples = uniformArray(this.rippleData, 'vec4');
        const tints = uniformArray(this.rippleTint, 'vec4');
        if (this.preset.mirrorScale > 0) {
            this.reflection = reflector({ resolutionScale: this.preset.mirrorScale, bounces: false, samples: 0 });
            this.reflection.target.rotation.x = -Math.PI / 2;
            this.reflection.target.position.y = 0;
            this.group.add(this.reflection.target);
        } else {
            this.profileTexture = new THREE.DataTexture(
                this.ridgeProfile,
                PROFILE_BINS,
                1,
                THREE.RGBAFormat,
                THREE.UnsignedByteType,
            );
            this.profileTexture.name = 'Aurora — skyline profile';
            this.profileTexture.magFilter = THREE.LinearFilter;
            this.profileTexture.minFilter = THREE.LinearFilter;
            this.profileTexture.colorSpace = THREE.NoColorSpace;
            this.profileTexture.needsUpdate = true;
            this.textures.add(this.profileTexture);
        }
        const { reflection, profileTexture } = this;

        material.colorNode = Fn(() => {
            const point = positionWorld.xz.toVar();
            const toEye = cameraPosition.sub(positionWorld).toVar();
            const distance = length(toEye.xz).toVar();
            const view = normalize(toEye).toVar();

            // Wind works the water in patches: glassy lanes between ruffled ones.
            const ruffle = smoothstep(0.34, 0.72, texture(noiseTexture, point.mul(0.0017).add(u.time.mul(0.0006))).b);
            const fine = texture(noiseTexture, point.mul(0.021).add(vec2(u.time.mul(0.011), u.time.mul(0.007))));
            const chop = texture(noiseTexture, point.mul(0.0058).add(vec2(u.time.mul(-0.004), u.time.mul(0.0052))));
            const slope = fine.rg.sub(0.5).mul(0.6).add(chop.rg.sub(0.5))
                .mul(ruffle.mul(0.78).add(0.22))
                .toVar();
            const glint = vec3(0).toVar();
            for (let slot = 0; slot < this.rippleSlots; slot += 1) {
                // A ring: a short wave packet riding an expanding front, fading as it goes.
                const ring = ripples.element(slot);
                const tint = tints.element(slot);
                const offset = point.sub(ring.xy);
                const radius = max(length(offset), 0.001);
                const age = u.time.sub(ring.z);
                const front = radius.sub(age.mul(tint.w));
                const packet = exp(front.mul(front).mul(-0.012))
                    .mul(ring.w).mul(exp(age.mul(-0.55))).mul(smoothstep(0, 0.12, age));
                slope.addAssign(offset.div(radius).mul(sin(front.mul(0.52)).mul(packet).mul(0.8)));
                glint.addAssign(tint.rgb.mul(packet.mul(packet)));
            }

            // A tilted facet throws the mirrored ray mostly up or down, hardly sideways:
            // that is what draws every reflection into a vertical streak.
            const grazing = clamp(view.y, 0.02, 1);
            let mirror;
            if (reflection) {
                const coord = screenUV.flipX().add(vec2(slope.x.mul(0.035), slope.y.mul(0.2)));
                const smear = vec2(0, ruffle.mul(0.012).add(0.004));
                mirror = reflection.sample(coord).rgb.mul(0.5)
                    .add(reflection.sample(coord.add(smear)).rgb.mul(0.25))
                    .add(reflection.sample(coord.sub(smear)).rgb.mul(0.25));
            } else {
                const bounced = normalize(vec3(
                    view.x.negate().add(slope.x.mul(0.1)),
                    abs(view.y).add(slope.y.mul(0.32)).max(0.004),
                    view.z.negate(),
                )).toVar();
                const up = clamp(bounced.y, 0, 1);
                const sky = mix(triple(AURORA_COLORS.skyZenith), triple(AURORA_COLORS.skyHorizon), exp(up.mul(-5.2)))
                    .add(triple(AURORA_COLORS.airglow).mul(exp(up.mul(-13))))
                    .mul(u.activity.mul(0.35).add(1))
                    .add(curtains.sample(bounced));
                const azimuth = atan(bounced.x, bounced.z.negate()).div(Math.PI).add(0.5);
                const skyline = texture(profileTexture, vec2(azimuth, 0.5)).level(0).r.mul(PROFILE_MAX_ELEVATION);
                const land = smoothstep(skyline.sub(0.006), skyline.add(0.004), bounced.y).oneMinus();
                mirror = mix(sky, vec3(0.0035, 0.007, 0.013).add(u.auroraLight.mul(0.03)), land);
            }

            const fresnel = float(1).sub(grazing).pow(5).mul(0.96)
                .add(0.04);
            const body = triple(AURORA_COLORS.water).add(u.auroraLight.mul(0.012));
            const water = mix(body, mirror, fresnel).add(glint.mul(0.5).mul(fresnel)).toVar();
            // Mist gathers along the far shore and softens the seam with the land.
            const mistColor = vec3(0.0063, 0.0138, 0.0307).add(u.auroraLight.mul(0.04));
            return mix(water, mistColor, smoothstep(330, -SHORE_Z + 60, distance).mul(0.34));
        })();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Aurora — mirror lake';
        mesh.matrixAutoUpdate = false;
        this.lake = mesh;
        this.geometries.add(geometry);
        this.materials.add(material);
        this.group.add(mesh);
    }

    /**
     * Start a ring on the lake at world (x, z). `tint` is a linear RGB triple.
     * Reuses the oldest slot; allocates nothing.
     */
    ripple(time, x, z, strength, tint, speed = 26) {
        if (this.disposed || !(strength > 0)) return false;
        const slot = this.rippleCursor;
        this.rippleCursor = (slot + 1) % this.rippleSlots;
        this.rippleData[slot].set(x, z, time, Math.min(1.5, strength));
        this.rippleTint[slot].set(tint[0], tint[1], tint[2], speed);
        return true;
    }

    resetRipples() {
        for (const ring of this.rippleData) ring.set(0, 0, -1000, 0);
        this.rippleCursor = 0;
    }

    getDiagnostics() {
        return {
            terrain: [this.preset.terrainColumns, this.preset.terrainRows],
            spruces: this.spruces.count,
            rippleSlots: this.rippleSlots,
            mirror: this.reflection ? this.preset.mirrorScale : 'analytic',
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.group.removeFromParent();
        this.reflection?.target.removeFromParent();
        this.reflection?.dispose();
        this.reflection = null;
        this.spruces.dispose();
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of this.materials) material.dispose();
        for (const map of this.textures) map.dispose();
        this.geometries.clear();
        this.materials.clear();
        this.textures.clear();
        this.group.clear();
    }
}
