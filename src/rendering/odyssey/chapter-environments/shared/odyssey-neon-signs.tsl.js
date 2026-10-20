/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter 8's neon signs and their halos (2026-10-20 overhaul).
 *
 * Adapted from Neon District (src/themes/neon-district/neon-district-signs.js createSigns, and
 * neon-district-lights.js createHalos), re-scaled from a street you walk to a canyon you fly:
 *
 *   - TUBE signs: characters bent from the sign-maker's alphabet (a baked distance-field atlas,
 *     odyssey-neon-glyphs.js), a hot core and a coloured halo on a dark panel, a tube frame
 *     round some, a dying character or a buzzing sign here and there;
 *   - LIGHT BOXES on the low roofs the eye flies over (a glowing slab, dark characters);
 *   - FASCIAS: lit strips over the shopfronts down both walls of the boulevard.
 *
 * THE SPIRE POWERS THE CITY: the arrival city is half lit (most signs on, dimmer; a third dark);
 * as the ignition ring passes a sign it spells on letter by letter and the whole city comes up
 * to full (neonIgnition, odyssey-neon-light.tsl.js).
 *
 * Emitters are authored for the Odyssey grade (ACES + a 0.85 bloom threshold), not Neon
 * District's: a core of ~1.35 linear, halos under 1, so tubes bloom without washing to white.
 * One instanced draw for every sign (interleaved instance data: WebGPU binds at most 8 vertex
 * buffers), one for every halo. Both meshes live in the corridor group: local = corridor space.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    clamp,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    log2,
    materialOpacity,
    max,
    min,
    mix,
    mod,
    modelViewMatrix,
    normalize,
    positionGeometry,
    screenSize,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { hash21 } from './odyssey-tsl-noise.js';
import {
    NEON_GLYPH_BLANK,
    NEON_GLYPH_CELL,
    NEON_GLYPH_GRID,
    NEON_GLYPH_LATIN,
    NEON_GLYPH_RANGE,
    NEON_GLYPH_SCRIPT,
    bakeNeonGlyphAtlas,
    neonGlyphFor,
} from './odyssey-neon-glyphs.js';
import { SIGN_KIND, mulberry32 } from './odyssey-neon-city-plan.js';
import { NEON_SPIRE_XZ, neonAir, neonIgnition } from './odyssey-neon-light.tsl.js';

/** Characters a sign can spell (two vec4s of glyph ids). */
export const NEON_SIGN_MAX_GLYPHS = 8;

/** The alphabet as a texture (mipmapped; sampled at a level chosen from the text's footprint). */
export function createNeonGlyphTexture() {
    const { data, size } = bakeNeonGlyphAtlas();
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'odyssey-neon-glyphs';
    tex.needsUpdate = true;
    return tex;
}

/** A unit quad (xy in -0.5..0.5, uv 0..1) for `count` instances, all instance data in ONE buffer. */
function quadGeometry(count, attributes) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const names = Object.keys(attributes);
    const stride = names.reduce((sum, name) => sum + attributes[name][1], 0);
    const packed = new Float32Array(count * stride);
    const buffer = new THREE.InstancedInterleavedBuffer(packed, stride, 1);
    let offset = 0;
    names.forEach((name) => {
        const [data, itemSize] = attributes[name];
        for (let r = 0; r < count; r += 1) {
            for (let k = 0; k < itemSize; k += 1) packed[r * stride + offset + k] = data[r * itemSize + k];
        }
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, itemSize, offset));
        offset += itemSize;
    });
    geometry.instanceCount = count;
    return geometry;
}

/** A sign's glyph ids: its word, or a run of the district's own script. */
function signGlyphs(sign, rand) {
    if (sign.text) return Array.from(sign.text, neonGlyphFor);
    const n = Math.max(1, Math.min(NEON_SIGN_MAX_GLYPHS, sign.chars || 4));
    return Array.from({ length: n }, () => NEON_GLYPH_LATIN + Math.floor(rand() * NEON_GLYPH_SCRIPT));
}

/**
 * @param {object} N neon uniforms
 * @param {object[]} signs planNeonSigns().signs
 * @param {THREE.Texture} glyphTex
 * @returns {THREE.Mesh}
 */
export function createNeonSigns(N, signs, glyphTex) {
    const count = Math.max(1, signs.length);
    const rand = mulberry32(0x6a17e);
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aCol = new Float32Array(count * 4);
    const aGlyphA = new Float32Array(count * 4).fill(NEON_GLYPH_BLANK);
    const aGlyphB = new Float32Array(count * 4).fill(NEON_GLYPH_BLANK);
    const aOrient = new Float32Array(count * 4);
    signs.forEach((s, i) => {
        const glyphs = signGlyphs(s, rand).slice(0, NEON_SIGN_MAX_GLYPHS);
        const n = Math.max(1, glyphs.length);
        aPos.set([s.x, s.y, s.z, s.seed], i * 4);
        aDim.set([s.w, s.h, s.vertical ? n : -n, s.kind], i * 4);
        aCol.set([s.rgb[0], s.rgb[1], s.rgb[2], s.flicker], i * 4);
        glyphs.forEach((id, k) => {
            if (k < 4) aGlyphA[i * 4 + k] = id;
            else aGlyphB[i * 4 + k - 4] = id;
        });
        aOrient.set([s.facing ?? 0, s.side ?? 1, s.roof ? 1 : 0, s.ad ?? 0], i * 4);
    });
    const geometry = quadGeometry(count, {
        aPos: [aPos, 4],
        aDim: [aDim, 4],
        aCol: [aCol, 4],
        aGlyphA: [aGlyphA, 4],
        aGlyphB: [aGlyphB, 4],
        aOrient: [aOrient, 4],
    });
    geometry.instanceCount = signs.length;
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const col = attribute('aCol', 'vec4');
    const gA = attribute('aGlyphA', 'vec4');
    const gB = attribute('aGlyphB', 'vec4');
    const orient = attribute('aOrient', 'vec4');

    // Facing 0: the plane faces +z (down the boulevard, toward the eye). Facing 1: flush on a
    // wall, facing the lane (normal -side·x), text running left to right as seen from the lane.
    const px = positionGeometry.x;
    const py = positionGeometry.y;
    const onFront = vec3(pos.x.add(px.mul(dim.x)), pos.y.add(py.mul(dim.y)), pos.z);
    const onWall = vec3(pos.x, pos.y.add(py.mul(dim.y)), pos.z.add(px.mul(dim.x).mul(orient.y)));
    const corner = mix(onFront, onWall, orient.x);

    // Per-instance values the fragment needs, flat (a hash of an interpolated seed sparkles).
    const vPos = varying(pos, 'vSignPos').setInterpolation('flat');
    const vDim = varying(dim, 'vSignDim').setInterpolation('flat');
    const vCol = varying(col, 'vSignCol').setInterpolation('flat');
    const vGA = varying(gA, 'vSignGA').setInterpolation('flat');
    const vGB = varying(gB, 'vSignGB').setInterpolation('flat');
    const vCorner = varying(corner, 'vSignCorner');
    const vOrient = varying(orient, 'vSignOrient').setInterpolation('flat');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'odyssey-neon-signs';
    material.fog = false;
    material.positionNode = corner;

    material.colorNode = Fn(() => {
        const uvQuad = uv();
        const kind = vDim.w;
        const isScreen = step(2.5, kind).toVar();
        // A screen's word runs along a band across its foot; every other sign's text fills it.
        const textBand = 0.24;
        const st = vec2(uvQuad.x, mix(uvQuad.y, clamp(uvQuad.y.div(textBand), 0.0, 1.0), isScreen)).toVar();
        const seed = floor(vPos.w.add(0.5)).toVar();
        const n = abs(vDim.z).toVar();
        const vertical = step(0.0, vDim.z).toVar();
        const tint = vCol.rgb.toVar();

        // ── Which character, and where in its cell ──
        const along = mix(st.x, float(1.0).sub(st.y), vertical);
        const run = clamp(along.sub(0.04).div(0.92), 0.0, 0.9999).mul(n).toVar();
        const idx = floor(run).toVar();
        const cu = fract(run);
        const guv = vec2(mix(cu, st.x, vertical), mix(st.y, float(1.0).sub(cu), vertical));
        // The text's footprint in cells per pixel, from continuous coordinates (fwidth first:
        // uniform control flow; the atlas uv jumps at every cell boundary).
        const footprint = max(fwidth(run), fwidth(mix(st.y, st.x, vertical))).toVar();
        let id = float(0.0);
        for (let k = 0; k < NEON_SIGN_MAX_GLYPHS; k += 1) {
            const comp = (k < 4 ? vGA : vGB)['xyzw'[k % 4]];
            id = id.add(comp.mul(step(k - 0.5, idx)).mul(step(idx, k + 0.5)));
        }
        const glyph = floor(id.add(0.5)).toVar();
        const blank = step(NEON_GLYPH_BLANK - 0.5, glyph);
        const gc = vec2(mod(glyph, NEON_GLYPH_GRID), floor(glyph.div(NEON_GLYPH_GRID)));
        const auv = gc.add(clamp(guv, 0.02, 0.98)).div(NEON_GLYPH_GRID);
        const lvl = clamp(log2(footprint.mul(NEON_GLYPH_CELL).max(1e-4)), 0.0, 4.0);
        const tex = texture(glyphTex, auv).level(lvl).r;
        const d = mix(float(1.0).sub(tex).mul(NEON_GLYPH_RANGE), float(NEON_GLYPH_RANGE), blank).toVar();
        const aa = footprint.mul(0.75).add(0.004);

        // ── Ignition: the spire switches the city on ──
        const pcSign = vPos.xyz;
        const ign = neonIgnition(N, pcSign);
        const dSpire = length(vec2(pcSign.x.sub(NEON_SPIRE_XZ[0]), pcSign.z.sub(NEON_SPIRE_XZ[1])));
        const passed = clamp(N.uIgniteRadius.sub(dSpire).div(45.0), 0.0, 1.0);
        const onArrival = step(hash21(vec2(seed, 5.0)), 0.8);
        const spellOn = step(idx.add(0.5).div(n), passed);
        const lit = max(onArrival, spellOn);

        // ── Life: a steady hum, the odd buzzing sign, the odd dying character ──
        const gh = hash21(vec2(idx.add(seed.mul(0.37)), seed));
        const dying = step(0.95, gh);
        const tick = hash21(vec2(floor(N.uTime.mul(gh.mul(9.0).add(6.0))), seed.add(idx)));
        const charOn = mix(float(1.0), step(0.4, tick), dying);
        const buzzing = step(0.88, vCol.w);
        const buzzTick = step(0.3, hash21(vec2(floor(N.uTime.mul(13.0)), seed)));
        const buzz = mix(float(1.0), buzzTick.mul(0.6).add(0.4), buzzing);
        const hum = sin(N.uTime.mul(37.0).add(seed)).mul(0.03).add(0.97);
        const level = ign.level.mul(0.75).add(0.25).add(ign.front.mul(0.7));
        const live = charOn.mul(buzz).mul(hum).mul(lit).mul(level)
            .toVar();
        const white = mix(tint, vec3(1.0), 0.62);

        // ── Tubes on a dark panel (kind 0) ──
        const core = float(1.0).sub(smoothstep(float(0.034).sub(aa), float(0.034).add(aa), d));
        const halo = exp(d.mul(-16.0)).mul(0.62).add(exp(d.mul(-6.0)).mul(0.06));
        const metres = vec2(st.x.mul(vDim.x), st.y.mul(vDim.y));
        const inset = min(min(metres.x, vDim.x.sub(metres.x)), min(metres.y, vDim.y.sub(metres.y)));
        const framed = step(0.45, hash21(vec2(seed, 11.0)));
        const fd = abs(inset.sub(0.24));
        const fAA = fwidth(inset).add(0.01);
        const frame = float(1.0).sub(smoothstep(float(0.05).sub(fAA), float(0.05).add(fAA), fd)).mul(framed);
        const around = metres.x.add(metres.y);
        const chase = exp(abs(fract(around.div(9.0).sub(N.uTime.mul(0.3)).add(seed.mul(0.1))).sub(0.5)).mul(-10.0))
            .mul(step(0.6, hash21(vec2(seed, 12.0)))).mul(1.1)
            .add(1.0);
        // An unlit tube is still glass: a faint line of its colour, never a blank slab.
        const dead = tint.mul(core.mul(0.06).add(halo.mul(0.02)));
        const tubes = white.mul(core.mul(1.35)).add(tint.mul(halo.mul(0.8))).mul(live).add(dead)
            .add(tint.mul(frame.mul(chase).mul(0.95)).mul(level).mul(buzz));
        const panel = vec3(0.006, 0.006, 0.011).add(tint.mul(0.012));

        // ── Light box (kind 1) / fascia (kind 2): a glowing slab, dark characters ──
        const ink = float(1.0).sub(smoothstep(float(0.05).sub(aa), float(0.05).add(aa), d));
        const edge = smoothstep(0.0, 0.25, inset);
        const behind = sin(st.y.mul(vDim.y).mul(1.6)).mul(0.12).add(0.88);
        const slab = tint.mul(mix(float(0.55), float(0.75), step(1.5, kind))).mul(behind)
            .mul(float(1.0).sub(ink.mul(0.92))).mul(edge)
            .mul(live);
        const isBox = step(0.5, kind).mul(float(1.0).sub(isScreen));
        const detail = mix(panel.add(tubes), slab.add(vec3(0.004).mul(float(1.0).sub(edge))), isBox).toVar();

        // ── Giant LED screen (kind 3): an advert in light, its word in tubes along its foot ──
        const sq = uvQuad.sub(vec2(0.5, 0.6)).mul(vec2(vDim.x.div(vDim.y), 1.0));
        const ad = vOrient.w;
        const t = N.uTime.add(seed.mul(0.37));
        // Hale: a breathing ring over a deep teal field.
        const breath = sin(t.mul(0.62)).mul(0.5).add(0.5);
        const ringR = breath.mul(0.09).add(0.2);
        const ringD = length(sq).sub(ringR).abs();
        const hale = vec3(0.0, 0.05, 0.07).add(vec3(0.2, 0.95, 1.0).mul(exp(ringD.mul(ringD).mul(-2200.0))).mul(0.9))
            .add(vec3(0.05, 0.4, 0.5).mul(exp(length(sq).mul(length(sq)).mul(-30.0))).mul(breath.mul(0.3).add(0.15)));
        // Combo: neon blocks falling down a dark violet well.
        const cell = vec2(floor(uvQuad.x.mul(6.0)), floor(uvQuad.y.mul(9.0).add(t.mul(1.2))));
        const blockOn = step(0.62, hash21(cell.add(vec2(seed, 3.0)))).mul(step(textBand + 0.04, uvQuad.y));
        const bf = fract(vec2(uvQuad.x.mul(6.0), uvQuad.y.mul(9.0).add(t.mul(1.2))));
        const bevel = smoothstep(0.0, 0.12, min(min(bf.x, float(1.0).sub(bf.x)), min(bf.y, float(1.0).sub(bf.y))));
        const blockHue = mix(vec3(1.0, 0.16, 0.5), vec3(0.15, 0.85, 1.0), step(0.5, hash21(cell.add(7.0))));
        const combo = vec3(0.03, 0.01, 0.06).add(blockHue.mul(blockOn).mul(bevel.mul(0.55).add(0.25)));
        // Serenity Transit: a sun on a banded horizon, the journey's own sunset.
        const sunD = length(sq.sub(vec2(0.0, 0.02)));
        const bands = step(0.5, fract(uvQuad.y.mul(18.0))).mul(smoothstep(0.62, 0.45, uvQuad.y)).mul(0.6).add(0.4);
        const sunDisc = smoothstep(0.21, 0.2, sunD).mul(mix(float(1.0), bands, smoothstep(0.62, 0.52, uvQuad.y)));
        const skyT = mix(vec3(0.5, 0.06, 0.25), vec3(0.06, 0.02, 0.12), uvQuad.y);
        const sunTint = mix(vec3(1.0, 0.2, 0.3), vec3(1.0, 0.75, 0.25), uvQuad.y);
        const transit = skyT.mul(0.6).add(sunTint.mul(sunDisc).mul(0.85));
        const picture = mix(mix(hale, combo, step(0.5, ad)), transit, step(1.5, ad));
        // LED pixels up close, a refresh bar rolling down, the word in tubes along the foot.
        const pitch = vec2(uvQuad.x.mul(vDim.x), uvQuad.y.mul(vDim.y)).div(0.4);
        const ledFw = fwidth(pitch.x).add(fwidth(pitch.y));
        const ledNear = smoothstep(0.5, 0.2, length(fract(pitch).sub(0.5))).mul(0.8).add(0.35);
        const ledDot = mix(ledNear, float(0.75), smoothstep(0.3, 0.9, ledFw));
        const barX = uvQuad.y.sub(fract(t.mul(-0.12))).mul(30.0);
        const bar = exp(barX.mul(barX).negate()).mul(0.18);
        const inPicture = step(textBand, uvQuad.y);
        const toEdge = min(min(uvQuad.x, float(1.0).sub(uvQuad.x)), min(uvQuad.y, float(1.0).sub(uvQuad.y)));
        const screenFrame = smoothstep(0.0, 0.03, toEdge);
        const screenLight = picture.mul(inPicture).mul(ledDot).add(bar)
            .add(white.mul(core).mul(1.2).add(tint.mul(halo).mul(0.5)).mul(float(1.0).sub(inPicture)))
            .mul(screenFrame)
            .mul(level)
            .mul(buzz);
        detail.assign(mix(detail, screenLight, isScreen));

        // Text smaller than a pixel: the sign's average light.
        const average = mix(tint.mul(0.3).add(white.mul(0.06)), tint.mul(0.5), isBox).mul(live);
        const emit = mix(detail, average, smoothstep(0.14, 0.5, footprint).mul(float(1.0).sub(isScreen)));

        const air = neonAir(N, vCorner);
        // Emitters punch a little further through the mist than surfaces do.
        return mix(emit, air.colour, air.amount).add(emit.mul(air.amount).mul(float(1.0).sub(air.amount)).mul(0.3));
    })();

    // The 7->8 carry: the signs arrive through the tunnel's mouth (opacity times the
    // manager's crossfade weight, which reaches the material as `opacity`).
    material.opacityNode = materialOpacity.mul(N.seamReveal);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-city-signs';
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * A soft glow in the wet air round every sign (Neon District's createHalos): camera-facing,
 * sized in corridor units, stronger where there is more mist between the eye and the sign.
 * @param {object} N neon uniforms
 * @param {object[]} signs
 * @returns {THREE.Mesh}
 */
export function createNeonSignHalos(N, signs) {
    const count = Math.max(1, signs.length);
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    signs.forEach((s, i) => {
        // Out of the wall a little, so a flush sign's halo is not cut in half by its wall.
        const out = (s.facing ?? 0) === 1 ? -(s.side ?? 1) * 2.5 : 0;
        const k = s.kind === SIGN_KIND.tube ? 1.0 : 0.8;
        aPos.set([s.x + out, s.y, s.z + ((s.facing ?? 0) === 0 ? 1.5 : 0), k], i * 4);
        const w = (s.facing ?? 0) === 1 ? Math.max(s.w * 0.5, s.h) : s.w;
        aDim.set([w * 1.6 + 6, s.h * 1.5 + 6, 0, 0], i * 4);
    });
    const aTint = new Float32Array(count * 4);
    signs.forEach((s, i) => aTint.set([s.rgb[0], s.rgb[1], s.rgb[2], s.seed], i * 4));
    const geometry = quadGeometry(count, { aPos: [aPos, 4], aDim: [aDim, 4], aTint: [aTint, 4] });
    geometry.instanceCount = signs.length;
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const tint = attribute('aTint', 'vec4');

    // Pull the sprite toward the eye so walls behind it do not clip it.
    const toEye = normalize(N.camCity.sub(pos.xyz));
    const centre = pos.xyz.add(toEye.mul(3.0));
    const clip = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(centre, 1.0));
    const half = screenSize.mul(0.5);
    const pxPerUnit = N.projY.mul(half.y).div(max(clip.w, 0.5));
    const sizePx = vec2(dim.x, dim.y).mul(pxPerUnit);
    const vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(sizePx).div(half).mul(clip.w)), clip.z, clip.w);

    const air = neonAir(N, pos.xyz);
    const ign = neonIgnition(N, pos.xyz);
    // Thin air near the eye shows little glow; the mist down the canyon shows a lot.
    const strength = air.amount.mul(0.55).add(0.05)
        .mul(float(1.0).sub(smoothstep(0.82, 1.0, air.amount)))
        .mul(pos.w)
        .mul(ign.level.mul(0.8).add(0.2).add(ign.front.mul(0.5)));
    const vLight = varying(tint.rgb.mul(strength), 'vNeonHalo');

    const uOpacity = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'odyssey-neon-halos';
    material.fog = false;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.forceSinglePass = true;
    material.vertexNode = vertexNode;
    material.colorNode = Fn(() => {
        const d = uv().sub(0.5).mul(2.0);
        const r2 = d.dot(d);
        const g = exp(r2.mul(-3.6)).sub(0.027).max(0.0);
        return vec4(vLight.mul(g).mul(uOpacity).mul(N.seamReveal), 0.0);
    })();
    material.uniforms = { uOpacity };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-city-sign-halos';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return mesh;
}
