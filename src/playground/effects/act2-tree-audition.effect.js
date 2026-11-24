import * as THREE from 'three/webgpu';
import {
    cameraPosition, float, mix, positionWorld, sin, smoothstep, time as tslTime, uniform, vec3, vec4,
} from 'three/tsl';

import { FOREST_SPECIMENS } from '../../rendering/odyssey/world/odyssey-forest-models-decode.js';
import { createForestMaterials } from '../../rendering/odyssey/world/odyssey-forest-material.js';
import { buildForestMesh, createForestTextures } from '../../rendering/odyssey/world/odyssey-forest-mesh.js';
import { forestColours } from '../../rendering/odyssey/world/odyssey-forest-species.js';
import { ODYSSEY_WORLD_SUN } from '../../rendering/odyssey/chapter-environments/shared/chapter-profile.js';

/**
 * THE FOREST'S AUDITION BOARD (2026-11-24): every specimen side by side, drawn by the world's own forest
 * material and meshes, under its sun. The page is not the game's grade: this board judges silhouette,
 * mass, light and the tiers against each other; colour is judged in the game.
 *
 *   ?lod=hero|mid|far   the tier the board shows (default hero)
 *   ?only=oak,birch     the specimens whose id or species starts with one of these
 *   ?grove=1            one grove of the shown specimens instead of the board
 *   ?az= ?el= ?dist=    the camera (degrees, degrees, metres); ?tx= ?ty= what it looks at
 *   ?share=0.5          the share of the cards a lower tier draws
 *   ?sunaz= ?sunel=     turn the sun
 */

export const meta = {
    id: 'act2-tree-audition',
    title: 'Odyssey forest — audition board',
    description: 'Every grown specimen, by tier, under the world\'s sun.',
};

export function create({ scene, camera, params }) {
    const get = (k) => params?.get?.(k);
    const lod = ['hero', 'mid', 'far'].includes(get('lod')) ? get('lod') : 'hero';
    const only = get('only')?.split(',').filter(Boolean) ?? null;
    const share = Number(get('share')) || 1;
    const shown = FOREST_SPECIMENS.map((s, i) => ({ s, i }))
        .filter(({ s }) => !only || only.some((o) => s.id.startsWith(o) || s.species.startsWith(o)));
    const group = new THREE.Group();
    group.name = 'act2-tree-audition';
    scene.add(group);
    const prevBackground = scene.background;
    scene.background = new THREE.Color(0.62, 0.74, 0.88);

    const sun = new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize();
    if (get('sunaz') || get('sunel')) {
        const a = THREE.MathUtils.degToRad(Number(get('sunaz') ?? 155));
        const e = THREE.MathUtils.degToRad(Number(get('sunel') ?? 15));
        sun.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    }
    const uSunDir = uniform(sun);
    const uSun = uniform(new THREE.Color(1, 0.95, 0.86));
    const uSkyHorizon = uniform(new THREE.Color(0.72, 0.82, 0.93));
    const uOn = uniform(0);
    const textures = createForestTextures({ onReady: () => { uOn.value = 1; } });
    const materials = createForestMaterials({
        pullTex: textures.pullTex,
        leafTex: textures.leafTex,
        farTex: textures.farTex,
        uOn,
        cameraPosition,
        positionWorld,
        uTime: tslTime,
        uSunDir,
        uSkyHorizon,
        landSunOf: () => uSun.mul(1),
        landHourOf: () => vec4(0, 0, 0, 0),
        dayTurnOf: () => vec4(0, 0, 0, 0),
        gustFront: (xz) => sin(tslTime.mul(0.6).sub(xz.x.mul(0.0036).add(xz.y.mul(0.0027)))),
        cloudLight: () => float(1),
        reachSink: () => float(0),
        hourGold: { gain: 1, tint: [1.2, 1.1, 0.8] },
        silver: 0,
        finish: (c) => c,
    });

    const groundMat = new THREE.MeshBasicNodeMaterial();
    groundMat.colorNode = mix(vec3(0.16, 0.25, 0.08), vec3(0.55, 0.66, 0.74), smoothstep(
        float(60),
        float(420),
        positionWorld.sub(cameraPosition).length(),
    ));
    groundMat.fog = false;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), groundMat);
    ground.rotation.x = -Math.PI / 2;
    group.add(ground);

    const items = [];
    const tree = (i, x, z, scale = 1, rot = 0.6, extra = {}) => {
        const col = forestColours(FOREST_SPECIMENS[i].species, {
            hue: (items.length * 0.618) % 1, value: (items.length * 0.37) % 1,
        });
        items.push({
            specimen: i,
            x,
            y: 0,
            z,
            scale,
            scaleY: scale,
            rot,
            leanX: 0,
            leanZ: 0,
            phase: items.length * 1.7,
            shadeTop: -1,
            open: 1,
            ...col,
            ...extra,
        });
    };
    let depth = 0;
    let wide = 0;
    if (get('grove')) {
        let k = 0;
        for (let j = 0; j < 9; j += 1) {
            for (let q = 0; q < 13; q += 1) {
                const h = Math.sin((j * 127.1) + (q * 311.7)) * 43758.5453;
                const r = h - Math.floor(h);
                const x = ((q - 6) * 7.2) + ((r - 0.5) * 5);
                const z = (j * -7.2) + ((((r * 7) % 1) - 0.5) * 5);
                tree(shown[k % shown.length].i, x, z, 0.8 + (0.4 * ((r * 13) % 1)), r * 6.28, {
                    shadeTop: j > 0 ? 0.55 : 0.1, open: 0.45,
                });
                k += 3;
            }
        }
        wide = 80;
        depth = 60;
    } else {
        const cols = Math.ceil(Math.sqrt(shown.length * 2.4));
        let x = 0;
        let row = 0;
        shown.forEach(({ s, i }, k) => {
            if (k && k % cols === 0) { row += 1; x = 0; }
            x += s.reach + 1.2;
            tree(i, x, row * -24);
            x += s.reach + 1.2;
            wide = Math.max(wide, x);
        });
        depth = row * 24;
        items.forEach((t) => { t.x -= wide / 2; });
    }
    const mesh = buildForestMesh({ lod, items }, materials, { cardShare: share });
    if (mesh) {
        mesh.frustumCulled = false;
        group.add(mesh);
        console.log(`[audition] ${lod} ${items.length} trees ${mesh.userData.forest.triangles} triangles (slots)`);
    }
    const az = THREE.MathUtils.degToRad(Number(get('az') ?? 0));
    const el = THREE.MathUtils.degToRad(Number(get('el') ?? 12));
    const dist = Number(get('dist')) || Math.max(30, wide * 0.62);
    const aim = new THREE.Vector3(Number(get('tx') ?? 0), Number(get('ty') ?? 7), Number(get('tz') ?? (-depth * 0.4)));
    camera.near = 0.5;
    camera.far = 4000;
    const seat = () => {
        camera.position.set(
            (Math.sin(az) * Math.cos(el) * dist) + aim.x,
            (Math.sin(el) * dist) + aim.y,
            (Math.cos(az) * Math.cos(el) * dist) + aim.z,
        );
        camera.lookAt(aim);
    };
    seat();
    camera.updateProjectionMatrix();

    return {
        update() { seat(); },
        dispose() {
            scene.background = prevBackground;
            scene.remove(group);
            group.traverse((o) => { o.geometry?.dispose?.(); });
            [materials.near, materials.far, groundMat].forEach((m) => m?.dispose());
            textures.dispose();
        },
    };
}
