/**
 * Spring — the woods as impostors of the modelled trees.
 *
 * The valley holds thousands of trees; only the nearest can be the modelled birches and spruces
 * (spring-forest.js), each of them tens of thousands of leaves. Every other tree is a card that
 * shows one of those same models: once, as the world is made, each model is drawn side on (two
 * turns of it) into an atlas by the forest's own materials in a bake mode, its albedo in one
 * texture (with its coverage) and its normals in another (with each texel's occlusion and how far
 * it is a leaf the sun can shine through). The woods' cards face the eye and are lit from those
 * textures by the hour's sun and sky as the models are, so a card reads as the model it was taken
 * from: the eye stands still, and a tree seen from one place is the same picture from it.
 *
 * Cards stand where spring-woods.js says (woodSites), each a model and a turn picked by its kind
 * and seed, sized by the tree's height, leaning a little in the breeze from its top.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { aerial, sunShare } from './spring-light.js';
import { SpringForest } from './spring-forest.js';

/**
 * The atlas: the models it holds (birches, then spruces), the turns of each, a cell's height in
 * its widths, and how much of a cell's height the model fills. Per tier, a cell's pixels.
 */
export const IMPOSTOR = Object.freeze({
    birches: Object.freeze(['birch-grove-a', 'birch-grove-b', 'birch-grove-c', 'birch-hero']),
    spruces: Object.freeze(['spruce-grove-a', 'spruce-grove-b', 'spruce-grove-c', 'spruce-hero']),
    turns: Object.freeze([0.4, 2.5]),
    aspect: 1.5,
    fill: 0.94,
});
/** The colour the atlas is cleared to where no tree stands (its mips bleed toward it). */
const CLEAR_ALBEDO = new THREE.Color(0.18, 0.24, 0.13);
const CLEAR_NORMAL = new THREE.Color(0.5, 0.5, 1.0);

/** How wide and tall a model stands (m): its height, its crown's widest reach from the trunk. */
function modelExtent(asset) {
    const { sites } = asset;
    let reach = 0;
    for (let i = 0; i < sites.count; i += 1) {
        const x = sites.position[i * 3];
        const z = sites.position[i * 3 + 2];
        reach = Math.max(reach, Math.hypot(x, z) + sites.scale[i] * 0.55);
    }
    const box = asset.bark.boundingBox;
    if (box) {
        reach = Math.max(reach, Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
    }
    let top = asset.height || 1;
    for (let i = 0; i < sites.count; i += 1) top = Math.max(top, sites.position[i * 3 + 1] + sites.scale[i] * 0.5);
    if (box) top = Math.max(top, box.max.y);
    return { reach, top };
}

/**
 * The atlas's cells for the models present: per cell its model, species (0 birch, 1 spruce),
 * turn, column and row, and the model's framing: its height in metres (`top`) and the bake's
 * scale (cell widths per metre). The billboard sizes itself from these.
 */
export function impostorCells(assets) {
    const models = [...IMPOSTOR.birches, ...IMPOSTOR.spruces].filter((name) => assets?.trees?.[name]);
    const cells = [];
    models.forEach((name, column) => {
        const asset = assets.trees[name];
        const { reach, top } = modelExtent(asset);
        // Fit the model's height to the cell's, and its crown to the cell's width.
        const scale = Math.min((IMPOSTOR.aspect * IMPOSTOR.fill) / top, 0.94 / (2 * reach));
        IMPOSTOR.turns.forEach((turn, row) => {
            cells.push(Object.freeze({
                index: cells.length,
                model: name,
                species: IMPOSTOR.spruces.includes(name) ? 1 : 0,
                turn,
                column,
                row,
                top,
                scale,
            }));
        });
    });
    return { cells, columns: models.length, rows: IMPOSTOR.turns.length };
}

/**
 * The atlas: built from the forest's assets, drawn into its two textures by bake(renderer).
 * `cellPixels` is a cell's width in texels (its height is aspect times that).
 */
export class ImpostorAtlas {
    constructor(u, tex, assets, { cellPixels = 256, samples = 4 } = {}) {
        this.u = u;
        this.layout = impostorCells(assets);
        this.baked = false;
        const { columns, rows } = this.layout;
        this.size = [Math.max(1, columns) * cellPixels, Math.round(rows * cellPixels * IMPOSTOR.aspect)];
        const target = () => {
            const rt = new THREE.RenderTarget(this.size[0], this.size[1], {
                samples,
                generateMipmaps: true,
                minFilter: THREE.LinearMipmapLinearFilter,
                magFilter: THREE.LinearFilter,
                type: THREE.UnsignedByteType,
                format: THREE.RGBAFormat,
                colorSpace: THREE.NoColorSpace,
                depthBuffer: true,
            });
            rt.texture.anisotropy = 4;
            return rt;
        };
        this.albedoTarget = target();
        this.normalTarget = target();
        this.albedo = this.albedoTarget.texture;
        this.normal = this.normalTarget.texture;
        this.albedo.name = 'spring-impostor-albedo';
        this.normal.name = 'spring-impostor-normal';
        // The bake scene: one tree per cell, square to the camera, standing on its cell's floor.
        this.pass = uniform(0);
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(0, Math.max(1, columns), rows * IMPOSTOR.aspect, 0, 0.1, 200);
        this.camera.position.set(0, 0, 100);
        this.camera.updateMatrixWorld();
        this.forest = null;
        if (this.layout.cells.length) {
            const placements = this.layout.cells.map((cell) => ({
                asset: cell.model,
                x: cell.column + 0.5,
                y: cell.row * IMPOSTOR.aspect + 0.03,
                z: 0,
                yaw: cell.turn,
                scale: cell.scale,
                tone: 0.5,
                far: false,
            }));
            this.forest = new SpringForest(u, tex, assets, { trees: placements.length, foliage: 1, limbs: true }, {
                bake: { pass: this.pass },
            }).buildPlacements(placements);
            this.scene.add(this.forest.group);
        }
    }

    get ready() {
        return this.baked;
    }

    /**
     * Draw the atlas (once): the materials compiled first where the backend can do it off the
     * main thread, then the albedo pass and the normals pass. The bake's trees are let go after.
     */
    async bake(renderer) {
        if (this.baked || !this.forest) return this.baked;
        if (renderer.compileAsync) {
            // compileAsync reads the target as it starts: point it at the atlas only for that.
            const previous = renderer.getRenderTarget();
            let compiling;
            renderer.setRenderTarget(this.albedoTarget);
            try {
                compiling = renderer.compileAsync(this.scene, this.camera);
            } finally {
                renderer.setRenderTarget(previous);
            }
            await compiling;
        }
        // (Let go of meanwhile: nothing to draw.)
        if (this.forest) this.draw(renderer);
        return this.baked;
    }

    /** The bake itself, synchronously (the world's first prerender if nobody baked before). */
    draw(renderer) {
        if (this.baked || !this.forest) return;
        const previous = renderer.getRenderTarget();
        const clearColour = renderer.getClearColor(new THREE.Color());
        const clearAlpha = renderer.getClearAlpha();
        renderer.setRenderTarget(this.albedoTarget);
        renderer.setClearColor(CLEAR_ALBEDO, 0);
        renderer.clear();
        this.pass.value = 0;
        renderer.render(this.scene, this.camera);
        renderer.setRenderTarget(this.normalTarget);
        renderer.setClearColor(CLEAR_NORMAL, 0);
        renderer.clear();
        this.pass.value = 1;
        renderer.render(this.scene, this.camera);
        renderer.setRenderTarget(previous);
        renderer.setClearColor(clearColour, clearAlpha);
        this.baked = true;
        this.scene.remove(this.forest.group);
        this.forest.dispose();
        this.forest = null;
    }

    dispose() {
        this.forest?.dispose();
        this.forest = null;
        this.albedoTarget.dispose();
        this.normalTarget.dispose();
    }
}

// ── The woods' cards ───────────────────────────────────────────────────────────────

/** How the cards answer the light: the sun's share on the front, through a leaf, the sky's. */
const CARD_LIGHT = Object.freeze({ sun: 0.5, through: 0.7, sky: 1.05 });
const GLOW = [1.3, 1.4, 0.32];

/**
 * The cards for a list of woods sites ({ x, y, z, kind, height, seed, lean, d, width }): a cell
 * per site by its kind and seed, its size from the cell's framing.
 */
export function createImpostorWoods(u, atlas, sites, { samples = 0 } = {}) {
    const { cells, columns, rows } = atlas.layout;
    const birches = cells.filter((c) => c.species === 0);
    const spruces = cells.filter((c) => c.species === 1);
    const count = Math.max(1, sites.length);
    const base = new Float32Array(count * 4); // x, y, z, seed
    const size = new Float32Array(count * 4); // width, height, foot (m below the base), lean
    const cell = new Float32Array(count * 4); // column, row, tone, kind
    // Nearest first: the eye stands still on the knoll, so the near cards fill the depth before
    // the thousands behind them are shaded (the picture is the same in any order).
    const nearestFirst = sites.map((site, i) => [site.d ?? 0, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    nearestFirst.forEach(([, at], i) => {
        const site = sites[at];
        // A birch's card from the birches, a spruce's from the spruces (either, when one is missing).
        let pool = site.kind === 0 ? birches : spruces;
        if (!pool.length) pool = birches.length ? birches : spruces;
        const c = pool[Math.floor(site.seed * pool.length * 0.9999)];
        // The model's height in the cell is c.top m; the cell is 1 / scale m wide.
        const k = site.height / c.top;
        const group = Math.max(1, site.width / Math.max(1e-3, site.height));
        const width = (k / c.scale) * (1 + (group - 1) * 0.35);
        const height = (k / c.scale) * IMPOSTOR.aspect * (1 + (group - 1) * 0.15);
        base.set([site.x, site.y, site.z, site.seed], i * 4);
        size.set([width, height, (0.03 / c.scale) * k + 0.4, site.lean], i * 4);
        cell.set([c.column, c.row, (site.seed * 7.31) % 1, c.species], i * 4);
    });
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    quad.deleteAttribute('normal');
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    geometry.setAttribute('aCardBase', new THREE.InstancedBufferAttribute(base, 4));
    geometry.setAttribute('aCardSize', new THREE.InstancedBufferAttribute(size, 4));
    geometry.setAttribute('aCardCell', new THREE.InstancedBufferAttribute(cell, 4));
    // No cards until the atlas is drawn (the mesh's own visibility stays the parts' to set).
    geometry.instanceCount = atlas.ready ? sites.length : 0;
    const material = cardMaterial(u, atlas, columns, rows, samples);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringWoodsCards';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return {
        mesh,
        meshes: [mesh],
        sites,
        update() {
            if (geometry.instanceCount === 0 && atlas.ready) geometry.instanceCount = sites.length;
        },
        dispose() {
            quad.dispose();
            geometry.dispose();
            material.dispose();
        },
    };
}

function cardMaterial(u, atlas, columns, rows, samples) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringWoodsCards';
    material.fog = false;
    material.alphaTest = 0.5;
    material.alphaToCoverage = samples > 1;
    const aBase = attribute('aCardBase', 'vec4');
    const aSize = attribute('aCardSize', 'vec4');
    const aCell = attribute('aCardCell', 'vec4');
    const vUv = varying(vec2(0.0), 'spCardUv');
    const vInfo = varying(vec4(0.0), 'spCardInfo'); // tone, kind, seed, distance
    const vWorld = varying(vec3(0.0), 'spCardWorld');
    const vFrame = varying(vec4(0.0), 'spCardFrame'); // to the eye (x, z), right (x, z)
    material.vertexNode = Fn(() => {
        const foot = aBase.xyz.sub(vec3(0.0, aSize.z, 0.0));
        // Turned about its trunk to face the eye.
        const toEye = u.eye.xz.sub(foot.xz);
        const facing = toEye.div(max(toEye.length(), 1e-3));
        const right = vec3(facing.y, 0.0, facing.x.negate());
        const q = positionGeometry.xy;
        // The breeze bends the top a little, a birch more than a spruce.
        const give = mix(float(0.03), float(0.014), aCell.w);
        const sway = sin(u.time.mul(0.8).add(aBase.w.mul(37.0))).mul(give).mul(u.gust).add(aSize.w.mul(0.5));
        const bend = q.y.mul(q.y).mul(sway).mul(aSize.y);
        const world = foot.add(right.mul(q.x.mul(aSize.x).add(bend))).add(vec3(0.0, q.y.mul(aSize.y), 0.0));
        // (A render target's v = 0 is its top row: the bake drew y-up, so the lookup runs down.)
        vUv.assign(vec2(aCell.x.add(q.x.add(0.5)).div(columns), float(1.0).sub(aCell.y.add(q.y).div(rows))));
        vInfo.assign(vec4(aCell.z, aCell.w, aBase.w, toEye.length()));
        vWorld.assign(world);
        vFrame.assign(vec4(facing, right.xz));
        return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    })();
    material.colorNode = Fn(() => {
        const albedoTex = texture(atlas.albedo, vUv);
        const normalTex = texture(atlas.normal, vUv);
        // Albedo was stored square-rooted; coverage in alpha.
        const albedo = albedoTex.rgb.mul(albedoTex.rgb).toVar();
        // Each tree a shade apart: some yellower, some darker.
        const tone = vInfo.x;
        albedo.mulAssign(mix(vec3(0.82, 0.86, 0.9), vec3(1.12, 1.08, 0.92), tone));
        // The bake's normal (its camera's frame) into the world: across the card, up, to the eye.
        const nxy = normalTex.xy.mul(2.0).sub(1.0);
        const nz = float(1.0).sub(dot(nxy, nxy)).max(0.0).sqrt();
        const facing = vec3(vFrame.x, 0.0, vFrame.y);
        const right = vec3(vFrame.z, 0.0, vFrame.w);
        const N = normalize(right.mul(nxy.x).add(vec3(0.0, nxy.y, 0.0)).add(facing.mul(nz)));
        const occlusion = normalTex.z;
        const leaf = normalTex.w;
        const P = vWorld;
        const V = normalize(P.sub(u.eye));
        const L = u.sunDir;
        const sunLight = u.sun.mul(sunShare(u, P));
        const wrap = clamp(dot(N, L).mul(0.6).add(0.4), 0.0, 1.0);
        const front = albedo.mul(wrap);
        // Sun through a young leaf: a clear yellow-green where it stands behind the tree.
        const through = pow(clamp(dot(V, L), 0.0, 1.0), 4.0);
        const glow = pow(albedo.max(1e-4), vec3(0.62)).mul(vec3(...GLOW)).mul(leaf)
            .mul(through.mul(CARD_LIGHT.through));
        const sky = u.fill.mul(N.y.mul(0.35).add(0.65)).add(u.bounce.mul(0.25));
        const lit = front.add(glow).mul(sunLight).mul(CARD_LIGHT.sun)
            .add(albedo.mul(sky).mul(occlusion.mul(0.85).add(0.15)).mul(CARD_LIGHT.sky));
        // Coverage: the mips thin a tree's lace as it shrinks; give it back with distance.
        const distance = vInfo.w;
        const keep = albedoTex.a.mul(float(1.0).add(smoothstep(150.0, 1500.0, distance).mul(0.6)));
        return vec4(aerial(u, P, lit), clamp(keep, 0.0, 1.0));
    })();
    return material;
}
