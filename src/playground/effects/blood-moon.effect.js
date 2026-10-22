/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Blood Moon — a total lunar eclipse over a salt flat.
 *
 * One full-screen draw holds the world (blood-moon-world.js): the night, the eclipsed moon, the
 * far range and the salt flat whose film of water mirrors all of it. Earth's shadow crosses the
 * moon on a four-minute cycle (blood-moon-eclipse.js): long totality, then a white sliver on one
 * limb that stops the whole night down, then totality again. Gameplay answers on top: rings on
 * the water for every lock and clear, the lunar wave fronts and corona round the moon, and the
 * combo showers (blood-moon-bursts.js).
 *
 * Fast play builds instead of popping (blood-moon-state.js): every answer adds to what is still
 * lit, a cascade's waves race out as concentric fronts, and the heat of play (the shared
 * GameplaySurge) is spent on the world itself. Warm: the corona's fire reaches further and the
 * moon begins to fill with blood. Hot: the red spreads into the sky, the water stirs and rings
 * land on the moon's road, the volcano's crater glows, meteors start to fall. Fever: a meteor
 * storm from one radiant, the volcano smoking, the corona's tongues long and fast round a crimson
 * moon. A perfect clear crowns it with the eclipse's own climax, the diamond ring: the shadow
 * steps aside, a white sliver burns, the night stops down, and the moon slides back into
 * totality as the hands rest.
 *
 * ?quality=High&board=1&event=tetris&eventAge=.45&t=8
 * ?icon=1&t=0 (square window): the hub icon's framing, moon centred over its reflection.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, atan, clamp, exp, float, length, max, mix, positionGeometry, sin, smoothstep, texture,
    uniform, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { createAuthoredLunarSurface } from './blood-moon-surface.js';
import {
    BLOOD_MOON_TIERS, BloodMoonReactions, WAVE_FRONTS, WAVE_SPEED, resolveBloodMoonLayout,
} from './blood-moon-state.js';
import { createBloodMoonBursts } from './blood-moon-bursts.js';
import { sampleEclipse } from './blood-moon-eclipse.js';
import { BloodMoonRipples, rippleCue } from './blood-moon-ripples.js';
import { BloodMoonMeteors } from './blood-moon-meteors.js';
import { WORLD, createWorldMaterial } from './blood-moon-world.js';
import { flashScale } from '../../utils/photosensitivity.js';
import { applyCameraBreath } from '../../themes/shared/camera-breath.js';

export const meta = {
    id: 'blood-moon',
    title: 'Blood Moon — eclipse over the salt flat',
    description: 'A total lunar eclipse over a mirror of salt: the shadow crosses, the sliver stops the night down.',
};

const DEG = Math.PI / 180;

function seededRandom(seed = 0xb100d) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function mesh(scene, geometry, material, name, order = 0) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.frustumCulled = false;
    object.renderOrder = order;
    scene.add(object);
    return object;
}

function transparentMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    material.name = name;
    return material;
}

/** Event light round the moon: the corona's flare and the broken lunar wave of a lock. */
function createCorona(scene, shared, nebula) {
    const material = transparentMaterial('blood-moon-corona');
    material.depthTest = false;
    material.vertexNode = vec4(shared.center.mul(2).sub(1).add(positionGeometry.xy.mul(shared.radius.mul(4.8))
        .div(vec2(shared.aspect, 1))), 0.998, 1);
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(4.8).toVar();
        const r = length(p).toVar();
        const outside = smoothstep(0.993, 1.018, r);
        const d = max(r.sub(1), 0).toVar();
        const direction = p.x.mul(-0.55).add(p.y.mul(0.65)).div(max(r, 0.01));
        const lit = smoothstep(-0.4, 0.85, direction);
        const angle = atan(p.y, p.x.add(0.00001)).toVar();
        // The fire's tongues turn with the clock, faster as play heats and whirling on a T-spin.
        const tongues = sin(angle.mul(19).sub(shared.coronaPhase.x))
            .mul(sin(angle.mul(31).add(shared.coronaPhase.y))).mul(0.5).add(0.5);
        const rim = exp(d.mul(-85)).mul(shared.corona.mul(2.8)).mul(lit.mul(0.6).add(0.4));
        const halo = exp(d.mul(-6)).mul(shared.corona.mul(0.65))
            .add(exp(d.mul(-3.2)).mul(shared.corona.mul(0.14)));
        // ... and reach further from the limb.
        const fire = exp(d.mul(float(-16).add(tongues.mul(8))).div(shared.coronaReach))
            .mul(tongues.pow(3)).mul(shared.corona).mul(0.9);
        const hotRim = vec3(1.7, 0.24, 0.31).mul(exp(d.mul(-145)))
            .mul(shared.corona).mul(0.7);
        const reaction = vec3(0).toVar();
        // The current Wolfhour sky's diffuse, broken lunar wave, in blood red.
        If(shared.lunarActive.greaterThan(0), () => {
            const radius = r.div(335 / 126).toVar();
            const mist = texture(nebula, p.mul(vec2(0.48, 0.56)).add(0.5)
                .add(vec2(shared.time.mul(0.006), shared.time.mul(-0.004)))).level(1).r.toVar();
            const rings = float(0).toVar();
            const tint = float(0).toVar();
            for (let i = 0; i < shared.lunarPulseValues.length; i++) {
                const pulse = shared.lunarPulses.element(i);
                const progress = clamp(pulse.x.mul(pulse.y), 0, 1).toVar();
                const envelope = sin(progress.mul(Math.PI)).pow2().mul(pulse.z).toVar();
                const phase = progress.mul(0.35).add(i * 1.63);
                const arc = sin(angle.mul(3).add(phase))
                    .add(sin(angle.mul(7).sub(phase)).mul(0.45));
                const broken = smoothstep(-0.05, 0.8, arc).mul(mist.mul(0.6).add(0.4));
                const front = progress.mul(0.46).add(0.4).add(mist.sub(0.5).mul(0.14));
                const width = progress.mul(0.038).add(0.035);
                const softArc = exp(radius.sub(front).div(width).pow2().mul(-1.8));
                rings.addAssign(softArc.mul(envelope).mul(broken).div(progress.mul(2.2).add(1)));
                tint.addAssign(envelope.mul(pulse.w));
            }
            reaction.assign(mix(vec3(2.1, 0.006, 0.025), vec3(2.8, 0.018, 0.05), clamp(tint, 0, 1))
                .mul(rings.mul(0.55)));
        });
        return vec3(1.6, 0.012, 0.035).mul(rim.add(halo).add(fire)).add(hotRim).add(reaction)
            .mul(outside)
            .mul(float(1).sub(smoothstep(2.1, 2.4, r)));
    })();
    material.opacityNode = float(1);
    const object = mesh(scene, new THREE.PlaneGeometry(2, 2), material, 'blood-moon-corona', 2);
    object.visible = false;
    return object;
}

/**
 * The lunar wave: up to WAVE_FRONTS red fronts racing out from the limb at once (age, strength,
 * speed, width each), so a cascade's waves radiate as concentric rings and a deeper wave runs
 * faster and wider instead of snapping the last one back to the moon.
 */
function createWave(scene, shared) {
    const material = transparentMaterial('blood-moon-eclipse-wave');
    material.depthTest = false;
    material.vertexNode = vec4(positionGeometry.xy, 0.8, 1);
    material.colorNode = Fn(() => {
        const p = uv().sub(shared.center).mul(vec2(shared.aspect, 1));
        const r = length(p).toVar();
        const light = float(0).toVar();
        for (let i = 0; i < WAVE_FRONTS; i++) {
            const wave = shared.waveFronts.element(i);
            const age = max(wave.x, 0);
            const front = shared.radius.add(age.mul(wave.z));
            const edge = exp(r.sub(front).abs().mul(-480).div(wave.w));
            const wake = exp(r.sub(front.sub(wave.w.mul(0.009))).abs().mul(-130).div(wave.w)).mul(0.12);
            const fade = exp(age.mul(-1.5)).mul(smoothstep(0, 0.09, wave.x));
            light.addAssign(edge.add(wake).mul(fade).mul(wave.y));
        }
        const broken = sin(p.x.mul(78).add(p.y.mul(29))).mul(0.18).add(0.82);
        const outside = smoothstep(shared.radius, shared.radius.add(0.008), r);
        return vec3(0.85, 0.028, 0.052).mul(light).mul(broken)
            .mul(outside);
    })();
    material.opacityNode = float(1);
    const object = mesh(scene, new THREE.PlaneGeometry(2, 2), material, 'blood-moon-wave', 4);
    object.visible = false;
    return object;
}

function boardOverlay() {
    const root = document.createElement('div');
    root.className = 'blood-moon-preview-board';
    root.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);'
        + 'width:min(25vw,280px);height:min(70vh,560px);border:1px solid #89718466;'
        + 'border-radius:16px;background:linear-gradient(#0b0c18d9,#090a14e8);'
        + 'pointer-events:none;z-index:3;box-shadow:0 16px 60px #0008';
    document.body.appendChild(root);
    return root;
}

export function create({
    scene, camera, renderer, params = new URLSearchParams(), sizes,
}) {
    const quality = params.get('quality') || 'High';
    const tier = BLOOD_MOON_TIERS[quality] || BLOOD_MOON_TIERS.High;
    const seed = Number(params.get('seed') || 724461);
    const random = seededRandom(seed);
    const saved = {
        tone: renderer.toneMapping,
        exposure: renderer.toneMappingExposure,
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
    };
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    camera.fov = WORLD.fov; camera.near = 0.05; camera.far = 4000;
    camera.rotation.order = 'YXZ';
    const shared = {
        time: uniform(0),
        aspect: uniform(1),
        viewport: uniform(new THREE.Vector2(1280, 800)),
        // Screen placement of the moon for the event overlays (bottom-left UV, radius / height).
        center: uniform(new THREE.Vector2(0.22, 0.7)),
        radius: uniform(0.15),
        pulse: uniform(0),
        lunarEnergy: uniform(0),
        lunarActive: uniform(0),
        lunarPulseValues: Array.from({ length: 4 }, () => new THREE.Vector4()),
        corona: uniform(0),
        // The corona's fire: its tongues' turn (x, y) and how far it reaches (1 at rest).
        coronaPhase: uniform(new THREE.Vector2()),
        coronaReach: uniform(1),
        starBoost: uniform(0),
        // The lunar wave's fronts: (age, strength, speed, width) each.
        waveFrontValues: Array.from({ length: WAVE_FRONTS }, () => new THREE.Vector4(0, 0, WAVE_SPEED, 1)),
        // The world.
        camRight: uniform(new THREE.Vector3(1, 0, 0)),
        camUp: uniform(new THREE.Vector3(0, 1, 0)),
        camFwd: uniform(new THREE.Vector3(0, 0, -1)),
        tanHalf: uniform(new THREE.Vector2(1, 1)),
        texel: uniform(0.001),
        eye: uniform(new THREE.Vector3(0, WORLD.eyeHeight, 0)),
        moonDir: uniform(new THREE.Vector3(0, 0.3, -1).normalize()),
        moonAt: uniform(new THREE.Vector2()),
        moonTan: uniform(0.1),
        moonRot: uniform(0),
        shadow: uniform(new THREE.Vector2()),
        exposure: uniform(1),
        moonGain: uniform(WORLD.moonK),
        moonLight: uniform(new THREE.Vector3()),
        starGain: uniform(1),
        skySpin: uniform(new THREE.Vector2(1, 0)),
        rippleValues: Array.from({ length: tier.ripples }, () => new THREE.Vector4(0, 0, 99, 0)),
        rippleCount: uniform(0),
        volcanoAz: uniform(0.4),
        volcanoWidth: uniform(0.2),
        volcanoHeight: uniform(0.082),
        meteorA: uniform(new THREE.Vector3(0, 0, -1)),
        meteorS: uniform(new THREE.Vector3(1, 0, 0)),
        meteorN: uniform(new THREE.Vector3(0, 1, 0)),
        meteorHead: uniform(0),
        meteorTrail: uniform(0),
        meteorGlow: uniform(0),
        meteorFireball: uniform(0),
        // The heat of play in the world (blood-moon-world.js): all 0 at rest.
        blood: uniform(0),
        bloodSky: uniform(0),
        agitation: uniform(0),
        volcanoHeat: uniform(0),
    };
    shared.lunarPulses = uniformArray(shared.lunarPulseValues, 'vec4');
    shared.waveFronts = uniformArray(shared.waveFrontValues, 'vec4');
    shared.ripples = uniformArray(shared.rippleValues, 'vec4');
    const surface = createAuthoredLunarSurface(THREE, tier.surfaceSize);
    let loaded = false;
    let resolveNebula;
    const nebulaReady = new Promise((resolve) => { resolveNebula = resolve; });
    const nebula = new THREE.TextureLoader().load('./textures/blood-moon/nebula-red-1.png', () => {
        loaded = true;
        resolveNebula();
    }, undefined, () => {
        loaded = true;
        resolveNebula();
    });
    nebula.colorSpace = THREE.NoColorSpace;
    nebula.wrapS = THREE.RepeatWrapping;
    nebula.wrapT = THREE.RepeatWrapping;

    const world = mesh(scene, new THREE.PlaneGeometry(2, 2), createWorldMaterial(shared, {
        moon: surface.texture, relief: surface.normalTexture, clouds: nebula,
    }, tier), 'blood-moon-world', -10);
    const corona = createCorona(scene, shared, nebula);
    const wave = createWave(scene, shared);
    const bursts = createBloodMoonBursts({
        scene, shared, count: tier.sparks, random,
    });
    const objects = [world, corona, wave];
    let disposed = false;
    let preparing = null;
    const prepare = () => {
        if (!preparing) {
            preparing = (async () => {
                await Promise.all([nebulaReady, surface.ready]);
                if (disposed) return;
                // Compile dormant event materials before gameplay can fire them.
                const eventObjects = [corona, wave, ...bursts.objects];
                const visibility = eventObjects.map((object) => object.visible);
                eventObjects.forEach((object) => { object.visible = true; });
                try { await renderer.compileAsync(scene, camera); } finally {
                    eventObjects.forEach((object, i) => { object.visible = visibility[i]; });
                }
            })();
        }
        return preparing;
    };
    const reactions = new BloodMoonReactions();
    const ripples = new BloodMoonRipples(tier.ripples);
    const meteors = new BloodMoonMeteors();
    /** Big clears that send a fireball across the sky, and how bright (a T-spin's by its lines). */
    const FIREBALLS = { tetris: 1.2, perfectClear: 1.6 };
    const fireballFor = (kind, data) => {
        if (kind !== 'tspin') return FIREBALLS[kind] || 0;
        const lines = Number(data?.lineCount ?? data?.lines ?? 1);
        return lines > 0 ? 0.85 + Math.min(4, lines) * 0.1 : 0;
    };
    /** How far a perfect clear's diamond ring steps the shadow aside at its height. */
    const DIAMOND_NUDGE = 2.2;
    const eclipse = {};
    /** The eclipse as a perfect clear's diamond ring shows it (the shadow stepped aside). */
    const diamond = {};
    const overlay = params.get('board') === '1' ? boardOverlay() : null;
    let width = sizes?.width || window.innerWidth;
    let height = sizes?.height || window.innerHeight;
    let rects = [];
    let layout = resolveBloodMoonLayout(width, height);
    let restPitch = 0;
    let reducedMotion = false;
    let enabled = true;
    let now = 0;
    let rippleSide = 0;
    /** The corona fire's extra turn, beyond the clock's own (play heat, T-spins). */
    let coronaTurn = 0;
    /** The hard drop just cued (its PIECE_LOCK follows in the same tick). */
    let hardDropCued = false;
    /** What the wave fronts hand the shader this frame, strongest (diagnostics). */
    let waveLight = 0;
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const basis = { right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3() };
    const scratch = new THREE.Vector3();
    const onPointer = (event) => {
        pointerTarget.set(
            Math.max(-1, Math.min(1, (event.clientX / width) * 2 - 1)),
            Math.max(-1, Math.min(1, 1 - (event.clientY / height) * 2)),
        );
    };
    const clearPointer = () => pointerTarget.set(0, 0);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('blur', clearPointer);

    const tanHalfY = () => Math.tan((camera.fov * DEG) / 2);

    /** The moon's world direction from the layout, seen from the rest pose (yaw 0). */
    const placeMoon = () => {
        const tanY = tanHalfY();
        const tanX = tanY * (width / height);
        restPitch = Math.atan((0.5 - layout.horizon) * 2 * tanY);
        const fwd = new THREE.Vector3(0, Math.sin(restPitch), -Math.cos(restPitch));
        const up = new THREE.Vector3(0, Math.cos(restPitch), Math.sin(restPitch));
        const nx = layout.x * 2 - 1;
        const ny = layout.y * 2 - 1;
        shared.moonDir.value.copy(fwd).addScaledVector(new THREE.Vector3(1, 0, 0), nx * tanX)
            .addScaledVector(up, ny * tanY).normalize();
        // A radius in the image plane at the moon's place: round on screen wherever it stands.
        shared.moonTan.value = Math.max(1e-4, layout.radius * 2 * tanY);
        // The volcano stands four fifths of the way across any frame, sized to the view.
        shared.volcanoAz.value = Math.atan(0.62 * tanX);
        shared.volcanoWidth.value = Math.min(0.2, Math.max(0.07, tanX * 0.3));
        shared.volcanoHeight.value = 0.082 * Math.min(1, Math.max(0.55, shared.volcanoWidth.value / 0.2));
        meteors.spread = Math.atan(tanX);
        const m = shared.moonDir.value;
        meteors.avoid = {
            az: Math.atan2(m.x, -m.z), el: Math.asin(m.y), radius: Math.atan(shared.moonTan.value) * 2.4 + 0.08,
        };
    };

    const moveCamera = (time = now) => {
        const t = reducedMotion ? 0 : time;
        const px = reducedMotion ? 0 : pointer.x;
        const py = reducedMotion ? 0 : pointer.y;
        // The punch of play rides under the impact, so rapid locks keep the frame alive.
        const impact = reducedMotion ? 0 : reactions.impact + reactions.crescendo.punch * 0.3;
        // A slow walk out across the flat, swaying a little; the pointer leans the view.
        camera.position.set(
            Math.sin(t * 0.07) * 0.35 + Math.sin(t * 0.023) * 0.5 + px * 0.25,
            WORLD.eyeHeight + Math.sin(t * 0.11) * 0.035,
            -t * 0.05,
        );
        camera.rotation.set(
            restPitch + Math.sin(t * 0.043) * 0.004 + py * 0.01 + Math.cos(t * 71) * impact * 0.0012,
            Math.sin(t * 0.031) * 0.008 - px * 0.016 + Math.sin(t * 83) * impact * 0.002,
            Math.sin(t * 0.05) * 0.002,
        );
        camera.updateMatrixWorld();
        applyCameraBreath(camera, t, { distance: 40, scale: reducedMotion ? 0 : 1 });
        camera.updateMatrixWorld();
        // The world's lens: its basis, its eye, and where the moon lands in its image plane.
        camera.matrixWorld.extractBasis(basis.right, basis.up, basis.fwd);
        basis.fwd.negate();
        shared.camRight.value.copy(basis.right);
        shared.camUp.value.copy(basis.up);
        shared.camFwd.value.copy(basis.fwd);
        shared.eye.value.setFromMatrixPosition(camera.matrixWorld);
        const tanY = tanHalfY();
        const tanX = tanY * (width / height);
        shared.tanHalf.value.set(tanX, tanY);
        shared.texel.value = (2 * tanY) / Math.max(1, height * (renderer.getPixelRatio?.() || 1));
        const m = shared.moonDir.value;
        const facing = Math.max(1e-4, m.dot(basis.fwd));
        shared.moonAt.value.set(m.dot(basis.right) / facing, m.dot(basis.up) / facing);
        // The event overlays follow the moon on screen.
        shared.center.value.set(0.5 + shared.moonAt.value.x / (2 * tanX), 0.5 + shared.moonAt.value.y / (2 * tanY));
        shared.radius.value = shared.moonTan.value / (2 * tanY);
    };

    const resize = (w = width, h = height) => {
        width = Math.max(1, w); height = Math.max(1, h);
        const preview = overlay?.getBoundingClientRect();
        const obstacles = preview ? [preview] : rects;
        layout = params.get('icon') === '1'
            ? {
                x: 0.5, y: 0.67, radius: 0.17, horizon: 0.42,
            }
            : resolveBloodMoonLayout(width, height, obstacles);
        shared.aspect.value = width / height;
        // NDC sprite sizes are expressed in CSS pixels; DPI changes affect sharpness only.
        shared.viewport.value.set(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        placeMoon();
        moveCamera(now);
    };

    /**
     * A place on the visible water beside the board for a ring, as a world point. `road`: on the
     * moon's reflection instead, so a hot chain's rings break it into a trembling road.
     */
    const dropRipple = (strength, road = false) => {
        const preview = overlay?.getBoundingClientRect();
        const boards = preview ? [preview] : rects;
        let left = 0.04;
        let right = 0.96;
        if (boards.length) {
            const minX = Math.min(...boards.map((b) => b.left)) / width;
            const maxX = Math.max(...boards.map((b) => b.right)) / width;
            const leftLane = Math.max(0, minX - 0.03 - left);
            const rightLane = Math.max(0, right - (maxX + 0.03));
            const useLeft = leftLane > 0.05 && (rightLane <= 0.05 || rippleSide % 2 === 0);
            if (useLeft) right = minX - 0.03;
            else if (rightLane > 0.05) left = maxX + 0.03;
        }
        rippleSide += 1;
        let sx = left + (right - left) * random();
        // Mostly near the lens, where a ring is large enough to read.
        let sy = 0.03 + (layout.horizon - 0.15) * random() ** 2.2;
        if (road) {
            sx = Math.max(0.02, Math.min(0.98, shared.center.value.x + (random() - 0.5) * 0.2));
            sy = 0.02 + random() * 0.12;
        }
        scratch.set(sx * 2 - 1, sy * 2 - 1, 0.5).unproject(camera).sub(camera.position).normalize();
        if (scratch.y > -0.01) return;
        const reach = camera.position.y / -scratch.y;
        if (reach > 60) return;
        ripples.add(camera.position.x + scratch.x * reach, camera.position.z + scratch.z * reach, strength);
    };

    const update = (time, dt = 0) => {
        now = time;
        const delta = Math.max(0, Math.min(dt, 0.05));
        reactions.update(delta);
        ripples.update(delta);
        hardDropCued = false;
        pointer.lerp(pointerTarget, 1 - Math.exp(-delta * 4));
        const t = reducedMotion ? 0 : time;
        const C = reactions.crescendo;
        shared.time.value = t;
        moveCamera(t);
        // Settings > Reduce flashing effects (ADR-0021): every flare of event light round the
        // moon keeps only flashScale() of its strength; the rings and showers keep moving.
        const flash = flashScale();
        // The eclipse runs on the theme's own clock; reduced motion holds it in totality. A
        // perfect clear's diamond ring steps the shadow aside for a beat: a white sliver burns
        // on the limb and the night stops down round it, while the flat keeps the red moon's
        // light (dimmed by that stop-down), so the darks deepen instead of washing out. It is a
        // frame-wide change, so Reduce flashing keeps almost none of it.
        sampleEclipse(t, eclipse);
        const nudge = C.diamond * DIAMOND_NUDGE * flash;
        const seen = nudge > 1e-3 ? sampleEclipse(t, diamond, nudge) : eclipse;
        shared.shadow.value.set(seen.offset.x, seen.offset.y);
        const { exposure } = seen;
        shared.exposure.value = exposure;
        shared.moonGain.value = WORLD.moonK * exposure
            * (1 + (reactions.pulse * 0.18 + reactions.lunarEnergy * 0.32 + C.punch * 0.08) * flash);
        shared.moonLight.value.set(eclipse.light[0], eclipse.light[1], eclipse.light[2]).multiplyScalar(exposure);
        // The eye adapts over a long run: the stars and the Milky Way open a little.
        shared.starGain.value = exposure * (1 + reactions.starBoost * 0.9 * flash + C.stars);
        // The heat of play in the world: slow, sustained light (not flashes).
        shared.blood.value = enabled ? C.blood : 0;
        shared.bloodSky.value = enabled ? C.sky : 0;
        shared.agitation.value = enabled ? C.water : 0;
        shared.volcanoHeat.value = enabled ? C.volcano : 0;
        // The iris closes a little as heat adds light, so the reds stay deep.
        renderer.toneMappingExposure = 1.12 * C.iris;
        const spin = (t * Math.PI * 2) / 86164;
        shared.skySpin.value.set(Math.cos(spin), Math.sin(spin));
        shared.moonRot.value = Math.sin(t * 0.01) * 0.01;
        shared.pulse.value = reactions.pulse;
        shared.lunarEnergy.value = reactions.lunarEnergy;
        shared.lunarActive.value = 0;
        for (let i = 0; i < shared.lunarPulseValues.length; i++) {
            const pulse = reactions.lunarPulses[i];
            if (pulse.strength > 0 && Number.isFinite(pulse.age)) {
                shared.lunarPulseValues[i].set(pulse.age, 1 / pulse.duration, pulse.strength * flash, pulse.combo);
                shared.lunarActive.value = 1;
            } else shared.lunarPulseValues[i].set(0, 0, 0, 0);
        }
        // The corona: each flare keeps flashScale() of itself; the floor heat holds under it.
        shared.corona.value = 1 - (1 - reactions.corona * flash) * (1 - (enabled ? C.corona : 0));
        shared.coronaReach.value = enabled ? C.reach : 1;
        coronaTurn += reducedMotion ? 0 : delta * (1.6 * (0.6 * C.warm + 0.9 * C.fever) + 10 * C.spin);
        shared.coronaPhase.value.set(t * 1.6 + coronaTurn, t * 0.9 + coronaTurn * 0.5);
        shared.starBoost.value = reactions.starBoost * flash;
        let waveLive = false;
        waveLight = 0;
        for (let i = 0; i < WAVE_FRONTS; i++) {
            const front = reactions.waves[i];
            const value = shared.waveFrontValues[i];
            if (front.age < 3.5 && front.strength > 0) {
                value.set(front.age, front.strength * flash, front.speed, front.width);
                waveLive = true;
                waveLight = Math.max(waveLight, value.y);
            } else value.set(0, 0, WAVE_SPEED, 1);
        }
        shared.rippleCount.value = ripples.write(shared.rippleValues);
        wave.visible = enabled && !reducedMotion && waveLive;
        corona.visible = enabled && (shared.corona.value > 0.002 || shared.lunarActive.value > 0);
        bursts.update(delta);
        // The storm: meteors from one radiant, as many a second as the heat asks for.
        meteors.advanceStorm(now, delta, enabled && !reducedMotion ? C.storm : 0);
        // Meteors keep their own clock; reduced motion (t held at 0) and disabled effects show none.
        const meteor = meteors.sample(t);
        shared.meteorGlow.value = enabled && !reducedMotion ? meteor.glow : 0;
        if (shared.meteorGlow.value > 0) {
            shared.meteorA.value.fromArray(meteor.a);
            shared.meteorS.value.fromArray(meteor.s);
            shared.meteorN.value.fromArray(meteor.n);
            shared.meteorHead.value = meteor.head;
            shared.meteorTrail.value = meteor.trail;
            shared.meteorFireball.value = meteor.fireball;
        }
    };

    const cue = (kind, data) => {
        if (!enabled) return;
        const burstStrength = reactions.cue(kind, data);
        if (kind === 'hardDrop') hardDropCued = true;
        if (!reducedMotion) {
            const C = reactions.crescendo;
            if (burstStrength > 0) {
                // A deeper cascade wave and a hotter game throw the embers further and hotter.
                const depth = kind === 'combo' ? Math.max(1, Number(data?.comboCount ?? data?.combo) || 1) : 1;
                bursts.trigger(burstStrength, Math.min(1, C.shower + (depth - 1) * 0.12));
            }
            const fireball = fireballFor(kind, data);
            if (fireball) meteors.cue(now, fireball, random);
            const rings = rippleCue(kind, data, { hardDrop: hardDropCued, chain: C.chain });
            if (rings) {
                const lift = 1 + C.hot * 0.3;
                for (let i = 0; i < rings.count; i++) {
                    dropRipple(rings.strength * lift * (1 - i * 0.12), random() < C.towardMoon);
                }
            }
        }
    };

    resize(); update(0);
    return {
        cameraRadius: 12,
        camera: moveCamera,
        update,
        resize,
        prepare,
        setLayout(next) { rects = next || []; resize(); },
        setReducedMotion(value) {
            reducedMotion = !!value;
            reactions.reducedMotion = reducedMotion;
            if (reducedMotion) { bursts.reset(); ripples.reset(); meteors.reset(); }
        },
        setEffectsEnabled(value) {
            enabled = !!value;
            if (!enabled) { reactions.reset(); bursts.reset(); ripples.reset(); meteors.reset(); }
        },
        cue,
        /** The true combo after a clear (the theme's ComboTracker); 0 once a chain broke. */
        setCombo(value) { reactions.setCombo(value); },
        /** A piece locked: bookkeeping only (a lock that clears nothing ends the chain). */
        noteLock() { if (enabled) reactions.noteLock(); },
        seek(time) {
            pointer.set(0, 0);
            pointerTarget.set(0, 0);
            reactions.reset();
            bursts.reset();
            ripples.reset();
            meteors.reset();
            if (enabled && params.has('event')) {
                const age = Math.max(0, Math.min(8, Number(params.get('eventAge') || 0.45)));
                update(Math.max(0, time - age), 0);
                const kind = params.get('event');
                const payload = {
                    lineCount: Number(params.get('lines') || 4),
                    comboCount: Number(params.get('combo') || 4),
                };
                const burst = reactions.cue(kind, payload);
                if (!reducedMotion) {
                    if (burst > 0) bursts.seek(age, reactions.burst);
                    const fireball = fireballFor(kind, payload);
                    if (fireball) meteors.cue(Math.max(0, time - age), fireball, random);
                    const rings = rippleCue(kind, payload);
                    if (rings) for (let i = 0; i < rings.count; i++) dropRipple(rings.strength * (1 - i * 0.12));
                }
                for (let t = 0; t < age; t += 1 / 60) {
                    const step = Math.min(1 / 60, age - t);
                    reactions.update(step);
                    ripples.update(step);
                }
            }
            update(time, 0);
        },
        render() { renderer.render(scene, camera); },
        getRendererCounters() {
            return { drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles };
        },
        getCaptureMeta() { return { quality, seed }; },
        getActiveParticleCount() {
            return bursts.objects.reduce((total, object) => total + (object.visible ? tier.sparks : 0), 0);
        },
        async renderAsync() {
            await prepare();
            if (!disposed) renderer.render(scene, camera);
        },
        getDiagnostics() {
            return {
                quality,
                loaded,
                lunarSurface: surface.source,
                time: now,
                layout,
                moon: {
                    x: shared.center.value.x,
                    y: shared.center.value.y,
                    radius: shared.radius.value,
                    direction: shared.moonDir.value.toArray(),
                },
                eclipse: {
                    shadow: { ...eclipse.offset },
                    totality: eclipse.totality,
                    exposure: eclipse.exposure,
                    luminance: eclipse.luminance,
                },
                camera: camera.position.toArray(),
                surge: { ...reactions.heat },
                crescendo: { ...reactions.crescendo },
                combo: reactions.combo,
                reaction: {
                    pulse: reactions.pulse,
                    corona: reactions.corona,
                    starBoost: reactions.starBoost,
                    impact: reactions.impact,
                    lunarEnergy: reactions.lunarEnergy,
                    lunarPulses: reactions.lunarPulses.map((pulse) => ({ ...pulse })),
                },
                // What the shaders are handed this frame, after Reduce flashing.
                eventLight: {
                    corona: shared.corona.value,
                    wave: waveLight,
                    moonGain: shared.moonGain.value / (WORLD.moonK * Math.max(shared.exposure.value, 1e-6)),
                },
                ripples: ripples.count,
                meteor: { glow: shared.meteorGlow.value, fireball: shared.meteorFireball.value },
                sparks: tier.sparks,
                activeWave: wave.visible,
                activeCorona: corona.visible,
                activeEjecta: bursts.objects.some((object) => object.visible),
                bursts: bursts.getDiagnostics(),
            };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            window.removeEventListener('pointermove', onPointer);
            window.removeEventListener('blur', clearPointer);
            overlay?.remove();
            for (const object of objects) scene.remove(object);
            for (const object of bursts.objects) scene.remove(object);
            const release = () => {
                for (const object of objects) { object.geometry.dispose(); object.material.dispose(); }
                bursts.dispose();
                surface.dispose(); nebula.dispose();
            };
            if (preparing) preparing.then(release, release);
            else release();
            renderer.toneMapping = saved.tone; renderer.toneMappingExposure = saved.exposure;
            camera.fov = saved.fov; camera.near = saved.near; camera.far = saved.far;
            camera.rotation.order = 'XYZ';
            camera.updateProjectionMatrix();
        },
    };
}
