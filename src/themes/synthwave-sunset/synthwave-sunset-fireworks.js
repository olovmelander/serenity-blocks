/**
 * Synthwave Sunset — fireworks over the sea, fired from a barge off the pier's end.
 *
 * One instanced additive draw holds every particle: the rising shells with their sparking tails,
 * and the stars of each burst (peony, chrysanthemum, ring, a gold willow for the finale). Motion
 * is analytic in the vertex stage (spawn state + age: exponential drag, gravity), so a burst costs
 * one ranged upload at spawn and nothing per frame. Each particle is a camera-facing streak along
 * its own on-screen motion, sized in metres with a pixel floor, writing premultiplied light with
 * alpha 0 (it adds to the frame and leaves the reflection pass's alpha alone, so the sea and the
 * wet sand mirror the fireworks).
 *
 * The world also lights the sky round the bursts (`u.burst0/1`, read by the sky function); under
 * Reduce flashing that glow keeps REDUCED_FLASH_SCALE of its strength and the stars fade in
 * instead of popping. The two glows ACCUMULATE: a burst joins the weaker of them (its light added
 * to what is still lit, the glow's centre and colour easing toward the new burst), so a volley
 * builds a smoke-lit sky that the sea mirrors instead of blinking from burst to burst.
 *
 * The particle pool is a ring, but a full ring never cuts a star in mid-air: a new particle takes
 * the slot with the least light left among the next few (a dead one if there is one).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    clamp,
    exp,
    float,
    length,
    max,
    mix,
    modelViewMatrix,
    positionGeometry,
    screenSize,
    select,
    sin,
    smoothstep,
    step,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { RIG } from './synthwave-sunset-tsl.js';
import { Swell } from '../shared/swell.js';

/** The barge the shells rise from (world), and the burst heights (m above the sea). */
export const FIREWORKS = Object.freeze({
    barge: new THREE.Vector3(-14, 1, -182),
    burstMin: 50,
    burstMax: 78,
    /** Spread of the bursts round the barge (m, along x and z). */
    spreadX: 78,
    spreadZ: 34,
});

export const FIREWORK_COLORS = Object.freeze([0x7ff0d4, 0xff5fa8, 0xffe46a, 0xc8a2ff, 0x6fd8ff, 0xffb04c]);

/** The finale's willow: long-lived gold falling stars. */
export const WILLOW_GOLD = new THREE.Color(0xffb04c);

/** Slots a new particle may take, looking ahead of the ring's cursor (the one with least light left). */
const POOL_PROBE = 48;
/** How fast a sky glow's centre and colour follow the bursts that feed it (1/s). */
const GLOW_FOLLOW = 7;
/** Extra burst height (m) at `high` 1: deeper cascade waves and the crown burst higher. */
const HIGH_LIFT = 10;

function instanced(count, itemSize) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
}

/**
 * The particle material. Attributes per particle:
 *   iSpawn  (x, y, z, t0)          world spawn point and time
 *   iVel    (vx, vy, vz, life)     initial velocity, life (s)
 *   iLook   (r, g, b, size m)      colour (linear, HDR) and size
 *   iMotion (drag, gravity, kind, seed)  kind: 0 star, 1 glitter star, 2 shell head, 3 tail spark
 */
function createParticleMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveFireworks';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;

    const spawn = attribute('iSpawn', 'vec4');
    const vel = attribute('iVel', 'vec4');
    const look = attribute('iLook', 'vec4');
    const motion = attribute('iMotion', 'vec4');
    const age = u.time.sub(spawn.w);
    const life = max(vel.w, 1e-3);
    const alive = step(0.0, age).mul(step(age, life));
    const lifeT = clamp(age.div(life), 0.0, 1.0);
    const drag = max(motion.x, 1e-3);
    const decay = exp(age.mul(drag).negate());
    const travel = float(1.0).sub(decay).div(drag);
    const g = motion.y;
    const pos = spawn.xyz.add(vel.xyz.mul(travel)).add(vec3(0.0, g.mul(age).mul(age).mul(-0.5), 0.0));
    const velNow = vel.xyz.mul(decay).sub(vec3(0.0, g.mul(age), 0.0));

    // A streak along the on-screen motion: the quad's x runs along the view-space velocity.
    const mv = modelViewMatrix.mul(vec4(pos, 1.0)).toVar();
    const vView = modelViewMatrix.mul(vec4(velNow, 0.0)).xy;
    const depth = max(mv.z.negate(), 0.1);
    const pxWorld = depth.mul(2.0).div(cameraProjectionMatrix.element(1).element(1).mul(screenSize.y));
    const width = max(look.w, pxWorld.mul(1.5));
    const speed = length(vView);
    // A float select blended in (r186 can collapse a vector through select()).
    const moving = select(speed.greaterThan(1e-3), float(1.0), float(0.0));
    const dir = mix(vec2(0.0, 1.0), vView.div(max(speed, 1e-3)), moving);
    // The star's trail: about a sixth of a second of its own motion (a long exposure).
    const streakLen = width.add(speed.mul(0.17).mul(step(motion.z, 2.5)));
    const corner = positionGeometry.xy;
    const offset = dir.mul(corner.x.mul(streakLen)).add(vec2(dir.y.negate(), dir.x).mul(corner.y.mul(width)));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xy.add(offset.mul(alive)), mv.z, 1.0));
    // The pixel floor's extra area and the streak's length spread the same light thinner.
    const grow = look.w.div(width);
    const dim = grow.mul(grow).mul(width.div(streakLen).pow(0.5));

    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        // Hot head at the leading end, fading tail behind it.
        const along = q.x;
        const across = q.y;
        const shape = exp(across.mul(across).mul(-3.5)).mul(exp(along.sub(0.55).mul(along.sub(0.55)).mul(-2.2)))
            .mul(smoothstep(-1.0, 0.3, along));
        const kind = motion.z;
        const seed = motion.w;
        // Stars: a brief white-hot start, their colour, a last flicker; glitter twinkles out.
        const hot = exp(age.mul(-9.0)).mul(0.8);
        const fade = float(1.0).sub(smoothstep(0.55, 1.0, lifeT));
        const flick = sin(u.time.mul(38.0).add(seed.mul(91.0))).mul(0.5).add(0.5);
        const glitter = mix(float(1.0), step(0.55, flick).mul(1.6), step(0.5, kind).mul(step(kind, 1.5)).mul(smoothstep(0.45, 0.7, lifeT)));
        const calm = u.fireworkCalm;
        const popIn = mix(float(1.0), smoothstep(0.0, 0.35, age), calm);
        const twinkle = mix(glitter, float(1.0), calm);
        const col = look.xyz.mul(float(1.0).add(hot.mul(float(1.0).sub(calm)))).add(vec3(hot.mul(0.6).mul(float(1.0).sub(calm))));
        return col.mul(shape).mul(fade).mul(twinkle).mul(popIn)
            .mul(alive)
            .mul(dim)
            .mul(u.fireworkLevel);
    })();
    material.outputNode = vec4(material.colorNode, 0.0);
    return material;
}

export class Fireworks {
    /**
     * @param {object} u  world uniforms (time, fireworkLevel, fireworkCalm, burst0, burst1)
     * @param {object} opts
     * @param {number} opts.capacity  particle pool
     * @param {() => number} opts.rand
     * @param {number} [opts.mirrorLayer]
     */
    constructor(u, { capacity, rand, mirrorLayer }) {
        this.u = u;
        this.rand = rand;
        this.capacity = Math.max(64, capacity | 0);
        const geometry = new THREE.PlaneGeometry(1, 1);
        this.iSpawn = instanced(this.capacity, 4);
        this.iVel = instanced(this.capacity, 4);
        this.iLook = instanced(this.capacity, 4);
        this.iMotion = instanced(this.capacity, 4);
        for (let i = 0; i < this.capacity; i += 1) this.iSpawn.array[i * 4 + 3] = -1e6;
        geometry.setAttribute('iSpawn', this.iSpawn);
        geometry.setAttribute('iVel', this.iVel);
        geometry.setAttribute('iLook', this.iLook);
        geometry.setAttribute('iMotion', this.iMotion);
        this.mesh = new THREE.InstancedMesh(geometry, createParticleMaterial(u), this.capacity);
        this.mesh.name = 'SynthwaveFireworks';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 30;
        if (Number.isInteger(mirrorLayer)) this.mesh.layers.enable(mirrorLayer);
        this.cursor = 0;
        /** The world time spawns are judged against (which slot has the least light left). */
        this.now = 0;
        /** Bursts waiting for their shell to arrive: { at, pos, color, kind, scale }. */
        this.pending = [];
        /**
         * The sky's two glows: each an accumulating swell (a burst adds to what is still lit, it
         * never restarts it) whose centre and colour ease toward the bursts that feed it.
         */
        const glow = () => ({
            swell: new Swell({
                attack: 0.04, release: 1 / 1.8, ceiling: 1.5, knee: 1.0, headroom: 1.4,
            }),
            pos: new THREE.Vector3(),
            aim: new THREE.Vector3(),
            color: new THREE.Color(),
            tint: new THREE.Color(),
        });
        this.glows = [glow(), glow()];
        this.glowClock = Number.NaN;
        this._c = new THREE.Color();
        this._hsl = { h: 0, s: 0, l: 0 };
    }

    /**
     * A slot for a new particle: the ring's next one if its particle is spent, otherwise the one
     * with the least life left among the next POOL_PROBE (a full pool takes the most-faded star,
     * never one still burning, and never a spark not yet born).
     */
    allocate() {
        const cap = this.capacity;
        const S = this.iSpawn.array;
        const V = this.iVel.array;
        let best = this.cursor;
        let bestLeft = Infinity;
        for (let k = 0; k < POOL_PROBE; k += 1) {
            const i = (this.cursor + k) % cap;
            const left = S[i * 4 + 3] + V[i * 4 + 3] - this.now;
            if (left <= 0) {
                best = i;
                break;
            }
            if (left < bestLeft) {
                best = i;
                bestLeft = left;
            }
        }
        this.cursor = (best + 1) % cap;
        return best;
    }

    spawn(t0, p, v, life, color, size, drag, gravity, kind) {
        const i = this.allocate();
        const o = i * 4;
        const S = this.iSpawn.array;
        const V = this.iVel.array;
        const L = this.iLook.array;
        const M = this.iMotion.array;
        S[o] = p.x; S[o + 1] = p.y; S[o + 2] = p.z; S[o + 3] = t0;
        V[o] = v.x; V[o + 1] = v.y; V[o + 2] = v.z; V[o + 3] = life;
        L[o] = color.r; L[o + 1] = color.g; L[o + 2] = color.b; L[o + 3] = size;
        M[o] = drag; M[o + 1] = gravity; M[o + 2] = kind; M[o + 3] = this.rand();
        for (const attr of [this.iSpawn, this.iVel, this.iLook, this.iMotion]) {
            // Neighbouring slots share one upload range (one buffer write per run, not per star).
            const ranges = attr.updateRanges;
            const last = ranges[ranges.length - 1];
            if (last && last.start + last.count === o) last.count += 4;
            else attr.addUpdateRange(o, 4);
            attr.needsUpdate = true;
        }
    }

    /**
     * Launch one shell now; it bursts on arrival.
     * @param {number} t      world time
     * @param {object} o      { color (THREE.Color, linear), kind ('peony'|'chrys'|'ring'|'willow'),
     *                         scale (0.5..1.5), delay (s), stars (count), x (-0.5..0.5: where
     *                         across the spread it bursts; random without), high (0..1: higher),
     *                         rise (s: the shell's flight; random without) }
     */
    launch(t, o = {}) {
        const r = this.rand;
        this.now = t;
        const t0 = t + (o.delay ?? 0);
        const base = FIREWORKS.barge.clone().add(new THREE.Vector3((r() - 0.5) * 18, 0, (r() - 0.5) * 12));
        const across = Number.isFinite(o.x) ? THREE.MathUtils.clamp(o.x, -0.5, 0.5) + (r() - 0.5) * 0.06 : r() - 0.5;
        const burst = new THREE.Vector3(
            FIREWORKS.barge.x + across * FIREWORKS.spreadX,
            FIREWORKS.burstMin + r() * (FIREWORKS.burstMax - FIREWORKS.burstMin) * (o.kind === 'willow' ? 1.1 : 1)
                + THREE.MathUtils.clamp(o.high ?? 0, 0, 1) * HIGH_LIFT,
            FIREWORKS.barge.z + (r() - 0.5) * FIREWORKS.spreadZ,
        );
        // The shell's flight time: a salute's shells share one, so they burst together.
        const rise = Number.isFinite(o.rise) ? THREE.MathUtils.clamp(o.rise, 0.8, 1.8) : 1.05 + r() * 0.35;
        // The shell: solve the launch velocity so drag-free flight reaches the burst point at `rise`.
        const g = 9.81;
        const v = burst.clone().sub(base).divideScalar(rise);
        v.y += 0.5 * g * rise;
        const shellCol = this._c.setRGB(1.0, 0.72, 0.42).multiplyScalar(2.2);
        this.spawn(t0, base, v, rise, shellCol, 0.55, 1e-3, g, 2);
        // A tail of sparks shed along the way.
        const tail = 14;
        for (let k = 0; k < tail; k += 1) {
            const f = (k + 0.5) / tail;
            const tk = f * rise;
            const at = base.clone().addScaledVector(v, tk).add(new THREE.Vector3(0, -0.5 * g * tk * tk, 0));
            this.spawn(
                t0 + tk,
                at,
                new THREE.Vector3((r() - 0.5) * 3, -2 - r() * 3, (r() - 0.5) * 3),
                0.5 + r() * 0.4,
                this._c.setRGB(1.0, 0.6, 0.3).multiplyScalar(1.4),
                0.32,
                2.0,
                4,
                3,
            );
        }
        this.pending.push({
            at: t0 + rise,
            pos: burst,
            color: (o.color ?? new THREE.Color(FIREWORK_COLORS[0])).clone(),
            kind: o.kind ?? 'peony',
            scale: o.scale ?? 1,
            stars: o.stars ?? 150,
        });
    }

    /** Spawn the stars of every burst whose shell has arrived. */
    update(t) {
        this.now = t;
        for (let i = this.pending.length - 1; i >= 0; i -= 1) {
            const b = this.pending[i];
            if (t < b.at) continue;
            this.pending.splice(i, 1);
            this.burst(b);
        }
    }

    burst(b) {
        const r = this.rand;
        const { pos, color, kind } = b;
        const speed = (kind === 'willow' ? 27 : 40) * b.scale;
        const n = b.stars;
        const alt = new THREE.Color(FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)]);
        const ringAxis = new THREE.Vector3(r() - 0.5, 1, r() - 0.5).normalize();
        const tmp = new THREE.Vector3();
        for (let k = 0; k < n; k += 1) {
            // Even directions on a sphere (golden spiral), or a ring square to a tilted axis.
            let d;
            if (kind === 'ring') {
                const a = (k / n) * Math.PI * 2;
                const t1 = new THREE.Vector3().crossVectors(ringAxis, new THREE.Vector3(1, 0, 0)).normalize();
                const t2 = new THREE.Vector3().crossVectors(ringAxis, t1);
                d = t1.multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a));
            } else {
                const y = 1 - (2 * (k + 0.5)) / n;
                const rad = Math.sqrt(1 - y * y);
                const phi = k * 2.399963;
                d = tmp.set(Math.cos(phi) * rad, y, Math.sin(phi) * rad).clone();
            }
            const vk = d.multiplyScalar(speed * (0.85 + r() * 0.3));
            const willow = kind === 'willow';
            let c = k % 7 === 0 ? alt : color;
            if (willow) c = WILLOW_GOLD;
            const level = willow ? 2.4 : 3.2;
            this.spawn(
                b.at,
                pos,
                vk,
                (willow ? 3.8 : 2.1) + r() * 0.7,
                c.clone().multiplyScalar(level),
                willow ? 0.6 : 0.72,
                willow ? 1.0 : 1.45,
                willow ? 6.0 : 3.0,
                willow || kind === 'chrys' ? 1 : 0,
            );
        }
        // Light the sky round the burst: it joins the weaker glow, adding to what is still lit.
        const [g0, g1] = this.glows;
        const glow = g0.swell.valueAt(b.at) <= g1.swell.valueAt(b.at) ? g0 : g1;
        const before = glow.swell.valueAt(b.at);
        glow.swell.hit(b.scale, b.at);
        if (before < 0.02) {
            // Nothing lit there: it starts where the burst is.
            glow.pos.copy(pos);
            glow.aim.copy(pos);
            glow.color.copy(b.color);
            glow.tint.copy(b.color);
        } else {
            // Lit: its centre and colour move toward the new burst by the burst's share of the light.
            const share = b.scale / (before + b.scale);
            glow.aim.lerp(pos, share);
            glow.tint.lerp(b.color, share);
            // Blended colours drift toward white: keep the smoke-lit sky a colour, not a haze.
            glow.tint.getHSL(this._hsl);
            if (this._hsl.s < 0.75) glow.tint.setHSL(this._hsl.h, 0.75, this._hsl.l);
        }
        if (kind === 'willow') glow.tint.lerp(WILLOW_GOLD, 0.5);
    }

    /** The sky glows' summed light at `t` (unscaled), for the post stack's bloom. */
    glowLight(t) {
        return this.glows[0].swell.valueAt(t) + this.glows[1].swell.valueAt(t);
    }

    /** Write the two sky glows into the world uniforms (direction from the rest eye, strength). */
    writeGlows(t, scale) {
        this._eye ??= new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        this._dir ??= new THREE.Vector3();
        const dt = t - this.glowClock;
        this.glowClock = t;
        const follow = dt > 0 && dt < 0.5 ? 1 - Math.exp(-GLOW_FOLLOW * dt) : 1;
        this.glows.forEach((g, i) => {
            g.pos.lerp(g.aim, follow);
            g.color.lerp(g.tint, follow);
            const dir = this._dir.copy(g.pos).sub(this._eye).normalize();
            const uni = i === 0 ? this.u.burst0 : this.u.burst1;
            const col = i === 0 ? this.u.burstCol0 : this.u.burstCol1;
            uni.value.set(dir.x, dir.y, dir.z, g.swell.valueAt(t) * scale);
            col.value.copy(g.color);
        });
    }

    clear() {
        this.pending.length = 0;
        for (let i = 0; i < this.capacity; i += 1) this.iSpawn.array[i * 4 + 3] = -1e6;
        this.iSpawn.clearUpdateRanges();
        this.iSpawn.needsUpdate = true;
        this.glows.forEach((g) => g.swell.reset());
        this.glowClock = Number.NaN;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
