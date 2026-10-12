/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the plants: the palms, the ferns, the broad leaves and the vines.
 *
 * The house is a jungle under glass at night. Kentia palms stand against the side walls, their
 * crowns opening under the vault and black against the moonlit glazing; tree ferns spread their
 * lace between them; bananas and bird-of-paradise lift torn paddles over the bed fronts,
 * monstera and philodendron crowd the kerbs, ground ferns carpet the soil and spill onto the
 * paths; vines hang from the vault and baskets of fern hang over the paths on their chains; and
 * the two urns at the canal's head hold a cascade of sword fern and great elephant-ear leaves that
 * lean in over the landing, dark and close at the picture's lower corners.
 *
 * Everything is merged per species into a few meshes laid in world space (geometry:
 * moonlit-greenhouse-flora-geometry.js), cut and lit in the fragment (shading:
 * moonlit-greenhouse-flora-shading.js) and moved by the greenhouse air in the vertex stage: the
 * world's gust and the T-spin's turn come in through U. Parts:
 *   palms   trunks (opaque) + fronds (cut-out)
 *   ferns   tree-fern trunks + every fern frond (tree ferns' lace, ground ferns)
 *   leaves  banana stems + broad leaves (paddles and hearts) + the urns' sword ferns
 *   vines   strands and their leaves + the baskets' ferns + the baskets' wire, moss and chains
 * Render orders (opaque, nearest and largest first): leaves 2, ferns 3, palms 4–5, vines 6.
 */
import * as THREE from 'three/webgpu';
import {
    buildFerns, buildLeaves, buildPalms, buildVines,
} from './moonlit-greenhouse-flora-geometry.js';
import { createBasketMaterial, createLeafMaterial, createTrunkMaterial } from './moonlit-greenhouse-flora-shading.js';
import { EYE } from './moonlit-greenhouse-core.js';

/** A merged mesh from a finished batch (moonlit-greenhouse-flora-geometry.js FloraBatch.finish). */
export function floraGeometry(data) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    g.setAttribute('aLeaf', new THREE.BufferAttribute(data.aLeaf, 4));
    g.setAttribute('aSway', new THREE.BufferAttribute(data.aSway, 4));
    g.setAttribute('aInfo', new THREE.BufferAttribute(data.aInfo, 4));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.computeBoundingSphere();
    return g;
}

/**
 * Whether the cut-outs resolve through alpha-to-coverage. Off on every tier: drivers dither
 * partial coverage into a pixel stipple, and across a crown's sub-pixel leaflets nearly every
 * pixel is partial, so the crowns turned to a grey screen door. A hard cut, with the scene
 * pass's MSAA on the geometry's own edges, keeps them dark silhouettes.
 */
const coverageFor = () => false;

/** A part made of several meshes: { mesh: Group, dispose() }. Empty batches are left out. */
function floraPart(name, entries) {
    const group = new THREE.Group();
    group.name = `moonlit-greenhouse-${name}`;
    const owned = [];
    entries.forEach(({
        data, material, order, label,
    }) => {
        if (!data || data.vertexCount === 0) {
            material.dispose();
            return;
        }
        const geometry = floraGeometry(data);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `moonlit-greenhouse-${name}-${label}`;
        mesh.frustumCulled = false;
        mesh.renderOrder = order;
        group.add(mesh);
        owned.push({ geometry, material });
    });
    return {
        mesh: group,
        dispose() {
            group.removeFromParent();
            owned.forEach(({ geometry, material }) => {
                geometry.dispose();
                material.dispose();
            });
            owned.length = 0;
        },
    };
}

/** A trunk mesh's entry (opaque bark, stems). */
const trunks = (ctx, data, label, order) => ({
    data,
    label,
    order,
    material: createTrunkMaterial({ U: ctx.U, noise: ctx.noise, name: `moonlit-greenhouse-${label}` }),
});

/** A leaf mesh's entry: the shapes it cuts (moonlit-greenhouse-flora-shading.js SHAPES). */
const leaves = (ctx, data, label, order, shapes, { canopy = true } = {}) => ({
    data,
    label,
    order,
    material: createLeafMaterial({
        U: ctx.U,
        noise: ctx.noise,
        name: `moonlit-greenhouse-${label}`,
        shapes,
        canopy,
        coverage: coverageFor(ctx.tier),
    }),
});

/** The palms: ringed trunks and crowns of arching Kentia fronds (headings: palmFrondAngle). */
export function createPalms(ctx) {
    const built = buildPalms(ctx.plan, ctx.tier);
    return floraPart('palms', [
        trunks(ctx, built.trunks, 'palm-trunks', 4),
        // The crowns are the canopy: they are not shaded by mgCanopy's fronds themselves.
        leaves(ctx, built.fronds, 'palm-fronds', 5, ['palm'], { canopy: false }),
    ]);
}

/** The ferns: tree ferns (trunks, lacy crowns, fiddleheads) and the ground ferns of the beds. */
export function createFerns(ctx) {
    const built = buildFerns(ctx.plan, ctx.tier);
    return floraPart('ferns', [
        trunks(ctx, built.trunks, 'fern-trunks', 3),
        leaves(ctx, built.fronds, 'fern-fronds', 3, ['treeFern', 'fern', 'solid']),
    ]);
}

/** The broad leaves: bananas and strelitzia, monstera and philodendron, and the urns' planting. */
export function createLeaves(ctx) {
    const built = buildLeaves(ctx.plan, ctx.tier);
    return floraPart('leaves', [
        trunks(ctx, built.stems, 'leaf-stems', 2),
        leaves(ctx, built.leaves, 'broad-leaves', 2, ['paddle', 'heart']),
        leaves(ctx, built.fronds, 'urn-ferns', 2, ['fern']),
    ]);
}

/** The vines from the vault and the hanging baskets of fern on their chains. */
export function createVines(ctx) {
    const built = buildVines(ctx.plan, ctx.tier, [EYE.x, EYE.y, EYE.z]);
    return floraPart('vines', [
        leaves(ctx, built.leaves, 'vine-leaves', 6, ['heart', 'solid']),
        leaves(ctx, built.fronds, 'basket-ferns', 6, ['fern']),
        {
            data: built.iron,
            label: 'baskets',
            order: 6,
            material: createBasketMaterial({
                U: ctx.U, noise: ctx.noise, name: 'moonlit-greenhouse-baskets', coverage: coverageFor(ctx.tier),
            }),
        },
    ]);
}
