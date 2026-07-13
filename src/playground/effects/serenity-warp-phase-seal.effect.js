/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Serenity Warp — Phase Seal v2 (bold solid piece-stamp).
 *
 * Wave 1 of docs/SERENITY_WARP_COMBO_LOCK_FIX_PLAN_2026-07.md. Iterates the lock
 * reaction in isolation: a large, SOLID, piece-coloured stamp of the exact locked
 * tetromino with a bright rim, inner glow, converging motes and one shock-ring —
 * replacing the tiny hollow-wireframe seal shipped today.
 *
 * The age of the effect is driven directly by the harness clock, so `?t=<seconds>`
 * samples the true envelope (fxAge = t). A lightweight nebula proxy stands in for the
 * warp tunnel so contrast/readability can be judged without the heavy compute backdrop.
 *
 * URL examples:
 *   ?effect=serenity-warp-phase-seal&piece=T&t=0.22&orbit=0
 *   ?effect=serenity-warp-phase-seal&piece=T&reducedMotion=1&t=0.16&orbit=0
 *   ?effect=serenity-warp-phase-seal&pieces=all&t=0.22&orbit=0        (silhouette gallery)
 *   ?effect=serenity-warp-phase-seal&piece=I&forceWebGL=1&t=0.22&orbit=0
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    float,
    length,
    max,
    min,
    mix,
    positionLocal,
    smoothstep,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

export const meta = {
    id: 'serenity-warp-phase-seal',
    title: 'Serenity Warp — Phase Seal v2',
    description: 'Bold solid piece-stamp lock reaction (Wave 1 prototype).',
};

const PIECE_COLORS = Object.freeze({
    I: 0x52ef32,
    O: 0xffa31a,
    T: 0x536dff,
    S: 0x35e6ef,
    Z: 0xff3b30,
    J: 0xffe23d,
    L: 0xd33bea,
});

// Centred 4-cell silhouettes (cell units). Mirrors SHAPE_CELLS in the production FX.
const SHAPE_CELLS = Object.freeze({
    I: [-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0],
    O: [-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5],
    T: [-1, 0, 0, 0, 1, 0, 0, -1],
    S: [-1, 0, 0, 0, 0, -1, 1, -1],
    Z: [-1, -1, 0, -1, 0, 0, 1, 0],
    J: [-1, -1, -1, 0, 0, 0, 1, 0],
    L: [1, -1, -1, 0, 0, 0, 1, 0],
});

const CELL_SPACING = 1.0; // world units between cell centres (cells touch)
const CELL_HALF = 0.47; // half-size of each cell quad (small groove between cells)

function centredCells(pieceType) {
    const raw = SHAPE_CELLS[pieceType] || SHAPE_CELLS.T;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < 4; i += 1) {
        sx += raw[i * 2];
        sy += raw[i * 2 + 1];
    }
    const cx = sx / 4;
    const cy = sy / 4;
    const out = new Float32Array(8);
    for (let i = 0; i < 4; i += 1) {
        out[i * 2] = raw[i * 2] - cx;
        out[i * 2 + 1] = raw[i * 2 + 1] - cy;
    }
    return out;
}

function makeQuad(instanceCount) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
        0, 0, 1, 0, 1, 1, 0, 1,
    ], 2));
    geometry.instanceCount = instanceCount;
    return geometry;
}

function fxMaterial(colorNode, vertexNode) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.toneMapped = false;
    material.colorNode = colorNode;
    material.vertexNode = vertexNode;
    return material;
}

function readBoolean(value) {
    const s = String(value ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

// ---------------------------------------------------------------------------
// Nebula proxy — cheap deep-space gradient so seal contrast can be judged.
// ---------------------------------------------------------------------------
function createBackdrop(scene) {
    const geometry = new THREE.SphereGeometry(120, 32, 24);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
    material.toneMapped = false;
    material.colorNode = Fn(() => {
        // Representative of the real warp tunnel: dark deep-space with a dim purple band.
        const p = uv();
        const band = smoothstep(0.15, 0.5, p.y).mul(smoothstep(0.85, 0.5, p.y));
        const deep = vec3(0.010, 0.008, 0.035);
        const glow = vec3(0.11, 0.05, 0.25);
        const horizon = vec3(0.03, 0.05, 0.16);
        const base = mix(deep, horizon, smoothstep(0.0, 0.6, p.y));
        return vec4(mix(base, glow, band.mul(0.6)), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, geometry, material };
}

export function create({ scene, params }) {
    const pieceType = String(params?.get('piece') || 'T').trim().toUpperCase();
    const side = String(params?.get('side') || 'left').trim().toLowerCase();
    const reducedMotion = readBoolean(params?.get('reducedMotion') ?? params?.get('reduced'));
    // Reduced motion: the stamp snaps in and fades in place — no travelling motes, no
    // ring expansion, no settle compression (plan §7.6).
    const fadeInEnd = reducedMotion ? 0.03 : 0.06;
    const fadeOutStart = reducedMotion ? 0.14 : 0.45;
    const fadeOutEnd = reducedMotion ? 0.22 : 0.55;

    // Board-gutter placement: seal sits off the centre, aligned to a lock centroid.
    const originX = side === 'right' ? 3.3 : -3.3;
    const origin = new THREE.Vector3(originX, 0.4, 0);

    const backdrop = createBackdrop(scene);

    const uAge = uniform(0);
    const meshes = [];
    const geos = [];
    const mats = [];

    // Shared builder: one solid 4-cell stamp at a given origin, in the piece colour.
    function makeSeal(type, originVec) {
        const baseColor = new THREE.Color(PIECE_COLORS[type] || PIECE_COLORS.T);
        const uOrigin = uniform(originVec);
        const uColor = uniform(baseColor);
        const uRimColor = uniform(baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35));
        const cells = centredCells(type);
        const geo = makeQuad(4);
        geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));

        const sealVertex = Fn(() => {
            const cell = attribute('aCell', 'vec2');
            // 1.12 → 1.0 compression over 60–160 ms (frozen at 1.0 under reduced motion).
            const settle = reducedMotion
                ? float(1.0)
                : mix(float(1.12), float(1.0), smoothstep(0.06, 0.16, uAge));
            const localXY = positionLocal.xy.mul(CELL_HALF);
            const world = uOrigin.xy.add(cell.mul(CELL_SPACING).add(localXY).mul(settle));
            return cameraProjectionMatrix.mul(
                cameraViewMatrix.mul(vec4(world.x, world.y, uOrigin.z, 1.0)),
            );
        });

        const sealColor = Fn(() => {
            // Rounded-rect signed distance in the quad's local [-1,1] space.
            const p = uv().sub(0.5).mul(2.0);
            const q = abs(p).sub(vec2(0.80, 0.80));
            const d = length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0)).sub(0.16);

            const body = float(1.0).sub(smoothstep(float(-0.02), float(0.06), d));
            const inner = float(1.0).sub(smoothstep(float(-0.02), float(0.06), d.add(0.06)));
            const rim = clamp(body.sub(inner), 0.0, 1.0);
            const halo = exp(max(d, 0.0).mul(-7.0)).mul(0.6);
            // Centre core glow so the cell reads brightest at its middle (energy, not a flat tile).
            const core = float(1.0).sub(smoothstep(float(-0.55), float(0.0), d)).mul(0.5);

            // Envelope: crisp rim-snap in, hold, fade out. Reduced motion shortens both ends.
            const fadeIn = smoothstep(0.0, fadeInEnd, uAge);
            const fadeOut = float(1.0).sub(smoothstep(fadeOutStart, fadeOutEnd, uAge));
            const env = fadeIn.mul(fadeOut);
            const snap = float(1.0).sub(smoothstep(0.0, fadeInEnd, uAge)); // extra edge flash at t≈0

            // Vivid piece-coloured body; rim is a bright TINT of the piece hue (not pure white),
            // so the stamp reads as energy rather than a UI icon.
            const bodyBright = body.mul(0.95).add(core);
            const rimBright = rim.mul(float(1.4).add(snap.mul(1.4)));
            const glowBright = halo.mul(0.6);

            const rgb = uColor.mul(bodyBright.add(glowBright)).add(uRimColor.mul(rimBright));
            const brightness = bodyBright.add(rimBright).add(glowBright).mul(env);
            return vec4(rgb.mul(env), clamp(brightness, 0.0, 1.0));
        });

        const mat = fxMaterial(sealColor(), sealVertex());
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 20;
        scene.add(mesh);
        meshes.push(mesh);
        geos.push(geo);
        mats.push(mat);
        return {
            uOrigin, uColor, uRimColor, cells,
        };
    }

    function addMotesAndRing(seal) {
        const {
            uOrigin, uColor, uRimColor, cells,
        } = seal;

        // --- Converging motes: 4 bright dots that gather into the cells -----------
        const moteGeo = makeQuad(4);
        moteGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
        const moteVertex = Fn(() => {
            const cell = attribute('aCell', 'vec2');
            // travel from ~2.1x cell distance inward to the cell centre over 60–160 ms.
            const gather = smoothstep(0.06, 0.16, uAge);
            const dist = mix(float(2.1), float(1.0), gather);
            const localXY = positionLocal.xy.mul(0.14);
            const world = uOrigin.xy.add(cell.mul(CELL_SPACING).mul(dist).add(localXY));
            return cameraProjectionMatrix.mul(
                cameraViewMatrix.mul(vec4(world.x, world.y, uOrigin.z, 1.0)),
            );
        });
        const moteColor = Fn(() => {
            const dd = length(uv().sub(0.5).mul(2.0));
            const dot = exp(dd.mul(dd).mul(-4.2));
            const appear = smoothstep(0.0, 0.05, uAge);
            const vanish = float(1.0).sub(smoothstep(0.14, 0.22, uAge));
            const b = dot.mul(appear).mul(vanish).mul(1.4);
            return vec4(uRimColor.mul(b), clamp(b, 0.0, 1.0));
        });
        const moteMat = fxMaterial(moteColor(), moteVertex());
        const motes = new THREE.Mesh(moteGeo, moteMat);
        motes.frustumCulled = false;
        motes.renderOrder = 21;
        if (!reducedMotion) scene.add(motes);
        meshes.push(motes);
        geos.push(moteGeo);
        mats.push(moteMat);

        // --- Shock ring: one thin ring expands behind the stamp (40–280 ms) -------
        const ringGeo = makeQuad(1);
        const ringExtent = 2.9;
        const ringVertex = Fn(() => {
            const world = uOrigin.xy.add(positionLocal.xy.mul(ringExtent));
            return cameraProjectionMatrix.mul(
                cameraViewMatrix.mul(vec4(world.x, world.y, uOrigin.z, 1.0)),
            );
        });
        const ringColor = Fn(() => {
            const r = length(uv().sub(0.5).mul(2.0));
            const prog = smoothstep(0.04, 0.28, uAge);
            const ring = float(1.0).sub(smoothstep(0.0, 0.06, abs(r.sub(prog))));
            const fade = smoothstep(0.02, 0.08, uAge).mul(
                float(1.0).sub(smoothstep(0.24, 0.32, uAge)),
            );
            const b = ring.mul(fade).mul(0.8);
            return vec4(uColor.mul(b), clamp(b, 0.0, 1.0));
        });
        const ringMat = fxMaterial(ringColor(), ringVertex());
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.frustumCulled = false;
        ring.renderOrder = 19;
        if (!reducedMotion) scene.add(ring);
        meshes.push(ring);
        geos.push(ringGeo);
        mats.push(ringMat);
    }

    // Gallery mode (?pieces=all or ?pieces=I,O,T,...) lays out silhouettes in a row so
    // every shape can be judged in ONE capture. Otherwise a single stamp + motes + ring.
    const piecesParam = params?.get('pieces');
    let galleryPieces = null;
    if (piecesParam && piecesParam.trim().toLowerCase() === 'all') {
        galleryPieces = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
    } else if (piecesParam) {
        galleryPieces = piecesParam.toUpperCase().split(/[^A-Z]+/).filter((k) => PIECE_COLORS[k]);
    }

    let cameraZ = 12;
    if (galleryPieces && galleryPieces.length > 0) {
        const spacing = 4.6;
        const startX = -((galleryPieces.length - 1) * spacing) / 2;
        galleryPieces.forEach((type, i) => {
            makeSeal(type, new THREE.Vector3(startX + i * spacing, 0, 0));
        });
        cameraZ = Math.max(12, galleryPieces.length * spacing * 0.62);
    } else {
        addMotesAndRing(makeSeal(pieceType, origin));
    }

    return {
        cameraRadius: cameraZ,
        camera(_time, activeCamera) {
            activeCamera.position.set(0, 0, cameraZ);
            activeCamera.lookAt(0, 0, 0);
        },
        update(time) {
            uAge.value = Math.max(0, time);
        },
        getDiagnostics() {
            return {
                pieceType,
                side,
                reducedMotion,
                gallery: galleryPieces || null,
                fxAge: uAge.value,
            };
        },
        dispose() {
            meshes.forEach((m) => scene.remove(m));
            scene.remove(backdrop.mesh);
            geos.forEach((g) => g.dispose());
            backdrop.geometry.dispose();
            mats.forEach((mt) => mt.dispose());
            backdrop.material.dispose();
        },
    };
}
