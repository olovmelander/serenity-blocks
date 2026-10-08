/**
 * Aether Tides — the stars' light in the fluid.
 *
 * Two small buffers on the fluid's own grid, refreshed once a frame:
 *
 *   shade   how much of each of the two great stars' light reaches a cell (r = the Tide Star,
 *           g = its companion). Light is carried, not marched to the source: a cell looks a few
 *           cells toward the star, gathers the dust and gas on the way, and takes over what the
 *           cell at the far end of that short walk already knew last frame. So shadows reach
 *           across the whole frame for a handful of taps, they soften with distance by
 *           themselves (the bilinear read spreads them), and they run out from a moving cloud
 *           at a finite speed, like light.
 *   glow    the light of the stars the board has lit, summed where they stand (rgb): each one
 *           tints the gas round it with the colour of the piece that lit it.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    clamp,
    dot,
    exp,
    float,
    int,
    length,
    max,
    min,
    smoothstep,
    step,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

import {
    NOVA_LIFE,
    ROW_STAR,
    STAR_RISE,
    STAR_ROWS,
    STAR_SLOTS,
    atMax3,
} from './aether-tides-tsl.js';

const { RendererUtils } = THREE;

function makeTarget(width, height, name) {
    const rt = new THREE.RenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    rt.texture.name = name;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.wrapS = THREE.ClampToEdgeWrapping;
    rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    rt.texture.generateMipmaps = false;
    rt.texture.colorSpace = THREE.NoColorSpace;
    return rt;
}

export class TideLight {
    /**
     * @param {object} options
     * @param {object} options.tide      createTideUniforms()
     * @param {object} options.picture   createPictureUniforms()
     * @param {object} options.fluid     TideFluid
     * @param {number} options.steps     taps of one short walk toward a star (0 = no shadows)
     */
    constructor({
        tide, picture, fluid, steps,
    }) {
        this.u = tide;
        this.p = picture;
        this.fluid = fluid;
        this.steps = Math.max(0, Math.round(steps));
        this.size = { width: 0, height: 0 };
        this.shadeRead = null;
        this.shadeWrite = null;
        this.glow = null;
        this.rendererState = {};
        this.primed = false;

        const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
        blank.needsUpdate = true;
        this.blank = blank;
        const dark = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        dark.needsUpdate = true;
        this.dark = dark;
        this.tShade = texture(blank);
        this.tGlow = texture(dark);
        this.build();
    }

    build() {
        const U = this.u;
        const P = this.p;
        const { tDye } = this.fluid;
        const { tShade, steps } = this;
        const ev = U.events;
        const tideOf = (st) => st.sub(0.5).mul(U.half).mul(2.0);
        const uvOf = (q) => q.div(U.half.mul(2.0)).add(0.5);

        const material = (name, node) => {
            const m = new THREE.NodeMaterial();
            m.name = name;
            m.depthTest = false;
            m.depthWrite = false;
            m.fragmentNode = node;
            return m;
        };

        // ── shade ──
        this.shadeMaterial = steps > 0 ? material('Aether Tides — shade', Fn(() => {
            const st = uv();
            const q = tideOf(st).toVar();
            const walk = (star) => {
                const to = star.sub(q).toVar();
                const dist = length(to).toVar();
                const dir = to.div(dist.add(1e-4));
                // Two cells a tap; never past the star itself.
                const reach = min(dist, U.cell.mul(2.0 * steps));
                const stride = reach.div(steps);
                const depth = float(0.0).toVar();
                for (let i = 0; i < steps; i += 1) {
                    const d = tDye.sample(uvOf(q.add(dir.mul(stride.mul(i + 0.5)))));
                    depth.addAssign(d.a.mul(P.murk).add(atMax3(d.rgb).mul(0.4)));
                }
                const here = exp(depth.mul(stride).mul(P.shadow).negate());
                // What the far end of the walk already knew; at the star, everything.
                const beyond = tShade.sample(uvOf(q.add(dir.mul(reach))));
                const arrived = step(dist, U.cell.mul(2.0 * steps + 0.5));
                return { here, beyond, arrived };
            };
            const a = walk(P.starA);
            const b = walk(P.starB);
            const carried = vec2(
                a.arrived.oneMinus().mul(a.beyond.x).add(a.arrived),
                b.arrived.oneMinus().mul(b.beyond.y).add(b.arrived),
            );
            return vec4(clamp(carried.mul(vec2(a.here, b.here)), 0.0, 1.0), 0.0, 1.0);
        })()) : null;

        // ── glow ──
        this.glowMaterial = material('Aether Tides — star glow', Fn(() => {
            const q = tideOf(uv()).toVar();
            const sum = vec3(0.0).toVar();
            Loop({
                start: int(0), end: int(STAR_SLOTS), type: 'int', condition: '<',
            }, ({ i }) => {
                const r0 = ev.element(i.mul(STAR_ROWS).add(ROW_STAR));
                const r1 = ev.element(i.mul(STAR_ROWS).add(ROW_STAR + 1));
                const age = U.time.sub(r0.z);
                const left = r0.w.sub(U.time);
                // Opens over STAR_RISE, flares as it goes nova, then is gone.
                const open = smoothstep(0.0, STAR_RISE, age);
                const nova = exp(max(left.negate(), 0.0).mul(-4.0)).mul(step(left, 0.0))
                    .mul(step(left.negate(), NOVA_LIFE));
                const lit = open.mul(step(0.0, left)).add(nova.mul(5.0));
                const d = q.sub(r0.xy);
                const fall = float(1.0).div(dot(d, d).mul(60.0).add(0.6));
                sum.addAssign(r1.xyz.mul(r1.w).mul(lit).mul(fall));
            });
            return vec4(sum, 1.0);
        })());

        this.quad = new THREE.QuadMesh(this.glowMaterial);
        this.quad.name = 'Aether Tides — light pass';
    }

    /** Texture nodes for the picture. */
    sample(fuv) {
        return this.tShade.sample(fuv);
    }

    sampleStars(fuv) {
        return this.tGlow.sample(fuv).rgb;
    }

    resize(width, height) {
        const w = Math.max(8, Math.round(width));
        const h = Math.max(8, Math.round(height));
        if ((this.size.width === w && this.size.height === h) || !this.fluid.live) return;
        this.disposeTargets();
        this.size.width = w;
        this.size.height = h;
        if (this.steps > 0) {
            this.shadeRead = makeTarget(w, h, 'Aether Tides — shade A');
            this.shadeWrite = makeTarget(w, h, 'Aether Tides — shade B');
        }
        this.glow = makeTarget(w, h, 'Aether Tides — star glow');
        this.tGlow.value = this.glow.texture;
        this.tShade.value = this.blank;
        this.primed = false;
    }

    /** Once a frame, after the fluid has stepped. `passes` extra carries settle a seek at once. */
    render(renderer, passes = 1) {
        if (!this.glow || !this.fluid.live) return;
        this.rendererState = RendererUtils.resetRendererState(renderer, this.rendererState);
        if (this.steps > 0) {
            // The first frame has no memory: start fully lit and let the shadows run out.
            const count = this.primed ? passes : Math.max(passes, 24);
            for (let i = 0; i < count; i += 1) {
                this.quad.material = this.shadeMaterial;
                renderer.setRenderTarget(this.shadeWrite);
                this.quad.render(renderer);
                const read = this.shadeRead;
                this.shadeRead = this.shadeWrite;
                this.shadeWrite = read;
                this.tShade.value = this.shadeRead.texture;
            }
            this.primed = true;
        }
        this.quad.material = this.glowMaterial;
        renderer.setRenderTarget(this.glow);
        this.quad.render(renderer);
        RendererUtils.restoreRendererState(renderer, this.rendererState);
    }

    /** Forget the carried light (a seek, a reset): the next render settles it from scratch. */
    forget() {
        this.primed = false;
        this.tShade.value = this.blank;
    }

    disposeTargets() {
        this.shadeRead?.dispose();
        this.shadeWrite?.dispose();
        this.glow?.dispose();
        this.shadeRead = null;
        this.shadeWrite = null;
        this.glow = null;
    }

    dispose() {
        this.tShade.value = this.blank;
        this.tGlow.value = this.dark;
        this.disposeTargets();
        this.shadeMaterial?.dispose();
        this.glowMaterial.dispose();
        this.blank.dispose();
        this.dark.dispose();
    }
}
