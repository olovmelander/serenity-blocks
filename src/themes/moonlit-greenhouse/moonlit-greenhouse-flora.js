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

/** Whether the tier draws through MSAA (alpha-to-coverage then softens the cut-outs). */
const coverageFor = (tier) => tier.frond >= 16;

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

/** The palms: ringed trunks and crowns of arching Kentia fronds (headings: palmFrondAngle). */
export function createPalms({
    tier, U, noise, plan,
}) {
    const { fronds, trunks } = buildPalms(plan, tier);
    return floraPart('palms', [
        {
            data: trunks, label: 'trunks', order: 4, material: createTrunkMaterial({ U, noise, name: 'moonlit-greenhouse-palm-trunks' }),
        },
        {
            data: fronds,
            label: 'fronds',
            order: 5,
            material: createLeafMaterial({
                U, noise, name: 'moonlit-greenhouse-palm-fronds', shapes: ['palm'], canopy: false, coverage: coverageFor(tier),
            }),
        },
    ]);
}

/** The ferns: tree ferns (trunks, lacy crowns, fiddleheads) and the ground ferns of the beds. */
export function createFerns({
    tier, U, noise, plan,
}) {
    const { fronds, trunks } = buildFerns(plan, tier);
    return floraPart('ferns', [
        {
            data: trunks, label: 'trunks', order: 3, material: createTrunkMaterial({ U, noise, name: 'moonlit-greenhouse-fern-trunks' }),
        },
        {
            data: fronds,
            label: 'fronds',
            order: 3,
            material: createLeafMaterial({
                U, noise, name: 'moonlit-greenhouse-fern-fronds', shapes: ['treeFern', 'fern', 'solid'], coverage: coverageFor(tier),
            }),
        },
    ]);
}

/** The broad leaves: bananas and strelitzia, monstera and philodendron, and the urns' planting. */
export function createLeaves({
    tier, U, noise, plan,
}) {
    const { leaves, fronds, stems } = buildLeaves(plan, tier);
    return floraPart('leaves', [
        {
            data: stems, label: 'stems', order: 2, material: createTrunkMaterial({ U, noise, name: 'moonlit-greenhouse-leaf-stems' }),
        },
        {
            data: leaves,
            label: 'broad',
            order: 2,
            material: createLeafMaterial({
                U, noise, name: 'moonlit-greenhouse-broad-leaves', shapes: ['paddle', 'heart'], coverage: coverageFor(tier),
            }),
        },
        {
            data: fronds,
            label: 'urn-ferns',
            order: 2,
            material: createLeafMaterial({
                U, noise, name: 'moonlit-greenhouse-urn-ferns', shapes: ['fern'], coverage: coverageFor(tier),
            }),
        },
    ]);
}

/** The vines from the vault and the hanging baskets of fern on their chains. */
export function createVines({
    tier, U, noise, plan,
}) {
    const { leaves, fronds, iron } = buildVines(plan, tier, [EYE.x, EYE.y, EYE.z]);
    return floraPart('vines', [
        {
            data: leaves,
            label: 'strands',
            order: 6,
            material: createLeafMaterial({
                U, noise, name: 'moonlit-greenhouse-vine-leaves', shapes: ['heart', 'solid'], coverage: coverageFor(tier),
            }),
        },
        {
            data: fronds,
            label: 'basket-ferns',
            order: 6,
            material: createLeafMaterial({
                U, noise, name: 'moonlit-greenhouse-basket-ferns', shapes: ['fern'], coverage: coverageFor(tier),
            }),
        },
        {
            data: iron,
            label: 'baskets',
            order: 6,
            material: createBasketMaterial({ U, noise, name: 'moonlit-greenhouse-baskets', coverage: coverageFor(tier) }),
        },
    ]);
}
