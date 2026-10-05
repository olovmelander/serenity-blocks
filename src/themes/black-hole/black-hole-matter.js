/**
 * Everything that moves around the hole: dust riding the disk, the pieces the player feeds
 * it, the ejecta of a clear streak and the polar jets.
 *
 * None of it is simulated. Every mote's position is a closed-form function of a clock and a
 * few per-event uniforms, evaluated in the vertex shader, so a frame can be replayed
 * exactly, nothing is uploaded per frame and both backends run the same code. Each mote is
 * drawn as a streak from where it was a moment ago, bent by the same point-mass lens as the
 * sky so matter passing behind the hole rises around the shadow instead of crossing it.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, atan, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, dot, exp, float,
    floor, fract, hash, instanceIndex, length, log, max, mix, mod, normalize, positionGeometry, pow, select, sin,
    smoothstep, sqrt, texture, uniform, uniformArray, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { DIRECTOR_LIMITS } from './black-hole-director.js';
import { HOLE } from './black-hole-lens.js';

const TAU = Math.PI * 2;
/** The dust's clock wraps here; every per-mote rate is a multiple of 1/TURN_WRAP so the wrap is exact. */
export const TURN_WRAP = 256;
const CULLED = vec4(0, 0, 2, 1);

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
    };
}

/**
 * Thin-lens image of a world point: matter behind the hole appears pushed out around it.
 * Returns the apparent point and 0…1 visibility (0 where the image falls in the shadow).
 */
const lensPoint = (u, point) => {
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
const streakClip = (u, head, tail, width, alive = null) => {
    const aspect = vec2(u.aspect, 1);
    const heading = head.xy.div(head.w).sub(tail.xy.div(tail.w)).mul(aspect);
    const along = heading.div(max(length(heading), 1e-5));
    const across = vec2(along.y.negate(), along.x);
    const centre = mix(tail, head, positionGeometry.x.add(0.5));
    const half = width.div(u.viewHeight);
    // The quad overhangs both ends by half its width, so a mote at rest is a round dot.
    const offset = across.mul(positionGeometry.y.mul(2)).add(along.mul(positionGeometry.x.mul(2)))
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
        const id = float(instanceIndex).mul(8);
        const rnd = (k) => hash(id.add(k));
        const outer = mix(float(3.6), float(13.5), pow(rnd(0), 0.75));
        // Whole numbers of lifetimes per clock wrap, so the wrap is seamless.
        const lifetimes = floor(mix(float(36), float(84), rnd(1)));
        const lifeRate = lifetimes.div(TURN_WRAP);
        const flare = rnd(3).sub(0.5);
        const place = (turns) => {
            const life = fract(turns.mul(lifeRate).add(rnd(2)));
            const radius = mix(outer, float(2.75), pow(life, 1.9)).mul(u.surge.mul(-0.1).add(1));
            const slow = pow(float(HOLE.DISK_INNER).div(outer), 1.5);
            // Swept angle: the orbit quickens as the mote sinks.
            const swept = slow.mul(life).add(float(1.16).sub(slow).mul(pow(life, 5)).div(5));
            const azimuth = rnd(4).mul(TAU).add(swept.mul(TAU).mul(float(TURN_WRAP).div(lifetimes)));
            const height = flare.mul(radius).mul(0.07).mul(life.oneMinus().add(0.15));
            return { life, radius, point: vec3(cos(azimuth).mul(radius), height, sin(azimuth).mul(radius)) };
        };
        const now = place(u.turns);
        const before = place(u.turns.sub(0.02));
        // Across a respawn the tail would stretch over the whole disk; draw a dot instead.
        const continuous = now.life.greaterThan(before.life);
        const head = lensPoint(u, toWorld(u, now.point));
        const tail = lensPoint(u, toWorld(u, select(continuous, before.point, now.point)));
        const fade = smoothstep(0.0, 0.07, now.life).mul(smoothstep(1.0, 0.8, now.life));
        const warmth = pow(float(HOLE.DISK_INNER).div(now.radius), 0.9).mul(u.heat);
        const glow = varying(
            blackbody(warmth.mul(0.95).add(0.18))
                .mul(warmth.mul(1.3).add(0.1))
                .mul(rnd(5).mul(rnd(5)).mul(1.1).add(0.1))
                .mul(fade)
                .mul(head.visible)
                .mul(u.surge.mul(1.2).add(1)),
        );
        material.vertexNode = streakClip(u, project(head.position), project(tail.position), rnd(6).mul(1.2).add(1.3));
        material.outputNode = vec4(glow.mul(streakShape()), 0);
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
        const lag = rnd(0).mul(0.44);
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
        const progress = clamp(age.div(duration).sub(lag).div(0.56), 0, 1);
        const head = lensPoint(u, toWorld(u, place(progress)));
        const tail = lensPoint(u, toWorld(u, place(max(progress.sub(0.075), 0))));
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
        const width = rnd(7).mul(2.0).add(2.6);
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
            shape: Array.from({ length: slots }, () => new THREE.Vector4(0, 0, 0, 0)), // lift
        };
        const clockArray = uniformArray(this.burstData.clock, 'vec4');
        const shapeArray = uniformArray(this.burstData.shape, 'vec4');
        const material = additive('Black Hole — ejecta');
        const index = float(instanceIndex);
        const slot = floor(index.div(perSlot));
        const spark = index.sub(slot.mul(perSlot));
        const clock = clockArray.element(slot.toInt());
        const shape = shapeArray.element(slot.toInt());
        const rnd = (k) => fract(hash(spark.mul(8).add(k)).add(clock.w.mul(0.61803)));
        const strength = clock.z;
        const lifetime = clock.y.mul(rnd(5).mul(0.45).add(0.55));
        const speed = rnd(2).mul(rnd(2)).mul(5.8).add(2.1)
            .mul(strength.mul(0.9).add(0.55));
        const tilt = rnd(4).sub(0.5).mul(shape.x.mul(1.7).add(0.22));
        const place = (t) => {
            const out = speed.mul(t).div(t.mul(0.55).add(1));
            const radius = out.add(HOLE.DISK_INNER + 0.1);
            // Angular momentum is kept: the sweep slows as the spark climbs.
            const azimuth = rnd(0).mul(TAU).add(log(t.mul(1.6).add(1)).mul(rnd(3).add(1.7)));
            return vec3(cos(azimuth).mul(radius), tilt.mul(out), sin(azimuth).mul(radius));
        };
        const t = clock.x.sub(rnd(1).mul(0.28));
        const head = lensPoint(u, toWorld(u, place(max(t, 0))));
        const tail = lensPoint(u, toWorld(u, place(max(t.sub(0.05), 0))));
        const life = clamp(t.div(lifetime), 0, 1);
        // A weak burst throws only some of its sparks.
        const alive = t.greaterThan(0).and(t.lessThan(lifetime)).and(clock.x.greaterThanEqual(0))
            .and(rnd(8).lessThan(strength.mul(0.85).add(0.12)));
        // White-gold off the disk, cooling through flame to ember as it climbs.
        const glow = varying(
            blackbody(pow(life.oneMinus(), 2.2).mul(0.85).add(0.24))
                .mul(pow(life.oneMinus(), 1.8).mul(2.6).add(0.04))
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
        const reach = u.jets.mul(14).add(10);
        const t = positionGeometry.x.add(0.5);
        const base = u.holePosition.add(axis.mul(u.rs.mul(1.6)));
        const spine = base.add(axis.mul(u.rs.mul(reach).mul(t)));
        const side = normalize(cross(axis, cameraPosition.sub(spine)));
        // A narrow throat that opens into a slowly widening column.
        const girth = u.rs.mul(pow(t, 0.75).mul(3.6).add(1.1));
        const point = spine.add(side.mul(positionGeometry.y.mul(2)).mul(girth));
        const world = varying(point);
        // The jet that points our way is beamed brighter.
        const toward = varying(dot(axis, normalize(cameraPosition.sub(u.holePosition))).mul(0.55).add(1));
        material.vertexNode = Fn(() => project(point))();

        const along = uv().x;
        const across = uv().y.sub(0.5).mul(2);
        const spread = abs(across);
        const flow = along.mul(3.4).sub(u.time.mul(1.5));
        // Knots of plasma ride out along the spine; the gas tile gives them their spacing.
        const knots = smoothstep(0.5, 0.86, texture(this.gasTexture, vec2(0.37, flow.mul(0.19))).r);
        const grain = texture(this.gasTexture, vec2(spread.mul(0.3).add(0.12), flow.mul(0.55))).g;
        const spine2 = exp(spread.mul(spread).mul(-120));
        const core = exp(spread.mul(spread).mul(-16));
        const sheath = exp(spread.mul(spread).mul(-3.4));
        // Two field lines wound round the column, crossing as they climb.
        const wind = sin(flow.mul(2.4)).mul(0.36);
        const strandA = across.sub(wind);
        const strandB = across.add(wind);
        const strands = exp(strandA.mul(strandA).mul(-85)).add(exp(strandB.mul(strandB).mul(-85)));
        const body = spine2.mul(knots.mul(3.2).add(1.4))
            .add(core.mul(knots.mul(0.6).add(0.3)).mul(grain.mul(0.9).add(0.55)))
            .add(strands.mul(grain.add(0.35)).mul(0.8))
            .add(sheath.mul(grain.mul(0.8).add(0.4)).mul(0.13));
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
        const tint = mix(mix(vec3(0.36, 0.3, 0.95), vec3(0.34, 0.6, 1.0), core), vec3(0.86, 0.93, 1.0), spine2);
        material.outputNode = vec4(tint.mul(body).mul(envelope).mul(u.jets).mul(toward)
            .mul(clear)
            .mul(2.6), 0);
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
     */
    update({ time, turns, director }) {
        if (this.disposed) return;
        const u = this.uniforms;
        u.time.value = time;
        u.turns.value = turns % TURN_WRAP;
        u.surge.value = director.surge;
        u.heat.value = director.diskHeat;
        u.jets.value = director.jets;
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
            this.burstData.shape[slot].x = burst.lift;
            if (burst.active) erupting = true;
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
        this.geometry.dispose();
        for (const material of this.materials) material.dispose();
        this.materials.length = 0;
        this.group.clear();
    }
}
