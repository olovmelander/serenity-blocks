/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * House-style starter: the smallest world that keeps every rule in SKILL.md.
 *
 * A dusk sky (one function of a direction), a ground, a pool of drifting motes, and waves of
 * light that cross the sky when "play" fires an event. Copy it to
 * `src/playground/effects/<id>.effect.js`, rename `meta.id`, and it mounts at
 * `/playground.html?effect=<id>&t=8&maxFps=30`. Then replace the content part by part; keep the
 * shape. In a real theme these pieces become `<id>-core.js`, `<id>-tsl.js`, one file per part,
 * `<id>-world.js` and `<id>-post.js` (docs/theme-foundation.md).
 *
 * It is self-contained on purpose (only three), so it runs anywhere. A theme takes these from
 * `src/themes/shared/` instead of copying them: `sceneSamples` (the MSAA count), `flatVarying`,
 * `GameplaySurge`, `applyCameraBreath`, `bakeOnce`, `disposeBloomNodeDeep`, and `flashScale`
 * from `src/utils/photosensitivity.js` for any frame-wide flash.
 *
 * `tests/unit/agent-skill-template.test.js` builds every material here to WGSL and GLSL at the
 * richest and the leanest tier, so the file cannot rot unseen at a three bump.
 *
 * URL parameters: `quality=Minimal|Low|Medium|High|Ultra|Extreme`, `event=wave` with
 * `eventAge=<seconds>` (one wave held at that age, for a reproducible capture), `noPost=1`.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, dot, exp, float,
    floor, fract, int, length, max, min, mix, normalize, pass, positionGeometry, positionWorld,
    renderOutput, screenCoordinate, screenUV, sin, smoothstep, uniform, uniformArray, uv, varying,
    vec2, vec3, vec4,
} from 'three/tsl';

export const meta = {
    id: 'theme-starter',
    title: 'Theme starter (house style)',
    description: 'Sky function, ground, instanced motes and an event table: the skill\'s template.',
};

// ---- core: three-free numbers (a theme's <id>-core.js and <id>-quality.js) ---------------------

/**
 * Every tier keeps the whole picture and every event: tiers cut counts and detail terms only.
 * These motes are sparse points, so a lean tier simply has fewer. A DENSE additive swarm must
 * hold its total light instead (count x area x exposure), or it is a white slab at one tier
 * and a dim speckle at another.
 */
export const STARTER_QUALITY = Object.freeze({
    Minimal: Object.freeze({ motes: 240, msaa: false, dither: false }),
    Low: Object.freeze({ motes: 480, msaa: false, dither: false }),
    Medium: Object.freeze({ motes: 900, msaa: false, dither: true }),
    High: Object.freeze({ motes: 1500, msaa: true, dither: true }),
    Ultra: Object.freeze({ motes: 2400, msaa: true, dither: true }),
    Extreme: Object.freeze({ motes: 3600, msaa: true, dither: true }),
});
export const tierFor = (quality) => STARTER_QUALITY[quality] || STARTER_QUALITY.High;

/** Rows of the one event table. Live rows are packed at the front; the shader loops to a count. */
export const WAVE_ROWS = 8;
const WAVE_LIFE = 3.6; // seconds a wave is seen
const WAVE_PERIOD = 2.4; // the demo's own beat, when no gameplay feeds it

/**
 * The clock the shaders see wraps, so a float keeps its precision through a long session. The
 * period is a whole number of turns for every mote: their rates are k / CLOCK_TURNS radians a
 * second with k an integer, so the wrap is seamless.
 */
const CLOCK_TURNS = 600;
const CLOCK_WRAP = Math.PI * 2 * CLOCK_TURNS;

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- shared TSL (a theme's <id>-tsl.js) ---------------------------------------------------------

/**
 * A helper called from more than one place carries a layout: the builder then writes ONE shader
 * function instead of a copy per call. A laid-out helper is pure (values come in as parameters,
 * it captures no uniform and no texture), calls no other laid-out helper, and names its
 * parameters with words neither WGSL nor GLSL reserves.
 */
const starterHash21 = /* @__PURE__ */ Fn(([pIn]) => {
    const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
    p3.addAssign(dot(p3, p3.yzx.add(33.33)));
    return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'starter_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

/** The ONE uniform bag. The world writes `.value`; materials only read. Colours are scene-linear. */
function createUniforms() {
    const v3 = (x, y, z) => uniform(new THREE.Vector3(x, y, z));
    const waveRows = Array.from({ length: WAVE_ROWS }, () => new THREE.Vector4(0, 1, 0, WAVE_LIFE));
    return {
        time: uniform(0), // seconds on the wrapped clock
        viewport: uniform(new THREE.Vector2(1280, 720)), // drawing buffer, pixels
        camPos: v3(0, 1.6, 6),
        camRight: v3(1, 0, 0),
        camUp: v3(0, 1, 0),
        camFwd: v3(0, 0, -1),
        tanHalf: uniform(new THREE.Vector2(1, 0.5)),
        sunDir: uniform(new THREE.Vector3(-0.35, 0.16, -0.92).normalize()),
        zenith: v3(0.012, 0.03, 0.11),
        horizon: v3(0.42, 0.2, 0.16),
        sunLight: v3(1.6, 0.42, 0.07), // a saturated light keeps its green low
        ground: v3(0.05, 0.045, 0.06),
        waveLight: v3(0.35, 0.85, 1.25),
        moteWarm: v3(1.5, 0.75, 0.22),
        moteCool: v3(0.3, 0.8, 1.5),
        // Each row: xyz = the wave's direction, w = its age in seconds (written every frame).
        waves: uniformArray(waveRows, 'vec4'),
        waveCount: uniform(0, 'int'),
        tables: { waveRows },
    };
}

/** The view ray through a screen point. Reads the bag, so it is a plain builder, not a laid-out Fn. */
const viewRay = (u, st) => normalize(
    u.camFwd
        .add(u.camRight.mul(st.x.mul(2.0).sub(1.0)).mul(u.tanHalf.x))
        .add(u.camUp.mul(float(1.0).sub(st.y.mul(2.0))).mul(u.tanHalf.y)),
);

/**
 * The sky as ONE function of a direction. Whatever needs the sky (the backdrop, a water's mirror
 * ray, fog on far ground) calls this, so they always agree. Call it INSIDE a `Fn`, with `d`
 * already a variable: everything below is then written into that function's own flow.
 */
function skyLight(u, d) {
    const sky = mix(u.horizon, u.zenith, smoothstep(0.0, 0.62, clamp(d.y, 0.0, 1.0))).toVar();

    // The sun's aureole. The cosine is clamped and the exponent can only be <= 0: a term is
    // bounded BEFORE it is mixed or summed, or one Inf texel reaches the bloom.
    const toSun = float(1.0).sub(clamp(dot(d, u.sunDir), -1.0, 1.0)); // 0 at the sun, never negative
    sky.addAssign(u.sunLight.mul(exp(toSun.mul(-60.0)).mul(0.55).add(exp(toSun.mul(-900.0)).mul(2.2))));

    // Event light: one Loop over the live rows of the table. Never a JavaScript loop that emits
    // this body once per row.
    Loop({ start: int(0), end: u.waveCount, type: 'int', condition: '<', name: 'w' }, ({ w }) => {
        const row = u.waves.element(w);
        const age = row.w;
        const away = float(1.0).sub(clamp(dot(d, row.xyz), -1.0, 1.0)); // 0 at the wave's origin
        const front = float(1.0).sub(cos(age.mul(0.55))); // where the ring stands now
        const miss = away.sub(front).div(0.035);
        const ring = exp(miss.mul(miss).negate()); // <= 1
        sky.addAssign(u.waveLight.mul(ring).mul(exp(age.mul(-1.1))));
    });
    return sky;
}

// ---- parts (a theme's <id>-<part>.js): each returns its mesh, geometry and material -------------

const part = (name, geometry, material, renderOrder) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder; // on the mesh, never on a Group
    return { mesh, geometry, material };
};

/** A solid: drawn first, writes depth. Self-shaded: no scene lights anywhere. */
function createGround(u) {
    const geometry = new THREE.PlaneGeometry(900, 900);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar(); // three's shared vars are pinned before anything reads them
        const lit = u.ground.mul(u.zenith.mul(6.0).add(u.sunLight.mul(max(u.sunDir.y, 0.0)).mul(1.4)));
        // Far ground melts into the SKY'S OWN colour on that bearing (the same function, called
        // along the horizon), so no line is ruled where they meet. A hand-mixed haze colour
        // never matches a sky that carries a sun and event light.
        const flat = P.xz.sub(u.camPos.xz).toVar();
        const reach = max(length(flat), 0.001).toVar(); // never normalize what can be zero
        const bearing = vec3(flat.x.div(reach), 0.0, flat.y.div(reach)).toVar();
        const air = float(1.0).sub(exp(reach.mul(-0.02)));
        return vec4(mix(lit, skyLight(u, bearing), air), 1.0);
    })();
    return part('StarterGround', geometry, material, 10);
}

/**
 * The backdrop: one triangle at the far plane, drawn LAST among the opaque parts with the depth
 * test on, so the sky's shader runs only where nothing stands in front of it.
 */
function createSky(u, tier) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: false });
    material.depthFunc = THREE.LessEqualDepth;
    material.vertexNode = vec4(positionGeometry.xy, 1.0, 1.0);
    material.colorNode = Fn(() => {
        const d = viewRay(u, screenUV).toVar();
        const sky = skyLight(u, d).toVar();
        // A tier drops a TERM, here in JavaScript. Never by feeding it a constant or a zero uniform.
        if (tier.dither) sky.addAssign(starterHash21(screenCoordinate.xy).sub(0.5).mul(1.5 / 255));
        return vec4(max(sky, vec3(0.0)), 1.0);
    })();
    return part('StarterSky', geometry, material, 50);
}

/**
 * Many small things: instanced quads placed in clip space, their motion a closed form of the
 * clock (no compute, so both backends draw them, and any frame can be reproduced from `t`).
 * All per-instance data rides in ONE interleaved buffer: WebGPU binds 8 vertex buffers a pipeline.
 */
function createMotes(u, tier, rng) {
    const count = tier.motes;
    const STRIDE = 8;
    const data = new Float32Array(count * STRIDE);
    for (let i = 0; i < count; i++) {
        const o = i * STRIDE;
        data[o] = (rng() - 0.5) * 34; // aPlace.xyz: where it drifts
        data[o + 1] = 0.25 + rng() * 5.5;
        data[o + 2] = -2 - rng() * 30;
        data[o + 3] = Math.floor(rng() * 4096); // aPlace.w: a seed, stored as an INTEGER
        data[o + 4] = 0.035 + rng() * 0.06; // aLook.x: size, metres
        data[o + 5] = rng() * Math.PI * 2; // aLook.y: phase
        data[o + 6] = Math.floor(rng() * 3); // aLook.z: tone 0, 1 or 2, an integer
        data[o + 7] = (120 + Math.floor(rng() * 360)) / CLOCK_TURNS; // aLook.w: rate, k / CLOCK_TURNS
    }
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('aPlace', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aLook', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = count; // every slot is always drawn: the first frame compiles the pipeline

    const aPlace = attribute('aPlace', 'vec4');
    const aLook = attribute('aLook', 'vec4');

    // Where a mote stands and how many buffer pixels it wants. A BUILDER, called inside each
    // `Fn` below: a node shared between two functions is written into whichever builds it first.
    const place = () => {
        const t = u.time.mul(aLook.w).add(aLook.y).toVar();
        const world = vec3(
            aPlace.x.add(sin(t).mul(0.7)),
            aPlace.y.add(sin(t.mul(2.0).add(aPlace.w)).mul(0.3)),
            aPlace.z.add(cos(t).mul(0.7)),
        ).toVar();
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0)).toVar();
        const wantPx = aLook.x.div(max(clip.w, 0.05).mul(u.tanHalf.y)).mul(u.viewport.y.mul(0.5)).toVar();
        return { t, clip, wantPx };
    };

    // The smallest a mote is drawn. Below it, it is dimmed instead of shrunk: a thing authored in
    // metres is otherwise a blob on a phone's small buffer and a sub-pixel crawl at 4K.
    const LEAST_PX = 1.15;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false, // light writes no depth; a solid always does
        depthTest: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true, // blend (One, One): the light is added...
        side: THREE.DoubleSide,
    });
    material.vertexNode = Fn(() => {
        const { clip, wantPx } = place();
        const px = max(wantPx, LEAST_PX);
        const corner = positionGeometry.xy.mul(px).mul(2.0).div(u.viewport);
        return vec4(clip.xy.add(corner.mul(clip.w)), clip.z, clip.w);
    })();

    // Light is decided once per mote, in the vertex stage, and handed over as a varying.
    const moteLight = varying(Fn(() => {
        const { t, wantPx } = place();
        const seed = floor(aPlace.w.add(0.5)); // an exact integer again: a hash amplifies the last bit
        const tone = floor(aLook.z.add(0.5)).mul(0.5);
        const twinkle = sin(t.mul(3.0).add(starterHash21(vec2(seed, 7.0)).mul(6.2831853))).mul(0.5).add(0.5);
        const shrink = min(wantPx.div(LEAST_PX), 1.0);
        return mix(u.moteWarm, u.moteCool, tone).mul(twinkle.mul(0.7).add(0.3)).mul(shrink.mul(shrink));
    })(), 'starterMoteLight');

    // ...and `outputNode` replaces the result after the premultiply step, so alpha 0 leaves the
    // target's alpha alone (an additive part that writes alpha 1 leaves a box in the post chain).
    material.outputNode = Fn(() => {
        // Under MSAA a varying is extrapolated on a thin or small triangle: clamp it before it
        // shapes a colour.
        const p = clamp(uv(), 0.0, 1.0).sub(0.5).mul(2.0).toVar();
        const r2 = dot(p, p);
        const spot = exp(r2.mul(-5.0)).mul(float(1.0).sub(smoothstep(0.6, 1.0, r2)));
        return vec4(max(moteLight, vec3(0.0)).mul(spot), 0.0);
    })();
    return part('StarterMotes', geometry, material, 70);
}

// ---- post (a theme's <id>-post.js) --------------------------------------------------------------

/**
 * One scene pass, (one bloom,) ONE output pass, and tone mapping exactly once: the renderer's own
 * tone mapping is off and the pipeline's output transform is off, so this node is the only place
 * the picture is toned and encoded. A feature a tier lacks is not built at all.
 */
function createPost(renderer, scene, camera, tier) {
    const pipeline = new THREE.RenderPipeline(renderer); // never PostProcessing
    // The pass carries its own MSAA count (left out, it takes the renderer's). A theme builds its
    // renderer with antialias: false and takes this count from sceneSamples() in
    // src/themes/shared/scene-antialias.js, so the tier decides.
    const scenePass = pass(scene, camera, { samples: tier.msaa ? 4 : 0 });
    const sceneColor = scenePass.getTextureNode('output');
    pipeline.outputColorTransform = false;
    pipeline.outputNode = Fn(() => {
        const hdr = max(sceneColor.rgb, vec3(0.0)).toVar();
        // A bloom goes here: bloom(sceneColor) from three/addons/tsl/display/BloomNode.js, added
        // to `hdr`, built only on the tiers that carry it, disposed with disposeBloomNodeDeep.
        // A hue-preserving shoulder: compress by the brightest channel, so a saturated light
        // keeps its colour on its way to white.
        const peak = max(hdr.x, max(hdr.y, hdr.z));
        const toned = hdr.div(peak.mul(0.85).add(1.0)).mul(1.35);
        return renderOutput(vec4(clamp(toned, 0.0, 1.0), 1.0), THREE.NoToneMapping);
    })();
    pipeline.needsUpdate = true;
    return {
        render: () => pipeline.render(),
        dispose() {
            scenePass.dispose();
            pipeline.dispose();
        },
    };
}

// ---- the world (a theme's <id>-world.js) and the playground controller --------------------------

const scratch = { right: new THREE.Vector3(), up: new THREE.Vector3(), back: new THREE.Vector3(), size: new THREE.Vector2() };

/**
 * Build the world. Everything is in the scene when this returns, and the scene never grows
 * afterwards: the first frame then compiles every pipeline, behind the loading screen.
 */
export function createStarterWorld({ scene, quality = 'High', seed = 20261112 } = {}) {
    const tier = tierFor(quality);
    const u = createUniforms();
    const rng = mulberry32(seed);
    const parts = [createGround(u), createSky(u, tier), createMotes(u, tier, rng)];
    for (const { mesh } of parts) scene?.add(mesh);

    const fired = []; // waves a theme's events add: { x, y, z, born }, born in world seconds
    let held = null; // a capture's one wave at a fixed age

    return {
        tier,
        u,
        parts,
        /** Gameplay calls this (through the theme's director): it writes numbers, it creates nothing. */
        fireWave(direction, now) {
            if (fired.length >= WAVE_ROWS) fired.shift();
            fired.push({ x: direction.x, y: direction.y, z: direction.z, born: now });
        },
        holdWave(direction, age) {
            held = direction ? { x: direction.x, y: direction.y, z: direction.z, age } : null;
        },
        /** Pack the live rows at the front of the table and set the count the shader loops to. */
        writeWaves(time) {
            const rows = u.tables.waveRows;
            let n = 0;
            const put = (x, y, z, age) => {
                if (n < WAVE_ROWS && age >= 0 && age < WAVE_LIFE) rows[n++].set(x, y, z, age);
            };
            if (held) {
                put(held.x, held.y, held.z, held.age);
            } else {
                for (const wave of fired) put(wave.x, wave.y, wave.z, time - wave.born);
                // With nothing feeding it, the demo keeps its own beat: a closed form of the time,
                // so `?t=` lands on the same frame every run.
                for (let back = 0; back < 2; back++) {
                    const beat = Math.floor(time / WAVE_PERIOD) - back;
                    if (beat < 0) continue;
                    const turn = beat * 2.399963; // the golden angle walks the horizon
                    put(Math.sin(turn) * 0.8, 0.28, -Math.abs(Math.cos(turn)) * 0.9 - 0.1, time - beat * WAVE_PERIOD);
                }
            }
            for (let i = 0; i < n; i++) rows[i].set(...normalized(rows[i]), rows[i].w);
            u.waveCount.value = n;
        },
        /** Once a frame, after the camera has moved: the bag follows the camera and the clock. */
        update(time, camera, renderer) {
            u.time.value = time % CLOCK_WRAP;
            camera.updateMatrixWorld();
            camera.matrixWorld.extractBasis(scratch.right, scratch.up, scratch.back);
            u.camRight.value.copy(scratch.right);
            u.camUp.value.copy(scratch.up);
            u.camFwd.value.copy(scratch.back).negate();
            u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
            const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
            u.tanHalf.value.set(tanY * camera.aspect, tanY);
            if (renderer) u.viewport.value.copy(renderer.getDrawingBufferSize(scratch.size));
            this.writeWaves(time);
        },
        dispose() {
            for (const { mesh, geometry, material } of parts) {
                scene?.remove(mesh);
                geometry.dispose();
                material.dispose();
            }
        },
    };
}

function normalized(row) {
    const length3 = Math.hypot(row.x, row.y, row.z) || 1;
    return [row.x / length3, row.y / length3, row.z / length3];
}

// create(ctx): the playground's contract (src/playground/README.md).
export function create({ scene, camera, renderer, params }) {
    const quality = params?.get('quality') || 'High';
    const world = createStarterWorld({ scene, quality });
    const post = params?.get('noPost') === '1' ? null : createPost(renderer, scene, camera, world.tier);
    if (params?.get('event') === 'wave') {
        const age = Number(params.get('eventAge'));
        world.holdWave({ x: 0.25, y: 0.3, z: -0.92 }, Number.isFinite(age) ? age : 0.8);
    }
    let lastTime = 0;

    return {
        /** Deterministic in `time`: a slow sway, never a random walk. */
        camera(time, cam) {
            cam.position.set(Math.sin(time * 0.11) * 0.6, 1.6 + Math.sin(time * 0.07) * 0.08, 6);
            cam.lookAt(0, 2.3, -12);
        },
        update(time) {
            lastTime = time;
            world.update(time, camera, renderer);
        },
        render() {
            if (post) post.render();
            else renderer.render(scene, camera);
        },
        getDiagnostics: () => ({ quality, motes: world.tier.motes, waves: world.u.waveCount.value, time: lastTime }),
        dispose() {
            post?.dispose();
            world.dispose();
        },
    };
}
