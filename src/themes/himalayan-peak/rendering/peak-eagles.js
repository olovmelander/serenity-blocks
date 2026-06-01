/* eslint-disable import/no-unresolved */
/**
 * Himalayan Peak AAA — Eagles
 *
 * A few birds soaring across the valley — not a flock. Two real models:
 *   • EAGLE  — a PROCEDURAL articulated eagle (hero). Authored in a known frame
 *     (head +Z, up +Y, wings ±X) so there's no orientation guesswork. Broad
 *     wings with a swept tip, fanned tail, small head, thin cambered profile.
 *     The flap is research-correct (avian wing kinematics): each wing ROTATES
 *     about a shoulder pivot in an arc (not a shear), the tips LAG the root
 *     (traveling-wave flex like a 2-segment wing), a downstroke TWIST changes the
 *     angle of attack, and a resting DIHEDRAL gives the soaring V — mostly a
 *     gentle glide with occasional deep beats, faster/deeper on combos.
 *   • STORK  — three.js example flyer (morph wing-flap) for variety.
 *
 * Both render as dark silhouettes and share a lively crossing flight (travel +
 * altitude undulation + nose pitch + banking roll). One flies by every so often;
 * an extra sweeps in on a big combo.
 *
 * See assets/ATTRIBUTION.md and docs/HIMALAYAN_PEAK_AAA_PLAN.md §3.4.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn, abs, attribute, cos, float, mix, positionLocal, sin, smoothstep, uniform, vec3,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import storkUrl from '../assets/Stork.glb?url';

const TARGET_SIZE = 40; // world units (largest dimension)

// ── Procedural eagle geometry (canonical: head +Z, up +Y, wings ±X). ──
const SHOULDER_X = 0.10; // wing root offset from body centreline
const TIP_X = 1.0; // wingtip x → wingspan = 2.0

function buildEagleGeometry() {
    const positions = [];
    const aWing = []; // -1 left, 0 body/tail, +1 right
    const aSpan = []; // 0 shoulder → 1 wingtip (0 for non-wing)
    const indices = [];
    const push = (x, y, z, w, s) => {
        positions.push(x, y, z); aWing.push(w); aSpan.push(s);
        return positions.length / 3 - 1;
    };

    // ── Wings (grid per side). Planform: broad inner wing, swept narrow tip. ──
    const nSpan = 9;
    const nChord = 5;
    [-1, 1].forEach((side) => {
        const base = positions.length / 3;
        for (let i = 0; i < nSpan; i += 1) {
            const s = i / (nSpan - 1);
            const zMid = -0.10 - 0.40 * s * s; // chord centre sweeps back toward tip
            const w = 0.70 * (1 - 0.72 * s); // chord narrows toward tip
            const camber = 0.05 * (1 - 0.5 * s);
            for (let jc = 0; jc < nChord; jc += 1) {
                const c = jc / (nChord - 1); // 0 leading(+z) → 1 trailing(-z)
                const x = side * (SHOULDER_X + s * (TIP_X - SHOULDER_X));
                const z = zMid + (0.5 - c) * w;
                const y = camber * Math.sin(c * Math.PI); // slight up-camber
                push(x, y, z, side, s);
            }
        }
        for (let i = 0; i < nSpan - 1; i += 1) {
            for (let jc = 0; jc < nChord - 1; jc += 1) {
                const a = base + i * nChord + jc;
                const b = a + 1;
                const cc = a + nChord;
                const d = cc + 1;
                indices.push(a, cc, b, b, cc, d);
            }
        }

        // Splayed primary "fingers" at the wingtip — the slotted raptor silhouette.
        // Each is a slim swept feather; aSpan=1 so they flap with the wingtip.
        const N_FINGERS = 4;
        for (let f = 0; f < N_FINGERS; f += 1) {
            const t = N_FINGERS > 1 ? f / (N_FINGERS - 1) : 0;
            const rootZ = -0.40 - 0.20 * t; // along the tip chord (leading→trailing)
            const rootX = side * (0.90 + 0.06 * t);
            const halfW = 0.022;
            const len = 0.17 + 0.10 * Math.sin(t * Math.PI); // middle fingers longest
            const fingerX = side * (TIP_X + 0.02 + 0.07 * t); // splay outward
            const fingerZ = rootZ - len; // sweep back
            const a = push(rootX, 0.02, rootZ + halfW, side, 1.0);
            const b = push(rootX, 0.02, rootZ - halfW, side, 1.0);
            const c = push(fingerX, 0.025, fingerZ, side, 1.0);
            indices.push(a, b, c);
        }
    });

    // ── Body (low-poly spindle: head point → tail base). ──
    const rings = [
        { z: 0.62, r: 0.0 }, // head point
        { z: 0.34, r: 0.075 },
        { z: 0.04, r: 0.090 },
        { z: -0.26, r: 0.055 },
        { z: -0.50, r: 0.028 }, // tail base
    ];
    const radial = 6;
    const ringBase = [];
    rings.forEach((ring, ri) => {
        ringBase[ri] = positions.length / 3;
        if (ring.r === 0) {
            push(0, 0, ring.z, 0, 0);
            return;
        }
        for (let k = 0; k < radial; k += 1) {
            const a = (k / radial) * Math.PI * 2;
            push(Math.cos(a) * ring.r, Math.sin(a) * ring.r * 0.85, ring.z, 0, 0);
        }
    });
    for (let ri = 0; ri < rings.length - 1; ri += 1) {
        const cur = rings[ri];
        const a0 = ringBase[ri];
        const a1 = ringBase[ri + 1];
        if (cur.r === 0) {
            for (let k = 0; k < radial; k += 1) {
                indices.push(a0, a1 + k, a1 + ((k + 1) % radial));
            }
        } else {
            for (let k = 0; k < radial; k += 1) {
                const n = (k + 1) % radial;
                indices.push(a0 + k, a1 + k, a0 + n, a0 + n, a1 + k, a1 + n);
            }
        }
    }

    // ── Fanned tail. ──
    const tailCenter = push(0, 0, -0.50, 0, 0);
    const tailArc = [
        [-0.30, 0, -0.80], [-0.17, 0, -0.97], [0, 0, -1.02], [0.17, 0, -0.97], [0.30, 0, -0.80],
    ].map((p) => push(p[0], p[1], p[2], 0, 0));
    for (let k = 0; k < tailArc.length - 1; k += 1) {
        indices.push(tailCenter, tailArc[k], tailArc[k + 1]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(aWing, 1));
    geometry.setAttribute('aSpan', new THREE.Float32BufferAttribute(aSpan, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    return geometry;
}

// Articulated flap material (per-eagle for its own phase). uTint/uWarmth let the
// backlit wingtips warm with the live sun during alpenglow.
function createProceduralEagleMaterial() {
    const uTime = uniform(0);
    const uPhase = uniform(0);
    const uScatter = uniform(0);
    const uTint = uniform(new THREE.Color(0xffe9cf));
    const uWarmth = uniform(0);

    const m = new MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    m.positionNode = Fn(() => {
        const side = attribute('aWing'); // -1 / 0 / +1
        const span = attribute('aSpan'); // 0 shoulder → 1 tip
        const isWing = abs(side);

        const flapSpeed = float(2.2).add(uScatter.mul(3.0));
        // Lazy deep-flap bursts between glides.
        const burst = smoothstep(float(0.35), float(0.98), sin(uTime.mul(0.4).add(uPhase)).mul(0.5).add(0.5));
        const amp = float(0.12).add(burst.mul(0.55)).add(uScatter.mul(0.4)); // radians
        const dihedral = float(0.14); // resting soaring V
        const phaseLag = span.mul(1.5); // tips lag the root → wing flexes
        const phase = uTime.mul(flapSpeed).add(uPhase).sub(phaseLag);
        const stroke = sin(phase);
        const flapAngle = dihedral.add(stroke.mul(amp));

        // Shoulder rotation about the fore-aft (Z) axis; mirrored per wing so both
        // tips rise together. Body (side 0) is untouched (ang = 0).
        const shoulderX = side.mul(SHOULDER_X);
        const dx = positionLocal.x.sub(shoulderX);
        const dy = positionLocal.y;
        const ang = flapAngle.mul(side).mul(isWing);
        const ca = cos(ang);
        const sa = sin(ang);
        const wingX = shoulderX.add(dx.mul(ca).sub(dy.mul(sa)));
        const wingY = dx.mul(sa).add(dy.mul(ca));

        // Downstroke twist: pitch the chord (z offset) into Y, scaled by span.
        const strokeVel = cos(phase);
        const twist = strokeVel.mul(span).mul(isWing).mul(0.12);
        // High-frequency primary flutter near the tips.
        const flutter = sin(uTime.mul(9.0).add(uPhase).add(span.mul(6.0)))
            .mul(0.014).mul(smoothstep(float(0.65), float(1.0), span)).mul(isWing);
        const finalY = wingY.add(positionLocal.z.add(0.1).mul(twist)).add(flutter);

        return vec3(wingX, finalY, positionLocal.z);
    })();
    m.colorNode = Fn(() => {
        const span = attribute('aSpan');
        const band = sin(span.mul(26.0)).mul(0.035); // faint feather banding
        const baseDark = vec3(0.05, 0.043, 0.037).add(band);
        // Backlit primaries: outer wing glows faintly, warmer as the sky warms.
        const tipGlow = smoothstep(float(0.55), float(1.0), span);
        const warmAmt = tipGlow.mul(uWarmth.mul(0.55).add(0.25)).mul(0.5);
        return mix(baseDark, uTint.mul(0.55), warmAmt);
    })();
    m.emissiveNode = vec3(0.0);
    m.userData.emitsBloom = false;
    return {
        material: m, uTime, uPhase, uScatter, uTint, uWarmth,
    };
}

function createGradientMaterial(grad) {
    const m = new MeshBasicNodeMaterial();
    m.colorNode = Fn(() => {
        const t = smoothstep(float(grad[0]), float(grad[1]), positionLocal.y);
        return mix(vec3(0.045, 0.038, 0.032), vec3(0.17, 0.14, 0.11), t);
    })();
    m.emissiveNode = vec3(0.0);
    m.userData.emitsBloom = false;
    return m;
}

export function createPeakEagles(opts = {}) {
    const group = new THREE.Group();
    group.frustumCulled = false;
    const maxEagles = Math.max(1, opts.maxEagles ?? 2);

    const variants = [];
    const active = [];
    let nextSpawnIn = 2 + Math.random() * 4;
    let comboCooldown = 0;

    const loader = new GLTFLoader();
    const _q = new THREE.Quaternion();
    const _fwd = new THREE.Vector3();
    const _box = new THREE.Box3();
    const _size = new THREE.Vector3();

    async function load() {
        // Procedural eagle (synchronous, the hero).
        const geo = buildEagleGeometry();
        geo.boundingBox.getSize(_size);
        variants.push({
            name: 'eagle',
            kind: 'proc',
            weight: 2,
            geometry: geo,
            clip: null,
            scale: TARGET_SIZE / (Math.max(_size.x, _size.y, _size.z) || 1),
            euler: [0, 0, 0],
            forward: new THREE.Vector3(0, 0, 1),
        });

        // Stork (async) for variety.
        try {
            const gltf = await loader.loadAsync(storkUrl);
            const root = gltf.scene;
            _box.setFromObject(root);
            _box.getSize(_size);
            const scale = TARGET_SIZE / (Math.max(_size.x, _size.y, _size.z) || 1);
            const material = createGradientMaterial([-8, 22]);
            root.traverse((o) => {
                if (o.isMesh) {
                    const old = Array.isArray(o.material) ? o.material : [o.material];
                    old.forEach((mm) => mm?.dispose && mm.dispose());
                    o.material = material;
                    o.frustumCulled = false;
                }
            });
            variants.push({
                name: 'stork',
                kind: 'gltf',
                weight: 1,
                scene: root,
                clip: gltf.animations?.[0] || null,
                scale,
                euler: [0, 0, 0],
                forward: new THREE.Vector3(0, 0, 1),
                sharedMaterial: material,
            });
        } catch (e) {
            console.warn('[HimalayanPeak] stork load failed:', e);
        }
    }

    function pickVariant() {
        if (variants.length === 0) return null;
        const total = variants.reduce((s, v) => s + v.weight, 0);
        let r = Math.random() * total;
        for (let i = 0; i < variants.length; i += 1) {
            r -= variants[i].weight;
            if (r <= 0) return variants[i];
        }
        return variants[variants.length - 1];
    }

    function spawn() {
        const v = pickVariant();
        if (!v || active.length >= maxEagles) return;

        let model;
        let mixer = null;
        let flapMat = null;
        let uTime = null;
        let uScatter = null;
        let uTint = null;
        let uWarmth = null;

        if (v.kind === 'proc') {
            const fm = createProceduralEagleMaterial();
            fm.uPhase.value = Math.random() * 6.2831;
            model = new THREE.Mesh(v.geometry, fm.material);
            flapMat = fm.material;
            ({
                uTime, uScatter, uTint, uWarmth,
            } = fm);
        } else {
            model = cloneHierarchy(v.scene);
            if (v.clip) {
                mixer = new THREE.AnimationMixer(model);
                const action = mixer.clipAction(v.clip);
                action.timeScale = 0.85 + Math.random() * 0.5;
                action.play();
            }
        }
        model.rotation.set(v.euler[0], v.euler[1], v.euler[2]);
        model.scale.setScalar(v.scale);
        model.frustumCulled = false;

        const pivot = new THREE.Group();
        pivot.add(model);

        const side = Math.random() > 0.5 ? 1 : -1;
        const baseY = 175 + Math.random() * 130;
        const z = -130 - Math.random() * 390;
        pivot.position.set(side * 1300, baseY, z);

        const speed = 130 + Math.random() * 80;
        const vel = new THREE.Vector3(-side * speed, 0, (Math.random() - 0.5) * speed * 0.22);

        group.add(pivot);
        active.push({
            pivot,
            mixer,
            flapMat,
            uTime,
            uScatter,
            uTint,
            uWarmth,
            forward: v.forward,
            vel,
            speed,
            age: 0,
            life: 45,
            baseY,
            bobPhase: Math.random() * 6.28,
            rollPhase: Math.random() * 6.28,
        });
    }

    function update(dt, time, scatter = 0, sunColor = null, warmth = 0) {
        if (variants.length === 0) return;
        comboCooldown = Math.max(0, comboCooldown - dt);

        nextSpawnIn -= dt;
        if (nextSpawnIn <= 0) {
            spawn();
            nextSpawnIn = 9 + Math.random() * 13;
        }
        if (scatter > 0.55 && comboCooldown <= 0) {
            spawn();
            comboCooldown = 5;
        }

        for (let i = active.length - 1; i >= 0; i -= 1) {
            const e = active[i];
            e.age += dt;
            if (e.mixer) e.mixer.update(dt);
            if (e.uTime) { e.uTime.value = time; e.uScatter.value = scatter; }
            if (e.uTint && sunColor) e.uTint.value.copy(sunColor);
            if (e.uWarmth) e.uWarmth.value = warmth;

            e.pivot.position.x += e.vel.x * dt;
            e.pivot.position.z += e.vel.z * dt;
            const climb = Math.cos(time * 0.5 + e.bobPhase);
            e.pivot.position.y = e.baseY
                + Math.sin(time * 0.5 + e.bobPhase) * 18
                + Math.sin(time * 0.23 + e.bobPhase * 1.7) * 8;

            _fwd.set(e.vel.x, climb * e.speed * 0.18, e.vel.z).normalize();
            _q.setFromUnitVectors(e.forward, _fwd);
            e.pivot.quaternion.copy(_q);
            e.pivot.rotateZ(Math.sin(time * 0.6 + e.rollPhase) * 0.2);

            if (Math.abs(e.pivot.position.x) > 1400 || e.age > e.life) {
                if (e.mixer) e.mixer.stopAllAction();
                if (e.flapMat) e.flapMat.dispose();
                group.remove(e.pivot);
                active.splice(i, 1);
            }
        }
    }

    return {
        group,
        load,
        spawn,
        update,
        dispose() {
            active.forEach((e) => {
                if (e.mixer) e.mixer.stopAllAction();
                if (e.flapMat) e.flapMat.dispose();
                group.remove(e.pivot);
            });
            active.length = 0;
            variants.forEach((v) => {
                if (v.kind === 'proc') v.geometry?.dispose();
                else {
                    v.scene?.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
                    v.sharedMaterial?.dispose();
                }
            });
            variants.length = 0;
        },
    };
}
