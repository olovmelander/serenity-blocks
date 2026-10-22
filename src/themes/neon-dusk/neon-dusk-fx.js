/**
 * Neon Dusk — gameplay and atmosphere FX: drifting neon pixel dust, burst pixels, and the
 * hologram of each locked tetromino standing up out of the glass.
 *
 * Motion is analytic in the vertex stage (spawn state + age), so nothing is uploaded per frame:
 * a spawn writes one instance's attributes as a ranged upload, and the same code runs on both
 * WebGPURenderer backends. Dust and burst pixels are instanced Sprites (THREE.Points would be one
 * pixel wide on WebGPU whatever the size node says); the piece holograms are an InstancedMesh
 * lying on the floor and riding its scroll.
 *
 * Additive materials write premultiplied colour with alpha 1 (AdditiveBlending is SrcAlpha, One).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    mod,
    normalLocal,
    positionGeometry,
    positionLocal,
    pow,
    sin,
    smoothstep,
    step,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { GRID_SPACING, RIG } from './neon-dusk-tsl.js';

/**
 * Layer for objects the main camera sees but the floor's reflector does not: the fx (tiles lie on
 * the glass, and bright pixels blur into smudges in a rough mirror).
 */
export const DIRECT_ONLY_LAYER = 1;

function instanced(count, itemSize) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
}

/** Mark one instance dirty (ranged upload; ranges merge per frame in three). */
function touch(attr, index) {
    attr.addUpdateRange(index * attr.itemSize, attr.itemSize);
    attr.needsUpdate = true;
}

/**
 * A neon pixel in sprite space: a crisp square core inside a soft square halo, with a faint
 * cross flare — the retro pixel the old theme was known for, now properly glowing.
 */
const neonPixel = (local, flare) => {
    const ax = abs(local.x);
    const ay = abs(local.y);
    const box = max(ax, ay);
    const core = float(1.0).sub(smoothstep(0.26, 0.36, box));
    const halo = exp(box.mul(-5.0)).mul(0.45);
    const cross = exp(ax.mul(-24.0)).mul(exp(ay.mul(-3.0)))
        .add(exp(ay.mul(-24.0)).mul(exp(ax.mul(-3.0))));
    return core.add(halo).add(cross.mul(flare)).mul(float(1.0).sub(smoothstep(0.85, 1.0, box)));
};

const DUST_PALETTE = [0xff4fd8, 0x39f0ff, 0xb46bff, 0xff7aa8, 0x8fe9ff];

function createDust(u, count, rand) {
    const material = new THREE.PointsNodeMaterial();
    material.name = 'NeonDuskDust';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.sizeAttenuation = false;
    material.fog = false;

    const mote = attribute('iMote', 'vec4'); // x, y0, z, phase
    const look = attribute('iMoteLook', 'vec4'); // r, g, b, size px
    const t = u.time;
    const ph = mote.w;
    // Rise slowly through a 34-unit column and wrap; drift sideways a little. The rise runs on
    // the dust's own clock (the world's time at rest; it quickens as play heats).
    const rise = fract(u.dustRun.mul(0.014).add(ph.mul(0.159))).mul(34.0);
    const pos = vec3(
        mote.x.add(sin(t.mul(0.08).add(ph)).mul(2.5)),
        mote.y.add(rise),
        mote.z.add(sin(t.mul(0.06).add(ph.mul(1.3))).mul(2.0)),
    );
    const dist = length(pos.sub(cameraPosition));
    material.positionNode = pos;
    material.sizeNode = look.w.mul(clamp(float(80.0).div(dist), 0.6, 1.6));
    material.colorNode = Fn(() => {
        const local = uv().sub(0.5).mul(2.0);
        // Retro flicker: mostly steady, with quick blinks.
        const blink = step(0.12, fract(t.mul(float(0.7).add(ph.mul(0.05))).add(ph)));
        const twinkle = sin(t.mul(float(1.3).add(ph.mul(0.11))).add(ph.mul(5.0))).mul(0.3).add(0.7);
        const riseT = rise.div(34.0);
        const wrapFade = smoothstep(0.0, 0.12, riseT).mul(float(1.0).sub(smoothstep(0.75, 1.0, riseT)));
        const fog = exp(dist.mul(-0.006));
        return look.xyz.mul(neonPixel(local, float(0.3)).mul(twinkle).mul(blink).mul(wrapFade)
            .mul(fog)
            .mul(u.dustGain));
    })();
    material.opacityNode = float(1.0);

    const sprite = new THREE.Sprite(material);
    sprite.name = 'NeonDuskDust';
    sprite.geometry = sprite.geometry.clone();
    const iMote = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const iMoteLook = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    const palette = DUST_PALETTE.map((h) => new THREE.Color(h));
    for (let i = 0; i < count; i += 1) {
        const phi = (rand() * 2 - 1) * 1.45;
        const d = 22 + rand() * 190;
        const x = RIG.x + Math.sin(phi) * d;
        const z = RIG.z - Math.cos(phi) * d;
        iMote.array.set([x, 0.5 + rand() * 10, z, rand() * 6.28], i * 4);
        const c = palette[Math.floor(rand() * palette.length)];
        iMoteLook.array.set([c.r, c.g, c.b, 4 + rand() * 4], i * 4);
    }
    sprite.geometry.setAttribute('iMote', iMote);
    sprite.geometry.setAttribute('iMoteLook', iMoteLook);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 40;
    // The mirror would blur these bright specks into smudges; the glass shows the scene only.
    sprite.layers.set(DIRECT_ONLY_LAYER);
    return sprite;
}

function createBurstPixels(u, count) {
    const material = new THREE.PointsNodeMaterial();
    material.name = 'NeonDuskBurst';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.sizeAttenuation = false;
    material.fog = false;

    const spawn = attribute('iSpawn', 'vec4'); // x, y, z, t0
    const vel = attribute('iVel', 'vec4'); // vx, vy, vz, life
    const look = attribute('iLook', 'vec4'); // r, g, b, size px
    const motion = attribute('iMotion', 'vec4'); // drag, lift, flicker rate, phase
    const age = u.time.sub(spawn.w);
    const life = max(vel.w, 1e-3);
    const alive = step(0.0, age).mul(step(age, life));
    const lifeT = clamp(age.div(life), 0.0, 1.0);
    const drag = max(motion.x, 1e-3);
    const travel = float(1.0).sub(exp(age.mul(drag).negate())).div(drag);
    material.positionNode = spawn.xyz.add(vel.xyz.mul(travel)).add(vec3(0.0, motion.y.mul(age).mul(age).mul(0.5), 0.0));
    const fadeIn = smoothstep(0.0, 0.06, lifeT);
    const fadeOut = pow(float(1.0).sub(lifeT), 0.8);
    material.sizeNode = look.w.mul(mix(float(1.25), float(0.75), lifeT)).mul(alive);
    material.colorNode = Fn(() => {
        const local = uv().sub(0.5).mul(2.0);
        const flicker = sin(age.mul(motion.z).add(motion.w)).mul(0.5).add(0.5);
        return look.xyz.mul(neonPixel(local, flicker.mul(0.8).add(0.2)).mul(fadeIn.mul(fadeOut))
            .mul(flicker.mul(0.4).add(0.7)).mul(2.4));
    })();
    material.opacityNode = float(1.0);

    const sprite = new THREE.Sprite(material);
    sprite.name = 'NeonDuskBurst';
    sprite.geometry = sprite.geometry.clone();
    const iSpawn = instanced(count, 4);
    const iVel = instanced(count, 4);
    const iLook = instanced(count, 4);
    const iMotion = instanced(count, 4);
    for (let i = 0; i < count; i += 1) iSpawn.array[i * 4 + 3] = -1e6;
    sprite.geometry.setAttribute('iSpawn', iSpawn);
    sprite.geometry.setAttribute('iVel', iVel);
    sprite.geometry.setAttribute('iLook', iLook);
    sprite.geometry.setAttribute('iMotion', iMotion);
    sprite.count = count;
    sprite.frustumCulled = false;
    sprite.renderOrder = 41;
    sprite.layers.set(DIRECT_ONLY_LAYER);
    return {
        sprite, iSpawn, iVel, iLook, iMotion,
    };
}

/** How far ahead of the cursor a burst pixel looks for a spent slot. */
const BURST_PROBE = 12;

/** Reorder a BoxGeometry's index so its −y face (the foot) is drawn before the others. */
function footFirst(geometry) {
    const index = geometry.index.array;
    const out = new index.constructor(index.length);
    let at = 0;
    // BoxGeometry builds its faces +x, −x, +y, −y, +z, −z.
    for (const face of [3, 0, 1, 2, 4, 5]) {
        const { start, count } = geometry.groups[face];
        out.set(index.subarray(start, start + count), at);
        at += count;
    }
    geometry.setIndex(new THREE.BufferAttribute(out, 1));
    geometry.clearGroups();
}

/** How a locked piece's hologram stands: full height (in grid cells) and when it rises. */
export const TILE_HOLOGRAM = Object.freeze({ height: 0.9, rise: 0.16, sink: 0.45 });

/**
 * Where a cell of a piece's hologram meets the rest of the piece, as bits of one integer (world
 * axes: +z is toward the camera). A side that JOINS another cell draws no wall and no edge, so
 * the cells read as one solid piece with ONE outline round it; a CORNER bit marks an inner
 * corner of the outline (both sides joined, the cell between them not the piece's); an END bit
 * says a wall's upright edge stands at that end (where the outline turns, out or in).
 */
export const OUTLINE_BITS = Object.freeze({
    joinPX: 1,
    joinNX: 2,
    joinPZ: 4,
    joinNZ: 8,
    cornerPXPZ: 16,
    cornerNXPZ: 32,
    cornerPXNZ: 64,
    cornerNXNZ: 128,
    /** The +x wall's ends: toward +z, toward −z; then the −x, +z and −z walls'. */
    endPXtoPZ: 256,
    endPXtoNZ: 512,
    endNXtoPZ: 1024,
    endNXtoNZ: 2048,
    endPZtoPX: 4096,
    endPZtoNX: 8192,
    endNZtoPX: 16384,
    endNZtoNX: 32768,
});

/**
 * The outline bits for each cell of a piece, from its cells in the piece's own grid (x right,
 * y AWAY from the camera, so +z in the world is −y here).
 * @param {Array<[number, number]>} cells
 * @returns {number[]}
 */
export function pieceOutlineBits(cells) {
    const B = OUTLINE_BITS;
    const has = (x, y) => cells.some(([cx, cy]) => cx === x && cy === y);
    return cells.map(([x, y]) => {
        const px = has(x + 1, y);
        const nx = has(x - 1, y);
        const pz = has(x, y - 1);
        const nz = has(x, y + 1);
        const dPP = has(x + 1, y - 1);
        const dNP = has(x - 1, y - 1);
        const dPN = has(x + 1, y + 1);
        const dNN = has(x - 1, y + 1);
        // A wall's end carries an upright edge where the wall turns: out (nothing beside it
        // along the wall) or in (the cell past the corner is the piece's own).
        const turns = (along, past) => !along || past;
        let bits = 0;
        if (px) bits |= B.joinPX;
        if (nx) bits |= B.joinNX;
        if (pz) bits |= B.joinPZ;
        if (nz) bits |= B.joinNZ;
        if (px && pz && !dPP) bits |= B.cornerPXPZ;
        if (nx && pz && !dNP) bits |= B.cornerNXPZ;
        if (px && nz && !dPN) bits |= B.cornerPXNZ;
        if (nx && nz && !dNN) bits |= B.cornerNXNZ;
        if (turns(pz, dPP)) bits |= B.endPXtoPZ;
        if (turns(nz, dPN)) bits |= B.endPXtoNZ;
        if (turns(pz, dNP)) bits |= B.endNXtoPZ;
        if (turns(nz, dNN)) bits |= B.endNXtoNZ;
        if (turns(px, dPP)) bits |= B.endPZtoPX;
        if (turns(nx, dNP)) bits |= B.endPZtoNX;
        if (turns(px, dPN)) bits |= B.endNZtoPX;
        if (turns(nx, dNN)) bits |= B.endNZtoNX;
        return bits;
    });
}

/**
 * Each locked piece stands up out of the glass as ONE hologram: a solid footprint in the glass,
 * walls round its outline that fade toward the top, one glowing outline at the foot and one at
 * the lid. It sinks back into the glass as it rides the floor's scroll toward the camera,
 * leaving its footprint to fade.
 *
 * One box per cell, every box the full grid pitch (no gaps); the outline bits (above) drop the
 * walls and edges between cells, so nothing marks where one cell meets the next. The footprint
 * covers the glass under it (premultiplied "over": the grid lines do not cross the piece); the
 * walls and the lid add light. Transparent and double-sided, the mesh draws its back faces
 * (every footprint, seen from above) before its front faces (the walls turned toward the eye),
 * so a wall is never dimmed by a footprint behind it.
 *
 * Height, rise and fade are a function of age (closed form, no uploads per frame).
 */
function createTiles(u, count) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskTiles';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    material.fog = false;

    const cell = attribute('iCell', 'vec4'); // x, z at a scroll run of 0, t0, life
    const tint = attribute('iTint', 'vec4'); // r, g, b, outline bits
    const age = u.time.sub(cell.z);
    const lifeT = clamp(age.div(max(cell.w, 1e-3)), 0.0, 1.0);
    const alive = step(0.0, age).mul(step(age, cell.w));
    // Pops up (a small overshoot), holds, then sinks back into the glass by `sink` of its life.
    const up = smoothstep(0.0, TILE_HOLOGRAM.rise, age);
    const pop = up.add(exp(age.sub(TILE_HOLOGRAM.rise).mul(-9.0)).mul(0.18).mul(up));
    const stand = pop.mul(float(1.0).sub(smoothstep(TILE_HOLOGRAM.sink * 0.35, TILE_HOLOGRAM.sink, lifeT)));
    // The lift stands every live hologram taller as play heats (a skyline in the glass).
    const height = stand.mul(GRID_SPACING * TILE_HOLOGRAM.height).mul(u.tileLift).add(0.02);
    // Ride the scroll: the piece keeps its place on the grid however fast the grid runs.
    const local = positionLocal.mul(alive);
    material.positionNode = vec3(local.x, local.y.mul(height), local.z)
        .add(vec3(cell.x, 0.04, cell.y.add(u.scrollRun)));
    material.outputNode = Fn(() => {
        // The box before it is stretched: x, z ±half a cell, y 0 (foot) … 1 (lid).
        const g = positionGeometry;
        const a = g.x.div(GRID_SPACING * 0.5).toVar();
        const b = g.z.div(GRID_SPACING * 0.5).toVar();
        const h = clamp(g.y, 0.0, 1.0).toVar();
        const n = normalLocal;
        const isTop = step(0.5, n.y);
        const isBase = step(0.5, n.y.negate()).toVar();
        const isSide = float(1.0).sub(isTop).sub(isBase).toVar();
        const facePX = step(0.5, n.x);
        const faceNX = step(0.5, n.x.negate());
        const facePZ = step(0.5, n.z);
        const faceNZ = step(0.5, n.z.negate());
        // Constant per instance, but interpolated: round before reading bits.
        const bits = floor(tint.w.add(0.5)).toVar();
        const bit = (value) => mod(floor(bits.div(value)), 2.0);
        const B = OUTLINE_BITS;
        const jPX = bit(B.joinPX);
        const jNX = bit(B.joinNX);
        const jPZ = bit(B.joinPZ);
        const jNZ = bit(B.joinNZ);
        const FAR = float(9.0);
        // Foot and lid: distance to the piece's outline (half cells), its open sides and the
        // inner corners only, so it runs on unbroken from one cell into the next.
        const open = (joined, d) => mix(d, FAR, joined);
        const corner = (value, dx, dz) => mix(FAR, length(vec2(dx, dz)), bit(value));
        const ia = float(1.0).sub(a);
        const oa = float(1.0).add(a);
        const ib = float(1.0).sub(b);
        const ob = float(1.0).add(b);
        const dLid = min(min(open(jPX, ia), open(jNX, oa)), min(open(jPZ, ib), open(jNZ, ob)))
            .min(min(corner(B.cornerPXPZ, ia, ib), corner(B.cornerNXPZ, oa, ib)))
            .min(min(corner(B.cornerPXNZ, ia, ob), corner(B.cornerNXNZ, oa, ob)))
            .toVar();
        // Walls: the foot and the lid line, and an upright edge only where the outline turns.
        const lat = facePX.add(faceNX).mul(b).add(facePZ.add(faceNZ).mul(a));
        const endP = facePX.mul(bit(B.endPXtoPZ)).add(faceNX.mul(bit(B.endNXtoPZ)))
            .add(facePZ.mul(bit(B.endPZtoPX))).add(faceNZ.mul(bit(B.endNZtoPX)));
        const endN = facePX.mul(bit(B.endPXtoNZ)).add(faceNX.mul(bit(B.endNXtoNZ)))
            .add(facePZ.mul(bit(B.endPZtoNX))).add(faceNZ.mul(bit(B.endNZtoNX)));
        const dFootLid = min(h.mul(2.0), float(1.0).sub(h).mul(2.0));
        const dEnds = min(mix(FAR, float(1.0).sub(lat), endP), mix(FAR, float(1.0).add(lat), endN));
        const dWall = min(dFootLid, dEnds);
        // A wall between two cells of the piece is not drawn at all.
        const inner = facePX.mul(jPX).add(faceNX.mul(jNX)).add(facePZ.mul(jPZ)).add(faceNZ.mul(jNZ));
        const shown = float(1.0).sub(isSide.mul(inner));
        const d = mix(dLid, dWall, isSide);
        const edge = float(1.0).sub(smoothstep(0.07, 0.2, d)).mul(smoothstep(0.0, 0.04, d));
        // The footprint: one even body, a little brighter toward its outline; the walls fade
        // toward the top like a hologram, with scan lines climbing them; the lid is faint.
        const baseFill = float(1.0).sub(smoothstep(0.0, 0.9, dLid)).mul(0.16).add(0.26);
        const sideFill = float(1.0).sub(h).mul(0.17).add(0.025);
        const scan = sin(h.mul(26.0).sub(u.time.mul(7.0))).mul(0.5).add(0.5).mul(0.08);
        const fill = baseFill.mul(isBase).add(sideFill.add(scan).mul(isSide)).add(isTop.mul(0.05));
        const flash = exp(age.mul(-6.0)).mul(1.4);
        const fade = smoothstep(0.0, 0.04, lifeT).mul(pow(float(1.0).sub(lifeT), 1.4)).mul(alive).toVar();
        const edgeGain = mix(float(1.2), float(2.3), isBase.add(isTop.mul(0.6)));
        const light = tint.xyz.mul(edge.mul(edgeGain).add(fill).add(flash.mul(fill))).mul(fade).mul(shown);
        // Premultiplied: the light is added; the footprint also covers the glass beneath it.
        return vec4(light, isBase.mul(fade).mul(0.85));
    })();

    // A unit-height box standing on y = 0 (the shader stretches it to the hologram's height),
    // the full grid pitch wide. Its foot is drawn first, so the walls of the same cell land on it.
    const geometry = new THREE.BoxGeometry(GRID_SPACING, 1, GRID_SPACING);
    geometry.translate(0, 0.5, 0);
    footFirst(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'NeonDuskTiles';
    const iCell = instanced(count, 4);
    const iTint = instanced(count, 4);
    for (let i = 0; i < count; i += 1) iCell.array.set([0, 0, -1e6, 1], i * 4);
    geometry.setAttribute('iCell', iCell);
    geometry.setAttribute('iTint', iTint);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    // Lying on the glass, a tile would meet its own reflection; the rippled, blurred copy only
    // reads as a ghost, so tiles stay out of the reflector's view (the world binds the layer).
    mesh.layers.set(DIRECT_ONLY_LAYER);
    return { mesh, iCell, iTint };
}

export class NeonDuskFx {
    /**
     * @param {object} u  shared world uniforms
     * @param {object} opts
     * @param {number} opts.dust
     * @param {number} opts.burst
     * @param {number} opts.tiles
     * @param {() => number} opts.rand
     */
    constructor(u, {
        dust, burst, tiles, rand,
    }) {
        this.group = new THREE.Group();
        this.group.name = 'NeonDuskFx';
        this.dust = dust > 0 ? createDust(u, dust, rand) : null;
        this.burst = createBurstPixels(u, Math.max(1, burst));
        this.burstCursor = 0;
        /** When each burst slot's pixel goes out (t0 + life): a new pixel takes a spent slot. */
        this.burstEnd = new Float64Array(this.burst.iSpawn.count).fill(-Infinity);
        this.tiles = createTiles(u, Math.max(4, tiles));
        // The tile cursor runs DOWN the buffer: a newer piece (spawned farther off, the older
        // ones having ridden toward the camera) is drawn before the older ones in front of it.
        this.tileCursor = 0;
        if (this.dust) this.group.add(this.dust);
        this.group.add(this.burst.sprite);
        this.group.add(this.tiles.mesh);
    }

    get burstCapacity() {
        return this.burst.iSpawn.count;
    }

    get tileCapacity() {
        return this.tiles.iCell.count;
    }

    /**
     * Emit one burst pixel: world position/velocity, life (s), THREE.Color, size (px), and its
     * motion (`drag` 1/s, `lift` units/s² upward, `flicker` rate rad/s, `phase`).
     */
    spawnPixel(t0, px, py, pz, vx, vy, vz, life, color, sizePx, motion = {}) {
        const {
            iSpawn, iVel, iLook, iMotion,
        } = this.burst;
        const i = this.takeBurstSlot(t0);
        this.burstEnd[i] = t0 + life;
        iSpawn.array.set([px, py, pz, t0], i * 4);
        iVel.array.set([vx, vy, vz, life], i * 4);
        iLook.array.set([color.r, color.g, color.b, sizePx], i * 4);
        iMotion.array.set([motion.drag ?? 1.2, motion.lift ?? 0, motion.flicker ?? 14, motion.phase ?? 0], i * 4);
        touch(iSpawn, i);
        touch(iVel, i);
        touch(iLook, i);
        touch(iMotion, i);
    }

    /**
     * The slot for a pixel spawned at `t0`: the next spent one a few slots ahead of the cursor,
     * else, with every one of those still flying (a quad, a cascade and a level-up at once),
     * the one closest to going out — never a pixel that has only just left the sun.
     */
    takeBurstSlot(t0) {
        const n = this.burstEnd.length;
        let best = this.burstCursor;
        for (let k = 0; k < BURST_PROBE && k < n; k += 1) {
            const i = (this.burstCursor + k) % n;
            if (this.burstEnd[i] <= t0) {
                best = i;
                break;
            }
            if (this.burstEnd[i] < this.burstEnd[best]) best = i;
        }
        this.burstCursor = (best + 1) % n;
        return best;
    }

    /**
     * Stand one locked piece up in the glass: its cells (world x, z of each centre at t0, and
     * each cell's outline bits, see pieceOutlineBits), nearest the camera first, in one colour
     * for `life` s. `run` is the floor's scroll run at t0 (the piece rides it).
     */
    spawnPiece(t0, cells, color, life, run) {
        const { iCell, iTint } = this.tiles;
        const n = iCell.count;
        for (const cell of cells) {
            this.tileCursor = (this.tileCursor - 1 + n) % n;
            const i = this.tileCursor;
            iCell.array.set([cell.x, cell.z - run, t0, life], i * 4);
            iTint.array.set([color.r, color.g, color.b, cell.bits], i * 4);
            touch(iCell, i);
            touch(iTint, i);
        }
    }

    /**
     * Kill every live pixel and tile. The whole buffer is queued as one update range: spawns in
     * the same frame add their own ranges, and with ranges present only ranges are uploaded —
     * a bare needsUpdate would leave the killed instances alive on the GPU.
     */
    clear() {
        const { iSpawn } = this.burst;
        for (let i = 0; i < iSpawn.count; i += 1) iSpawn.array[i * 4 + 3] = -1e6;
        this.burstEnd.fill(-Infinity);
        iSpawn.clearUpdateRanges();
        iSpawn.addUpdateRange(0, iSpawn.array.length);
        iSpawn.needsUpdate = true;
        const { iCell } = this.tiles;
        for (let i = 0; i < iCell.count; i += 1) iCell.array[i * 4 + 2] = -1e6;
        iCell.clearUpdateRanges();
        iCell.addUpdateRange(0, iCell.array.length);
        iCell.needsUpdate = true;
    }

    dispose() {
        this.group.removeFromParent();
        this.group.traverse((obj) => {
            obj.geometry?.dispose();
            obj.material?.dispose();
        });
    }
}
