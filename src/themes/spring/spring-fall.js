/**
 * Spring — the fall: the water pouring over the granite step, and the step's rock face.
 *
 * Both are laid out from the fall's plan (spring-fall-plan.js), so the water runs where the rock
 * is. The water is one sheet: a column every fifth of a metre across the lip, each traced down its
 * own path (free, sliding down a slab, landing on a ledge and running off it), a row every few
 * hundredths of a second of the water's travel. Its material reads every parcel by the moment it
 * left the lip (the water's clock less its travel time), so the streaks fall at the true,
 * quickening speed all the way down. At the brink the water is glassy, peat-tea dark with the sky
 * on its curve; within a second it has torn white, in ropes and packets, and lower down it frays
 * into strands that show the wet rock behind. Where it lands on a ledge or meets a slab it bursts
 * white.
 *
 * The rock face is a grid over the step (across, height), standing where the plan puts it: the
 * main tongue's recess, the left stair, the right side's ledges, the jointed face climbing to the
 * shoulders. Its blocks stand in and out; their joints, the overhangs and the hollows are darkened
 * on the CPU (an occlusion per vertex); the material is wet granite where the water and its spray
 * reach, lichened and mossy where they do not.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    max,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    texture,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { clamp as clampJs, smooth } from './spring-core.js';
import { aerial, skyColour, sunShare } from './spring-light.js';
import {
    FALL_FRAME, LIP_Y, POOL_Y, POUR_TIME, RIBS, TONGUES, faceAlong, faceBlock, fallToWorld, lipCrest, lipDepth, lipFlow,
    pathAt, pourPath,
} from './spring-fall-plan.js';
import { groundHeight } from './spring-terrain.js';
import { spHash21 } from './spring-tsl.js';

/** The tongue a column across the lip belongs to (the one whose water there is deepest). */
function tongueAt(across) {
    let best = TONGUES[0];
    let most = -Infinity;
    for (const tongue of TONGUES) {
        const reach = tongue.depth * (1 - Math.min(1, Math.abs(across - tongue.at) / (tongue.half * 1.4)));
        if (reach > most) {
            most = reach;
            best = tongue;
        }
    }
    return best;
}

/** The water sheet's span across the lip (m). */
export const SHEET = Object.freeze({ from: -19.2, to: 19.2 });
/** The rock face's span across the step (m), and how far back over the step its cap reaches. */
export const FACE = Object.freeze({
    from: -46, to: 46, bottom: POOL_Y - 3, capBack: -11.5,
});

const R3 = [FALL_FRAME.rx, 0, FALL_FRAME.rz];

// ── The water ───────────────────────────────────────────────────────────────────────

/**
 * The sheet: `cols` columns across, `rows` rows down the water's travel (denser at the brink,
 * where it moves slowly and bends over the lip).
 */
export function createPourGeometry({ cols = 190, rows = 150 } = {}) {
    const across = cols + 1;
    const count = across * (rows + 1);
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const pour = new Float32Array(count * 4);
    const pour2 = new Float32Array(count * 4);
    const paths = [];
    for (let k = 0; k <= cols; k++) paths.push(pourPath(SHEET.from + ((SHEET.to - SHEET.from) * k) / cols));
    // A dry column borrows its nearest wet neighbour's path (its triangles are never drawn).
    const nearestWet = (k) => {
        for (let d = 1; d <= cols; d++) {
            if (k - d >= 0 && paths[k - d]) return paths[k - d];
            if (k + d <= cols && paths[k + d]) return paths[k + d];
        }
        return null;
    };
    const sample = {};
    const p = {};
    for (let k = 0; k <= cols; k++) {
        const a = SHEET.from + ((SHEET.to - SHEET.from) * k) / cols;
        const own = paths[k];
        const path = own || nearestWet(k);
        const depth = lipDepth(a);
        const q = lipFlow(a);
        // As it falls through the air each tongue fans out from its own middle, until lower down
        // the tongues close over the ribs between them (water running on the rock does not).
        const tongue = tongueAt(a);
        const fan = (a - tongue.at) * (0.22 + 0.24 * clampJs(tongue.depth / 1.3, 0, 1));
        let airborne = 0;
        let previous = 0;
        for (let j = 0; j <= rows; j++) {
            const t = POUR_TIME * (j / rows) ** 1.3;
            const o = j * across + k;
            if (path) pathAt(path, t, sample);
            if (sample.mode === 0) airborne += t - previous;
            previous = t;
            fallToWorld(sample.along ?? 0, a + fan * smooth(0.1, 1.5, airborne), p);
            position[o * 3] = p.x;
            position[o * 3 + 1] = sample.y ?? LIP_Y;
            position[o * 3 + 2] = p.z;
            pour[o * 4] = a;
            pour[o * 4 + 1] = t;
            pour[o * 4 + 2] = q;
            pour[o * 4 + 3] = own ? sample.white : 0;
            pour2[o * 4] = clampJs(depth / 0.32, 0, 1);
            pour2[o * 4 + 1] = own ? sample.mode : 0;
            pour2[o * 4 + 2] = own ? sample.speed : 0;
            pour2[o * 4 + 3] = own && !sample.ended ? 1 : 0;
        }
    }
    // Normals: across the lip × down the water's path, turned out of the face (toward the eye).
    for (let k = 0; k <= cols; k++) {
        for (let j = 0; j <= rows; j++) {
            const o = j * across + k;
            const a = Math.max(0, j - 1) * across + k;
            const b = Math.min(rows, j + 1) * across + k;
            let fx = position[b * 3] - position[a * 3];
            let fy = position[b * 3 + 1] - position[a * 3 + 1];
            let fz = position[b * 3 + 2] - position[a * 3 + 2];
            const fl = Math.hypot(fx, fy, fz) || 1;
            fx /= fl;
            fy /= fl;
            fz /= fl;
            // n = flow × r (r across the lip): out of the face.
            let nx = fy * R3[2] - fz * R3[1];
            let ny = fz * R3[0] - fx * R3[2];
            let nz = fx * R3[1] - fy * R3[0];
            if (nx * FALL_FRAME.tx + nz * FALL_FRAME.tz < 0) {
                nx = -nx;
                ny = -ny;
                nz = -nz;
            }
            const nl = Math.hypot(nx, ny, nz) || 1;
            normal[o * 3] = nx / nl;
            normal[o * 3 + 1] = ny / nl;
            normal[o * 3 + 2] = nz / nl;
        }
    }
    const index = [];
    for (let j = 0; j < rows; j++) {
        for (let k = 0; k < cols; k++) {
            // Skip quads no water crosses (between dry columns, or after both have landed).
            const a = j * across + k;
            const b = a + 1;
            const c = a + across;
            const d = c + 1;
            if (pour2[a * 4 + 3] + pour2[b * 4 + 3] + pour2[c * 4 + 3] + pour2[d * 4 + 3] === 0) continue;
            index.push(a, d, b, a, c, d);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('aPour', new THREE.BufferAttribute(pour, 4));
    geometry.setAttribute('aPour2', new THREE.BufferAttribute(pour2, 4));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
    geometry.computeBoundingSphere();
    return { geometry, triangles: index.length / 3 };
}

// Linear colours.
const GLASS = [0.032, 0.03, 0.014];
const FOAM = [0.68, 0.71, 0.73];
/** Thin peat-brown water lit through by the sun behind it. */
const PEAT_LIT = [0.2, 0.13, 0.04];

/**
 * The falling water's clumps: a column's width (m), how many a second each column throws (from,
 * to), and how fast a clump's tail fades behind its head (per share of its period).
 */
export const PACKET = Object.freeze({ width: 0.8, rate: Object.freeze([0.7, 1.5]), tail: 5.5 });
/** How strongly the strands rib the sheet's light across it, and how bright its glitter. */
const RIB = 4.2;
/** How far a strand meanders across as it falls (m). */
const SWAY = 0.65;
const GLITTER = 3.2;

export function createPourMaterial(u, tex) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringPour';
    material.fog = false;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    const vPour = varying(attribute('aPour', 'vec4'), 'spPour');
    const vPour2 = varying(attribute('aPour2', 'vec4'), 'spPour2');
    const vN = varying(normalize(attribute('normal', 'vec3')), 'spPourN');
    // The flood lifts the whole sheet with the river.
    material.positionNode = positionLocal.add(vec3(0.0, u.flood, 0.0));
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const across = vPour.x;
        const tt = vPour.y;
        const q = vPour.z;
        const burst = vPour.w;
        const edge = vPour2.x;
        const speed = vPour2.z;
        const alive = vPour2.w;
        const V = normalize(P.sub(u.eye)).toVar();
        const L = u.sunDir;
        const sunLight = u.sun.mul(sunShare(u, P)).toVar();
        // Each parcel is read by the moment it left the lip: whatever it carries falls with it,
        // drawn out down the fall by the water's own acceleration (short at the brink, long
        // streaks lower down).
        const launch = u.flowClock.sub(tt).toVar();
        // The strands meander a little as they fall (each its own way), never ruled straight.
        const sway = texture(tex.noise, vec2(across.div(9.0).add(0.41), launch.mul(0.09))).g.sub(0.5).mul(SWAY);
        const lane = across.add(sway).toVar();

        // ── Strands: the falling water's columns, a third of a metre to a couple of metres
        // across, each a little thicker or thinner than its neighbours ──
        const strandAt = (shift) => texture(tex.noise, vec2(lane.add(shift).div(2.6).add(0.53), launch.mul(0.07))).r;
        const fine = strandAt(0.0).toVar();
        const ridge = strandAt(0.09).sub(fine).toVar();
        const mid = texture(tex.noise, vec2(lane.div(7.0).add(0.17), launch.mul(0.05))).g;
        const broad = texture(tex.noise, vec2(across.div(14.0).add(0.71), launch.mul(0.03))).r;
        const strands = fine.mul(0.45).add(mid.mul(0.35)).add(broad.mul(0.2)).toVar();
        // Small lumps riding on it (for its surface and its glints).
        const lumps = texture(tex.noise, vec2(across.div(1.3).add(0.29), launch.mul(1.6))).toVar();
        // Packets: the water breaks into clumps as it falls, a column at a time (each column its
        // own rhythm). A clump's head leads, bright; its tail streams up behind it.
        const cell = floor(lane.div(PACKET.width));
        const seed = spHash21(vec2(cell, 7.0));
        const rate = seed.mul(PACKET.rate[1] - PACKET.rate[0]).add(PACKET.rate[0]);
        // (Its head is ragged across the column, never a ruled line.)
        const phase = fract(launch.mul(rate).add(seed.mul(7.3)).add(fine.mul(0.22)));
        const round = sin(fract(lane.div(PACKET.width)).mul(Math.PI));
        const packet = smoothstep(0.0, 0.12, phase).mul(exp(phase.mul(-PACKET.tail))).mul(round)
            .mul(smoothstep(0.35, 1.2, tt))
            .toVar();

        // ── How white: glassy at the brink, aerated within a second (thick water holds out
        // longer), whitest along its strands and in its clumps, a burst where it meets the rock ──
        const aer = smoothstep(0.05, 0.85, tt.mul(float(1.2).sub(q.mul(0.5)))).toVar();
        const field = strands.add(aer.mul(0.3)).add(packet.mul(0.35)).toVar();
        const aaField = fwidth(field).mul(1.2).add(0.02);
        const white = clamp(aer.mul(smoothstep(float(0.28).sub(aaField), float(0.62).add(aaField), field))
            .add(burst.mul(1.5)).add(packet.mul(0.5)), 0.0, 1.0).toVar();
        // The brink: for its first moments over the lip the water is a smooth glassy roll before
        // it tears white; the thick tongue holds together for most of a second, its strands
        // tearing white one by one.
        const holds = q.mul(0.75).add(0.2);
        const brink = float(1.0).sub(smoothstep(holds.mul(0.15), holds, tt.add(fine.sub(0.5).mul(holds).mul(0.6))))
            .mul(q.mul(0.5).add(0.5));
        white.mulAssign(float(1.0).sub(brink.mul(0.95)));

        // ── The surface: the sheet's own normal, ribbed across by its strands (each column lit
        // as a column), roughened by its lumps where it is white ──
        const N0 = normalize(vN);
        const r = vec3(...R3);
        const rib = clamp(ridge.mul(RIB), -0.9, 0.9).mul(white.mul(0.6).add(0.4));
        const lumpy = vec2(lumps.g.sub(0.5), lumps.r.sub(0.5)).mul(white.mul(0.7).add(0.2));
        const N = normalize(N0.add(r.mul(rib.add(lumpy.x))).add(vec3(0.0, lumpy.y, 0.0))).toVar();

        // ── Glassy water: dark peat-tea, the sky on its curve; lit through amber when the sun
        // stands behind it, its strands showing as ropes of thicker water ──
        const cosV = clamp(dot(N, V.negate()), 0.0, 1.0);
        const m = float(1.0).sub(cosV);
        const m2 = m.mul(m);
        const fresnel = float(0.04).add(m2.mul(m2).mul(m).mul(0.96));
        const R = V.sub(N.mul(dot(V, N).mul(2.0)));
        const sky = skyColour(u, vec3(R.x, abs(R.y), R.z), { withSun: false });
        const behind = clamp(dot(V, L), 0.0, 1.0);
        const b2 = behind.mul(behind);
        const b4 = b2.mul(b2);
        const body = vec3(...GLASS).mul(u.fill.mul(2.4).add(sunLight.mul(0.1)))
            .add(vec3(...PEAT_LIT).mul(sunLight).mul(b4.mul(0.9).add(0.04)));
        // (Only a little of the sky over the whole curve: more read as a silvered sheet.)
        const glassy = mix(body.mul(fine.mul(0.8).add(0.6)), sky, fresnel.mul(0.85).add(0.035)).toVar();
        const glint = max(dot(R, L), 0.0);
        const g4 = glint.mul(glint).mul(glint).mul(glint);
        const g16 = g4.mul(g4).mul(g4).mul(g4);
        glassy.addAssign(sunLight.mul(g16.mul(1.2).add(g4.mul(0.05))));

        // ── White water: a heap of bubbles, lit through itself. Its strands and clumps stand
        // bright, the thinner water between them greyer; broad bands of the fall run brighter or
        // duller where more or less water comes over ──
        const wrap = clamp(dot(N, L).add(0.55).div(1.55), 0.0, 1.0);
        const bright = mix(float(0.34), float(1.0), smoothstep(0.25, 0.8, strands)).add(packet.mul(0.4))
            .mul(broad.mul(0.36).add(0.78))
            .mul(float(1.0).sub(b4.mul(0.35)))
            .add(b4.mul(0.35));
        // With the sun behind it the thin water between the strands glows through, the thick
        // strands stand darker against it (a flat blaze hid every strand at the golden hour).
        const glow = b4.mul(float(1.15).sub(smoothstep(0.3, 0.75, strands).mul(0.85)))
            .mul(float(1.0).sub(white.mul(0.3)));
        const foamLight = sunLight.mul(wrap.mul(0.55).add(0.08).mul(float(1.0).sub(b4.mul(0.55))).add(glow.mul(0.34)))
            .add(u.fill.mul(mix(float(1.05), float(1.35), N.y.mul(0.5).add(0.5)))).add(u.bounce.mul(0.3));
        const foam = vec3(...FOAM).mul(foamLight).mul(bright).toVar();
        // Droplets catching the sun: streaks of glitter on the white water where a lump faces
        // between the sun and the eye.
        const H = normalize(L.sub(V));
        const facing = clamp(dot(normalize(N.add(r.mul(lumps.b.sub(0.5).mul(1.6)))), H), 0.0, 1.0);
        const f4 = facing.mul(facing).mul(facing).mul(facing);
        const glitterField = lumps.a.mul(0.6).add(fine.mul(0.4));
        const aaGlitter = fwidth(glitterField).add(0.01);
        const glitter = smoothstep(float(0.74).sub(aaGlitter), float(0.86).add(aaGlitter), glitterField)
            .mul(f4.mul(f4)).mul(white).mul(GLITTER);
        foam.addAssign(sunLight.mul(glitter));
        const col = mix(glassy, foam, white).toVar();

        // ── Coverage: thick water is a sheet; lower down the falling water breaks into strands
        // and clumps with the wet rock and the spray between them (thin water sooner); the ends
        // fray. (Water running on the rock, down a slab or off a ledge, stays a film: only water
        // in the air tears.) ──
        const thinness = float(1.0).sub(q);
        const inAir = float(1.0).sub(clamp(vPour2.y, 0.0, 1.0).mul(0.85));
        const tear = smoothstep(0.5, 2.6, tt).mul(thinness.mul(0.55).add(0.3)).add(float(1.0).sub(edge).mul(0.35))
            .mul(inAir)
            .mul(0.7);
        const held = strands.add(packet.mul(0.25)).add(lumps.r.sub(0.5).mul(0.12)).toVar();
        const aaHeld = fwidth(held).add(0.025);
        const cover = smoothstep(tear.sub(0.08).sub(aaHeld), tear.add(0.1).add(aaHeld), held);
        const ragged = edge.add(fine.sub(0.5).mul(0.5)).add(lumps.g.sub(0.5).mul(0.25)).toVar();
        const aaEdge = fwidth(ragged).add(0.02);
        const fray = smoothstep(float(0.02).sub(aaEdge), float(0.45).add(aaEdge), ragged);
        // The water vanishes into the boil and the spray at the pool.
        // (Its foot is ragged: strand by strand it is lost in the boil.)
        const foot = smoothstep(POOL_Y - 0.4, POOL_Y + 1.6, P.y.sub(u.flood).add(strands.sub(0.5).mul(1.6)).add(0.5));
        const thin = mix(float(0.8), float(1.0), white);
        // Low down the falling water is lost in its own spray: softer and paler, the more so the
        // faster and the more of it there is.
        const spray = smoothstep(POOL_Y + 12.0, POOL_Y + 1.5, P.y).mul(smoothstep(8.0, 20.0, speed))
            .mul(q.mul(0.5).add(0.5)).toVar();
        const flat = vec3(...FOAM).mul(u.fill.mul(1.4).add(sunLight.mul(0.34)).add(u.bounce.mul(0.3)));
        col.assign(mix(col, flat, spray.mul(0.35)));
        const alpha = clamp(alive.mul(cover).mul(fray).mul(foot).mul(thin)
            .mul(mix(float(1.0), strands.mul(0.5).add(0.5), spray)), 0.0, 1.0);
        return vec4(aerial(u, P, col), alpha);
    })();
    return material;
}

export function createPour(u, tex, tier) {
    const { geometry, triangles } = createPourGeometry({ cols: tier.pourCols ?? 190, rows: tier.pourRows ?? 150 });
    const material = createPourMaterial(u, tex);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringPour';
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    return {
        mesh,
        meshes: [mesh],
        triangles,
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ── The rock face ───────────────────────────────────────────────────────────────────

/**
 * The face as a grid: `cols` columns across the step, `rows` rows from its top (the lip's crest
 * under the water, the shoulders' ground beside it) down under the pool, then `capRows` rows of
 * cap turning back over the step's top so no edge shows.
 */
export function createFaceGeometry(baked, { cols = 300, rows = 170, capRows = 6 } = {}) {
    const across = cols + 1;
    const total = rows + 1 + capRows;
    const count = across * total;
    const position = new Float32Array(count * 3);
    const face = new Float32Array(count * 4);
    const along = new Float32Array(count);
    const height = new Float32Array(count);
    const tone = new Float32Array(count);
    const joint = new Float32Array(count);
    const p = {};
    const blk = {};
    for (let k = 0; k <= cols; k++) {
        const a = FACE.from + ((FACE.to - FACE.from) * k) / cols;
        const crest = lipCrest(a);
        // Beside the river the face climbs to the shoulders' ground behind the step, its rim
        // broken into crags a block wide that stand a little over the ground.
        fallToWorld(FACE.capBack, a, p);
        const behind = groundHeight(baked, p.x, p.z);
        const wet = lipDepth(a) > 0.02;
        faceBlock(a, behind, blk);
        const crag = 1.9 * Math.max(0, ((blk.column * 0.618034) % 1) - 0.3) + 0.35 * Math.sin(a * 0.9);
        const rim = smooth(FALL_FRAME.halfWidth + 1, FALL_FRAME.halfWidth + 5, Math.abs(a));
        const top = Math.abs(a) < FALL_FRAME.halfWidth + 1 ? crest : Math.max(crest, behind + 0.4 + crag * rim);
        for (let j = 0; j < total; j++) {
            const o = j * across + k;
            let y;
            let x;
            if (j < capRows) {
                // The cap: from far back over the step to the face's top edge.
                const f = j / capRows;
                const frontX = faceAlong(a, top);
                x = FACE.capBack + (frontX - FACE.capBack) * smooth(0, 1, f);
                const backY = wet ? Math.min(top, behind) - 0.4 : Math.min(top, behind - 0.5);
                y = backY + (top - backY) * smooth(0, 0.7, f);
            } else {
                const f = (j - capRows) / rows;
                y = top + (FACE.bottom - top) * f;
                x = faceAlong(a, y);
            }
            fallToWorld(x, a, p);
            position[o * 3] = p.x;
            position[o * 3 + 1] = y;
            position[o * 3 + 2] = p.z;
            along[o] = x;
            height[o] = y;
            faceBlock(a, y, blk);
            // Each layer a shade apart, and only faintly each block within it (a shade per block
            // read as masonry).
            tone[o] = (((blk.band * 7919) % 1000) / 1000) * 0.8 + (((blk.column * 104729) % 1000) / 1000) * 0.2;
            joint[o] = blk.joint;
        }
    }
    // Occlusion per vertex: overhangs above it, the hollow it sits in, and the joints.
    for (let k = 0; k <= cols; k++) {
        const a = FACE.from + ((FACE.to - FACE.from) * k) / cols;
        const depth = lipDepth(a);
        for (let j = capRows; j < total; j++) {
            const o = j * across + k;
            let over = 0;
            for (let i = Math.max(capRows, j - 40); i < j; i++) {
                const above = i * across + k;
                const rise = height[above] - height[o];
                if (rise > 0.05) over = Math.max(over, (along[above] - along[o]) / rise);
            }
            const l = j * across + Math.max(0, k - 4);
            const rr = j * across + Math.min(cols, k + 4);
            const hollow = (along[l] + along[rr]) * 0.5 - along[o];
            const shade = 1 - 0.65 * smooth(0.05, 1.1, over) - 0.35 * smooth(0.1, 0.9, hollow)
                - 0.28 * smooth(0.22, 0.04, joint[o]);
            // Wet: behind and beside the water, and wherever the spray reaches low down.
            const nearWater = smooth(FALL_FRAME.halfWidth + 3, FALL_FRAME.halfWidth - 1, Math.abs(a));
            const spray = smooth(17, 7, height[o]) * (1 - smooth(24, 34, Math.abs(a)));
            const wet = clampJs(Math.max(nearWater * (0.55 + 0.45 * smooth(0, 0.1, depth)), spray), 0, 1);
            face[o * 4] = a;
            face[o * 4 + 1] = clampJs(shade, 0.12, 1);
            face[o * 4 + 2] = wet;
            face[o * 4 + 3] = tone[o];
        }
        for (let j = 0; j < capRows; j++) {
            const o = j * across + k;
            face[o * 4] = a;
            face[o * 4 + 1] = 0.85;
            face[o * 4 + 2] = depth > 0.02 ? 1 : 0;
            face[o * 4 + 3] = tone[o];
        }
    }
    const index = new Uint32Array((total - 1) * cols * 6);
    let o = 0;
    for (let j = 0; j < total - 1; j++) {
        for (let k = 0; k < cols; k++) {
            const a = j * across + k;
            const b = a + 1;
            const c = a + across;
            const d = c + 1;
            index[o++] = a;
            index[o++] = b;
            index[o++] = d;
            index[o++] = a;
            index[o++] = d;
            index[o++] = c;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aFace', new THREE.BufferAttribute(face, 4));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    // The face looks downstream (toward the eye): turn any normal that came out backwards.
    const n = geometry.getAttribute('normal');
    let outward = 0;
    for (let i = 0; i < n.count; i++) outward += n.getX(i) * FALL_FRAME.tx + n.getZ(i) * FALL_FRAME.tz;
    if (outward < 0) {
        for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    }
    geometry.computeBoundingSphere();
    return { geometry, triangles: index.length / 3 };
}

// Linear albedos: dark schist, a little warmer where it weathers.
const SLATE = [0.062, 0.064, 0.07];
const SLATE_WARM = [0.085, 0.075, 0.066];
const LICHEN = [0.24, 0.26, 0.22];
const MOSS = [0.035, 0.075, 0.02];
const WET = [0.016, 0.017, 0.019];
const TURF = [0.05, 0.085, 0.022];
const STRAW = [0.12, 0.1, 0.05];
/** Spray-fed moss and liverwort beside the fall: vivid, wet greens. */
const SPRAY_MOSS = [0.03, 0.11, 0.015];
const SPRAY_MOSS_LIT = [0.075, 0.2, 0.025];

/** How much the rib of rock between two tongues at `across` stands in their spray (TSL, 0..1). */
const rib = (across) => RIBS.reduce(
    (most, r) => most.max(smoothstep(r.half * 1.2, r.half * 0.4, abs(across.sub(r.at)))),
    float(0.0),
);

export function createFaceMaterial(u, tex) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SpringStepFace';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const vFace = varying(attribute('aFace', 'vec4'), 'spFace');
    const vN = varying(normalize(attribute('normal', 'vec3')), 'spFaceN');
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N = normalize(vN).toVar();
        const L = u.sunDir;
        const across = vFace.x;
        const shade = vFace.y;
        const wet = vFace.z;
        const tone = vFace.w;
        // Read on the face itself: across it and up. Nothing finer than a third of a metre: at the
        // fall's distance anything smaller is under a pixel.
        const uv = vec2(across, P.y);
        const broad = texture(tex.noise, uv.div(40.0)).toVar();
        const mid = texture(tex.noise, uv.div(9.0)).toVar();
        const grain = texture(tex.noise, uv.div(2.7)).toVar();
        // Schist: near-black grey, warmer where it weathers in big soft patches, each layer and
        // block a shade apart.
        const albedo = mix(vec3(...SLATE), vec3(...SLATE_WARM), smoothstep(0.4, 0.75, broad.r))
            .mul(tone.sub(0.5).mul(0.3).add(1.0)).mul(mid.g.mul(0.3).add(0.85)).mul(grain.r.mul(0.2).add(0.9))
            .toVar();
        // Pale lichen on the dry rock in patches; dark crusts where it weathers; moss where it is
        // damp and faces up.
        const dry = float(1.0).sub(wet);
        const lichen = smoothstep(0.56, 0.72, broad.g.mul(0.6).add(mid.r.mul(0.4))).mul(dry).mul(0.55);
        albedo.assign(mix(albedo, vec3(...LICHEN), lichen));
        const crust = smoothstep(0.6, 0.75, broad.b.mul(0.5).add(mid.b.mul(0.5))).mul(dry).mul(0.4);
        albedo.mulAssign(float(1.0).sub(crust));
        const up = smoothstep(0.35, 0.8, N.y);
        const damp = smoothstep(0.1, 0.6, wet.add(broad.a.sub(0.5).mul(0.6)));
        const moss = up.mul(smoothstep(0.4, 0.6, mid.a.add(damp.mul(0.25)))).mul(0.85);
        albedo.assign(mix(albedo, vec3(...MOSS), moss));
        // The rim's top and the dry ledges carry turf: grass, crowberry and last year's straw.
        const turf = smoothstep(0.62, 0.86, N.y).mul(dry).mul(smoothstep(0.3, 0.55, mid.b.add(0.25)));
        albedo.assign(mix(albedo, mix(vec3(...TURF), vec3(...STRAW), grain.b), turf));
        // Black streaks where seepage runs down the dry face.
        const seep = smoothstep(0.6, 0.78, texture(tex.noise, vec2(across.div(9.0), P.y.div(60.0))).g).mul(dry);
        albedo.mulAssign(float(1.0).sub(seep.mul(0.45)));
        // Beside the tongues, where the spray drifts but the water does not scour, the rock is
        // carpeted in vivid moss and liverwort: kept wet all summer, the greenest thing in the
        // gorge. It grows on all but the overhangs, in cushions broken by the bare rock.
        const beside = smoothstep(FALL_FRAME.halfWidth - 2.0, FALL_FRAME.halfWidth + 1.5, abs(across))
            .mul(float(1.0).sub(smoothstep(FALL_FRAME.halfWidth + 14.0, FALL_FRAME.halfWidth + 24.0, abs(across))));
        const misted = beside.mul(smoothstep(POOL_Y + 22.0, POOL_Y + 4.0, P.y)).max(rib(across).mul(0.75));
        const cushions = smoothstep(0.42, 0.62, mid.g.mul(0.55).add(grain.b.mul(0.25)).add(broad.a.mul(0.2)))
            .mul(smoothstep(-0.25, 0.15, N.y)).mul(misted).toVar();
        albedo.assign(mix(albedo, mix(vec3(...SPRAY_MOSS), vec3(...SPRAY_MOSS_LIT), grain.r), cushions.mul(0.9)));
        // Trickles: threads of water running down the face beside the tongues and seeping out of
        // its joints, dark and glistening, beaded with light that runs down them.
        const thread = texture(tex.noise, vec2(across.div(1.7).add(0.33), P.y.div(55.0))).r;
        const aaThread = fwidth(thread).add(0.01);
        const trickle = smoothstep(float(0.8).sub(aaThread), float(0.86).add(aaThread), thread)
            .mul(smoothstep(0.35, 0.7, broad.g)).mul(beside.max(dry.mul(0.35))).toVar();
        albedo.assign(mix(albedo, vec3(...WET), trickle.mul(0.85)));
        // Wet granite: near black, glistening.
        const wetness = clamp(wet.mul(grain.g.mul(0.3).add(0.85)), 0.0, 1.0);
        albedo.assign(mix(albedo, vec3(...WET).mul(mid.a.mul(0.5).add(0.75)), wetness.mul(0.85)));
        const sunLight = u.sun.mul(sunShare(u, P));
        const diffuse = max(dot(N, L), 0.0);
        const sky = u.fill.mul(N.y.mul(0.35).add(0.65)).add(u.bounce.mul(float(0.5).sub(N.y.mul(0.5))));
        const col = albedo.mul(sunLight.mul(diffuse).mul(shade.mul(0.6).add(0.4)).add(sky.mul(shade))).toVar();
        // The wet rock's sheen toward the sun, and the sky's on it: rough rock, so a broken, patchy
        // sheen (a strong one read as polished metal with the sun behind the eye).
        const V = normalize(P.sub(u.eye));
        const R = V.sub(N.mul(dot(V, N).mul(2.0)));
        const g = clamp(dot(R, L), 0.0, 1.0);
        const g4 = g.mul(g).mul(g).mul(g);
        const g16 = g4.mul(g4).mul(g4).mul(g4);
        const glisten = smoothstep(0.45, 0.8, grain.a.mul(0.6).add(mid.r.mul(0.4)));
        col.addAssign(sunLight.mul(g16.mul(0.14).mul(glisten).add(g4.mul(0.02))).mul(wetness).mul(shade));
        col.addAssign(u.fill.mul(wetness.mul(0.06)).mul(smoothstep(0.0, 0.6, R.y)).mul(shade));
        // The trickles' beads of light running down, and the wet moss's sheen in the sun.
        const beads = texture(tex.noise, vec2(across.div(1.7).add(0.33), P.y.add(u.time.mul(1.6)).div(2.2)));
        const bead = smoothstep(0.7, 0.95, beads.a);
        col.addAssign(sunLight.mul(0.35).add(u.fill.mul(1.2)).mul(trickle).mul(bead.mul(0.9).add(0.12))
            .mul(shade));
        col.addAssign(sunLight.mul(g4.mul(0.05)).mul(cushions).mul(glisten));
        return vec4(aerial(u, P, col), 1.0);
    })();
    return material;
}

export function createStepFace(u, tex, tier, baked) {
    const { geometry, triangles } = createFaceGeometry(baked, {
        cols: tier.faceCols ?? 300, rows: tier.faceRows ?? 170,
    });
    const material = createFaceMaterial(u, tex);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'SpringStepFace';
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return {
        mesh,
        meshes: [mesh],
        triangles,
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
