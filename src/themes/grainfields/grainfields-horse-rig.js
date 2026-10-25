/**
 * Grainfields — the horse's skeleton (CPU, three-free).
 *
 * The authored horse (scripts/blender/grainfields/horse.py) carries thirty-eight bones, each
 * resting aligned with the horse's own axes (x left, y up, z forward) at its head: the root, the
 * pelvis and the chest; three neck bones, the head at the atlas, the jaw, the ears; each fore
 * leg's scapula, humerus, forearm, cannon, pastern and hoof; each hind leg's femur, tibia,
 * cannon, pastern and hoof; six down the tail. A pose is each bone's turn about its head in its
 * parent's frame, as Euler angles applied pitch first (about x: positive tips +z down and swings
 * a hanging limb back), then roll (about z: positive leans +y toward +x), then yaw (about y:
 * positive turns +z toward +x, the horse's left). This module turns a pose and the horse's place
 * in the world into each joint's world position and rotation and the skinning table the vertex
 * stage blends (grainfields-herd.js); the same math poses the previews in horse.py.
 */

/** The bones the motion addresses, by name; the asset's own order is whatever it says. */
export const HORSE_BONES = Object.freeze([
    'root', 'pelvis', 'chest', 'neck0', 'neck1', 'neck2', 'head', 'jaw', 'earL', 'earR',
    'scapulaL', 'humerusL', 'forearmL', 'foreCannonL', 'forePasternL', 'foreHoofL',
    'scapulaR', 'humerusR', 'forearmR', 'foreCannonR', 'forePasternR', 'foreHoofR',
    'femurL', 'tibiaL', 'hindCannonL', 'hindPasternL', 'hindHoofL',
    'femurR', 'tibiaR', 'hindCannonR', 'hindPasternR', 'hindHoofR',
    'tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5',
]);

/** Rows (vec4) a bone takes in the skinning table: its rotation, then its translation and scale. */
export const SKIN_ROWS = 2;

/**
 * A rig from the asset's skeleton ([{ name, parent, head: [x, y, z] }], parents first). Throws when
 * a bone the motion needs is missing or a parent comes after its child.
 */
export function createRig(skeleton) {
    if (!Array.isArray(skeleton) || !skeleton.length) throw new Error('[Grainfields] The horse has no skeleton.');
    const count = skeleton.length;
    const names = skeleton.map((bone) => bone.name);
    const index = Object.fromEntries(names.map((name, i) => [name, i]));
    HORSE_BONES.forEach((name) => {
        if (!(name in index)) throw new Error(`[Grainfields] The horse's skeleton is missing its "${name}" bone.`);
    });
    const parents = new Int16Array(count);
    const heads = new Float32Array(count * 3);
    const offsets = new Float32Array(count * 3);
    skeleton.forEach((bone, i) => {
        const parent = Number.isInteger(bone.parent) ? bone.parent : -1;
        if (parent >= i) throw new Error(`[Grainfields] The horse's bone "${bone.name}" comes before its parent.`);
        if (!Array.isArray(bone.head) || bone.head.length !== 3 || !bone.head.every(Number.isFinite)) {
            throw new Error(`[Grainfields] The horse's bone "${bone.name}" has no head.`);
        }
        parents[i] = parent;
        heads.set(bone.head, i * 3);
    });
    for (let i = 0; i < count; i++) {
        const p = parents[i];
        for (let c = 0; c < 3; c++) offsets[i * 3 + c] = heads[i * 3 + c] - (p >= 0 ? heads[p * 3 + c] : 0);
    }
    return {
        count, names, index, parents, heads, offsets,
    };
}

/** A pose's working arrays for a rig: local Euler angles, world rotations and joint positions. */
export function createPose(rig) {
    return {
        local: new Float32Array(rig.count * 3),
        rot: new Float32Array(rig.count * 9),
        at: new Float32Array(rig.count * 3),
    };
}

/** R = Ry . Rz . Rx (row-major) into out[o..o + 9]. */
export function eulerRotation(rx, ry, rz, out, o = 0) {
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    // Rz . Rx
    const a00 = cz;
    const a01 = sz * cx;
    const a02 = -sz * sx;
    const a10 = -sz;
    const a11 = cz * cx;
    const a12 = -cz * sx;
    const a21 = sx;
    const a22 = cx;
    // Ry . (Rz . Rx)
    out[o] = cy * a00;
    out[o + 1] = cy * a01 + sy * a21;
    out[o + 2] = cy * a02 + sy * a22;
    out[o + 3] = a10;
    out[o + 4] = a11;
    out[o + 5] = a12;
    out[o + 6] = -sy * a00;
    out[o + 7] = -sy * a01 + cy * a21;
    out[o + 8] = -sy * a02 + cy * a22;
    return out;
}

const scratch = new Float32Array(9);
const own = new Float32Array(9);

/** out = A . B for row-major 3 x 3 matrices (out may not alias A or B). */
function mul3(A, ao, B, bo, out, oo) {
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const a = ao + r * 3;
            out[oo + r * 3 + c] = A[a] * B[bo + c] + A[a + 1] * B[bo + 3 + c] + A[a + 2] * B[bo + 6 + c];
        }
    }
}

/**
 * Pose the rig from `pose.local` and the horse's place (`x, y, z`: where the root bone's head
 * stands in the world; `heading`: radians, the horse's +z turned toward world +x; `scale`): writes
 * each bone's world rotation (`pose.rot`) and its head's world position (`pose.at`). With `from`,
 * only bones from that index on are recomputed (their parents must already be posed).
 */
export function poseRig(rig, pose, place, from = 0) {
    const { local, rot, at } = pose;
    const { parents, offsets } = rig;
    const s = place.scale || 1;
    for (let i = from; i < rig.count; i++) {
        const p = parents[i];
        if (p < 0) {
            // The root: its own turn under the heading.
            eulerRotation(0, place.heading || 0, 0, scratch, 0);
            eulerRotation(local[i * 3], local[i * 3 + 1], local[i * 3 + 2], own, 0);
            mul3(scratch, 0, own, 0, rot, i * 9);
            at[i * 3] = place.x;
            at[i * 3 + 1] = place.y;
            at[i * 3 + 2] = place.z;
        } else {
            eulerRotation(local[i * 3], local[i * 3 + 1], local[i * 3 + 2], scratch, 0);
            mul3(rot, p * 9, scratch, 0, rot, i * 9);
            const ox = offsets[i * 3] * s;
            const oy = offsets[i * 3 + 1] * s;
            const oz = offsets[i * 3 + 2] * s;
            const r = p * 9;
            at[i * 3] = at[p * 3] + rot[r] * ox + rot[r + 1] * oy + rot[r + 2] * oz;
            at[i * 3 + 1] = at[p * 3 + 1] + rot[r + 3] * ox + rot[r + 4] * oy + rot[r + 5] * oz;
            at[i * 3 + 2] = at[p * 3 + 2] + rot[r + 6] * ox + rot[r + 7] * oy + rot[r + 8] * oz;
        }
    }
    return pose;
}

/**
 * A rotation matrix (row-major, at `o`) as a unit quaternion into `out` ({ x, y, z, w }).
 */
export function matrixToQuaternion(m, o, out) {
    const m00 = m[o];
    const m01 = m[o + 1];
    const m02 = m[o + 2];
    const m10 = m[o + 3];
    const m11 = m[o + 4];
    const m12 = m[o + 5];
    const m20 = m[o + 6];
    const m21 = m[o + 7];
    const m22 = m[o + 8];
    const trace = m00 + m11 + m22;
    if (trace > 0) {
        const s = 0.5 / Math.sqrt(trace + 1);
        out.w = 0.25 / s;
        out.x = (m21 - m12) * s;
        out.y = (m02 - m20) * s;
        out.z = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        out.w = (m21 - m12) / s;
        out.x = 0.25 * s;
        out.y = (m01 + m10) / s;
        out.z = (m02 + m20) / s;
    } else if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        out.w = (m02 - m20) / s;
        out.x = (m01 + m10) / s;
        out.y = 0.25 * s;
        out.z = (m12 + m21) / s;
    } else {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
        out.w = (m10 - m01) / s;
        out.x = (m02 + m20) / s;
        out.y = (m12 + m21) / s;
        out.z = 0.25 * s;
    }
    return out;
}

/**
 * A posed rig into the skinning table the vertex stage reads (`rows`: { x, y, z, w } objects, as a
 * uniform array holds them), SKIN_ROWS a bone from `offset`: the bone's world rotation as a
 * quaternion q, then (t, s) with t = J - s R h, so a rest vertex p goes to s q(p) + t.
 */
export function writeSkinRows(rig, pose, scale, rows, offset = 0) {
    const { rot, at } = pose;
    const { heads } = rig;
    const s = scale || 1;
    for (let i = 0; i < rig.count; i++) {
        const r = i * 9;
        const q = matrixToQuaternion(rot, r, rows[offset + i * SKIN_ROWS]);
        const t = rows[offset + i * SKIN_ROWS + 1];
        const hx = heads[i * 3];
        const hy = heads[i * 3 + 1];
        const hz = heads[i * 3 + 2];
        t.x = at[i * 3] - s * (rot[r] * hx + rot[r + 1] * hy + rot[r + 2] * hz);
        t.y = at[i * 3 + 1] - s * (rot[r + 3] * hx + rot[r + 4] * hy + rot[r + 5] * hz);
        t.z = at[i * 3 + 2] - s * (rot[r + 6] * hx + rot[r + 7] * hy + rot[r + 8] * hz);
        t.w = s;
        // (q and -q turn a vertex alike: the stage blends turned vertices, never quaternions.)
        if (q.w < 0) {
            q.x = -q.x;
            q.y = -q.y;
            q.z = -q.z;
            q.w = -q.w;
        }
    }
    return rows;
}

/** A rest-frame point carried by one bone into the world (out = [x, y, z]). */
export function boneToWorld(rig, pose, bone, point, scale = 1, out = [0, 0, 0]) {
    const { rot, at } = pose;
    const r = bone * 9;
    const dx = (point[0] - rig.heads[bone * 3]) * scale;
    const dy = (point[1] - rig.heads[bone * 3 + 1]) * scale;
    const dz = (point[2] - rig.heads[bone * 3 + 2]) * scale;
    out[0] = at[bone * 3] + rot[r] * dx + rot[r + 1] * dy + rot[r + 2] * dz;
    out[1] = at[bone * 3 + 1] + rot[r + 3] * dx + rot[r + 4] * dy + rot[r + 5] * dz;
    out[2] = at[bone * 3 + 2] + rot[r + 6] * dx + rot[r + 7] * dy + rot[r + 8] * dz;
    return out;
}
