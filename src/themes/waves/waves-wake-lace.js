import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, exp, float, max, mix, positionGeometry, sin,
    smoothstep, texture, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';

// The passing front lifts finely aerated water into bright seams on the glass. Keep the shapes
// on the wave's own surface, so they curl over its moving face in perspective.
const SEGMENTS = 32;
const SLOTS = 12;
const VERTICES = (SEGMENTS + 1) * 2;
const LIFE = 2.65;
const PEARL = [0.72, 1.25, 1.26];
const GOLD = [1.63, 0.89, 0.40];
const BLUE = [0.4, 0.94, 1.59];
const hit = {};
const STROKES = Object.freeze({
    double: 2, triple: 3, cascade: 3, counter: 3, incoming: 2, outgoing: 2,
});

/** Exposed water beside the HUD, or the free strip above or below a wide layout. */
export function exposedWater(world) {
    const panels = world.layout?.cards || [];
    const hud = world.layout?.hud;
    const right = Math.max(0.53, ...panels.map((card) => card.x1), hud?.x1 || 0);
    const top = Math.min(0.24, ...panels.map((card) => card.y0), hud?.y0 ?? 1);
    const bottom = Math.max(0.69, ...panels.map((card) => card.y1), hud?.y1 ?? 0);
    const strip = right > 0.83 && Math.max(top, 1 - bottom) >= 0.075;
    const x0 = strip ? 0.20 : Math.min(right + 0.016, 0.97);
    const width = (strip ? 0.93 : 0.985) - x0;
    const stripY = top > 1 - bottom ? 0.014 : bottom + 0.012;
    const y0 = strip ? stripY : 0.25;
    const height = strip ? Math.max(top, 1 - bottom) - 0.026 : 0.59;
    return {
        x0, y0, width, height, strip,
    };
}

// Cubic strokes are placed within the exposed face. The ends of a stroke taper to a hair.
function coordinate(a, b, c, d, t) {
    const s = 1 - t;
    return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

export class WakeLace {
    constructor(world) {
        this.world = world;
        this.ends = new Float64Array(SLOTS).fill(-Infinity);
        this.geometry = new THREE.BufferGeometry();
        const count = VERTICES * SLOTS;
        this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.ink = new THREE.BufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
        const st = new Float32Array(count * 2);
        const indices = [];
        for (let s = 0; s < SLOTS; s += 1) {
            for (let i = 0; i <= SEGMENTS; i += 1) {
                const k = s * VERTICES + i * 2;
                st.set([i / SEGMENTS, 0, i / SEGMENTS, 1], k * 2);
                if (i < SEGMENTS) indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
            }
        }
        this.geometry.setAttribute('position', this.position);
        this.geometry.setAttribute('aInk', this.ink);
        this.geometry.setAttribute('uv', new THREE.BufferAttribute(st, 2));
        this.geometry.setIndex(indices);
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            premultipliedAlpha: true,
            side: THREE.DoubleSide,
            fog: false,
        });
        material.name = 'waves-wake-lace';
        material.forceSinglePass = true;
        const ink = attribute('aInk', 'vec4');
        const age = world.U.time.sub(ink.w);
        const t = clamp(age, 0, LIFE);
        material.positionNode = Fn(() => {
            const row = clamp(positionGeometry.x.add(t.mul(0.009)), -1, 1);
            const point = world.shape.point(row, positionGeometry.y.sub(t.mul(0.32))).position.toVar();
            return mix(point, cameraPosition, 0.016);
        })();
        const vInk = varying(vec4(ink.xyz, age), 'vWakeInk');
        material.outputNode = Fn(() => {
            const stUV = uv();
            const a = vInk.w.sub(stUV.x.mul(0.48)).toVar();
            const edge = smoothstep(0, 0.10, a).mul(float(1).sub(smoothstep(0.7, LIFE - 0.48, a)));
            const cross = stUV.y.mul(2).sub(1).toVar();
            const crawl = max(a, 0).mul(0.035);
            const grain = texture(world.noise, vec2(stUV.x.mul(1.8).sub(crawl), cross.mul(0.12))).toVar();
            // The same two scales of bubble as the water below. Open cells cut into the falling
            // side of the crest first. Their walls carry the last scattered light as it drains.
            const cells = texture(world.lace, vec2(stUV.x.mul(1.15), cross.mul(0.07)).add(grain.rg.mul(0.08))).toVar();
            const bubbles = float(1).sub(smoothstep(0.028, 0.15, cells.r));
            const film = float(1).sub(smoothstep(0.035, 0.20, cells.g));
            const seam = cross.add(grain.a.sub(0.5).mul(0.68)).add(sin(stUV.x.mul(31)).mul(0.09)).toVar();
            const body = float(1).sub(smoothstep(0.04, 0.97, abs(seam)));
            const filament = exp(seam.sub(0.22).pow2().mul(-40)).mul(mix(0.10, 0.9, film));
            const froth = grain.a.mul(0.33).add(bubbles.mul(0.58)).add(film.mul(0.29));
            const drain = smoothstep(0.65, 1.95, a).mul(0.58);
            const islands = smoothstep(drain.sub(0.15), drain.add(0.23), grain.a.mul(0.82).add(bubbles.mul(0.38)));
            const sparkle = vInk.rgb.mul(body.mul(froth)).add(vec3(1.08, 1.09, 0.98).mul(filament));
            return vec4(sparkle.mul(edge).mul(islands), 0);
        })();
        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.name = material.name;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 22;
        this.reset();
    }

    reset() {
        this.ends.fill(-Infinity);
        for (let i = 0; i < this.ink.count; i += 1) this.ink.setW(i, -1e6);
        this.ink.needsUpdate = true;
        this.until = -Infinity;
        this.mesh.visible = false;
    }

    stroke(xs, ys, colour, delay = 0, weight = 1) {
        const { world } = this;
        if (!world.camera) return;
        const slot = this.ends.indexOf(Math.min(...this.ends));
        const birth = world.clock + delay;
        this.ends[slot] = birth + LIFE;
        this.until = Math.max(this.until, this.ends[slot]);
        const {
            x0, y0, width, height, strip,
        } = exposedWater(world);
        const px = Math.min(strip ? height * 0.055 : 0.014, 0.075 * width) * weight;
        for (let i = 0; i <= SEGMENTS; i += 1) {
            const t = i / SEGMENTS;
            const x = x0 + width * coordinate(...xs, t);
            const y = y0 + height * coordinate(...ys, t);
            const tx = width * (coordinate(...xs, t + 0.005) - coordinate(...xs, t - 0.005)) * world.aspect;
            const ty = height * (coordinate(...ys, t + 0.005) - coordinate(...ys, t - 0.005));
            const w = (px * (0.05 + 0.95 * Math.sin(Math.PI * t) ** 0.6)) / (Math.hypot(tx, ty) || 1);
            for (let side = 0; side < 2; side += 1) {
                const k = slot * VERTICES + i * 2 + side;
                const sign = side * 2 - 1;
                world.castScreen(x - (sign * ty * w) / world.aspect, y + sign * tx * w, hit);
                this.position.setXYZ(k, hit.r, hit.z, 0);
                this.ink.setXYZW(k, colour[0], colour[1], colour[2], birth);
            }
        }
        this.position.needsUpdate = true;
        this.ink.needsUpdate = true;
        this.mesh.visible = true;
    }

    show(kind) {
        const needed = STROKES[kind];
        if (!needed || !this.world.camera) return;
        // A rapid cascade can fill the entire pool. Keep both arms of a double or all three
        // tiers of a triple together. The ordinary lip spray still answers every clear.
        let available = 0;
        for (const end of this.ends) {
            if (end - this.world.clock < 0.3) available += 1;
        }
        if (available < needed) return;
        switch (kind) {
        case 'double':
            // Two long curling arms shear apart from the same point.
            this.stroke([0.44, 0.41, 0.10, 0.03], [0.98, 0.63, 0.61, 0.31], PEARL);
            this.stroke([0.44, 0.61, 1.03, 0.85], [0.98, 0.56, 0.51, 0.10], PEARL, 0.05);
            break;
        case 'triple':
            // Three tiers of wind-combed breaking crests, successively gilded.
            for (let i = 0; i < 3; i += 1) {
                const shift = i * 0.21;
                this.stroke(
                    [0.01, 0.29, 0.91, 0.94 - i * 0.07],
                    [0.64 + shift, 0.35 + shift, 0.50 + shift, 0.10 + shift],
                    i === 1 ? PEARL : GOLD,
                    i * 0.15,
                );
            }
            break;
        case 'cascade':
            for (let i = 0; i < 3; i += 1) {
                const off = i * 0.19;
                this.stroke(
                    [0.08 + off, -0.02 + off, 0.28 + off, 0.43 + off],
                    [0.87 - off, 0.52 - off, 0.48 - off, 0.63 - off],
                    BLUE,
                    i * 0.21,
                );
            }
            break;
        case 'counter':
            this.stroke([0.01, 0.29, 0.47, 0.91], [0.90, 0.87, 0.36, 0.14], PEARL);
            this.stroke([0.97, 0.62, 0.36, 0.12], [0.96, 0.90, 0.34, 0.21], GOLD);
            this.stroke([0.53, 0.71, 0.36, 0.48], [0.60, 0.45, 0.35, 0.12], PEARL, 0.30, 0.7);
            break;
        case 'outgoing':
            this.stroke([0.93, 0.76, 0.33, 0.02], [0.95, 0.57, 0.55, 0.14], GOLD);
            this.stroke([0.97, 0.66, 0.21, 0.02], [0.67, 0.36, 0.41, 0.14], GOLD, 0.06, 0.64);
            break;
        case 'incoming':
            this.stroke([0.06, 0.19, 0.78, 0.97], [0.18, 0.65, 0.43, 0.88], BLUE, 0, 1.4);
            this.stroke([0.01, 0.21, 0.83, 0.88], [0.25, 0.82, 0.55, 0.98], PEARL, 0.14, 0.6);
            break;
        default: break;
        }
    }

    dispose() {
        this.mesh.removeFromParent();
        this.geometry.dispose();
        this.mesh.material.dispose();
    }
}
