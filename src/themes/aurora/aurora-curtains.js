/**
 * The aurora itself: thin luminous sheets marched through altitude, into a small buffer.
 *
 * Each arc is a level set of a folded footprint field (aurora-field.js) extruded along the
 * field line. A view ray crosses that extrusion somewhere between the lower border and the
 * march ceiling; the march samples the signed distance to the sheet along the ray and
 * integrates the sheet's density ANALYTICALLY between samples (the kernel
 * (1 + x²)^-3/2 has the closed-form antiderivative x / sqrt(1 + x²)). A sheet a few
 * kilometres thick is therefore never stepped over, however coarse the march: every
 * crossing lands at its exact altitude, which is where the sharp lower border, the height
 * colour bands and the bright edge-on folds all come from. Between samples the distance is
 * a cubic Hermite spline built from the field's own gradient, so a ray that only grazes a
 * fold still finds it.
 *
 * The result is soft by nature, so it renders at a fraction of the screen into a buffer
 * mapped by view DIRECTION. The sky dome and the lake both read it by direction: the lake
 * mirrors the display without a second march, and the buffer can refresh below the
 * display rate without lagging behind camera motion.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, abs, clamp, cos, dot, exp, float, fract, inverseSqrt, log2, max, min, mix,
    normalize, pow, screenCoordinate, select, sin, smoothstep, sqrt, texture, uniform,
    uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    AURORA_ARCS, AURORA_GEOMETRY, AURORA_MEANDERS, BILLOW, CORONA_ARC_INDEX, EXCITATION, MEANDER_REACH,
    envelopePhase, meanderPhase,
} from './aurora-field.js';
import { AURORA_COLORS } from './aurora-palette.js';

const { resetRendererState, restoreRendererState } = THREE.RendererUtils;

/** Radiance gathered per kilometre of sheet crossed, before the arc's own gain. */
const BRIGHTNESS = 0.072;
/** Overscan around the camera frustum, so a camera nudge between refreshes stays covered. */
const BUFFER_MARGIN = 0.1;
/** Ray striations: noise tiles per km along the arc (one tile ≈ 150 km). */
const RAY_TILES_PER_KM = 1 / 150;
/** Broad brightness patches: one tile ≈ 780 km. */
const PATCH_TILES_PER_KM = 1 / 780;
/** Threads inside a ray: the same tile, this many times finer. */
const THREAD_SCALE = 3.3;
const NOISE_SIZE = 256;
const LUMA = [0.25, 0.6, 0.15];

const triple = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);
/** Antiderivative of the sheet kernel (1 + x²)^-3/2. */
const kernelIntegral = (x) => x.mul(inverseSqrt(x.mul(x).add(1)));

/**
 * Mean kernel weight over a span where the distance runs linearly from xa to xb, and how
 * far along the span the sheet itself lies (clamped to the nearer end when it is missed).
 */
function spanWeight(xa, fa, xb, fb) {
    const delta = xb.sub(xa).toVar();
    const safe = select(delta.greaterThanEqual(0), max(delta, 0.02), min(delta, -0.02)).toVar();
    const middle = xa.add(xb).mul(0.5);
    const weight = select(
        abs(delta).lessThan(0.02),
        pow(middle.mul(middle).add(1), -1.5),
        fb.sub(fa).div(safe),
    ).toVar();
    return { weight, where: clamp(xa.negate().div(safe), 0, 1) };
}

export class AuroraCurtains {
    /**
     * @param {object} options
     * @param {object} options.preset quality preset (aurora-quality.js)
     * @param {THREE.Texture} options.noiseTexture the shared RGBA noise tile (not owned)
     * @param {import('./aurora-field.js').ExcitationMap} options.excitation director-owned map
     */
    constructor({ preset, noiseTexture, excitation }) {
        this.preset = preset;
        this.noiseTexture = noiseTexture;
        this.excitation = excitation;
        this.hdr = preset.hdrCurtains === true;
        this.disposed = false;
        this.lastRefresh = -Infinity;
        this.rendererState = {};
        // Resting arcs by importance, then the storm corona on top.
        this.arcs = AURORA_ARCS.filter((arc) => arc.index !== CORONA_ARC_INDEX).slice(0, preset.arcCount);
        this.arcs.push(AURORA_ARCS[CORONA_ARC_INDEX]);

        this.excitationTexture = new THREE.DataTexture(
            excitation.data,
            excitation.width,
            excitation.rows,
            THREE.RGBAFormat,
            THREE.UnsignedByteType,
        );
        this.excitationTexture.name = 'Aurora — curtain excitation map';
        this.excitationTexture.magFilter = THREE.LinearFilter;
        this.excitationTexture.minFilter = THREE.LinearFilter;
        this.excitationTexture.wrapS = THREE.ClampToEdgeWrapping;
        this.excitationTexture.wrapT = THREE.ClampToEdgeWrapping;
        this.excitationTexture.generateMipmaps = false;
        this.excitationTexture.colorSpace = THREE.NoColorSpace;
        this.excitationTexture.needsUpdate = true;

        this.uniforms = {
            right: uniform(new THREE.Vector3(1, 0, 0)),
            up: uniform(new THREE.Vector3(0, 1, 0)),
            forward: uniform(new THREE.Vector3(0, 0, -1)),
            tangent: uniform(new THREE.Vector2(1, 0.6)),
            pixelAngle: uniform(0.002),
            tau: uniform(0),
            rayPhase: uniform(0),
            sway: uniform(1),
            height: uniform(1),
            crown: uniform(0.16),
            fringe: uniform(0.08),
            violet: uniform(0.12),
            surge: uniform(0),
            sweep: uniform(new THREE.Vector2(-200, 0)),
            diffuse: uniform(1),
            tint: uniform(new THREE.Vector4(0, 0, 0, 0)),
            arcGain: uniformArray(AURORA_ARCS.map((arc) => arc.gain), 'float'),
            // Per arc, BILLOW.slots travelling waves in the fabric: centre km, amplitude km, 1/width.
            billow: uniformArray(
                Array.from({ length: AURORA_ARCS.length * BILLOW.slots }, () => new THREE.Vector4(0, 0, 0.01, 0)),
                'vec4',
            ),
        };

        this.renderTarget = new THREE.RenderTarget(16, 16, {
            type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            stencilBuffer: false,
            samples: 0,
        });
        this.renderTarget.texture.name = 'Aurora — curtain buffer';
        this.renderTarget.texture.minFilter = THREE.LinearFilter;
        this.renderTarget.texture.magFilter = THREE.LinearFilter;
        this.renderTarget.texture.generateMipmaps = false;

        this.material = new THREE.NodeMaterial();
        this.material.name = 'Aurora — curtain march';
        this.material.depthTest = false;
        this.material.depthWrite = false;
        this.material.fragmentNode = this.buildMarch();
        this.quad = new THREE.QuadMesh(this.material);
        this.quad.name = 'Aurora — curtain march quad';
    }

    /** Range-compress radiance for the RGBA8 buffer; identity for half-float. */
    encode(radiance) {
        if (this.hdr) return radiance;
        const compressed = sqrt(radiance.div(radiance.add(1)));
        // Half a quantisation step of ordered noise hides the banding of faint veils.
        const pixel = screenCoordinate.xy.floor();
        const grain = fract(sin(dot(pixel, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5).div(255);
        return clamp(compressed.add(grain), 0, 1);
    }

    decode(stored) {
        if (this.hdr) return stored;
        const squared = min(stored.mul(stored), 0.985);
        return squared.div(squared.oneMinus());
    }

    buildMarch() {
        const u = this.uniforms;
        const G = AURORA_GEOMETRY;
        const { noiseTexture } = this;
        return Fn(() => {
            const ndc = uv().mul(2).sub(1);
            const rd = normalize(
                u.forward.add(u.right.mul(ndc.x.mul(u.tangent.x))).add(u.up.mul(ndc.y.mul(u.tangent.y))),
            ).toVar();
            const light = vec3(0).toVar();
            If(rd.y.greaterThan(0.01), () => {
                // Distance along the ray to an altitude above a curved Earth:
                // h(t) = t·sinθ + t²·cos²θ / 2R, solved in the form that stays stable at zenith.
                const curve = rd.y.mul(rd.y).oneMinus().div(2 * G.earthRadius).toVar();
                const reach = (altitude) => float(2 * altitude)
                    .div(rd.y.add(sqrt(rd.y.mul(rd.y).add(curve.mul(4 * altitude)))));
                const tNear = reach(G.baseAltitude - G.floorMargin).toVar();
                const tFar = reach(G.topAltitude).toVar();
                for (const arc of this.arcs) {
                    this.marchArc(arc, {
                        rd, curve, tNear, tFar, light,
                    });
                }

                // Diffuse aurora: a broad, slowly drifting veil between the arcs, and the
                // glow of displays beyond the horizon.
                const veilPoint = rd.xz.mul(reach(125));
                const veilUV = veilPoint.div(1500).add(vec2(u.tau.mul(0.0031), u.tau.mul(-0.0017)));
                const veil = texture(noiseTexture, veilUV).level(0);
                const veilShape = smoothstep(0.2, 0.95, veil.b).mul(veil.a.mul(0.7).add(0.3));
                const veilBand = smoothstep(0.02, 0.22, rd.y).mul(smoothstep(0.55, 0.98, rd.y).oneMinus());
                const cool = triple(AURORA_COLORS.greenCool);
                const warm = triple(AURORA_COLORS.greenWarm);
                light.addAssign(cool.mul(veilShape.mul(veilBand).mul(u.diffuse).mul(0.022)));
                light.addAssign(mix(warm, cool, 0.45).mul(exp(rd.y.mul(-8.5)).mul(u.diffuse).mul(0.06)));

                // Atmosphere: long slanted paths dim and redden toward the horizon.
                const airmass = float(1).div(rd.y.add(exp(rd.y.mul(-11)).mul(0.025)));
                light.mulAssign(exp(airmass.mul(vec3(-0.05, -0.042, -0.085))));
                light.mulAssign(smoothstep(0.01, 0.05, rd.y));
            });
            // Compress highlights along their own hue, so the brightest folds saturate
            // toward their colour instead of clipping to white further down the chain.
            light.divAssign(dot(light, vec3(LUMA[0], LUMA[1], LUMA[2])).mul(0.3).add(1));
            return vec4(this.encode(min(light, 16)), 1);
        })();
    }

    marchArc(arc, {
        rd, curve, tNear, tFar, light,
    }) {
        const u = this.uniforms;
        const G = AURORA_GEOMETRY;
        const steps = this.preset.marchSteps;
        const { noiseTexture, excitationTexture } = this;
        const row = (arc.index + 0.5) / this.excitation.rows;
        const rayTiles = RAY_TILES_PER_KM * arc.rays;
        const gain = u.arcGain.element(arc.index);

        // Footprint of the ray point at distance t, altitude h, slid back down the leaning
        // field line to the lower border: along = t·a − (h − h0)·leanAlong, likewise across.
        const along = rd.x.mul(arc.tangentX).add(rd.z.mul(arc.tangentZ)).toVar();
        const across = rd.x.mul(arc.normalX).add(rd.z.mul(arc.normalZ)).toVar();

        // The sheet can only be within `band` km of its resting line, and across(t) is close
        // to linear, so march just that slice of the ray. Rays that never enter it skip the
        // arc outright — most of the sky, for any one arc.
        const rate = across.sub(rd.y.mul(arc.leanAcross));
        const safeRate = select(abs(rate).lessThan(1e-4), float(1e-4), rate);
        const offset = arc.leanAcross * G.baseAltitude - arc.distance;
        const band = u.sway.mul(MEANDER_REACH * arc.sway).add(BILLOW.maxAmplitude * BILLOW.slots + arc.width * 8);
        const enter = band.negate().sub(offset).div(safeRate);
        const leave = band.sub(offset).div(safeRate);
        const lo = max(tNear, min(enter, leave)).toVar();
        const hi = min(tFar, max(enter, leave)).toVar();

        If(hi.greaterThan(lo).and(gain.greaterThan(0.002)), () => {
            const dt = hi.sub(lo).div(steps).toVar();
            const prevX = float(0).toVar();
            const prevF = float(0).toVar();
            const prevM = float(0).toVar();
            const prevH = float(0).toVar();
            const prevS = float(0).toVar();
            const prevT = float(0).toVar();
            const prevGlow = vec3(0).toVar();
            const sum = vec3(0).toVar();

            Loop(steps + 1, ({ i }) => {
                const t = lo.add(dt.mul(float(i))).toVar();
                const h = t.mul(rd.y).add(t.mul(t).mul(curve)).toVar();
                const lift = h.sub(G.baseAltitude);
                const s = t.mul(along).sub(lift.mul(arc.leanAlong)).toVar();
                const q = t.mul(across).sub(lift.mul(arc.leanAcross)).sub(arc.distance).toVar();

                const level = q.toVar();
                const gradAcross = float(1).toVar();
                const gradAlong = float(0).toVar();
                for (const term of AURORA_MEANDERS) {
                    const envelope = sin(s.mul(term.envelopeKappa).add(envelopePhase(term, arc))).mul(0.28).add(0.72);
                    const amplitude = u.sway.mul(term.amp * arc.sway).mul(envelope);
                    const argument = s.mul(term.kappa).add(q.mul(term.shear))
                        .add(u.tau.mul(term.speed)).add(meanderPhase(term, arc));
                    const cosine = cos(argument);
                    level.addAssign(amplitude.mul(sin(argument)));
                    if (term.shear !== 0) gradAcross.addAssign(amplitude.mul(term.shear).mul(cosine));
                    gradAlong.addAssign(amplitude.mul(term.kappa).mul(cosine));
                }
                // Billows: travelling waves in the fabric itself. Analytic like the folds,
                // gradient included, so the spline below follows them exactly.
                for (let slot = 0; slot < BILLOW.slots; slot += 1) {
                    const wave = u.billow.element(arc.index * BILLOW.slots + slot);
                    const reach = s.sub(wave.x).mul(wave.z).toVar();
                    const bell = exp(reach.mul(reach).negate()).mul(wave.y).mul(BILLOW.normalise).toVar();
                    level.subAssign(reach.mul(bell));
                    gradAlong.addAssign(bell.mul(wave.z).mul(reach.mul(reach).mul(2).sub(1)));
                }
                const pulse = texture(excitationTexture, vec2(s.div(G.spanKm).add(0.5), row)).level(0).toVar();

                // Signed distance to the sheet in units of its thickness (x), the kernel's
                // antiderivative there (f), and the distance's slope along the ray (m),
                // scaled to one march segment for the Hermite spline below.
                const perKm = inverseSqrt(max(gradAcross.mul(gradAcross).add(gradAlong.mul(gradAlong)), 0.08))
                    .div(arc.width).toVar();
                const x = level.mul(perKm).toVar();
                const f = kernelIntegral(x).toVar();
                const climb = t.mul(curve).mul(2).add(rd.y);
                const m = gradAcross.mul(across.sub(climb.mul(arc.leanAcross)))
                    .add(gradAlong.mul(along.sub(climb.mul(arc.leanAlong))))
                    .mul(perKm).mul(dt)
                    .toVar();

                If(i.greaterThan(0), () => {
                    // Four spans per segment along the Hermite spline of the distance.
                    // Each span that touches the sheet evaluates the emission where it
                    // touches, so a ray running inside a fold still resolves the vertical
                    // profile and the rays along its whole path.
                    const spanX = prevX.toVar();
                    const spanF = prevF.toVar();
                    const stride = s.sub(prevS).abs().mul(0.25 * rayTiles * NOISE_SIZE).toVar();
                    Loop(4, ({ i: span }) => {
                        const v = float(span).add(1).mul(0.25).toVar();
                        const v2 = v.mul(v).toVar();
                        const v3 = v2.mul(v).toVar();
                        const nextX = prevX.mul(v3.mul(2).sub(v2.mul(3)).add(1))
                            .add(prevM.mul(v3.sub(v2.mul(2)).add(v)))
                            .add(x.mul(v2.mul(3).sub(v3.mul(2))))
                            .add(m.mul(v3.sub(v2)))
                            .toVar();
                        const nextF = kernelIntegral(nextX).toVar();
                        const hit = spanWeight(spanX, spanF, nextX, nextF);
                        If(hit.weight.greaterThan(0.003), () => {
                            const where = float(span).add(hit.where).mul(0.25).toVar();
                            const hs = mix(prevH, h, where);
                            const ss = mix(prevS, s, where).toVar();
                            const ts = mix(prevT, t, where);
                            const glow = mix(prevGlow, pulse.rgb, where).mul(EXCITATION.maxGlow).toVar();
                            // How far a passing pulse has taken over this stretch of curtain,
                            // and the pulse's own pure hue.
                            const peak = max(max(glow.r, glow.g), max(glow.b, 1e-4)).toVar();
                            const excited = clamp(peak.mul(1.15), 0, 1).toVar();
                            // Lifted to the green's own luminance: a blue or violet pulse must
                            // read as strongly as a lime one, not as a dim patch in the curtain.
                            const pure = glow.div(peak).toVar();
                            const hue = pure.mul(float(0.66).div(max(dot(pure, vec3(LUMA[0], LUMA[1], LUMA[2])), 0.2)));

                            // Rays: striations along the arc that stay put in altitude. The
                            // mip level follows whichever is coarser — a buffer pixel's
                            // footprint or this span's stride along the arc — so distant
                            // and edge-on rays blend into an even glow instead of aliasing.
                            const texelsPerPixel = ts.mul(u.pixelAngle).mul(rayTiles * NOISE_SIZE);
                            const rayUV = vec2(
                                ss.mul(rayTiles).add(u.rayPhase.mul(arc.drift)).add(arc.seed),
                                ss.mul(0.00037).add(u.tau.mul(0.0021)).add(arc.seed * 0.37 + 0.11),
                            );
                            const fine = texture(noiseTexture, rayUV)
                                .level(log2(max(max(texelsPerPixel, stride), 1))).toVar();
                            const broadUV = vec2(
                                ss.mul(PATCH_TILES_PER_KM).add(u.rayPhase.mul(arc.drift * 0.085)).add(arc.seed * 1.7),
                                u.tau.mul(0.0037).add(arc.seed * 0.53),
                            );
                            const broad = texture(noiseTexture, broadUV).level(0).toVar();

                            const rays = smoothstep(0.28, 0.76, fine.r).toVar();
                            // A near arc is close enough to show the threads inside each ray.
                            const threads = arc.distance < 260
                                ? texture(noiseTexture, rayUV.mul(THREAD_SCALE).add(0.37))
                                    .level(log2(max(max(texelsPerPixel, stride).mul(THREAD_SCALE), 1))).r
                                : fine.g;
                            const striation = mix(0.16, 1, rays).mul(mix(0.6, 1, smoothstep(0.25, 0.75, threads)));
                            const patch = mix(0.3, 1.35, smoothstep(0.18, 0.82, broad.a));
                            // A few rays stand far taller than the rest; bright ones reach higher.
                            const tall = pow(clamp(fine.b.mul(0.5).add(broad.b.mul(0.62)).sub(0.14), 0, 1), 2.6).toVar();

                            // Vertical profile above a border that undulates, and dips where
                            // an energetic pulse digs deeper into the atmosphere.
                            const border = broad.b.sub(0.5).mul(10).add(fine.g.sub(0.5).mul(3))
                                .add(G.baseAltitude)
                                .sub(excited.mul(7));
                            const xh = hs.sub(border).toVar();
                            const above = max(xh, 0).toVar();
                            const rise = smoothstep(-1, 3.2, xh);
                            const scale = tall.mul(74).add(rays.mul(9)).add(10)
                                .mul(arc.height)
                                .mul(u.height)
                                .mul(excited.mul(0.45).add(1))
                                .toVar();
                            const green = rise.mul(exp(above.div(scale).negate())).toVar();
                            const hem = green.mul(exp(above.div(-9))).mul(rays);
                            // The red crown belongs to the thin air above the green: it only
                            // shows where the green has already faded, never as a muddy mix.
                            const crownStart = scale.mul(1.5).toVar();
                            const crownScale = scale.mul(1.9).add(46).toVar();
                            const crown = smoothstep(crownStart.mul(0.6), crownStart.mul(1.7), above)
                                .mul(exp(max(above.sub(crownStart.mul(1.7)), 0).div(crownScale).negate()))
                                .mul(u.crown).mul(tall.mul(0.7).add(0.3));
                            const fringe = smoothstep(-2, 0.6, xh).mul(exp(above.div(-8)))
                                .mul(u.fringe).mul(rays.mul(0.55).add(0.45));
                            const violet = smoothstep(scale.mul(1.4), scale.mul(3.4), above)
                                .mul(exp(max(above.sub(scale.mul(3.4)), 0).div(crownScale.mul(1.3)).negate()))
                                .mul(u.violet).mul(tall);

                            // A pulse does not pile light onto the curtain: it turns the
                            // curtain its own colour and lifts it a little. Colour and shape
                            // carry every event, so the display never flashes white.
                            // The corona is its own colour: lavender rays over the green arcs.
                            const resting = arc.index === CORONA_ARC_INDEX
                                ? mix(triple(AURORA_COLORS.greenCool), triple(AURORA_COLORS.corona), 0.6)
                                : mix(triple(AURORA_COLORS.greenWarm), triple(AURORA_COLORS.greenCool), broad.a);
                            const body = mix(
                                mix(resting, u.tint.rgb, u.tint.a),
                                hue,
                                excited.mul(0.85),
                            );
                            const sweepOffset = xh.sub(u.sweep.x).div(46);
                            const sweep = exp(sweepOffset.mul(sweepOffset).negate()).mul(u.sweep.y);
                            const emission = body.mul(green.mul(excited.mul(0.4).add(1)))
                                .add(mix(vec3(0.5, 0.36, 0.24), hue, excited.mul(0.6)).mul(hem.mul(0.55)))
                                .add(triple(AURORA_COLORS.crown).mul(crown))
                                .add(triple(AURORA_COLORS.fringe).mul(fringe))
                                .add(triple(AURORA_COLORS.violet).mul(violet))
                                .mul(striation.mul(patch).mul(u.surge.mul(0.3).add(1).add(sweep.mul(0.6))))
                                .mul(excited.mul(rays).mul(0.25).add(1));
                            sum.addAssign(emission.mul(hit.weight.mul(dt).mul(0.25)));
                        });
                        spanX.assign(nextX);
                        spanF.assign(nextF);
                    });
                });

                prevX.assign(x);
                prevF.assign(f);
                prevM.assign(m);
                prevH.assign(h);
                prevS.assign(s);
                prevT.assign(t);
                prevGlow.assign(pulse.rgb);
            });
            light.addAssign(sum.mul(gain.mul(BRIGHTNESS)));
        });
    }

    /**
     * Aurora radiance seen along a world direction. Zero outside the buffered frustum
     * and behind the camera. Safe in non-uniform control flow (explicit mip level).
     */
    sample(direction) {
        const u = this.uniforms;
        const depth = dot(direction, u.forward);
        const safeDepth = max(depth, 1e-4);
        const coord = vec2(
            dot(direction, u.right).div(safeDepth.mul(u.tangent.x)),
            dot(direction, u.up).div(safeDepth.mul(u.tangent.y)),
        );
        const edge = max(abs(coord.x), abs(coord.y));
        const inside = smoothstep(0.96, 1, edge).oneMinus().mul(smoothstep(0, 0.02, depth));
        const stored = texture(this.renderTarget.texture, coord.mul(0.5).add(0.5)).level(0);
        return this.decode(stored.rgb).mul(inside);
    }

    setSize(width, height) {
        if (this.disposed || !(width > 0) || !(height > 0)) return;
        const scale = this.preset.curtainScale;
        const w = Math.max(64, Math.round(width * scale));
        const h = Math.max(64, Math.round(height * scale));
        if (this.renderTarget.width !== w || this.renderTarget.height !== h) {
            this.renderTarget.setSize(w, h);
            this.lastRefresh = -Infinity;
        }
    }

    /** True when the buffer is due under this tier's refresh cap. */
    due(time) {
        return !(time - this.lastRefresh < 1 / this.preset.curtainHz - 1e-4) || time < this.lastRefresh;
    }

    /** March the display for `camera` into the buffer. Call before the scene renders. */
    render(renderer, camera, time = 0) {
        if (this.disposed) return;
        const u = this.uniforms;
        camera.updateMatrixWorld();
        const e = camera.matrixWorld.elements;
        u.right.value.set(e[0], e[1], e[2]).normalize();
        u.up.value.set(e[4], e[5], e[6]).normalize();
        u.forward.value.set(-e[8], -e[9], -e[10]).normalize();
        const tangentY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (1 + BUFFER_MARGIN);
        u.tangent.value.set(tangentY * camera.aspect, tangentY);
        u.pixelAngle.value = (2 * tangentY) / this.renderTarget.height;
        if (this.excitation.commit()) this.excitationTexture.needsUpdate = true;
        this.lastRefresh = time;

        resetRendererState(renderer, this.rendererState);
        renderer.setRenderTarget(this.renderTarget);
        this.quad.render(renderer);
        restoreRendererState(renderer, this.rendererState);
    }

    getDiagnostics() {
        return {
            arcs: this.arcs.map((arc) => arc.id),
            marchSteps: this.preset.marchSteps,
            buffer: [this.renderTarget.width, this.renderTarget.height],
            hdr: this.hdr,
            refreshHz: this.preset.curtainHz,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.renderTarget.dispose();
        this.material.dispose();
        this.excitationTexture.dispose();
        this.noiseTexture = null;
    }
}
