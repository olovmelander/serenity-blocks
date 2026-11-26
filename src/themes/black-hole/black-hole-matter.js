/**
 * Tidal gas streams, orbiting debris, the pieces the player feeds the disk,
 * the ejecta of a clear streak and the two polar jets.
 *
 * None of it is simulated. Every mote's position is a closed-form function of a clock and a
 * few per-event uniforms, evaluated in the vertex shader, so a frame can be replayed
 * exactly, geometry stays resident, and both backends run the same code. Each mote is
 * drawn as a streak from where it was a moment ago, bent by the same point-mass lens as the
 * sky so matter passing behind the hole rises around the shadow instead of crossing it.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, dot, exp, float,
    floor, fract, hash, instanceIndex, length, log, max, min, mix, mod, normalGeometry, normalize,
    positionGeometry, pow, rotate, select, sin,
    smoothstep, sqrt, texture, uniform, uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { DIRECTOR_LIMITS } from './black-hole-director.js';
import { HOLE } from './black-hole-lens.js';
import { createShardGeometry } from './black-hole-shard.js';

const TAU = Math.PI * 2;
/** The dust's clock wraps here; every per-mote rate is a multiple of 1/TURN_WRAP so the wrap is exact. */
export const TURN_WRAP = 256;
const CULLED = vec4(0, 0, 2, 1);

// Half-width of each opposing fan, angular speed, radial speed and its spread,
// axial lift, and release time. These values are shared by each slot, so shape
// selection adds no branch to a spark's vertex shader.
const EJECTA = [
    {
        fan: Math.PI, wind: 2.1, speed: 2.4, spread: 4.8, axis: 0, release: 0.35, tint: [1, 0.6, 0.22, 0],
    },
    {
        fan: 1.12, wind: 1.3, speed: 1.55, spread: 2.6, axis: 1.15, release: 0.55, tint: [0.29, 0.59, 1, 0.57],
    },
    {
        fan: 0.3, wind: 4.6, speed: 2.0, spread: 1.9, axis: 0.73, release: 1.02, tint: [0.57, 0.24, 1, 0.88],
    },
    {
        fan: 0.44, wind: 2.15, speed: 3.9, spread: 1.7, axis: 0.18, release: 0.69, tint: [0.21, 0.82, 1, 0.84],
    },
    {
        fan: Math.PI, wind: 1.24, speed: 5.55, spread: 0.66, axis: 0.025, release: 0.22, tint: [1, 0.68, 0.22, 0.8],
    },
];

/** Same ramp as the disk: ember, flame, gold, white, blue-white. */
const blackbody = (heat) => {
    const a = mix(vec3(0.42, 0.03, 0.006), vec3(1.0, 0.27, 0.035), smoothstep(0.2, 0.5, heat));
    const b = mix(a, vec3(1.0, 0.6, 0.2), smoothstep(0.46, 0.82, heat));
    const c = mix(b, vec3(1.0, 0.9, 0.74), smoothstep(0.8, 1.2, heat));
    return mix(c, vec3(0.68, 0.82, 1.0), smoothstep(1.25, 1.9, heat));
};

export function createMatterUniforms(lens) {
    return {
        holePosition: lens.holePosition,
        rs: lens.rs,
        /** Disk frame → world: the transpose of the lens's rotation. */
        diskToWorld: uniform(lens.worldToDisk.value.clone().transpose()),
        aspect: uniform(16 / 9),
        viewHeight: uniform(1080),
        time: uniform(0),
        /** Turns of the inner edge, wrapped at TURN_WRAP. */
        turns: uniform(0),
        surge: uniform(0),
        heat: uniform(1),
        jets: uniform(0),
        /** 0…1: a fever opens the jets up — longer, wider, their field lines wound tight. */
        jetFlare: uniform(0),
    };
}

/**
 * Thin-lens image of a world point: matter behind the hole appears pushed out around it.
 * Returns the apparent point and 0…1 visibility (0 where the image falls in the shadow).
 */
export const lensPoint = (u, point) => {
    const toHole = u.holePosition.sub(cameraPosition);
    const lensDistance = max(length(toHole), 1);
    const axis = toHole.div(lensDistance);
    const relative = point.sub(cameraPosition);
    const depth = dot(relative, axis);
    const safeDepth = max(depth, 1);
    const off = relative.sub(axis.mul(depth));
    const offLength = max(length(off), 0.01);
    const behind = max(depth.sub(lensDistance), 0);
    const beta = offLength.div(safeDepth);
    const einstein = u.rs.mul(2).mul(behind).div(lensDistance.mul(safeDepth));
    const theta = beta.add(sqrt(beta.mul(beta).add(einstein.mul(4)))).mul(0.5);
    const position = cameraPosition.add(axis.mul(depth)).add(off.mul(theta.div(beta)));
    const shadow = u.rs.mul(HOLE.CRITICAL);
    const impact = theta.mul(lensDistance);
    const hidden = smoothstep(shadow.mul(1.12), shadow.mul(0.98), impact).mul(smoothstep(0, u.rs.mul(0.6), behind));
    // Dead behind the hole a point smears round the whole Einstein ring. A streak cannot
    // draw that, so the mote fades out as its image stretches.
    const stretched = smoothstep(2.4, 5.5, theta.div(beta));
    return { position, visible: hidden.oneMinus().mul(stretched.oneMinus()) };
};

const project = (point) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(point, 1));

/**
 * A screen-space streak from `tail` to `head` (clip space), `width` pixels across; the
 * vertex is thrown away unless `alive`. One conditional only: the WebGL2 builder cannot
 * build a branch nested inside another branch here.
 */
const streakClip = (u, head, tail, width, alive = null, joined = null) => {
    const aspect = vec2(u.aspect, 1);
    const heading = head.xy.div(head.w).sub(tail.xy.div(tail.w)).mul(aspect);
    // At rest the cell still occupies a quad. The offset also keeps this branch-free
    // on the WebGL2 path, where the clip test below is already conditional.
    const travel = length(heading);
    const along = heading.div(max(travel, 1e-5)).add(vec2(float(1).sub(smoothstep(0, 1e-5, travel)), 0));
    const across = vec2(along.y.negate(), along.x);
    const end = positionGeometry.x.add(0.5);
    const centre = mix(tail, head, joined ? mix(end, float(1), joined) : end);
    const half = width.div(u.viewHeight);
    // The quad overhangs both ends by half its width, so a mote at rest is a round dot.
    const offset = across.mul(positionGeometry.y.mul(2)).add(along.mul(positionGeometry.x.mul(2))
        .mul(joined ? joined.oneMinus() : 1))
        .mul(half).div(aspect);
    const inFront = head.w.greaterThan(0.01).and(tail.w.greaterThan(0.01));
    return Fn(() => {
        const corner = vec4(centre.xy.add(offset.mul(centre.w)), centre.z, centre.w).toVar();
        return select(alive ? inFront.and(alive) : inFront, corner, CULLED);
    })();
};

/** Soft streak profile: a round head that fades back along the tail. */
const streakShape = () => {
    const across = uv().y.sub(0.5).mul(2);
    const along = uv().x;
    return exp(across.mul(across).mul(-3.2)).mul(smoothstep(0.0, 0.85, along)).mul(smoothstep(1.0, 0.86, along));
};

const additive = (name) => {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        // With a custom output of alpha zero, light is added and the target's alpha is left
        // alone: the lens keeps the bare shadow there for the post chain.
        premultipliedAlpha: true,
        fog: false,
    });
    material.name = name;
    return material;
};

const toWorld = (u, diskPoint) => u.diskToWorld.mul(diskPoint).mul(u.rs).add(u.holePosition);

export class BlackHoleMatter {
    /**
     * @param {object} options
     * @param {THREE.Object3D} options.parent
     * @param {object} options.preset quality preset
     * @param {object} options.lens the lens uniforms (hole position, scale, disk frame)
     * @param {THREE.Texture} options.gasTexture the disk's tileable gas texture
     */
    constructor({
        parent, preset, lens, gasTexture,
    }) {
        this.preset = preset;
        this.disposed = false;
        this.uniforms = createMatterUniforms(lens);
        this.worldToDisk = lens.worldToDisk;
        this.gasTexture = gasTexture;
        this.group = new THREE.Group();
        this.group.name = 'Black Hole — matter';
        parent.add(this.group);
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.materials = [];
        this.createDust();
        this.createInfall();
        this.createSparks();
        this.createJets();
        if (preset.fragmentCount > 0) this.createFragments();
    }

    /** Sparse, tumbling solids stripped off the streams. One instanced mesh. */
    createFragments() {
        const u = this.uniforms;
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            depthTest: false,
            fog: false,
            // An opaque face can cover the gas, but it never changes the lens's bloom mask.
            blending: THREE.CustomBlending,
            blendSrc: THREE.SrcAlphaFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
        });
        material.name = 'Black Hole — fractured debris';
        const index = float(instanceIndex);
        const family = mod(index, 3);
        const rnd = (k) => hash(index.mul(11).add(k));
        const phase = u.turns.mul((TAU * 8) / TURN_WRAP).add(family.mul(2.12));
        const age = fract(u.turns.mul(32 / TURN_WRAP).add(rnd(0)));
        const radius = mix(family.mul(1.3).add(12.55), float(5.2), pow(age, 1.17)).add(rnd(1).sub(0.5).mul(1.4));
        const azimuth = phase.add(sin(phase.mul(0.5).add(family)).mul(0.32))
            .add(age.mul(0.85)).add(age.mul(age).mul(family.mul(0.38).add(3.2)))
            .add(rnd(2).sub(0.5).mul(0.24));
        const altitude = sin(phase.mul(0.5).add(family).add(age.mul(2.8))).mul(0.14)
            .add(0.075).add(rnd(3).sub(0.5).mul(0.16));
        const disk = vec3(
            cos(azimuth).mul(radius),
            radius.mul(altitude).mul(age.oneMinus().add(0.15)),
            sin(azimuth).mul(radius),
        );
        const centre = toWorld(u, disk);
        const apparent = lensPoint(u, centre);
        const clip = project(apparent.position);
        const size = min(u.rs.mul(rnd(4).mul(0.135).add(0.094)), max(1, clip.w).mul(6.3).div(u.viewHeight));
        const spin = vec3(rnd(5), rnd(6), rnd(7)).mul(0.82).add(0.11).mul(u.time)
            .add(vec3(rnd(6), rnd(7), rnd(8)).mul(TAU));
        const shape = vec3(rnd(7).mul(0.32).add(0.77), rnd(8).mul(0.75).add(0.72), rnd(9).mul(0.41).add(0.86));
        const offset = rotate(positionGeometry.mul(shape), spin).mul(size);
        material.vertexNode = Fn(() => project(apparent.position.add(offset)))();
        const normal = normalize(rotate(normalGeometry.div(shape), spin));
        const light = normalize(u.holePosition.sub(centre));
        const eye = normalize(cameraPosition.sub(centre));
        const hot = pow(max(0, dot(normal, light)), 1.65).mul(u.heat);
        const rim = pow(max(0, dot(normal, eye)).oneMinus(), 2)
            .mul(max(dot(normal, vec3(-0.41, 0.78, 0.47)), 0).mul(0.76).add(0.24));
        const colour = varying(vec3(0.005, 0.009, 0.014).add(vec3(0.46, 0.16, 0.035).mul(hot))
            .add(vec3(0.092, 0.19, 0.35).mul(rim)));
        const screen = clip.xy.div(max(1, clip.w)).mul(vec2(0.5, -0.5)).add(0.5);
        const holeClip = project(u.holePosition);
        const separation = length(clip.xy.div(max(clip.w, 1)).sub(holeClip.xy.div(max(1, holeClip.w)))
            .mul(vec2(u.aspect, 1)));
        const shadowRadius = u.rs.mul(HOLE.CRITICAL).mul(cameraProjectionMatrix.element(1).y).div(max(1, holeClip.w));
        const defaultRect = () => new THREE.Vector4(0.4, 0.1, 0.6, 0.9);
        this.fragmentBoards = Array.from({ length: DIRECTOR_LIMITS.boards }, defaultRect);
        const rects = uniformArray(this.fragmentBoards, 'vec4');
        // Already fading into the dark before a shard reaches a card, the bare
        // shadow, the camera or its respawn. All of this is per vertex.
        let visibility = smoothstep(0.02, 0.17, age).mul(smoothstep(0.8, 0.99, age).oneMinus())
            .mul(smoothstep(u.rs.mul(3), u.rs.mul(7), clip.w))
            .mul(smoothstep(shadowRadius.mul(1.17), shadowRadius.mul(1.70), separation))
            .mul(apparent.visible);
        for (let i = 0; i < this.fragmentBoards.length; i += 1) {
            const rect = rects.element(i);
            const outside = max(rect.xy.sub(screen), screen.sub(rect.zw));
            visibility = min(visibility, smoothstep(0.012, 0.042, max(outside.x, outside.y)));
        }
        material.outputNode = vec4(colour, varying(visibility));
        const mesh = new THREE.InstancedMesh(createShardGeometry(), material, this.preset.fragmentCount);
        this.fragments = this.add(mesh, 'Black Hole — fractured debris', 25);
    }

    add(mesh, name, order) {
        const target = mesh;
        target.name = name;
        target.frustumCulled = false;
        target.renderOrder = order;
        this.materials.push(target.material);
        this.group.add(target);
        return target;
    }

    /** Motes on Keplerian orbits, sinking slowly through the disk and vanishing at its inner edge. */
    createDust() {
        const u = this.uniforms;
        const count = Math.max(1, this.preset.dustCount);
        const material = additive('Black Hole — dust');
        const index = float(instanceIndex);
        const id = index.mul(8);
        const rnd = (k) => hash(id.add(k));
        // One in three motes belongs to a tidal stream. The members share their
        // source, orbit and height, so the sky shows torn filaments flowing into
        // the rim. The rest stay in the disk as independently orbiting glints.
        const stream = float(1).sub(smoothstep(0, 1, mod(index, 3)));
        const family = mod(floor(index.div(3)), 3);
        // Alternate numbered sections of a continuous gas sheet with independent
        // pieces of grit. Every section meets the next on the same curve even
        // at Minimal, where there are just 23–24 sections per tidal stream.
        const sheet = stream.mul(float(1).sub(mod(floor(index.div(9)), 2)));
        const segments = floor(float(count + 17).sub(family.mul(3)).div(18));
        const section = floor(index.div(18));
        const shard = stream.mul(sheet.oneMinus()).mul(smoothstep(0.86, 0.94, rnd(7)));
        const gradualTurn = u.turns.mul((TAU * 8) / TURN_WRAP);
        const phase = gradualTurn.add(family.mul(2.12));
        const originAngle = phase.add(sin(phase.mul(0.5).add(family)).mul(0.32))
            .add(rnd(4).sub(0.5).mul(0.027).mul(sheet.oneMinus()));
        const outer = mix(
            mix(float(3.4), float(11.2), pow(rnd(0), 0.75)),
            family.mul(1.3).add(12.55).add(rnd(0).sub(0.5).mul(0.4).mul(sheet.oneMinus())),
            stream,
        );
        // Whole numbers of lifetimes per clock wrap, so the wrap is seamless.
        const lifetimes = mix(floor(mix(float(36), float(84), rnd(1))), family.mul(8).add(80), stream);
        const lifeRate = lifetimes.div(TURN_WRAP);
        const flare = rnd(3).sub(0.5).mul(stream.mul(-0.65).add(1)).mul(sheet.oneMinus());
        const place = (turns, end) => {
            const sectionLife = clamp(section.add(end).div(segments), 0, 1);
            const life = mix(fract(turns.mul(lifeRate).add(rnd(2))), sectionLife, sheet);
            const radius = mix(outer, float(2.75), pow(life, mix(float(1.9), float(1.17), stream)))
                .mul(u.surge.mul(-0.1).add(1));
            const slow = pow(float(HOLE.DISK_INNER).div(outer), 1.5);
            // Swept angle: the orbit quickens as the mote sinks.
            const swept = slow.mul(life).add(float(1.16).sub(slow).mul(pow(life, 5)).div(5));
            const orbit = rnd(4).mul(TAU).add(swept.mul(TAU).mul(float(TURN_WRAP).div(lifetimes)));
            const streamOrbit = originAngle.add(life.mul(0.85)).add(life.mul(life).mul(family.mul(0.38).add(3.2)));
            const azimuth = mix(orbit, streamOrbit, stream);
            const altitude = sin(phase.mul(0.5).add(family).add(life.mul(2.8))).mul(0.14).add(0.075);
            const height = flare.mul(0.07).add(stream.mul(altitude)).mul(radius).mul(life.oneMinus().add(0.15));
            return { life, radius, point: vec3(cos(azimuth).mul(radius), height, sin(azimuth).mul(radius)) };
        };
        // Both quads at a join evaluate that cross-section and its projected
        // tangent from exactly the same orbital coordinate. There are no end caps
        // or double-covered pixels between sections of a sheet.
        const end = positionGeometry.x.add(0.5);
        const now = place(u.turns, end);
        const before = place(u.turns.sub(shard.mul(-0.8).add(1).mul(0.02)), end.sub(segments.mul(0.003)));
        // Across a respawn the tail would stretch over the whole disk; draw a dot instead.
        const continuous = now.life.greaterThan(before.life);
        const head = lensPoint(u, toWorld(u, now.point));
        const tail = lensPoint(u, toWorld(u, select(continuous, before.point, now.point)));
        const fade = smoothstep(0.0, 0.12, now.life).mul(smoothstep(0.75, 1.0, now.life).oneMinus());
        const warmth = pow(float(HOLE.DISK_INNER).div(now.radius), 0.9).mul(u.heat);
        const diskGlow = blackbody(warmth.mul(0.95).add(0.18))
            .mul(warmth.mul(1.3).add(0.1))
        // Fine glints in the gas, not dashes over it: most motes are faint, a few catch.
            .mul(rnd(5).mul(rnd(5)).mul(rnd(5)).mul(1.15)
                .add(0.06));
        // The diffuse tail reflects the blue nebula. The same filament turns to
        // copper and then yellow-white as it is stretched over the inner disk.
        const streamColour = mix(
            vec3(0.12, 0.21, 0.42),
            blackbody(warmth.mul(1.05).add(0.29)),
            smoothstep(0.20, 0.74, now.life),
        );
        const grainLight = rnd(5).mul(0.64).add(0.26)
            .mul(shard.mul(1.4).add(0.75))
            .mul(Math.min(1.75, Math.max(0.6, Math.sqrt(1500 / count))));
        const pulse = now.life.mul(18).sub(u.turns.mul(Math.PI * 0.5)).add(family.mul(2.37));
        const knot = smoothstep(-0.48, 0.88, sin(pulse.add(sin(pulse.mul(0.5)).mul(0.8)))
            .add(sin(pulse.mul(2)).mul(0.23)));
        const steam = knot.mul(knot).mul(0.33).add(0.019);
        const streamGlow = streamColour.mul(mix(grainLight, steam, sheet));
        const glow = varying(mix(diskGlow, streamGlow, stream).mul(fade).mul(head.visible)
            .mul(u.surge.mul(0.7).add(1)));
        // Never under a pixel across, or a slow orbit makes the dust shimmer.
        const grainWidth = rnd(6).mul(0.8).add(1.1).add(stream.mul(0.15))
            .add(shard.mul(2.3));
        const headClip = project(head.position);
        const sheetWidth = u.viewHeight.mul(u.rs).div(max(headClip.w, 1))
            .mul(sin(now.life.mul(Math.PI)).mul(0.28).add(0.17)).mul(knot.mul(0.48).add(0.72))
            .clamp(2, 26);
        material.vertexNode = streakClip(
            u,
            headClip,
            project(tail.position),
            mix(grainWidth, sheetWidth, sheet),
            null,
            sheet,
        );
        const local = uv().sub(0.5).mul(2);
        const edge = abs(local.y.add(local.x.mul(0.19))).mul(0.92).add(abs(local.x).mul(0.68));
        const facet = smoothstep(0.76, 1, edge).oneMinus().mul(smoothstep(-0.1, 0.12, local.x.add(local.y.mul(0.55)))
            .mul(0.71).add(0.19));
        // Thread the broader gas with two wisps. The phase is continuous across
        // every join and advects inwards through the folds of the sheet.
        const parcel = varying(now.life.mul(28).sub(u.turns.mul(Math.PI * 0.5)).add(family));
        const strand = local.y.sub(sin(parcel).mul(0.19)).sub(sin(parcel.mul(0.5)).mul(0.12));
        const flank = local.y.add(cos(parcel.mul(0.5)).mul(0.36));
        const sheetShape = exp(strand.mul(strand).mul(-4.8)).mul(0.36)
            .add(exp(strand.mul(strand).mul(-30)).mul(0.64))
            .add(exp(flank.mul(flank).mul(-42)).mul(0.25))
            .mul(smoothstep(0.73, 1, abs(local.y)).oneMinus());
        const gritShape = mix(streakShape(), facet, varying(shard));
        material.outputNode = vec4(glow.mul(mix(gritShape, sheetShape, varying(sheet))), 0);
        this.dust = this.add(new THREE.InstancedMesh(this.geometry, material, count), 'Black Hole — dust', 20);
    }

    /**
     * Fed pieces. Each slot is one locked piece: its motes start as the piece's own four
     * cells, peel away along a spiral that tightens onto the disk, and land where the
     * director lights the hot arc.
     */
    createInfall() {
        const u = this.uniforms;
        const slots = Math.min(DIRECTOR_LIMITS.infalls, Math.max(1, this.preset.infallSlots));
        const motes = Math.max(4, this.preset.infallMotes);
        this.infallSlots = slots;
        const vectors = () => Array.from({ length: slots }, () => new THREE.Vector4(0, 0, 0, 0));
        this.infallData = {
            origin: vectors(), // xyz world, w age (negative = idle)
            right: vectors(), // xyz one cell to screen-right in world units, w duration
            down: vectors(), // xyz one cell down the screen, w strength
            tint: vectors(), // rgb, w seed
            land: vectors(), // x radius, z swirl: radians swept round the hole on the way in
            cellsA: vectors(),
            cellsB: vectors(),
        };
        for (const origin of this.infallData.origin) origin.w = -1;
        const data = Object.fromEntries(
            Object.entries(this.infallData).map(([key, value]) => [key, uniformArray(value, 'vec4')]),
        );
        const material = additive('Black Hole — infall');
        const index = float(instanceIndex);
        const slot = floor(index.div(motes));
        const mote = index.sub(slot.mul(motes));
        const at = (array) => array.element(slot.toInt());
        const origin = at(data.origin);
        const right = at(data.right);
        const down = at(data.down);
        const tint = at(data.tint);
        const land = at(data.land);
        // Different motes each launch: fold the launch seed into every hash.
        const rnd = (k) => fract(hash(mote.mul(8).add(k)).add(tint.w.mul(0.61803)));
        const age = origin.w;
        const duration = max(right.w, 0.05);
        const drop = smoothstep(0.6, 0.96, down.w);
        const lag = rnd(0).mul(drop.mul(-0.16).add(0.44));
        const cellPair = select(mod(mote, 4).lessThan(2), at(data.cellsA), at(data.cellsB));
        const cell = select(mod(mote, 2).lessThan(1), cellPair.xy, cellPair.zw);
        const jitter = vec2(rnd(1), rnd(2)).sub(0.5).mul(0.86);
        const start = origin.xyz.add(right.xyz.mul(cell.x.add(jitter.x))).add(down.xyz.mul(cell.y.add(jitter.y)));
        const startDisk = this.worldToDisk.mul(start.sub(u.holePosition).div(u.rs));
        const startRadius = max(length(startDisk.xz), 0.1);
        const startAzimuth = atan(startDisk.z, startDisk.x);
        const stray = vec3(rnd(3), rnd(4), rnd(5)).sub(0.5);
        const place = (progress) => {
            const fall = pow(progress, 1.3);
            const radius = mix(startRadius, land.x.add(stray.x.mul(1.1)), fall);
            // Most of the sweep comes late, once the mote is deep in the well.
            const azimuth = startAzimuth.add(land.z.mul(pow(progress, 2.1)));
            const height = startDisk.y.mul(pow(progress.oneMinus(), 2.2))
                .add(stray.y.mul(0.6).mul(sin(progress.mul(Math.PI))));
            return vec3(cos(azimuth).mul(radius), height, sin(azimuth).mul(radius));
        };
        const progress = clamp(age.div(duration).sub(lag).div(drop.mul(0.16).add(0.56)), 0, 1);
        const head = lensPoint(u, toWorld(u, place(progress)));
        const trail = drop.mul(0.055).add(0.047);
        const tail = lensPoint(u, toWorld(u, place(max(progress.sub(trail), 0))));
        const alive = age.greaterThanEqual(0).and(age.lessThan(duration.mul(1.02)));
        // The piece appears as light, then each mote is drawn out and heats as it falls.
        const appear = smoothstep(0, 0.06, age);
        const arrive = smoothstep(1.0, 0.9, progress);
        const heat = pow(progress, 1.4);
        // It stays the piece's colour all the way down; only the last stretch whitens.
        const glow = varying(
            mix(tint.xyz, vec3(1.0, 0.92, 0.78), pow(progress, 3).mul(0.4))
                .mul(heat.mul(3.4).add(1.7))
                .mul(down.w)
                .mul(appear)
                .mul(arrive)
                .mul(head.visible)
                .mul(rnd(6).mul(0.6).add(0.6)),
        );
        const width = rnd(7).mul(1.6).add(2.0).mul(drop.mul(-0.13).add(1));
        material.vertexNode = streakClip(u, project(head.position), project(tail.position), width, alive);
        material.outputNode = vec4(glow.mul(streakShape()), 0);
        const mesh = new THREE.InstancedMesh(this.geometry, material, slots * motes);
        this.infall = this.add(mesh, 'Black Hole — infall', 40);
        this.infall.visible = false;
    }

    /** Ejecta of a clear streak: sparks thrown off the inner edge, winding out and cooling. */
    createSparks() {
        const u = this.uniforms;
        const slots = DIRECTOR_LIMITS.bursts;
        const perSlot = Math.max(8, Math.floor(this.preset.sparkCount / slots));
        this.burstData = {
            clock: Array.from({ length: slots }, () => new THREE.Vector4(-1, 1, 0, 0)), // age, duration, strength, seed
            shape: Array.from({ length: slots }, () => new THREE.Vector4()), // lift, family, fan, wind
            launch: Array.from({ length: slots }, () => new THREE.Vector4()), // speed, spread, axis, release
            tint: Array.from({ length: slots }, () => new THREE.Vector4()), // RGB and colour share
        };
        const clockArray = uniformArray(this.burstData.clock, 'vec4');
        const shapeArray = uniformArray(this.burstData.shape, 'vec4');
        const launchArray = uniformArray(this.burstData.launch, 'vec4');
        const tintArray = uniformArray(this.burstData.tint, 'vec4');
        const material = additive('Black Hole — ejecta');
        const index = float(instanceIndex);
        const slot = floor(index.div(perSlot));
        const spark = index.sub(slot.mul(perSlot));
        const clock = clockArray.element(slot.toInt());
        const shape = shapeArray.element(slot.toInt());
        const launch = launchArray.element(slot.toInt());
        const tint = tintArray.element(slot.toInt());
        const rnd = (k) => fract(hash(spark.mul(8).add(k)).add(clock.w.mul(0.61803)));
        const strength = clock.z;
        const lifetime = clock.y.mul(rnd(5).mul(0.45).add(0.55));
        const speed = rnd(2).mul(rnd(2)).mul(launch.y).add(launch.x)
            .mul(strength.mul(0.58).add(0.64));
        const fan = floor(rnd(0).mul(2));
        const bearing = clock.w.mul(0.145).add(fan.mul(Math.PI))
            .add(fract(rnd(0).mul(2)).sub(0.5).mul(shape.z));
        const tilt = rnd(4).sub(0.5).mul(shape.x).add(fan.mul(2).sub(1).mul(launch.z));
        const place = (t) => {
            const out = speed.mul(t).div(t.mul(0.55).add(1));
            const radius = out.add(HOLE.DISK_INNER + 0.1);
            // Angular momentum is kept: the sweep slows as the spark climbs.
            const azimuth = bearing.add(log(t.mul(1.6).add(1)).mul(rnd(3).mul(0.22).add(0.9)).mul(shape.w));
            return vec3(cos(azimuth).mul(radius), tilt.mul(out), sin(azimuth).mul(radius));
        };
        const t = clock.x.sub(rnd(1).mul(launch.w));
        const head = lensPoint(u, toWorld(u, place(max(t, 0))));
        const tail = lensPoint(u, toWorld(u, place(max(t.sub(rnd(7).mul(0.02).add(0.018)), 0))));
        const life = clamp(t.div(lifetime), 0, 1);
        // A weak burst throws only some of its sparks.
        const alive = t.greaterThan(0).and(t.lessThan(lifetime)).and(clock.x.greaterThanEqual(0))
            .and(rnd(8).lessThan(strength.mul(0.85).add(0.12)));
        // White-gold off the disk, cooling through flame to ember as it climbs.
        const glow = varying(
            mix(blackbody(pow(life.oneMinus(), 2.2).mul(0.85).add(0.24)), tint.xyz, tint.w)
                .mul(pow(life.oneMinus(), 1.6).mul(2.1).add(0.08))
                .mul(Math.min(1.55, Math.max(0.54, Math.sqrt(470 / perSlot))))
                .mul(strength.mul(0.5).add(0.6))
                .mul(smoothstep(0, 0.05, life))
                .mul(head.visible)
                .mul(rnd(6).mul(rnd(6)).mul(1.1).add(0.3)),
        );
        const width = rnd(7).mul(1.1).add(1.5);
        material.vertexNode = streakClip(u, project(head.position), project(tail.position), width, alive);
        material.outputNode = vec4(glow.mul(streakShape()), 0);
        const mesh = new THREE.InstancedMesh(this.geometry, material, slots * perSlot);
        this.sparks = this.add(mesh, 'Black Hole — ejecta', 45);
        this.sparks.visible = false;
    }

    /** The polar jets: two ribbons along the disk normal that always face the camera. */
    createJets() {
        const u = this.uniforms;
        const material = additive('Black Hole — jets');
        // The ribbon turns to face the camera, so either face may be the one presented.
        material.side = THREE.DoubleSide;
        const sign = float(instanceIndex).mul(2).sub(1);
        const axis = u.diskToWorld.mul(vec3(0, 1, 0)).mul(sign);
        const flare = u.jetFlare;
        const reach = u.jets.mul(14).add(10).add(flare.mul(9));
        const t = positionGeometry.x.add(0.5);
        const base = u.holePosition.add(axis.mul(u.rs.mul(1.6)));
        const spine = base.add(axis.mul(u.rs.mul(reach).mul(t)));
        const side = normalize(cross(axis, cameraPosition.sub(spine)));
        // A narrow throat that opens into a slowly widening column.
        const girth = u.rs.mul(pow(t, 0.75).mul(flare.mul(1.4).add(3.6)).add(1.1));
        const point = spine.add(side.mul(positionGeometry.y.mul(2)).mul(girth));
        const world = varying(point);
        // The jet that points our way is beamed brighter.
        const toward = varying(dot(axis, normalize(cameraPosition.sub(u.holePosition))).mul(0.55).add(1));
        material.vertexNode = Fn(() => project(point))();

        const along = uv().x;
        const across = uv().y.sub(0.5).mul(2);
        // A collimated flow broadens and pinches where its pressure meets the
        // surrounding gas. The shock cells stand in the jet as the knots travel
        // through them; the changing width gives scale all the way up the axis.
        const cells = along.mul(31).sub(along.mul(along).mul(6)).add(sign.mul(0.42));
        const pinch = cos(cells);
        const sweep = sin(along.mul(9).sub(u.time.mul(0.29)).add(sign)).mul(along).mul(0.18);
        const centred = across.sub(sweep);
        const spread = abs(centred);
        const flow = along.mul(5.4).sub(u.time.mul(0.67)).add(sign.mul(0.36));
        const knots = smoothstep(0.5, 0.86, texture(this.gasTexture, vec2(0.37, flow.mul(0.19))).r);
        const grain = texture(this.gasTexture, vec2(spread.mul(0.3).add(0.12), flow.mul(0.55))).g;
        const spine2 = exp(spread.mul(spread).mul(-260));
        const core = exp(spread.mul(spread).mul(-16));
        const shellRadius = pinch.mul(0.091).add(0.175).mul(along.mul(0.65).add(0.82));
        const shockWall = spread.sub(shellRadius);
        const sheath = exp(shockWall.mul(shockWall).mul(-135)).mul(grain.mul(0.84).add(0.20));
        const wind = sin(flow.mul(flare.mul(1.6).add(2.6))).mul(shellRadius.mul(1.3));
        const strandA = centred.sub(wind);
        const strandB = centred.add(wind);
        const strands = exp(strandA.mul(strandA).mul(-185)).add(exp(strandB.mul(strandB).mul(-185)).mul(0.56));
        const compression = smoothstep(-0.99, -0.45, pinch).oneMinus();
        const body = spine2.mul(knots.mul(1.5).add(compression.mul(1.2)).add(0.64)).mul(flare.mul(-0.40).add(1))
            .add(core.mul(knots.mul(0.5).add(0.10)).mul(grain.mul(0.9).add(0.4)))
            .add(strands.mul(grain.add(0.20)).mul(flare.mul(0.68).add(0.72)))
            .add(sheath.mul(flare.mul(0.36).add(0.48)));
        const envelope = smoothstep(0.0, 0.1, along).mul(pow(along.oneMinus(), 1.5));
        // Hide the stretch of the far jet that lies behind the shadow.
        const toHole = u.holePosition.sub(cameraPosition);
        const lensDistance = max(length(toHole), 1);
        const lensAxis = toHole.div(lensDistance);
        const relative = world.sub(cameraPosition);
        const depth = dot(relative, lensAxis);
        const impact = length(relative.sub(lensAxis.mul(depth))).div(max(depth, 1)).mul(lensDistance);
        const shadow = u.rs.mul(HOLE.CRITICAL);
        // The column only lights once it is clear of the shadow, on either side of the hole.
        const clear = smoothstep(shadow.mul(0.92), shadow.mul(1.7), impact);
        // Opened up by a fever, the column burns a deeper violet-blue at a little less light, so
        // it blazes in colour rather than flaring white.
        const tint = mix(
            mix(vec3(0.47, 0.22, 1), vec3(0.14, 0.60, 1), core.mul(flare.mul(-0.32).add(1))),
            vec3(0.88, 0.95, 1.0),
            spine2.mul(compression.mul(0.5).add(0.5)).mul(flare.mul(-0.38).add(1)),
        );
        material.outputNode = vec4(tint.mul(body).mul(envelope).mul(u.jets).mul(toward)
            .mul(clear)
            .mul(flare.mul(-0.7).add(2.6)), 0);
        this.jets = this.add(new THREE.InstancedMesh(this.geometry, material, 2), 'Black Hole — jets', 30);
        this.jets.visible = false;
    }

    /** Launch or advance a fed piece. `origin`, `right` and `down` are world-space vectors. */
    setInfall(slot, infall, origin, right, down) {
        if (slot >= this.infallSlots) return;
        const data = this.infallData;
        if (!infall.active) {
            data.origin[slot].w = -1;
            return;
        }
        if (origin) {
            data.origin[slot].set(origin.x, origin.y, origin.z, infall.age);
            data.right[slot].set(right.x, right.y, right.z, infall.duration);
            data.down[slot].set(down.x, down.y, down.z, infall.strength);
            data.tint[slot].set(infall.color[0], infall.color[1], infall.color[2], infall.seed);
            data.land[slot].set(infall.landRadius, infall.landAzimuth, infall.swirl, 0);
            data.cellsA[slot].set(infall.cells[0], infall.cells[1], infall.cells[2], infall.cells[3]);
            data.cellsB[slot].set(infall.cells[4], infall.cells[5], infall.cells[6], infall.cells[7]);
        } else data.origin[slot].w = infall.age;
    }

    /**
     * @param {object} frame
     * @param {number} frame.time seconds
     * @param {number} frame.turns turns of the inner edge since reset
     * @param {object} frame.director the event director
     * @param {number} [frame.heat] the gas's temperature as the lens burns it (the director's,
     *   scaled by the mood); the director's own when not given
     */
    update({
        time, turns, director, heat,
    }) {
        if (this.disposed) return;
        const u = this.uniforms;
        u.time.value = time;
        u.turns.value = turns % TURN_WRAP;
        u.surge.value = director.dust ?? director.surge;
        u.heat.value = Number.isFinite(heat) ? heat : director.diskHeat;
        u.jets.value = director.jets;
        u.jetFlare.value = director.jetFlare ?? 0;
        if (this.fragmentBoards) {
            for (let i = 0; i < this.fragmentBoards.length; i += 1) {
                const board = director.boards[i];
                this.fragmentBoards[i].set(board.left, board.top, board.right, board.bottom);
            }
        }
        // Idle layers leave the render list altogether.
        this.jets.visible = director.jets > 0.004;
        let feeding = false;
        for (let slot = 0; slot < this.infallSlots; slot += 1) {
            if (director.infalls[slot].active) feeding = true;
        }
        this.infall.visible = feeding;
        let erupting = false;
        for (let slot = 0; slot < director.bursts.length; slot += 1) {
            const burst = director.bursts[slot];
            this.burstData.clock[slot].set(burst.active ? burst.age : -1, burst.duration, burst.strength, burst.seed);
            if (burst.active) {
                const family = EJECTA[burst.family] ? burst.family : 0;
                const style = EJECTA[family];
                const lift = family === 4 ? 0.10 : burst.lift * 1.05 + 0.15;
                this.burstData.shape[slot].set(lift, family, style.fan, style.wind);
                this.burstData.launch[slot].set(style.speed, style.spread, style.axis, style.release);
                this.burstData.tint[slot].fromArray(style.tint);
                erupting = true;
            }
        }
        this.sparks.visible = erupting;
    }

    setViewport(width, height) {
        if (!(width > 0) || !(height > 0)) return;
        this.uniforms.aspect.value = width / height;
        this.uniforms.viewHeight.value = height;
    }

    /** Draw every layer once so its pipeline exists before the first event needs it. */
    revealAll() {
        const previous = [this.infall.visible, this.sparks.visible, this.jets.visible];
        this.infall.visible = true;
        this.sparks.visible = true;
        this.jets.visible = true;
        return () => {
            [this.infall.visible, this.sparks.visible, this.jets.visible] = previous;
        };
    }

    getDiagnostics() {
        return {
            dust: this.dust.count,
            fragments: this.fragments?.count ?? 0,
            infallMotes: this.infall.count,
            sparks: this.sparks.count,
            jets: this.jets.visible,
            feeding: this.infall.visible,
            erupting: this.sparks.visible,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.group.removeFromParent();
        for (const mesh of [this.dust, this.infall, this.sparks, this.jets]) mesh.dispose();
        this.fragments?.geometry.dispose();
        this.fragments?.dispose();
        this.geometry.dispose();
        for (const material of this.materials) material.dispose();
        this.materials.length = 0;
        this.group.clear();
    }
}
