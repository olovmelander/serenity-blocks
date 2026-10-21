/**
 * Grainfields — the storm deck as a volume.
 *
 * The deck is a layer of cloud from its base (DECK.base) up to a top that is as high as the
 * hour's cover makes it (a heavy storm towers, a broken golden-hour sky is a field of separate
 * heaps). Over the deck's own cover (deckCover: the same field the land's shadows, the shafts and
 * the gameplay's gaps read) the cloud is heaped into rounded heads with lumps on them, so where
 * the deck breaks it parts into cumulus with cauliflower edges, not paper cut-outs.
 *
 * Each frame the view rays are marched through the layer at reduced resolution into a target of
 * their own (in-scattered light, and how much of the sky behind still shows), and the dome draws
 * it over the sky: the walls of every gap stand up in depth, lit on the sun's side and dark on
 * the other; thin cloud toward the sun glows (a silver lining); a low sun, or one just under the
 * horizon, lights the bases from below (the dusk's rose undersides); the bases are dark where
 * the cloud is thick and catch the gold of the fields; far away the deck goes into the haze.
 *
 * The light of a sample: the sun through the cloud between it and the sun (one sample of the
 * layer half-way along the sun's ray, plus what lies above or below it), two lobes of scattering
 * (forward through the cloud, a little back), a share that has scattered many times, the sky's
 * light from above and the fields' from below.
 */
import * as THREE from 'three/webgpu';
import {
    Break,
    Fn,
    If,
    Loop,
    abs,
    clamp,
    dot,
    exp,
    float,
    int,
    interleavedGradientNoise,
    max,
    min,
    mix,
    normalize,
    screenCoordinate,
    select,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DECK } from './grainfields-core.js';
import { deckCover, deckPoint, gfCells } from './grainfields-tsl.js';

/** How far the march looks into the layer (metres along the ray): beyond, the haze has it. */
export const CLOUD_RANGE = 26000;
/** The layer's tallest heaps (metres above the base) at full cover, and at a broken sky. */
export const CLOUD_DEPTH = Object.freeze({ storm: 1700, broken: 750 });
/** Extinction per metre at full density: of the view's ray, and of the sun's through the cloud. */
const SIGMA_VIEW = 0.0024;
const SIGMA_SUN = 0.0034;

/** The layer's depth (metres) for the hour's cover. */
export const cloudDepth = (u) => mix(float(CLOUD_DEPTH.broken), float(CLOUD_DEPTH.storm), smoothstep(0.4, 0.95, u.cover));

/**
 * Billows on a heap's edge: how deep the finer lumps (CLOUD_BILLOW.size metres across) bite into
 * a thin margin, and how far in from the edge they reach (as thickness).
 */
export const CLOUD_BILLOW = Object.freeze({ size: 6400, bite: 0.42, reach: 0.8 });
/** The deck cover's margin as the volume reads it (deckCover's `edge`): soft, but not a blur. */
export const CLOUD_EDGE = 1.6;
/**
 * How crisp a heap's edge is drawn by the march's stride (metres between its samples): fully
 * below `near`, soft beyond `far`; `margin` the density's ramp (as thickness) crisp and soft.
 */
export const CLOUD_CRISP = Object.freeze({ near: 220, far: 700, margin: Object.freeze([0.16, 0.3]) });

/**
 * The cloud's thickness at a point of the deck plane (0 clear .. 1 the layer's full depth): the
 * deck's cover (with a soft margin) heaped into heads. Returns { thick, lump }. `billows` (a
 * node, 0..1): how far the heads' edges are broken into rounded lumps (the view's samples, less
 * where the march's steps are too long to see them; the sun's rays through the cloud do not need
 * them).
 */
export function cloudThickness(u, noise, xz, { billows = null } = {}) {
    const c = deckCover(u, noise, xz, { edge: CLOUD_EDGE });
    const q = deckPoint(u, noise, xz);
    const heads = float(1.0).sub(smoothstep(0.06, 0.95, gfCells(q.div(1500.0)).x));
    const lump = texture(noise, q.div(3300.0).add(vec2(0.37, 0.61))).b;
    const shape = heads.mul(0.6).add(lump.mul(0.4));
    // Where the deck is solid it is one deep mass, deeper under the heads and thinner along the
    // seams between them; where it breaks it parts into separate heads.
    const thick = c.mul(shape.mul(0.75).add(0.42)).sub(float(1.0).sub(c).mul(float(1.0).sub(shape)).mul(0.3)).toVar();
    if (billows) {
        // A cumulus' margin is lumps on lumps, not a soft blur: the finer billows bite the thin
        // edge away in rounded bays and leave the heart whole.
        const B = CLOUD_BILLOW;
        const billow = texture(noise, q.div(B.size).add(vec2(0.71, 0.13))).b;
        const margin = float(1.0).sub(smoothstep(0.05, B.reach, thick));
        thick.subAssign(float(1.0).sub(billow).mul(B.bite).mul(margin)
            .mul(billows));
    }
    return { thick: clamp(thick, 0.0, 1.0), lump };
}

/** Two lobes of scattering for the cosine between the view and the light (1 for no preference). */
function phase(mu) {
    const hg = (g) => {
        const g2 = g * g;
        const denom = float(1 + g2).sub(mu.mul(2 * g)).max(1e-3);
        return float(1 - g2).div(denom.mul(denom.sqrt()));
    };
    return hg(0.6).mul(0.7).add(hg(-0.2).mul(0.3));
}

/**
 * The march: a target at `scale` of the drawing buffer, a quad that fills it, and render(renderer,
 * camera) to be called once a frame before the scene. `steps` samples along a ray.
 */
export function createCloudMarch(u, t, { steps = 18, scale = 0.5 } = {}) {
    const target = new THREE.RenderTarget(16, 16, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    target.texture.name = 'grainfields-clouds';
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    target.texture.generateMipmaps = false;
    u.cloudSteps.value = steps;
    const invViewProj = uniform(new THREE.Matrix4());
    const texel = uniform(new THREE.Vector2(1 / 640, 1 / 360));
    const material = new THREE.NodeMaterial();
    material.name = 'GrainfieldsCloudMarch';
    material.depthTest = false;
    material.depthWrite = false;
    material.fragmentNode = Fn(() => {
        const st = uv();
        // The quad's v runs down the target, as the screen's does.
        const far = invViewProj.mul(vec4(st.x.mul(2.0).sub(1.0), float(1.0).sub(st.y.mul(2.0)), 1.0, 1.0));
        const dir = normalize(far.xyz.div(far.w).sub(u.eye)).toVar();
        const light = vec3(0.0).toVar();
        const clear = float(1.0).toVar();
        If(dir.y.greaterThan(0.004), () => {
            const depth = cloudDepth(u).toVar();
            const near = float(DECK.base).sub(u.eye.y).div(dir.y).toVar();
            const span = min(depth.div(dir.y), float(CLOUD_RANGE)).toVar();
            const stride = span.div(float(u.cloudSteps)).toVar();
            // Crisp edges and billows only where the steps are short enough to draw them: steps a
            // kilometre long through a sharp edge band into stripes (the far deck stays soft).
            const crisp = float(1.0).sub(smoothstep(CLOUD_CRISP.near, CLOUD_CRISP.far, stride)).toVar();
            const margin = mix(float(CLOUD_CRISP.margin[1]), float(CLOUD_CRISP.margin[0]), crisp).toVar();
            const reach = near.add(stride.mul(interleavedGradientNoise(screenCoordinate.xy))).toVar();
            // The light that reaches the layer: the sun by day; at dusk the afterglow from under the
            // horizon (it lights the bases); never quite level.
            const L = normalize(vec3(u.sunDir.x, max(u.sunDir.y, -0.08), u.sunDir.z)).toVar();
            const strength = u.sunUp.mul(0.85).add(float(1.0).sub(u.day).mul(0.45)).add(0.15).toVar();
            const scatter = phase(clamp(dot(dir, L), -1.0, 1.0)).toVar();
            // Far away the cloud goes into the air in front of it.
            const air = mix(u.horizon, u.haze, 0.35).toVar();
            // Under a heavy overcast the deck is slate: little of the sky's light comes through it.
            const overcast = smoothstep(0.7, 0.95, u.cover).toVar();
            Loop({
                start: int(0), end: u.cloudSteps, type: 'int', condition: '<', name: 'cs',
            }, () => {
                If(clear.lessThan(0.015), () => {
                    Break();
                });
                const P = u.eye.add(dir.mul(reach)).toVar();
                const h = P.y.sub(DECK.base).div(depth).toVar();
                const cloud = cloudThickness(u, t.noise, P.xz, { billows: crisp });
                // Inside under the heap's top (its crown lumpy), above a soft flat base; the margin a
                // few tens of metres deep where the steps can see it, so a heap has an edge.
                const dens = smoothstep(0.0, margin, cloud.thick.sub(h.mul(cloud.lump.mul(0.3).add(0.85))))
                    .mul(smoothstep(-0.04, 0.08, h)).toVar();
                If(dens.greaterThan(0.004), () => {
                    // Toward the light: the layer half-way along its ray through what is left of the
                    // cloud above (or below, for a light from under the horizon).
                    const rise = select(L.y.greaterThan(0.0), float(1.0).sub(h), h).mul(depth).toVar();
                    const run = min(rise.div(max(abs(L.y), 0.06)), 1800.0).toVar();
                    // Two samples along it (one alone strings the gaps' edges out into streaks).
                    const inside = float(0.0).toVar();
                    Loop({
                        start: int(1), end: int(3), type: 'int', condition: '<', name: 'ls',
                    }, ({ ls }) => {
                        const k = float(ls).mul(0.36).sub(0.08);
                        const aside = cloudThickness(u, t.noise, P.xz.add(L.xz.mul(run.mul(k)))).thick;
                        const hAt = h.add(L.y.mul(run.mul(k)).div(depth));
                        inside.addAssign(clamp(aside.sub(hAt), 0.0, 1.0).mul(depth).mul(0.6));
                    });
                    inside.addAssign(dens.mul(rise).mul(0.6));
                    const od = inside.mul(SIGMA_SUN);
                    // Straight through, and a share that has scattered many times (it never goes black).
                    const direct = exp(od.negate()).mul(scatter).add(exp(od.mul(-0.15)).mul(0.1));
                    // The hour's own cloud colours: the lit side and the shade, the shade paler toward
                    // the tops (the sky's light) and warm at the bases (the fields' gold); and the sky's
                    // light through the cloud above, so a thin seam is paler than a deep heart.
                    const above = cloud.thick.sub(h).max(0.0).mul(depth);
                    const skylight = u.zenith.mul(1.2).add(u.fill.mul(0.8)).add(u.horizon.mul(0.25))
                        .mul(exp(above.mul(-0.0011)))
                        .mul(float(1.0).sub(overcast.mul(0.62)));
                    const shade = mix(
                        u.cloudShade.add(u.bounce.mul(0.5)),
                        u.cloudShade.mul(2.2).add(u.fill.mul(0.5)),
                        clamp(h.mul(1.4), 0.0, 1.0),
                    ).add(skylight.mul(0.5))
                        .mul(float(1.0).sub(cloud.thick.mul(overcast).mul(0.3)));
                    // (The storm's torn walls catch the sun the brighter for the dark around them.)
                    const lit = u.cloudLit.mul(direct).mul(strength).mul(overcast.mul(0.35).add(0.62));
                    const veil = exp(reach.div(-34000.0));
                    const sample = mix(air, shade.add(lit), veil);
                    const cover = float(1.0).sub(exp(dens.mul(stride).mul(SIGMA_VIEW).negate()));
                    light.addAssign(sample.mul(cover).mul(clear));
                    clear.mulAssign(cover.oneMinus());
                });
                reach.addAssign(stride);
            });
            // No hard line at the horizon.
            const rise = smoothstep(0.004, 0.03, dir.y);
            light.mulAssign(rise);
            clear.assign(mix(float(1.0), clear, rise));
        });
        return vec4(light, clear);
    })();
    const quad = new THREE.QuadMesh(material);
    quad.name = 'GrainfieldsCloudMarchQuad';
    const size = { width: 0, height: 0 };
    const drawing = new THREE.Vector2();

    return {
        target,
        texel,
        material,
        /** The march's result for a screen position (vec2 0..1, y down): a tent of four taps. */
        sample(screen) {
            const tap = (x, y) => texture(target.texture, screen.add(texel.mul(vec2(x, y))));
            return tap(-0.5, -0.5).add(tap(0.5, -0.5)).add(tap(-0.5, 0.5)).add(tap(0.5, 0.5))
                .mul(0.25);
        },
        setSize(width, height) {
            if (!(width > 0) || !(height > 0)) return;
            const w = Math.max(16, Math.round(width * scale));
            const h = Math.max(16, Math.round(height * scale));
            if (w === size.width && h === size.height) return;
            size.width = w;
            size.height = h;
            target.setSize(w, h);
            texel.value.set(1 / w, 1 / h);
        },
        render(renderer, camera) {
            if (!renderer || !camera) return;
            this.setSize(...renderer.getDrawingBufferSize(drawing).toArray());
            camera.updateMatrixWorld();
            invViewProj.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
            const previous = renderer.getRenderTarget();
            try {
                renderer.setRenderTarget(target);
                quad.render(renderer);
            } finally {
                renderer.setRenderTarget(previous);
            }
        },
        dispose() {
            target.dispose();
            material.dispose();
        },
    };
}
