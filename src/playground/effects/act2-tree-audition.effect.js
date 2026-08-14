import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, dot, float, max, mix, normalize, normalWorld,
    positionWorld, smoothstep, uniform, vec3,
} from 'three/tsl';

import {
    FOREST_VALUE_ROLES, ODYSSEY_FOREST_SPECIES,
} from '../../rendering/odyssey/world/odyssey-forest-species.js';
import {
    buildForestTreeGeometry, forestRosterBudget,
} from '../../rendering/odyssey/world/odyssey-forest-geometry.js';
import { ODYSSEY_WORLD_SUN } from '../../rendering/odyssey/chapter-environments/shared/chapter-profile.js';

/**
 * ACT II TREE AUDITION — the board owner decision D1 is taken on (forest plan Wave 1).
 *
 * The `koi-tree-audition.effect.js` pattern: every candidate laid out side by side at the same
 * scale under the same light, because a roster is chosen by COMPARISON and a tree judged alone
 * always looks fine. Columns are species, rows are growth stages; `?lod=` swaps the whole board
 * between hero / mid / far so the far tier is judged as a silhouette rather than assumed.
 *
 * ⚠️ THIS RIG IS NOT COLOUR-TRUTHFUL, and that is deliberate. The playground page is flat
 * NoToneMapping while the game applies ACES plus master and chapter saturation on top of the
 * world's 0.82/0.72 output contract — authoring colour here is exactly how the cloud deck was
 * tuned "soft grey" and shipped as "navy shards". This board is for SILHOUETTE, MASSING and
 * PROPORTION (§1b R4/R6/R8). The palette verdict belongs on `act2-cloud-deck.effect.js`, which
 * mounts the real world through the real pipeline.
 *
 * The paint here is a deliberately reduced copy of the Wave 0b probe stack — wrap diffuse, one
 * band, the measured shade recipe, the quantised occlusion skirt — so the shapes are read under
 * the lighting model they will actually ship with, not under a stand-in.
 *
 * URL params:
 *   ?lod=hero|mid|far   which tier the board shows (default hero)
 *   ?species=S2         audition ONE species across its stages, filling the board
 *   ?spin=0             stop the slow turntable (silhouette review wants motion; a still
 *                       capture wants it off, and `?t=` freezes update() dt anyway)
 */

export const meta = {
    id: 'act2-tree-audition',
    title: 'Act II — tree audition board',
    description: 'Every species x growth stage side by side, for roster decision D1.',
};

const COL_SPACING = 9.0;
// Rows need more room than columns: in perspective, depth separation collapses faster than
// lateral separation, and the first capture had three growth stages reading as one clump.
const ROW_SPACING = 10.0;

export function create({
    scene, camera, params,
}) {
    const lod = ['hero', 'mid', 'far'].includes(params?.get?.('lod')) ? params.get('lod') : 'hero';
    const onlyId = params?.get?.('species');
    const spin = params?.get?.('spin') !== '0';

    const species = onlyId
        ? ODYSSEY_FOREST_SPECIES.filter((s) => s.id.startsWith(onlyId))
        : ODYSSEY_FOREST_SPECIES;
    const shown = species.length ? species : ODYSSEY_FOREST_SPECIES;

    const group = new THREE.Group();
    group.name = 'act2-tree-audition';
    scene.add(group);
    // A LIGHT background, because an audition board is judged on SILHOUETTE and a dark tree on
    // a dark field has none. This is also why the rig is not colour-truthful and says so.
    const prevBackground = scene.background;
    scene.background = new THREE.Color(0.78, 0.82, 0.86);

    const uSunDir = uniform(new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize());
    const uSunColour = uniform(new THREE.Color(1, 0.95, 0.86));
    const uAmbient = uniform(new THREE.Color(0.42, 0.50, 0.62));

    // ── ground plane, so the trees are seated rather than floating ──
    const groundMat = new THREE.MeshBasicNodeMaterial();
    groundMat.colorNode = vec3(0.32, 0.34, 0.26);
    groundMat.fog = false;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.name = 'audition-ground';
    group.add(ground);

    /**
     * One material per VALUE ROLE, not per species: the roles are the measured classes, and
     * building it this way makes a species' role visible on the board instead of buried in a
     * table. The crown colour rides a vertex attribute so the roster still shares pipelines.
     */
    const materials = new Map();
    const makeMaterial = (role) => {
        if (materials.has(role)) return materials.get(role);
        const recipe = FOREST_VALUE_ROLES[role];
        const mat = new THREE.MeshBasicNodeMaterial();
        const aCrown = attribute('aCrown', 'vec3');
        const aTrunk = attribute('aTrunk', 'vec3');
        // One packed vec4: x = AO, y = height in crown, z = crown mask, w = height above
        // ground. See the attribute's note in odyssey-forest-geometry.js for why `y > 0` is
        // NOT a usable trunk test and why the channels had to be packed at all.
        const vcol = attribute('aVert', 'vec4');
        const isCrown = vcol.z;
        const albedo = mix(aTrunk, aCrown, isCrown);
        const wrap = clamp(dot(normalWorld, uSunDir).add(0.70).div(1.70), 0, 1);
        // AO shifts the band THRESHOLD rather than multiplying the colour — the cloud field's
        // grammar. Darkening by AO is how a stylised canopy turns muddy.
        const band = smoothstep(float(0.40).sub(vcol.x.mul(0.10)), float(0.58), wrap);
        const luma = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
        const shade = max(
            mix(vec3(luma, luma, luma), albedo, float(recipe.sat)),
            vec3(0, 0, 0),
        );
        // The quantised sky-occlusion skirt (Wave 0b measured a step beats a ramp here).
        const occ = mix(float(0.80), float(1), smoothstep(float(0.10), float(0.38), vcol.y));
        const body = mix(shade, albedo, band).mul(occ);
        const light = mix(uSunColour.mul(recipe.value).add(uAmbient.mul(0.18)), uSunColour.mul(0.88), band);
        const view = normalize(cameraPosition.sub(positionWorld));
        const backlit = clamp(dot(view, uSunDir).mul(-1), 0, 1).pow(2.5);
        const rim = float(1).sub(abs(dot(normalWorld, view)));
        mat.colorNode = Fn(() => body.mul(light)
            .add(uSunColour.mul(backlit.mul(rim).mul(vcol.y).mul(0.30))))();
        mat.fog = false;
        materials.set(role, mat);
        return mat;
    };

    const meshes = [];
    const built = [];
    shown.forEach((spec, col) => {
        spec.stages.forEach((stage, row) => {
            const geo = buildForestTreeGeometry(spec, stage, lod, ((col + 1) * 7919) + ((row + 1) * 104729));
            built.push(geo);
            // Crown and trunk colours as CONSTANT attributes: the audition's whole job is to
            // compare species, and a species is its silhouette plus its colour.
            const n = geo.getAttribute('position').count;
            const crown = new Float32Array(n * 3);
            const trunk = new Float32Array(n * 3);
            for (let i = 0; i < n; i += 1) {
                crown[i * 3] = spec.crown[0];
                crown[(i * 3) + 1] = spec.crown[1];
                crown[(i * 3) + 2] = spec.crown[2];
                trunk[i * 3] = spec.trunk[0];
                trunk[(i * 3) + 1] = spec.trunk[1];
                trunk[(i * 3) + 2] = spec.trunk[2];
            }
            geo.setAttribute('aCrown', new THREE.BufferAttribute(crown, 3));
            geo.setAttribute('aTrunk', new THREE.BufferAttribute(trunk, 3));

            const mesh = new THREE.Mesh(geo, makeMaterial(spec.role));
            // Trees are authored at unit-ish scale; the board shows them at a common multiplier
            // so relative proportion between species is the thing being judged.
            mesh.scale.setScalar(1.6);
            mesh.position.set(
                (col - ((shown.length - 1) / 2)) * COL_SPACING,
                0,
                (row - 1) * ROW_SPACING,
            );
            mesh.name = `audition-${spec.id}-${stage.id}`;
            group.add(mesh);
            meshes.push(mesh);
        });
    });

    const budget = forestRosterBudget(built);
    // eslint-disable-next-line no-console
    console.log('[tree-audition]', JSON.stringify({
        lod,
        species: shown.map((s) => s.id),
        trees: meshes.length,
        triangles: built.reduce((a, g) => a + g.userData.forest.triangles, 0),
        worstPerLod: budget.worst,
        withinBudget: budget.withinBudget,
    }));
    if (typeof window !== 'undefined') window.__TREE_AUDITION__ = { lod, budget };

    // FRAMED ON THE BOARD'S WIDTH, not on the tallest tree. An audition board is wide and
    // short, so height-based framing pushes the camera far enough back that every candidate
    // becomes a thumbnail — which the first two captures demonstrated in both directions
    // (cropped, then tiny). Width drives the distance; the tallest tree only sets the height.
    const tallest = built.reduce((a, g) => Math.max(a, g.userData.forest.totalH), 1) * 1.6;
    const halfWidth = (((shown.length - 1) * COL_SPACING) / 2) + (tallest * 0.55);
    // tan(half of the horizontal FOV) for the playground's 50-degree vertical at 16:9, with a
    // little margin so nothing sits on the frame edge.
    const radius = Math.max(24, halfWidth / 0.74);
    camera.position.set(0, tallest * 0.80, radius);
    camera.lookAt(0, tallest * 0.42, 0);

    return {
        cameraRadius: radius,
        camera(time, cam) {
            const a = spin ? time * 0.10 : 0;
            cam.position.set(Math.sin(a) * radius, tallest * 0.80, Math.cos(a) * radius);
            cam.lookAt(0, tallest * 0.42, 0);
        },
        dispose() {
            meshes.forEach((m) => m.geometry.dispose());
            materials.forEach((m) => m.dispose());
            ground.geometry.dispose();
            groundMat.dispose();
            scene.background = prevBackground;
            scene.remove(group);
        },
    };
}
