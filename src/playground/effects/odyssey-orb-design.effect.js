/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
// Odyssey ORB DESIGN bench (2026-10-23): "a world in a glass marble".
//
// Draws the SHIPPING orb builders (level-node-manager.tsl.js: glass, world window, halo,
// stars) for one orb per state — locked / open / current / completed with two of three stars —
// over a plain backdrop, so the design can be judged close up and at journey scale without the
// journey. The same instance attributes LevelNodeManager writes, so anything tuned here is what
// the game draws (the game adds its ACES + film grade on top: judge colour in-game).
//
// URL params:
//   ?effect=odyssey-orb-design&orbit=0&t=4
//   bg=sky|ocean|space|lava|forest   backdrop (default space)
//   dist=<u>                          camera distance (default 11: a close-up; 55: journey scale)
//   icons=a,b,c,d                     theme ids for the four orbs
//   tint=#rrggbb                      the chapter light (default per backdrop)
//   sel=<0..3>                        select one orb (its ring)
import * as THREE from 'three/webgpu';
import {
    Fn, floor, mix, normalize, positionWorld, smoothstep, step, uniform, vec3,
} from 'three/tsl';
import { hash21 } from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';
import {
    ORB_STAR_SIZE,
    ORB_STAR_SLOTS,
    createGlassShellTSL,
    createOrbHaloTSL,
    createOrbStarsTSL,
    createOrbWindowTSL,
} from '../../rendering/odyssey/level-node-manager.tsl.js';
import {
    makeQuadInstancedGeometry,
} from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-billboard.js';

export const meta = {
    id: 'odyssey-orb-design',
    title: 'Odyssey orb design',
    description: 'The shipping level orb — a world inside a glass marble — in each state.',
};

const R = 1.4; // GLASS_OUTER_RADIUS
const ICON_SIZE = 256;
const STATES = [
    {
        name: 'locked', locked: 1, completed: 0, current: 0, stars: 0,
    },
    {
        name: 'open', locked: 0, completed: 0, current: 0, stars: 0,
    },
    {
        name: 'current', locked: 0, completed: 0, current: 1, stars: 0,
    },
    {
        name: 'completed', locked: 0, completed: 1, current: 0, stars: 2,
    },
];
const BACKDROPS = {
    space: { top: 0x05060f, bottom: 0x0b0a1e, tint: 0xffdcaa },
    sky: { top: 0x3f7fd6, bottom: 0xbfd9f2, tint: 0xfff0cc },
    ocean: { top: 0x1f6fa8, bottom: 0x06223f, tint: 0x5fe0ff },
    lava: { top: 0x1a0603, bottom: 0x5a1606, tint: 0xff9a3c },
    forest: { top: 0x8fc7e8, bottom: 0x3f6b2e, tint: 0xffd77a },
};

/** The manager's 5-5-5 pack of the chapter light (LevelNodeManager._packCoreFallback). */
function pack555(color) {
    const q = (v) => Math.min(31, Math.floor(v * 31));
    return (q(color.r) * 1024) + (q(color.g) * 32) + q(color.b);
}

function createBackdrop(kind) {
    const bd = BACKDROPS[kind] || BACKDROPS.space;
    const material = new THREE.MeshBasicNodeMaterial();
    const top = new THREE.Color(bd.top);
    const bottom = new THREE.Color(bd.bottom);
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld);
        const base = mix(vec3(bottom.r, bottom.g, bottom.b), vec3(top.r, top.g, top.b), smoothstep(-0.6, 0.6, dir.y));
        // A sprinkle of stars in space, faint specks otherwise: something for the glass to sit on.
        const cell = floor(dir.mul(220.0));
        const star = step(0.997, hash21(cell.xy.add(cell.z))).mul(kind === 'space' ? 0.9 : 0.12);
        return base.add(vec3(star));
    })();
    material.side = THREE.BackSide;
    material.depthWrite = false;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 32), material);
    mesh.renderOrder = -10;
    return mesh;
}

export function create({ scene, camera, params }) {
    const uTime = uniform(0);
    const bgKind = params.get('bg') || 'space';
    const tint = new THREE.Color(params.get('tint') || (BACKDROPS[bgKind]?.tint ?? 0xffdcaa));
    const icons = (params.get('icons') || 'aurora,bioluminescence,black-hole,crystal-cave').split(',');
    const dist = Number.parseFloat(params.get('dist')) || 11;
    const sel = params.has('sel') ? Number.parseInt(params.get('sel'), 10) : -1;

    const group = new THREE.Group();
    group.name = 'orb-design';
    scene.add(group);
    const backdrop = createBackdrop(bgKind);
    group.add(backdrop);

    // The icon atlas: one layer per orb (layer 0 reserved, as in the manager), dark glass until
    // the icons decode.
    const layers = STATES.length + 1;
    const data = new Uint8Array(ICON_SIZE * ICON_SIZE * 4 * layers);
    new Uint32Array(data.buffer).fill(0xff201816);
    const atlas = new THREE.DataArrayTexture(data, ICON_SIZE, ICON_SIZE, layers);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.minFilter = THREE.LinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.generateMipmaps = false;
    atlas.needsUpdate = true;
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const loads = STATES.map(async (_, i) => {
        const id = icons[i % icons.length];
        const image = new Image();
        image.src = `/src/themes/${id}/${id}-theme-icon.png`;
        await image.decode();
        ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
        ctx.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
        atlas.image.data.set(ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE).data, (i + 1) * ICON_SIZE * ICON_SIZE * 4);
        atlas.addLayerUpdate?.(i + 1);
        atlas.needsUpdate = true;
    });

    // Instances: the four states in a row, written as LevelNodeManager writes them.
    const n = STATES.length;
    const centers = STATES.map((_, i) => new THREE.Vector3((i - ((n - 1) / 2)) * R * 2.9, 0, 0));
    const windowArr = new Float32Array(n * 4);
    const coreArr = new Float32Array(n * 4);
    const glassState = new Float32Array(n * 4);
    const tintArr = new Float32Array(n * 3);
    const haloArr = new Float32Array(n * 4);
    const haloState = new Float32Array(n * 4);
    STATES.forEach((s, i) => {
        const c = centers[i];
        const selected = i === sel ? 1 : 0;
        windowArr.set([c.x, c.y, c.z, R], i * 4);
        const bits = s.locked + (s.completed * 2) + (selected * 8) + (s.current * 16);
        coreArr.set([i + 1 + 0.5, ((i + 1) * 0.61803398875) % 1000, bits, pack555(tint)], i * 4);
        glassState.set([s.locked, s.completed, s.current * 2, selected], i * 4);
        tintArr.set([tint.r, tint.g, tint.b], i * 3);
        haloArr.set([c.x, c.y, c.z, s.locked ? 0 : R], i * 4);
        haloState.set([s.locked, selected * 2, s.current, s.completed], i * 4);
    });

    const windowGeo = makeQuadInstancedGeometry(n, {
        aWindow: { array: windowArr, itemSize: 4 },
        aCore: { array: coreArr, itemSize: 4 },
    });
    const windowMesh = new THREE.Mesh(windowGeo, createOrbWindowTSL(atlas, uTime).material);
    windowMesh.frustumCulled = false;
    group.add(windowMesh);

    const glass = createGlassShellTSL(uTime);
    const glassMesh = new THREE.InstancedMesh(glass.geometry, glass.material, n);
    glass.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(glassState, 4));
    glass.geometry.setAttribute('aNodeColor', new THREE.InstancedBufferAttribute(tintArr, 3));
    glass.geometry.setAttribute('aNodeAccentColor', new THREE.InstancedBufferAttribute(tintArr, 3));
    const m = new THREE.Matrix4();
    centers.forEach((c, i) => glassMesh.setMatrixAt(i, m.makeTranslation(c.x, c.y, c.z)));
    glassMesh.frustumCulled = false;
    group.add(glassMesh);

    const haloGeo = makeQuadInstancedGeometry(n, {
        aHalo: { array: haloArr, itemSize: 4 },
        aColor: { array: tintArr, itemSize: 3 },
        aState: { array: haloState, itemSize: 4 },
    });
    const haloMesh = new THREE.Mesh(haloGeo, createOrbHaloTSL(uTime).material);
    haloMesh.frustumCulled = false;
    haloMesh.renderOrder = 1;
    group.add(haloMesh);

    // The completed orb's stars, placed in the camera basis as the manager places them.
    const starGeo = new THREE.PlaneGeometry(1, 1);
    starGeo.deleteAttribute('normal');
    const done = STATES.findIndex((s) => s.completed);
    const starArr = new Float32Array(3).map((_, s) => (s < STATES[done].stars ? 1 : 0));
    starGeo.setAttribute('aStar', new THREE.InstancedBufferAttribute(starArr, 1));
    const starMesh = new THREE.InstancedMesh(starGeo, createOrbStarsTSL().material, 3);
    starMesh.frustumCulled = false;
    starMesh.renderOrder = 10;
    group.add(starMesh);
    const camRight = new THREE.Vector3();
    const camUp = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const at = new THREE.Vector3();
    function placeStars(cam) {
        cam.updateMatrixWorld();
        camRight.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
        camUp.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
        const c = centers[done];
        toCam.copy(cam.position).sub(c).normalize();
        ORB_STAR_SLOTS.forEach((place, s) => {
            m.copy(cam.matrixWorld);
            m.setPosition(at.copy(c)
                .addScaledVector(camRight, place.right * R)
                .addScaledVector(camUp, place.up * R)
                .addScaledVector(toCam, place.toward * R));
            m.scale(at.setScalar(ORB_STAR_SIZE * R));
            starMesh.setMatrixAt(s, m);
        });
        starMesh.instanceMatrix.needsUpdate = true;
    }

    camera.position.set(0, 0.6, dist);
    camera.lookAt(0, 0, 0);
    placeStars(camera);
    window.__ORBS__ = { ready: Promise.all(loads) };

    return {
        cameraRadius: dist,
        update(time) { uTime.value = time; },
        camera(time, cam) {
            cam.position.set(Math.sin(time * 0.05) * dist * 0.08, 0.6, dist);
            cam.lookAt(0, 0, 0);
            placeStars(cam);
        },
        dispose() {
            scene.remove(group);
            [windowGeo, haloGeo, glass.geometry, starGeo, backdrop.geometry].forEach((g) => g.dispose());
            [windowMesh, glassMesh, haloMesh, starMesh, backdrop].forEach((o) => o.material.dispose());
            atlas.dispose();
            delete window.__ORBS__;
        },
    };
}
