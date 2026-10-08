/**
 * Aether Tides — the fluid.
 *
 * The nebula is an incompressible fluid on a grid over the screen (plus a margin), solved with
 * full-screen passes into half-float render targets, so the same code runs on WebGPU and on the
 * WebGL2 backend. One step:
 *
 *   velocity   carry the velocity (and the gas's heat) along itself; add what stirs it: the
 *              tide's gyres, gusts, vorticity confinement, and every event in flight
 *   divergence measure how much the flow piles up, minus what the events ask for (a blast front
 *              shoulders the gas outward, a well draws it in: both are prescribed divergence, the
 *              only kind of radial push an incompressible fluid cannot simply cancel)
 *   pressure   relax the pressure (each pass is two Jacobi sweeps folded into one stencil)
 *   project    take the pressure's gradient out of the velocity
 *   dye        carry the glowing gas (rgb) and the dust (a) along the flow; let them thin out;
 *              heal them slowly toward the resting nebula; pour in what the events pour
 *   weave      carry two sets of texture coordinates along the flow (stored as offsets). The
 *              picture reads fine grain through them, so the grain is stretched and folded by
 *              the same flow as the gas; each set is reset in turn while it is faded out
 *
 * Velocity is in tide units per second (one unit = half the screen's height), positions in tide
 * space (x right, y down). The clock is fixed-step: `advance()` runs whole steps and leaves the
 * remainder for the picture to extrapolate.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    abs,
    clamp,
    dot,
    exp,
    float,
    int,
    length,
    max,
    min,
    mix,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    uniformArray,
    uv,
    vec2,
    vec4,
} from 'three/tsl';

import {
    DOMAIN_MARGIN,
    EVENT_ROWS,
    GYRE_SLOTS,
    NOVA_LIFE,
    RING_LIFE,
    RING_ROWS,
    RING_TAU,
    ROW_GYRE,
    ROW_RING,
    ROW_SPLAT,
    ROW_STAR,
    ROW_WELL,
    SIM_DT,
    SIM_MAX_STEPS,
    SPLAT_ROWS,
    STAR_ROWS,
    STAR_SLOTS,
    WELL_ROWS,
    WELL_SLOTS,
    atMax3,
} from './aether-tides-tsl.js';

const { RendererUtils } = THREE;

/** Seconds between resets of one set of woven coordinates (the other is at full weight then). */
export const WEAVE_PERIOD = 11;

/** Uniforms the solver, the light and the picture share. */
export function createTideUniforms() {
    const rows = Array.from({ length: EVENT_ROWS }, () => new THREE.Vector4());
    return {
        rows,
        /** The event table (aether-tides-events.js), one vec4 per row. */
        events: uniformArray(rows, 'vec4'),
        splatCount: uniform(0),
        ringCount: uniform(0),
        /** Half-size of the fluid's domain and of the screen, tide units. */
        half: uniform(new THREE.Vector2((16 / 9) * DOMAIN_MARGIN, DOMAIN_MARGIN)),
        screen: uniform(new THREE.Vector2(16 / 9, 1)),
        /** One velocity cell in uv, and its side in tide units. */
        texel: uniform(new THREE.Vector2(1 / 256, 1 / 144)),
        cell: uniform(0.0158),
        dt: uniform(SIM_DT),
        /** The fluid's clock at the step being taken. */
        time: uniform(0),
        /** Seconds since the last whole step (the picture extrapolates across it). */
        ahead: uniform(0),
        // ── what stirs the fluid at rest ──
        curl: uniform(14),
        drag: uniform(0.32),
        heatFade: uniform(0.9),
        tide: uniform(1),
        gust: uniform(0.16),
        gustScale: uniform(0.09),
        gustScroll: uniform(new THREE.Vector2(0, 0)),
        warm: uniform(0.85),
        // ── the dye ──
        fade: uniform(0.02),
        crowd: uniform(0.09),
        dustFade: uniform(0.025),
        heal: uniform(0.045),
        resetDye: uniform(0),
        // ── the weave ──
        weaveReset: uniform(new THREE.Vector2(0, 0)),
        weaveMix: uniform(0.5),
    };
}

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

/** Two targets that take turns: one is read while the other is written. */
function makePair(width, height, name) {
    return {
        read: makeTarget(width, height, `${name} A`),
        write: makeTarget(width, height, `${name} B`),
        swap() {
            const { read } = this;
            this.read = this.write;
            this.write = read;
        },
        dispose() {
            this.read.dispose();
            this.write.dispose();
        },
    };
}

function passMaterial(name, node) {
    const material = new THREE.NodeMaterial();
    material.name = name;
    material.depthTest = false;
    material.depthWrite = false;
    material.fragmentNode = node;
    return material;
}

/**
 * Can this renderer draw into half-float targets? WebGPU always can. A WebGL2 context needs
 * EXT_color_buffer_float or EXT_color_buffer_half_float; without one the solver's targets would be
 * incomplete framebuffers.
 */
export function supportsFloatTargets(renderer) {
    const backend = renderer?.backend;
    if (!backend || backend.isWebGPUBackend === true) return true;
    const { gl } = backend;
    if (!gl || typeof gl.getExtension !== 'function') return true;
    try {
        return Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    } catch {
        return false;
    }
}

/** Grid sizes for an aspect ratio: square cells, about `cells` of them. */
export function gridFor(aspect, cells) {
    const a = Math.max(0.3, Math.min(4, aspect));
    const height = Math.max(24, Math.round(Math.sqrt(cells / a)));
    const width = Math.max(24, Math.round(height * a));
    return { width, height };
}

export class TideFluid {
    /**
     * @param {object} options
     * @param {object} options.uniforms        createTideUniforms()
     * @param {object} options.tNoise          texture node of the baked noise
     * @param {Function} options.field         (q) → vec4: the resting nebula at a tide-space point
     * @param {number} [options.cells]         velocity cells (about)
     * @param {number} [options.dyeHeight]     the dye's rows
     * @param {number} [options.sweeps]        pressure passes per step (two Jacobi sweeps each)
     * @param {boolean} [options.live=true]    false: the device cannot render to half-float
     *                                         targets. The clock and the event table still run
     *                                         (sprites and fronts read them); nothing is solved.
     */
    constructor(options) {
        this.u = options.uniforms;
        this.field = options.field;
        this.cells = options.cells ?? 40000;
        this.dyeHeight = options.dyeHeight ?? 540;
        this.sweeps = Math.max(2, Math.round(options.sweeps ?? 8));
        this.live = options.live !== false;
        this.aspect = 16 / 9;
        this.size = {
            width: 0, height: 0, dyeWidth: 0, dyeHeight: 0,
        };
        this.vel = null;
        this.pres = null;
        this.dye = null;
        this.weave = null;
        /** Whole steps taken since the last reset, and simulated seconds not yet stepped. */
        this.steps = 0;
        this.debt = 0;
        this.clock = 0;
        this.weaveEpoch = [-1, -1];
        this.rendererState = {};
        this.disposed = false;

        const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        blank.needsUpdate = true;
        this.blank = blank;
        this.tVel = texture(blank);
        this.tPres = texture(blank);
        this.tDye = texture(blank);
        this.tWeave = texture(blank);
        this.tNoise = options.tNoise;

        this.buildPasses();
        this.resize(this.aspect);
    }

    // ── passes ──────────────────────────────────────────────────────────────────

    buildPasses() {
        const U = this.u;
        const {
            tVel, tPres, tDye, tWeave, tNoise,
        } = this;
        const ev = U.events;
        const tideOf = (st) => st.sub(0.5).mul(U.half).mul(2.0);
        /** Tide units per second → uv per step. */
        const uvPerStep = () => vec2(U.dt, U.dt).div(U.half.mul(2.0));
        const offset = (st, dx, dy) => st.add(vec2(U.texel.x.mul(dx), U.texel.y.mul(dy)));
        const splatRows = (i) => {
            const base = i.mul(SPLAT_ROWS).add(ROW_SPLAT);
            return [
                ev.element(base), ev.element(base.add(1)), ev.element(base.add(2)), ev.element(base.add(3)),
                ev.element(base.add(4)),
            ];
        };
        const ringRows = (i) => {
            const base = i.mul(RING_ROWS).add(ROW_RING);
            return [ev.element(base), ev.element(base.add(1))];
        };
        const countLoop = (count, body) => Loop({
            start: int(0), end: int(count), type: 'int', condition: '<',
        }, ({ i }) => body(i));

        /** A splat's weight at q: where it is on its way from a to b, and its footprint. */
        const splatWeight = (q, r0, r1, r4) => {
            const age = U.time.sub(r1.x);
            const live = step(0.0, age).mul(step(age, r1.y));
            const t = clamp(age.div(max(r1.y, 1e-4)), 0.0, 1.0);
            // The same path the spark's sprite flies (aether-tides-stars.js).
            const k = mix(t, t.mul(t).mul(float(3.0).sub(t.mul(2.0))), r4.y);
            const span = r0.zw.sub(r0.xy);
            const bow = vec2(span.y.negate(), span.x).mul(sin(t.mul(Math.PI)).mul(r4.x));
            const d = q.sub(mix(r0.xy, r0.zw, k).add(bow)).toVar();
            const radius = r1.z;
            const round = exp(dot(d, d).div(radius.mul(radius)).negate());
            const edge = radius.mul(mix(0.35, 0.1, r1.w));
            const inside = (v) => float(1.0).sub(smoothstep(radius.sub(edge), radius.add(edge), abs(v)));
            const box = inside(d.x).mul(inside(d.y));
            return { weight: mix(round, box, r1.w).mul(live), d, radius };
        };

        /** A blast front at q: how far q is from the front (in widths), and its strength now. */
        const ringFront = (q, r0, r1) => {
            const age = U.time.sub(r0.z);
            const live = step(0.0, age).mul(step(age, RING_LIFE));
            const sink = exp(age.max(0.0).div(RING_TAU).negate());
            const radius = r0.w.mul(float(1.0).sub(sink));
            const d = q.sub(r0.xy).toVar();
            const dist = length(d).toVar();
            const x = dist.sub(radius).div(r1.y).toVar();
            // A front is strongest as it leaves and spends itself as it slows.
            const power = sink.mul(live);
            return {
                x, dist, d, power, band: exp(x.mul(x).negate()).mul(power),
            };
        };

        // ── velocity ──
        this.velocityMaterial = passMaterial('Aether Tides — velocity', Fn(() => {
            const st = uv();
            const q = tideOf(st).toVar();
            const c = tVel.sample(st).toVar();
            const carried = tVel.sample(st.sub(c.xy.mul(uvPerStep()))).toVar();
            const vel = carried.xy.toVar();
            const heat = carried.z.mul(float(1.0).sub(U.heatFade.mul(U.dt))).toVar();

            // Vorticity confinement: push each whirl back toward its own centre.
            const at = (dx, dy) => tVel.sample(offset(st, dx, dy)).xy;
            const l = at(-1, 0).toVar();
            const r = at(1, 0).toVar();
            const t = at(0, -1).toVar();
            const b = at(0, 1).toVar();
            const lt = at(-1, -1).toVar();
            const rt = at(1, -1).toVar();
            const lb = at(-1, 1).toVar();
            const rb = at(1, 1).toVar();
            const wC = r.y.sub(l.y).sub(b.x.sub(t.x));
            const wL = c.y.sub(at(-2, 0).y).sub(lb.x.sub(lt.x));
            const wR = at(2, 0).y.sub(c.y).sub(rb.x.sub(rt.x));
            const wT = rt.y.sub(lt.y).sub(c.x.sub(at(0, -2).x));
            const wB = rb.y.sub(lb.y).sub(at(0, 2).x.sub(c.x));
            const grad = vec2(abs(wR).sub(abs(wL)), abs(wB).sub(abs(wT)));
            const toward = grad.div(length(grad).add(1e-5));
            vel.addAssign(vec2(toward.y, toward.x.negate()).mul(wC).mul(U.curl).mul(U.dt));

            // The tide: slow gyres, and the drag that makes them the resting flow.
            const tide = vec2(0.0, 0.0).toVar();
            for (let g = 0; g < GYRE_SLOTS; g += 1) {
                const row = ev.element(ROW_GYRE + g);
                const d = q.sub(row.xy);
                const w = exp(dot(d, d).div(row.w.mul(row.w)).negate());
                tide.addAssign(vec2(d.y.negate(), d.x).div(row.w).mul(row.z).mul(w));
            }
            vel.addAssign(tide.mul(U.tide).sub(vel).mul(U.drag.mul(U.dt)));

            // Gusts: a slowly sliding field of small pushes keeps the gas folding.
            const gust = tNoise.sample(q.mul(U.gustScale).add(U.gustScroll)).xy.sub(0.5);
            vel.addAssign(gust.mul(U.gust).mul(U.dt));

            // Events in flight.
            countLoop(U.splatCount, (i) => {
                const [r0, r1, , r3, r4] = splatRows(i);
                const s = splatWeight(q, r0, r1, r4);
                const push = r3.xy.add(vec2(s.d.y.negate(), s.d.x).div(s.radius).mul(r3.w));
                vel.addAssign(push.mul(s.weight).mul(U.dt));
                heat.addAssign(r3.z.mul(s.weight).mul(U.dt));
            });
            countLoop(U.ringCount, (i) => {
                const [r0, r1] = ringRows(i);
                const f = ringFront(q, r0, r1);
                // The front is ragged: it kicks harder here and softer there, and that is what
                // leaves whirls in its wake (an even push would be cancelled by the pressure).
                const ragged = tNoise.sample(q.mul(0.31).add(r0.zw.mul(0.17))).z.sub(0.5);
                const out = f.d.div(f.dist.add(1e-4));
                vel.addAssign(out.mul(ragged).mul(r1.w).mul(f.band).mul(U.dt));
                heat.addAssign(r1.z.mul(f.band).mul(U.dt));
            });
            for (let w = 0; w < WELL_SLOTS; w += 1) {
                const r0 = ev.element(ROW_WELL + w * WELL_ROWS);
                const r1 = ev.element(ROW_WELL + w * WELL_ROWS + 1);
                const d = q.sub(r0.xy);
                const dist = length(d);
                const g = dist.div(r1.w);
                // A whirl: fastest at its own radius, falling away outside.
                const whirl = g.mul(exp(float(1.0).sub(g.mul(g)).mul(0.5)));
                vel.addAssign(vec2(d.y.negate(), d.x).div(dist.add(1e-4)).mul(whirl).mul(r1.x)
                    .mul(U.dt));
                heat.addAssign(r1.z.mul(exp(dot(d, d).div(r0.w.mul(r0.w)).negate())).mul(U.dt));
            }
            Loop({
                start: int(0), end: int(STAR_SLOTS), type: 'int', condition: '<',
            }, ({ i }) => {
                const r0 = ev.element(i.mul(STAR_ROWS).add(ROW_STAR));
                const r1 = ev.element(i.mul(STAR_ROWS).add(ROW_STAR + 1));
                const age = U.time.sub(r0.w);
                const live = step(0.0, age).mul(step(age, NOVA_LIFE));
                const d = q.sub(r0.xy);
                const flash = exp(age.max(0.0).mul(-5.0)).mul(live).mul(r1.w);
                heat.addAssign(flash.mul(exp(dot(d, d).div(0.016).negate())).mul(22.0).mul(U.dt));
            });

            // The open boundary: the flow dies away inside the margin.
            const border = min(min(st.x, float(1.0).sub(st.x)), min(st.y, float(1.0).sub(st.y)));
            vel.mulAssign(mix(0.86, 1.0, smoothstep(0.0, 0.05, border)));
            return vec4(clamp(vel, -8.0, 8.0), clamp(heat, 0.0, 12.0), 0.0);
        })());

        // ── divergence (into the pressure target: r = warm-started pressure, g = right-hand side) ──
        this.divergenceMaterial = passMaterial('Aether Tides — divergence', Fn(() => {
            const st = uv();
            const q = tideOf(st).toVar();
            const l = tVel.sample(offset(st, -1, 0)).x;
            const r = tVel.sample(offset(st, 1, 0)).x;
            const t = tVel.sample(offset(st, 0, -1)).y;
            const b = tVel.sample(offset(st, 0, 1)).y;
            const div = r.sub(l).add(b.sub(t)).mul(0.5).div(U.cell);

            const asked = float(0.0).toVar();
            countLoop(U.ringCount, (i) => {
                const [r0, r1] = ringRows(i);
                const f = ringFront(q, r0, r1);
                // A band of outward flow u(r) = push · e^(−x²): its divergence is u′ + u / r.
                const du = f.x.mul(-2.0).div(r1.y).add(float(1.0).div(max(f.dist, r1.y)));
                asked.addAssign(r1.x.mul(f.band).mul(du));
            });
            for (let w = 0; w < WELL_SLOTS; w += 1) {
                const r0 = ev.element(ROW_WELL + w * WELL_ROWS);
                const d = q.sub(r0.xy);
                asked.addAssign(r0.z.mul(exp(dot(d, d).div(r0.w.mul(r0.w)).negate())));
            }
            Loop({
                start: int(0), end: int(STAR_SLOTS), type: 'int', condition: '<',
            }, ({ i }) => {
                const r0 = ev.element(i.mul(STAR_ROWS).add(ROW_STAR));
                const r1 = ev.element(i.mul(STAR_ROWS).add(ROW_STAR + 1));
                const age = U.time.sub(r0.w);
                const live = step(0.0, age).mul(step(age, NOVA_LIFE));
                const d = q.sub(r0.xy);
                const burst = exp(age.max(0.0).mul(-7.0)).mul(live).mul(r1.w);
                asked.addAssign(burst.mul(exp(dot(d, d).div(0.006).negate())).mul(16.0));
            });

            const warm = tPres.sample(st).x.mul(U.warm);
            return vec4(warm, div.sub(asked).mul(U.cell).mul(U.cell), 0.0, 0.0);
        })());

        // ── pressure: two Jacobi sweeps in one 13-point stencil ──
        this.pressureMaterial = passMaterial('Aether Tides — pressure', Fn(() => {
            const st = uv();
            const at = (dx, dy) => tPres.sample(offset(st, dx, dy));
            const c = at(0, 0).toVar();
            const l = at(-1, 0).toVar();
            const r = at(1, 0).toVar();
            const t = at(0, -1).toVar();
            const b = at(0, 1).toVar();
            const far = at(-2, 0).x.add(at(2, 0).x).add(at(0, -2).x).add(at(0, 2).x);
            const diagonal = at(-1, -1).x.add(at(1, -1).x).add(at(-1, 1).x).add(at(1, 1).x);
            const p = far.add(diagonal.mul(2.0)).add(c.x.mul(4.0))
                .sub(l.y.add(r.y).add(t.y).add(b.y))
                .div(16.0)
                .sub(c.y.mul(0.25));
            // The open boundary: pressure is zero on the domain's edge, so gas may cross it. A
            // well or a spring (net divergence) has no solution in a closed box: the pressure
            // would climb every step until half floats could no longer hold its gradient.
            const border = min(min(st.x, float(1.0).sub(st.x)), min(st.y, float(1.0).sub(st.y)));
            const open = step(U.texel.x.mul(1.5), border);
            return vec4(p.mul(open), c.y, 0.0, 0.0);
        })());

        // ── project ──
        this.projectMaterial = passMaterial('Aether Tides — project', Fn(() => {
            const st = uv();
            const v = tVel.sample(st).toVar();
            const l = tPres.sample(offset(st, -1, 0)).x;
            const r = tPres.sample(offset(st, 1, 0)).x;
            const t = tPres.sample(offset(st, 0, -1)).x;
            const b = tPres.sample(offset(st, 0, 1)).x;
            const grad = vec2(r.sub(l), b.sub(t)).mul(0.5).div(U.cell);
            return vec4(v.xy.sub(grad), v.z, 0.0);
        })());

        // ── dye ──
        const { field } = this;
        this.dyeMaterial = passMaterial('Aether Tides — dye', Fn(() => {
            const st = uv();
            const q = tideOf(st).toVar();
            const v = tVel.sample(st).xy;
            const d = tDye.sample(st.sub(v.mul(uvPerStep()))).toVar();
            // Thin gas lingers; crowded gas burns off faster, so nothing saturates.
            const glow = atMax3(d.rgb);
            const keep = float(1.0).sub(U.fade.add(U.crowd.mul(glow)).mul(U.dt));
            d.assign(vec4(d.rgb.mul(keep), d.a.mul(float(1.0).sub(U.dustFade.mul(U.dt)))));
            // The resting nebula heals back, faster in the margin where new gas flows in.
            const rest = field(q).toVar();
            const border = min(min(st.x, float(1.0).sub(st.x)), min(st.y, float(1.0).sub(st.y)));
            const heal = U.heal.add(float(1.0).sub(smoothstep(0.0, 0.05, border)).mul(2.0));
            d.addAssign(rest.sub(d).mul(clamp(heal.mul(U.dt), 0.0, 1.0)));

            countLoop(U.splatCount, (i) => {
                const [r0, r1, r2, , r4] = splatRows(i);
                const s = splatWeight(q, r0, r1, r4);
                d.addAssign(r2.mul(s.weight).mul(U.dt));
            });
            for (let w = 0; w < WELL_SLOTS; w += 1) {
                const r0 = ev.element(ROW_WELL + w * WELL_ROWS);
                const r1 = ev.element(ROW_WELL + w * WELL_ROWS + 1);
                const dq = q.sub(r0.xy);
                const core = exp(dot(dq, dq).div(r0.w.mul(r0.w)).negate());
                d.mulAssign(float(1.0).sub(clamp(r1.y.mul(core).mul(U.dt), 0.0, 1.0)));
            }
            return mix(max(d, vec4(0.0)), rest, U.resetDye);
        })());

        // ── weave ──
        this.weaveMaterial = passMaterial('Aether Tides — weave', Fn(() => {
            const st = uv();
            const move = tVel.sample(st).xy.mul(uvPerStep());
            const carried = tWeave.sample(st.sub(move));
            const a = carried.xy.sub(move).mul(float(1.0).sub(U.weaveReset.x));
            const b = carried.zw.sub(move).mul(float(1.0).sub(U.weaveReset.y));
            return vec4(a, b);
        })());

        this.clearMaterial = passMaterial('Aether Tides — clear', vec4(0.0, 0.0, 0.0, 0.0));

        this.quad = new THREE.QuadMesh(this.velocityMaterial);
        this.quad.name = 'Aether Tides — fluid pass';
    }

    // ── size ────────────────────────────────────────────────────────────────────

    /** Fit the grid to an aspect ratio. Rebuilds the targets (and resets the fluid) if it changed. */
    resize(aspect) {
        const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
        const grid = gridFor(a, this.cells);
        const dyeHeight = Math.max(grid.height, Math.round(this.dyeHeight));
        const dyeWidth = Math.max(grid.width, Math.round(dyeHeight * a));
        const s = this.size;
        const U = this.u;
        this.aspect = a;
        U.screen.value.set(a, 1);
        U.half.value.set(a * DOMAIN_MARGIN, DOMAIN_MARGIN);
        U.texel.value.set(1 / grid.width, 1 / grid.height);
        U.cell.value = (2 * DOMAIN_MARGIN) / grid.height;
        const same = s.width === grid.width && s.height === grid.height
            && s.dyeWidth === dyeWidth && s.dyeHeight === dyeHeight;
        if (same || !this.live) {
            return false;
        }
        this.disposeTargets();
        s.width = grid.width;
        s.height = grid.height;
        s.dyeWidth = dyeWidth;
        s.dyeHeight = dyeHeight;
        this.vel = makePair(grid.width, grid.height, 'Aether Tides — velocity');
        this.pres = makePair(grid.width, grid.height, 'Aether Tides — pressure');
        this.weave = makePair(grid.width, grid.height, 'Aether Tides — weave');
        this.dye = makePair(dyeWidth, dyeHeight, 'Aether Tides — dye');
        this.bind();
        this.needsReset = true;
        return true;
    }

    bind() {
        this.tVel.value = this.vel.read.texture;
        this.tPres.value = this.pres.read.texture;
        this.tDye.value = this.dye.read.texture;
        this.tWeave.value = this.weave.read.texture;
    }

    // ── run ─────────────────────────────────────────────────────────────────────

    draw(renderer, material, pair) {
        this.quad.material = material;
        renderer.setRenderTarget(pair.write);
        this.quad.render(renderer);
        pair.swap();
        this.bind();
    }

    /** Still gas, laid out as the resting nebula, at clock `time`. */
    reset(renderer, time = 0) {
        if (this.disposed) return;
        if (!this.live) {
            this.steps = 0;
            this.debt = 0;
            this.clock = time;
            this.setAhead(0);
            return;
        }
        if (!this.vel) return;
        const U = this.u;
        this.rendererState = RendererUtils.resetRendererState(renderer, this.rendererState);
        const pairs = [this.vel, this.pres, this.weave];
        for (let i = 0; i < pairs.length; i += 1) {
            this.draw(renderer, this.clearMaterial, pairs[i]);
            this.draw(renderer, this.clearMaterial, pairs[i]);
        }
        this.draw(renderer, this.clearMaterial, this.dye);
        U.time.value = time;
        U.resetDye.value = 1;
        this.draw(renderer, this.dyeMaterial, this.dye);
        U.resetDye.value = 0;
        RendererUtils.restoreRendererState(renderer, this.rendererState);
        this.steps = 0;
        this.debt = 0;
        this.clock = time;
        this.weaveEpoch[0] = Math.floor(time / WEAVE_PERIOD);
        this.weaveEpoch[1] = Math.floor(time / WEAVE_PERIOD + 0.5);
        this.needsReset = false;
        this.setAhead(0);
    }

    setAhead(seconds) {
        const U = this.u;
        U.ahead.value = seconds;
        // Each set of woven coordinates is at zero weight when it is reset.
        const phase = (this.clock + seconds) / WEAVE_PERIOD;
        const f = phase - Math.floor(phase);
        U.weaveMix.value = 1 - Math.abs(2 * f - 1);
    }

    /** One fixed step. `prepare(clock)` runs first so the caller can write the event table. */
    step(renderer, prepare) {
        const U = this.u;
        this.clock += SIM_DT;
        this.steps += 1;
        U.time.value = this.clock;
        U.dt.value = SIM_DT;
        prepare?.(this.clock);

        const epochA = Math.floor(this.clock / WEAVE_PERIOD);
        const epochB = Math.floor(this.clock / WEAVE_PERIOD + 0.5);
        U.weaveReset.value.set(epochA !== this.weaveEpoch[0] ? 1 : 0, epochB !== this.weaveEpoch[1] ? 1 : 0);
        this.weaveEpoch[0] = epochA;
        this.weaveEpoch[1] = epochB;

        this.draw(renderer, this.velocityMaterial, this.vel);
        this.draw(renderer, this.divergenceMaterial, this.pres);
        for (let i = 0; i < this.sweeps; i += 1) this.draw(renderer, this.pressureMaterial, this.pres);
        this.draw(renderer, this.projectMaterial, this.vel);
        this.draw(renderer, this.dyeMaterial, this.dye);
        this.draw(renderer, this.weaveMaterial, this.weave);
    }

    /**
     * Run the whole steps `delta` seconds owe (at most SIM_MAX_STEPS, or `maxSteps`).
     * @returns {number} steps taken
     */
    advance(renderer, delta, prepare, maxSteps = SIM_MAX_STEPS) {
        if (this.disposed) return 0;
        if (!this.live) return this.tick(delta, prepare, maxSteps);
        if (!this.vel) return 0;
        if (this.needsReset) this.reset(renderer, this.clock);
        this.debt += Math.max(0, delta);
        let taken = 0;
        if (this.debt >= SIM_DT) {
            this.rendererState = RendererUtils.resetRendererState(renderer, this.rendererState);
            while (this.debt >= SIM_DT && taken < maxSteps) {
                this.step(renderer, prepare);
                this.debt -= SIM_DT;
                taken += 1;
            }
            RendererUtils.restoreRendererState(renderer, this.rendererState);
            // A frame too slow to keep up drops simulated time instead of owing it.
            if (this.debt >= SIM_DT) this.debt = 0;
        }
        this.setAhead(this.debt);
        return taken;
    }

    /** The clock alone (no solver): whole steps for the event table, the remainder for the picture. */
    tick(delta, prepare, maxSteps) {
        this.debt += Math.max(0, delta);
        let taken = 0;
        while (this.debt >= SIM_DT && taken < maxSteps) {
            this.clock += SIM_DT;
            this.steps += 1;
            this.u.time.value = this.clock;
            prepare?.(this.clock);
            this.debt -= SIM_DT;
            taken += 1;
        }
        if (this.debt >= SIM_DT) this.debt = 0;
        this.setAhead(this.debt);
        return taken;
    }

    getState() {
        return {
            live: this.live,
            grid: `${this.size.width}x${this.size.height}`,
            dye: `${this.size.dyeWidth}x${this.size.dyeHeight}`,
            sweeps: this.sweeps,
            steps: this.steps,
            clock: this.clock,
        };
    }

    disposeTargets() {
        this.vel?.dispose();
        this.pres?.dispose();
        this.dye?.dispose();
        this.weave?.dispose();
        this.vel = null;
        this.pres = null;
        this.dye = null;
        this.weave = null;
    }

    dispose() {
        this.disposed = true;
        this.tVel.value = this.blank;
        this.tPres.value = this.blank;
        this.tDye.value = this.blank;
        this.tWeave.value = this.blank;
        this.disposeTargets();
        this.velocityMaterial.dispose();
        this.divergenceMaterial.dispose();
        this.pressureMaterial.dispose();
        this.projectMaterial.dispose();
        this.dyeMaterial.dispose();
        this.weaveMaterial.dispose();
        this.clearMaterial.dispose();
        this.blank.dispose();
    }
}
