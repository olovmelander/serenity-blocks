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
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
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
import { PALETTE_SPAN, SWARM_PALETTE } from '../composition/swarm-palette.js';

/** World-space radius of a median mote at sizeMul 1. */
const BASE_PARTICLE_SIZE = 0.042;
/** A hero mote's quad is this many core radii wide, to make room for the glint's arms. */
const HERO_QUAD = 3.4;

const PALETTE_STOPS = SWARM_PALETTE.length;

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
        const flooredPx = max(radiusPx, float(0.9));
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

        // ── Colour: by place, or along the formation ──
        const rel = center.sub(uFocal);
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
        const hue = mix(byPlace, byShape, uShapeColor).add(uPalettePhase).add(uTime.mul(0.006));
        const base = paletteAt(hue).toVar();
        // Heat (a long combo) pulls the free swarm toward gold — a formation keeps most of its
        // own colours; a wave's flash, and a mote fresh from its source, pull toward white.
        const heated = mix(base, vec3(1.0, 0.55, 0.12), uHeat.mul(0.9).mul(float(1.0).sub(uShapeColor.mul(0.7))));
        const whiten = clamp(flash.mul(0.45).add(youth.mul(0.3).mul(float(1.0).sub(uShapeColor))), 0.0, 0.65);
        const lit = mix(heated, vec3(1.0, 0.96, 0.92), whiten);

        // ── Streak ──
        const velView = cameraViewMatrix.mul(vec4(vdata.xyz, 0.0)).xy.toVar();
        const speedView = length(velView).toVar();
        const along = velView.div(speedView.add(0.0001)).toVar();
        const streak = min(speedView.mul(uStretch), radius.mul(5.0))
            .mul(float(1.0).sub(defocus)).mul(float(1.0).sub(hero)).toVar();
        const aspect = radius.add(streak).div(radius).toVar();
        // A streak covers more pixels than a point; most of that is paid back in brightness,
        // so a swarm thrown into motion does not flood the frame with light.
        const streakDim = aspect.pow(-0.8);

        const quadScale = mix(float(1.0), float(HERO_QUAD), hero).toVar();
        // Below the visible threshold the quad collapses: the fill it would cost is saved.
        const visible = step(0.004, brightness.mul(streakDim));
        const half = radius.mul(quadScale).mul(visible).toVar();
        const local = positionLocal.xy.mul(2.0).toVar(); // -1 … 1
        const offset = along.mul(local.x.mul(half.add(streak)))
            .add(vec2(along.y.negate(), along.x).mul(local.y.mul(half)));

        vLight.assign(vec4(lit.mul(brightness).mul(streakDim), defocus));
        vShape.assign(vec4(aspect, hero, seedA, quadScale));

        return cameraProjectionMatrix.mul(viewCenter.add(vec4(offset, 0.0, 0.0)));
    })();

    const fragmentNode = Fn(() => {
        const c = uv().sub(vec2(0.5, 0.5)).mul(2.0).toVar(); // -1 … 1, x along the streak
        const aspect = vShape.x;
        const hero = vShape.y;
        const seed = vShape.z;
        const quadScale = vShape.w;
        const defocus = vLight.a;

        // Distance to a capsule: a disc drawn out along x by the streak.
        const px = c.x.mul(aspect);
        const dx = max(abs(px).sub(aspect.sub(1.0)), float(0.0));
        const d = length(vec2(dx, c.y)).mul(quadScale).toVar();

        // In focus: a gaussian point with a hot centre. Out of focus: a soft disc, a touch
        // brighter toward its edge as a lens draws it — but only a touch: a hard-rimmed disc
        // repeated ten thousand times reads as scales, not as light.
        const point = exp(d.mul(d).mul(-4.2)).add(exp(d.mul(d).mul(-22.0)).mul(0.9));
        const disc = float(1.0).sub(smoothstep(0.55, 1.0, d))
            .mul(float(0.7).add(smoothstep(0.3, 0.9, d).mul(0.22)));
        const profile = mix(point, disc, smoothstep(0.3, 0.75, defocus)).toVar();

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
