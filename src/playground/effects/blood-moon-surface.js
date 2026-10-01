/**
 * A small, deterministic lunar atlas. The expensive work happens once per size,
 * on the CPU; the moon's fragment shader only needs two texture samples.
 *
 * This is SphereGeometry's equirectangular UV convention: v=0 is south,
 * v=1 is north, and the composed near side faces +Z (u=0.25). DataTexture
 * therefore stays flipY=false, including the OpenGL-style +Y normal map.
 */
const surfaceCache = new Map();
const authoredSurfaceCache = new Map();
let authoredImageReady;
const TAU = Math.PI * 2;

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function smooth(low, high, value) {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
}

function createNoise(random) {
    const lattice = new Float32Array(32 * 32 * 32);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();
    return (x, y, z) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const iz = Math.floor(z);
        const fx = x - ix;
        const fy = y - iy;
        const fz = z - iz;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const sz = fz * fz * (3 - 2 * fz);
        const x0 = ix & 31;
        const x1 = (ix + 1) & 31;
        const y0 = (iy & 31) * 32;
        const y1 = ((iy + 1) & 31) * 32;
        const z0 = (iz & 31) * 1024;
        const z1 = ((iz + 1) & 31) * 1024;
        const a = lattice[z0 + y0 + x0] * (1 - sx) + lattice[z0 + y0 + x1] * sx;
        const b = lattice[z0 + y1 + x0] * (1 - sx) + lattice[z0 + y1 + x1] * sx;
        const c = lattice[z1 + y0 + x0] * (1 - sx) + lattice[z1 + y0 + x1] * sx;
        const d = lattice[z1 + y1 + x0] * (1 - sx) + lattice[z1 + y1 + x1] * sx;
        return (a * (1 - sy) + b * sy) * (1 - sz) + (c * (1 - sy) + d * sy) * sz;
    };
}

function bakeSurface(width) {
    const height = width / 2;
    const count = width * height;
    const random = seededRandom(0xb100d);
    const noise = createNoise(random);
    const relief = new Float32Array(count);
    const albedo = new Float32Array(count);
    const detail = new Float32Array(count);
    const maria = new Float32Array(count);
    const longitudeCos = new Float32Array(width);
    const longitudeSin = new Float32Array(width);
    const latitudeCos = new Float32Array(height);
    const latitudeSin = new Float32Array(height);

    for (let x = 0; x < width; x += 1) {
        const longitude = ((x + 0.5) / width) * TAU;
        longitudeCos[x] = Math.cos(longitude);
        longitudeSin[x] = Math.sin(longitude);
    }
    for (let y = 0; y < height; y += 1) {
        const latitude = ((y + 0.5) / height - 0.5) * Math.PI;
        const cosLatitude = Math.cos(latitude);
        const sinLatitude = Math.sin(latitude);
        latitudeCos[y] = cosLatitude;
        latitudeSin[y] = sinLatitude;
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const px = -longitudeCos[x] * cosLatitude;
            const pz = longitudeSin[x] * cosLatitude;
            const broad = noise(px * 3.7 + 8, sinLatitude * 3.7 + 11, pz * 3.7 + 4);
            const medium = noise(px * 13.3 + 19, sinLatitude * 13.3 + 3, pz * 13.3 + 15);
            const fine = noise(px * 47.1 + 2, sinLatitude * 47.1 + 9, pz * 47.1 + 21);
            const grain = noise(px * 137 + 13, sinLatitude * 137 + 17, pz * 137 + 5);
            detail[index] = medium * 0.65 + fine * 0.35;
            albedo[index] = 0.54 + (broad - 0.5) * 0.22 + (medium - 0.5) * 0.12
                + (fine - 0.5) * 0.07 + (grain - 0.5) * 0.028;
            relief[index] = (broad - 0.5) * 0.0015 + (medium - 0.5) * 0.0008
                + (fine - 0.5) * 0.0003 + (grain - 0.5) * 0.000075;
        }
    }

    // Rasterize only a feature's spherical cap. This also handles the UV seam
    // and the poles, without an O(texture pixels * crater count) search.
    function cap(u, v, radius, visit) {
        const longitude = u * TAU;
        const latitude = (v - 0.5) * Math.PI;
        const cosLatitude = Math.cos(latitude);
        const sinLatitude = Math.sin(latitude);
        const cx = -Math.cos(longitude) * cosLatitude;
        const cz = Math.sin(longitude) * cosLatitude;
        const ex = Math.sin(longitude);
        const ez = Math.cos(longitude);
        const nx = Math.cos(longitude) * sinLatitude;
        const nz = -Math.sin(longitude) * sinLatitude;
        const minY = Math.max(0, Math.floor((v - radius / Math.PI) * height));
        const maxY = Math.min(height - 1, Math.ceil((v + radius / Math.PI) * height));
        const reachesPole = Math.abs(latitude) + radius >= Math.PI * 0.5;
        const longitudeRadius = reachesPole ? Math.PI
            : Math.asin(Math.min(1, Math.sin(radius) / cosLatitude));
        const centerX = u * width - 0.5;
        const halfWidth = Math.ceil((longitudeRadius / TAU) * width) + 1;
        const minX = reachesPole ? 0 : Math.floor(centerX - halfWidth);
        const maxX = reachesPole ? width - 1 : Math.ceil(centerX + halfWidth);
        const cosRadius = Math.cos(radius);
        for (let y = minY; y <= maxY; y += 1) {
            const rowCos = latitudeCos[y];
            const py = latitudeSin[y];
            for (let rawX = minX; rawX <= maxX; rawX += 1) {
                const x = (rawX + width * 2) % width;
                const px = -longitudeCos[x] * rowCos;
                const pz = longitudeSin[x] * rowCos;
                const dot = px * cx + py * sinLatitude + pz * cz;
                if (dot < cosRadius) continue;
                const east = px * ex + pz * ez;
                const north = px * nx + py * cosLatitude + pz * nz;
                visit(y * width + x, Math.sqrt(Math.max(0, 2 - 2 * dot)), east, north);
            }
        }
    }

    // Interlocking lava plains give the face recognizable large-scale geology.
    // Scalloped, overlapping basalt seas carry the broad contrast; impact floors
    // remain weathered rock rather than a field of uniformly black holes.
    const basins = [
        [0.196, 0.642, 0.36, 1.0], [0.224, 0.565, 0.28, 0.96],
        [0.166, 0.548, 0.32, 0.88], [0.146, 0.456, 0.24, 0.88],
        [0.282, 0.604, 0.265, 0.92], [0.303, 0.514, 0.225, 0.93],
        [0.351, 0.573, 0.145, 0.92], [0.290, 0.440, 0.155, 0.73],
        [0.742, 0.555, 0.25, 0.75], [0.810, 0.354, 0.31, 0.62],
    ];
    for (const [u, v, radius, darkness] of basins) {
        cap(u, v, radius * 1.35, (index, distance, east, north) => {
            const scallop = (detail[index] - 0.5) * 0.62
                + Math.sin((east * 5.2 + north * 2.9) / radius + u * 23) * 0.09;
            const warpedEast = east + (detail[index] - 0.5) * radius * 0.28;
            const warpedNorth = north + Math.sin((east / radius) * 3.7 + v * 19) * radius * 0.075;
            const elliptical = Math.sqrt(warpedEast * warpedEast * 0.84 + warpedNorth * warpedNorth * 1.16);
            const mask = (1 - smooth(0.58 + scallop, 1.12 + scallop, elliptical / radius)) * darkness;
            maria[index] = Math.max(maria[index], mask);
        });
    }
    for (let i = 0; i < count; i += 1) {
        const mask = maria[i];
        const basalt = 0.18 + (detail[i] - 0.5) * 0.10;
        albedo[i] = albedo[i] * (1 - mask) + basalt * mask;
        relief[i] = relief[i] * (1 - mask * 0.85) - mask * 0.0017;
    }

    function crater(u, v, radius, freshness = 1, rayLength = 0) {
        const phase = random() * TAU;
        const depth = radius * 0.047;
        const rimHeight = radius * 0.014;
        const mature = smooth(0.014, 0.07, radius);
        const freshImpact = smooth(0.82, 1, freshness);
        const index = Math.min(height - 1, Math.floor(v * height)) * width
            + Math.min(width - 1, Math.floor(u * width));
        const mare = maria[index];
        const extent = rayLength > 0 ? rayLength : 1.75;
        cap(u, v, radius * extent, (pixel, distance, east, north) => {
            const angle = Math.atan2(north, east);
            const irregular = 1 + Math.sin(angle * 5 + phase) * 0.048
                + Math.sin(angle * 9 - phase) * 0.023 + (detail[pixel] - 0.5) * 0.065;
            const r = distance / (radius * irregular);
            if (r < 1.65) {
                const bowl = 1 - smooth(0.08, 1.06, r);
                const rimBreaks = 0.45 + smooth(-0.65, 0.72, Math.sin(angle * 3 + phase)
                    + Math.sin(angle * 7 - phase) * 0.4) * 0.55;
                const rim = Math.exp(-(((r - 1.01) / 0.15) ** 2)) * rimBreaks;
                const ejecta = (1 - smooth(1, 1.65, r)) * smooth(0.92, 1.12, r);
                const peak = radius > 0.036 ? Math.exp(-((r / 0.19) ** 2)) * depth * 0.22 : 0;
                relief[pixel] += (-bowl * depth + rim * rimHeight + peak) * freshness;
                // Only a few young named impacts expose very dark interiors.
                // Small old craters mostly contribute relief and subtle mottling.
                const floorWeight = Math.min(0.97, 0.20 + mature * 0.62 + freshness * 0.17 + freshImpact * 0.6);
                const floorMask = (1 - smooth(0.04, 1.12, r)) * floorWeight;
                const floorAlbedo = 0.27 + (detail[pixel] - 0.5) * 0.09 - freshImpact * 0.16;
                albedo[pixel] = albedo[pixel] * (1 - floorMask) + floorAlbedo * floorMask
                    + (rim * 0.075 + ejecta * 0.015) * freshness * (1 + mare * 0.25);
            }
            if (rayLength > 0 && r > 1.1) {
                const spoke = Math.max(0, Math.sin(angle * 13 + Math.sin(angle * 5 + phase) * 2.5));
                const fineSpoke = Math.max(0, Math.sin(angle * 29 - phase));
                const taper = (1 - smooth(1.3, rayLength, r)) * smooth(1.1, 1.7, r);
                const rays = (spoke ** 14 * 0.055 + fineSpoke ** 22 * 0.018)
                    * taper * (0.6 + detail[pixel] * 0.6);
                albedo[pixel] += rays * freshness;
            }
        });
    }

    // Older broad impacts first; younger small impacts overlap them naturally.
    for (let i = 0; i < 31; i += 1) {
        crater(
            random(),
            Math.acos(1 - random() * 2) / Math.PI,
            0.043 + random() ** 2 * 0.077,
            0.28 + random() * 0.28,
        );
    }
    for (let i = 0; i < 880; i += 1) {
        const u = random();
        const v = Math.acos(1 - random() * 2) / Math.PI;
        const center = Math.min(height - 1, Math.floor(v * height)) * width
            + Math.min(width - 1, Math.floor(u * width));
        if (random() < maria[center] * 0.84) continue;
        const radius = i < 80 ? 0.022 + random() ** 2 * 0.033 : 0.005 + random() ** 3 * 0.029;
        crater(u, v, radius, 0.25 + random() * 0.37);
    }
    crater(0.258, 0.310, 0.034, 1, 7.8); // A restrained Tycho-like ray system.
    crater(0.192, 0.506, 0.040, 1, 4.6);
    crater(0.327, 0.394, 0.054, 0.8, 2.8);
    crater(0.364, 0.655, 0.037, 0.82, 2.1);

    const pixels = new Uint8Array(count * 4);
    const normals = new Uint8Array(count * 4);
    for (let y = 0; y < height; y += 1) {
        const row = y * width;
        const previousRow = Math.max(0, y - 1) * width;
        const nextRow = Math.min(height - 1, y + 1) * width;
        // Longitude collapses at a pole; suppress subpixel polar noise instead
        // of letting its finite difference produce an artificial bright spike.
        const eastScale = width / (2 * TAU * Math.max(latitudeCos[y], 0.08));
        const northScale = height / (2 * Math.PI);
        for (let x = 0; x < width; x += 1) {
            const index = row + x;
            const pixel = index * 4;
            const shade = Math.round(Math.max(0.075, Math.min(0.76, albedo[index])) * 255);
            pixels[pixel] = shade;
            pixels[pixel + 1] = shade;
            pixels[pixel + 2] = shade;
            pixels[pixel + 3] = 255;
            const nx = (relief[row + ((x + width - 1) % width)]
                - relief[row + ((x + 1) % width)]) * eastScale;
            const ny = (relief[previousRow + x] - relief[nextRow + x]) * northScale;
            const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
            normals[pixel] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
            normals[pixel + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
            normals[pixel + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
            normals[pixel + 3] = 255;
        }
    }
    return {
        pixels, normals, width, height,
    };
}

function createTexture(THREE, data, width, height) {
    const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    map.colorSpace = THREE.NoColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.flipY = false;
    map.needsUpdate = true;
    return map;
}

export function createLunarSurface(THREE, size = 1024) {
    const width = Math.max(128, Math.min(2048, Math.round(size / 2) * 2));
    if (!surfaceCache.has(width)) surfaceCache.set(width, bakeSurface(width));
    const baked = surfaceCache.get(width);
    const texture = createTexture(THREE, baked.pixels, width, baked.height);
    const normalTexture = createTexture(THREE, baked.normals, width, baked.height);
    texture.name = 'Blood Moon lunar albedo';
    normalTexture.name = 'Blood Moon lunar relief';
    return {
        texture,
        normalTexture,
        dispose() {
            texture.dispose();
            normalTexture.dispose();
        },
    };
}

/** Preserve the authored lunar geology, with only gentle matching fine relief. */
function bakeAuthoredSurface(image, width) {
    const height = width / 2;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Lunar atlas canvas is unavailable');
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const pixels = new Uint8Array(width * height * 4);
    const normals = new Uint8Array(pixels.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const input = (y * width + x) * 4;
            const output = ((height - 1 - y) * width + x) * 4;
            const shade = Math.round(data[input] * 0.2126 + data[input + 1] * 0.7152 + data[input + 2] * 0.0722);
            pixels[output] = shade; pixels[output + 1] = shade; pixels[output + 2] = shade;
            pixels[output + 3] = 255;
        }
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const output = (y * width + x) * 4;
            const nx = (pixels[(y * width + ((x + width - 1) % width)) * 4]
                - pixels[(y * width + ((x + 1) % width)) * 4]) * (1.3 / 255);
            const ny = (pixels[(Math.max(0, y - 1) * width + x) * 4]
                - pixels[(Math.min(height - 1, y + 1) * width + x) * 4]) * (1.3 / 255);
            const inverseLength = 1 / Math.sqrt(nx * nx + ny * ny + 1);
            normals[output] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
            normals[output + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
            normals[output + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
            normals[output + 3] = 255;
        }
    }
    return {
        pixels, normals, width, height, source: 'authored',
    };
}

/** Two caller-owned textures; image decode and each size's CPU atlas are shared. */
export function createAuthoredLunarSurface(THREE, size = 1024) {
    const width = Math.max(128, Math.min(2048, Math.round(size / 2) * 2));
    const texture = createTexture(THREE, new Uint8Array([128, 128, 128, 255]), 1, 1);
    const normalTexture = createTexture(THREE, new Uint8Array([128, 128, 255, 255]), 1, 1);
    texture.name = 'Blood Moon authored lunar albedo';
    normalTexture.name = 'Blood Moon authored lunar relief';
    let disposed = false;
    let source = 'authored';
    if (!authoredImageReady) {
        authoredImageReady = new Promise((resolve, reject) => {
            new THREE.ImageLoader().load('./textures/2k_moon.jpg', resolve, undefined, reject);
        });
    }
    if (!authoredSurfaceCache.has(width)) {
        authoredSurfaceCache.set(width, authoredImageReady
            .then((image) => bakeAuthoredSurface(image, width)).catch(() => {
                if (!surfaceCache.has(width)) surfaceCache.set(width, bakeSurface(width));
                return { ...surfaceCache.get(width), source: 'procedural-fallback' };
            }));
    }
    const ready = authoredSurfaceCache.get(width).then((baked) => {
        if (disposed) return;
        ({ source } = baked);
        texture.image = { data: baked.pixels, width, height: baked.height };
        normalTexture.image = { data: baked.normals, width, height: baked.height };
        texture.needsUpdate = true; normalTexture.needsUpdate = true;
    });
    return {
        texture,
        normalTexture,
        ready,
        get source() { return source; },
        dispose() {
            if (disposed) return;
            disposed = true;
            texture.dispose(); normalTexture.dispose();
        },
    };
}
