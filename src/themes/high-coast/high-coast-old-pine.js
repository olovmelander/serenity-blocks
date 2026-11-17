/**
 * High Coast — the old pine on the knoll left of the eye, as authored in Blender.
 *
 * An old Scots pine as the High Coast grows them on bare granite (scripts/blender/high_coast):
 * a stout bole that leans out toward the light, heavy limbs that leave it nearly level and turn up
 * at their ends, the silver stubs and one bare limb of what the crown outgrew, and the needles as
 * clouds of bottlebrush shoots at the branch ends. The lens holds its lower eleven metres: the
 * bole, the lowest limbs and the underside of the crown are what the picture is made of.
 *
 *  - Bark: one mesh. Its colour carries sway, limb phase, the baked occlusion and where the bark
 *    turns from the bole's grey-brown plates to the thin orange bark above; `_wood` marks the dead
 *    silver wood and how far a vertex follows the rock (the roots are laid on the summit's own
 *    relief when the tree is built). The plates, the flakes and the dead wood's grain are drawn
 *    in the bark's own coordinates and raise the surface: the sun rakes across them.
 *  - Needles: every spray of the crown is one instance of two shared meshes: a twig, and a dozen
 *    bottlebrush shoots that turn up to the light, each two slim ribbons crossed about the shoot
 *    and carrying the drawn bottlebrush of high-coast-pine.js (bakeNeedleTexture), cut out by its
 *    coverage, so the needles are lines, not cards' edges. A spray carries how much sky it sees
 *    and the direction it is open to, so the crown shades as clouds with dark hearts; a needle is
 *    thin, so the sun comes through the cloud it lights, and with the sun beyond the crown its
 *    edge glows yellow-green. A tier keeps a share of the sprays, each a little larger.
 *  - Shadow: the summit patch of high-coast-pine.js, its casters the crown's sprays gathered
 *    into plates and the bole.
 *
 * The tree stands in the frame it was authored in: +X the view's right, +Z toward the eye, the
 * rock at y = 0.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cross,
    dFdx,
    dFdy,
    dot,
    float,
    fwidth,
    instancedBufferAttribute,
    mix,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { EYE } from './high-coast-core.js';
import { hcCells } from './high-coast-land.js';
import { aerial } from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';
import {
    PINE_SHADOW, bakeNeedleTexture, pineFrame, pineSway, shadowPatch,
} from './high-coast-pine.js';
import { attributeFloats } from '../shared/attribute-floats.js';

/**
 * The crown: the share of its sprays a tier keeps when the tier does not say (`tier.sprays`), by
 * props level; how much a kept spray grows as the share falls; how far a spray reaches from its
 * site (a share of its scale); the plates its shadow is cast by.
 */
export const OLD_PINE = Object.freeze({
    keep: Object.freeze([0.3, 0.55, 0.85]), grow: 0.36, reach: 0.62, plates: 52,
});

/** The drawn bottlebrush of a small shoot: bushier than the built pine's open cards. */
export const OLD_PINE_BRUSH = Object.freeze({ pairs: 64, thick: 1.15, full: 0.45 });

/** The yaw that turns the tree's +Z to the eye. */
export function oldPineYaw(footX, footZ) {
    return Math.atan2(EYE.x - footX, EYE.z - footZ);
}

/** Deterministic 0..1 hash for choosing which sprays a tier keeps. */
function keepHash(index, salt) {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/** The sprays a tier keeps: their site indices, in order. */
export function keptSprays(count, keep) {
    const out = [];
    for (let i = 0; i < count; i += 1) if (keepHash(i, 1) <= keep) out.push(i);
    return out;
}

/**
 * Lay the roots on the rock: every bark vertex that follows the ground (the roots, the foot of
 * the bole) is moved by the summit's height where it stands, less the height at the foot.
 */
export function seatOnRock(pine, frame, ground) {
    const { position, _wood: wood } = pine.bark.attributes;
    const follow = attributeFloats(wood, 2);
    const p = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
        const share = follow[i * 2 + 1];
        if (share > 0) {
            p.fromBufferAttribute(position, i).applyMatrix4(frame.matrix);
            position.setY(i, position.getY(i) + (ground(p.x, p.z) - frame.foot.y) * share);
        }
    }
    position.needsUpdate = true;
    pine.bark.computeBoundingSphere();
}

/**
 * The shadow's casters in the world: the crown's sprays gathered into `plates` plates (centre,
 * radius; flattened by the patch) and spheres along the bole (negative radius: round, nearly
 * opaque). The plates are found by farthest-point seeding and a few rounds of nearest-centre
 * averaging: the same plates every time.
 */
export function crownCasters(pine, frame, plates = OLD_PINE.plates) {
    const { sites } = pine;
    const n = sites.count;
    const k = Math.min(plates, n);
    const cx = new Float32Array(k);
    const cy = new Float32Array(k);
    const cz = new Float32Array(k);
    const nearest = new Float32Array(n).fill(Infinity);
    const owner = new Int32Array(n);
    const at = (i, c) => {
        const dx = sites.position[i * 3] - cx[c];
        const dy = sites.position[i * 3 + 1] - cy[c];
        const dz = sites.position[i * 3 + 2] - cz[c];
        return dx * dx + dy * dy + dz * dz;
    };
    let seed = 0;
    for (let c = 0; c < k; c += 1) {
        cx[c] = sites.position[seed * 3];
        cy[c] = sites.position[seed * 3 + 1];
        cz[c] = sites.position[seed * 3 + 2];
        let far = -1;
        for (let i = 0; i < n; i += 1) {
            const d = at(i, c);
            if (d < nearest[i]) nearest[i] = d;
            if (nearest[i] > far) {
                far = nearest[i];
                seed = i;
            }
        }
    }
    const sx = new Float32Array(k);
    const sy = new Float32Array(k);
    const sz = new Float32Array(k);
    const members = new Int32Array(k);
    for (let round = 0; round < 4; round += 1) {
        sx.fill(0);
        sy.fill(0);
        sz.fill(0);
        members.fill(0);
        for (let i = 0; i < n; i += 1) {
            let best = 0;
            let bestD = Infinity;
            for (let c = 0; c < k; c += 1) {
                const d = at(i, c);
                if (d < bestD) {
                    bestD = d;
                    best = c;
                }
            }
            owner[i] = best;
            sx[best] += sites.position[i * 3];
            sy[best] += sites.position[i * 3 + 1];
            sz[best] += sites.position[i * 3 + 2];
            members[best] += 1;
        }
        for (let c = 0; c < k; c += 1) {
            if (members[c]) {
                cx[c] = sx[c] / members[c];
                cy[c] = sy[c] / members[c];
                cz[c] = sz[c] / members[c];
            }
        }
    }
    // A plate reaches as far as its sprays lie from its middle (level), and a spray's own reach on.
    const spread = new Float32Array(k);
    for (let i = 0; i < n; i += 1) {
        const c = owner[i];
        const dx = sites.position[i * 3] - cx[c];
        const dz = sites.position[i * 3 + 2] - cz[c];
        spread[c] += dx * dx + dz * dz;
    }
    const rows = [];
    const v = new THREE.Vector3();
    for (let c = 0; c < k; c += 1) {
        if (members[c]) {
            v.set(cx[c], cy[c], cz[c]).applyMatrix4(frame.matrix);
            rows.push(new THREE.Vector4(v.x, v.y, v.z, Math.sqrt(spread[c] / members[c]) * 1.35 + 0.55));
        }
    }
    for (const [x, y, z, r] of pine.trunkLine) {
        v.set(x, y, z).applyMatrix4(frame.matrix);
        rows.push(new THREE.Vector4(v.x, v.y, v.z, -r * 0.95));
    }
    return rows.slice(0, PINE_SHADOW.rows);
}

// ── Materials ────────────────────────────────────────────────────────────────────────

/** The bark: plates low on the bole, thin orange flakes above, silver dead wood. */
function barkMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastOldPineBark';
    material.fog = false;
    const paint = attribute('color', 'vec4'); // sway, limb phase, occlusion, 0 plated … 1 orange
    const wood = attribute('_wood', 'vec2'); // dead wood, follows the rock
    material.positionNode = Fn(() => positionLocal.add(pineSway(u, positionLocal)))();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const smooth = normalize(normalWorld).toVar();
        const st = uv().toVar();
        const h = positionGeometry.y;
        const dead = wood.x;
        // Low on the bole: long plates parted by deep furrows, each plate its own grey-brown.
        const warp = texture(t.noise, st.mul(vec2(1.0, 0.4))).g.sub(0.5);
        const plates = hcCells(vec2(st.x.add(warp.mul(0.07)).mul(13.0), st.y.mul(4.4))).toVar();
        const wide = texture(t.noise, st.mul(vec2(2.0, 1.0))).b;
        const plateUp = smoothstep(wide.mul(0.06).add(0.03), wide.mul(0.3).add(0.2), plates.y.sub(plates.x)).toVar();
        const streak = texture(t.noise, st.mul(vec2(2.0, 0.5))).a.toVar();
        const rough = texture(t.noise, st.mul(vec2(6.0, 3.0))).a.toVar();
        const plateTone = mix(vec3(0.115, 0.094, 0.08), vec3(0.235, 0.19, 0.152), plates.z)
            .mul(streak.mul(0.3).add(0.78)).mul(rough.mul(0.36).add(0.8));
        const low = mix(vec3(0.05, 0.026, 0.017), plateTone, plateUp);
        // Higher: thin papery flakes, orange, a few silvered; each flake's edge a dark line.
        const flakeAt = vec2(st.x.mul(13.0), st.y.mul(30.0)).toVar();
        const flakes = hcCells(flakeAt).toVar();
        // A flake smaller than a pixel is its mean, not a sparkle (the limbs, from the eye).
        const fine = float(1.0).sub(smoothstep(0.3, 0.9, fwidth(flakeAt.x).max(fwidth(flakeAt.y)))).toVar();
        const flakeUp = mix(float(0.86), smoothstep(0.0, 0.07, flakes.y.sub(flakes.x)), fine).toVar();
        const flakeId = mix(float(0.45), flakes.z, fine).toVar();
        const flakeTone = mix(vec3(0.34, 0.14, 0.055), vec3(0.5, 0.245, 0.095), flakeId).mul(streak.mul(0.25).add(0.85));
        // A few flakes have lost their colour to the weather; the rest peel in thin dark-edged sheets.
        const silver = smoothstep(0.9, 0.96, flakeId);
        const high = mix(vec3(0.2, 0.08, 0.034), mix(flakeTone, vec3(0.36, 0.3, 0.25), silver.mul(0.5)), flakeUp);
        const toHigh = smoothstep(0.3, 0.7, paint.a.add(streak.sub(0.5).mul(0.25))).toVar();
        // Dead wood: silvered, split along its grain.
        const grain = texture(t.noise, st.mul(vec2(9.0, 0.6))).a.toVar();
        const deadTone = mix(vec3(0.15, 0.14, 0.128), vec3(0.34, 0.33, 0.31), grain).mul(rough.mul(0.3).add(0.8));
        const albedo = mix(mix(low, high, toHigh), deadTone, dead);
        // The surface the light sees: plates stand proud of their furrows, flakes a little, grain less.
        const relief = mix(mix(plateUp.add(rough.mul(0.18)), flakeUp.mul(0.34).add(rough.mul(0.1)), toHigh), grain.mul(0.3), dead)
            .toVar();
        const across = dFdx(P);
        const along = dFdy(P);
        const r1 = cross(along, smooth);
        const r2 = cross(smooth, across);
        const area = dot(across, r1);
        const slope = r1.mul(dFdx(relief)).add(r2.mul(dFdy(relief))).mul(area.sign());
        const n = normalize(smooth.mul(area.abs()).sub(slope.mul(0.085))).toVar();
        // Light: the sun raking the relief on a bole that turns softly into its own shade (the
        // crown shades what stands inside it), the sky, the rock's bounce, a rim against the sun.
        const L = u.sunDir;
        const round = clamp(dot(smooth, L).add(0.3).div(1.3), 0.0, 1.0);
        const rake = clamp(dot(n, L), 0.0, 1.0);
        const shadow = shadowAt(t.shadow, P.xz);
        const ao = paint.b;
        const crown = mix(float(1.0), ao.mul(ao), smoothstep(6.4, 9.6, h).mul(0.8));
        const direct = u.sun.mul(rake.mul(0.72).add(round.mul(0.28))).mul(round.mul(1.6).min(1.0)).mul(shadow).mul(u.sunUp)
            .mul(crown);
        // A furrow sees less sky than the plate beside it.
        const cavity = mix(float(1.0), relief.mul(0.5).add(0.5), float(1.0).sub(toHigh).mul(float(1.0).sub(dead)));
        const sky = u.fill.mul(n.y.mul(0.35).add(0.65)).mul(mix(float(1.0), ao, 0.7)).mul(cavity);
        const bounce = u.bounce.mul(clamp(n.y.negate(), 0.0, 1.0).mul(0.55).add(0.3)).mul(ao.mul(0.5).add(0.5)).mul(cavity);
        const view = normalize(P.sub(u.eye));
        const grazing = float(1.0).sub(abs(dot(smooth, view)));
        const rim = grazing.mul(grazing).mul(grazing).mul(clamp(dot(view, L), 0.0, 1.0)).mul(shadow);
        const lit = albedo.mul(direct.add(sky).add(bounce))
            .add(u.sun.mul(u.sunUp).mul(albedo).mul(rim).mul(1.2));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    return material;
}

/**
 * The needle sprays: instanced ribbons carrying the drawn bottlebrush, shaded as the cloud each
 * belongs to. With `coverage` (a multisampled scene pass) the cut is three's alpha-to-coverage
 * one: each needle's edge covers some of the pixel's samples instead of all or none.
 */
function needleMaterial(u, t, buffers, needles, coverage = false) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HighCoastOldPineNeedles';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const crown = instancedBufferAttribute(buffers.crown); // sky, sway, phase, hue
    const bent = instancedBufferAttribute(buffers.bent); // the open direction (world), depth in the crown
    const paint = attribute('color', 'vec4'); // 0 on the shoot … 1 at the ribbon's edge, shoot id, shade, needle (1) or wood (0)
    const card = texture(needles, uv()); // the needles' tone, the drawn twig, -, coverage
    // The twig that carries the shoots is solid wood: only the ribbons are cut out.
    const cover = mix(float(1.0), card.a, paint.a);
    if (coverage) {
        material.alphaTest = 0.5;
        material.alphaToCoverage = true;
    } else {
        material.maskNode = cover.greaterThan(0.5);
    }
    material.positionNode = Fn(() => {
        const p = positionLocal;
        // The needles shiver at their tips on top of the crown's sway, harder in a gust.
        const flutter = sin(u.time.mul(paint.g.mul(2.0).add(2.6)).add(paint.g.mul(41.0)).add(crown.z.mul(13.0)))
            .mul(paint.r).mul(paint.a).mul(u.gale.mul(0.03).add(0.006));
        return p.add(pineSway(u, p)).add(vec3(flutter, flutter.mul(0.6), flutter.mul(0.7)));
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld;
        const blade = normalize(normalWorld).toVar();
        const mass = normalize(mix(blade, bent.xyz, 0.72)).toVar();
        const open = crown.x.toVar();
        // Needles: spray by spray somewhere between a dark blue-green and olive, the year's growth
        // at the tips lighter; the twig that carries them brown.
        // (How far out on its needles a point is: the ribbon's edge.)
        const tip = uv().x.sub(0.5).abs().mul(2.0).toVar();
        const tone = clamp(crown.w.mul(0.34).add(paint.g.mul(0.16)).add(open.mul(0.34)).add(tip.mul(0.22)), 0.0, 1.0);
        const green = mix(vec3(0.016, 0.03, 0.021), vec3(0.084, 0.116, 0.04), tone);
        const needle = mix(green.mul(card.r.mul(0.8).add(0.5)), vec3(0.085, 0.05, 0.028), card.g.mul(0.85));
        const albedo = mix(vec3(0.09, 0.05, 0.028), needle, paint.a).mul(paint.b);
        // The cloud as a mass: wrap light round it, less of it in the crown's heart.
        const L = u.sunDir;
        const wrap = clamp(dot(mass, L).mul(0.7).add(0.3), 0.0, 1.0);
        const facing = dot(blade, L);
        const exposed = smoothstep(0.02, 0.6, open).mul(0.84).add(0.16);
        const shadow = shadowAt(t.shadow, P.xz);
        const direct = u.sun.mul(wrap).mul(facing.abs().mul(0.9).add(0.55)).mul(exposed).mul(shadow)
            .mul(u.sunUp);
        const sky = u.fill.mul(mass.y.mul(0.3).add(0.7)).mul(open.mul(0.6).add(0.4));
        // The pale rock under the crown throws the sun back up into it.
        const bounce = u.bounce.mul(clamp(mass.y.negate(), 0.0, 1.0).mul(0.75).add(0.2));
        const lit = albedo.mul(direct.add(sky).add(bounce)).toVar();
        const view = normalize(P.sub(u.eye));
        // A needle is thin: the sun on a cloud's far side comes through it, warm green, to the eye
        // beneath (less of it in the crown's heart).
        const behind = clamp(facing.negate(), 0.0, 1.0).mul(0.6).add(0.25).mul(wrap.mul(0.5).add(0.5))
            .mul(exposed);
        lit.addAssign(u.sun.mul(u.sunUp).mul(shadow).mul(green).mul(vec3(1.25, 1.5, 0.5))
            .mul(behind)
            .mul(paint.a)
            .mul(card.g.oneMinus())
            .mul(0.5));
        // Needles are waxed: the sunlit side of a cloud carries a pale sheen.
        const graze = float(1.0).sub(abs(dot(blade, view)));
        lit.addAssign(u.sun.mul(u.sunUp).mul(shadow).mul(wrap).mul(exposed)
            .mul(graze.mul(graze))
            .mul(paint.a)
            .mul(0.012));
        // With the sun beyond the crown its thin edge glows: light through the needles, yellow-green.
        const forward = clamp(dot(view, L), 0.0, 1.0);
        const f2 = forward.mul(forward);
        const through = f2.mul(f2).mul(forward).mul(tip.mul(0.7).add(0.3)).mul(paint.a)
            .mul(open.mul(0.6).add(0.4));
        lit.addAssign(u.sun.mul(u.sunUp).mul(shadow).mul(vec3(0.3, 0.4, 0.1)).mul(through)
            .mul(0.55));
        // Under alpha-to-coverage the ribbon's alpha is the needles' coverage of the pixel.
        return vec4(aerial(u, P, lit), coverage ? cover : 1.0);
    })();
    return material;
}

// ── The tree ─────────────────────────────────────────────────────────────────────────

/**
 * The old pine from its authored assets (`trees.pine`, `trees.foliage`): `ground(x, z)` gives the
 * summit's height, `foot` where the bole meets the rock. Returns its meshes (the tree's group, and
 * on props tiers ≥ 1 the shadow patch). `coverage`: the scene pass is multisampled, so the needles
 * cut out by alpha-to-coverage. The geometry belongs to the assets: it is not disposed here.
 */
export function* createOldPineSteps(u, t, tier, ground, foot, trees, { coverage = false } = {}) {
    const { pine, foliage } = trees;
    const frame = pineFrame(foot.x, foot.y, foot.z, oldPineYaw(foot.x, foot.z));
    seatOnRock(pine, frame, ground);
    const level = Math.min(2, Math.max(0, tier.props ?? 1));
    const barkMat = barkMaterial(u, t);
    const bark = new THREE.Mesh(pine.bark, barkMat);
    bark.name = 'HighCoastOldPineBark';
    // The lowest tier leaves the twigs out (the sprays stand where they were).
    const twigless = pine.barkLevelIndices[2];
    if (level === 0 && twigless > 0 && twigless < pine.bark.index.count) pine.bark.setDrawRange(0, twigless);
    yield 'bark';

    const group = new THREE.Group();
    group.name = 'HighCoastOldPine';
    group.position.copy(frame.foot);
    group.rotation.y = frame.yaw;
    bark.frustumCulled = false;
    bark.renderOrder = 3;
    group.add(bark);
    const { texture: needleTex } = bakeNeedleTexture(level > 0 ? 128 : 64, 0x5e1, OLD_PINE_BRUSH);
    const disposables = [barkMat, needleTex];
    yield 'needle texture';

    // The sprays a tier keeps, in two shared draws (one per spray variant).
    const { sites } = pine;
    const keep = Math.min(1, Math.max(0.05, tier.sprays ?? OLD_PINE.keep[level]));
    const grow = (1 / keep) ** OLD_PINE.grow;
    const kept = keptSprays(sites.count, keep);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), frame.yaw);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const open = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    let sprays = 0;
    let triangles = 0;
    for (let variant = 0; variant < foliage.variants; variant += 1) {
        const geometry = foliage.meshes[`${pine.foliage}_${variant}`];
        if (!geometry) throw new Error(`[High Coast] Needle spray "${pine.foliage}_${variant}" is missing from the asset pack.`);
        const mine = kept.filter((i) => sites.variant[i] % foliage.variants === variant);
        const count = Math.max(1, mine.length);
        const crown = new Float32Array(count * 4);
        const bent = new Float32Array(count * 4);
        const buffers = {
            crown: new THREE.InstancedBufferAttribute(crown, 4),
            bent: new THREE.InstancedBufferAttribute(bent, 4),
        };
        const material = needleMaterial(u, t, buffers, needleTex, coverage);
        const mesh = new THREE.InstancedMesh(geometry, material, count);
        mesh.name = `HighCoastOldPineNeedles${variant}`;
        mine.forEach((i, at) => {
            position.fromArray(sites.position, i * 3);
            rotation.fromArray(sites.rotation, i * 4);
            matrix.compose(position, rotation, scale.setScalar(sites.scale[i] * grow));
            mesh.setMatrixAt(at, matrix);
            crown.set([sites.sky[i], sites.sway[i], sites.phase[i], sites.hue[i]], at * 4);
            open.fromArray(sites.bent, i * 3).applyQuaternion(yaw);
            bent.set([open.x, open.y, open.z, 1 - sites.sky[i]], at * 4);
        });
        if (!mine.length) mesh.setMatrixAt(0, matrix.makeScale(0, 0, 0));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.renderOrder = 3;
        group.add(mesh);
        disposables.push(material, mesh);
        sprays += mine.length;
        triangles += (geometry.index.count / 3) * mine.length;
        yield 'needles';
    }

    const meshes = [group];
    if (level > 0) {
        const patch = shadowPatch(u, t, ground, crownCasters(pine, frame), frame);
        meshes.push(patch.mesh);
        disposables.push(patch.geometry, patch.material);
    }
    return {
        group,
        meshes,
        frame,
        sprays,
        triangles,
        dispose() {
            for (const d of disposables) d.dispose();
            pine.bark.setDrawRange(0, Infinity);
        },
    };
}
