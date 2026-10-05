/**
 * Neon District — everything that advertises.
 *
 *  - Shopfronts: the district's painted shopfronts (one atlas), seated in the plinth of every
 *    block, emitting their own neon in HDR.
 *  - Tube signs: blades hung over the pavement, bent from the sign-maker's alphabet (a baked
 *    distance-field atlas: trade words in Latin capitals, the rest in the district's own script).
 *    Each has a hot white core and a coloured halo; a few buzz, a few have a dying character.
 *  - Billboard screens: LED walls facing down the street, cross-fading between two adverts with a
 *    rolling refresh bar.
 *
 * All three answer the gameplay pulses: a lock shell tints them as it passes, a clear wave makes
 * each one flare as the front reaches it, a blackout pulls them down to a ghost and a glitch
 * tears them.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    exp,
    float,
    floor,
    fract,
    fwidth,
    max,
    min,
    mix,
    mod,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    step,
    texture,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import {
    STREET,
    ndAtmosphere,
    ndClearLight,
    ndHash21,
    ndLockLight,
    ndMax3,
    ndQuadGeometry,
    ndWrapZ,
} from './neon-district-tsl.js';
import { BILLBOARD_CELLS, SHOPFRONT_CELLS } from './neon-district-atlas.js';
import {
    GLYPH_GRID, GLYPH_RANGE, bakeGlyphAtlas,
} from './neon-district-glyphs.js';
import { MAX_SIGN_GLYPHS } from './neon-district-layout.js';

/** A 2 × 2 black stand-in until an atlas has loaded. */
export function createPlaceholderTexture() {
    const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/** The sign-maker's alphabet as a distance-field texture. */
export function createGlyphTexture() {
    const { data, size } = bakeGlyphAtlas();
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'neon-district-glyphs';
    tex.needsUpdate = true;
    return tex;
}

/** Pulses evaluated per vertex (signs are small): lock shells + clear fronts, and the afterglow. */
function vertexPulses(u, world) {
    const clear = ndClearLight(u, world.z);
    return {
        light: varying(ndLockLight(u, world).add(clear.rgb), 'ndPulse'),
        after: varying(clear.w, 'ndAfter'),
    };
}

const finish = (name, geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return { mesh, material, geometry };
};

// ── Shopfronts ──────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {object[]} shopfronts  plan.shopfronts
 * @param {object} atlas         TextureNode over the shopfront atlas (value swapped when loaded)
 * @param {object} fade          uniform 0..1: the shopfronts power up once the atlas has arrived
 */
export function createShopfronts(u, shopfronts, atlas, fade) {
    const count = shopfronts.length;
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aRect = new Float32Array(count * 4);
    shopfronts.forEach((s, i) => {
        const cell = SHOPFRONT_CELLS[s.cell];
        aPos.set([s.side * (STREET.halfStreet - 0.05), 0.12 + s.h / 2, s.z, s.seed], i * 4);
        aDim.set([s.w, s.h, s.side, 0], i * 4);
        aRect.set(cell.rect, i * 4);
    });
    const geometry = ndQuadGeometry(count, { aPos: [aPos, 4], aDim: [aDim, 4], aRect: [aRect, 4] });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const rect = attribute('aRect', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'NeonDistrictShopfronts';
    material.fog = false;
    const zc = ndWrapZ(pos.z.add(u.scroll));
    const world = vec3(
        pos.x,
        pos.y.add(positionGeometry.y.mul(dim.y)),
        zc.add(positionGeometry.x.mul(dim.x).mul(dim.z)),
    );
    material.positionNode = world;
    const pulses = vertexPulses(u, world);

    material.colorNode = Fn(() => {
        const st = uv();
        const seed = floor(pos.w.add(0.5));
        // Atlas rect is (u0, v0, u1, v1) with v down from the top of the image.
        const auv = vec2(mix(rect.x, rect.z, st.x), float(1.0).sub(mix(rect.w, rect.y, st.y)));
        const t = atlas.sample(auv).rgb;
        const peak = ndMax3(t);
        // The paintings are already lit: lift their neon into HDR, leave the brickwork dark.
        const hot = t.mul(peak.mul(peak).mul(3.1).add(0.42));
        // A shop in ten has a failing transformer.
        const buzz = step(0.9, ndHash21(vec2(seed, 3.0)))
            .mul(step(0.62, ndHash21(vec2(floor(u.time.mul(11.0)), seed))));
        const power = u.neon.mul(0.93).add(0.07).mul(float(1.0).sub(buzz.mul(0.45))).mul(fade);
        const flare = pulses.light.mul(peak.mul(1.4).add(0.1)).add(pulses.after.mul(0.2).mul(hot));
        return ndAtmosphere(u, hot.mul(power).add(flare), positionWorld);
    })();
    return finish('NeonDistrictShopfronts', geometry, material);
}

// ── Tube signs ──────────────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {object[]} signs   plan.signs
 * @param {THREE.Texture} glyphTex
 */
export function createSigns(u, signs, glyphTex) {
    const count = signs.length;
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aCol = new Float32Array(count * 4);
    const aGlyphA = new Float32Array(count * 4);
    const aGlyphB = new Float32Array(count * 4);
    signs.forEach((s, i) => {
        const n = Math.max(1, Math.min(MAX_SIGN_GLYPHS, s.glyphs.length));
        aPos.set([s.x, s.y, s.z, s.seed], i * 4);
        aDim.set([s.w, s.h, s.vertical ? n : -n, s.style], i * 4);
        aCol.set([s.rgb[0], s.rgb[1], s.rgb[2], s.flicker], i * 4);
        for (let k = 0; k < MAX_SIGN_GLYPHS; k++) {
            const id = s.glyphs[k] ?? 0;
            if (k < 4) aGlyphA[i * 4 + k] = id;
            else aGlyphB[i * 4 + k - 4] = id;
        }
    });
    const geometry = ndQuadGeometry(count, {
        aPos: [aPos, 4], aDim: [aDim, 4], aCol: [aCol, 4], aGlyphA: [aGlyphA, 4], aGlyphB: [aGlyphB, 4],
    });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const col = attribute('aCol', 'vec4');
    const gA = attribute('aGlyphA', 'vec4');
    const gB = attribute('aGlyphB', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'NeonDistrictSigns';
    material.fog = false;
    const zc = ndWrapZ(pos.z.add(u.scroll));
    const world = vec3(
        pos.x.add(positionGeometry.x.mul(dim.x)),
        pos.y.add(positionGeometry.y.mul(dim.y)),
        zc,
    );
    material.positionNode = world;
    const pulses = vertexPulses(u, world);

    material.colorNode = Fn(() => {
        const st = uv();
        const seed = floor(pos.w.add(0.5));
        const n = abs(dim.z);
        const vertical = step(0.0, dim.z);
        const style = dim.w;

        // ── Which character, and where in its cell ──
        const along = mix(st.x, float(1.0).sub(st.y), vertical);
        const run = clamp(along.sub(0.035).div(0.93), 0.0, 0.9999).mul(n);
        const idx = floor(run);
        const cu = fract(run);
        const guv = vec2(mix(cu, st.x, vertical), mix(st.y, float(1.0).sub(cu), vertical));
        let id = float(0.0);
        for (let k = 0; k < MAX_SIGN_GLYPHS; k++) {
            const comp = (k < 4 ? gA : gB)['xyzw'[k % 4]];
            id = id.add(comp.mul(step(k - 0.5, idx)).mul(step(idx, k + 0.5)));
        }
        id = floor(id.add(0.5));
        const gc = vec2(mod(id, GLYPH_GRID), floor(id.div(GLYPH_GRID)));
        const auv = gc.add(clamp(guv, 0.015, 0.985)).div(GLYPH_GRID);
        const d = float(1.0).sub(texture(glyphTex, auv).r).mul(GLYPH_RANGE);
        const aa = fwidth(d).mul(0.9).add(0.003);

        // ── Life: a steady hum, the odd buzzing sign, the odd dying character ──
        const gh = ndHash21(vec2(idx.add(seed.mul(0.37)), seed));
        const dying = step(0.94, gh);
        const tick = ndHash21(vec2(floor(u.time.mul(gh.mul(9.0).add(6.0))), seed.add(idx)));
        const charOn = mix(float(1.0), step(0.4, tick), dying);
        const buzzing = step(0.86, col.w);
        const buzz = mix(float(1.0), step(0.3, ndHash21(vec2(floor(u.time.mul(13.0)), seed))).mul(0.6).add(0.4), buzzing);
        const tear = step(ndHash21(vec2(idx.add(floor(u.time.mul(19.0))), seed.add(7.0))), float(1.0).sub(u.glitch.mul(0.75)));
        const hum = sin(u.time.mul(37.0).add(seed)).mul(0.03).add(0.97);
        const live = charOn.mul(buzz).mul(tear).mul(hum).mul(u.neon);

        const tint = mix(col.rgb, vec3(1.0, 0.72, 0.26), u.heat.mul(0.7));
        const white = mix(tint, vec3(1.0), 0.72);

        // ── Tubes on a dark panel (style 0) ──
        const core = float(1.0).sub(smoothstep(float(0.03).sub(aa), float(0.03).add(aa), d));
        const halo = exp(d.mul(-17.0)).mul(0.62).add(exp(d.mul(-6.0)).mul(0.05));
        // A thin tube frame round the panel.
        const metres = vec2(st.x.mul(dim.x), st.y.mul(dim.y));
        const inset = min(min(metres.x, dim.x.sub(metres.x)), min(metres.y, dim.y.sub(metres.y)));
        const framed = step(0.45, ndHash21(vec2(seed, 11.0)));
        const fd = abs(inset.sub(0.085));
        const frame = float(1.0).sub(smoothstep(0.012, 0.012 + 0.02, fd)).mul(framed);
        const frameGlow = exp(fd.mul(-22.0)).mul(0.3).mul(framed);
        const tubes = white.mul(core.mul(3.4)).add(tint.mul(halo.mul(1.5)))
            .mul(live)
            .add(tint.mul(frame.mul(1.9).add(frameGlow)).mul(u.neon).mul(buzz));
        const panel = vec3(0.004, 0.005, 0.008).add(tint.mul(0.004));

        // ── Lightbox (style 1): a glowing slab, dark characters ──
        const ink = float(1.0).sub(smoothstep(float(0.045).sub(aa), float(0.045).add(aa), d));
        const edge = smoothstep(0.0, 0.07, inset);
        // Lit from tubes behind the acrylic: brighter bands where they run.
        const tubesBehind = sin(st.y.mul(dim.y).mul(5.2)).mul(0.14).add(0.86);
        const slab = tint.mul(0.5).mul(tubesBehind).mul(float(1.0).sub(ink.mul(0.94))).mul(edge)
            .mul(u.neon)
            .mul(buzz)
            .mul(hum);

        const lightbox = step(0.5, style);
        const emit = mix(panel.add(tubes), slab.add(vec3(0.006).mul(float(1.0).sub(edge))), lightbox).toVar();
        // Pulses: the front makes the tubes flare, the afterglow overdrives them a moment longer.
        const body = mix(core.add(halo.mul(0.5)).add(frame), float(1.0).sub(ink), lightbox);
        emit.addAssign(pulses.light.mul(body).mul(1.9));
        emit.mulAssign(pulses.after.mul(0.4).add(1.0));
        return ndAtmosphere(u, emit, positionWorld);
    })();
    return finish('NeonDistrictSigns', geometry, material);
}

// ── Billboard screens ───────────────────────────────────────────────────────────

/**
 * @param {object} u
 * @param {object[]} screens  plan.screens
 * @param {object} atlas      TextureNode over the billboard atlas
 * @param {object} fade       uniform 0..1
 */
export function createScreens(u, screens, atlas, fade) {
    const count = screens.length;
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aRectA = new Float32Array(count * 4);
    const aRectB = new Float32Array(count * 4);
    screens.forEach((s, i) => {
        aPos.set([s.x, s.y, s.z, s.seed], i * 4);
        aDim.set([s.w, s.h, 0, 0], i * 4);
        aRectA.set(BILLBOARD_CELLS[s.cell].rect, i * 4);
        aRectB.set(BILLBOARD_CELLS[s.next].rect, i * 4);
    });
    const geometry = ndQuadGeometry(count, {
        aPos: [aPos, 4], aDim: [aDim, 4], aRectA: [aRectA, 4], aRectB: [aRectB, 4],
    });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const rectA = attribute('aRectA', 'vec4');
    const rectB = attribute('aRectB', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'NeonDistrictScreens';
    material.fog = false;
    const zc = ndWrapZ(pos.z.add(u.scroll));
    const world = vec3(
        pos.x.add(positionGeometry.x.mul(dim.x)),
        pos.y.add(positionGeometry.y.mul(dim.y)),
        zc,
    );
    material.positionNode = world;
    const pulses = vertexPulses(u, world);

    material.colorNode = Fn(() => {
        const st = uv();
        const seed = floor(pos.w.add(0.5));
        const metres = st.mul(vec2(dim.x, dim.y));
        // LED pitch: 5.5 cm. Derivatives up front.
        const led = metres.div(0.055);
        const fl = max(fwidth(led.x), fwidth(led.y));

        // Bezel.
        const inset = min(min(metres.x, dim.x.sub(metres.x)), min(metres.y, dim.y.sub(metres.y)));
        const glassMask = smoothstep(0.1, 0.14, inset);
        const img = clamp(metres.sub(0.14).div(vec2(dim.x, dim.y).sub(0.28)), 0.0, 1.0).toVar();

        // A glitch tears the picture into shifted bands.
        const bandId = floor(img.y.mul(14.0));
        const shift = ndHash21(vec2(bandId, floor(u.time.mul(23.0)).add(seed))).sub(0.5)
            .mul(u.glitch).mul(0.22);
        img.x.assign(fract(img.x.add(shift)));

        const sample = (r) => atlas.sample(vec2(mix(r.x, r.z, img.x), float(1.0).sub(mix(r.w, r.y, img.y)))).rgb;
        // Two adverts, a wipe between them every cycle.
        const cycle = fract(u.time.div(seed.mul(0.004).add(19.0)).add(seed.mul(0.137)));
        const phase = fract(cycle.mul(2.0));
        const second = step(0.5, cycle);
        const wipe = smoothstep(0.93, 0.99, phase);
        const edgeY = float(1.0).sub(wipe.mul(1.15).sub(0.075));
        const incoming = step(edgeY, img.y);
        const useB = mix(second, float(1.0).sub(second), incoming);
        const picture = mix(sample(rectA), sample(rectB), useB);
        const wipeGlow = exp(abs(img.y.sub(edgeY)).mul(-60.0)).mul(step(0.001, wipe)).mul(float(1.0).sub(step(0.999, wipe)));

        // LED dots near the camera, their true average far away.
        const dot = smoothstep(0.5, 0.28, max(abs(fract(led.x).sub(0.5)), abs(fract(led.y).sub(0.5))));
        const dots = mix(dot.mul(1.55), float(1.0), smoothstep(0.25, 0.75, fl));
        // The refresh bar rolling up the wall.
        const roll = exp(abs(fract(img.y.sub(u.time.mul(0.11)).add(seed.mul(0.1))).sub(0.5)).mul(-18.0)).mul(0.22).add(0.9);

        const peak = ndMax3(picture);
        const emit = picture.mul(peak.mul(1.5).add(0.75)).mul(dots).mul(roll)
            .add(vec3(0.7, 0.9, 1.0).mul(wipeGlow).mul(1.4))
            .mul(u.neon.mul(0.94).add(0.06))
            .mul(fade)
            .mul(glassMask)
            .toVar();
        emit.addAssign(vec3(0.012, 0.013, 0.02).mul(float(1.0).sub(glassMask)));
        emit.addAssign(pulses.light.mul(peak.add(0.2)).mul(1.3).mul(glassMask));
        emit.mulAssign(pulses.after.mul(0.3).add(1.0));
        return ndAtmosphere(u, emit, positionWorld);
    })();
    return finish('NeonDistrictScreens', geometry, material);
}
