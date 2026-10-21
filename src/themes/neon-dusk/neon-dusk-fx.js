/**
 * Neon Dusk — gameplay and atmosphere FX: drifting neon pixel dust, burst pixels, and the
 * tetromino tiles that light up in the glass when a piece locks.
 *
 * Motion is analytic in the vertex stage (spawn state + age), so nothing is uploaded per frame:
 * a spawn writes one instance's attributes as a ranged upload, and the same code runs on both
 * WebGPURenderer backends. Dust and burst pixels are instanced Sprites (THREE.Points would be one
 * pixel wide on WebGPU whatever the size node says); the tiles are an InstancedMesh lying on
 * the floor and riding its scroll.
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
    fract,
    length,
    max,
    mix,
    normalLocal,
    positionLocal,
    pow,
    sin,
    smoothstep,
    step,
    uv,
    vec3,
} from 'three/tsl';
import { GRID_SPACING, RIG, SCROLL_SPEED } from './neon-dusk-tsl.js';

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
    // Rise slowly through a 34-unit column and wrap; drift sideways a little.
    const rise = fract(t.mul(0.014).add(ph.mul(0.159))).mul(34.0);
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
            .mul(1.6));
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

/** How a locked piece's hologram cubes stand: full height (in grid cells) and when they rise. */
export const TILE_HOLOGRAM = Object.freeze({ height: 0.9, rise: 0.16, sink: 0.45 });

/**
 * Tetromino tiles lit in the glass: each cell of a locked piece stands up out of the glass as a
 * hologram cube — glowing edges, a fill that fades toward its top, a lit floor tile — then sinks
 * back into the glass as it rides the floor's scroll toward the camera, leaving the tile to fade.
 * One unit box per instance, its height a function of age (closed form, no uploads per frame).
 */
function createTiles(u, count) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NeonDuskTiles';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.fog = false;

    const cell = attribute('iCell', 'vec4'); // x, z, t0, life
    const tint = attribute('iTint', 'vec4'); // r, g, b, 0
    const age = u.time.sub(cell.z);
    const lifeT = clamp(age.div(max(cell.w, 1e-3)), 0.0, 1.0);
    const alive = step(0.0, age).mul(step(age, cell.w));
    // Pops up (a small overshoot), holds, then sinks back into the glass by `sink` of its life.
    const up = smoothstep(0.0, TILE_HOLOGRAM.rise, age);
    const pop = up.add(exp(age.sub(TILE_HOLOGRAM.rise).mul(-9.0)).mul(0.18).mul(up));
    const stand = pop.mul(float(1.0).sub(smoothstep(TILE_HOLOGRAM.sink * 0.35, TILE_HOLOGRAM.sink, lifeT)));
    const height = stand.mul(GRID_SPACING * TILE_HOLOGRAM.height).add(0.02);
    // Ride the scroll: the grid moves toward +z at SCROLL_SPEED.
    const local = positionLocal.mul(alive);
    material.positionNode = vec3(local.x, local.y.mul(height), local.z)
        .add(vec3(cell.x, 0.04, cell.y.add(age.mul(SCROLL_SPEED))));
    material.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const box = max(abs(st.x), abs(st.y));
        const ny = normalLocal.y;
        const isTop = step(0.5, ny);
        const isBase = step(0.5, ny.negate());
        const isSide = float(1.0).sub(isTop).sub(isBase);
        // Every face draws its rim: together the rims are the cube's glowing edges.
        const edge = smoothstep(0.8, 0.93, box).mul(float(1.0).sub(smoothstep(0.96, 1.0, box)));
        // The base is the lit tile in the glass; the sides fade toward the top like a hologram.
        const baseFill = float(1.0).sub(smoothstep(0.0, 0.95, box)).mul(0.35).add(0.14);
        const sideFill = float(1.0).sub(clamp(uv().y, 0.0, 1.0)).mul(0.17).add(0.025);
        const scan = sin(uv().y.mul(26.0).sub(u.time.mul(7.0))).mul(0.5).add(0.5).mul(0.08);
        const fill = baseFill.mul(isBase).add(sideFill.add(scan).mul(isSide)).add(isTop.mul(0.05));
        const flash = exp(age.mul(-6.0)).mul(1.4);
        const fade = smoothstep(0.0, 0.04, lifeT).mul(pow(float(1.0).sub(lifeT), 1.4));
        const edgeGain = mix(float(1.2), float(2.3), isBase.add(isTop.mul(0.6)));
        return tint.xyz.mul(edge.mul(edgeGain).add(fill).add(flash.mul(fill))).mul(fade);
    })();
    material.opacityNode = float(1.0);

    // A unit-height box standing on y = 0 (the shader stretches it to the hologram's height).
    const geometry = new THREE.BoxGeometry(GRID_SPACING * 0.96, 1, GRID_SPACING * 0.96);
    geometry.translate(0, 0.5, 0);
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
        this.tiles = createTiles(u, Math.max(4, tiles));
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
        const i = this.burstCursor;
        this.burstCursor = (i + 1) % iSpawn.count;
        iSpawn.array.set([px, py, pz, t0], i * 4);
        iVel.array.set([vx, vy, vz, life], i * 4);
        iLook.array.set([color.r, color.g, color.b, sizePx], i * 4);
        iMotion.array.set([motion.drag ?? 1.2, motion.lift ?? 0, motion.flicker ?? 14, motion.phase ?? 0], i * 4);
        touch(iSpawn, i);
        touch(iVel, i);
        touch(iLook, i);
        touch(iMotion, i);
    }

    /** Light one floor cell (world x, z of its centre at time t0) in a colour for `life` s. */
    spawnTile(t0, x, z, color, life = 2.6) {
        const { iCell, iTint } = this.tiles;
        const i = this.tileCursor;
        this.tileCursor = (i + 1) % iCell.count;
        iCell.array.set([x, z, t0, life], i * 4);
        iTint.array.set([color.r, color.g, color.b, 0], i * 4);
        touch(iCell, i);
        touch(iTint, i);
    }

    /**
     * Kill every live pixel and tile. The whole buffer is queued as one update range: spawns in
     * the same frame add their own ranges, and with ranges present only ranges are uploaded —
     * a bare needsUpdate would leave the killed instances alive on the GPU.
     */
    clear() {
        const { iSpawn } = this.burst;
        for (let i = 0; i < iSpawn.count; i += 1) iSpawn.array[i * 4 + 3] = -1e6;
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
