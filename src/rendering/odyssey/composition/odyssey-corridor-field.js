/* eslint-disable import/no-unresolved */
/**
 * @fileoverview OdysseyCorridorField — parallax mid/far depth filler for the corridor.
 *
 * Part of the Odyssey Visual Cohesion master plan (Phase A, batch 2 — UNIT A2). See
 * docs/ODYSSEY_VISUAL_COHESION_MASTER_PLAN.md.
 *
 * THE PROBLEM: the camera dollies a spline through 8 chapters, but each chapter's hero
 * set piece is LOCALIZED — between/around them the camera crosses large EMPTY VOID
 * (black in the cosmic chapters, fogged elsewhere). Batch 1 gave the void a colored
 * fog body; this system adds real DEPTH CONTENT in the corridor the camera occupies so
 * NO FRAME is empty: parallax mid/far backdrop sheets + a volumetric particulate field
 * the camera is always "inside".
 *
 * It is a SINGLE cohesive system (not per-chapter env code): it reads the chapter
 * profile (palette/atmosphere) + path geometry up front, builds capped, instanced,
 * feathered content for ALL 8 chapters into ONE parent group, then each frame:
 *   (a) parallax-shifts layers relative to the camera (nearer layers move more),
 *   (b) cross-fades each chapter's layers by a visibility weight derived from the
 *       active progress vs the chapter bounds (so only active+adjacent chapters show),
 *   (c) advances time uniforms for drift.
 *
 * Mirrors OdysseyAtmosphere's construct/update/dispose contract so the board wires it
 * in identically. WebGPU/TSL only (NodeMaterials, instanced + capped, no per-frame
 * allocation — all scratch reused).
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    getActiveOdysseyChapterPositions,
    getChapterPathRange,
    getOdysseyPathCurve,
    getOdysseyPathPointAt,
} from '../path-utils.js';
import { getChapterProfile } from '../chapter-environments/shared/chapter-profile.js';
import {
    createCorridorSheetMaterial,
    createCorridorParticulateGeometry,
    createCorridorParticulateMaterial,
} from './odyssey-corridor-field.tsl.js';

const CHAPTER_COUNT = 8;

// Staggered backdrop depths (world units BEHIND the corridor centre, along the local
// view/tangent). Nearer layers parallax more; far layers anchor the horizon.
const SHEET_DEPTHS = [-90, -180, -320, -460];

// How far the particulate field hugs the path (camera is "inside" the biome).
const PARTICULATE_SPREAD = 95;
const PARTICULATE_DEPTH = 120;

// Seam overlap: how wide (in path-progress) each chapter cross-fades in/out. ~12% of a
// typical chapter span; complements A6 seam blends.
const SEAM_OVERLAP = 0.045;

// ── B7 CARRIED-ELEMENT HANDOFFS (per-boundary feel-class continuity) ────────────────
// Each seam has a "carried element" that should LIVE IN THE FIELD across the boundary, not
// just in the two chapter envs (§4). We extend the symmetric SEAM_OVERLAP fade asymmetrically
// per boundary so the OUTGOING chapter's corridor content lingers (`outExtra`, demoting
// slowly) and/or the INCOMING content appears early (`inExtra`), giving overlap continuity.
//
// Keyed by the OUTGOING chapter id (boundary N->N+1). Extra is added to SEAM_OVERLAP on the
// relevant side. ch2's RECIPE is untouched (B1); these only widen the cross-fade windows.
//   1->2 obsidian crust -> wet basalt seabed   — moderate both sides
//   2->3 god-ray light shafts bridge both       — moderate both sides
//   3->4 hero summit + cloud forming (the model invisible seam) — long carry both sides
//   4->5 cloud-sea -> cloud-deck (same clouds)  — long carry both sides
//   5->6 haze THINS fast, stars ignite EARLY    — short out (evaporate), long in (early stars)
//   6->7 accretion/lensing ever-present         — long carry both sides
//   7->8 infall motes reassemble into neon cubes — short out, long in (neon resolves early)
const SEAM_CARRY = Object.freeze({
    1: { outExtra: 0.020, inExtra: 0.020 },
    2: { outExtra: 0.022, inExtra: 0.022 },
    3: { outExtra: 0.038, inExtra: 0.038 },
    4: { outExtra: 0.040, inExtra: 0.040 },
    5: { outExtra: 0.006, inExtra: 0.045 },
    6: { outExtra: 0.040, inExtra: 0.036 },
    7: { outExtra: 0.010, inExtra: 0.038 },
});

/**
 * Feel classes drive which depth recipe a chapter gets.
 * COSMIC = space/black-hole, AERIAL = sky, URBAN = finale, TERRESTRIAL = the grounded 4.
 */
function classifyChapter(chapterId) {
    if (chapterId === 6 || chapterId === 7) return 'cosmic';
    if (chapterId === 5) return 'aerial';
    if (chapterId === 8) return 'urban';
    return 'terrestrial';
}

/**
 * Compact backdrop-sheet spec builder (positional, so recipe tables stay one row each).
 * @param {number} inner inner tint
 * @param {number} outer edge tint
 * @param {number} density FBM coverage bias
 * @param {number} scale FBM frequency
 * @param {number} drift horizontal drift speed
 * @param {boolean} additive additive glow vs normal silhouette
 * @param {number} baseOpacity peak opacity
 * @param {number} size plane width (world units)
 * @param {number} aspect height/width ratio
 * @param {number} [yOffset] vertical placement offset
 * @param {number} [parallax] parallax factor override
 * @param {object} [extra] optional surface overrides forwarded to the sheet material
 *   ({ pocket, coverage, contrast }) — pocket>0 + low coverage + high contrast = a few
 *   bright bands on near-black vacuum (not uniform haze). Omit to keep the flat-haze look.
 */
/* eslint-disable-next-line max-len */
function sheet(inner, outer, density, scale, drift, additive, baseOpacity, size, aspect, yOffset = 0, parallax = null, extra = null) {
    return {
        inner,
        outer,
        density,
        scale,
        drift,
        additive,
        baseOpacity,
        size,
        aspect,
        yOffset,
        parallax,
        pocket: extra && Number.isFinite(extra.pocket) ? extra.pocket : 0,
        coverage: extra && Number.isFinite(extra.coverage) ? extra.coverage : 0.5,
        contrast: extra && Number.isFinite(extra.contrast) ? extra.contrast : 1.0,
    };
}

/**
 * Compact particulate spec builder (positional). farLayer is attached separately.
 * @param {number} count instance count
 * @param {number} color sprite tint
 * @param {number} drift drift amplitude
 * @param {number} twinkle 0..1 twinkle depth
 * @param {number} softness 1 = soft puff, higher = tighter pinpoint
 * @param {number} baseOpacity peak opacity
 * @param {number} spread lateral half-extent
 * @param {number} depth along-view half-extent
 * @param {number} minSize sprite half-size min
 * @param {number} maxSize sprite half-size max
 * @param {boolean} [additive] additive glow vs normal
 * @param {object} [farLayer] optional deeper/sparser second layer overrides
 */
/* eslint-disable-next-line max-len */
function mote(count, color, drift, twinkle, softness, baseOpacity, spread, depth, minSize, maxSize, additive = true, farLayer = null) {
    return {
        count,
        color,
        drift,
        twinkle,
        softness,
        baseOpacity,
        spread,
        depth,
        minSize,
        maxSize,
        additive,
        farLayer,
    };
}

export class OdysseyCorridorField {
    /**
     * @param {THREE.Scene} scene
     * @param {object} [opts]
     * @param {number} [opts.parallaxStrength] global parallax multiplier (0 disables)
     */
    constructor(scene, opts = {}) {
        this.scene = scene;
        this.parallaxStrength = Number.isFinite(opts.parallaxStrength) ? opts.parallaxStrength : 1;
        // ONE WORLD: chapters whose corridor is a real, continuous landscape rather than a
        // localized set piece with void around it. This system exists to fill that void; where
        // the world already reaches the horizon its sheets are pure overdraw competing with
        // the thing they were invented to hide. Not built at all, so the cost is zero, not low.
        this._suppressedChapters = new Set(
            Array.isArray(opts.suppressedChapters) ? opts.suppressedChapters : [],
        );

        // Scratch (never reallocated per frame).
        this._scratchTangent = new THREE.Vector3();
        this._scratchRight = new THREE.Vector3();
        this._scratchUp = new THREE.Vector3();
        this._worldUp = new THREE.Vector3(0, 1, 0);
        this._scratchOffset = new THREE.Vector3();
        this._camPos = new THREE.Vector3();

        // One shared time uniform ticked each frame for all drift.
        this._uTime = uniform(0);

        // Per-chapter records: { group, layers:[{object, parallax, basePos:Vector3, dir:Vector3}], uniforms:[], range:{start,end} }
        this._chapters = [];
        // Flat list of every disposable {geometry, material}.
        this._disposables = [];

        this.group = new THREE.Group();
        this.group.name = 'odyssey-corridor-field';
        this.group.renderOrder = -9000; // behind hero content, in front of the dome (-10000)
        this.group.frustumCulled = false;

        this._chapterBounds = this._resolveChapterBounds();
        this._build();

        this.scene.add(this.group);
    }

    /**
     * Resolve [startProgress, endProgress] for each chapter from the active path layout.
     * getActiveOdysseyChapterPositions() === [start1..start8, 1].
     * @returns {Array<{start:number, end:number}>}
     */
    _resolveChapterBounds() {
        const positions = getActiveOdysseyChapterPositions();
        const bounds = [];
        for (let i = 0; i < CHAPTER_COUNT; i += 1) {
            const start = Number.isFinite(positions[i]) ? positions[i] : i / CHAPTER_COUNT;
            const end = Number.isFinite(positions[i + 1]) ? positions[i + 1] : (i + 1) / CHAPTER_COUNT;
            bounds.push({ start, end });
        }
        return bounds;
    }

    /**
     * Build depth content for every chapter into the parent group.
     * @private
     */
    _build() {
        const curve = getOdysseyPathCurve();
        for (let id = 1; id <= CHAPTER_COUNT; id += 1) {
            if (this._suppressedChapters.has(id)) continue;
            const record = this._buildChapter(id, curve);
            this._chapters.push(record);
            this.group.add(record.group);
        }
    }

    /**
     * Build one chapter's corridor content, oriented along the local path tangent.
     * @private
     */
    _buildChapter(chapterId, curve) {
        const profile = getChapterProfile(chapterId);
        const range = getChapterPathRange(chapterId);
        const bounds = this._chapterBounds[chapterId - 1];
        const center = range ? range.center.clone() : new THREE.Vector3(0, chapterId * 40, 0);

        // Local frame: tangent (view forward through the chapter), right, up.
        const midT = (bounds.start + bounds.end) * 0.5;
        const tangent = this._safeTangent(curve, midT);
        const right = this._scratchRight.copy(this._worldUp).cross(tangent);
        if (right.lengthSq() < 1e-5) right.set(1, 0, 0);
        right.normalize();
        const up = this._scratchUp.copy(tangent).cross(right).normalize();

        const chapterGroup = new THREE.Group();
        chapterGroup.name = `corridor-chapter-${chapterId}`;
        chapterGroup.frustumCulled = false;

        const layers = [];
        const uniformsList = [];
        const feel = classifyChapter(chapterId);

        const recipe = this._recipeFor(feel, profile);

        // Backdrop SHEETS at staggered depths along the tangent (parallax mid/far body).
        recipe.sheets.forEach((sheetSpec, index) => {
            const depth = SHEET_DEPTHS[Math.min(index, SHEET_DEPTHS.length - 1)];
            const built = createCorridorSheetMaterial({
                ...sheetSpec,
                uTime: this._uTime,
            });
            const size = sheetSpec.size || 520;
            const geometry = new THREE.PlaneGeometry(size, size * (sheetSpec.aspect || 0.62));
            // PERF (QW10): backdrop sheets are BOUNDED set pieces — re-enable frustum
            // culling so off-screen / behind-camera sheets are rejected before they cost
            // a draw + overdraw. A valid bounding sphere is required for the cull test;
            // PlaneGeometry's is local-origin centred (the mesh world matrix transforms it
            // each cull), so computing it once here is sufficient and never goes stale.
            // (Only the camera-follow particulate keeps frustumCulled=false below.)
            geometry.computeBoundingSphere();
            const mesh = new THREE.Mesh(geometry, built.material);
            mesh.frustumCulled = true;

            // Place the sheet behind the chapter centre, facing back down the tangent.
            this._scratchOffset.copy(tangent).multiplyScalar(depth);
            const basePos = center.clone().add(this._scratchOffset);
            basePos.add(this._scratchUp.copy(up).multiplyScalar(sheetSpec.yOffset || 0));
            mesh.position.copy(basePos);
            // Face the sheet toward the corridor (normal along -tangent).
            mesh.lookAt(center);

            chapterGroup.add(mesh);
            layers.push({
                object: mesh,
                // Far layers parallax LESS (anchored), near layers MORE.
                parallax: sheetSpec.parallax ?? (0.06 + index * -0.012),
                basePos,
                tangent: tangent.clone(),
            });
            uniformsList.push(built.uniforms);
            this._disposables.push({ geometry, material: built.material });
        });

        // Volumetric PARTICULATE field hugging the corridor (camera is inside it).
        if (recipe.particulate) {
            const spec = recipe.particulate;
            const geometry = createCorridorParticulateGeometry(spec.count, {
                spread: spec.spread || PARTICULATE_SPREAD,
                depth: spec.depth || PARTICULATE_DEPTH,
                minSize: spec.minSize || 0.6,
                maxSize: spec.maxSize || 2.4,
            });
            const built = createCorridorParticulateMaterial({
                ...spec,
                uTime: this._uTime,
            });
            const mesh = new THREE.Mesh(geometry, built.material);
            mesh.frustumCulled = false;
            mesh.position.copy(center);
            chapterGroup.add(mesh);
            layers.push({
                object: mesh,
                parallax: 0, // the field surrounds the camera; it follows, not parallaxes
                basePos: center.clone(),
                tangent: tangent.clone(),
                follow: true,
                // Wave-2 hook: full instance count so setQualityScale can shrink a suffix
                // of the instanced field via geometry.instanceCount (O(1), no rebuild).
                fullInstanceCount: spec.count,
            });
            uniformsList.push(built.uniforms);
            this._disposables.push({ geometry, material: built.material });

            // Optional second, sparser, deeper starfield layer for cosmic multi-depth.
            if (spec.farLayer) {
                const farGeo = createCorridorParticulateGeometry(spec.farLayer.count, {
                    spread: spec.farLayer.spread || (spec.spread || PARTICULATE_SPREAD) * 2.2,
                    depth: spec.farLayer.depth || (spec.depth || PARTICULATE_DEPTH) * 2.0,
                    minSize: spec.farLayer.minSize || 0.4,
                    maxSize: spec.farLayer.maxSize || 1.1,
                });
                const farBuilt = createCorridorParticulateMaterial({
                    ...spec,
                    ...spec.farLayer,
                    uTime: this._uTime,
                });
                const farMesh = new THREE.Mesh(farGeo, farBuilt.material);
                farMesh.frustumCulled = false;
                farMesh.position.copy(center);
                chapterGroup.add(farMesh);
                layers.push({
                    object: farMesh,
                    parallax: 0,
                    basePos: center.clone(),
                    tangent: tangent.clone(),
                    follow: true,
                    fullInstanceCount: spec.farLayer.count,
                });
                uniformsList.push(farBuilt.uniforms);
                this._disposables.push({ geometry: farGeo, material: farBuilt.material });
            }
        }

        return {
            chapterId,
            group: chapterGroup,
            layers,
            uniforms: uniformsList,
            bounds,
        };
    }

    /**
     * Per-feel depth recipe: sheet specs + a particulate spec, tinted from the chapter
     * palette/atmosphere. Counts capped for 60fps (a few hundred instances + a handful
     * of sheets per chapter).
     * @private
     */
    _recipeFor(feel, profile) {
        const palette = profile.palette || {};
        const atmo = profile.atmosphere || {};
        const primary = palette.primary ?? 0x6a3cff;
        const accent = palette.accent ?? 0x8fb0ff;
        const fog = atmo.fogColor ?? palette.shadow ?? 0x101020;
        const shadow = palette.shadow ?? 0x05060f;

        if (feel === 'cosmic') {
            const blackHole = profile.id === 7;
            // CH6 SHEETS RETIRED (Space overhaul, owner call 2026-08-15): with the baked
            // void dome + sculpted nebula field shipping, chapter 6's two near-fullscreen
            // additive FBM sheets are a redundant wash over an already-authored cosmos —
            // in the composition rig they buried every sculpted silhouette. Ch7 keeps its
            // deep-violet pocket wash (its own look still leans on it); the crisp
            // pinpoint mote starfield stays for both. Restorable for A/B via
            // `?odysseyCh6CorridorSheets=1`.
            const ch6SheetsRestored = (() => {
                if (typeof window === 'undefined') return false;
                try {
                    const v = new URLSearchParams(window.location?.search || '').get('odysseyCh6CorridorSheets');
                    return v === '1' || v === 'true';
                } catch {
                    return false;
                }
            })();
            // POCKETED nebula: low coverage + high contrast so large areas read as deep
            // clear vacuum and the nebula concentrates into a few brighter bands/pockets
            // (vs the old uniform edge-to-edge purple haze). Black Hole keeps a deeper
            // deep-violet pocket wash; Space stays sparser so pinpoint stars dominate.
            //
            // PERF (§3b "fewer-bigger additive layers"): the cosmic nebula reads as ONE
            // additive MASS, so 3 stacked full-size additive FBM sheets are pure overdraw.
            // Trimmed 3 → 2; the dropped third sheet's body is folded into the remaining
            // two (slightly higher opacity + wider coverage on the deep wash) so the field
            // keeps its richness/pocketed look with one fewer near-fullscreen blend.
            /* eslint-disable max-len */
            const cosmicSheets = blackHole
                ? [
                    sheet(primary, shadow, 0.5, 1.4, 0.03, true, 0.5, 700, 0.7, 0, null, { pocket: 1, coverage: 0.44, contrast: 1.8 }),
                    sheet(0x2a0f33, shadow, 0.55, 0.9, 0.015, true, 0.44, 900, 0.55, 0, null, { pocket: 1, coverage: 0.5, contrast: 1.6 }),
                ]
                : (ch6SheetsRestored
                    ? [
                        sheet(primary, shadow, 0.5, 1.5, 0.025, true, 0.4, 700, 0.7, 0, null, { pocket: 1, coverage: 0.3, contrast: 2.6 }),
                        sheet(0x101a3a, shadow, 0.55, 0.85, 0.012, true, 0.26, 900, 0.55, 0, null, { pocket: 1, coverage: 0.36, contrast: 2.2 }),
                    ]
                    : []);
            /* eslint-enable max-len */
            // Black Hole: drifting dust motes + faint lensing haze, deep-violet wash.
            // Space: dense MULTI-DEPTH crisp pinpoint starfield (true-black vacuum stays
            // readable between bright stars — a dense near layer + a sparser deeper layer).
            const cosmicMotes = blackHole
                ? mote(220, 0xcaa6ff, 5.0, 0.15, 1.4, 0.5, 90, 120, 0.8, 3.2)
                : mote(420, 0xeef2ff, 0.9, 0.85, 4.2, 0.95, 115, 160, 0.3, 0.9, true, {
                    count: 320,
                    color: 0xc2cdff,
                    twinkle: 0.7,
                    softness: 3.4,
                    baseOpacity: 0.72,
                    drift: 0.5,
                    spread: 240,
                    depth: 320,
                    minSize: 0.2,
                    maxSize: 0.55,
                });
            return { sheets: cosmicSheets, particulate: cosmicMotes };
        }

        if (feel === 'aerial') {
            // Sky: soft hazy cloud/haze banks in warm-violet hues. No stars (clear vacuum
            // is Space's identity). Give the banks SHAPE + GAPS (moderate coverage +
            // contrast) so they read as layered cloud strata, NOT a flat pale wash that
            // adds to the over-bright sky. Hazy flecks for body, NOT pinpoints.
            //
            // PERF (§3b "fewer-bigger additive layers"): the cloud banks read as one
            // additive MASS, so trim 3 → 2 (one near warm bank + one broad low deck). The
            // dropped mid bank's contribution is folded into the two survivors (a touch
            // more opacity/coverage) to keep the layered-strata feel with one fewer blend.
            /* eslint-disable max-len */
            const aerialSheets = [
                sheet(accent, fog, 0.55, 1.2, 0.05, true, 0.38, 660, 0.5, 18, null, { pocket: 0.85, coverage: 0.46, contrast: 1.6 }),
                sheet(0xb9a6c8, fog, 0.6, 0.85, 0.02, true, 0.26, 900, 0.42, -16, null, { pocket: 0.78, coverage: 0.52, contrast: 1.45 }),
            ];
            /* eslint-enable max-len */
            return {
                sheets: aerialSheets,
                particulate: mote(130, 0xd8c6e8, 4.0, 0.05, 1.2, 0.3, 90, 110, 1.6, 5.0),
            };
        }

        if (feel === 'urban') {
            // Urban finale: distant city-light bokeh (cyan/magenta/amber) + dim far
            // building-silhouette sheets so the encore is never a wire on black.
            return {
                sheets: [
                    sheet(0x00eaff, shadow, 0.5, 2.2, 0.025, true, 0.3, 600, 0.7),
                    // Far building silhouettes (normal blend, dark, just occupy the void).
                    sheet(0x140a1e, 0x0a0a14, 0.75, 3.4, 0.0, false, 0.85, 820, 0.5, -30),
                    sheet(0x1a1230, 0x0a0a14, 0.8, 4.6, 0.0, false, 0.7, 1000, 0.45, -48),
                ],
                particulate: mote(200, 0x66f0ff, 1.5, 0.6, 1.8, 0.7, 100, 130, 0.5, 2.2, true, {
                    count: 120, color: 0xff66c4, twinkle: 0.5, softness: 1.6, baseOpacity: 0.45,
                }),
            };
        }

        // TERRESTRIAL (Earth Core / Deep Ocean / Surface / Mountains): hazed midground
        // silhouette ranges/sheets + a far backdrop tint. Light — chapters own the heroes.
        return this._terrestrialRecipe(profile, accent, fog, shadow);
    }

    /**
     * Per-chapter terrestrial recipes (Earth Core warm magma horizon glow, Ocean teal
     * depth murk, Surface rolling-hill silhouettes, Mountains cloud-sea band + far ridge).
     * @private
     */
    _terrestrialRecipe(profile, accent, fog, shadow) {
        const { id } = profile;
        if (id === 1) {
            // Earth Core: warm magma-horizon glow band + dark rock murk.
            return {
                sheets: [
                    sheet(0xff5a18, shadow, 0.5, 1.3, 0.04, true, 0.34, 600, 0.4, -34),
                    sheet(0x3a0e02, shadow, 0.8, 2.0, 0.0, false, 0.7, 780, 0.5, -40),
                    sheet(fog, shadow, 0.65, 1.0, 0.015, true, 0.22, 920, 0.5),
                ],
                particulate: mote(150, 0xffaa44, 6.0, 0.5, 1.6, 0.45, 85, 110, 0.5, 2.0),
            };
        }
        if (id === 2) {
            // Deep Ocean 🏆 FLAGSHIP REMAKE: kill the flat additive pale-cyan wash so
            // the chapter's own vertical gradient sphere + set pieces (god-rays,
            // leviathan, reef) read again. Two moves:
            //  (1) Re-tint the three backdrop sheets into a VERTICAL DEPTH RAMP — a
            //      brighter teal top sheet (yOffset +30), a mid teal band, and a near-
            //      black indigo abyss floor (yOffset -40) — instead of a flat teal wash.
            //  (2) Replace the bright pale additive follow particulate (0x9fe8ff op 0.4)
            //      with DIM DEEP MARINE SNOW: a near drift layer (0x2a5a72, op ~0.18,
            //      smaller maxSize, low twinkle) + a sparse deeper farLayer so the camera
            //      drifts through quiet particulate, not a luminous cyan fog.
            /* eslint-disable max-len */
            return {
                sheets: [
                    sheet(0x1a7d96, shadow, 0.55, 1.2, 0.02, true, 0.26, 640, 0.6, 30),
                    sheet(0x0a3a52, fog, 0.5, 1.8, -0.025, true, 0.18, 780, 0.55, 0),
                    sheet(0x03101f, shadow, 0.9, 0.8, 0.01, false, 0.6, 940, 0.5, -40),
                ],
                particulate: mote(130, 0x2a5a72, 4.0, 0.12, 1.6, 0.18, 90, 115, 0.4, 1.4, true, {
                    count: 70,
                    color: 0x16384a,
                    twinkle: 0.08,
                    softness: 1.8,
                    baseOpacity: 0.12,
                    drift: 2.5,
                    spread: 200,
                    depth: 260,
                    minSize: 0.3,
                    maxSize: 1.0,
                }),
            };
            /* eslint-enable max-len */
        }
        if (id === 3) {
            // Surface World: rolling-hill silhouettes + soft sky-haze backdrop.
            return {
                sheets: [
                    sheet(0xaec8e0, fog, 0.5, 1.0, 0.03, true, 0.3, 700, 0.45, 24),
                    sheet(0x1d4a22, 0x0e2412, 0.85, 2.6, 0.0, false, 0.7, 860, 0.38, -38),
                    sheet(0x2a5a30, 0x122814, 0.8, 3.6, 0.0, false, 0.55, 1020, 0.34, -56),
                ],
                particulate: mote(110, 0xfff2c0, 4.5, 0.1, 1.3, 0.28, 85, 105, 0.8, 3.0),
            };
        }
        // id === 4 — Mountains: cloud-sea band BELOW + far ridge silhouettes.
        // (A5 owns the mountain hero; this is only hazed far depth.)
        return {
            sheets: [
                sheet(0xdfe8f2, fog, 0.7, 1.0, 0.025, true, 0.34, 760, 0.36, -30),
                sheet(0x4a5e76, 0x1c2a3a, 0.85, 2.8, 0.0, false, 0.6, 900, 0.4, -10),
                sheet(accent, fog, 0.4, 1.6, 0.02, true, 0.2, 820, 0.5, 30),
            ],
            particulate: mote(120, 0xd6e6ff, 5.5, 0.08, 1.4, 0.3, 90, 115, 1.0, 3.6),
        };
    }

    /**
     * Stable tangent at progress t (handles the degenerate-tangent edge).
     * @private
     */
    _safeTangent(curve, t) {
        const clamped = THREE.MathUtils.clamp(t, 0, 1);
        let tangent;
        try {
            tangent = curve.getTangentAt(clamped, this._scratchTangent);
        } catch {
            tangent = null;
        }
        if (!tangent || tangent.lengthSq() < 1e-6) {
            // Fall back to the centre-to-next direction.
            const a = getOdysseyPathPointAt(clamped);
            const b = getOdysseyPathPointAt(Math.min(1, clamped + 0.01));
            this._scratchTangent.copy(b).sub(a);
            if (this._scratchTangent.lengthSq() < 1e-6) this._scratchTangent.set(0, 0, -1);
            return this._scratchTangent.normalize();
        }
        return this._scratchTangent.normalize();
    }

    /**
     * Compute a chapter's visibility weight (0..1) from the active progress vs its
     * bounds, with a smoothstep fade-in/out across the seam overlap so only active +
     * adjacent chapters' depth shows (cross-fades at seams).
     *
     * B7 — the cross-fade window is widened ASYMMETRICALLY per boundary by SEAM_CARRY so
     * the seam's carried element lives in the corridor field ACROSS the boundary:
     *   • fade-IN at `start`  is governed by the incoming boundary (chapterId-1)->chapterId
     *   • fade-OUT at `end`   is governed by the outgoing boundary chapterId->(chapterId+1)
     * @private
     * @param {{start:number, end:number}} bounds
     * @param {number} progress
     * @param {number} chapterId 1-based chapter id (for the per-boundary carry lookup)
     */
    _visibilityWeight(bounds, progress, chapterId) {
        const { start, end } = bounds;
        // Incoming side: the carry authored for the boundary (chapterId-1)->chapterId tells
        // how early THIS chapter's content should appear (its inExtra).
        const inCarry = SEAM_CARRY[chapterId - 1]?.inExtra ?? 0;
        // Outgoing side: the carry for chapterId->(chapterId+1) tells how long THIS chapter's
        // content should linger past the boundary (its outExtra).
        const outCarry = SEAM_CARRY[chapterId]?.outExtra ?? 0;
        const inOverlap = SEAM_OVERLAP + inCarry;
        const outOverlap = SEAM_OVERLAP + outCarry;
        const fadeIn = THREE.MathUtils.smoothstep(progress, start - inOverlap, start + inOverlap);
        const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, end - outOverlap, end + outOverlap);
        return THREE.MathUtils.clamp(Math.min(fadeIn, fadeOut), 0, 1);
    }

    /**
     * Drive parallax + cross-fade + drift. Safe to call with a null camera.
     * @param {THREE.Camera} camera
     * @param {number} progress active path progress (0..1)
     * @param {number} deltaTime seconds since last frame
     */
    update(camera, progress = 0, deltaTime = 0) {
        this._uTime.value += deltaTime;

        if (camera) this._camPos.copy(camera.position);

        for (let i = 0; i < this._chapters.length; i += 1) {
            const record = this._chapters[i];
            const weight = this._visibilityWeight(record.bounds, progress, record.chapterId);

            // Skip hidden chapters entirely (cheap; no per-layer work when invisible).
            const visible = weight > 0.001;
            record.group.visible = visible;
            if (!visible) continue;

            // Fade every layer's opacity by the chapter weight.
            for (let u = 0; u < record.uniforms.length; u += 1) {
                const un = record.uniforms[u];
                if (un && un.uOpacity) un.uOpacity.value = weight;
            }

            if (!camera || this.parallaxStrength === 0) continue;

            // Parallax: shift each layer along the camera-to-layer offset projected on
            // the layer tangent. Nearer (higher parallax) layers move more. Particulate
            // fields (follow=true) ride with the camera so the camera stays inside them.
            for (let l = 0; l < record.layers.length; l += 1) {
                const layer = record.layers[l];
                if (layer.follow) {
                    // Re-centre the surrounding field on the camera (keep camera inside).
                    layer.object.position.copy(this._camPos);
                    continue;
                }
                const amount = layer.parallax * this.parallaxStrength;
                if (amount === 0) {
                    layer.object.position.copy(layer.basePos);
                    continue;
                }
                // Offset opposite to the camera's lateral motion for a parallax sense.
                this._scratchOffset.copy(this._camPos).sub(layer.basePos).multiplyScalar(amount);
                layer.object.position.copy(layer.basePos).add(this._scratchOffset);
            }
        }
    }

    /**
     * Wave-2 adaptive-quality hook (§4.3): live-scale the particulate density without
     * reallocating buffers. Shrinks a *suffix* of each instanced follow-field via
     * `geometry.instanceCount` (O(1) — the motes are deterministically distributed, so a
     * prefix is a valid subset), leaving the parallax sheets and the chapter cross-fade
     * untouched so the look degrades gracefully. `scale >= 1` is a no-op (full density).
     * Safe to call before/after build; clamps to [0, 1].
     * @param {number} scale 0..1 density multiplier
     */
    setQualityScale(scale) {
        const s = THREE.MathUtils.clamp(Number.isFinite(scale) ? scale : 1, 0, 1);
        this._qualityScale = s;
        for (let i = 0; i < this._chapters.length; i += 1) {
            const { layers } = this._chapters[i];
            for (let l = 0; l < layers.length; l += 1) {
                const layer = layers[l];
                if (!layer.follow || !Number.isFinite(layer.fullInstanceCount)) continue;
                const geo = layer.object.geometry;
                if (!geo) continue;
                geo.instanceCount = Math.max(1, Math.round(layer.fullInstanceCount * s));
            }
        }
    }

    dispose() {
        if (this.group) {
            this.scene.remove(this.group);
        }
        this._disposables.forEach(({ geometry, material }) => {
            geometry?.dispose?.();
            material?.dispose?.();
        });
        this._disposables.length = 0;
        this._chapters.length = 0;
        this.group = null;
    }
}

export default OdysseyCorridorField;
