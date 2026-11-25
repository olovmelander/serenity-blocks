/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 8's SKY (2026-11-17 masterpiece pass).
 *
 * The city's sky was one flat purple under a smog ceiling. It is now a sky with structure, in the
 * city's own frame (corridor space: +Y up, -Z down the boulevard to the sun):
 *
 *   the vault     deep blue-black overhead, indigo-violet in its middle, a hot band on the horizon
 *                 that is rose-orange on the sun's side and violet away from it;
 *   the sun's air a wide warm glow round the sun's bearing (the disc itself is the Retrosun's quad);
 *   the deck      broken cloud overhead (a slab the view ray meets), closing in before a shower and
 *                 opening after it (`cover`), its bellies lit hot by the low sun on the sun's side
 *                 and rose or cyan by the districts under it, a bright lining where it thins;
 *   the bars      long thin cloud bars low on the sun's side, the same ones the disc's own cuts are;
 *   the stars     the journey's stars in the gaps (odyssey-neon-stars below), hidden by the deck;
 *   lightning     a patch of the deck lit from inside, in the heart of a shower.
 *
 * FIRST LIGHT (`dawn`, the journey's ending): the same sky on a second palette, crossed in
 * JavaScript, so the shader pays nothing for it: clear blue overhead, lavender, a gold horizon,
 * the deck's bellies on fire.
 *
 * `neonSkyLite` is the same vault without its cloud: what glass and wet asphalt mirror, and what
 * the far air turns to.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    modelWorldMatrix,
    normalize,
    positionGeometry,
    positionLocal,
    screenSize,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { latticeNoise3 } from './odyssey-lattice-noise.js';
import { mulberry32 } from './odyssey-neon-city-plan.js';

/** The sky's two palettes (scene-linear). Night is the chapter; dawn is the journey's ending. */
export const NEON_SKY_PALETTES = Object.freeze({
    night: Object.freeze({
        zenith: [0.003, 0.006, 0.024],
        mid: [0.013, 0.011, 0.072],
        horizonSun: [0.4, 0.05, 0.2],
        horizonFar: [0.024, 0.034, 0.16],
        sunGlow: [1.0, 0.34, 0.1],
        cloudBody: [0.026, 0.01, 0.058],
        cloudLit: [0.9, 0.17, 0.26],
        cityGlow: [0.11, 0.024, 0.19],
        haze: [0.02, 0.017, 0.072],
        hazeSun: [0.3, 0.065, 0.12],
        stars: 1,
    }),
    dawn: Object.freeze({
        zenith: [0.011, 0.032, 0.13],
        mid: [0.07, 0.066, 0.24],
        horizonSun: [0.8, 0.33, 0.13],
        horizonFar: [0.15, 0.09, 0.28],
        sunGlow: [0.85, 0.4, 0.13],
        cloudBody: [0.06, 0.035, 0.15],
        cloudLit: [1.05, 0.34, 0.19],
        cityGlow: [0.13, 0.045, 0.19],
        haze: [0.04, 0.027, 0.1],
        hazeSun: [0.42, 0.17, 0.09],
        stars: 0.22,
    }),
});

const PALETTE_KEYS = Object.freeze([
    'zenith', 'mid', 'horizonSun', 'horizonFar', 'sunGlow', 'cloudBody', 'cloudLit', 'cityGlow', 'haze', 'hazeSun',
]);

/** What is left of each of the night palette's sunlit colours at full dusk. */
const DUSK_KEEPS = Object.freeze({
    horizonSun: 0.36, sunGlow: 0.42, cloudLit: 0.3, hazeSun: 0.36, horizonFar: 0.72, mid: 0.8,
});

/** The sky's uniforms: one set, read by the dome, the stars, the air and every mirror. */
export function createNeonSkyUniforms() {
    const { night } = NEON_SKY_PALETTES;
    const S = {
        /** Unit vector from the eye to the sun's centre, corridor space. */
        sunDir: uniform(new THREE.Vector3(0, 0.14, -0.99)),
        /** 0..1 cloud cover (the weather), 0..1 the journey's end clearing, 0..1 first light. */
        cover: uniform(0.45),
        clear: uniform(0),
        dawn: uniform(0),
        /** How bright the stars are (the palette's, times the clearing). */
        stars: uniform(1),
        storm: uniform(0),
        /** The light of the ending's fireworks aloft (already through flashScale): a wash. */
        burst: uniform(new THREE.Vector3()),
    };
    PALETTE_KEYS.forEach((key) => { S[key] = uniform(new THREE.Vector3(...night[key])); });
    return S;
}

/**
 * Set the sky for a frame: the palette crossed between night and dawn, the sun's bearing.
 * @param {ReturnType<typeof createNeonSkyUniforms>} S
 * @param {{ dawn?: number, dusk?: number, cover?: number, clear?: number, storm?: number }} state
 *   `dusk` 0..1: how far the evening's afterglow has died (the sun sinking through the chapter,
 *   then the night's deepest at the journey's end, before first light)
 */
export function applyNeonSkyState(S, {
    dawn = 0, dusk = 0, cover = 0.45, clear = 0, storm = 0,
} = {}) {
    const d = Math.min(1, Math.max(0, dawn));
    const k = Math.min(1, Math.max(0, dusk));
    const { night, dawn: day } = NEON_SKY_PALETTES;
    PALETTE_KEYS.forEach((key) => {
        const a = night[key];
        const b = day[key];
        // The afterglow is what the sun still lights: it dies with the dusk; the vault only deepens.
        const keep = DUSK_KEEPS[key] === undefined ? 1 : 1 - ((1 - DUSK_KEEPS[key]) * k);
        S[key].value.set(
            (a[0] * keep) + ((b[0] - (a[0] * keep)) * d),
            (a[1] * keep) + ((b[1] - (a[1] * keep)) * d),
            (a[2] * keep) + ((b[2] - (a[2] * keep)) * d),
        );
    });
    S.dawn.value = d;
    // The clearing thins the deck; the dawn keeps a third of it to catch the light.
    S.cover.value = Math.min(1, Math.max(0, cover)) * (1 - (0.62 * Math.min(1, Math.max(0, clear))));
    S.clear.value = clear;
    S.storm.value = storm;
    const starsAtNight = night.stars * (1 + (0.6 * k));
    S.stars.value = starsAtNight + ((day.stars - starsAtNight) * d);
}

/**
 * The vault without cloud at corridor direction `dir` (unit): the gradient and the sun's air.
 * Cheap enough for a mirror: no texture, a handful of mixes.
 * @param {ReturnType<typeof createNeonSkyUniforms>} S
 * @param {*} dir vec3 node, unit
 */
export function neonSkyLite(S, dir) {
    const up = dir.y;
    const flat = vec2(dir.x, dir.z);
    const sunFlat = vec2(S.sunDir.x, S.sunDir.z);
    const bearing = dot(flat, sunFlat).div(max(length(flat).mul(length(sunFlat)), 1e-3));
    const side = smoothstep(-0.35, 1.0, bearing);
    const sunSide = side.mul(side);
    const horizon = mix(S.horizonFar, S.horizonSun, sunSide);
    const lower = mix(horizon, S.mid, smoothstep(-0.02, 0.2, up));
    // Under the horizon the far city's own dark air (the ground stands in front of most of it).
    const vault = mix(lower, S.zenith, smoothstep(0.14, 0.75, up)).mul(smoothstep(-0.3, 0.0, up).mul(0.75).add(0.25));
    // The hot line on the horizon itself.
    const line = horizon.mul(exp(up.abs().mul(-14.0))).mul(0.5);
    const c = clamp(dot(dir, S.sunDir), 0.0, 1.0);
    const c2 = c.mul(c);
    const c4 = c2.mul(c2);
    const c8 = c4.mul(c4);
    const c32 = c8.mul(c8).mul(c8).mul(c8);
    const glow = S.sunGlow.mul(c4.mul(0.1).add(c8.mul(0.22)).add(c32.mul(0.5)));
    return vault.add(line).add(glow);
}

/**
 * The deck's cover at corridor direction `dir`: 0 clear sky, 1 cloud. Level-0 lattice reads, so
 * the stars' vertex stage can ask it too.
 * @returns {{ cloud: *, body: *, fine: *, cuv: * }}
 */
function neonDeck(S, dir, time, octaves) {
    const up = max(dir.y, 0.0);
    const cuv = vec2(dir.x, dir.z).div(up.add(0.17));
    const drift = time.mul(0.0075);
    // Streets of cloud: longer across the boulevard than along it.
    const n1 = latticeNoise3(vec3(cuv.x.mul(1.05).add(drift), cuv.y.mul(1.7).add(drift.mul(0.55)), 4.2));
    const n2 = latticeNoise3(vec3(cuv.x.mul(2.9).sub(drift.mul(1.6)), cuv.y.mul(4.3).add(drift), 9.1));
    let body = n1.mul(0.62).add(n2.mul(0.38));
    let fine = n2;
    if (octaves > 2) {
        fine = latticeNoise3(vec3(cuv.x.mul(7.9).add(drift.mul(2.3)), cuv.y.mul(10.3), 15.7));
        body = n1.mul(0.55).add(n2.mul(0.3)).add(fine.mul(0.15));
    }
    const threshold = mix(float(0.66), float(0.33), S.cover);
    const cloud = smoothstep(threshold, threshold.add(0.085), body)
        // A flat deck at a grazing angle is squashed to dashes: it ends above the horizon bars.
        .mul(smoothstep(0.05, 0.19, dir.y));
    return {
        cloud, body, fine, cuv, threshold,
    };
}

/**
 * The sky dome, in the corridor group (its local space is corridor space).
 * @param {object} N neon uniforms (camCity, uTime, uEnergy, reveal) with `N.sky`
 * @param {{ octaves?: number }} [options] 3 on High, 2 below
 */
export function createNeonSkyDome(N, { octaves = 3 } = {}) {
    const S = N.sky;
    const uOpacity = uniform(1.0);

    const colorNode = Fn(() => {
        const dir = normalize(positionLocal.sub(N.camCity)).toVar();
        const up = dir.y.toVar();
        const sky = neonSkyLite(S, dir).toVar();
        const flat = vec2(dir.x, dir.z);
        const sunFlat = vec2(S.sunDir.x, S.sunDir.z);
        const bearing = dot(flat, sunFlat).div(max(length(flat).mul(length(sunFlat)), 1e-3)).toVar();
        const side = smoothstep(-0.2, 1.0, bearing);
        const sunSide = side.mul(side).toVar();
        const cs = clamp(dot(dir, S.sunDir), 0.0, 1.0).toVar();

        // ── The deck ──
        const deck = neonDeck(S, dir, N.uTime, octaves);
        const cloud = deck.cloud.toVar();
        const body = deck.body.toVar();
        // Sculpted by the low sun: the side of each heap that faces the sun's bearing is lit, the
        // far side falls into the heap's own shade (one more lattice read, a step toward the sun).
        const toSun = sunFlat.div(max(length(sunFlat), 1e-3)).mul(0.22);
        const ahead = latticeNoise3(vec3(
            deck.cuv.x.add(toSun.x).mul(1.05).add(N.uTime.mul(0.0075)),
            deck.cuv.y.add(toSun.y).mul(1.7).add(N.uTime.mul(0.004125)),
            4.2,
        ));
        const sculpt = clamp(body.sub(ahead.mul(0.62).add(deck.fine.mul(0.38))).mul(3.2).add(0.62), 0.12, 1.5).toVar();
        const lining = cloud.mul(float(1.0).sub(smoothstep(deck.threshold.add(0.07), deck.threshold.add(0.3), body)));
        // Lit from below: hot on the sun's side and low, the districts' colours everywhere else.
        const district = smoothstep(0.38, 0.62, latticeNoise3(vec3(deck.cuv.x.mul(0.16), deck.cuv.y.mul(0.16), 1.3)));
        const cityTint = mix(S.cityGlow, vec3(0.03, 0.16, 0.3).mul(S.cityGlow.z.mul(3.4)), district);
        const low = exp(max(up, 0.0).mul(-3.4)).toVar();
        const belly = deck.fine.mul(0.5).add(0.6);
        const nearSun = smoothstep(0.15, 1.0, bearing);
        const sunLit = S.cloudLit.mul(nearSun.mul(nearSun)).mul(low.mul(low).mul(1.7).add(0.015)).mul(sculpt);
        const cityLit = cityTint.mul(low.mul(0.8).add(0.2)).mul(belly)
            .mul(N.uEnergy.mul(0.25).add(0.8)).mul(N.reveal.mul(0.3).add(1.0));
        const cs2 = cs.mul(cs);
        const silver = S.sunGlow.mul(lining).mul(cs2.mul(cs2).mul(0.6).add(sunSide.mul(low).mul(0.16)));
        const deckCol = S.cloudBody.mul(sculpt.mul(0.5).add(0.6))
            .add(sunLit)
            .add(cityLit)
            .add(silver);

        // ── The bars: long thin cloud low on the sky, thickest on the sun's side ──
        const barNoise = latticeNoise3(vec3(
            dir.x.mul(2.6).add(N.uTime.mul(0.0016)),
            up.mul(46.0).add(3.0),
            dir.z.mul(2.6),
        ));
        const barBand = smoothstep(0.005, 0.035, up).mul(float(1.0).sub(smoothstep(0.1, 0.25, up)));
        const bars = smoothstep(0.5, 0.66, barNoise.add(sunSide.mul(0.1))).mul(barBand).toVar();
        const barCol = mix(S.cloudBody.mul(1.3), S.cloudLit.mul(0.9), sunSide.mul(0.85))
            .add(S.sunGlow.mul(cs2.mul(cs2).mul(0.35)));

        // Sheet lightning inside the deck, in the heart of a shower.
        const cell = latticeNoise3(vec3(deck.cuv.x.mul(0.22).add(N.uTime.mul(0.01)), deck.cuv.y.mul(0.22), 7.7));
        const sheet = smoothstep(0.5, 0.8, cell).mul(cloud.mul(0.7).add(0.3)).mul(smoothstep(0.03, 0.24, up));

        const withBars = mix(sky, barCol, bars.mul(0.82));
        return mix(withBars, deckCol, cloud.mul(0.93))
            .add(vec3(0.5, 0.62, 1.0).mul(sheet).mul(S.storm).mul(0.55))
            // The fireworks' light lands on the cloud's bellies and bars, and a breath of it on the air.
            .add(S.burst.mul(cloud.mul(0.2).add(bars.mul(0.12)).add(0.025)));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-sky';
    material.colorNode = colorNode;
    material.opacityNode = uOpacity;
    material.uniforms = { uOpacity }; // ecotone crossfade bridge (manager reads material.uniforms)
    material.side = THREE.BackSide;
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;

    // Behind every piece of the city (the far ground reaches ~5 km).
    const geometry = new THREE.SphereGeometry(7000, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-sky-dome';
    mesh.renderOrder = -100;
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

/**
 * THE STARS over the city: the journey's stars, seen in the deck's gaps. One instanced draw of
 * points at infinity in the corridor frame, never under a pixel (the clamp's extra area is paid
 * back in light), hidden where the deck stands in front of them (the same lattice reads, in the
 * vertex stage), thinned toward the horizon's glow and by first light.
 * @param {object} N neon uniforms with `N.sky`
 * @param {number} count
 */
export function createNeonStars(N, count, { octaves = 2 } = {}) {
    const S = N.sky;
    const rand = mulberry32(0x57a25);
    const dirs = new Float32Array(count * 3);
    const looks = new Float32Array(count * 4); // magnitude, warmth, twinkle rate, phase
    for (let i = 0; i < count; i += 1) {
        // Even over the upper hemisphere (and a little below the horizon: the eye rises).
        const y = -0.04 + (rand() * 1.04);
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - (y * y)));
        dirs.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
        // Most are faint, a few are bright.
        const m = rand();
        looks.set([0.25 + (m * m * m * 1.6), rand(), 0.4 + (rand() * 1.6), rand() * 6.283], i * 4);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute('aStarDir', new THREE.InstancedBufferAttribute(dirs, 3));
    geometry.setAttribute('aStarLook', new THREE.InstancedBufferAttribute(looks, 4));
    geometry.instanceCount = count;

    const uOpacity = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-stars';
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.forceSinglePass = true;
    material.uniforms = { uOpacity };
    const vLight = varyingProperty('vec3', 'nsStar');
    material.vertexNode = Fn(() => {
        const dir = attribute('aStarDir', 'vec3');
        const look = attribute('aStarLook', 'vec4');
        const worldDir = normalize(modelWorldMatrix.mul(vec4(dir, 0.0)).xyz);
        // Far past the city, inside the dome and the camera's far plane.
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(worldDir.mul(5200.0), 0.0)).toVar();
        const deck = neonDeck(S, dir, N.uTime, octaves);
        const pixelScale = screenSize.y.div(1080.0);
        const size = look.x.mul(0.9).add(0.55).mul(pixelScale);
        const px = max(size, 1.0);
        const paid = clamp(size.div(px), 0.35, 1.0);
        const twinkle = sin(N.uTime.mul(look.z).add(look.w)).mul(0.16).add(0.84);
        const colour = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.86, 0.7), look.y);
        // Thinned by the horizon's glow and drowned in the sun's air.
        const cs = clamp(dot(dir, S.sunDir), 0.0, 1.0);
        const seen = smoothstep(0.03, 0.34, dir.y).mul(float(1.0).sub(cs.mul(cs).mul(cs)))
            .mul(float(1.0).sub(deck.cloud));
        vLight.assign(colour.mul(look.x).mul(twinkle).mul(paid.mul(paid)).mul(seen)
            .mul(S.stars)
            .mul(0.55));
        const half = px.mul(2.6);
        const offset = positionGeometry.xy.mul(half).div(screenSize.mul(0.5)).mul(clip.w);
        const behind = step(clip.w, 0.0);
        return vec4(clip.xy.add(offset), mix(clip.w.mul(0.9999), clip.w.mul(2.0), behind), clip.w);
    })();
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r = length(q).mul(2.6);
        const core = exp(r.mul(r).mul(-1.3)).add(exp(r.mul(-1.6)).mul(0.05));
        const edge = float(1.0).sub(smoothstep(0.8, 1.0, length(q)));
        return vec4(vLight.mul(core).mul(edge).mul(uOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-stars';
    mesh.frustumCulled = false;
    mesh.renderOrder = -99;
    return mesh;
}
