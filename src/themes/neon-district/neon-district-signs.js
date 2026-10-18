/**
 * Neon District — everything that advertises.
 *
 *  - Tube signs: blades hung over the pavement, bent from the sign-maker's alphabet (a baked
 *    distance-field atlas: trade words in Latin capitals, the rest in the district's own script).
 *    Each has a hot white core and a coloured halo; a few buzz, a few have a dying character.
 *  - Billboard screens: LED walls facing down the street, each cycling a playlist of the district's
 *    campaigns (neon-district-campaigns.js) with a rolling refresh bar.
 *  - Tube logos: each campaign's mark bent in tube, animated frame by frame, over its name.
 *
 * All of them answer the gameplay pulses: a lock shell tints them as it passes, a clear wave makes
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
    length,
    max,
    min,
    mix,
    mod,
    positionGeometry,
    positionWorld,
    select,
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
    ndAtmosphere,
    ndClearLight,
    ndHash21,
    ndLockLight,
    ndMax3,
    ndQuadGeometry,
    ndWrapZ,
} from './neon-district-tsl.js';
import { BILLBOARD_CELLS } from './neon-district-atlas.js';
import {
    GLYPH_GRID, GLYPH_RANGE, bakeGlyphAtlas,
} from './neon-district-glyphs.js';
import { MAX_SIGN_GLYPHS, TEXT_WIDTH } from './neon-district-layout.js';
import { ndTextDistance } from './neon-district-text.js';
import {
    LOGOS, LOGO_ANIMS, LOGO_GRID, LOGO_RANGE, bakeLogoAtlas,
} from './neon-district-logos.js';

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

/** The tube logos (neon-district-logos.js): four distance fields, the tube and three frames. */
export function createLogoTexture() {
    const { data, size } = bakeLogoAtlas();
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'neon-district-logos';
    tex.needsUpdate = true;
    return tex;
}

/** What a shader needs to draw the logos: the texture, its grid and range, each mark's animation. */
export function logoBinding(tex) {
    return {
        texture: tex,
        grid: LOGO_GRID,
        range: LOGO_RANGE,
        anim: LOGOS.map((logo) => Math.max(0, LOGO_ANIMS.indexOf(logo.anim))),
        period: LOGOS.map((logo) => logo.period),
    };
}

/** How a tube logo's animation frames (its G, B and A channels) are lit. */
export const LOGO_ANIM = Object.freeze({
    none: 0, blink: 1, alt: 2, cycle: 3, build: 4, breath: 5,
});

/**
 * Which of a logo's three animation frames are lit now (each 0..1). `anim` is a LOGO_ANIM code,
 * `period` seconds per cycle, `breath` the lungs' fill (0..1) the breath logos follow.
 */
export function ndLogoFrames(anim, period, time, seed, breath) {
    const phase = fract(time.div(max(period, 0.1)).add(seed.mul(0.137)));
    const k3 = floor(phase.mul(3.0));
    const k4 = floor(phase.mul(4.0));
    const is = (code) => step(abs(anim.sub(code)), 0.5);
    const blink = is(LOGO_ANIM.blink).mul(step(0.5, phase));
    const altA = step(phase, 0.5);
    const g = blink
        .add(is(LOGO_ANIM.alt).mul(altA))
        .add(is(LOGO_ANIM.cycle).mul(step(k3, 0.5)))
        .add(is(LOGO_ANIM.build).mul(step(k4, 2.5)))
        .add(is(LOGO_ANIM.breath).mul(smoothstep(0.04, 0.3, breath)));
    const b = is(LOGO_ANIM.alt).mul(float(1.0).sub(altA))
        .add(is(LOGO_ANIM.cycle).mul(step(abs(k3.sub(1.0)), 0.5)))
        .add(is(LOGO_ANIM.build).mul(step(0.5, k4).mul(step(k4, 2.5))))
        .add(is(LOGO_ANIM.breath).mul(smoothstep(0.36, 0.62, breath)));
    const a = is(LOGO_ANIM.cycle).mul(step(1.5, k3))
        .add(is(LOGO_ANIM.build).mul(step(abs(k4.sub(2.0)), 0.5)))
        .add(is(LOGO_ANIM.breath).mul(smoothstep(0.66, 0.92, breath)));
    return vec3(g, b, a);
}

/**
 * A sign that switches itself back on letter by letter now and then — one sign in three, every
 * 25 to 55 s: its characters light one after another (0.18 s apart), then the whole sign flashes
 * twice and stays on. Returns 1 for a lit character, 0 for one the run has not reached yet.
 * `idx` is the character, `n` the sign's length.
 */
export function ndSpellOut(time, seed, idx, n) {
    const on = step(0.64, ndHash21(vec2(seed, 21.0)));
    const period = ndHash21(vec2(seed, 22.0)).mul(30.0).add(25.0);
    const secs = fract(time.div(period).add(ndHash21(vec2(seed, 23.0)))).mul(period);
    const writing = step(secs, n.mul(0.18));
    const letter = step(idx.add(0.5), secs.div(0.18));
    const after = secs.sub(n.mul(0.18));
    const flashing = step(0.0, after).mul(step(after, 0.6));
    const flash = step(0.5, fract(after.mul(3.3)));
    const v = mix(mix(float(1.0), letter, writing), flash, flashing);
    return mix(float(1.0), v, on);
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
        const spell = ndSpellOut(u.time, seed, idx, n);
        const live = charOn.mul(buzz).mul(tear).mul(hum).mul(u.neon)
            .mul(spell);

        // One sign in seven is two-tone: it swaps to a second colour and back every few seconds.
        const twoTone = step(0.86, ndHash21(vec2(seed, 31.0)));
        const swap = smoothstep(0.42, 0.58, abs(fract(u.time.div(ndHash21(vec2(seed, 32.0)).mul(2.0).add(1.8)).add(seed.mul(0.1))).mul(2.0).sub(1.0)));
        const base = mix(col.rgb, vec3(col.z, col.x, col.y), swap.mul(twoTone));
        const tint = mix(base, vec3(1.0, 0.72, 0.26), u.heat.mul(0.7));
        const white = mix(tint, vec3(1.0), 0.72);

        // ── Tubes on a dark panel (style 0) ──
        const core = float(1.0).sub(smoothstep(float(0.03).sub(aa), float(0.03).add(aa), d));
        const halo = exp(d.mul(-17.0)).mul(0.62).add(exp(d.mul(-6.0)).mul(0.05));
        // A thin tube frame round the panel.
        const metres = vec2(st.x.mul(dim.x), st.y.mul(dim.y));
        const inset = min(min(metres.x, dim.x.sub(metres.x)), min(metres.y, dim.y.sub(metres.y)));
        const framed = step(0.45, ndHash21(vec2(seed, 11.0)));
        const fd = abs(inset.sub(0.085));
        // A brighter run of light chases round some frames.
        const around = metres.x.add(metres.y);
        const chase = exp(abs(fract(around.div(2.4).sub(u.time.mul(0.45)).add(seed.mul(0.1))).sub(0.5)).mul(-10.0))
            .mul(step(0.6, ndHash21(vec2(seed, 12.0)))).mul(1.2).add(1.0);
        const frame = float(1.0).sub(smoothstep(0.012, 0.012 + 0.02, fd)).mul(framed).mul(chase);
        const frameGlow = exp(fd.mul(-22.0)).mul(0.3).mul(framed).mul(chase);
        const tubes = white.mul(core.mul(3.4)).add(tint.mul(halo.mul(1.5)))
            .mul(live)
            .add(tint.mul(frame.mul(1.9).add(frameGlow)).mul(u.neon).mul(buzz));
        const panel = vec3(0.004, 0.005, 0.008).add(tint.mul(0.004));

        // ── Lightbox (style 1): a glowing slab, dark characters ──
        const ink = float(1.0).sub(smoothstep(float(0.045).sub(aa), float(0.045).add(aa), d));
        const edge = smoothstep(0.0, 0.07, inset);
        // Lit from tubes behind the acrylic: brighter bands where they run.
        const tubesBehind = sin(st.y.mul(dim.y).mul(5.2)).mul(0.14).add(0.86);
        const boxOn = ndSpellOut(u.time, seed, float(0.0), float(1.0));
        const slab = tint.mul(0.5).mul(tubesBehind).mul(float(1.0).sub(ink.mul(0.94))).mul(edge)
            .mul(u.neon)
            .mul(buzz)
            .mul(hum)
            .mul(boxOn);
        // Marquee bulbs round most lit boxes, the lit ones running.
        const bulbAt = around.div(0.16);
        const bulbD = length(vec2(fract(bulbAt).sub(0.5).mul(0.16), abs(inset.sub(0.05))));
        const bulb = smoothstep(0.034, 0.016, bulbD).mul(step(0.4, ndHash21(vec2(seed, 13.0))));
        const lit = step(0.5, fract(floor(bulbAt).div(3.0).sub(u.time.mul(2.4))));
        const bulbs = vec3(1.0, 0.86, 0.6).mul(bulb).mul(lit.mul(2.6).add(0.12)).mul(u.neon);

        const lightbox = step(0.5, style);
        const emit = mix(panel.add(tubes), slab.add(vec3(0.006).mul(float(1.0).sub(edge))).add(bulbs), lightbox).toVar();
        // Pulses: the front makes the tubes flare, the afterglow overdrives them a moment longer.
        const body = mix(core.add(halo.mul(0.5)).add(frame), float(1.0).sub(ink), lightbox);
        emit.addAssign(pulses.light.mul(body).mul(1.9));
        emit.mulAssign(pulses.after.mul(0.4).add(1.0));
        return ndAtmosphere(u, emit, positionWorld);
    })();
    return finish('NeonDistrictSigns', geometry, material);
}

// ── Billboard screens ───────────────────────────────────────────────────────────

/** How an advert moves on a screen: still, Hale's breathing ring, or a travel poster's slow drift. */
export const AD_MOTION = Object.freeze({ none: 0, breathe: 1, pan: 2 });

const adMotion = (cell) => AD_MOTION[cell.motion] ?? AD_MOTION.none;

/**
 * LED walls facing down the street. Each cycles a playlist of three adverts of one shape, each
 * on for its period, with a wipe, a block dissolve or a slide into the next; a Hale advert's ring
 * breathes with the breath, a travel poster drifts as it shows.
 * @param {object} u
 * @param {object[]} screens  plan.screens
 * @param {object} atlas      TextureNode over the billboard atlas
 * @param {object} fade       uniform 0..1
 */
export function createScreens(u, screens, atlas, fade, opts = {}) {
    const { glyphTex, textTex } = opts;
    const textRows = Math.max(1, opts.textRows || 1);
    const withTicker = Boolean(glyphTex && textTex);
    const count = Math.max(1, screens.length);
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aRectA = new Float32Array(count * 4);
    const aRectB = new Float32Array(count * 4);
    const aRectC = new Float32Array(count * 4);
    const aPlay = new Float32Array(count * 4);
    const aRing = new Float32Array(count * 4);
    // Ticker rows: row + length / 100 per slot (a length is at most 48), w = 1 when it has one.
    const aTicker = new Float32Array(count * 4);
    screens.forEach((s, i) => {
        if (s.ticker) aTicker.set([...s.ticker.map((k) => k.row + k.length / 100), 1], i * 4);
        const cells = s.playlist.map((c) => BILLBOARD_CELLS[c]);
        aPos.set([s.x, s.y, s.z, s.seed], i * 4);
        aDim.set([s.w, s.h, s.pitch, s.period], i * 4);
        aRectA.set(cells[0].rect, i * 4);
        aRectB.set(cells[1].rect, i * 4);
        aRectC.set(cells[2].rect, i * 4);
        const ringSlot = cells.findIndex((c) => c.ring);
        const ring = ringSlot >= 0 ? cells[ringSlot].ring : [0.5, 0.5, 0];
        aPlay.set([adMotion(cells[0]), adMotion(cells[1]), adMotion(cells[2]), ringSlot], i * 4);
        aRing.set([ring[0], ring[1], ring[2], s.transition], i * 4);
    });
    const geometry = ndQuadGeometry(screens.length, {
        aPos: [aPos, 4],
        aDim: [aDim, 4],
        aRectA: [aRectA, 4],
        aRectB: [aRectB, 4],
        aRectC: [aRectC, 4],
        aPlay: [aPlay, 4],
        aRing: [aRing, 4],
        aTicker: [aTicker, 4],
    }, { interleave: true });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const rectA = attribute('aRectA', 'vec4');
    const rectB = attribute('aRectB', 'vec4');
    const rectC = attribute('aRectC', 'vec4');
    const play = attribute('aPlay', 'vec4');
    const ring = attribute('aRing', 'vec4');
    const ticker = attribute('aTicker', 'vec4');

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
        const size = vec2(dim.x, dim.y);
        const metres = st.mul(size);
        // LED pitch per screen. Derivatives up front.
        const led = metres.div(dim.z);
        const fl = max(fwidth(led.x), fwidth(led.y));

        // Bezel.
        const inset = min(min(metres.x, dim.x.sub(metres.x)), min(metres.y, dim.y.sub(metres.y)));
        const glassMask = smoothstep(0.1, 0.14, inset);
        const imgSize = size.sub(0.28);
        const img = clamp(metres.sub(0.14).div(imgSize), 0.0, 1.0).toVar();

        // A glitch tears the picture into shifted bands.
        const bandId = floor(img.y.mul(14.0));
        const shift = ndHash21(vec2(bandId, floor(u.time.mul(23.0)).add(seed))).sub(0.5)
            .mul(u.glitch).mul(0.22);
        img.x.assign(fract(img.x.add(shift)));

        // ── The playlist: three adverts, each on for its period, then a transition ──
        const cyc = fract(u.time.div(dim.w.mul(3.0)).add(seed.mul(0.137))).mul(3.0);
        const slot = floor(cyc);
        const local = fract(cyc);
        const nextSlot = mod(slot.add(1.0), 3.0);
        const pick = (k, a, b, c) => select(k.lessThan(0.5), a, select(k.lessThan(1.5), b, c));
        const rectNow = pick(slot, rectA, rectB, rectC);
        const rectNext = pick(nextSlot, rectA, rectB, rectC);
        const motionNow = pick(slot, play.x, play.y, play.z);
        const motionNext = pick(nextSlot, play.x, play.y, play.z);
        // Every advert creeps in a little as it shows, a travel poster a little more (the words
        // are baked in: keep it small).
        const drift = (p, motion, phase) => {
            const pan = step(1.5, motion);
            const zoom = phase.mul(pan.mul(0.02).add(0.015)).add(1.0);
            return p.sub(0.5).div(zoom).add(0.5).add(vec2(phase.sub(0.5).mul(0.012).mul(pan), 0.0));
        };
        const sample = (r, p) => atlas.sample(vec2(mix(r.x, r.z, p.x), float(1.0).sub(mix(r.w, r.y, p.y)))).rgb;
        const nowPic = sample(rectNow, drift(img, motionNow, local));
        const nextPic = sample(rectNext, drift(img, motionNext, float(0.0)));
        const tr = smoothstep(0.93, 0.995, local);
        const kind = ring.w;
        const edgeY = float(1.0).sub(tr.mul(1.15).sub(0.075));
        const wipe = step(edgeY, img.y);
        const block = ndHash21(floor(img.mul(imgSize).div(0.32)).add(vec2(seed, slot)));
        const dissolve = step(block, tr);
        const slide = step(float(1.0).sub(tr), img.x);
        const changing = step(0.001, tr);
        const useNext = pick(kind, wipe, dissolve, slide).mul(changing);
        const picture = mix(nowPic, nextPic, useNext);
        const isWipe = step(kind, 0.5);
        const wipeGlow = exp(abs(img.y.sub(edgeY)).mul(-60.0)).mul(changing).mul(float(1.0).sub(step(0.999, tr)))
            .mul(isWipe);

        // ── Hale's ring, breathing on the advert that leaves room for it ──
        const showsRing = step(abs(slot.sub(play.w)), 0.5).mul(float(1.0).sub(useNext)).mul(step(0.01, ring.z));
        const pm = img.mul(imgSize);
        const centre = vec2(ring.x.mul(imgSize.x), float(1.0).sub(ring.y).mul(imgSize.y));
        const radius = ring.z.mul(imgSize.y);
        const breathR = radius.mul(u.breath.mul(0.55).add(0.38));
        const d = length(pm.sub(centre));
        const line = exp(abs(d.sub(breathR)).div(radius.mul(0.03)).negate());
        const disc = smoothstep(breathR, breathR.mul(0.15), d).mul(u.breath).mul(0.16);
        const halo = exp(max(d.sub(breathR), 0.0).div(radius.mul(0.25)).negate()).mul(0.12);
        const ringLight = vec3(0.32, 0.95, 0.84).mul(line.mul(1.4).add(disc).add(halo)).mul(showsRing);

        // LED dots near the camera, their true average far away.
        const dot = smoothstep(0.5, 0.28, max(abs(fract(led.x).sub(0.5)), abs(fract(led.y).sub(0.5))));
        const dots = mix(dot.mul(1.55), float(1.0), smoothstep(0.25, 0.75, fl));
        // The refresh bar rolling up the wall.
        const roll = exp(abs(fract(img.y.sub(u.time.mul(0.11)).add(seed.mul(0.1))).sub(0.5)).mul(-18.0)).mul(0.22).add(0.9);

        // A gloss of light sweeps across the wall now and then.
        const sweepAt = fract(u.time.div(ndHash21(vec2(seed, 41.0)).mul(5.0).add(7.0)).add(seed.mul(0.3))).mul(2.4).sub(0.6);
        const sweep = exp(abs(img.x.mul(0.8).add(img.y.mul(0.35)).sub(sweepAt)).mul(-28.0)).mul(0.22);

        // ── The ticker under the advert: its slogan scrolling in amber LEDs ──
        let tickerLight = vec3(0.0);
        let tickerBand = float(0.0);
        if (withTicker) {
            const slotLine = pick(slot, ticker.x, ticker.y, ticker.z);
            const row = floor(slotLine);
            const len = floor(fract(slotLine).mul(100.0).add(0.5));
            const bandH = min(imgSize.y.mul(0.11), 0.55);
            tickerBand = step(img.y.mul(imgSize.y), bandH).mul(ticker.w);
            const th = bandH.mul(0.7);
            const cw = th.mul(0.78);
            const along = img.x.mul(imgSize.x).add(u.time.mul(0.9)).add(seed.mul(0.7)).div(cw);
            const span = len.add(5.0);
            const at = mod(along, span);
            const idx = floor(at);
            const cellY = img.y.mul(imgSize.y).sub(bandH.sub(th).mul(0.5)).div(th);
            const inLine = step(idx, len.sub(0.5)).mul(step(0.0, cellY)).mul(step(cellY, 1.0));
            const dTick = ndTextDistance(textTex, glyphTex, textRows, TEXT_WIDTH, row, clamp(idx, 0.0, max(len.sub(1.0), 0.0)), vec2(fract(at), cellY))
                .add(float(1.0).sub(inLine));
            const ink = float(1.0).sub(smoothstep(0.03, 0.06, dTick));
            tickerLight = vec3(1.0, 0.62, 0.16).mul(ink.mul(2.2).add(exp(dTick.mul(-14.0)).mul(0.25))).mul(tickerBand);
        }

        const peak = ndMax3(picture);
        const shown = picture.mul(peak.mul(1.5).add(0.75)).add(ringLight).add(vec3(sweep));
        const emit = mix(shown, vec3(0.01, 0.008, 0.006).add(tickerLight), tickerBand).mul(dots).mul(roll)
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

// ── Tube logos ──────────────────────────────────────────────────────────────────

/**
 * A campaign's mark bent in tube, hung off the wall facing down the street: the logo, animated
 * frame by frame (its G, B and A channels), over its name in the sign alphabet, on a dark board
 * framed in the campaign's second colour.
 * @param {object} u
 * @param {object[]} marks   plan.marks
 * @param {object} opts      { glyphTex, textTex, textRows, logos } (logos: logoBinding())
 */
export function createMarks(u, marks, opts) {
    const { glyphTex, textTex, logos } = opts;
    const textRows = Math.max(1, opts.textRows || 1);
    const count = Math.max(1, marks.length);
    const aPos = new Float32Array(count * 4);
    const aDim = new Float32Array(count * 4);
    const aCol = new Float32Array(count * 4);
    const aCol2 = new Float32Array(count * 4);
    const aLogo = new Float32Array(count * 4);
    marks.forEach((m, i) => {
        aPos.set([m.x, m.y, m.z, m.seed], i * 4);
        aDim.set([m.w, m.h, m.nameRow, m.nameLength], i * 4);
        aCol.set([m.rgb[0], m.rgb[1], m.rgb[2], 0], i * 4);
        aCol2.set([m.rgb2[0], m.rgb2[1], m.rgb2[2], 0], i * 4);
        aLogo.set([m.logo, logos.anim[m.logo] ?? 0, logos.period[m.logo] ?? 1, 0], i * 4);
    });
    const geometry = ndQuadGeometry(marks.length, {
        aPos: [aPos, 4], aDim: [aDim, 4], aCol: [aCol, 4], aCol2: [aCol2, 4], aLogo: [aLogo, 4],
    }, { interleave: true });
    const pos = attribute('aPos', 'vec4');
    const dim = attribute('aDim', 'vec4');
    const col = attribute('aCol', 'vec4');
    const col2 = attribute('aCol2', 'vec4');
    const logo = attribute('aLogo', 'vec4');

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'NeonDistrictMarks';
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
        const tint = mix(col.rgb, vec3(1.0, 0.72, 0.26), u.heat.mul(0.7));
        const white = mix(tint, vec3(1.0), 0.6);
        // The logo: a square over the name strip.
        const side = dim.x.sub(0.12);
        const lc = vec2(metres.x.sub(0.06).div(side), metres.y.sub(dim.y.sub(side).sub(0.06)).div(side));
        const inLogo = step(0.0, lc.x).mul(step(lc.x, 1.0)).mul(step(0.0, lc.y)).mul(step(lc.y, 1.0));
        const li = max(logo.x, 0.0);
        const gc = vec2(mod(li, logos.grid), floor(li.div(logos.grid)));
        const lt = texture(logos.texture, gc.add(clamp(lc, 0.01, 0.99)).div(logos.grid));
        const frames = ndLogoFrames(logo.y, logo.z, u.time, seed, u.breath);
        const dr = float(1.0).sub(lt.r).mul(logos.range).add(float(1.0).sub(inLogo));
        const df = vec3(1.0).sub(lt.gba).mul(logos.range).add(float(1.0).sub(inLogo));
        const laa = fwidth(dr).mul(0.9).add(0.0015);
        const tube = (dd) => float(1.0).sub(smoothstep(float(0.011).sub(laa), float(0.011).add(laa), dd)).mul(3.2)
            .add(exp(dd.mul(-60.0)).mul(0.55))
            .add(exp(dd.mul(-16.0)).mul(0.06));
        const tubes = tube(dr).add(tube(df.x).mul(frames.x)).add(tube(df.y).mul(frames.y)).add(tube(df.z).mul(frames.z));
        // The name: the sign alphabet, centred in the strip under the logo.
        const stripH = dim.y.sub(side).sub(0.18);
        const n = max(dim.w, 1.0);
        const th = min(stripH.mul(0.78), side.div(n.mul(0.82)));
        const cw = th.mul(0.82);
        const run = metres.x.sub(dim.x.mul(0.5).sub(n.mul(cw).mul(0.5))).div(cw);
        const cellY = metres.y.sub(stripH.mul(0.5).add(0.06).sub(th.mul(0.5))).div(th);
        const inLine = step(0.0, run).mul(step(run, n)).mul(step(-0.1, cellY)).mul(step(cellY, 1.1));
        const dName = ndTextDistance(textTex, glyphTex, textRows, TEXT_WIDTH, dim.z, clamp(floor(run), 0.0, n.sub(1.0)), vec2(fract(run), cellY))
            .add(float(1.0).sub(inLine));
        const taa = fwidth(dName).mul(0.9).add(0.003);
        const core = float(1.0).sub(smoothstep(float(0.03).sub(taa), float(0.03).add(taa), dName));
        const halo = exp(dName.mul(-17.0)).mul(0.6);
        // Life: the hum, and the odd failing transformer.
        const hum = sin(u.time.mul(37.0).add(seed)).mul(0.03).add(0.97);
        const buzz = mix(float(1.0), step(0.3, ndHash21(vec2(floor(u.time.mul(13.0)), seed))).mul(0.6).add(0.4), step(0.9, ndHash21(vec2(seed, 5.0))));
        const tear = step(ndHash21(vec2(floor(u.time.mul(19.0)), seed.add(7.0))), float(1.0).sub(u.glitch.mul(0.75)));
        const live = hum.mul(buzz).mul(tear).mul(u.neon);
        // A thin tube frame round the board in the second colour.
        const inset = min(min(metres.x, dim.x.sub(metres.x)), min(metres.y, dim.y.sub(metres.y)));
        const fd = abs(inset.sub(0.05));
        const frame = float(1.0).sub(smoothstep(0.01, 0.026, fd)).mul(1.5).add(exp(fd.mul(-24.0)).mul(0.2));
        const emit = vec3(0.004, 0.005, 0.008)
            .add(mix(tint, white, 0.5).mul(tubes).mul(live))
            .add(white.mul(core.mul(3.0)).add(tint.mul(halo.mul(1.4))).mul(live))
            .add(col2.rgb.mul(frame).mul(u.neon).mul(buzz))
            .toVar();
        emit.addAssign(pulses.light.mul(tubes.add(core).mul(0.5).add(frame.mul(0.3))).mul(1.6));
        emit.mulAssign(pulses.after.mul(0.4).add(1.0));
        return ndAtmosphere(u, emit, positionWorld);
    })();
    return finish('NeonDistrictMarks', geometry, material);
}
