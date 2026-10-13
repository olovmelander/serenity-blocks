/**
 * Pyrestorm — the event smoke: the puffs the events throw (a T-spin's vortex ring, the four-line
 * blast's surge down the flank). The column itself is a volume (`pyrestorm-plume.js`).
 *
 * One instanced quad per puff, all in one draw, placed on the CPU each frame and sorted far to
 * near (premultiplied "over" blending needs the order; a few hundred puffs cost nothing to sort,
 * and they are nearly sorted already from the last frame). Each puff samples a heap from the
 * billow atlas: its alpha, its own normal and thickness, so a puff is lit like a solid: the
 * crater's fire and the lava's glow from below, the lightning from inside (a soft volume glow),
 * the night sky a little from above; a hot puff burns with the incandescent ejecta in it.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    floor,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    texture,
    vec2,
    vec3,
    vec4,
    varying,
} from 'three/tsl';
import {
    CRATER, clamp01, smooth,
} from './pyrestorm-core.js';
import {
    BILLOW, aerial, lightningAt, noise3, pyBlackbody, wideGlowAt,
} from './pyrestorm-tsl.js';

/** Puff kinds (the shader's light recipe). */
export const PUFF = Object.freeze({ ring: 2, surge: 3 });

/** Write a puff's body normal (normalised; straight up when it has no length) and its weight. */
function setBody(st, o, x, y, z, weight) {
    const l = Math.hypot(x, y, z);
    st[o + 10] = l > 1e-6 ? x / l : 0;
    st[o + 11] = l > 1e-6 ? y / l : 1;
    st[o + 12] = l > 1e-6 ? z / l : 0;
    st[o + 13] = l > 1e-6 ? weight : 0;
}

export class Smoke {
    constructor(u, t, tier) {
        this.u = u;
        this.t = t;
        this.eventCount = tier.eventPuffs;
        const count = this.eventCount;
        this.count = count;
        // Event puffs: a ring buffer of (origin, velocity, born, life, radius growth, kind).
        this.events = new Float32Array(this.eventCount * 12);
        for (let i = 0; i < this.eventCount; i++) this.events[i * 12 + 3] = -1e6;
        this.eventCursor = 0;

        this.keys = new Float32Array(count);
        this.order = new Int32Array(count);
        for (let i = 0; i < count; i++) this.order[i] = i;
        this.stage = new Float32Array(count * 16);
        this.puff = new Float32Array(count * 4);
        this.look = new Float32Array(count * 4);
        this.tint = new Float32Array(count * 4);
        this.body = new Float32Array(count * 4);
        const quad = new THREE.PlaneGeometry(1, 1);
        quad.deleteAttribute('normal');
        quad.deleteAttribute('uv');
        this.attr = {
            puff: new THREE.InstancedBufferAttribute(this.puff, 4).setUsage(THREE.DynamicDrawUsage),
            look: new THREE.InstancedBufferAttribute(this.look, 4).setUsage(THREE.DynamicDrawUsage),
            tint: new THREE.InstancedBufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage),
            body: new THREE.InstancedBufferAttribute(this.body, 4).setUsage(THREE.DynamicDrawUsage),
        };
        quad.setAttribute('aPuff', this.attr.puff);
        quad.setAttribute('aLook', this.attr.look);
        quad.setAttribute('aTint', this.attr.tint);
        quad.setAttribute('aBody', this.attr.body);
        this.geometry = quad;
        this.material = this.createMaterial();
        this.mesh = new THREE.InstancedMesh(quad, this.material, count);
        this.mesh.name = 'PyrestormAsh';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 22;
        this.activity = 1;
    }

    createMaterial() {
        const { u, t } = this;
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'PyrestormAsh';
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.CustomBlending;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneMinusSrcAlphaFactor;
        material.blendSrcAlpha = THREE.OneFactor;
        material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        material.fog = false;
        const puff = attribute('aPuff', 'vec4');
        const look = attribute('aLook', 'vec4');
        const tint = attribute('aTint', 'vec4');
        // The body's normal at the puff (the column's outward side, the anvil's underside) and how
        // much of it the puff takes: heaps are lit as lobes of one mass, never as separate balls.
        const body = attribute('aBody', 'vec4');
        const corner = positionGeometry.xy;
        material.vertexNode = Fn(() => {
            const view = cameraViewMatrix.mul(vec4(puff.xyz, 1.0));
            const lifted = view.add(vec4(corner.mul(puff.w.mul(2.0)), 0.0, 0.0));
            return cameraProjectionMatrix.mul(lifted);
        })();
        const vCorner = varying(corner, 'vPyCorner');
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.outputNode = Fn(() => {
            const variant = floor(look.x.add(0.5));
            const rot = look.y;
            const cr = cos(rot);
            const sr = sin(rot);
            const c = vCorner;
            // The heap turned by the puff's own rotation.
            const rc = vec2(c.x.mul(cr).sub(c.y.mul(sr)), c.x.mul(sr).add(c.y.mul(cr)));
            const tile = vec2(variant.mod(BILLOW.grid), floor(variant.div(BILLOW.grid)));
            const inset = 0.5 / BILLOW.tile;
            const st = rc.add(0.5).clamp(inset, 1.0 - inset).add(tile).div(BILLOW.grid);
            const s = texture(t.billows, vec2(st.x, st.y)).toVar();
            // Erode the heap's outline with slowly turning 3D noise: lumps grow and part, so no puff
            // is ever a clean disc.
            const er = noise3(t.lattice, vec3(rc.mul(3.4).add(vec2(look.y.mul(3.7), variant.mul(1.9))), u.time.mul(0.035).add(variant.mul(0.53))));
            const er2 = noise3(t.lattice, vec3(rc.mul(9.0).add(vec2(variant.mul(2.3), look.y.mul(1.7))), u.time.mul(0.06).add(look.y)));
            const lumpy = smoothstep(0.02, 0.3, s.w.add(er.x.sub(0.5).mul(0.42)).add(er2.x.sub(0.5).mul(0.22)));
            const alpha = s.x.mul(smoothstep(0.0, 0.4, s.w)).mul(lumpy).mul(look.z).toVar();
            // The heap's normal in its own frame, turned back into the view's, then into the world.
            const nb = s.yz.mul(2.0).sub(1.0);
            const nr = vec2(nb.x.mul(cr).add(nb.y.mul(sr)), nb.y.mul(cr).sub(nb.x.mul(sr)));
            const nz = sqrt(max(float(1.0).sub(nr.dot(nr)), 0.0));
            const bend = vec2(er.x.sub(0.5), er.y.sub(0.5)).mul(0.9);
            const Nheap = normalize(u.camRight.mul(nr.x.add(bend.x)).add(u.camUp.mul(nr.y.add(bend.y))).sub(u.camFwd.mul(nz)));
            const N = normalize(mix(Nheap, body.xyz, body.w)).toVar();
            // A little variation from the lobes (never a darker rim round each heap).
            const crease = er.x.mul(0.18).add(0.85);
            const thick = s.w;
            const P = puff.xyz.add(u.camRight.mul(c.x.mul(puff.w.mul(2.0)))).add(u.camUp.mul(c.y.mul(puff.w.mul(2.0))))
                .sub(u.camFwd.mul(thick.mul(puff.w)))
                .toVar();
            // The fire below: the fountain lights the column's foot from inside and below, fading
            // with height (it reddens through the ash it crosses); the lava's wide glow under it.
            const above = P.y.sub(CRATER.y).max(0.0);
            const under = clamp(N.y.negate().mul(0.55).add(0.45), 0.0, 1.0);
            const toC = normalize(vec3(CRATER.x, CRATER.y + 120.0, CRATER.z).sub(P));
            const facing = clamp(N.dot(toC).mul(0.6).add(0.4), 0.0, 1.0);
            // The fire reaches the column's lower third, reddening as it goes; above it the ash is
            // charcoal. Faces turned to the vent take it, the rest less; thin edges near the vent
            // glow through (the fire is behind and below them), so no heap has a dark rim.
            const reach = exp(above.div(-800.0));
            const deep = mix(vec3(1.0, 0.45, 0.3), vec3(1.0, 1.0, 1.0), reach);
            const burn = u.fountain.mul(u.activity).mul(reach.mul(0.95).add(0.05));
            const fire = u.fireColour.mul(deep).mul(burn).mul(facing.mul(0.45).add(under.mul(0.35)).add(0.3)).mul(4.0);
            const glowThrough = u.fireColour.mul(deep).mul(burn).mul(float(1.0).sub(thick.mul(0.3))).mul(1.3);
            const lavaBelow = u.fireColour.mul(vec3(1.0, 0.7, 0.55)).mul(wideGlowAt(t, P.xz).mul(0.12).add(0.025))
                .mul(exp(above.div(-4200.0))).mul(under)
                .mul(u.activity);
            const bolts = lightningAt(u, P, N, 1).mul(0.55);
            // The night on the heap's thin, upward edges (a faint rim that parts one heap from the next).
            // The night lights the tops, cool; the undersides see none of it.
            const coolSky = mix(u.ambient, vec3(0.022, 0.026, 0.04), 0.5);
            const sky = coolSky.mul(clamp(N.y.mul(0.6).add(0.4), 0.0, 1.0)).mul(1.7);
            // The blast's shock front: the cloud flashes pale where the front passes (condensation).
            const dShock = P.sub(vec3(CRATER.x, CRATER.y, CRATER.z)).length().sub(u.shock.x);
            const shock = exp(dShock.div(260.0).mul(dShock.div(260.0)).negate()).mul(u.shock.y);
            const light = fire.add(glowThrough).add(lavaBelow).add(sky).add(bolts)
                .add(vec3(0.7, 0.68, 0.74).mul(shock))
                .mul(tint.y);
            // Ash: dark grey, darker in a heap's thick core.
            const albedo = u.ash.mul(float(1.0).sub(thick.mul(0.06)));
            const col = albedo.mul(light).mul(crease).toVar();
            // Incandescent ejecta in the column's foot (and in the surge's base).
            const hot = look.w;
            // (Seen through the ash: a dull glow from inside, strongest where the heap is thin.)
            const T = hot.mul(0.55).add(0.12);
            col.addAssign(pyBlackbody(T).mul(hot).mul(float(1.0).sub(thick.mul(0.2))).mul(0.3));
            const seen = aerial(u, t, P, col);
            return vec4(seen.mul(alpha), alpha);
        })();
        return material;
    }

    /** Throw a puff (event smoke). Positions in metres, velocity m/s, `grow` m/s of radius. */
    spawn({
        x, y, z, vx = 0, vy = 0, vz = 0, born, life = 8, radius = 300, grow = 40, kind = PUFF.ring, heat = 0, variant = 0,
    }) {
        const i = this.eventCursor;
        this.eventCursor = (this.eventCursor + 1) % this.eventCount;
        const ev = this.events;
        const e = i * 12;
        ev[e] = x;
        ev[e + 1] = y;
        ev[e + 2] = z;
        ev[e + 3] = born;
        ev[e + 4] = vx;
        ev[e + 5] = vy;
        ev[e + 6] = vz;
        ev[e + 7] = life;
        ev[e + 8] = radius;
        ev[e + 9] = grow;
        ev[e + 10] = kind;
        // The heap (integer) and the heat (the fraction, ×2 in the shader).
        ev[e + 11] = (Math.floor(variant) % 16) + clamp01(heat) * 0.499;
        return i;
    }

    clear() {
        for (let i = 0; i < this.eventCount; i++) this.events[i * 12 + 3] = -1e6;
        this.eventCursor = 0;
    }

    /** Place, sort and upload every puff for this frame. */
    update(time, eye, fwd) {
        const st = this.stage;
        let n = 0;
        // ── Event puffs ──
        const ev = this.events;
        for (let i = 0; i < this.eventCount; i++) {
            const e = i * 12;
            const age = time - ev[e + 3];
            const life = ev[e + 7];
            const o = n * 16;
            if (age < 0 || age > life) {
                st[o + 3] = 0;
                st[o + 6] = 0;
                st[o] = eye.x;
                st[o + 1] = eye.y;
                st[o + 2] = eye.z - 1;
                st[o + 8] = 0;
                st[o + 7] = 0;
                st[o + 4] = 0;
                st[o + 5] = 0;
                st[o + 9] = 1;
                setBody(st, o, 0, 1, 0, 0);
                n++;
                continue;
            }
            const kind = ev[e + 10];
            // Drag: the puff slows as it spreads (distance = v·τ·(1 − e^(−age/τ))).
            const tau = kind === PUFF.surge ? 5 : 7;
            const k = tau * (1 - Math.exp(-age / tau));
            st[o] = ev[e] + ev[e + 4] * k;
            st[o + 1] = ev[e + 1] + ev[e + 5] * k;
            st[o + 2] = ev[e + 2] + ev[e + 6] * k;
            st[o + 3] = ev[e + 8] + ev[e + 9] * k;
            const f = age / life;
            st[o + 4] = Math.floor(ev[e + 11]);
            st[o + 5] = ev[e + 11] * 7.1 + age * 0.05;
            st[o + 6] = smooth(0, 0.08, f) * (1 - smooth(0.55, 1, f)) * (kind === PUFF.ring ? 0.9 : 0.85);
            st[o + 7] = (ev[e + 11] % 1) * 2 * (1 - smooth(0, kind === PUFF.surge ? 0.7 : 0.75, f));
            st[o + 8] = kind;
            st[o + 9] = kind === PUFF.ring ? 1.35 : 1.15;
            setBody(st, o, ev[e + 4], Math.hypot(ev[e + 4], ev[e + 6]) * 0.3, ev[e + 6], 0.45);
            n++;
        }
        // ── Sort far to near (insertion sort: nearly sorted from the last frame) ──
        const { keys } = this;
        const { order } = this;
        for (let i = 0; i < n; i++) {
            const o = i * 16;
            keys[i] = (st[o] - eye.x) * fwd.x + (st[o + 1] - eye.y) * fwd.y + (st[o + 2] - eye.z) * fwd.z;
        }
        for (let i = 1; i < n; i++) {
            const v = order[i];
            const kv = keys[v];
            let j = i - 1;
            while (j >= 0 && keys[order[j]] < kv) {
                order[j + 1] = order[j];
                j--;
            }
            order[j + 1] = v;
        }
        for (let i = 0; i < n; i++) {
            const o = order[i] * 16;
            this.puff[i * 4] = st[o];
            this.puff[i * 4 + 1] = st[o + 1];
            this.puff[i * 4 + 2] = st[o + 2];
            this.puff[i * 4 + 3] = st[o + 3];
            this.look[i * 4] = st[o + 4];
            this.look[i * 4 + 1] = st[o + 5];
            this.look[i * 4 + 2] = st[o + 6];
            this.look[i * 4 + 3] = st[o + 7];
            this.tint[i * 4] = st[o + 8];
            this.tint[i * 4 + 1] = st[o + 9];
            this.body[i * 4] = st[o + 10];
            this.body[i * 4 + 1] = st[o + 11];
            this.body[i * 4 + 2] = st[o + 12];
            this.body[i * 4 + 3] = st[o + 13];
        }
        this.attr.puff.needsUpdate = true;
        this.attr.look.needsUpdate = true;
        this.attr.tint.needsUpdate = true;
        this.attr.body.needsUpdate = true;
    }

    /** Live event puffs (diagnostics). */
    liveEvents(time) {
        let live = 0;
        for (let i = 0; i < this.eventCount; i++) {
            const age = time - this.events[i * 12 + 3];
            if (age >= 0 && age <= this.events[i * 12 + 7]) live++;
        }
        return live;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.mesh.dispose?.();
    }
}
