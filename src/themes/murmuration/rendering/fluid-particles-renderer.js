/* eslint-disable import/no-unresolved */
/**
 * Murmuration — the swarm renderer.
 *
 * Every mote is one camera-facing quad, drawn additively. Position, velocity and light are
 * read straight from the simulation's buffers (storage on WebGPU, instanced attributes on
 * WebGL2), so nothing crosses from the CPU per frame on the native path.
 *
 * What a mote's quad does:
 *   COLOUR   — looked up in a cyclic palette by WHERE the mote is, not which mote it is.
 *              Neighbours share a hue, so colour runs through the swarm in bands instead
 *              of speckling it; the bands drift with time and step on with each level. In
 *              a formation the hue runs across the figure instead of across the frame.
 *   STREAK   — the quad stretches along the mote's screen-space velocity: fast water
 *              draws lines, still water draws points.
 *   FOCUS    — a thin-lens blur circle from the mote's distance to the focal plane. A
 *              mote out of focus grows into a soft disc and dims by its area, so the wing
 *              of the swarm that swims toward the lens becomes bokeh.
 *   SIZE     — a power-law size class per mote, a floor of about a pixel (smaller motes
 *              keep their energy but stop shimmering), and a few "hero" motes that carry
 *              a four-point glint.
 *
 * The material writes the same light to the emissive target, which is what the selective
 * bloom reads on the native path.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    instanceIndex,
    int,
    length,
    max,
    min,
    mix,
    positionLocal,
    sin,
    smoothstep,
    step,
    storage,
    uniform,
    uniformArray,
    uv,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    FIRE, HEAT_EXPONENT, PALETTE_SPAN, SWARM_PALETTE,
} from '../composition/swarm-palette.js';

/** World-space radius of a median mote at sizeMul 1. */
const BASE_PARTICLE_SIZE = 0.023;
/** A hero mote's quad is this many core radii wide, to make room for the glint's arms. */
const HERO_QUAD = 3.4;
/** The longest trail a mote draws, in its own radii. */
const TRAIL_CAP = 12;
/**
 * The turn (a ripple of banking that runs through the flock): one every TURN_PERIOD seconds,
 * crossing in the first TURN_CROSSING of it, from TURN_REACH world units one side of the
 * swarm's middle to as far the other; its lit fold is about TURN_WIDTH wide.
 */
const TURN_PERIOD = 6.5;
const TURN_CROSSING = 0.6;
const TURN_REACH = 13;
const TURN_WIDTH = 0.75;

const PALETTE_STOPS = SWARM_PALETTE.length;

/**
 * The colour `k` of the way from `cA` to `cB`, turning the hue in the direction of rising
 * hue (red → yellow → green → cyan → blue → magenta → red) and easing chroma and level
 * between the two. Hue here is the angle of the colour about the grey axis.
 */
const turnHue = /* @__PURE__ */ Fn(([cA, cB, k]) => {
    const mFrom = cA.r.add(cA.g).add(cA.b).div(3.0);
    const mTo = cB.r.add(cB.g).add(cB.b).div(3.0);
    const xFrom = cA.r.sub(mFrom).mul(1.5);
    const yFrom = cA.g.sub(cA.b).mul(0.8660254);
    const xTo = cB.r.sub(mTo).mul(1.5);
    const yTo = cB.g.sub(cB.b).mul(0.8660254);
    const hFrom = atan(yFrom, xFrom).toVar();
    const span = fract(atan(yTo, xTo).sub(hFrom).div(6.2831853)).mul(6.2831853);
    const angle = hFrom.add(span.mul(k)).toVar();
    const chroma = mix(length(vec2(xFrom, yFrom)), length(vec2(xTo, yTo)), k).toVar();
    const m = mix(mFrom, mTo, k).toVar();
    const x = cos(angle).mul(chroma).toVar();
    const y = sin(angle).mul(chroma).toVar();
    return max(vec3(
        m.add(x.mul(2.0 / 3.0)),
        m.sub(x.div(3.0)).add(y.mul(0.5773503)),
        m.sub(x.div(3.0)).sub(y.mul(0.5773503)),
    ), vec3(0.0));
}).setLayout({
    name: 'murm_turnHue',
    type: 'vec3',
    inputs: [{ name: 'cA', type: 'vec3' }, { name: 'cB', type: 'vec3' }, { name: 'k', type: 'float' }],
});

export function createFluidParticlesRenderer(sim, options = {}) {
    const { count } = sim;
    const positionBuffer = sim.getPositionBuffer();
    const velocityBuffer = sim.getVelocityBuffer();
    const colorBuffer = sim.getColorBuffer();

    const geometry = new THREE.PlaneGeometry(1, 1);

    // ─── Uniforms ───
    const uTime = uniform(0);
    const uSizeMul = uniform(options.sizeMul ?? 1.0);
    const uEmissiveMul = uniform(options.emissiveMul ?? 1.0);
    const uExposure = uniform(options.exposure ?? 1.0);
    // Pixels per world unit at view distance 1 (= viewport height / (2 tan(fov/2))).
    const uPixelScale = uniform(900);
    const uFocusDistance = uniform(options.focusDistance ?? 16.5);
    const uAperture = uniform(options.aperture ?? 0.02);
    const uMaxBlur = uniform(options.maxBlur ?? 0.3);
    const uStretch = uniform(options.stretch ?? 0.05);
    const uHeat = uniform(0);
    const uPalette = uniformArray(SWARM_PALETTE.map((c) => new THREE.Vector3(c[0], c[1], c[2])), 'vec3');
    const uPalettePhase = uniform(options.palettePhase ?? 0);
    // Fraction of the palette cycle spanned across the swarm's width.
    const uPaletteSpan = uniform(options.paletteSpan ?? PALETTE_SPAN);
    const uPaletteAxis = uniform(new THREE.Vector3(0.062, 0.05, 0.03));
    // 0 = colour by place in the frame (free swarm); 1 = colour by place in the figure.
    const uShapeColor = uniform(0);
    // The simulation's twin layout: x = 1 when a figure is a mirrored pair, y = each copy's offset.
    const uShapeTwin = sim.uShapeTwin ?? uniform(new THREE.Vector2(0, 0));
    // … and the fitted figure's half-size, which its hue is measured in.
    const uShapeSpan = sim.uShapeSpan ?? uniform(4.9);
    const uFocal = uniform(sim.focalPoint.clone());
    // Motes whose seedB is below this are dust; the rest belong to a ribbon (the sim's share).
    const uAmbient = sim.uAmbient ?? uniform(0.22);
    // How strongly the turn shows (0 = never).
    const uTurn = uniform(options.turn ?? 1.0);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    material.fog = false;

    if (sim.isCPU) {
        geometry.setAttribute('aFluidPosition', positionBuffer);
        geometry.setAttribute('aFluidVelocity', velocityBuffer);
        geometry.setAttribute('aFluidColor', colorBuffer);
    }
    const particlePosition = sim.isCPU ? attribute('aFluidPosition', 'vec4')
        : storage(positionBuffer, 'vec4', count).element(instanceIndex);
    const particleVelocity = sim.isCPU ? attribute('aFluidVelocity', 'vec4')
        : storage(velocityBuffer, 'vec4', count).element(instanceIndex);
    const particleColor = sim.isCPU ? attribute('aFluidColor', 'vec4')
        : storage(colorBuffer, 'vec4', count).element(instanceIndex);

    // rgb = the mote's light (already scaled); a = how far out of focus (0 sharp … 1 disc).
    const vLight = varyingProperty('vec4', 'vMurmLight');
    // x = streak aspect (≥1), y = hero flag, z = twinkle phase, w = quad scale.
    const vShape = varyingProperty('vec4', 'vMurmShape');
    // The narrowest a trail's tail may thin to, in radii.
    const vTrail = varyingProperty('float', 'vMurmTrail');

    const paletteAt = (t) => {
        const scaled = fract(t).mul(PALETTE_STOPS).toVar();
        const i0 = floor(scaled).toVar();
        const f = scaled.sub(i0).toVar();
        const blend = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
        const a = uPalette.element(int(i0));
        const b = uPalette.element(int(i0.add(1.0).mod(PALETTE_STOPS)));
        return mix(a, b, blend);
    };

    material.vertexNode = Fn(() => {
        const pdata = particlePosition.toVar();
        const vdata = particleVelocity.toVar();
        const cdata = particleColor.toVar();
        const center = pdata.xyz.toVar();
        const age = pdata.w.toVar();
        const seedA = cdata.x.toVar();
        const seedB = cdata.y.toVar();
        const flash = cdata.z.toVar();
        const energy = cdata.w.toVar();

        const viewCenter = cameraViewMatrix.mul(vec4(center, 1.0)).toVar();
        const viewDist = max(viewCenter.z.negate(), float(0.05)).toVar();

        // ── Size class ──
        const hero = step(0.9935, seedB).toVar();
        const sizeClass = float(0.6).add(seedB.mul(seedB).mul(seedB).mul(1.5)).add(hero.mul(1.2));
        // Born and dying motes are nothing: the simulation's respawn is never seen.
        const life = smoothstep(0.0, 0.07, age).mul(float(1.0).sub(smoothstep(0.9, 1.0, age))).toVar();
        const core = float(BASE_PARTICLE_SIZE).mul(uSizeMul).mul(sizeClass)
            .mul(float(0.85).add(energy.mul(0.3)))
            .toVar();

        // ── Focus ──
        const blur = min(abs(viewDist.sub(uFocusDistance)).mul(uAperture), uMaxBlur).toVar();
        const radius = core.add(blur).toVar();
        const defocus = blur.div(radius).toVar();
        // Energy is spread over the disc; a softened exponent keeps bokeh readable.
        const focusDim = core.div(radius).pow(1.5);

        // ── Pixel floor ──
        const radiusPx = radius.mul(uPixelScale).div(viewDist).toVar();
        const flooredPx = max(radiusPx, float(0.9)).toVar();
        const floorDim = radiusPx.div(flooredPx);
        radius.mulAssign(flooredPx.div(radiusPx));

        // ── Light ──
        // A ribbon mote burns brightest just after it leaves its source and cools all the
        // way down the ribbon, so each ribbon has a bright head and a tail that fades into
        // the dark: that is what keeps lanes of night between them. Dust is dim throughout.
        const ribbon = step(uAmbient, seedB).toVar();
        const youth = float(1.0).sub(smoothstep(0.0, 0.32, age)).mul(ribbon).toVar();
        const ribbonLight = mix(float(1.9), float(0.4), smoothstep(0.0, 0.85, age));
        const twinkle = float(0.82).add(sin(uTime.mul(seedA.mul(2.6).add(0.9)).add(seedA.mul(41.0))).mul(0.18));
        const brightness = float(0.5).add(energy.mul(0.35)).add(flash.mul(3.4))
            // … and in a formation every held mote is part of the figure: an even light.
            .mul(mix(mix(float(0.4), ribbonLight, ribbon), float(0.95), uShapeColor.mul(ribbon)))
            .mul(life)
            .mul(twinkle)
            .mul(focusDim)
            .mul(floorDim.mul(floorDim))
            .mul(smoothstep(1.2, 4.0, viewDist)) // nothing presses against the lens
            .mul(hero.mul(1.4).add(1.0))
            .mul(uExposure)
            .toVar();

        // ── The turn ──
        // A murmuration's signature: a ripple of turning runs through the flock. Every
        // TURN_PERIOD seconds a bent front crosses the swarm from a new bearing; the motes it
        // reaches bank (their trails swing round) and catch the light, and those it has just
        // passed are a shade darker for a moment, so the front reads as a fold in the body.
        const rel = center.sub(uFocal).toVar();
        const turnClock = uTime.div(TURN_PERIOD).toVar();
        const turnN = floor(turnClock).toVar();
        const bearing = fract(sin(turnN.mul(12.9898).add(4.1)).mul(43758.5453)).mul(6.2832).toVar();
        const heading = vec2(cos(bearing), sin(bearing)).toVar();
        const sAcross = dot(rel.xy, vec2(heading.y.negate(), heading.x)).toVar();
        const bend = sin(sAcross.mul(0.32).add(turnN.mul(1.7))).mul(1.4)
            .add(sin(sAcross.mul(0.71).sub(turnN.mul(2.3))).mul(0.5));
        const frontAt = fract(turnClock).div(TURN_CROSSING).mul(2.0).sub(1.0)
            .mul(TURN_REACH);
        const g = dot(rel.xy, heading).add(bend).sub(frontAt).toVar();
        const turnGain = mix(float(1.0), float(0.5), uShapeColor).mul(uTurn).toVar();
        const crest = exp(g.mul(g).mul(-1.0 / (TURN_WIDTH * TURN_WIDTH))).mul(turnGain).toVar();
        const wake = smoothstep(0.0, 1.5, g.negate())
            .mul(exp(max(g.negate().sub(1.5), float(0.0)).mul(-0.7))).mul(turnGain);
        brightness.mulAssign(float(1.0).add(crest.mul(2.4)).sub(wake.mul(0.35)));
        // Which way the flock banks: left or right, by the wave.
        const bank = step(0.5, fract(sin(turnN.mul(78.233).add(1.3)).mul(43758.5453))).mul(2.0).sub(1.0)
            .mul(crest)
            .mul(0.55)
            .toVar();

        // ── Colour: by place, or along the formation ──
        // The hue also runs on along a ribbon as its motes age, so a ribbon is a gradient.
        const byPlace = dot(rel, uPaletteAxis).mul(uPaletteSpan.div(0.62))
            .add(seedA.mul(0.07)).add(energy.mul(0.06))
            .add(age.mul(ribbon).mul(0.14));
        // In a formation the hue runs across the FIGURE — up it, and out from its middle —
        // so each figure is a smooth gradient and a mirrored pair is coloured alike. (By mote
        // index it was a speckle of every hue, which additive blending adds up to white.)
        const side = step(0.5, seedA).mul(2.0).sub(1.0);
        // Measured in the figure's own half-size, so a small figure (a phone, boards across
        // the frame) carries the same gradient as a large one.
        const figure = rel.sub(vec3(side.mul(uShapeTwin.x).mul(uShapeTwin.y), 0.0, 0.0))
            .div(max(uShapeSpan, float(0.5))).toVar();
        const byShape = figure.y.mul(0.34).add(length(figure.xy).mul(0.24)).add(seedA.mul(0.04));
        const hue = mix(byPlace, byShape, uShapeColor).add(uPalettePhase).add(uTime.mul(0.006)).toVar();
        const base = paletteAt(hue).toVar();
        // Heat (a long combo) turns the free swarm to fire — a formation keeps most of its own
        // colours. The fire has hues of its own by place (ember, amber, gold), so the swarm
        // keeps its bands as it warms. Each mote's hue turns toward its fire the long way
        // round the wheel — cyan through blue, violet and rose, like a sky going to sunset —
        // because the short way from cyan to gold runs through green, and a straight blend
        // of the two is grey half way.
        const heatK = max(uHeat.mul(0.9).mul(float(1.0).sub(uShapeColor.mul(0.7))), float(1e-6))
            .pow(HEAT_EXPONENT).toVar();
        const w = sin(hue.mul(6.2832)).mul(0.5).add(0.5);
        const ember = vec3(...FIRE.ember);
        const amber = vec3(...FIRE.amber);
        const gold = vec3(...FIRE.gold);
        const fire = mix(mix(ember, amber, w), mix(amber, gold, w), w).toVar();
        const heated = turnHue(base, fire, heatK);
        const whiten = clamp(flash.mul(0.45).add(youth.mul(0.3).mul(float(1.0).sub(uShapeColor)))
            .add(crest.mul(0.14)), 0.0, 0.65);
        const lit = mix(heated, vec3(1.0, 0.96, 0.92), whiten);

        // ── Trail ──
        // The mote draws the path it has just flown: its head where it is, a tail behind it
        // that thins and fades. A mote out of focus is a disc and draws no trail (a blurred
        // disc dragged along its path is a flat slab, and a wing of slabs reads as bricks).
        const velView = cameraViewMatrix.mul(vec4(vdata.xyz, 0.0)).xy.toVar();
        const speedView = length(velView).toVar();
        const flying = velView.div(speedView.add(0.0001)).toVar();
        // A mote in the turning front has banked: its trail swings off its line of flight.
        const cb = cos(bank);
        const sb = sin(bank);
        const along = vec2(flying.x.mul(cb).sub(flying.y.mul(sb)), flying.x.mul(sb).add(flying.y.mul(cb))).toVar();
        const sharp = float(1.0).sub(smoothstep(0.08, 0.42, defocus));
        const streak = min(speedView.mul(uStretch), radius.mul(TRAIL_CAP))
            .mul(sharp).mul(float(1.0).sub(hero)).toVar();
        const aspect = radius.add(streak).div(radius).toVar();
        // A trail covers more pixels than a point. Its taper already gives back much of that;
        // the rest is paid in brightness, so a swarm thrown into motion does not flood the frame.
        const streakDim = aspect.pow(-0.55);

        const quadScale = mix(float(1.0), float(HERO_QUAD), hero).toVar();
        // Below the visible threshold the quad collapses: the fill it would cost is saved.
        const visible = step(0.004, brightness.mul(streakDim));
        const half = radius.mul(quadScale).mul(visible).toVar();
        const local = positionLocal.xy.mul(2.0).toVar(); // -1 … 1
        // The quad's middle sits half a trail behind the mote, so the head is on the mote.
        const offset = along.mul(local.x.mul(half.add(streak)).sub(streak))
            .add(vec2(along.y.negate(), along.x).mul(local.y.mul(half)));

        vLight.assign(vec4(lit.mul(brightness).mul(streakDim), defocus));
        vShape.assign(vec4(aspect, hero, seedA, quadScale));
        // The narrowest the tail may thin to (in radii) and still be a pixel wide.
        vTrail.assign(clamp(float(1.15).div(flooredPx), 0.32, 1.0));

        return cameraProjectionMatrix.mul(viewCenter.add(vec4(offset, 0.0, 0.0)));
    })();

    const fragmentNode = Fn(() => {
        const c = uv().sub(vec2(0.5, 0.5)).mul(2.0).toVar(); // -1 … 1, x along the streak
        const aspect = vShape.x;
        const hero = vShape.y;
        const seed = vShape.z;
        const quadScale = vShape.w;
        const defocus = vLight.a;

        // In radii along the quad: the head's centre is at +reach, the tail runs back to -reach.
        const px = c.x.mul(aspect).toVar();
        const reach = aspect.sub(1.0).toVar();
        // The head: a round point (and, out of focus, the whole of the mote).
        const d = length(vec2(px.sub(reach), c.y)).mul(quadScale).toVar();

        // In focus: a gaussian point with a hot centre. Out of focus: a soft disc, a touch
        // brighter toward its edge as a lens draws it — but only a touch: a hard-rimmed disc
        // repeated ten thousand times reads as scales, not as light.
        const point = exp(d.mul(d).mul(-4.2)).add(exp(d.mul(d).mul(-22.0)).mul(0.9));
        const disc = float(1.0).sub(smoothstep(0.45, 1.0, d))
            .mul(float(0.72).add(smoothstep(0.35, 0.92, d).mul(0.18)));
        const profile = mix(point, disc, smoothstep(0.3, 0.75, defocus)).toVar();

        // The tail: from the head (k = 1) back to the end of the trail (k = 0) it narrows to
        // vTrail radii and its light falls away, so a moving mote is a comet, not a capsule.
        const k = clamp(px.add(reach).div(reach.mul(2.0).add(0.001)), 0.0, 1.0).toVar();
        const width = mix(vTrail, float(1.0), k.mul(k));
        const across = c.y.div(width);
        const beyond = max(reach.negate().sub(px), float(0.0)); // past the tail's end
        const tail = exp(across.mul(across).add(beyond.mul(beyond)).mul(-4.2))
            .mul(k.mul(k).mul(0.62).add(k.mul(0.18)))
            .mul(smoothstep(0.0, 0.6, reach));
        profile.addAssign(tail.mul(float(1.0).sub(min(profile, float(1.0)))));

        // Hero glint: two thin crossed arms that breathe.
        const g = c.mul(quadScale).toVar();
        const arm = exp(abs(g.y).mul(-9.0)).mul(exp(abs(g.x).mul(-1.15)))
            .add(exp(abs(g.x).mul(-9.0)).mul(exp(abs(g.y).mul(-1.15))));
        const fadeEdge = float(1.0).sub(smoothstep(0.7, 1.0, max(abs(c.x), abs(c.y))));
        const breathe = float(0.55).add(sin(uTime.mul(1.7).add(seed.mul(60.0))).mul(0.45));
        profile.addAssign(arm.mul(hero).mul(fadeEdge).mul(breathe).mul(0.55)
            .mul(float(1.0).sub(defocus)));

        return vec4(vLight.rgb.mul(profile), 1.0);
    })();

    // A mote is pure emission. The basic material's output is diffuse + emissive, so the
    // diffuse term is black: the frame gets the light once, and the emissive target (what
    // the selective bloom reads) gets exactly the same light.
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    material.emissiveNode = fragmentNode.rgb.mul(uEmissiveMul);
    material.userData.emitsBloom = true;

    // A plain Mesh with `count`: instanced by the renderer without a per-instance matrix
    // buffer (which would be megabytes at these counts and is never read).
    const mesh = new THREE.Mesh(geometry, material);
    mesh.count = count;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;

    const palette = uPalette.array;

    return {
        mesh,
        material,
        uniforms: {
            uTime,
            uSizeMul,
            uEmissiveMul,
            uExposure,
            uPixelScale,
            uFocusDistance,
            uAperture,
            uMaxBlur,
            uStretch,
            uHeat,
            uPalettePhase,
            uPaletteSpan,
            uShapeColor,
            uFocal,
            uTurn,
        },
        palette,
        /** Keep the lens in step with the camera (call after the camera moved). */
        setLens(camera, viewportHeight, focusPoint) {
            const fov = ((camera?.fov ?? 38) * Math.PI) / 180;
            uPixelScale.value = Math.max(1, viewportHeight) / (2 * Math.tan(fov * 0.5));
            if (focusPoint && camera?.position) {
                uFocusDistance.value = camera.position.distanceTo(focusPoint);
            }
        },
        update(delta, time) {
            uTime.value = time;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
