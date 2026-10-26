import {
    clamp, cos, cross, dot, float, floor, fwidth, hash, max, mod, normalize, select, sin, sqrt, vec2, vec3, vec4,
    vertexIndex,
} from 'three/tsl';
import { FOREST_LEAF_CARD } from './odyssey-forest-geometry.js';

/**
 * LEAF CARDS, the shader half (see FOREST_LEAF_CARD in odyssey-forest-geometry.js).
 *
 * Shared by the world's forest material and the tree audition board, so the board shows the
 * crowns as the game draws them.
 */

/**
 * A card vertex's corner and its card's index. Six vertices a card, the cards first in the
 * buffer, so both come from the vertex index: no attribute is spent on them.
 */
function cardCorner() {
    const index = float(vertexIndex);
    const k = mod(index, 6);
    const u = select(k.lessThan(0.5), float(-1), select(
        k.lessThan(2.5),
        float(1),
        select(k.lessThan(3.5), float(-1), select(k.lessThan(4.5), float(1), float(-1))),
    ));
    const v = select(k.lessThan(1.5), float(-1), select(
        k.lessThan(2.5),
        float(1),
        select(k.lessThan(3.5), float(-1), float(1)),
    ));
    return { corner: vec2(u, v), card: floor(index.div(6)) };
}

/**
 * Vertex stage: turn a card to face the eye, and let its leaves shake.
 *
 * @param {object} p
 * @param {Node} p.centre  the card's centre after the instance transform, in the frame `eye` is in
 * @param {Node} p.size    the card's radius in that frame
 * @param {Node} p.eye     the eye
 * @param {Node} p.time    seconds
 * @param {Node} p.seed    the tree's own whole number (>= 0), so its cards differ from its
 *   neighbours'
 * @param {Node} p.flutter 0..1, the leaves' shake (fade it out with distance)
 * @returns {{offset: Node, right: Node, up: Node, corner: Node, spin: Node}} the corner's offset,
 *   the card's axes, its corner (u, v), and its clump: (cos, sin) of its turn and its atlas tile
 */
export function forestLeafCardVertex({
    centre, size, eye, time, seed, flutter,
}) {
    const C = FOREST_LEAF_CARD;
    const { corner, card } = cardCorner();
    const toEye = normalize(eye.sub(centre));
    const right = normalize(cross(vec3(0, 1, 0), toEye));
    const up = cross(toEye, right);
    // Whole numbers into `hash` (it takes the seed as a u32).
    const id = card.add(seed.mul(64));
    const turn = hash(id.add(11)).mul(Math.PI * 2);
    const tile = floor(hash(id.add(23)).mul(C.tiles * C.tiles));
    const phase = hash(id.add(37)).mul(Math.PI * 2);
    const shake = vec2(sin(time.mul(2.6).add(phase)), cos(time.mul(2.1).add(phase.mul(1.7))))
        .mul(C.flutter).mul(flutter);
    const offset = right.mul(corner.x.add(shake.x)).add(up.mul(corner.y.add(shake.y))).add(toEye.mul(C.push))
        .mul(size);
    const spin = vec4(cos(turn), sin(turn), mod(tile, C.tiles), floor(tile.div(C.tiles)));
    return {
        offset, right, up, corner, spin,
    };
}

/**
 * The atlas coordinate a card fragment reads: its corner turned by the card's spin, in its tile.
 * Outside the card's disc the coordinate would reach a neighbouring tile, so it is clamped, and
 * `inside` says whether the fragment is on the disc at all.
 */
export function forestLeafCardUv({ corner, spin }) {
    const C = FOREST_LEAF_CARD;
    const turned = vec2(
        corner.x.mul(spin.x).sub(corner.y.mul(spin.y)),
        corner.x.mul(spin.y).add(corner.y.mul(spin.x)),
    );
    const local = clamp(turned.mul(0.5).add(0.5), 0.002, 0.998);
    return {
        uv: vec2(spin.z, spin.w).add(local).div(C.tiles),
        inside: dot(corner, corner).lessThan(1),
    };
}

/**
 * Fragment stage: the clump drawn on its card.
 *
 * @param {object} p
 * @param {Node} p.corner  the corner, interpolated (u, v across the card)
 * @param {Node} p.right   the card's right axis
 * @param {Node} p.up      the card's up axis
 * @param {Node} p.leaf    the atlas texel (see forestLeafCardUv and odyssey-forest-leaf-atlas.js)
 * @param {Node} p.inside  whether the fragment is on the card's disc
 * @param {Node} p.crownN  the direction from the crown's centre (the card's normal attribute)
 * @param {Node} p.depth   how deep in the crown the card sits, 0 centre .. 1 rim
 * @param {Node} p.sunDir  toward the sun
 * @param {object} p.look  { crown, dome, upBias, edgeGain } the normal's blend, and the edge ramp's
 *   narrowest width in the atlas's distance units
 * @returns {{alpha: Node, normal: Node, path: Node, tone: Node, rim: Node}} coverage (0.5 at the
 *   leaves' edge), the normal, the sun's path through the crown in crown radii (0 on the sunny
 *   side .. 2), the leaf's tone and the clump's rim distance
 */
export function forestLeafCardFragment({
    corner, right, up, leaf, inside, crownN, depth, sunDir, look,
}) {
    // The leaves' edge, one pixel wide (the coverage turns it into MSAA samples). Not three's own
    // alpha test: it smooths with smoothstep(0.5, 0.5 + fwidth(a), a), whose edges meet wherever
    // the alpha is flat (bark, a leaf's middle) and leave the result undefined.
    const edge = max(fwidth(leaf.r), float(look.edgeGain));
    const alpha = select(inside, clamp(leaf.r.sub(0.5).div(edge).add(0.5), 0, 1), float(0));
    const toEye = cross(right, up);
    const dome = normalize(right.mul(corner.x).add(up.mul(corner.y))
        .add(toEye.mul(sqrt(max(float(1).sub(dot(corner, corner)), 0.05)))));
    const normal = normalize(crownN.mul(look.crown).add(dome.mul(look.dome)).add(vec3(0, look.upBias, 0)));
    // The sun's way out of the crown (a unit sphere in crown radii) from where the card sits.
    const q = crownN.mul(depth);
    const b = dot(q, sunDir);
    const path = sqrt(max(b.mul(b).sub(dot(q, q).sub(1)), 0)).sub(b);
    return {
        alpha, normal, path, tone: leaf.g, rim: leaf.b,
    };
}
