/**
 * Sunfall — the hanging strands either side of the card, and the young leaves of locks.
 *
 * Aerial roots and lianas hang from the vault near the eye, a few metres to tens of metres
 * away, on both sides of the card. They are instanced ribbons turned to face the eye, never
 * thinner than about a pixel and a half, swaying in the cave's breath and kicked when a piece
 * locks (harder on a hard drop: the Snap) on their side.
 *
 * Every lock opens four young leaves on the strand on its side, one at each cell's row height,
 * in the piece's own pigment (the Flush). They mature over seconds (delayed greening: piece
 * colour → bronze → emerald), at once when their row is cleared (Ripening at the rows). Leaves
 * live in one ring of instance slots; the oldest are reused. The strands also carry mature
 * leaves of their own from the start.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    exp,
    float,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    uv,
    vec3,
    pow2, pow3,
} from 'three/tsl';
import {
    BACKLIT_LEAF_RGB, MATURE_LEAF_RGB, clamp01, mulberry32,
} from './sunfall-core.js';
import { pieceSwatchNode, sfSunMask } from './sunfall-tsl.js';
import { BOARD_VIEWPORT, projectWorldToNdc } from './sunfall-composition.js';

const BRONZE = [0.300, 0.110, 0.040];
const ROWS = 20;

/** The strand's sway at `t` (0 at its top, 1 at its foot), shared by strands and leaves. */
function swayAt(u, t, phase, side) {
    // Its rest shape: a lean away from the vault and two slow curves, from the phase.
    const lean = vec3(sin(phase.mul(3.1)).mul(2.2), 0.0, cos(phase.mul(2.3)).mul(1.4)).mul(t.mul(t));
    const curve = vec3(sin(t.mul(2.6).add(phase)).mul(0.9), 0.0, sin(t.mul(1.7).add(phase.mul(1.9))).mul(0.6)).mul(t);
    // The cave's breath, on a clock that quickens and a sway that widens as play heats.
    const wind = sin(u.windClock.mul(0.55).add(phase).add(t.mul(2.2))).mul(0.55)
        .add(sin(u.windClock.mul(1.3).add(phase.mul(1.7)).add(t.mul(5.0))).mul(0.12));
    const amp = t.mul(t).mul(1.5).mul(u.windGain);
    // Locks and Snaps kick the strands on their own side: a damped wave down the strand. Each
    // side keeps its own kick, so alternating locks sway both curtains (the lianas, side 0, none).
    const kick = select(side.lessThan(-0.5), u.kick.x, select(side.greaterThan(0.5), u.kick.y, float(0.0)));
    const wave = sin(t.mul(9.0).sub(u.time.mul(11.0))).mul(kick).mul(t);
    return vec3(amp.mul(wind).add(wave), 0.0, amp.mul(wind).mul(0.4).add(wave.mul(0.3))).add(lean).add(curve);
}

export function createStrandMaterial(u) {
    const A = attribute('aStrandA', 'vec4'); // x, topY, z, length
    const B = attribute('aStrandB', 'vec4'); // width, phase, side, seed
    const vertex = Fn(() => {
        const t = clamp(float(0.5).sub(positionGeometry.y), 0.0, 1.0);
        const base = vec3(A.x, A.y.sub(t.mul(A.w)), A.z).add(swayAt(u, t, B.y, B.z)).toVar();
        const toCam = cameraPosition.sub(base);
        const dist = length(toCam);
        const side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        // Tapers to a root tip; never under about a pixel and a half wide.
        const tip = float(1.0).sub(smoothstep(0.82, 1.0, t).mul(0.7));
        const width = max(B.x.mul(float(1.0).sub(t.mul(0.35))).mul(tip), dist.mul(u.pixelAngle).mul(1.4));
        return base.add(side.mul(positionGeometry.x.mul(width)));
    })();
    const color = Fn(() => {
        const across = clamp(uv().x, 0.0, 1.0).mul(2.0).sub(1.0);
        const t = clamp(float(1.0).sub(uv().y), 0.0, 1.0);
        const round = clamp(float(1.0).sub(across.mul(across)), 0.0, 1.0).sqrt();
        // Bark and moss: lit softly by the cave and from the left by the sunfall's glow.
        const seed = B.w;
        const moss = smoothstep(0.55, 0.8, fract(sin(t.mul(37.0).add(seed.mul(91.0))).mul(43758.5)));
        const bark = mix(vec3(0.055, 0.045, 0.032), vec3(0.03, 0.06, 0.025), moss.mul(0.6));
        const light = u.mistTint.mul(0.55).add(u.bounceVault.mul(0.25)).mul(round.mul(0.7).add(0.3))
            .add(u.beamScatter.mul(clamp(across.negate(), 0.0, 1.0).mul(0.22)));
        return bark.mul(light);
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vertex;
    material.colorNode = color;
    material.side = THREE.DoubleSide;
    return material;
}

export function createLeafMaterial(u) {
    const A = attribute('aLeafA', 'vec4'); // x, y, z at rest, scale
    const B = attribute('aLeafB', 'vec4'); // t on strand, strand phase, side, yaw
    const C = attribute('aLeafC', 'vec4'); // code (-1 a mature leaf of the strand), birth, tau, ripenAt
    const vertex = Fn(() => {
        const age = u.time.sub(C.y);
        const k = clamp(age.div(0.45), 0.0, 1.0);
        // Ease out with overshoot: the bud snaps open.
        const c1 = 1.70158;
        const back = float(1.0).add(pow3(k.sub(1.0)).mul(c1 + 1)).add(pow2(k.sub(1.0)).mul(c1));
        const open = select(C.x.lessThan(-0.5), float(1.0), clamp(back, 0.0, 1.2));
        const size = A.w.mul(open);
        const yaw = B.w.add(sin(u.time.mul(2.7).add(B.w.mul(9.0))).mul(0.12));
        const out = vec3(cos(yaw), 0.0, sin(yaw));
        const along = normalize(out.mul(0.55).add(vec3(0.0, -0.85, 0.0)));
        const across = vec3(sin(yaw).negate(), 0.0, cos(yaw));
        const attach = vec3(A.x, A.y, A.z).add(swayAt(u, B.x, B.y, B.z));
        const lx = positionGeometry.x;
        const ly = positionGeometry.y.negate();
        return attach.add(along.mul(ly.mul(size))).add(across.mul(lx.mul(size).mul(0.55)));
    })();
    const shape = Fn(() => {
        const st = uv();
        const along = clamp(float(1.0).sub(st.y), 0.0, 1.0);
        const half = sin(pow(along, 0.75).mul(Math.PI)).mul(0.46).mul(float(1.0).sub(pow(along, 6.0).mul(0.6)));
        const x = abs(st.x.sub(0.5));
        const aa = max(fwidth(st.x), 1e-4);
        return smoothstep(half.add(aa), half.sub(aa), x);
    });
    const color = Fn(() => {
        const st = uv();
        const code = C.x;
        const age = max(u.time.sub(C.y), 0.0);
        const g = max(float(1.0).sub(exp(age.div(max(C.z, 1.0)).negate())), smoothstep(C.w, C.w.add(1.2), u.time));
        const young = pieceSwatchNode(max(code, 0.0));
        const toBronze = mix(young, vec3(...BRONZE), smoothstep(0.3, 0.65, g).mul(0.6));
        const piece = mix(toBronze, vec3(...MATURE_LEAF_RGB), smoothstep(0.45, 1.0, g));
        const own = vec3(...MATURE_LEAF_RGB).mul(mix(0.7, 1.15, fract(B.w.mul(17.0))));
        const albedo = select(code.lessThan(-0.5), own, piece).toVar();
        const midrib = smoothstep(0.03, 0.0, abs(st.x.sub(0.5))).mul(0.25);
        // The strand light near the card: enough that a fresh leaf shows its piece's colour.
        const P = vec3(A.x, A.y, A.z);
        const lit = sfSunMask(u, P);
        const light = float(0.92).add(lit.mul(1.5)).mul(u.sunGain.mul(0.3).add(0.7));
        const trans = vec3(...BACKLIT_LEAF_RGB).mul(lit.mul(0.6));
        return albedo.mul(float(1.0).sub(midrib)).mul(light).add(trans);
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = vertex;
    material.colorNode = color;
    material.opacityNode = shape();
    material.alphaTest = 0.5;
    material.side = THREE.DoubleSide;
    return material;
}

/**
 * Build the strands and their leaves. Returns `{ group, update(snap), dispose() }`.
 * `strands` comes from the plan (`planDoline().curtains`), `leafSlots` from the quality tier.
 */
export function buildStrands(world, {
    strands, leafSlots = 256, leaves = true, width = [0.05, 0.22], name = 'sunfall-strands',
}) {
    const { u } = world;
    const group = new THREE.Group();
    group.name = name;
    const rng = mulberry32(world.seed ^ 0x5157);
    const disposables = [];

    // ── Strands ──
    const count = Math.max(0, strands.length);
    const strandGeo = new THREE.PlaneGeometry(1, 1, 1, 80);
    strandGeo.deleteAttribute('normal');
    const sa = new Float32Array(count * 4);
    const sb = new Float32Array(count * 4);
    strands.forEach((s, i) => {
        sa.set([s.x, s.topY, s.z, s.length], i * 4);
        sb.set([width[0] + rng() * rng() * (width[1] - width[0]), s.swayPhase, s.side, rng()], i * 4);
    });
    strandGeo.setAttribute('aStrandA', new THREE.InstancedBufferAttribute(sa, 4));
    strandGeo.setAttribute('aStrandB', new THREE.InstancedBufferAttribute(sb, 4));
    const strandMat = createStrandMaterial(u);
    const strandMesh = new THREE.InstancedMesh(strandGeo, strandMat, Math.max(1, count));
    strandMesh.count = count;
    strandMesh.frustumCulled = false;
    strandMesh.renderOrder = 1;
    group.add(strandMesh);
    disposables.push(strandGeo, strandMat);

    if (!leaves) {
        return {
            group,
            update() {},
            strandMesh,
            dispose() {
                disposables.forEach((d) => d.dispose());
            },
        };
    }

    // ── Leaves ──
    const slots = Math.max(16, leafSlots);
    const leafGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    leafGeo.translate(0, -0.5, 0);
    leafGeo.deleteAttribute('normal');
    const la = new Float32Array(slots * 4);
    const lb = new Float32Array(slots * 4);
    const lc = new Float32Array(slots * 4);
    const attrA = new THREE.InstancedBufferAttribute(la, 4).setUsage(THREE.DynamicDrawUsage);
    const attrB = new THREE.InstancedBufferAttribute(lb, 4).setUsage(THREE.DynamicDrawUsage);
    const attrC = new THREE.InstancedBufferAttribute(lc, 4).setUsage(THREE.DynamicDrawUsage);
    leafGeo.setAttribute('aLeafA', attrA);
    leafGeo.setAttribute('aLeafB', attrB);
    leafGeo.setAttribute('aLeafC', attrC);
    const leafMat = createLeafMaterial(u);
    const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, slots);
    leafMesh.frustumCulled = false;
    leafMesh.renderOrder = 2;
    group.add(leafMesh);
    disposables.push(leafGeo, leafMat);

    const slotRows = new Float32Array(slots).fill(-1);
    let cursor = 0;
    const writeLeaf = (slot, strandIndex, t, {
        code = -1, birth = -100, tau = 18, scale = 0.6, row = -1,
    }) => {
        const s = strands[strandIndex];
        const y = s.topY - t * s.length;
        const yaw = (s.side < 0 ? 0 : Math.PI) + (rng() - 0.5) * 2.4;
        la.set([s.x, y, s.z, scale], slot * 4);
        lb.set([t, s.swayPhase, s.side, yaw], slot * 4);
        lc.set([code, birth, tau, 1e6], slot * 4);
        slotRows[slot] = row;
    };
    const markDirty = () => {
        attrA.needsUpdate = true;
        attrB.needsUpdate = true;
        attrC.needsUpdate = true;
    };

    // The strands' own mature leaves, in clusters along their length.
    const seedAmbient = () => {
        cursor = 0;
        const ambient = Math.floor(slots * 0.45);
        for (let k = 0; k < slots; k += 1) {
            if (k < ambient && count > 0) {
                const si = k % count;
                const t = 0.25 + rng() * 0.7;
                writeLeaf(k, si, t, { code: -1, scale: 0.35 + rng() * 0.45 });
            } else {
                la.set([0, -1000, 0, 0], k * 4);
                lc.set([0, -100, 18, 1e6], k * 4);
                slotRows[k] = -1;
            }
        }
        cursor = ambient % slots;
        markDirty();
    };
    seedAmbient();

    // Which strands a side's leaves go to: the two nearest the card, alternately.
    const sideStrands = { [-1]: [], 1: [] };
    strands.forEach((s, i) => sideStrands[s.side < 0 ? -1 : 1].push(i));
    const nearCard = (i) => Math.abs(projectWorldToNdc([strands[i].x, 0, strands[i].z], world.rig, world.aspect).x);
    Object.values(sideStrands).forEach((list) => list.sort((a, b) => nearCard(a) - nearCard(b)));
    const sideTurn = { [-1]: 0, 1: 0 };

    /** World height on strand `i` whose projection lands at board row `row`. */
    const heightForRow = (i, row) => {
        const s = strands[i];
        const vp = world.boardViewport || BOARD_VIEWPORT;
        // The playfield fills the card's lower part (its header holds the next piece and score).
        const top = vp.ndcTop - (vp.ndcTop - vp.ndcBottom) * 0.16;
        const bottom = vp.ndcBottom + (vp.ndcTop - vp.ndcBottom) * 0.03;
        const target = top - ((row + 0.5) / ROWS) * (top - bottom);
        let lo = s.topY - s.length;
        let hi = s.topY;
        for (let it = 0; it < 26; it += 1) {
            const mid = (lo + hi) * 0.5;
            const ndc = projectWorldToNdc([s.x, mid, s.z], world.rig, world.aspect).y;
            if (ndc > target) hi = mid; else lo = mid;
        }
        return clamp01((s.topY - (lo + hi) * 0.5) / s.length);
    };

    let session = -1;
    let lastLock = 0;
    let lastClear = 0;
    const update = (snap) => {
        if (!snap) return;
        if (snap.sessionSerial !== session) {
            session = snap.sessionSerial;
            lastLock = 0;
            lastClear = 0;
            seedAmbient();
        }
        let dirty = false;
        for (const ev of snap.lockEvents || []) {
            if (ev.serial <= lastLock) continue;
            lastLock = ev.serial;
            const side = ev.u < 0.5 ? -1 : 1;
            const list = sideStrands[side].length ? sideStrands[side] : sideStrands[-side];
            if (!list.length) continue;
            const pick = list[(sideTurn[side] += 1) % Math.min(2, list.length)];
            const code = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].indexOf(ev.code);
            for (let j = 0; j < ev.cells.length; j += 1) {
                const cell = ev.cells[j];
                const t = heightForRow(pick, cell.row);
                writeLeaf(cursor, pick, t, {
                    code: Math.max(0, code),
                    birth: ev.time + j * (ev.hard ? 0.02 : 0.05),
                    tau: 16 + rng() * 6,
                    scale: (ev.hard ? 0.9 : 0.8) + rng() * 0.2,
                    row: cell.row,
                });
                cursor = (cursor + 1) % slots;
            }
            dirty = true;
        }
        for (const ev of snap.clearEvents || []) {
            if (ev.serial <= lastClear) continue;
            lastClear = ev.serial;
            const rows = new Set(ev.rows.map((r) => Math.round(r)));
            for (let k = 0; k < slots; k += 1) {
                if (slotRows[k] >= 0 && rows.has(Math.round(slotRows[k]))) lc[k * 4 + 3] = ev.time;
            }
            dirty = true;
        }
        if (dirty) markDirty();
    };

    return {
        group,
        update,
        leafMesh,
        strandMesh,
        dispose() {
            disposables.forEach((d) => d.dispose());
        },
    };
}
