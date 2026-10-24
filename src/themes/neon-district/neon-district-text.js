/**
 * Neon District — lines of text for the shaders.
 *
 * Shop fascias, window signs and the adverts' lines spell more than an instance attribute can
 * hold, so every line lives in one row of a small R8 texture of glyph ids (neon-district-glyphs.js)
 * and a shader reads character i of row r. A space, or any character the alphabet lacks, is
 * GLYPH_BLANK and draws nothing.
 */

import * as THREE from 'three/webgpu';
import {
    clamp, float, floor, mod, step, texture, vec2,
    abs, dFdx, dFdy, fract, mix,
} from 'three/tsl';
import {
    GLYPH_BLANK, GLYPH_GRID, GLYPH_RANGE, glyphFor,
} from './neon-district-glyphs.js';

/** One line as glyph ids, padded with blanks to `width`. */
export function encodeLine(line, width) {
    const ids = new Uint8Array(width).fill(GLYPH_BLANK);
    const text = String(line).toUpperCase();
    for (let i = 0; i < width && i < text.length; i++) ids[i] = glyphFor(text[i]);
    return ids;
}

/**
 * The text texture: one row per line, `width` characters each.
 * @param {string[]} lines
 * @param {number} width
 */
export function createTextTexture(lines, width) {
    const rows = Math.max(1, lines.length);
    const data = new Uint8Array(width * rows).fill(GLYPH_BLANK);
    lines.forEach((line, r) => data.set(encodeLine(line, width), r * width));
    const tex = new THREE.DataTexture(data, width, rows, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'neon-district-text';
    tex.needsUpdate = true;
    return tex;
}

/**
 * Distance (in character cells) from a point in character `index` of line `row` to its strokes.
 * `cell` is the point inside the character's cell (0..1, y up); a blank answers GLYPH_RANGE.
 * Both lookups take screen derivatives (the glyph's through ndGlyphFootprint): call it in uniform
 * control flow, so they hold. `rows` and `width` are the texture's size in lines and characters.
 */
export function ndTextDistance(textTex, glyphTex, rows, width, row, index, cell) {
    const tuv = vec2(index.add(0.5).div(width), row.add(0.5).div(rows));
    const id = floor(texture(textTex, tuv).r.mul(255.0).add(0.5));
    const blank = step(GLYPH_BLANK - 0.5, id);
    const g = id.mul(float(1.0).sub(blank));
    const gc = vec2(mod(g, GLYPH_GRID), floor(g.div(GLYPH_GRID)));
    const auv = gc.add(clamp(cell, 0.015, 0.985)).div(GLYPH_GRID);
    const foot = ndGlyphFootprint(cell);
    const d = float(1.0).sub(texture(glyphTex, auv).grad(foot.gx, foot.gy).r).mul(GLYPH_RANGE);
    return d.add(blank.mul(GLYPH_RANGE));
}

/**
 * The footprint of a glyph read from the atlas, `texture(glyphTex, auv).grad(gx, gy)`, taken from
 * `cell`, the point in its character cell. Between two characters the atlas coordinate leaps to
 * another glyph, and a plain read takes that pixel from the atlas's smallest mip: a faint line of
 * its mean between the letters, which a sign's glow and fwidth then widen. `cell` wraps there too,
 * so of it and the same point wrapped at the cell's middle, the slower rate is the true one.
 * Fragment stage, uniform control flow.
 */
export function ndGlyphFootprint(cell) {
    const mid = fract(cell.add(0.5));
    const slower = (a, b) => mix(b, a, step(abs(a), abs(b)));
    return {
        gx: slower(dFdx(cell), dFdx(mid)).div(GLYPH_GRID),
        gy: slower(dFdy(cell), dFdy(mid)).div(GLYPH_GRID),
    };
}
