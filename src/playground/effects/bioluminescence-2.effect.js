/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies, camelcase */
/**
 * Bioluminescence II — "Glowing Cavern Reef"
 * ─────────────────────────────────────────────────────────────────────────────
 * A vast, layered, richly-populated low-poly bioluminescent cavern, translated
 * from artifacts/bioluminescence-2/bioluminescence-2-reference.png.
 *
 * Composition (foreground → distance):
 *   • thick clustered FACETED ROCK MASSES (not flat triangle planes): foreground
 *     cave silhouettes, river-bank rock, midground floating islands + terraced
 *     platforms, distant cliff shelves, tall canyon walls, ceiling overhangs +
 *     stalactites — multiple height levels and overlapping layers for depth.
 *   • a WINDING GLOWING RIVER leading into the misty distance, with thin cyan
 *     waterfalls / light-streams spilling off island edges.
 *   • a redesigned HERO TREE (thick organic trunk, splayed root base, dense small
 *     glowing branches, readable silhouette) on a RAISED rock island, right of
 *     centre, against a darker wall so it reads.
 *   • DENSE instanced bioluminescent detail: purple/cyan/magenta mushroom
 *     clusters, faceted crystal formations, glowing grass, hanging vines/roots,
 *     drifting spores + tiny twinkling sparkles — all with per-instance scale,
 *     rotation and colour variation so nothing looks repeated.
 *   • lighting = MANY small local emissive sources (not one central blob), deep
 *     dark-blue shadows, purple/cyan fresnel rims, strong atmospheric fog/depth.
 *
 * Authored playground-first (screenshot-verified), mounted by the thin BaseTheme
 * wrapper at src/themes/bioluminescence-2/bioluminescence-2-theme.js.
 *
 * RENDER / GLOW STRATEGY (load-bearing): real post-process bloom via a NON-MRT
 * thresholded bloom on the composited scene `output` (NOT emissive-MRT — that path
 * has a documented regression in this WebGPU pipeline). The cavern is dark, so a
 * moderate threshold blooms only the bright local emitters. emissiveNode is still
 * set everywhere (bloom-friendly / MRT-ready behind ?mrt).
 *
 * Aesthetic: unlit MeshBasicNodeMaterial + flat face-normal shading (faceted
 * low-poly) + emissive glow + fresnel rim — the project's WebGPU theme standard.
 *
 * ⚠️ One small effect per session when capturing — heavy WebGPU reloads can TDR
 * the dev iGPU. Counts are modest; scale via ?spores= / ?density= / ?nobloom.
 */
import * as THREE from 'three/webgpu';
import {
    float, vec2, vec3, vec4, uniform, attribute, instanceIndex, uv,
    mix, clamp, sin, cos, pow, max, dot, cross, normalize, smoothstep,
    fract, atan, length, dFdx, dFdy, positionGeometry, positionLocal, positionWorld,
    cameraPosition, mx_noise_float, texture, pass, mrt, output, emissive, viewportUV,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeBloomNodeDeep } from '../../themes/shared/bloom-dispose.js';
import caveTreeUrl from '../../themes/bioluminescence-2/assets/cave_tree.glb?url';
import caveRocksUrl from '../../themes/bioluminescence-2/assets/cave_rocks.glb?url';
import { withEmissiveMaterialBlending } from '../../themes/shared/mrt-blend.js';

export const meta = {
    id: 'bioluminescence-2',
    title: 'Bioluminescence II — Glowing Cavern Reef',
    description: 'Vast layered low-poly bioluminescent cavern: rooted glowing tree, winding river, dense reef flora, faceted rock masses.',
};

// ── palette ──────────────────────────────────────────────────────────────────
// Deep dark-blue cavern with violet-tinted rock, cyan/teal glow, and hot
// violet/magenta foreground accents. Deliberately dark base → local glows pop.
const PAL = {
    voidDeep: 0x03060f,
    voidMid: 0x070d22,
    caveBlue: 0x0e2244,
    rockDark: 0x070f22,
    rockBlue: 0x0c1a34,
    rockViolet: 0x130f30,
    rimCyan: 0x2f8fc0,
    rimViolet: 0x6a4fd0,
    hazeFar: 0x163457,
    hazeMid: 0x122c52,
    hazeWell: 0x2e6aa8,
    teal: 0x2fd6d8,
    cyan: 0x46e6ff,
    aqua: 0x39c8e8,
    treeCore: 0xa6ecff,
    treeGlow: 0x39d8ff,
    treeWarm: 0x6fd6ff,
    river: 0x32cfe6,
    riverDeep: 0x0a2740,
    grass: 0x46e0b0,
    violet: 0x7b54f0,
    purple: 0x6a3df0,
    magenta: 0xd040c0,
    magentaHot: 0xe85ad0,
    crystalBlue: 0x4f7cff,
    crystalCyan: 0x49d8ff,
    crystalViolet: 0x9a6cff,
    sporeCol: 0x9fe8ff,
};

// curated flora colour sets, used for per-instance colour variation
const FLORA_COOL = [PAL.cyan, PAL.teal, PAL.aqua, PAL.crystalCyan, PAL.grass];
const FLORA_HOT = [PAL.magenta, PAL.magentaHot, PAL.violet, PAL.purple, PAL.crystalViolet];
const FLORA_MIX = [PAL.cyan, PAL.teal, PAL.violet, PAL.magenta, PAL.purple, PAL.aqua];
// pure magenta/violet set for the lower-left SECONDARY focal cluster
const FLORA_MAGENTA = [PAL.magenta, PAL.magentaHot, PAL.magenta, PAL.magentaHot, PAL.violet];

export function create({
    THREE: T = THREE, scene, camera, renderer, params,
}) {
    const P = params || new URLSearchParams('');
    const DENSITY = Math.max(0.25, parseFloat(P.get('density')) || 1.0);
    const disposables = [];
    const objects = [];
    const glowBillboards = [];
    const track = (o) => { disposables.push(o); return o; };
    const add = (o) => { scene.add(o); objects.push(o); return o; };

    const colorParts = (hex) => { const c = new T.Color(hex); return [c.r, c.g, c.b]; };
    const cv = (hex) => { const [r, g, b] = colorParts(hex); return vec3(r, g, b); };
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // Tight establishing FOV: closer to the reference, with more rock/floor weight.
    camera.fov = 47;
    camera.near = 0.1;
    camera.far = 20000;
    camera.updateProjectionMatrix();

    // ── uniforms ────────────────────────────────────────────────────────────
    const uTime = uniform(0);
    const uEnergy = uniform(0);
    const uPulse = uniform(0);
    const uAccent = uniform(new T.Vector3(0.27, 0.84, 1.0));

    // ── shared shading helpers (unlit, full art control) ──────────────────────
    const faceN = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));

    // Strong aerial-perspective fog so the cavern reads as VAST and deep.
    const FOG_NEAR = 34.0;
    const FOG_FAR = 310.0;
    const FOG_MAX = 0.88;
    const haze = cv(PAL.hazeMid);

    const getFogFactor = () => {
        const d = length(positionWorld.sub(cameraPosition));
        const dn = max(d.sub(FOG_NEAR), float(0.0));
        const fd = clamp(float(1.0).sub(pow(float(2.718), dn.mul(-3.0 / (FOG_FAR - FOG_NEAR)))), 0.0, FOG_MAX);
        const fh = smoothstep(6.0, -10.0, positionWorld.y).mul(0.18);
        return clamp(fd.add(fh), 0.0, FOG_MAX);
    };

    const distFog = (colNode, f) => mix(colNode, haze, f);

    // Dark faceted rock with deep-blue body + a purple/cyan fresnel rim. emissive
    // stays ~0 so rock never blooms — only the flora/river/tree glow does.
    const rockMat = (baseHex, {
        rimHex = PAL.rimCyan, rim2Hex = PAL.rimViolet, rimPow = 2.4, rimStr = 0.5, lift = 0.0,
    } = {}) => {
        const mat = track(new T.MeshBasicNodeMaterial());
        const V = normalize(cameraPosition.sub(positionWorld));
        const up = max(dot(faceN, vec3(0, 1, 0)), float(0.0)).mul(0.85).add(0.15); // Higher contrast flat shading
        const fres = pow(clamp(float(1.0).sub(dot(faceN, V)), 0.0, 1.0), float(rimPow));
        // base darkens toward the bottom; faint violet ambient bounce
        let col = cv(baseHex).mul(up.mul(0.42).add(0.08).add(lift));
        col = col.add(cv(PAL.rockViolet).mul(0.055));
        // rim shifts violet→cyan with height (lower=violet, higher=cyan)
        const rimCol = mix(cv(rim2Hex), cv(rimHex), clamp(up, 0.0, 1.0));
        col = col.add(rimCol.mul(fres).mul(rimStr));
        const f = getFogFactor();
        mat.colorNode = distFog(col, f);
        mat.emissiveNode = vec3(0.0);
        mat.side = T.DoubleSide;
        return mat;
    };

    // Per-INSTANCE coloured flora material — reads aColor / aPhase / aGlow(mask)
    // instanced attributes so a single InstancedMesh shows colour + pulse variety.
    // Optional height-masked vertex sway for grass/vines.
    const floraMat = ({
        pulseSpeed = 0.8, emiBase = 0.9, emiPulse = 0.4, rimStr = 0.9, rimPow = 2.0,
        energyBoost = 1.1, sway = 0.0, height = 1.0,
    } = {}) => {
        const mat = track(new T.MeshBasicNodeMaterial());
        const glow = attribute('aColor', 'vec3');
        const phase = attribute('aPhase', 'float');
        const mask = attribute('aGlow', 'float'); // 0..1 glow mask (cap / tip gradient)
        const V = normalize(cameraPosition.sub(positionWorld));
        const fres = pow(clamp(float(1.0).sub(dot(faceN, V)), 0.0, 1.0), float(rimPow));
        const breathe = sin(uTime.mul(pulseSpeed).add(phase.mul(6.2831))).mul(0.5).add(0.5);
        const strength = float(emiBase).add(breathe.mul(emiPulse)).add(uEnergy.mul(energyBoost))
            .add(uPulse.mul(0.4))
            .mul(mask);
        const base = glow.mul(0.12);
        const emi = glow.mul(strength).add(glow.mul(fres.mul(rimStr).mul(mask)));
        const col = mix(base, glow, clamp(strength.mul(0.4).add(fres.mul(0.4)), 0.0, 1.0).mul(mask.mul(0.85).add(0.15)));
        const f = getFogFactor();
        mat.colorNode = distFog(col, f);
        mat.emissiveNode = emi.mul(float(1.0).sub(f)); // Apply fog to emissive!
        mat.side = T.DoubleSide;
        if (sway > 0) {
            const yN = clamp(positionGeometry.y.div(height), 0.0, 1.0);
            const bend = sin(uTime.mul(1.05).add(phase.mul(6.2831))).mul(sway).mul(yN.mul(yN));
            const bend2 = sin(uTime.mul(0.43).add(phase.mul(11.0))).mul(sway * 0.5).mul(yN);
            mat.positionNode = positionLocal.add(vec3(bend.add(bend2), float(0.0), bend.mul(0.4)));
        }
        return mat;
    };

    // Camera-facing additive glow billboard (soft local halo). Many small ones,
    // not one big central blob.
    const makeGlow = (x, y, z, radius, hex, strength, pulseSpeed = 0.7, phase = 0.0) => {
        const mat = track(new T.MeshBasicNodeMaterial());
        const d = uv().sub(0.5).length().mul(2.0);
        const fall = pow(clamp(float(1.0).sub(d), 0.0, 1.0), float(2.4));
        const breathe = sin(uTime.mul(pulseSpeed).add(phase)).mul(0.12).add(0.9);
        mat.colorNode = cv(hex);
        mat.opacityNode = fall.mul(strength).mul(breathe).mul(float(1.0).add(uEnergy.mul(0.6)));
        mat.transparent = true;
        mat.depthWrite = false;
        mat.blending = T.AdditiveBlending;
        mat.toneMapped = false;
        mat.fog = false;
        const geo = track(new T.PlaneGeometry(radius * 2, radius * 2));
        const mesh = new T.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.frustumCulled = false;
        add(mesh);
        glowBillboards.push(mesh);
        return mesh;
    };

    const makeContactShadow = (x, y, z, w, h, rotY = 0, opacity = 0.32) => {
        const mat = track(new T.MeshBasicNodeMaterial());
        const p = uv().sub(0.5).mul(vec2(1.0, w / h));
        const fall = pow(clamp(float(1.0).sub(length(p).mul(2.0)), 0.0, 1.0), float(2.0));
        mat.colorNode = cv(0x01030a);
        mat.opacityNode = fall.mul(opacity);
        mat.transparent = true;
        mat.depthWrite = false;
        mat.side = T.DoubleSide;
        mat.fog = false;
        const geo = track(new T.PlaneGeometry(w, h));
        geo.rotateX(-Math.PI / 2);
        const mesh = add(new T.Mesh(geo, mat));
        mesh.position.set(x, y, z);
        mesh.rotation.y = rotY;
        mesh.frustumCulled = false;
        return mesh;
    };

    // ── geometry helpers ──────────────────────────────────────────────────────
    // Normalize a piece to position-only, non-indexed → safe mergeGeometries
    // (CylinderGeometry indexed, Icosa/Octa non-indexed; mixing → null).
    const stripPos = (g) => {
        g.deleteAttribute('uv');
        g.deleteAttribute('normal');
        const ni = g.index ? g.toNonIndexed() : g;
        if (ni !== g) g.dispose();
        return ni;
    };
    // Bake a constant glow mask (aGlow) on a flora piece.
    const bakeGlow = (g, val) => {
        const c = g.getAttribute('position').count;
        const a = new Float32Array(c).fill(val);
        g.setAttribute('aGlow', new T.Float32BufferAttribute(a, 1));
        return g;
    };
    // Bake a vertical gradient glow mask (tips bright).
    const bakeGradient = (g, lo = 0.25, hi = 1.0) => {
        const pa = g.getAttribute('position');
        g.computeBoundingBox();
        const yMin = g.boundingBox.min.y;
        const yMax = g.boundingBox.max.y;
        const span = (yMax - yMin) || 1;
        const a = new Float32Array(pa.count);
        for (let i = 0; i < pa.count; i++) {
            const f = (pa.getY(i) - yMin) / span;
            a[i] = lo + (hi - lo) * f;
        }
        g.setAttribute('aGlow', new T.Float32BufferAttribute(a, 1));
        return g;
    };
    const mergeFlora = (parts) => {
        const norm = parts.map(stripPos);
        const merged = mergeGeometries(norm, false);
        norm.forEach((n) => n.dispose());
        if (!merged) throw new Error('[bioluminescence-2] flora merge returned null');
        return track(merged);
    };

    // Rock placements are DEFERRED: addRockMass() queues a transform + an empty
    // Group (added immediately so call-sites get a valid ref), then the async
    // cave_rocks.glb loader (Blender-sculpted fBM rock + PolyHaven cliff_side PBR)
    // fills each group with a real rock-variant mesh. Same signature as before, so
    // every wall/cliff/island/ledge call-site is unchanged.
    const rockQueue = [];
    const addRockMass = (x, y, z, opts = {}, matOpts = {}) => {
        const g = new T.Group();
        g.position.set(x, y, z);
        if (opts.rotX) g.rotation.x = opts.rotX;
        if (opts.rotY) g.rotation.y = opts.rotY;
        if (opts.rotZ) g.rotation.z = opts.rotZ;
        if (opts.scale) g.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
        g.frustumCulled = false;
        add(g);
        rockQueue.push({ group: g, opts, matOpts });
        return g;
    };
    const addRockCluster = (items, matDefaults = {}) => {
        items.forEach((item, i) => {
            const [
                x, y, z, baseR, scale, rotY, seed,
                role = 'slab', variant = role === 'wall' ? null : 1,
                tint = PAL.rockDark, rim = PAL.rimCyan,
            ] = item;
            addRockMass(x, y, z, {
                role,
                variant,
                baseR,
                seed,
                scale,
                rotY,
                baseHex: tint,
            }, {
                tintHex: tint,
                rimHex: rim,
                rimStr: 0.22,
                rimPow: 2.8,
                brightness: 0.72,
                detailGain: 0.58,
                ...matDefaults,
            });
        });
    };

    // ═══ BACKDROP DOME — dim gradient + a SOFT (not blown) distant haze-well ═══════
    {
        const skyMat = track(new T.MeshBasicNodeMaterial());
        const dir = normalize(positionLocal);
        const { y } = dir;
        let col = mix(cv(PAL.voidDeep), cv(PAL.caveBlue), smoothstep(-0.5, 0.08, y));
        col = mix(col, cv(PAL.voidMid), smoothstep(0.2, 0.66, y));
        const toWell = dot(dir, vec3(0.0, 0.0, -1.0));
        const well = pow(clamp(toWell, 0.0, 1.0), float(7.0));
        const wellSoft = pow(clamp(toWell, 0.0, 1.0), float(2.4)).mul(0.4);
        col = mix(col, cv(PAL.hazeWell), well.mul(0.6).add(wellSoft.mul(0.7)));
        const ang = atan(dir.x, dir.z.negate());
        const spire = pow(max(sin(ang.mul(11.0)).mul(sin(ang.mul(27.0).add(1.7))), float(0.0)), float(3.0));
        const spireMask = smoothstep(0.14, -0.05, y).mul(smoothstep(-0.3, 0.06, y)).mul(well.add(0.2));
        col = mix(col, cv(PAL.voidMid), spire.mul(spireMask).mul(0.55));
        skyMat.colorNode = clamp(col, 0.0, 2.0);
        skyMat.emissiveNode = cv(PAL.hazeWell).mul(well.mul(0.4).add(wellSoft.mul(0.28)));
        skyMat.side = T.BackSide;
        skyMat.depthWrite = false;
        skyMat.fog = false;
        skyMat.toneMapped = false;
        const dome = add(new T.Mesh(track(new T.SphereGeometry(5000, 48, 32)), skyMat));
        dome.frustumCulled = false;
    }

    // ═══ VOLUMETRIC HAZE — thin layered depth planes (subtle, not a central blob) ══
    {
        const hazeSpecs = [
            {
                x: 0, y: 16, z: -175, s: 380, hex: PAL.hazeFar, o: 0.12, sp: 0.04,
            },
            {
                x: 0, y: 10, z: -145, s: 220, hex: PAL.hazeWell, o: 0.15, sp: 0.04,
            },
            {
                x: 4, y: 12, z: -110, s: 240, hex: PAL.hazeMid, o: 0.11, sp: 0.06,
            },
            {
                x: -10, y: 8, z: -78, s: 180, hex: PAL.hazeMid, o: 0.08, sp: 0.06,
            },
        ];
        for (const h of hazeSpecs) {
            const mat = track(new T.MeshBasicNodeMaterial());
            const p = uv().sub(0.5);
            const r = length(p.mul(vec2(1.0, 1.4)));
            const soft = pow(clamp(float(1.0).sub(r.mul(1.7)), 0.0, 1.0), float(2.0));
            const shafts = sin(p.x.mul(40.0).add(uTime.mul(h.sp))).mul(0.5).add(0.5).mul(0.4)
                .add(0.6);
            mat.colorNode = cv(h.hex);
            mat.opacityNode = soft.mul(shafts).mul(h.o);
            mat.transparent = true;
            mat.depthWrite = false;
            mat.blending = T.AdditiveBlending;
            mat.toneMapped = false;
            mat.fog = false;
            const m = add(new T.Mesh(track(new T.PlaneGeometry(h.s, h.s * 0.7)), mat));
            m.position.set(h.x, h.y, h.z);
            m.frustumCulled = false;
            glowBillboards.push(m);
        }
    }

    // ═══ WINDING GLOWING RIVER — leads the eye into the misty distance ════════════
    const riverCurve = new T.CatmullRomCurve3([
        new T.Vector3(0, -8.2, 50),
        new T.Vector3(-2, -8.15, 18),
        new T.Vector3(4, -8.05, -18),
        new T.Vector3(-3, -8.0, -58),
        new T.Vector3(2, -8.05, -104),
        new T.Vector3(-1, -8.15, -158),
        new T.Vector3(1, -8.25, -224),
    ], false, 'catmullrom', 0.5);
    const riverSamples = Array.from({ length: 56 }, (_, i) => riverCurve.getPointAt(i / 55));
    const riverHalfWidth = (t) => Math.max(1.25, 4.7 - t * 3.15); // close ravine mouth, pinched distance
    {
        const SEG = 120;
        const verts = [];
        const uvs = [];
        const idx = [];
        const up = new T.Vector3(0, 1, 0);
        const sideV = new T.Vector3();
        const tan = new T.Vector3();
        for (let i = 0; i <= SEG; i++) {
            const t = i / SEG;
            const p = riverCurve.getPointAt(t);
            riverCurve.getTangentAt(t, tan); tan.y = 0; tan.normalize();
            sideV.crossVectors(up, tan).normalize();
            const hw = riverHalfWidth(t);
            verts.push(p.x + sideV.x * hw, p.y, p.z + sideV.z * hw);
            verts.push(p.x - sideV.x * hw, p.y, p.z - sideV.z * hw);
            uvs.push(0, t * 26, 1, t * 26);
        }
        for (let i = 0; i < SEG; i++) {
            const a = i * 2; const b = i * 2 + 1; const c = (i + 1) * 2; const d = (i + 1) * 2 + 1;
            idx.push(a, c, b, b, c, d);
        }
        const geo = track(new T.BufferGeometry());
        geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
        geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
        geo.setIndex(idx);
        const mat = track(new T.MeshBasicNodeMaterial());
        const u = uv();
        const N = vec3(0, 1, 0);
        const V = normalize(cameraPosition.sub(positionWorld));
        const fres = pow(clamp(float(1.0).sub(dot(N, V)), 0.0, 1.0), float(3.0));
        const flow = mx_noise_float(vec3(u.x.mul(3.0), u.y.mul(0.6).sub(uTime.mul(0.5)), 0.0)).mul(0.5).add(0.5);
        const flow2 = mx_noise_float(vec3(u.x.mul(7.0).add(3.0), u.y.mul(1.2).sub(uTime.mul(0.9)), 1.0)).mul(0.5).add(0.5);
        const ripple = flow.mul(0.6).add(flow2.mul(0.4));
        const channel = smoothstep(0.0, 0.46, u.x).mul(smoothstep(1.0, 0.54, u.x)); // glow concentrates mid-channel
        const rimDark = float(1.0).sub(channel).mul(0.74);
        const glow = ripple.mul(0.5).add(0.28).mul(channel.mul(0.82).add(0.12));
        let col = mix(cv(0x031224), cv(PAL.river), glow.mul(0.34));
        col = mix(col, cv(PAL.voidDeep), rimDark.mul(0.45));
        col = col.add(cv(PAL.cyan).mul(fres).mul(0.065).mul(channel));
        const f = getFogFactor();
        mat.colorNode = distFog(col, f);
        const glint = pow(ripple, float(8.0)).mul(channel);
        // kept VERY SUBTLE — the reference floor is misty/dark, not a glowing highway
        const emi = cv(PAL.river).mul(glow.mul(0.028)).add(cv(0xcffbff).mul(glint).mul(0.048));
        mat.emissiveNode = emi.mul(float(1.0).sub(f));
        mat.side = T.DoubleSide;
        const river = add(new T.Mesh(geo, mat));
        river.frustumCulled = false;
    }

    // ═══ REFLECTIVE SHALLOW POOL — faked mirror of the haze-well glow at the base ══
    // A flat plane catching an inverted glowing smear (grazing sheen × depth-band ×
    // ripple), grounding the bottom-centre exactly like the reference's water pool.
    {
        const geo = track(new T.PlaneGeometry(56, 142, 1, 1));
        geo.rotateX(-Math.PI / 2);
        const mat = track(new T.MeshBasicNodeMaterial());
        const pw = positionWorld;
        const V = normalize(cameraPosition.sub(pw));
        const graze = pow(clamp(float(1.0).sub(V.y), 0.0, 1.0), float(2.5)); // grazing-angle sheen
        const ripple = mx_noise_float(vec3(pw.x.mul(0.05), pw.z.mul(0.05).add(uTime.mul(0.15)), 0.0)).mul(0.5).add(0.5);
        const depthBand = smoothstep(40.0, -120.0, pw.z); // brighter toward the haze-well
        const sideMask = smoothstep(-24.0, -5.0, pw.x).mul(smoothstep(24.0, 5.0, pw.x));
        const sheen = graze.mul(ripple.mul(0.42).add(0.45)).mul(depthBand).mul(sideMask);
        mat.colorNode = mix(cv(0x061126), cv(PAL.hazeWell), sheen.mul(0.42));
        mat.emissiveNode = cv(PAL.cyan).mul(sheen.mul(0.18));
        mat.opacityNode = sheen.mul(0.28).add(0.035);
        mat.transparent = true;
        mat.depthWrite = false;
        mat.side = T.DoubleSide;
        mat.fog = false;
        const poolM = add(new T.Mesh(geo, mat));
        poolM.position.set(0, -8.35, -46);
        poolM.frustumCulled = false;
    }

    // ═══ CAVERN FLOOR — dark faceted bed beneath the river (deep shadow) ══════════
    {
        const geo = track(new T.PlaneGeometry(1000, 1000, 46, 46));
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i); const yy = pos.getY(i);
            const worldZ = -yy;
            let minD = 9999;
            for (let j = 0; j < riverSamples.length; j++) {
                const rp = riverSamples[j];
                const d = Math.hypot(x - rp.x, worldZ - rp.z);
                if (d < minD) minD = d;
            }
            const trench = Math.max(0, 1 - minD / 13);
            const bank = Math.max(0, 1 - Math.abs(minD - 10) / 10);
            const h = Math.sin(x * 0.03) * Math.cos(yy * 0.026) * 2.4
                + Math.sin(x * 0.08 + 1.3) * 1.1
                - trench * 2.1
                + bank * 2.9;
            pos.setZ(i, h);
        }
        geo.computeVertexNormals();
        geo.rotateX(-Math.PI / 2);
        const floor = add(new T.Mesh(geo, rockMat(PAL.rockDark, { rimStr: 0.22, rimPow: 3.5 })));
        floor.position.y = -9.5;
        floor.frustumCulled = false;
    }

    // ═══ REFERENCE ROCK ARCHITECTURE — real GLB clusters, no floating flat planes ═══
    {
        addRockCluster([
            [-78, 57, -48, 20, [1.18, 0.7, 0.78], -0.34, 1201, 'ceiling', 2, PAL.rockDark, PAL.rimViolet],
            [-52, 59, -64, 22, [1.34, 0.62, 0.88], -0.1, 1202, 'ceiling', 0, PAL.rockDark, PAL.rimViolet],
            [-26, 61, -96, 16, [0.92, 0.54, 0.66], 0.18, 1203, 'ceiling', 2, PAL.rockDark, PAL.rimCyan],
            [48, 62, -96, 18, [0.96, 0.54, 0.68], 0.2, 1204, 'ceiling', 2, PAL.rockDark, PAL.rimCyan],
            [76, 57, -66, 21, [1.24, 0.66, 0.8], -0.26, 1205, 'ceiling', 0, PAL.rockDark, PAL.rimCyan],
        ], { brightness: 0.56, rimStr: 0.18, detailGain: 0.45 });

        addRockCluster([
            [-56, 7.4, -70, 10, [0.98, 0.5, 0.72], 0.24, 1210, 'slab', 1, PAL.rockBlue, PAL.rimViolet],
            [-43, 5.3, -72, 13, [1.16, 0.48, 0.86], 0.18, 1211, 'slab', 1, PAL.rockBlue, PAL.rimViolet],
            [-31, 5.0, -76, 9, [0.8, 0.64, 0.72], -0.12, 1212, 'foreground', 3, PAL.rockViolet, PAL.rimViolet],
            [-45, -5.2, -74, 11, [0.82, 1.18, 0.9], 0.18, 1213, 'wall', null, PAL.rockDark, PAL.rimViolet],
            [-49, 0.4, -67, 8, [0.76, 0.82, 0.72], -0.26, 1214, 'foreground', 4, PAL.rockDark, PAL.rimViolet],
        ], { brightness: 0.76, rimStr: 0.36, detailGain: 0.62 });

        addRockCluster([
            [25, 1.6, -85, 9, [0.92, 0.5, 0.72], -0.22, 1220, 'slab', 1, PAL.rockBlue, PAL.rimCyan],
            [36, 0.9, -82, 14, [1.22, 0.5, 0.9], -0.18, 1221, 'slab', 1, PAL.rockBlue, PAL.rimCyan],
            [48, 0.7, -83, 9, [0.82, 0.64, 0.76], 0.16, 1222, 'foreground', 3, PAL.rockBlue, PAL.rimCyan],
            [39, -9.2, -78, 12, [0.86, 1.35, 0.9], 0.18, 1223, 'wall', null, PAL.rockDark, PAL.rimViolet],
            [28, -6.8, -87, 9, [0.82, 1.0, 0.8], -0.08, 1224, 'wall', null, PAL.rockDark, PAL.rimCyan],
            [33, -2.7, -88, 7, [0.74, 0.86, 0.7], 0.1, 1225, 'foreground', 4, PAL.rockDark, PAL.rimCyan],
        ], { brightness: 0.72, rimStr: 0.34, detailGain: 0.62 });

        addRockCluster([
            [-23, 13, -132, 9, [0.92, 0.46, 0.7], -0.18, 1230, 'slab', 1, PAL.rockBlue, PAL.rimCyan],
            [-6, 14, -139, 10, [0.96, 0.46, 0.72], 0.02, 1231, 'slab', 1, PAL.rockBlue, PAL.rimCyan],
            [15, 16, -151, 8, [0.78, 0.58, 0.68], 0.18, 1232, 'foreground', 3, PAL.rockBlue, PAL.rimCyan],
            [-3, 4, -140, 9, [0.8, 1.2, 0.82], 0.0, 1233, 'wall', null, PAL.rockDark, PAL.rimCyan],
        ], { brightness: 0.64, rimStr: 0.28, detailGain: 0.5 });

        addRockCluster([
            [-16, -7.7, 28, 7, [1.0, 0.48, 0.78], 0.1, 1240, 'foreground', 4, PAL.rockDark, PAL.rimViolet],
            [12, -7.8, 22, 8, [1.0, 0.5, 0.78], -0.12, 1241, 'foreground', 4, PAL.rockDark, PAL.rimCyan],
            [-9, -7.9, -6, 6, [0.9, 0.44, 0.72], 0.22, 1242, 'foreground', 4, PAL.rockDark, PAL.rimCyan],
            [8, -7.9, -28, 6, [0.9, 0.44, 0.72], -0.24, 1243, 'foreground', 4, PAL.rockDark, PAL.rimCyan],
            [-11, -8.1, -54, 5, [0.84, 0.42, 0.68], 0.18, 1244, 'foreground', 4, PAL.rockDark, PAL.rimViolet],
            [15, -8.0, -88, 5, [0.78, 0.48, 0.68], -0.2, 1245, 'foreground', 3, PAL.rockDark, PAL.rimCyan],
            [-17, -8.0, -104, 5, [0.76, 0.48, 0.66], 0.16, 1246, 'foreground', 4, PAL.rockDark, PAL.rimViolet],
            [-34, -8.0, 16, 9, [1.16, 0.5, 0.78], 0.16, 1247, 'foreground', 4, PAL.rockDark, PAL.rimViolet],
            [31, -8.0, 10, 9, [1.1, 0.5, 0.76], -0.18, 1248, 'foreground', 3, PAL.rockDark, PAL.rimCyan],
            [-28, -8.1, -28, 8, [0.98, 0.5, 0.72], -0.22, 1249, 'foreground', 4, PAL.rockDark, PAL.rimViolet],
            [25, -8.1, -48, 8, [0.94, 0.48, 0.7], 0.22, 1250, 'foreground', 3, PAL.rockDark, PAL.rimCyan],
            [42, -7.9, -12, 10, [1.22, 0.52, 0.8], -0.3, 1251, 'foreground', 4, PAL.rockDark, PAL.rimCyan],
        ], { brightness: 0.5, rimStr: 0.18, detailGain: 0.48 });
    }

    // ═══ CANYON WALLS — tall faceted rock masses receding left & right ════════════
    {
        const walls = [
            // [x,y,z, baseR, scale, seed, tint, rim, rotY] — dark side curtains
            // with staggered depth, leaving the central blue well open.
            [-76, 2, -38, 21, [0.72, 1.72, 1.06], 11, PAL.rockViolet, PAL.rimViolet, 0.34],
            [-74, 14, -98, 27, [0.76, 1.86, 1.1], 12, PAL.rockDark, PAL.rimViolet, -0.08],
            [-66, 22, -162, 33, [0.88, 1.95, 1.1], 13, PAL.rockBlue, PAL.rimCyan, 0.16],
            [78, 1, -48, 20, [0.7, 1.68, 1.0], 21, PAL.rockDark, PAL.rimCyan, -0.3],
            [74, 17, -112, 27, [0.76, 1.84, 1.02], 22, PAL.rockBlue, PAL.rimCyan, 0.08],
            [70, 26, -180, 32, [0.86, 2.0, 1.04], 23, PAL.rockDark, PAL.rimCyan, -0.12],
        ];
        for (const [x, y, z, r, scale, seed, tint, rim, rotY] of walls) {
            addRockMass(x, y, z, {
                role: 'wall',
                baseR: r,
                seed,
                scale,
                rotY,
                baseHex: tint,
            }, {
                tintHex: tint, rimHex: rim, rimStr: 0.35, rimPow: 2.8, brightness: 1.05, detailGain: 0.75,
            });
        }
        // Near edge cliffs sit low and wide, framing without becoming a flat slab.
        addRockMass(-76, -7, -22, {
            role: 'foreground',
            baseR: 19,
            seed: 17,
            scale: [1.0, 1.0, 0.95],
            rotY: 0.5,
            baseHex: PAL.rockViolet,
        }, {
            tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.25, rimPow: 3.0, brightness: 0.66,
        });
        addRockMass(76, -8, -28, {
            role: 'foreground',
            baseR: 20,
            seed: 27,
            scale: [1.02, 1.05, 0.95],
            rotY: -0.46,
            baseHex: PAL.rockBlue,
        }, {
            tintHex: PAL.rockDark, rimHex: PAL.rimCyan, rimStr: 0.25, rimPow: 3.0, brightness: 0.66,
        });
    }

    // ═══ FOREGROUND SILHOUETTE ROCKS — big dark masses framing the bottom ═════════
    {
        // pushed to the sides/corners + lower so they FRAME the edges, not block the vista
        // probe-verified on-screen in the bottom corners (the old ±54/±44 set
        // projected entirely off-frame, so the reference's corner framing was absent)
        const fg = [
            [-48, -15.5, 18, 18, 31, [1.45, 0.65, 1.25], 0.2],
            [48, -15.5, 16, 19, 32, [1.45, 0.65, 1.25], -0.18],
            [-32, -14.8, 36, 13, 33, [1.4, 0.5, 1.1], -0.36],
            [34, -14.8, 34, 14, 34, [1.45, 0.5, 1.1], 0.32],
        ];
        for (const [x, y, z, r, seed, scale, rotY] of fg) {
            addRockMass(x, y, z, {
                role: 'foreground',
                baseR: r,
                seed,
                scale,
                rotY,
                baseHex: PAL.rockDark,
            }, {
                tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.26, rimPow: 3.2, brightness: 0.68, detailGain: 0.65,
            });
        }
    }

    // ═══ CEILING + STALACTITES + OVERHANGS ════════════════════════════════════════
    {
        // ceiling overhang masses
        const ceil = [
            [-56, 58, -52, 29, [1.65, 0.36, 1.08], 41, -0.28],
            [50, 60, -82, 30, [1.55, 0.36, 1.04], 42, 0.22],
            [-10, 71, -150, 25, [1.28, 0.3, 0.82], 43, 0.03],
            [-50, 58, -166, 27, [1.32, 0.42, 0.98], 44, -0.12],
            [48, 61, -174, 28, [1.36, 0.42, 0.98], 45, 0.12],
        ];
        for (const [x, y, z, r, scale, seed, rotY] of ceil) {
            addRockMass(x, y, z, {
                role: 'ceiling',
                variant: 1,
                baseR: r,
                seed,
                scale,
                rotY,
                baseHex: PAL.rockDark,
            }, {
                tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.22, rimPow: 3.2, brightness: 0.66, detailGain: 0.55,
            });
        }

        // 3D Distant Cavern Gateway Arch (frames the sky/haze well physically in the distance)
        addRockMass(-6, 34, -205, {
            role: 'ceiling',
            variant: 1,
            baseR: 34,
            seed: 99,
            scale: [2.9, 0.42, 1.15],
            baseHex: PAL.rockDark,
        }, {
            tintHex: PAL.rockDark, rimHex: PAL.rimCyan, rimStr: 0.34, rimPow: 2.4, brightness: 0.78,
        });
        addRockMass(-44, 10, -184, {
            role: 'wall',
            baseR: 23,
            seed: 101,
            scale: [1.1, 1.9, 1.0],
            rotY: 0.18,
            baseHex: PAL.rockDark,
        }, {
            tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.28, rimPow: 2.7, brightness: 0.72,
        });
        addRockMass(42, 12, -186, {
            role: 'wall',
            baseR: 24,
            seed: 102,
            scale: [1.1, 1.9, 1.0],
            rotY: -0.16,
            baseHex: PAL.rockDark,
        }, {
            tintHex: PAL.rockDark, rimHex: PAL.rimCyan, rimStr: 0.28, rimPow: 2.7, brightness: 0.72,
        });
        // stalactites — clustered along the ceiling fringe, denser top-LEFT (reference)
        const STAL = Math.round(12 * DENSITY);
        const sgeo = track(new T.ConeGeometry(1, 1, 6, 2));
        sgeo.rotateX(Math.PI);
        sgeo.translate(0, -0.5, 0);
        // gentle taper jitter for a less perfect cone
        const sp = sgeo.attributes.position;
        for (let i = 0; i < sp.count; i++) {
            const yy = sp.getY(i);
            const f = 1 + Math.sin(yy * 9.0 + i) * 0.06;
            sp.setX(i, sp.getX(i) * f);
            sp.setZ(i, sp.getZ(i) * f);
        }
        sgeo.computeVertexNormals();
        const smat = rockMat(PAL.rockDark, { rimHex: PAL.rimCyan, rimStr: 0.5, rimPow: 2.2 });
        const inst = new T.InstancedMesh(sgeo, smat, STAL);
        const m = new T.Matrix4(); const p = new T.Vector3(); const q = new T.Quaternion(); const sc = new T.Vector3();
        for (let i = 0; i < STAL; i++) {
            const sideBias = Math.random() < 0.58 ? -1 : 1;
            const x = sideBias * (44 + Math.random() * 34) + (Math.random() - 0.5) * 4;
            const z = -48 - Math.random() * 132;
            const len = 5 + Math.random() * 10;
            const rad = 0.12 + Math.random() * 0.42;
            p.set(x, 56 + Math.random() * 7, z);
            q.setFromEuler(new T.Euler((Math.random() - 0.5) * 0.2, Math.random() * 6.28, (Math.random() - 0.5) * 0.2));
            sc.set(rad, len, rad);
            m.compose(p, q, sc);
            inst.setMatrixAt(i, m);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.frustumCulled = false;
        add(inst);
    }

    // ═══ DISTANT CLIFF SHELVES — hazy silhouettes deep in the well ════════════════
    {
        // Broken, smaller back ledges to fill the -150..-220 depth gap without long flat strips.
        const shelves = [
            [-34, 13, -188, 11, [0.98, 0.48, 0.78], 51, -0.16, 1],
            [22, 19, -204, 12, [0.94, 0.5, 0.74], 52, 0.14, 1],
            [-5, 18, -198, 8, [0.74, 0.68, 0.68], 53, 0.04, 3],
            [-20, 29, -228, 10, [0.9, 0.5, 0.72], 54, -0.08, 1],
            [19, 28, -242, 9, [0.8, 0.64, 0.68], 55, 0.08, 4],
        ];
        for (const [x, y, z, r, scale, seed, rotY, variant] of shelves) {
            addRockMass(x, y, z, {
                role: variant === 1 ? 'slab' : 'foreground',
                variant,
                baseR: r,
                seed,
                scale,
                rotY,
                baseHex: PAL.rockBlue,
            }, {
                tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.36, rimPow: 2.1, brightness: 0.66, detailGain: 0.58,
            });
        }
    }

    // ── waterfall / light-stream off an island or ledge edge ────────────────────
    const makeWaterfall = (x, y, z, w, h, rotY = 0, hex = PAL.river) => {
        const geo = track(new T.PlaneGeometry(w, h, 1, 1));
        const mat = track(new T.MeshBasicNodeMaterial());
        const u = uv();

        // Dripping scroll coordinate
        const vScroll = u.y.sub(uTime.mul(0.9));

        // 1. High frequency vertical stripes to create fine dripping threads
        const threads = pow(sin(u.x.mul(185.0)).mul(0.5).add(0.5), float(2.6));

        // 2. Scrolling vertical noise to break threads into droplets
        const noise = mx_noise_float(vec3(u.x.mul(34.0), vScroll.mul(10.0), 0.0)).mul(0.62).add(0.38);

        // 3. Combine them to get droplet intensity
        const intensity = threads.mul(noise);

        // 4. Smooth taper at sides and top/bottom edges
        const sideTaper = smoothstep(0.0, 0.2, u.x).mul(smoothstep(1.0, 0.8, u.x));
        const topFade = smoothstep(0.0, 0.04, u.y).mul(smoothstep(1.0, 0.96, u.y));

        const mask = intensity.mul(sideTaper).mul(topFade);

        // Apply emissive fog using the global getFogFactor() helper
        const f = getFogFactor();

        // Base color is a dark teal blend, glowing color is the waterfall color
        mat.colorNode = distFog(mix(cv(0x03101a), cv(hex), mask.mul(0.7)), f);

        // High emissive glow for threads to trigger bloom
        const emi = cv(hex).mul(mask.mul(1.75));
        mat.emissiveNode = emi.mul(float(1.0).sub(f));

        // Make it highly translucent in between the threads
        mat.opacityNode = mask.mul(0.82).add(0.018);
        mat.transparent = true;
        mat.depthWrite = false;
        mat.side = T.DoubleSide;

        const wf = add(new T.Mesh(geo, mat));
        wf.position.set(x, y, z);
        wf.rotation.y = rotY;
        wf.frustumCulled = false;

        // Add subtle local glow halo at top and bottom (reduced intensity)
        makeGlow(x, y - h * 0.5, z, w * 1.15, hex, 0.12, 0.5, x);
        makeGlow(x, y + h * 0.45, z, w * 0.65, hex, 0.08, 0.7, z);
        makeGlow(x, y - h * 0.5 + 2, z, w * 1.35, hex, 0.07, 0.45, z + 1.0); // base mist plume
    };

    // ── volumetric god-ray shaft — soft camera-facing additive beam through the
    //    haze-well (brightest at the top source, fades downward; kept subtle so the
    //    central negative space stays calm per the UI-readability contract) ────────
    const makeShaft = (x, y, z, w, h, hex, op = 0.3) => {
        const geo = track(new T.PlaneGeometry(w, h));
        const mat = track(new T.MeshBasicNodeMaterial());
        const u = uv();
        const dx = u.x.sub(0.5).mul(2.0);
        const horiz = clamp(float(1.0).sub(dx.mul(dx)), 0.0, 1.0); // soft centre falloff
        const vert = pow(clamp(u.y, 0.0, 1.0), float(0.6)); // bright at top, fades down
        const shimmer = sin(uTime.mul(0.4).add(x)).mul(0.12).add(0.88);
        mat.colorNode = cv(hex);
        mat.opacityNode = horiz.mul(vert).mul(op).mul(shimmer).mul(float(1.0).add(uEnergy.mul(0.4)));
        mat.transparent = true;
        mat.depthWrite = false;
        mat.blending = T.AdditiveBlending;
        mat.toneMapped = false;
        mat.fog = false;
        const mesh = new T.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.frustumCulled = false;
        add(mesh);
        glowBillboards.push(mesh); // upright + camera-facing
        return mesh;
    };

    // ═══ FLOATING ISLANDS (midground) + their waterfalls/terraces ═════════════════
    // (The hero tree brings its own rock base from the GLB; these are supporting
    // islands. All become real Blender rock meshes via the deferred GLB loader.)
    addRockMass(30, 15, -104, {
        role: 'slab',
        variant: 1,
        baseR: 13,
        flatTop: true,
        scale: [1.04, 0.5, 0.82],
        rotY: -0.22,
        seed: 70,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.36, rimPow: 2.2, brightness: 0.78,
    });
    addRockMass(38, 13.2, -104, {
        role: 'foreground',
        variant: 3,
        baseR: 7,
        scale: [0.72, 0.74, 0.66],
        rotY: 0.12,
        seed: 170,
        baseHex: PAL.rockDark,
    }, {
        tintHex: PAL.rockDark, rimHex: PAL.rimCyan, rimStr: 0.22, brightness: 0.56,
    });
    addRockMass(33, 2, -104, {
        role: 'wall',
        baseR: 10,
        scale: [0.82, 1.24, 0.82],
        seed: 71,
        baseHex: PAL.rockDark,
    }, {
        tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.28, brightness: 0.76,
    });
    makeWaterfall(25, 4.9, -105, 1.25, 19, -0.08, PAL.teal);
    makeWaterfall(31, 4.4, -104, 0.9, 18, 0.02, PAL.cyan);
    makeWaterfall(37, 5.0, -104, 1.05, 18, 0.16, PAL.teal);

    // left prominent shelf (replaces simple left terrace to match the layered cliff in the reference)
    addRockMass(-39, 5.4, -74, {
        role: 'slab',
        variant: 1,
        baseR: 12,
        flatTop: true,
        scale: [1.1, 0.5, 0.82],
        rotY: 0.24,
        seed: 88,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimViolet, rimStr: 0.36, rimPow: 2.3, brightness: 0.76,
    });
    addRockMass(-50, 3.2, -76, {
        role: 'foreground',
        variant: 4,
        baseR: 7,
        scale: [0.72, 0.78, 0.68],
        rotY: -0.18,
        seed: 171,
        baseHex: PAL.rockDark,
    }, {
        tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.24, brightness: 0.56,
    });
    addRockMass(-42, -3.5, -75, {
        role: 'wall',
        baseR: 10,
        scale: [0.82, 1.28, 0.88],
        seed: 89,
        baseHex: PAL.rockDark,
    }, {
        tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.3, brightness: 0.72,
    });
    makeWaterfall(-29, -2.6, -75, 1.1, 15, 0.1, PAL.teal);

    addRockMass(-40, 11, -122, {
        role: 'slab',
        variant: 1,
        baseR: 10,
        flatTop: true,
        scale: [1.0, 0.5, 0.78],
        rotY: -0.16,
        seed: 73,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.34, brightness: 0.7,
    });
    makeWaterfall(-34, 1.0, -122, 1.5, 19, 0.03, PAL.cyan);

    addRockMass(20, 23, -152, {
        role: 'slab',
        variant: 1,
        baseR: 9,
        flatTop: true,
        scale: [0.9, 0.48, 0.72],
        rotY: 0.18,
        seed: 74,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.32, brightness: 0.68,
    });
    makeWaterfall(21, 9.5, -153, 1.2, 25, -0.06, PAL.cyan);

    // ── prominent CENTRAL floating island + tall cyan cascade (reference's signature) ──
    addRockMass(-6, 22, -126, {
        role: 'slab',
        variant: 1,
        baseR: 10,
        flatTop: true,
        scale: [0.92, 0.5, 0.72],
        seed: 75,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.32, brightness: 0.66,
    });
    makeWaterfall(-6, 5.8, -127, 1.5, 30, 0.0, PAL.cyan);
    makeWaterfall(-1, 6.0, -128, 1.0, 28, 0.06, PAL.teal);
    makeWaterfall(-11, 5.2, -126, 0.9, 27, -0.08, PAL.river);

    // ── HERO-TREE rock outcrop — the filigree tree sits on a jutting ledge (right
    //    third), exactly as in the reference; plus a supporting buttress below it ──
    addRockMass(34, -6.4, -81, {
        role: 'slab',
        variant: 1,
        baseR: 16,
        flatTop: true,
        seed: 91,
        scale: [1.2, 0.54, 0.92],
        rotY: -0.18,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.36, rimPow: 2.4, brightness: 0.78,
    });
    addRockMass(40, -13.5, -78, {
        role: 'wall',
        baseR: 12,
        scale: [0.92, 1.18, 0.9],
        rotY: 0.2,
        seed: 92,
        baseHex: PAL.rockDark,
    }, {
        tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.28, brightness: 0.7,
    });
    makeContactShadow(33, -5.4, -81, 20, 12, -0.16, 0.3);
    // Multiple cascading waterfalls under the hero tree ledge (matches the dripping streams in the reference)
    makeWaterfall(37, -8.2, -82, 0.9, 12, 0.08, PAL.cyan);
    makeWaterfall(31, -8.4, -82, 0.8, 11, -0.04, PAL.teal);
    makeWaterfall(42, -8.7, -80, 0.75, 10, 0.16, PAL.cyan);

    // ── ADDED DETAILING ROCKS (Puzzling together to match reference layout) ──────
    // 1. Rooted Boulders around Hero Tree base
    addRockMass(27, -3.2, -80, {
        role: 'foreground',
        baseR: 8,
        seed: 151,
        baseHex: PAL.rockDark,
    }, { tintHex: PAL.rockDark, brightness: 0.72, rimStr: 0.22 });
    addRockMass(36, -3.3, -76, {
        role: 'foreground',
        baseR: 6,
        seed: 152,
        baseHex: PAL.rockDark,
    }, { tintHex: PAL.rockDark, brightness: 0.72, rimStr: 0.22 });
    addRockMass(32, -3.4, -86, {
        role: 'foreground',
        baseR: 7,
        seed: 153,
        baseHex: PAL.rockDark,
    }, { tintHex: PAL.rockDark, brightness: 0.72, rimStr: 0.22 });

    // 2. Layered Right Canyon Ledges
    addRockMass(43, 10, -84, {
        role: 'foreground',
        variant: 3,
        baseR: 8,
        scale: [0.78, 0.82, 0.72],
        rotY: -0.2,
        seed: 154,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.28, brightness: 0.62,
    });
    addRockMass(48, 2, -108, {
        role: 'foreground',
        variant: 4,
        baseR: 7,
        scale: [0.72, 0.78, 0.7],
        rotY: -0.12,
        seed: 155,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.25, brightness: 0.58,
    });

    // 3. Layered Left Canyon Ledges
    addRockMass(-31, -6.5, -48, {
        role: 'foreground',
        variant: 4,
        baseR: 7,
        scale: [0.78, 0.76, 0.72],
        rotY: 0.18,
        seed: 156,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimViolet, rimStr: 0.26, brightness: 0.58,
    });
    addRockMass(-43, 14, -94, {
        role: 'slab',
        variant: 1,
        baseR: 8,
        flatTop: true,
        scale: [0.86, 0.5, 0.72],
        rotY: 0.12,
        seed: 157,
        baseHex: PAL.rockBlue,
    }, {
        tintHex: PAL.rockBlue, rimHex: PAL.rimCyan, rimStr: 0.28, brightness: 0.62,
    });

    // 4. Midground Pool Rocks (Stepping stones)
    addRockMass(-12, -8.4, -40, {
        role: 'foreground',
        baseR: 5,
        seed: 158,
        baseHex: PAL.rockDark,
    }, { tintHex: PAL.rockDark, brightness: 0.58, rimStr: 0.18 });
    addRockMass(5, -8.5, -66, {
        role: 'foreground',
        baseR: 4,
        seed: 159,
        baseHex: PAL.rockDark,
    }, { tintHex: PAL.rockDark, brightness: 0.58, rimStr: 0.18 });
    addRockMass(-4, -8.45, -26, {
        role: 'foreground',
        baseR: 6,
        seed: 160,
        baseHex: PAL.rockDark,
    }, { tintHex: PAL.rockDark, brightness: 0.58, rimStr: 0.18 });

    // 5. Cavern Pillars (Stalactite columns enclosing the frame)
    addRockMass(-44, 18, -118, {
        role: 'wall',
        baseR: 8,
        scale: [0.9, 3.2, 0.9],
        rotY: 0.12,
        seed: 163,
        baseHex: PAL.rockDark,
    }, {
        tintHex: PAL.rockDark, rimHex: PAL.rimViolet, rimStr: 0.32, brightness: 0.64,
    });
    addRockMass(45, 14, -126, {
        role: 'wall',
        baseR: 7,
        scale: [0.9, 2.8, 0.9],
        rotY: -0.1,
        seed: 164,
        baseHex: PAL.rockDark,
    }, {
        tintHex: PAL.rockDark, rimHex: PAL.rimCyan, rimStr: 0.32, brightness: 0.64,
    });

    // ── soft god-ray shafts descending through the central haze-well (subtle) ─────
    makeShaft(-18, 14, -134, 12, 44, PAL.cyan, 0.15);
    makeShaft(-3, 17, -142, 15, 52, PAL.aqua, 0.14);
    makeShaft(13, 14, -148, 13, 48, PAL.teal, 0.12);
    makeShaft(-6, 20, -160, 25, 60, PAL.hazeWell, 0.10); // broad faint backdrop shaft

    // ═══ HERO TREE — AI-generated (TRELLIS image→3D) glowing tree-island GLB ═══════
    // Real 3D mesh sculpted from the reference by TRELLIS.2-4B; the bioluminescent
    // glow is baked into VERTEX COLOURS (read via attribute('color')), driven
    // emissive so the cyan canopy + violet trunk bloom. Vertex-colour pipeline like
    // the summer flora. Brings its own rock base.
    {
        const vColor = attribute('color', 'vec3');
        const V = normalize(cameraPosition.sub(positionWorld));
        const fres = pow(clamp(float(1.0).sub(dot(faceN, V)), 0.0, 1.0), float(2.0));
        const breathe = sin(uTime.mul(0.6)).mul(0.5).add(0.5);
        // Bright glowing filigree (Sketchfab bare-branch tree, vertex-colour teal→white).
        // Push the bright verts toward the spec white-cyan core, and make the fine
        // OUTER TWIGS hottest via a world-height tip boost.
        const tipUp = clamp(positionWorld.y.sub(10.0).div(48.0), 0.0, 1.0);
        const lum = dot(vColor, vec3(0.299, 0.587, 0.114));
        const tinted = mix(vColor.mul(vec3(0.72, 0.92, 1.08)), cv(0xbff0ff), clamp(lum.mul(1.75), 0.0, 0.88));

        // Ground the tree trunk: make the bottom of the trunk dark, and only branches glow
        const heightGlow = smoothstep(-2.0, 20.0, positionWorld.y).mul(0.92).add(0.08);
        const strength = float(1.12).add(breathe.mul(0.26)).add(tipUp.mul(0.95)).add(uEnergy.mul(1.2))
            .add(uPulse.mul(0.4))
            .mul(heightGlow);

        new GLTFLoader().load(caveTreeUrl, (gltf) => {
            const root = gltf.scene;
            root.traverse((o) => {
                if (!o.isMesh) return;
                const mat = track(new T.MeshBasicNodeMaterial());
                const f = getFogFactor();
                const emi = tinted.mul(strength).add(tinted.mul(fres).mul(0.85));
                mat.colorNode = distFog(tinted.mul(0.5), f);
                mat.emissiveNode = emi.mul(float(1.0).sub(f));
                mat.side = T.DoubleSide;
                o.material = mat;
                o.frustumCulled = false;
            });
            root.position.set(33, -1.15, -82); // hero focal on the RIGHT third, lifted onto the ledge
            // NB: the Sketchfab GLB bakes a 0.02 object-scale, so the effective
            // multiplier is ~36×; 1700 yields a ~61u-tall hero filigree tree.
            root.scale.setScalar(1760);
            add(root);
        }, undefined, (e) => console.warn('[biolum2] tree GLB load failed', e));
        // soft halos backing the actual CROWN so the bright filigree reads as the focal
        makeGlow(33, 29, -83, 28, PAL.treeGlow, 0.22, 0.45, 1.0);
        makeGlow(33, 35, -84, 16, PAL.treeCore, 0.2, 0.8, 2.0);
        makeGlow(34, 7, -82, 11, PAL.treeGlow, 0.12, 0.6, 3.0);
    }

    // Faceted mushroom-canopy lobes around the hero tree, matching the reference's
    // cyan-lit violet crown while keeping the imported tree as the focal asset.
    {
        const makeCanopy = (x, y, z, rx, ry, rz, rotY, hex, accentHex, phase = 0) => {
            const geo = track(new T.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.54));
            geo.scale(rx, ry, rz);
            geo.rotateZ((phase - 0.5) * 0.16);
            geo.computeVertexNormals();

            const mat = track(new T.MeshBasicNodeMaterial());
            const V = normalize(cameraPosition.sub(positionWorld));
            const fres = pow(clamp(float(1.0).sub(dot(faceN, V)), 0.0, 1.0), float(1.7));
            const up = max(dot(faceN, vec3(0, 1, 0)), float(0.0));
            const noise = mx_noise_float(vec3(positionWorld.x.mul(0.05), positionWorld.y.mul(0.04), positionWorld.z.mul(0.05))).mul(0.5).add(0.5);
            const pulse = sin(uTime.mul(0.55).add(phase * 6.283)).mul(0.08).add(0.92);
            let col = cv(hex).mul(noise.mul(0.28).add(0.78)).mul(up.mul(0.28).add(0.5));
            col = col.add(cv(accentHex).mul(fres.mul(0.72)));
            const f = getFogFactor();
            mat.colorNode = distFog(col, f);
            mat.emissiveNode = cv(accentHex).mul(fres.mul(0.55).add(up.mul(0.16)).mul(pulse)).mul(float(1.0).sub(f));
            mat.side = T.DoubleSide;

            const cap = add(new T.Mesh(geo, mat));
            cap.position.set(x, y, z);
            cap.rotation.y = rotY;
            cap.frustumCulled = false;
            makeGlow(x, y + ry * 0.2, z, Math.max(rx, rz) * 1.35, accentHex, 0.16, 0.5, phase);
            return cap;
        };

        makeCanopy(36, 30, -88, 9.5, 2.7, 5.8, -0.22, PAL.purple, PAL.cyan, 0.2);
        makeCanopy(27, 25, -86, 5.4, 1.9, 3.9, 0.18, PAL.violet, PAL.treeGlow, 0.45);
        makeCanopy(43, 25, -90, 5.8, 1.9, 3.8, -0.4, PAL.rockBlue, PAL.cyan, 0.72);
    }

    // A lightweight authored branch overlay guarantees the reference's white-cyan
    // right-third tree silhouette reads even if the small GLB finishes after capture.
    {
        const mat = track(new T.MeshBasicNodeMaterial());
        const breathe = sin(uTime.mul(0.7)).mul(0.12).add(1.0);
        mat.colorNode = cv(PAL.treeCore).mul(0.34);
        mat.emissiveNode = cv(PAL.treeGlow).mul(float(0.62).mul(breathe).add(uEnergy.mul(0.55)).add(uPulse.mul(0.18)));
        mat.side = T.DoubleSide;

        const addBranch = (a, b, r) => {
            const start = new T.Vector3(a[0], a[1], a[2]);
            const end = new T.Vector3(b[0], b[1], b[2]);
            const dir = end.clone().sub(start);
            const len = dir.length();
            if (len <= 0.001) return;
            const geo = track(new T.CylinderGeometry(r * 0.72, r, len, 6, 1));
            const mesh = new T.Mesh(geo, mat);
            mesh.position.copy(start).add(end).multiplyScalar(0.5);
            mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
            mesh.frustumCulled = false;
            add(mesh);
        };
        const addTip = (x, y, z, s) => {
            const mesh = new T.Mesh(track(new T.IcosahedronGeometry(s, 0)), mat);
            mesh.position.set(x, y, z);
            mesh.frustumCulled = false;
            add(mesh);
        };

        const z = -82;
        const branches = [
            [[32, -3, z], [32, 10, z], 0.24],
            [[32, 6, z], [25, 15, z], 0.14],
            [[32, 7, z], [39, 16, z], 0.14],
            [[31, 12, z], [21, 22, z], 0.1],
            [[33, 12, z], [45, 22, z], 0.1],
            [[30, 16, z], [20, 30, z], 0.075],
            [[34, 17, z], [48, 31, z], 0.075],
            [[27, 18, z], [17, 23, z], 0.06],
            [[37, 18, z], [50, 23, z], 0.06],
            [[24, 22, z], [15, 31, z], 0.05],
            [[42, 23, z], [52, 34, z], 0.05],
        ];
        branches.forEach(([a, b, r]) => addBranch(a, b, r));
        [
            [15, 31, z], [17, 23, z], [20, 30, z],
            [48, 31, z], [50, 23, z], [52, 34, z],
        ].forEach(([x, y, zz]) => addTip(x, y, zz, 0.36));
    }

    // ── flora templates (merged, position + aGlow) ──────────────────────────────
    const TWO_PI = Math.PI * 2;

    const bakeCapGlow = (g, capR, capH) => {
        const pa = g.getAttribute('position');
        const c = pa.count;
        const a = new Float32Array(c);
        for (let i = 0; i < c; i++) {
            const x = pa.getX(i);
            const y = pa.getY(i);
            const z = pa.getZ(i);
            const distXZ = Math.sqrt(x * x + z * z) / (capR || 1.0);
            const normY = Math.max(0, y) / (capH || 1.0);
            // Rim is at outer XZ distance, top is at highest Y.
            // Create a gorgeous jelly-like translucent glow by highlighting the rim and top core.
            const rimGlow = Math.min(1.0, distXZ) ** 1.5;
            const topGlow = Math.min(1.0, normY) ** 2.0 * 0.45;
            a[i] = 0.25 + 0.75 * Math.max(rimGlow, topGlow);
        }
        g.setAttribute('aGlow', new T.Float32BufferAttribute(a, 1));
        return g;
    };

    const makeMushroomTemplate = ({
        capR, capH, stemH, stemR, capType,
    }) => {
        const parts = [];
        const stem = new T.CylinderGeometry(stemR * 0.7, stemR, stemH, 6, 1);
        stem.translate(0, stemH / 2, 0);
        bakeGlow(stem, 0.12); // Slightly lower stem glow
        parts.push(stem);
        let cap;
        if (capType === 0) {
            cap = new T.SphereGeometry(capR, 9, 6, 0, TWO_PI, 0, Math.PI * 0.55);
            cap.scale(1, (capH / capR) * 0.85, 1);
        } else if (capType === 1) {
            cap = new T.SphereGeometry(capR, 10, 5, 0, TWO_PI, 0, Math.PI * 0.42);
            cap.scale(1, (capH / capR) * 0.55, 1);
        } else {
            cap = new T.ConeGeometry(capR, capH * 1.5, 8, 1);
        }
        bakeCapGlow(cap, capR, capH);
        cap.translate(0, stemH, 0);
        parts.push(cap);
        return mergeFlora(parts);
    };
    const mushTemplates = [
        makeMushroomTemplate({
            capR: 1.0, capH: 0.8, stemH: 1.4, stemR: 0.14, capType: 0,
        }),
        makeMushroomTemplate({
            capR: 1.3, capH: 0.5, stemH: 1.0, stemR: 0.16, capType: 1,
        }),
        makeMushroomTemplate({
            capR: 0.7, capH: 1.1, stemH: 1.7, stemR: 0.12, capType: 2,
        }),
    ];
    const makeCrystalTemplate = (shards) => {
        const parts = [];
        for (let i = 0; i < shards; i++) {
            const oct = new T.OctahedronGeometry(0.4 + Math.random() * 0.3, 0);
            oct.scale(0.42, 1.5 + Math.random() * 1.2, 0.42);
            oct.rotateZ((Math.random() - 0.5) * 0.7);
            oct.rotateX((Math.random() - 0.5) * 0.5);
            oct.translate((Math.random() - 0.5) * 0.8, (0.4 + Math.random() * 0.6), (Math.random() - 0.5) * 0.8);
            bakeGradient(oct, 0.35, 1.0);
            parts.push(oct);
        }
        return mergeFlora(parts);
    };
    const crystalTemplates = [makeCrystalTemplate(4), makeCrystalTemplate(6)];
    const makeGrassTemplate = (blades) => {
        const parts = [];
        for (let i = 0; i < blades; i++) {
            const b = new T.ConeGeometry(0.06, 1.2 + Math.random() * 0.8, 3, 1);
            b.translate(0, (1.2) / 2, 0);
            b.rotateZ((Math.random() - 0.5) * 0.5);
            b.rotateX((Math.random() - 0.5) * 0.4);
            b.translate((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
            bakeGradient(b, 0.2, 1.0);
            parts.push(b);
        }
        return mergeFlora(parts);
    };
    const grassTemplate = makeGrassTemplate(5);

    const makeMossTemplate = () => {
        const geo = new T.ConeGeometry(0.08, 0.24, 3, 1);
        geo.translate(0, 0.12, 0);
        bakeGlow(geo, 1.0);
        return track(geo);
    };
    const mossTemplate = makeMossTemplate();

    // ── instanced-flora scatter system (per-instance pos/rot/scale/colour/phase) ─
    const makeScatter = (template, matOpts, palette) => ({
        template, matOpts, palette, mats: [], cols: [], phases: [],
    });
    const scatterAt = (bin, x, y, z, scale, rotY) => {
        const m = new T.Matrix4();
        m.compose(
            new T.Vector3(x, y, z),
            new T.Quaternion().setFromEuler(new T.Euler((Math.random() - 0.5) * 0.2, rotY ?? Math.random() * TWO_PI, (Math.random() - 0.5) * 0.2)),
            new T.Vector3(scale, scale * (0.85 + Math.random() * 0.4), scale),
        );
        bin.mats.push(m);
        const c = new T.Color(pick(bin.palette));
        bin.cols.push(c.r, c.g, c.b);
        bin.phases.push(Math.random());
    };
    const buildScatter = (bin, swayOpt) => {
        const n = bin.mats.length;
        if (!n) return;
        const geo = bin.template;
        const inst = new T.InstancedMesh(geo, floraMat({ ...bin.matOpts, ...(swayOpt || {}) }), n);
        const aColor = new Float32Array(bin.cols);
        const aPhase = new Float32Array(bin.phases);
        for (let i = 0; i < n; i++) inst.setMatrixAt(i, bin.mats[i]);
        inst.instanceMatrix.needsUpdate = true;
        geo.setAttribute('aColor', new T.InstancedBufferAttribute(aColor, 3));
        geo.setAttribute('aPhase', new T.InstancedBufferAttribute(aPhase, 1));
        inst.frustumCulled = false;
        add(inst);
    };

    // bins (one InstancedMesh per template so geometry varies)
    const mushBins = mushTemplates.map(() => makeScatter(null, {
        emiBase: 0.85, emiPulse: 0.4, rimStr: 1.0, pulseSpeed: 0.7,
    }, FLORA_MIX));
    mushBins.forEach((b, i) => { b.template = mushTemplates[i]; });
    const crystalBins = crystalTemplates.map(() => makeScatter(null, {
        emiBase: 0.7, emiPulse: 0.45, rimStr: 1.2, rimPow: 1.6, pulseSpeed: 0.9,
    }, FLORA_COOL.concat(FLORA_HOT)));
    crystalBins.forEach((b, i) => { b.template = crystalTemplates[i]; });
    const grassBin = makeScatter(grassTemplate, {
        emiBase: 0.5, emiPulse: 0.4, rimStr: 0.6, pulseSpeed: 1.0,
    }, [PAL.grass, PAL.teal, PAL.cyan, PAL.aqua]);
    const mossBin = makeScatter(mossTemplate, {
        emiBase: 0.9, emiPulse: 0.5, rimStr: 0.4, pulseSpeed: 0.9,
    }, [PAL.cyan, PAL.teal, PAL.aqua, PAL.violet, PAL.magenta]);

    // scatter a dense cluster of mushrooms + crystals + grass around an anchor
    const cluster = (cx, cy, cz, radius, opts = {}) => {
        const hot = opts.hot ?? false;
        const palette = opts.palette || (hot ? FLORA_HOT : FLORA_MIX);
        const mCount = Math.round((opts.mush ?? 10) * DENSITY);
        const cCount = Math.round((opts.crystal ?? 4) * DENSITY);
        const gCount = Math.round((opts.grass ?? 14) * DENSITY);
        const mossCount = Math.round((opts.moss ?? 20) * DENSITY);
        for (let i = 0; i < mCount; i++) {
            const a = Math.random() * TWO_PI; const rr = Math.random() ** 0.7 * radius;
            const bin = mushBins[Math.floor(Math.random() * mushBins.length)];
            bin.palette = palette;
            scatterAt(bin, cx + Math.cos(a) * rr, cy, cz + Math.sin(a) * rr, (opts.mscale ?? 1.6) * (0.6 + Math.random() * 0.9));
        }
        for (let i = 0; i < cCount; i++) {
            const a = Math.random() * TWO_PI; const rr = Math.random() ** 0.6 * radius * 1.1;
            const bin = crystalBins[Math.floor(Math.random() * crystalBins.length)];
            bin.palette = hot ? FLORA_HOT.concat([PAL.crystalBlue]) : FLORA_COOL.concat([PAL.crystalViolet]);
            scatterAt(bin, cx + Math.cos(a) * rr, cy, cz + Math.sin(a) * rr, (opts.cscale ?? 1.6) * (0.7 + Math.random() * 1.0));
        }
        for (let i = 0; i < gCount; i++) {
            const a = Math.random() * TWO_PI; const rr = Math.random() ** 0.5 * radius * 1.3;
            scatterAt(grassBin, cx + Math.cos(a) * rr, cy, cz + Math.sin(a) * rr, (opts.gscale ?? 1.5) * (0.6 + Math.random() * 0.9));
        }
        for (let i = 0; i < mossCount; i++) {
            const a = Math.random() * TWO_PI; const rr = Math.random() ** 0.5 * radius * 1.4;
            scatterAt(mossBin, cx + Math.cos(a) * rr, cy, cz + Math.sin(a) * rr, (opts.gscale ?? 1.0) * (0.7 + Math.random() * 0.6));
        }
    };

    // dense flora along BOTH river banks (the populated path), thinning into depth
    {
        const STEPS = 22;
        for (let i = 1; i < STEPS; i++) {
            const t = i / STEPS;
            const p = riverCurve.getPointAt(t);
            const tan = new T.Vector3(); riverCurve.getTangentAt(t, tan); tan.y = 0; tan.normalize();
            const side = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), tan).normalize();
            const hw = riverHalfWidth(t) + 1.65;
            const fade = 1 - t * 0.65; // fewer + smaller into the distance
            const hot = false; // generic bank flora stays COOL → the lower-left magenta owns the hot accent
            for (const sgn of [1, -1]) {
                const bx = p.x + side.x * hw * sgn + (Math.random() - 0.5) * 2.4;
                const bz = p.z + side.z * hw * sgn + (Math.random() - 0.5) * 2.4;
                // Dense glowing dots/moss carpet along the banks
                cluster(bx, p.y + 0.32, bz, 3.2 * fade + 1.2, {
                    hot,
                    mush: 1.0 * fade + 0.35,
                    crystal: 0.55 * fade + 0.15,
                    grass: 1.8 * fade + 0.55,
                    moss: 18.0 * fade + 5.0,
                    mscale: 0.34 * fade + 0.18,
                    cscale: 0.42 * fade + 0.22,
                    gscale: 0.68 * fade + 0.3,
                });
            }
        }
    }
    // hot foreground clusters on the framing rocks + island tops + ledges.
    // The lower-LEFT magenta/violet cluster is the reference's brightest foreground accent.
    cluster(-39, -7.6, 12, 12, {
        hot: true, palette: FLORA_MAGENTA, mush: 22, crystal: 9, grass: 14, moss: 38, mscale: 0.62, cscale: 0.7,
    }); // reference's brightest foreground accent (lower-LEFT) — the SECONDARY focal
    cluster(-48, -6.8, -4, 8, {
        hot: true, palette: FLORA_MAGENTA, mush: 9, crystal: 5, grass: 8, moss: 20, mscale: 0.55, cscale: 0.6,
    });
    makeGlow(-39, -5.8, 12, 13, PAL.magenta, 0.28, 0.55, 0.7);
    makeGlow(-42, -7, 10, 7, PAL.magentaHot, 0.20, 0.8, 2.0);

    // Prominent cluster of crystals and moss on the bottom right (to frame the screen)
    cluster(42, -8.7, 16, 7, {
        hot: false, palette: [PAL.crystalBlue, PAL.crystalCyan, PAL.cyan], mush: 0, crystal: 12, grass: 5, moss: 22, cscale: 1.65, gscale: 0.7,
    });
    cluster(32, -8.4, 20, 8, {
        hot: true, mush: 5, crystal: 3, grass: 6, moss: 12, mscale: 0.5, cscale: 0.5,
    }); // right foreground is sparser in the reference

    cluster(29, -2.6, -82, 6, {
        hot: false,
        palette: FLORA_COOL,
        mush: 8,
        crystal: 5,
        grass: 10,
        moss: 18,
        mscale: 0.64,
        cscale: 0.75,
    }); // flora at the base of the hero tree
    cluster(-39, 6.8, -74, 5.5, {
        hot: false,
        palette: FLORA_COOL,
        mush: 8,
        crystal: 3,
        grass: 10,
        moss: 16,
    }); // left shelf flora
    cluster(-40, 13.0, -122, 5, {
        hot: false,
        palette: FLORA_COOL,
        mush: 8,
        crystal: 4,
        grass: 10,
        moss: 15,
        mscale: 1.3,
        cscale: 1.3,
    });

    // teal mushroom-trees on the left terrace + GLOWING CANOPIES crowning the
    // floating islands — the reference's signature "mushroom-island + waterfall".
    {
        const specs = [
            // left terrace cluster (adjusted to sit on the new projecting left shelf)
            [-40, 7.2, -74, 4.4, 3.6],
            [-33, 6.8, -73, 3.5, 2.8],
            [-47, 7.0, -77, 3.5, 2.6],
            // canopies crowning the midground floating islands (reference signature)
            [30, 17, -104, 5.8, 5.3], // large right-upper island
            [39, 17, -105, 4.2, 3.6],
            [-40, 13, -122, 7, 6.2], // upper-left shelf canopy
            [-47, 12, -124, 5, 4.0],
            [-9, 24, -128, 5, 4.0], // small central crown, keeps well open
            [20, 25, -152, 6, 4.8], // distant upper-right canopy island
            [31, 1.2, -84, 2.8, 2.3], // small hero-base cap; the GLB tree owns the silhouette
        ];
        for (const [x, y, z, sh, cr] of specs) {
            const bin = mushBins[1];
            bin.palette = [PAL.teal, PAL.cyan, PAL.aqua];
            // big umbrella mushroom-tree = template 1 scaled up, scattered into its bin
            scatterAt(bin, x, y, z, cr);
            makeGlow(x, y + sh, z, cr * 1.8, PAL.teal, 0.22, 0.5, x);
        }
    }

    // commit all scatter bins
    mushBins.forEach((b) => buildScatter(b, { emiBase: 0.85 }));
    crystalBins.forEach((b) => buildScatter(b));
    buildScatter(grassBin, { sway: 0.18, height: 1.6 });
    buildScatter(mossBin, { sway: 0.05, height: 0.24 });

    // ═══ HANGING VINES / DANGLING ROOTS — thin glowing strands off ledges/ceiling ═
    {
        const vineTemplate = (() => {
            const c = new T.CylinderGeometry(0.10, 0.22, 1, 5, 1); // thin top, fatter tip → reads
            c.translate(0, -0.5, 0); // hangs down from y=0
            return mergeFlora([bakeGradient(c, 1.0, 0.15)]); // bright at top? invert: tip(bottom) brighter
        })();
        // actually make the BOTTOM (tip) brighter: regrade
        {
            const pa = vineTemplate.getAttribute('position');
            const ag = vineTemplate.getAttribute('aGlow');
            vineTemplate.computeBoundingBox();
            const yMin = vineTemplate.boundingBox.min.y; const yMax = vineTemplate.boundingBox.max.y; const span = (yMax - yMin) || 1;
            for (let i = 0; i < pa.count; i++) ag.setX(i, 0.2 + 0.8 * (1 - (pa.getY(i) - yMin) / span));
            ag.needsUpdate = true;
        }
        const vineBin = makeScatter(vineTemplate, {
            emiBase: 0.85, emiPulse: 0.45, rimStr: 0.6, pulseSpeed: 0.8,
        }, [PAL.cyan, PAL.teal, PAL.aqua, PAL.crystalCyan]);
        const addStrand = (x, yTop, z, len, tipGlow) => {
            const m = new T.Matrix4();
            const tilt = new T.Quaternion().setFromEuler(new T.Euler((Math.random() - 0.5) * 0.5, Math.random() * 6.28, (Math.random() - 0.5) * 0.5));
            m.compose(new T.Vector3(x, yTop, z), tilt, new T.Vector3(1, len, 1));
            vineBin.mats.push(m);
            const col = new T.Color(pick(vineBin.palette));
            vineBin.cols.push(col.r, col.g, col.b);
            vineBin.phases.push(Math.random());
            if (tipGlow) makeGlow(x, yTop - len, z, 2.2, PAL.cyan, 0.32, 0.9 + Math.random(), Math.random() * 6.28);
        };
        // Reference strands DRIP from the floating-island undersides + ceiling near
        // the canopies — clustered, not scattered through the whole volume.
        const strandAnchors = [
            {
                x: 31,
                y: 11,
                z: -104,
                r: 9,
                n: 12,
                len: [10, 24],
            }, // right-mid island
            {
                x: -38,
                y: 2,
                z: -75,
                r: 10,
                n: 8,
                len: [7, 17],
            }, // left shelf
            {
                x: -40,
                y: 9,
                z: -122,
                r: 9,
                n: 11,
                len: [14, 32],
            }, // ICONIC upper-mid-left
            {
                x: 20,
                y: 20,
                z: -152,
                r: 8,
                n: 8,
                len: [12, 28],
            }, // upper-right
            {
                x: -6,
                y: 18,
                z: -126,
                r: 8,
                n: 8,
                len: [14, 30],
            }, // central crown
            {
                x: 33,
                y: -6,
                z: -82,
                r: 8,
                n: 6,
                len: [7, 15],
            }, // hero-tree outcrop
        ];
        for (const a of strandAnchors) {
            const N = Math.round(a.n * DENSITY);
            for (let i = 0; i < N; i++) {
                const ang = Math.random() * Math.PI * 2; const rr = Math.sqrt(Math.random()) * a.r;
                const x = a.x + Math.cos(ang) * rr;
                const z = a.z + Math.sin(ang) * rr;
                const yTop = a.y - Math.random() * 2.0; // dangle from just under the rim
                const len = a.len[0] + Math.random() * (a.len[1] - a.len[0]);
                addStrand(x, yTop, z, len, i % 2 === 0);
            }
        }
        // a sparse ceiling veil of strands through the central-back depth
        const CEIL = Math.round(20 * DENSITY);
        for (let i = 0; i < CEIL; i++) {
            const side = Math.random() < 0.55 ? -1 : 1;
            const x = side * (26 + Math.random() * 42);
            const z = -72 - Math.random() * 120;
            addStrand(x, 34 + Math.random() * 20, z, 8 + Math.random() * 22, i % 4 === 0);
        }
        buildScatter(vineBin, { sway: 0.5, height: 1.0 });
    }

    // ═══ SPORES + TINY SPARKLES — drifting additive motes through the whole volume ═
    const makeMotes = (count, {
        sizeMin, sizeMax, rise, spanY, baseY, spread, depth, palette, op, clusters = null, clusterChance = 0,
    }) => {
        const geo = track(new T.PlaneGeometry(1, 1));
        const mat = track(new T.MeshBasicNodeMaterial());
        const fi = float(instanceIndex);
        const seed = fract(sin(fi.mul(91.17)).mul(7841.3));
        const seed2 = fract(sin(fi.mul(33.71)).mul(1287.7));
        const riseN = fract(uTime.mul(rise).add(seed));
        const sway = sin(uTime.mul(0.5).add(seed.mul(6.283))).mul(2.2).add(sin(uTime.mul(0.21).add(seed2.mul(6.283))).mul(1.3));
        const swayZ = cos(uTime.mul(0.4).add(seed2.mul(6.283))).mul(1.8);
        mat.positionNode = positionLocal.add(vec3(sway, riseN.mul(spanY), swayZ));
        const pr = uv().sub(0.5).mul(2.0);
        const fall = pow(clamp(float(1.0).sub(length(pr)), 0.0, 1.0), float(2.0));
        const fade = smoothstep(0.0, 0.12, riseN).mul(smoothstep(1.0, 0.78, riseN));
        const flick = sin(uTime.mul(2.4).add(seed.mul(20.0))).mul(0.3).add(0.7);
        const colA = new T.Color(palette[0]); const colB = new T.Color(palette[1 % palette.length]);
        mat.colorNode = mix(vec3(colA.r, colA.g, colA.b), vec3(colB.r, colB.g, colB.b), seed2);
        mat.opacityNode = fall.mul(fade).mul(flick).mul(op);
        mat.transparent = true;
        mat.depthWrite = false;
        mat.blending = T.AdditiveBlending;
        mat.toneMapped = false;
        mat.fog = false;
        const inst = new T.InstancedMesh(geo, mat, count);
        const m = new T.Matrix4(); const p = new T.Vector3(); const q = new T.Quaternion(); const sc = new T.Vector3();
        for (let i = 0; i < count; i++) {
            let x;
            let y;
            let z;
            if (clusters && Math.random() < clusterChance) {
                const c = clusters[Math.floor(Math.random() * clusters.length)];
                const a = Math.random() * Math.PI * 2;
                const rr = Math.sqrt(Math.random()) * c.r;
                x = c.x + Math.cos(a) * rr;
                y = (c.y ?? baseY) + Math.random() * (c.h ?? 8);
                z = c.z + Math.sin(a) * rr;
            } else {
                x = (Math.random() * 2 - 1) * spread;
                y = baseY + Math.random() * 6;
                z = depth[0] - Math.random() * (depth[0] - depth[1]);
            }
            const s = sizeMin + Math.random() * (sizeMax - sizeMin);
            p.set(x, y, z); q.identity(); sc.set(s, s, s);
            m.compose(p, q, sc); inst.setMatrixAt(i, m);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.frustumCulled = false;
        add(inst);
    };
    makeMotes(Math.round(430 * DENSITY), {
        sizeMin: 0.14,
        sizeMax: 0.42,
        rise: 0.018,
        spanY: 30,
        baseY: -8,
        spread: 62,
        depth: [-12, -160],
        palette: [PAL.sporeCol, PAL.teal],
        op: 0.42,
        clusterChance: 0.72,
        clusters: [
            {
                x: -40, y: -5, z: 10, r: 16, h: 11,
            },
            {
                x: 32, y: -1, z: -82, r: 13, h: 17,
            },
            {
                x: 30, y: 5, z: -104, r: 15, h: 18,
            },
            {
                x: -40, y: 4, z: -122, r: 16, h: 18,
            },
        ],
    });
    makeMotes(Math.round(170 * DENSITY), { // tiny twinkling sparkles, brighter, smaller
        sizeMin: 0.06,
        sizeMax: 0.16,
        rise: 0.03,
        spanY: 22,
        baseY: -7,
        spread: 56,
        depth: [-14, -180],
        palette: [0xffffff, PAL.cyan],
        op: 0.68,
        clusterChance: 0.68,
        clusters: [
            {
                x: 32, y: 2, z: -82, r: 13, h: 20,
            },
            {
                x: 30, y: 5, z: -104, r: 13, h: 22,
            },
            {
                x: -42, y: -4, z: 8, r: 16, h: 14,
            },
            {
                x: -5, y: 2, z: -128, r: 12, h: 18,
            },
        ],
    });
    makeMotes(Math.round(310 * DENSITY), { // near-still glowworm twinkle clinging high on the dark ceiling/walls
        sizeMin: 0.05, sizeMax: 0.14, rise: 0.002, spanY: 12, baseY: 22, spread: 62, depth: [-42, -220], palette: [0xbff0ff, PAL.cyan], op: 0.68,
    });

    // ═══ CAVE ROCK KIT — load Blender-sculpted (fBM) + PolyHaven cliff_side GLB ═════
    // Real 3D rock meshes replace the old procedural "triangle mess". Each queued
    // placement gets a rock-variant clone with a stylised material: the cliff_side
    // diffuse provides surface detail, deep-blue cave tint + fresnel rim + fog.
    {
        const rockLoader = new GLTFLoader();
        rockLoader.load(caveRocksUrl, (gltf) => {
            const pool = [];
            gltf.scene.traverse((o) => {
                if (o.isMesh && o.geometry) pool.push({ geo: o.geometry, map: (o.material && o.material.map) || null });
            });
            if (!pool.length) return;
            // pool order (PolyHaven CC0): 0 coastal_cliff · 1 coast_land_rocks(flat) ·
            // 2 mountainside · 3 boulder · 4 moon_rock. Mapped to roles by placement.
            const at = (i) => pool[i] || pool[0];
            const pickEntrySeeded = (opts, rand) => {
                if (Number.isInteger(opts.variant)) return at(opts.variant);
                if (opts.role === 'slab' || opts.role === 'ceiling') return at(1);
                if (opts.role === 'wall') return rand < 0.56 ? at(0) : at(2);
                if (opts.role === 'foreground') return rand < 0.75 ? at(4) : at(3);
                const flat = opts.flatTop || (opts.squashY && opts.squashY < 0.6) || (opts.scale && opts.scale[1] < 0.7);
                const tall = (opts.scale && opts.scale[1] > 1.3) || (opts.squashY && opts.squashY > 1.3);
                if (flat) return at(1); // flat rock formation → ledges / island tops
                if (tall) return rand < 0.5 ? at(0) : at(2); // cliff / mountainside → walls
                return rand < 0.5 ? at(3) : at(4); // boulder / moon-rock → foreground
            };
            const rockGlbMat = (opts = {}, matOpts = {}, map = null) => {
                const mat = track(new T.MeshBasicNodeMaterial());
                const V = normalize(cameraPosition.sub(positionWorld));
                const up = max(dot(faceN, vec3(0, 1, 0)), float(0.0)).mul(0.85).add(0.15); // Higher contrast flat shading
                const fres = pow(clamp(float(1.0).sub(dot(faceN, V)), 0.0, 1.0), float(matOpts.rimPow || 2.4));
                const detailGain = matOpts.detailGain ?? opts.detailGain ?? 0.86;
                const detailLift = matOpts.detailLift ?? opts.detailLift ?? 0.22;
                const brightness = matOpts.brightness ?? opts.brightness ?? 1.0;
                const tintHex = matOpts.tintHex ?? opts.baseHex ?? PAL.rockBlue;
                const detail = map ? texture(map, uv()).rgb.mul(detailGain).add(detailLift) : vec3(0.66);
                // photoscanned rock detail × deep-blue cave tint × up-light + violet bounce
                let col = cv(tintHex).mul(detail).mul(up.mul(0.64).add(0.24)).mul(brightness * 1.7);
                col = col.add(cv(PAL.rockViolet).mul(0.035));
                const rimCol = mix(cv(matOpts.rim2Hex || PAL.rimViolet), cv(matOpts.rimHex || PAL.rimCyan), clamp(up, 0.0, 1.0));
                col = col.add(rimCol.mul(fres).mul(matOpts.rimStr ?? 0.5));
                const f = getFogFactor();
                mat.colorNode = distFog(col, f);
                mat.emissiveNode = vec3(0.0);
                mat.side = T.DoubleSide;
                return mat;
            };
            rockQueue.forEach(({ group, opts, matOpts }) => {
                const seed = opts.seed ?? Math.round(group.position.x * 17 + group.position.z * 31);
                let s = Math.abs(seed) || 1;
                const nextRandom = () => {
                    s = Math.sin(s) * 10000;
                    return s - Math.floor(s);
                };
                const rand1 = nextRandom();
                const rand2 = nextRandom();
                const rand3 = nextRandom();
                const rand4 = nextRandom();

                const e = pickEntrySeeded(opts, rand1);
                const baseR = opts.baseR || 14;
                const m = new T.Mesh(e.geo, rockGlbMat(opts, matOpts, e.map));
                m.scale.setScalar(baseR / 2.0); // PolyHaven rock max-dim ~4 → baseR scale
                m.rotation.set(
                    (opts.meshRotX ?? 0) + (rand2 - 0.5) * 0.16,
                    (opts.meshRotY ?? 0) + rand3 * 6.283,
                    (opts.meshRotZ ?? 0) + (rand4 - 0.5) * 0.16,
                );
                if (opts.meshLift) m.position.y += opts.meshLift;
                m.frustumCulled = false;
                group.add(m);
            });
            console.log('[biolum2] placed', rockQueue.length, 'PolyHaven rock meshes');
        }, undefined, (e) => console.warn('[biolum2] cave_rocks GLB load failed', e));
    }

    // ═══ POST — non-MRT thresholded bloom + ACES + violet/cyan grade + vignette ════
    let postProcessing = null;
    let bloomNode = null;
    // Published to the theme wrapper for its warm compile — see `getPostStack` on the runtime.
    let postStack = null;
    const useBloom = !P.has('nobloom');
    if (useBloom) {
        const useMRT = P.has('mrt');
        postProcessing = new T.RenderPipeline(renderer);
        const scenePass = pass(scene, camera);
        let bloomSource;
        if (useMRT) {
            scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
            bloomSource = scenePass.getTextureNode('emissive');
        } else {
            bloomSource = scenePass.getTextureNode('output');
        }
        const sceneColor = scenePass.getTextureNode('output');
        // higher threshold + moderate strength → many small local blooms, no central wash
        bloomNode = bloom(bloomSource, 0.72, 0.78, useMRT ? 0.0 : 0.42);
        const lit = sceneColor.add(bloomNode);

        const vuv = viewportUV;
        const vd = vuv.sub(vec2(0.5, 0.5));
        const vyW = max(vd.y, vd.y.mul(1.85)); // darken the bottom corners harder
        const dist = length(vec2(vd.x, vyW));
        const vig = smoothstep(0.98, 0.26, dist).mul(0.48).add(0.48); // stronger cavern enclosure

        const exposed = lit.rgb.mul(vig).mul(float(1.0));
        const acesNum = exposed.mul(exposed.mul(2.51).add(0.03));
        const acesDen = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
        let toned = clamp(acesNum.div(acesDen), 0.0, 1.0);
        const coolTint = vec3(0.93, 0.97, 1.12);
        const luma = dot(toned, vec3(0.299, 0.587, 0.114));
        const shadowLift = float(1.0).sub(smoothstep(0.0, 0.4, luma));
        toned = mix(toned, toned.mul(coolTint), float(0.46));
        toned = toned.add(vec3(0.01, 0.007, 0.04).mul(shadowLift).mul(0.72)); // cool blue shadows
        const sat = mix(vec3(luma), toned, float(1.28));
        const dth = fract(sin(dot(vuv.mul(317.0), vec2(127.1, 269.5))).mul(43758.5)).sub(0.5).mul(0.004);
        postProcessing.outputNode = vec4(clamp(sat.add(vec3(dth)), 0.0, 1.0), 1.0);
        // Exposed for the theme's warm compile: `compileGroupThroughPost` reads
        // `postProcessingStack.scenePass.renderTarget` and `.getMRT()` and nothing else
        // (post-target-compile.js:72-86), so publishing the pass is the whole contract.
        postStack = { scenePass };
    }

    // ── pointer parallax + camera ───────────────────────────────────────────────
    const mouse = {
        x: 0, y: 0, tx: 0, ty: 0,
    };
    const onPointer = (e) => {
        mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (typeof window !== 'undefined') window.addEventListener('pointermove', onPointer);

    let lastT = 0;

    return {
        cameraRadius: 62,
        camera(time, cam) {
            mouse.x += (mouse.tx - mouse.x) * 0.04;
            mouse.y += (mouse.ty - mouse.y) * 0.04;
            // Elevated, looking down the winding river into the misty depth.
            // Stable, level establishing framing to match the reference composition.
            const sway = Math.sin(time * 0.03) * 0.7 + mouse.x * 2.0;
            const lift = 7.6 - mouse.y * 1.0 + Math.sin(time * 0.03) * 0.24;
            const dolly = Math.sin(time * 0.025) * 0.55;
            cam.position.set(sway + 1.0, lift, 48 + dolly);
            cam.lookAt(7.0 + mouse.x * 1.1, 9.4 + mouse.y * 0.7, -118);
            for (let i = 0; i < glowBillboards.length; i++) glowBillboards[i].quaternion.copy(cam.quaternion);
        },
        update(time) {
            const dt = Math.min(0.05, Math.max(0, time - lastT));
            lastT = time;
            uTime.value = time;
            uEnergy.value = Math.max(0, uEnergy.value - dt * 0.6);
            uPulse.value = Math.max(0, uPulse.value - dt * 2.5);
        },
        pulse(kind) {
            if (kind === 'pieceLock') uPulse.value = 1.0;
            else if (kind === 'combo') uEnergy.value = Math.min(1.0, uEnergy.value + 0.35);
            else if (kind === 'lineClear') uEnergy.value = Math.min(1.0, uEnergy.value + 0.5);
            else uEnergy.value = Math.min(1.0, uEnergy.value + 0.25);
        },
        setReactive(s) {
            if (!s) return;
            if (typeof s.energy === 'number') uEnergy.value = s.energy;
            if (typeof s.pulse === 'number') uPulse.value = s.pulse;
            if (s.accent) uAccent.value.set(s.accent.r, s.accent.g, s.accent.b);
        },
        getPostStack: () => postStack,
        render() {
            if (postProcessing) postProcessing.render();
            else renderer.render(scene, camera);
        },
        renderAsync() {
            // Host awaited renderer.init() before mounting; sync render, Promise-shaped.
            if (postProcessing) postProcessing.render();
            else renderer.render(scene, camera);
            return Promise.resolve();
        },
        resize() { /* camera aspect handled by host */ },
        dispose() {
            if (typeof window !== 'undefined') window.removeEventListener('pointermove', onPointer);
            objects.forEach((o) => scene.remove(o));
            disposeBloomNodeDeep(bloomNode);
            postProcessing?.dispose?.();
            disposables.forEach((d) => { try { d.dispose?.(); } catch (e) { /* noop */ } });
        },
    };
}
