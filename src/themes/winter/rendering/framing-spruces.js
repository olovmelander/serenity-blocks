/* eslint-disable import/no-unresolved */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import spruce1Url from '../assets/snowy_spruce_1.glb?url';
import spruce2Url from '../assets/snowy_spruce_2.glb?url';
import spruce3Url from '../assets/snowy_spruce_3.glb?url';

// ─────────────────────────────────────────────────────────────────────────────
// FramingSpruces — snow-laden low-poly spruces for the Winter Wonderland scene.
//
// THREE Blender-authored variants so the forest doesn't read as clones:
//   1 (slim)    — tall narrow spire, long leader, lighter snow
//   2 (full)    — broad dense pyramid, heavy snow
//   3 (classic) — balanced medium spruce
// Each is built from MANY individual, irregular drooping branch fronds (free3d
// low-poly-spruce style — NOT smooth cones) with soft snow settling on the
// upper-facing boughs; 3 primitives (green/trunk/snow), normalised to unit height.
// Organic randomness (varied branch length / droop / angle + gaps) keeps them from
// reading as clones or as a machined object.
//
// Two placements from the same set:
//   • placeFraming() — a few CLOSE-camera hero spruces hugging the LEFT & RIGHT
//                      screen edges (cloned, varied variant + yaw, subtle sway).
//   • placeTreeline() — the mid-ground belt behind the lake, the 3 variants spread
//                      across the placements as instanced draw calls.
//
// Lit by the scene's moon key + cool fill; SMOOTH-shaded + fully MATTE so they feel
// natural (flat facets / specular read as "metal" on a conifer), colour-matched to
// the cold palette (soft white snow, muted cool spruce green). See the effect.
// ─────────────────────────────────────────────────────────────────────────────

const VARIANT_URLS = [spruce1Url, spruce2Url, spruce3Url];

function tuneMaterial(mat) {
    // Low-poly FACETED read (flat shading) but kept fully MATTE so it stays natural
    // — the earlier "metal" feel came from steely-blue snow + specular, NOT from flat
    // facets. Fully diffuse (roughness 1, metalness 0) + soft snow keeps it stylised
    // low-poly without the machined look.
    mat.flatShading = true;
    mat.metalness = 0.0;
    mat.roughness = 1.0;
    mat.side = THREE.DoubleSide;
    // Colour-match the cold scene but keep it soft/natural: soft white snow (not steely
    // blue) + a muted natural spruce green. The frame is graded uniformly in-game, so
    // matching here holds after the grade.
    const name = (mat.name || '').toLowerCase();
    if (name.includes('snow')) {
        mat.color.set(0xe0e8ee);
    } else if (name.includes('green') || name.includes('mid') || name.includes('foliage')) {
        mat.color.set(0x44553d);
    }
    mat.needsUpdate = true;
}

export function createFramingSpruces(scene, { feetY = -260 } = {}) {
    const group = new THREE.Group();
    group.name = 'winter-framing-spruces';
    scene.add(group);

    const loader = new GLTFLoader();
    /** @type {Array<{ srcScene: THREE.Group, parts: Array<{geometry,material}> }>} */
    let variants = [];
    const heroes = []; // { obj, swayAmp, swaySpeed, phase }
    const instMeshes = []; // InstancedMesh list (treeline)

    async function load() {
        const gltfs = await Promise.all(VARIANT_URLS.map((u) => loader.loadAsync(u)
            .catch((e) => { console.warn('[FramingSpruces] failed to load', u, e); return null; })));
        variants = gltfs.filter(Boolean).map((g) => {
            const parts = [];
            g.scene.traverse((o) => {
                if (!o.isMesh) return;
                tuneMaterial(o.material);
                o.frustumCulled = false;
                parts.push({ geometry: o.geometry, material: o.material });
            });
            return { srcScene: g.scene, parts };
        });
        console.log(`[FramingSpruces] loaded ${variants.length} spruce variants.`);
    }

    // ── CLOSE-camera framing wings (cloned; few) ────────────────────────────────
    // positions: [x, z, worldHeight] or [x, z, worldHeight, variantIndex]. Base
    // sits at feetY; the GLB is unit-height so worldHeight is the scale.
    function placeFraming(positions = []) {
        if (!variants.length) return;
        positions.forEach(([x, z, h, vi], i) => {
            const v = variants[(vi == null ? i : vi) % variants.length];
            const obj = v.srcScene.clone(true);
            obj.position.set(x, feetY, z);
            obj.rotation.y = (i * 2.3) % (Math.PI * 2);
            obj.scale.setScalar(h);
            group.add(obj);
            heroes.push({
                obj,
                swayAmp: 0.012 + (i % 3) * 0.004,
                swaySpeed: 0.30 + (i % 4) * 0.05,
                phase: i * 1.3,
            });
        });
    }

    // ── Mid-ground conifer belt (instanced; many) ───────────────────────────────
    // placements: [{ x, y, z, h, rotY }]. The 3 variants are spread across the belt.
    function placeTreeline(placements = []) {
        if (!variants.length || !placements.length) return;
        const dummy = new THREE.Object3D();
        variants.forEach((v, vi) => {
            const list = placements.filter((_, idx) => idx % variants.length === vi);
            if (!list.length) return;
            v.parts.forEach(({ geometry, material }) => {
                const inst = new THREE.InstancedMesh(geometry, material, list.length);
                inst.frustumCulled = false;
                list.forEach((p, i) => {
                    dummy.position.set(p.x, p.y, p.z);
                    dummy.rotation.set(0, p.rotY ?? 0, 0);
                    dummy.scale.setScalar(p.h); // GLB is unit-height → h is world height
                    dummy.updateMatrix();
                    inst.setMatrixAt(i, dummy.matrix);
                });
                inst.instanceMatrix.needsUpdate = true;
                group.add(inst);
                instMeshes.push(inst);
            });
        });
        console.log(`[FramingSpruces] treeline: ${placements.length} trees across ${variants.length} variants.`);
    }

    function update(dt) {
        // Subtle idle sway on the close hero trees only (instanced belt stays still).
        for (const h of heroes) {
            h.phase += dt * h.swaySpeed;
            h.obj.rotation.z = Math.sin(h.phase) * h.swayAmp;
        }
    }

    function dispose() {
        instMeshes.forEach((m) => { m.geometry?.dispose?.(); m.dispose?.(); });
        variants.forEach((v) => v.parts.forEach((p) => p.material?.dispose?.()));
        instMeshes.length = 0;
        heroes.length = 0;
        variants = [];
        scene.remove(group);
    }

    return {
        group, load, placeFraming, placeTreeline, update, dispose,
    };
}
