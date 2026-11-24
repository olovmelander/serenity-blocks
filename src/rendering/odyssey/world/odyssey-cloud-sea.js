/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, attribute, clamp, dot, exp, float, length, max, mix, positionLocal, sin, smoothstep,
    texture, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { ODYSSEY_MASSIFS } from './odyssey-world-height.js';
import { ODYSSEY_WORLD_SUN } from '../chapter-environments/shared/chapter-profile.js';
import { ODYSSEY_EVENING_U } from './odyssey-evening.js';

/**
 * THE SEA OF CLOUDS (rebuilt 2026-11-24): what gathers below the climb as chapter 5's day ends (the evening
 * is odyssey-evening.js), from the horizon inward, until the mountain stands out of a floor of cloud, the
 * island's lee still open below the eye.
 *
 * This is its BED. (What stands up out of it, near the eye, are the sky's own traced clouds: the floor's
 * shelves, odyssey-cloud-composition.js. A floor that was all mesh read as snow dunes, whatever its paint.)
 * One tiling landscape of cloud, sculpted and lit offline by the world's one sun, its shadows raked across
 * the deck and softened by the light a body of cloud hands on (scripts/blender/odyssey/clouds/sea.py). A ring
 * of mesh round the summit stands up a little in its heights; every pixel reads its light, in the clouds' own
 * colours (`light`), so the heaps above and the floor below are one sky.
 *
 * It ends softly: the plate says which of it is firmest, and where there is less cover only that still
 * stands, sinking and thinning at its edges. It never has an outline.
 *
 * ALIVE: it flows downwind through the clear air over the island (`clear`), breathing, forming upwind and
 * thinning in the lee; the mountain's shadow lies across it, and a glory at the shadow's tip.
 */

const HERO = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
const SUN_FLAT_LEN = Math.hypot(ODYSSEY_WORLD_SUN[0], ODYSSEY_WORLD_SUN[2]);
const SUN_FLAT = Object.freeze([ODYSSEY_WORLD_SUN[0] / SUN_FLAT_LEN, ODYSSEY_WORLD_SUN[2] / SUN_FLAT_LEN]);
const URL_SEA = new URL('../assets/clouds/sea.png', import.meta.url).href;

export const ODYSSEY_CLOUD_SEA = Object.freeze({
    /** The plate: its side in world units and texels (sea.py TILE), and how far its heights stand up (a soft bed:
     * what rises out of it is the floor's own clouds, odyssey-cloud-composition.js). */
    tile: 5200,
    res: 512,
    amp: 120,
    base: 486,
    /** Downwind, and how fast the floor flows (u/s). */
    wind: Object.freeze([-0.928, -0.373]),
    speed: 5.5,
    centre: Object.freeze({ x: HERO.x, z: HERO.z }),
    /**
     * THE CLEAR AIR: no cloud within `clear[0]` of the summit's axis (the mountain, and the rail up its face),
     * nor within `clear[1]` toward `open` (the island's lee, which the climb's last orbs look down on); whole
     * `ramp` beyond that.
     */
    clear: Object.freeze([900, 1900]),
    open: Object.freeze([0.94, -0.342]),
    ramp: 1300,
    inner: 700,
    outer: 11500,
    grid: Object.freeze({ high: Object.freeze([320, 112]), low: Object.freeze([176, 60]) }),
    /** It gathers from the horizon inward. */
    gatherFar: Object.freeze([1400, 7000]),
    /** The most of it that ever stands, the least in its lanes, and how it breathes. */
    cover: 0.92,
    laneCover: 0.52,
    breath: 0.05,
    breathPeriod: 61,
    /** How softly it ends (shares of firmness), and from very high. */
    edge: 0.17,
    edgeHigh: 0.34,
    /** From very high it eases into one soft bright sheet, as the Earth's own weather looks. */
    soften: Object.freeze([1.5, 4.6]),
    softTops: 0.94,
    /** How far its own light is drawn toward its mean: a bed is calm. */
    calm: 0.46,
    /** The small billows read on it up close: how much finer, how strong, to what range (u). */
    detail: Object.freeze({ scale: 5.3, gain: 0.28, range: Object.freeze([900, 2600]) }),
    glory: Object.freeze({
        rings: Object.freeze([3.4, 6.6]), width: 0.80, spread: 0.75, gain: 0.42,
    }),
    summitY: HERO.footY + HERO.height,
    summitHalfWidth: 300,
    wedge: 0.55,
});

const smooth01 = (a, b, v) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - (2 * t));
};

/** The cover at (x, z) without its lanes and breath, `gather` 0..1 (the shader's `coverAt`, for tests). */
export function cloudSeaCover(x, z, gather) {
    const S = ODYSSEY_CLOUD_SEA;
    const dx = x - S.centre.x;
    const dz = z - S.centre.z;
    const r = Math.hypot(dx, dz);
    const toward = ((dx * S.open[0]) + (dz * S.open[1])) / Math.max(r, 1);
    const clear = S.clear[0] + (smooth01(-0.45, 0.9, toward) * (S.clear[1] - S.clear[0]));
    const ring = smooth01(clear, clear + S.ramp, r);
    const rim = 1 - smooth01(S.outer * 0.84, S.outer * 0.98, r);
    const near = 1 - smooth01(S.gatherFar[0], S.gatherFar[1], r);
    const g = Math.min(Math.max(Number.isFinite(gather) ? gather : 0, 0), 1);
    return ring * rim * smooth01(0, 1, (g * 2) - near) * S.cover;
}

/** The cover at the edge nearest the summit of a cloud `reach` u wide round (x, z). */
export function seaFloorAt(x, z, reach, gather) {
    const S = ODYSSEY_CLOUD_SEA;
    const dx = x - S.centre.x;
    const dz = z - S.centre.z;
    const r = Math.max(Math.hypot(dx, dz), 1);
    const k = Math.max(0, r - reach) / r;
    return cloudSeaCover(S.centre.x + (dx * k), S.centre.z + (dz * k), gather);
}

/** The ring mesh: `segments` round, `rings` out, radii geometric; its outermost triangles first (far to near). */
function buildSeaGeometry(segments, rings) {
    const S = ODYSSEY_CLOUD_SEA;
    const count = (rings + 1) * segments;
    const position = new Float32Array(count * 3);
    const spacing = new Float32Array(count);
    const ratio = (S.outer / S.inner) ** (1 / rings);
    for (let i = 0; i <= rings; i += 1) {
        const r = S.inner * (ratio ** i);
        for (let j = 0; j < segments; j += 1) {
            const a = ((j + ((i % 2) * 0.5)) / segments) * Math.PI * 2;
            const o = ((i * segments) + j) * 3;
            position[o] = S.centre.x + (Math.cos(a) * r);
            position[o + 1] = S.base;
            position[o + 2] = S.centre.z + (Math.sin(a) * r);
            spacing[(i * segments) + j] = Math.max(r * (ratio - 1), (2 * Math.PI * r) / segments);
        }
    }
    const index = new Uint32Array(rings * segments * 6);
    let k = 0;
    for (let i = rings - 1; i >= 0; i -= 1) {
        for (let j = 0; j < segments; j += 1) {
            const a = (i * segments) + j;
            const b = (i * segments) + ((j + 1) % segments);
            const c = ((i + 1) * segments) + j;
            const d = ((i + 1) * segments) + ((j + 1) % segments);
            if (i % 2 === 0) index.set([a, b, c, b, d, c], k);
            else index.set([a, d, c, a, b, d], k);
            k += 6;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aSpacing', new THREE.BufferAttribute(spacing, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(S.centre.x, S.base, S.centre.z), S.outer + S.amp);
    return { geometry, triangles: rings * segments * 2 };
}

/**
 * @param {object} kit the world's own nodes
 * @param {object} kit.cameraPosition the eye, in the world group's own frame
 * @param {(dir: object) => object} kit.skyAirAt the world's air for a view direction
 * @param {{prepare: Function, light: Function}} kit.light the clouds' light (the renderer's skyCloudLight)
 * @param {(colour: object) => object} kit.toCloudOutput
 * @param {object} kit.aerialK the air's density
 * @param {object} [kit.climb] 1 / the world group's scale
 * @param {((xz: object) => object)|null} [kit.cloudShadowLight]
 * @param {'high'|'low'} [kit.quality]
 * @param {boolean} [kit.load] fetch the plate
 */
export function createOdysseyCloudSea({
    cameraPosition, skyAirAt, light, toCloudOutput, aerialK, climb = float(1), cloudShadowLight = null, quality = 'high', load = true,
}) {
    const S = ODYSSEY_CLOUD_SEA;
    const E = ODYSSEY_EVENING_U;
    const lean = quality !== 'high';
    const plate = new THREE.Texture();
    plate.colorSpace = THREE.NoColorSpace;
    plate.wrapS = THREE.RepeatWrapping;
    plate.wrapT = THREE.RepeatWrapping;
    plate.magFilter = THREE.LinearFilter;
    plate.minFilter = THREE.LinearMipmapLinearFilter;
    plate.generateMipmaps = true;
    plate.flipY = false;
    plate.anisotropy = 4;
    let ready = false;
    let disposed = false;
    if (load && typeof createImageBitmap === 'function' && typeof fetch === 'function' && typeof document !== 'undefined') {
        fetch(URL_SEA)
            .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`cloud sea ${res.status}`))))
            .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
            .then((bitmap) => {
                if (disposed) { bitmap.close?.(); return; }
                plate.image = bitmap;
                plate.needsUpdate = true;
                ready = true;
            })
            .catch((error) => console.warn('[OdysseyClouds] cloud sea not loaded:', error?.message || error));
    }

    const [segments, rings] = lean ? S.grid.low : S.grid.high;
    const { geometry, triangles } = buildSeaGeometry(segments, rings);
    const uGather = uniform(0);
    const uDrift = uniform(new THREE.Vector2(0, 0));
    const uBreath = uniform(0);
    const fromHigh = smoothstep(float(S.soften[0]), float(S.soften[1]), climb);

    // (The helpers' parameters carry names of their own: the world's source lint follows a positionNode's
    // identifiers through same-file consts by name.)
    const plateUv = (place) => place.div(S.tile).add(uDrift);
    const regionUv = (place) => vec2(
        place.x.mul(0.8).sub(place.y.mul(0.6)),
        place.x.mul(0.6).add(place.y.mul(0.8)),
    ).div(S.tile * 2.6).add(uDrift.mul(0.31));
    const coverAt = (place, regionIn) => {
        const rel = place.sub(vec2(S.centre.x, S.centre.z));
        const r = length(rel);
        const toward = dot(rel, vec2(...S.open)).div(max(r, float(1)));
        const clear = float(S.clear[0]).add(smoothstep(float(-0.45), float(0.9), toward).mul(S.clear[1] - S.clear[0]));
        const ring = smoothstep(clear, clear.add(S.ramp), r.add(regionIn.sub(0.5).mul(900)));
        const rimWhole = float(1).sub(smoothstep(float(S.outer * 0.84), float(S.outer * 0.98), r));
        // From very high its shore is the regions' own, never a circle.
        const shore = r.div(S.outer).add(float(0.45).sub(regionIn).mul(1.5));
        const rim = rimWhole.mul(mix(float(1), float(1).sub(smoothstep(float(0.42), float(0.86), shore)), fromHigh));
        const near = float(1).sub(smoothstep(float(S.gatherFar[0]), float(S.gatherFar[1]), r));
        const gathered = smoothstep(float(0), float(1), uGather.mul(2).sub(near));
        const breath = sin(uBreath.add(place.x.mul(0.0011)).add(place.y.mul(0.0007))).mul(S.breath);
        const lanes = mix(float(S.laneCover), float(S.cover), smoothstep(float(0.30), float(0.58), regionIn));
        const whole = mix(lanes.add(smoothstep(float(4500), float(8000), r).mul(0.15)), float(0.96), fromHigh).add(breath);
        return ring.mul(rim).mul(gathered).mul(whole).clamp(0, 1);
    };
    /** How much of the plate stands at a cover: the firmest last. (From very high its shore is a wide thinning.) */
    const shoreWide = mix(float(S.edge), float(S.edgeHigh), fromHigh);
    const standing = (firmIn, coverIn) => smoothstep(
        shoreWide.negate(),
        shoreWide,
        firmIn.sub(float(1).sub(coverIn)),
    ).mul(smoothstep(float(0.0), float(0.08), coverIn));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyCloudSea';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.depthWrite = true;
    material.alphaTest = 0.01;

    const aSpacing = attribute('aSpacing', 'float');
    const texel = S.tile / S.res;
    const vertXZ = positionLocal.xz;
    const vertMip = aSpacing.div(texel).mul(1.4).max(1.9).log2()
        .clamp(0, 7);
    const vertRegion = texture(plate, regionUv(vertXZ)).level(3).a;
    const vertPlate = texture(plate, plateUv(vertXZ)).level(vertMip);
    const vertStand = standing(texture(plate, plateUv(vertXZ)).level(1).a, coverAt(vertXZ, vertRegion));
    const lifted = () => vec3(
        positionLocal.x,
        float(S.base).add(vertPlate.r.mul(S.amp).mul(vertStand.mul(0.75).add(0.25))),
        positionLocal.z,
    );
    material.positionNode = lifted();
    const vWorld = varying(lifted(), 'seaWorld');

    material.outputNode = Fn(() => {
        const wp = vWorld.toVar();
        const xz = wp.xz.toVar();
        // (A bed is soft: read a mip down, three from high, so what is drawn of it is swells and not ripples.)
        const tex = texture(plate, plateUv(xz)).bias(fromHigh.mul(1.8).add(1.2)).toVar();
        const fine = texture(plate, plateUv(xz).mul(S.detail.scale).add(vec2(0.31, 0.17))).toVar();
        const region = texture(plate, regionUv(xz)).level(3).a.toVar();
        const firm = texture(plate, plateUv(xz)).level(fromHigh.mul(2)).a.toVar();
        const cover = coverAt(xz, region).toVar();
        const stand = standing(firm, cover).toVar();
        const to = wp.sub(cameraPosition).toVar();
        const dist = length(to).toVar();
        const dir = to.div(max(dist, float(0.001))).toVar();
        const { sunDir } = E;
        const near = float(1).sub(smoothstep(float(S.detail.range[0]), float(S.detail.range[1]), dist)).toVar();
        // The mountain's shadow: a wedge from the summit's axis toward the antisolar point.
        const fromSummit = xz.sub(vec2(S.centre.x, S.centre.z)).toVar();
        const away = vec2(-SUN_FLAT[0], -SUN_FLAT[1]);
        const along = dot(fromSummit, away).toVar();
        const across = abs(fromSummit.x.mul(away.y).sub(fromSummit.y.mul(away.x)));
        const tanE = sunDir.y.div(max(length(sunDir.xz), float(0.05))).max(0.03);
        const reachM = float(S.summitY).sub(wp.y).div(tanE);
        const halfW = float(S.summitHalfWidth).mul(float(1).sub(along.div(max(reachM, float(1)))));
        const soft = along.mul(0.03).add(30);
        const wedge = smoothstep(float(0), float(200), along)
            .mul(float(1).sub(smoothstep(halfW.sub(soft), halfW.add(soft), across)))
            .mul(float(1).sub(smoothstep(reachM.mul(0.94), reachM.mul(1.04), along)))
            .mul(E.dusk.mul(4).clamp(0, 1));
        // (From very high the drifting shadows are specks: they go with the forms.)
        const drifting = cloudShadowLight && !lean ? mix(cloudShadowLight(xz).mul(0.5).add(0.5), float(1), fromHigh) : float(1);
        const billow = fine.g.sub(0.42).mul(S.detail.gain).mul(near).toVar();
        // From high and far the forms are pixels: the light goes to its own mean.
        const flat = max(fromHigh.mul(S.softTops), smoothstep(float(3000), float(9000), dist.div(climb)).mul(0.35).add(S.calm)).toVar();
        const sun = mix(tex.g, float(0.58), flat).add(billow.mul(tex.g.add(0.25)))
            .mul(float(1).sub(wedge.mul(S.wedge)))
            .mul(drifting)
            .clamp(0, 1);
        const kit = light.prepare(dir);
        const col = vec3(light.light(kit, {
            sun,
            sky: mix(tex.b, float(0.8), flat).add(billow.mul(0.3)).clamp(0, 1),
            ground: float(0.08),
            body: stand,
            h: clamp(tex.r.mul(1.4), 0, 1),
            relief: mix(clamp(tex.b.add(billow), 0, 1), float(0.6), flat),
            lit: mix(clamp(tex.g.mul(1.1).add(billow), 0, 1), float(0.6), flat),
            dens: stand.mul(0.7).add(0.3),
            eaten: float(1).sub(stand).mul(0.7),
        })).toVar();
        // THE GLORY: rings round the antisolar point, red outermost.
        If(E.glory.greaterThan(0.001), () => {
            const G = S.glory;
            const theta = dot(dir, E.antiDir).clamp(-1, 1).acos().mul(57.29578)
                .toVar();
            const ringAt = (deg, off) => {
                const d = theta.sub(deg + off).div(G.width);
                return exp(d.mul(d).negate());
            };
            const first = vec3(ringAt(G.rings[0], G.spread), ringAt(G.rings[0], 0), ringAt(G.rings[0], -G.spread));
            const second = vec3(
                ringAt(G.rings[1], G.spread * 1.3),
                ringAt(G.rings[1], 0),
                ringAt(G.rings[1], -G.spread * 1.3),
            ).mul(0.45);
            const core = exp(theta.mul(theta).div(3.4).negate()).mul(0.6);
            const bands = first.add(second).toVar();
            col.mulAssign(vec3(1).add(bands.sub(dot(bands, vec3(0.3333)).mul(0.55)).add(core).mul(E.glory.mul(G.gain))));
        });
        const hazeW = clamp(float(1).sub(exp(dist.mul(aerialK).negate())), 0, 0.82).mul(0.42);
        const farW = smoothstep(float(5200), float(8600), dist.div(climb));
        const aired = mix(col, skyAirAt(dir), max(hazeW, farW));
        const alpha = stand.mul(mix(float(0.55), float(1), smoothstep(float(0.0), float(0.55), stand))).toVar();
        return vec4(toCloudOutput(aired).mul(alpha), alpha);
    })();
    material.colorNode = vec3(0);
    material.opacityNode = standing(
        texture(plate, plateUv(vWorld.xz)).level(fromHigh.mul(2)).a,
        coverAt(vWorld.xz, texture(plate, regionUv(vWorld.xz)).level(3).a),
    );

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-world-cloud-sea';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.raycast = () => {};
    // After the sea (1), before the clouds that stand over it (2).
    mesh.renderOrder = 1.5;
    mesh.visible = false;

    return {
        mesh,
        plate,
        triangles,
        uniforms: { uGather, uDrift, uBreath },
        /**
         * @param {number} time seconds
         * @param {number} gather 0..1 (the evening's `sea`)
         * @param {boolean} shown whether the world lets it draw
         */
        update(time, gather, shown) {
            const t = Number.isFinite(time) ? time : 0;
            const g = Math.min(Math.max(Number.isFinite(gather) ? gather : 0, 0), 1);
            uGather.value = g;
            const run = (t * S.speed) / S.tile;
            // (The region's read is the drift's own 0.31: wrapped over a hundred tiles both stay whole.)
            uDrift.value.set(-(S.wind[0] * run) % 100, -(S.wind[1] * run) % 100);
            uBreath.value = ((t * 2 * Math.PI) / S.breathPeriod) % (2 * Math.PI);
            mesh.visible = !!shown && ready && g > 0.001;
        },
        dispose() {
            disposed = true;
            geometry.dispose();
            material.dispose();
            if (plate.image && typeof plate.image.close === 'function') plate.image.close();
            plate.dispose();
            mesh.removeFromParent();
        },
    };
}
