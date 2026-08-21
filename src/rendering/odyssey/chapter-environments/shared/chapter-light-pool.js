/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Chapter light pool — the rendered light SET is constant for the whole Odyssey
 * session, and no larger than what two blending chapters need.
 *
 * WHY (docs/R185_FAST_AND_BEAUTIFUL_PLAN_2026-08.md item 2.9, measured 2026-08-21): three keys every
 * material's builder state on the lights node, and `LightsNode.customCacheKey()` hashes **each
 * light's `id`** in render-list order (node_modules/three/src/nodes/lighting/LightsNode.js:147-173).
 * The QW4 persistent light rig keeps the set constant across SEAMS, but chapters 3–8 are created in
 * the background after the reveal and each creation added its freshly-constructed lights to the
 * rig — a new id set → every visible pipeline rebuilt and re-created synchronously on the next
 * frame (41–101 sync `createRenderPipeline` calls, 2–3 s frames, three times per first launch);
 * eviction disposed them, so re-entry churned the key again.
 *
 * A first fix pre-created all 18 chapter lights in the rig. It removed the churn, but every lit
 * shader then evaluated 18 lights from frame 0: the Earth Core `MeshStandard` pipelines went
 * 0.5 → 0.8 s to compile and cold startup +0.43 s (`r185p1light` cells). So:
 *
 *   • Chapters keep their own light INSTANCES (same authored parameters, same `group.add`, same
 *     per-frame animation in their update loops) — but as **virtual** lights: `visible = false`,
 *     so they never enter the render list and never touch the lights key.
 *   • The rig holds a fixed set of **slots**, one per type up to the maximum CONCURRENT count over
 *     any two adjacent chapters (a seam blends two): 4 point + 3 directional + 1 hemisphere + 1
 *     ambient = 9 lights, vs 18 resident before. Each frame the manager copies every ACTIVE
 *     chapter's virtual lights into slots of the same type — world placement, colour, parameters,
 *     and intensity × the chapter's blend weight (the crossfade). Ambients add linearly, so all
 *     active ambients collapse into the single ambient slot. Unused slots sit at intensity 0.
 *
 * The lights key is fixed at manager construction; lit shaders carry 9 lights for the whole
 * session instead of growing to 18; chapter code is untouched beyond `acquireChapterLight()`.
 * The manifest is a contract: a fitness test builds every chapter and asserts it acquired exactly
 * its manifest, and that no chapter constructs a visible light behind the pool's back.
 */

import * as THREE from 'three/webgpu';

/** Per-chapter light types in ACQUISITION order. Chapters absent here construct no lights. */
export const CHAPTER_LIGHT_MANIFEST = Object.freeze({
    1: Object.freeze(['AmbientLight', 'PointLight', 'PointLight']), // earth-core: ambient, lavaLight, lavaGlow
    3: Object.freeze(['AmbientLight', 'DirectionalLight', 'HemisphereLight']), // surface-world
    4: Object.freeze(['AmbientLight', 'DirectionalLight', 'DirectionalLight']), // mountain-peaks
    5: Object.freeze(['AmbientLight', 'PointLight', 'PointLight', 'PointLight']), // sky-drift
    6: Object.freeze(['AmbientLight', 'PointLight', 'DirectionalLight']), // cosmic-expanse
    8: Object.freeze(['PointLight', 'AmbientLight']), // urban-dreams: beacon (tsl builder runs first), ambient
});

const SLOT_TYPES = ['AmbientLight', 'HemisphereLight', 'DirectionalLight', 'PointLight', 'SpotLight'];
const SUPPORTED = new Set(SLOT_TYPES);

/**
 * Rig slot counts per type: the maximum over every pair of ADJACENT chapters (the two a seam
 * blends) of their summed counts; ambient is one merged slot.
 * @param {object} [manifest]
 * @returns {Record<string, number>}
 */
export function deriveRigSlots(manifest = CHAPTER_LIGHT_MANIFEST) {
    const ids = Object.keys(manifest).map(Number);
    const last = Math.max(8, ...ids);
    const countOf = (id, type) => (manifest[id] || []).filter((t) => t === type).length;
    const slots = {};
    for (const type of SLOT_TYPES) {
        let max = 0;
        for (let id = 1; id <= last; id += 1) {
            max = Math.max(max, countOf(id, type) + countOf(id + 1, type));
        }
        slots[type] = type === 'AmbientLight' ? Math.min(1, max) : max;
    }
    return slots;
}

function construct(type, init = {}) {
    const color = init.color ?? 0xffffff;
    const intensity = init.intensity ?? 1;
    switch (type) {
    case 'PointLight': return new THREE.PointLight(color, intensity, init.distance ?? 0, init.decay ?? 2);
    case 'SpotLight': return new THREE.SpotLight(color, intensity, init.distance ?? 0, init.angle ?? Math.PI / 3, init.penumbra ?? 0, init.decay ?? 2);
    case 'DirectionalLight': return new THREE.DirectionalLight(color, intensity);
    case 'HemisphereLight': return new THREE.HemisphereLight(color, init.groundColor ?? 0xffffff, intensity);
    case 'AmbientLight':
    default: return new THREE.AmbientLight(color, intensity);
    }
}

let _pool = null;
const _worldPos = new THREE.Vector3();
const _accumColor = new THREE.Color();
const _tmpColor = new THREE.Color();

/**
 * Create the rig's light SLOTS (intensity 0, fixed order). Idempotent per rig.
 * @param {THREE.Object3D} rig the persistent light rig (never hidden)
 * @param {object} [manifest]
 */
export function seedChapterLightPool(rig, manifest = CHAPTER_LIGHT_MANIFEST) {
    if (_pool && _pool.rig === rig) return _pool;
    const counts = deriveRigSlots(manifest);
    const slots = {};
    for (const type of SLOT_TYPES) {
        slots[type] = [];
        for (let i = 0; i < counts[type]; i += 1) {
            const light = construct(type, { intensity: 0 });
            light.intensity = 0;
            light.name = `chapter-light-slot:${type}:${i}`;
            light.userData.chapterLightSlot = { type, index: i };
            rig.add(light);
            slots[type].push(light);
        }
    }
    _pool = {
        rig, manifest, slots, virtual: new Map(), fallbacks: [], overflow: 0, warnedOverflow: false,
    };
    return _pool;
}

/** The live pool, or null when no manager has seeded one (plain chapter builds in tests). */
export function getChapterLightPool() {
    return _pool;
}

/**
 * A chapter's light. With a pool: a VIRTUAL light (never rendered; `visible = false`) that the
 * chapter positions, adds to its group and animates exactly as before, and whose values the
 * manager copies into a rig slot while the chapter is active. Acquisitions beyond the chapter's
 * manifest are recorded in `pool.fallbacks` for the fitness test (they are still virtual, so the
 * key cannot churn — the test is what keeps the slot count honest). Without a pool (tests that
 * build chapters directly) an ordinary visible light is returned.
 * @param {number} chapterId
 * @param {'AmbientLight'|'PointLight'|'DirectionalLight'|'HemisphereLight'|'SpotLight'} type
 * @param {{color?: number|THREE.Color, intensity?: number, distance?: number, decay?: number, groundColor?: number, angle?: number, penumbra?: number}} [init]
 * @returns {THREE.Light}
 */
export function acquireChapterLight(chapterId, type, init = {}) {
    if (!SUPPORTED.has(type)) throw new Error(`acquireChapterLight: unsupported light type ${type}`);
    const light = construct(type, init);
    if (!_pool) {
        light.userData.pooled = false;
        return light;
    }
    let list = _pool.virtual.get(chapterId);
    if (!list) {
        list = [];
        _pool.virtual.set(chapterId, list);
    }
    const index = list.length;
    const expected = _pool.manifest[chapterId]?.[index];
    if (expected !== type) _pool.fallbacks.push({ chapterId, type, index });
    light.visible = false; // never in the render list — the slots are what render
    light.userData.pooled = true;
    light.userData.chapterVirtualLight = { chapterId, type, index };
    list.push(light);
    return light;
}

/** Forget a chapter's virtual lights on eviction (its slots go to 0 on the next sync). */
export function releaseChapterLights(chapterId) {
    const list = _pool?.virtual.get(chapterId) || [];
    _pool?.virtual.delete(chapterId);
    return list;
}

/**
 * Copy the active chapters' virtual lights into the rig slots — the per-frame crossfade.
 * Call AFTER the chapters' update() (they rewrite their lights' intensities from scratch) with
 * each active chapter's blend weight. Ambients are summed into the single ambient slot.
 * @param {Array<{chapterId: number, weight: number}>} active chapters with a non-zero weight
 */
export function syncChapterLightSlots(active) {
    if (!_pool) return;
    const { slots, rig } = _pool;
    const used = {};
    for (const type of SLOT_TYPES) used[type] = 0;
    let ambientIntensity = 0;
    _accumColor.setRGB(0, 0, 0);

    for (const { chapterId, weight } of active) {
        const w = THREE.MathUtils.clamp(weight, 0, 1);
        if (w <= 0) continue;
        const list = _pool.virtual.get(chapterId);
        if (!list) continue;
        for (const v of list) {
            const { type } = v.userData.chapterVirtualLight;
            const strength = v.intensity * w;
            if (type === 'AmbientLight') {
                ambientIntensity += strength;
                _accumColor.add(_tmpColor.copy(v.color).multiplyScalar(strength));
                continue;
            }
            const slot = slots[type][used[type]];
            if (!slot) {
                _pool.overflow += 1;
                if (!_pool.warnedOverflow) {
                    _pool.warnedOverflow = true;
                    console.warn(`[ChapterLightPool] more active ${type}s than rig slots (${slots[type].length}) — light dropped; widen deriveRigSlots`);
                }
                continue;
            }
            used[type] += 1;
            slot.color.copy(v.color);
            slot.intensity = strength;
            if (type === 'PointLight' || type === 'SpotLight') {
                slot.distance = v.distance;
                slot.decay = v.decay;
            }
            if (type === 'SpotLight') {
                slot.angle = v.angle;
                slot.penumbra = v.penumbra;
            }
            if (type === 'HemisphereLight') slot.groundColor.copy(v.groundColor);
            // World placement → rig-local (the rig is a child of the environment group).
            v.getWorldPosition(_worldPos);
            rig.worldToLocal(_worldPos);
            slot.position.copy(_worldPos);
        }
    }
    // Merged ambient.
    const ambientSlot = slots.AmbientLight[0];
    if (ambientSlot) {
        ambientSlot.intensity = ambientIntensity;
        if (ambientIntensity > 0) ambientSlot.color.copy(_accumColor).multiplyScalar(1 / ambientIntensity);
    }
    // Unused slots go dark.
    for (const type of SLOT_TYPES) {
        if (type === 'AmbientLight') continue;
        for (let i = used[type]; i < slots[type].length; i += 1) slots[type][i].intensity = 0;
    }
}

/** Test/teardown hook: forget the pool (does not dispose lights). */
export function resetChapterLightPoolForTests() {
    _pool = null;
}
