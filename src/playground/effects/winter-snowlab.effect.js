/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter Snowlab — Phase 0/1 harness for the snowflow-level winter rebuild.
 * Plan: docs/WINTER_SNOWFLOW_MASTERPLAN_2026-08.md
 *
 * A snow slab in METRES (M = 1 here; the theme integrates via its own M constant)
 * under the locked "polar twilight" rig: sun just below the horizon → a warm
 * amber glow band acting as a low raking key, deep blue zenith, cool moon as the
 * secondary/specular light, faint aurora wash. Shading terms are ports of
 * snowflow_demo (MIT, github.com/Noniv/snowflow_demo): wrapped diffuse,
 * back-scatter subsurface with thickness-dependent blue tint, GGX specular,
 * hemisphere ambient + snow bounce, and one shared sky function used by the
 * dome, the ambient, the sky-specular and the aerial fog — so ground and sky
 * meet at one colour.
 *
 * The carved trail (depression + berm + compaction) is baked into the geometry
 * so raking light shows the material response rules: compressed snow darkens,
 * loses wrap and scatter; fresh berms go brighter and *slightly bluer*, never
 * less blue.
 *
 * URL params: elev, azi (deg), warm (0..1), amb (0..2), exp (exposure),
 *             tm=agx|aces, free=1 (orbit camera).
 * Live hooks: window.__SNOWLAB__.setSun(azDeg, elevDeg) / setWarm / setAmbient /
 *             setExposure — pure uniform writes, no recompile.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cross,
    dFdx,
    dFdy,
    exp,
    float,
    max,
    mix,
    normalize,
    normalWorld,
    positionLocal,
    positionWorld,
    pow,
    reflect,
    smoothstep,
    step,
    texture,
    toneMapping,
    uniform,
    vec2,
    vec3,
} from 'three/tsl';

export const meta = {
    id: 'winter-snowlab',
    title: 'Winter Snowlab',
    description: 'Polar-twilight snow BRDF harness (snowflow rebuild Phase 0/1).',
};

// ---------------------------------------------------------------------------
// CPU value noise (heightfield authoring only — fragment detail is a texture).
// ---------------------------------------------------------------------------
function hash2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
}

function vnoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, octaves, lacunarity, gain) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
        sum += (vnoise(x * freq, y * freq) * 2 - 1) * amp;
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    return sum / norm;
}

/** Rotate + anisotropically scale a domain about the wind bearing (snowflow windMat). */
function windWarp(x, z, angle, sx, sz, scale) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [((x * c - z * s) * sx) / scale, ((x * s + z * c) * sz) / scale];
}

const WIND_ANGLE = (42 * Math.PI) / 180; // held ~75° off the sun azimuth, like snowflow

// ---------------------------------------------------------------------------
// TSL ports of snowflow's shader noise (lib/noise.wgsl, MIT): gradient noise
// with ANALYTIC derivatives (IQ formulation) so the sastrugi/ripple layers can
// contribute exact slopes to the normal — no finite differences.
// ---------------------------------------------------------------------------
const tslHash21 = Fn(([p]) => {
    const p3 = vec3(p.x, p.y, p.x).mul(0.1031).fract().toVar();
    p3.assign(p3.add(p3.dot(vec3(p3.y, p3.z, p3.x).add(33.33))));
    return p3.x.add(p3.y).mul(p3.z).fract();
});

const tslHash22 = Fn(([p]) => {
    const p3 = vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.103, 0.0973)).fract().toVar();
    p3.assign(p3.add(p3.dot(vec3(p3.y, p3.z, p3.x).add(33.33))));
    return vec2(p3.x.add(p3.y), p3.x.add(p3.z)).mul(vec2(p3.z, p3.y)).fract();
});

const tslGrad2 = Fn(([i]) => {
    const a = tslHash21(i).mul(6.28318530718);
    return vec2(a.cos(), a.sin());
});

/** Gradient noise, returns vec3(value, dH/dx, dH/dy). Value ≈ [-1, 1]. */
const tslNoised = Fn(([p]) => {
    const i = p.floor();
    const f = p.sub(i);
    const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));
    const du = f.mul(f).mul(30.0).mul(f.mul(f.sub(2.0)).add(1.0));
    const ga = tslGrad2(i);
    const gb = tslGrad2(i.add(vec2(1.0, 0.0)));
    const gc = tslGrad2(i.add(vec2(0.0, 1.0)));
    const gd = tslGrad2(i.add(vec2(1.0, 1.0)));
    const va = ga.dot(f);
    const vb = gb.dot(f.sub(vec2(1.0, 0.0)));
    const vc = gc.dot(f.sub(vec2(0.0, 1.0)));
    const vd = gd.dot(f.sub(vec2(1.0, 1.0)));
    const k1 = vb.sub(va);
    const k2 = vc.sub(va);
    const k3 = va.sub(vb).sub(vc).add(vd);
    const value = va.add(k1.mul(u.x)).add(k2.mul(u.y)).add(k3.mul(u.x).mul(u.y));
    const deriv = ga
        .add(gb.sub(ga).mul(u.x))
        .add(gc.sub(ga).mul(u.y))
        .add(ga.sub(gb).sub(gc).add(gd).mul(u.x).mul(u.y))
        .add(du.mul(vec2(u.y, u.x).mul(k3).add(vec2(k1, k2))));
    return vec3(value, deriv.x, deriv.y);
});

/** Rotate a vec2 node by (c, s); numbers or nodes. */
const rotN = (p, c, s) => vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
/** Map a gradient back through that rotation (multiply by the transpose). */
const rotTN = (g, c, s) => vec2(g.x.mul(c).add(g.y.mul(s)), g.y.mul(c).sub(g.x.mul(s)));

/**
 * 3-octave ridged noise with derivatives — snowflow's `ridgedd` (sharp crest,
 * smooth trough: sastrugi). Unrolled in JS; octave rotations are numeric.
 * Returns { h, g } — height and dH/d(q).
 */
function ridged3(q) {
    const LAC = 2.11;
    const GAIN = 0.52;
    const ROT = 0.717;
    let amp = 0.5;
    let freq = 1;
    let cAcc = 1;
    let sAcc = 0;
    let pcur = q;
    let sum = float(0.0);
    let grad = vec2(0.0, 0.0);
    let prev = float(1.0);
    for (let o = 0; o < 3; o += 1) {
        const n = tslNoised(pcur.mul(freq));
        const s = n.x.sign();
        const r = n.x.abs().oneMinus();
        const r2 = r.mul(r);
        const dr2 = r.mul(-2.0).mul(s);
        sum = sum.add(prev.mul(r2).mul(amp));
        const gOct = n.yz.mul(dr2).mul(amp).mul(prev).mul(freq);
        grad = grad.add(rotTN(gOct, cAcc, sAcc));
        prev = mix(float(1.0), r2, 0.65);
        amp *= GAIN;
        freq *= LAC;
        const c = Math.cos(ROT);
        const sj = Math.sin(ROT);
        pcur = rotN(pcur, c, sj);
        const cN = cAcc * c - sAcc * sj;
        sAcc = sAcc * c + cAcc * sj;
        cAcc = cN;
    }
    return { h: sum, g: grad };
}

/** Macro landform in metres — simplified port of snowflow terrainMacro. */
function terrainHeight(x, z) {
    const [bx, bz] = windWarp(x, z, WIND_ANGLE, 2.1, 1.0, 58.0);
    const broad = fbm(bx, bz, 5, 2.03, 0.5);
    let h = broad * 4.6;

    const [sx, sz] = windWarp(x, z, WIND_ANGLE, 1.35, 1.0, 210.0);
    h += fbm(sx + 7.3, sz + 3.1, 3, 2.11, 0.55) * 5.0;

    // Medium drifts, sheared along the wind by the broad height (lee asymmetry),
    // piled into concavities and scoured off crests.
    const [mx, mz] = windWarp(x, z, WIND_ANGLE, 1.55, 1.0, 13.5);
    const med = fbm(mx + broad * 2.4, mz, 4, 2.07, 0.48);
    const shelter = Math.min(1, Math.max(0.15, 0.5 - broad * 0.75));
    h += med * 1.25 * shelter;

    return h;
}

/** Trail centreline x(z) — a lazy carve sweeping through the foreground. */
function trailPathX(z) {
    return -1.0 + Math.sin(z * 0.045) * 5.0 + Math.sin(z * 0.013 + 1.7) * 3.0;
}

export function create({ scene, camera, params }) {
    const readF = (key, dflt) => {
        const v = parseFloat(params.get(key));
        return Number.isFinite(v) ? v : dflt;
    };

    // ------------------------------------------------------------- light rig
    // Polar twilight: the *visible* sun is below the horizon; the warm glow band
    // it leaves is the key, so the key direction is the glow centroid a few
    // degrees ABOVE the horizon along the sun azimuth.
    const sunAzimuthDeg = readF('azi', 197); // toward -z, slightly camera-left
    const sunElevDeg = readF('elev', 5.5);
    const warmth = readF('warm', 1.0);
    const ambientLevel = readF('amb', 1.0);
    const exposure = readF('exp', 2.4);
    const tonemapMode = params.get('tm') === 'aces'
        ? THREE.ACESFilmicToneMapping
        : THREE.AgXToneMapping;

    const uSunDir = uniform(new THREE.Vector3());
    const uMoonDir = uniform(new THREE.Vector3());
    const uSunRadiance = uniform(new THREE.Vector3());
    const uAmbient = uniform(ambientLevel);
    const uExposure = uniform(exposure);
    const uSastrugi = uniform(readF('sas', 1.0));
    const uGlint = uniform(readF('glint', 1.0));
    const uTime = uniform(0);

    const setSun = (azDeg, elDeg) => {
        const az = (azDeg * Math.PI) / 180;
        const el = (elDeg * Math.PI) / 180;
        uSunDir.value.set(
            Math.sin(az) * Math.cos(el),
            Math.sin(el),
            Math.cos(az) * Math.cos(el),
        ).normalize();
        // Moon hangs higher, ~45° the other way around from the glow — upper
        // right of frame, clear of the playground UI panel.
        const maz = az - (45 * Math.PI) / 180;
        const mel = (22 * Math.PI) / 180;
        uMoonDir.value.set(
            Math.sin(maz) * Math.cos(mel),
            Math.sin(mel),
            Math.cos(maz) * Math.cos(mel),
        ).normalize();
    };
    const setWarm = (w) => {
        // Twilight beam: warm, at roughly 1/3 of snowflow's full 17:13:6 sun.
        uSunRadiance.value.set(
            (1.15 + 1.5 * w) * 1.15,
            (0.95 + 0.55 * w) * 1.15,
            (0.78 - 0.14 * w) * 1.15,
        );
    };
    setSun(sunAzimuthDeg, sunElevDeg);
    setWarm(warmth);

    const moonRadiance = vec3(0.34, 0.44, 0.62);

    // ---------------------------------------------------------- shared sky Fn
    // One function for dome, ambient tint, sky specular and aerial fog.
    const skyColor = Fn(([dir]) => {
        const y = clamp(dir.y, -0.05, 1.0);
        const zenith = vec3(0.012, 0.034, 0.115);
        const horizonCold = vec3(0.085, 0.150, 0.310);
        const base = mix(horizonCold, zenith, smoothstep(0.0, 0.38, y));

        // Warm band the sunk sun leaves along its azimuth, hugging the horizon.
        // Manual normalize with a floor: skyColor(vec3(0,1,0)) const-folds to
        // normalize(vec2(0,0)) otherwise, which WGSL rejects at compile time.
        const xz = vec2(dir.x, dir.z);
        const sunXZ = vec2(uSunDir.x, uSunDir.z);
        const along = clamp(
            xz.dot(sunXZ).div(xz.length().mul(sunXZ.length()).max(1e-4)),
            0.0,
            1.0,
        );
        const glow = vec3(1.30, 0.52, 0.16)
            .mul(pow(along, 3.0))
            .mul(exp(y.mul(-9.0)))
            .mul(0.85);
        const glowWide = vec3(0.42, 0.20, 0.10)
            .mul(pow(along, 1.5))
            .mul(exp(y.mul(-5.5)))
            .mul(0.35);

        // Moon disc + halo.
        const md = clamp(dir.dot(uMoonDir), 0.0, 1.0);
        const moon = vec3(0.95, 1.02, 1.15).mul(smoothstep(0.9994, 0.9998, md));
        const halo = vec3(0.30, 0.38, 0.55).mul(pow(md, 420.0)).mul(0.35);

        // Faint aurora wash, high sky, away from the warm band, breathing slowly.
        const aur = vec3(0.045, 0.19, 0.135)
            .mul(smoothstep(0.22, 0.65, y))
            .mul(along.oneMinus())
            .mul(float(0.32).add(uTime.mul(0.23).sin().mul(0.1)));

        return base.add(glow).add(glowWide).add(moon).add(halo).add(aur);
    });

    // ------------------------------------------------------------------ dome
    const domeGeo = new THREE.SphereGeometry(650, 48, 24);
    const domeMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false });
    domeMat.colorNode = toneMapping(
        tonemapMode,
        uExposure,
        skyColor(normalize(positionLocal)),
    );
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.frustumCulled = false;
    scene.add(dome);

    // ------------------------------------------------------------- snow slab
    const FIELD_W = 240;
    const FIELD_D = 220;
    const SEG_X = 420;
    const SEG_Z = 380;
    const geo = new THREE.PlaneGeometry(FIELD_W, FIELD_D, SEG_X, SEG_Z);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const count = pos.count;
    const trailComp = new Float32Array(count); // compaction 0..1 (trench)
    const trailBerm = new Float32Array(count); // loose displaced mass 0..1

    for (let i = 0; i < count; i += 1) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        let h = terrainHeight(x, z);

        // Trail carve: flat-floored depression + granular berm ring just outside
        // the rim (snowflow deformSim brush profile, §P4 of the plan).
        const d = Math.abs(x - trailPathX(z));
        const core = 1 - Math.min(1, Math.max(0, (d - 0.7) / 0.4)); // ~1.4 m carve
        const coreSm = core * core * (3 - 2 * core);
        const ringD = (d - 1.35) * 1.2;
        const ring = Math.exp(-ringD * ringD);
        const grain = 0.85 + 0.3 * vnoise(x * 1.8, z * 1.8);
        h -= coreSm * 0.34;
        h += ring * 0.075 * grain;

        pos.setY(i, h);
        trailComp[i] = coreSm;
        trailBerm[i] = Math.min(1, ring * grain * 1.2) * (1 - coreSm * 0.6);
    }
    geo.setAttribute('aTrailComp', new THREE.BufferAttribute(trailComp, 1));
    geo.setAttribute('aTrailBerm', new THREE.BufferAttribute(trailBerm, 1));
    geo.computeVertexNormals();

    // Detail normal: PolyHaven snow_01 (already in the repo) at two world scales,
    // tilted into the geometric normal. Placeholder for the Phase-2 analytic
    // sastrugi/ripple stack — enough tooth for the light to bite.
    const texLoader = new THREE.TextureLoader();
    const norTex = texLoader.load('/textures/winter/snow_01_nor_gl_1k.jpg');
    norTex.wrapS = THREE.RepeatWrapping;
    norTex.wrapT = THREE.RepeatWrapping;
    norTex.colorSpace = THREE.NoColorSpace;

    const snowMat = new THREE.MeshBasicNodeMaterial({ fog: false });

    snowMat.colorNode = Fn(() => {
        const comp = attribute('aTrailComp');
        const berm = attribute('aTrailBerm');

        const V = normalize(cameraPosition.sub(positionWorld));
        const L = uSunDir;
        const ML = uMoonDir;

        // --- normal: geometry + two detail-tilt scales -----------------------
        const worldXZ = positionWorld.xz;
        const camDist = positionWorld.sub(cameraPosition).length();

        // World-space pixel footprint — every fine-layer fade keys off this.
        // "Fading is not a quality compromise; it IS the filter" (snowflow).
        const ddxW = dFdx(worldXZ);
        const ddyW = dFdy(worldXZ);
        const fp = max(vec2(ddxW.length(), ddyW.length()).length(), 1e-4);

        // --- wind-carved fine layers (snowflow terrainFineFiltered port) -----
        // Local wind veer + anisotropy: two slow fields break the "corduroy"
        // uniformity while keeping the prevailing bearing obvious.
        const veer = tslNoised(worldXZ.mul(0.0083).add(vec2(31.7, 12.3))).x.mul(0.42);
        const stretch = tslNoised(worldXZ.mul(0.0126).add(vec2(7.1, 41.9))).x
            .mul(0.5).add(0.5).mul(2.4).add(2.3);
        // No curvature bake in the slab — a slow noise stands in for `exposure`
        // (crests scoured → sastrugi, hollows smooth → ripples). The crossfade
        // must be HARD: when both layers coexist everywhere their perpendicular
        // bearings weave into corduroy — the exact read snowflow warns against.
        const exposureF = smoothstep(
            0.3, 0.7,
            tslNoised(worldXZ.mul(0.0055).add(vec2(5.7, 2.9))).x.mul(0.5).add(0.5),
        );
        const scour = smoothstep(-0.15, 0.45, tslNoised(worldXZ.mul(0.021)).x)
            .mul(0.7).add(0.3);

        // Sastrugi: λ2.3 m ridged noise, compressed ACROSS the wind so ridges
        // streak along it. Analytic gradient mapped back through rotate+scale.
        const angS = veer.add(WIND_ANGLE);
        const cS = angS.cos();
        const sS = angS.sin();
        const fadeS = smoothstep(0.35, 1.6, fp).oneMinus();
        const prS = rotN(worldXZ, cS, sS);
        const sas = ridged3(vec2(prS.x.mul(1 / 2.3), prS.y.mul(stretch.div(2.3))));
        const ampS = float(0.085).mul(mix(0.15, 1.0, exposureF)).mul(scour)
            .mul(fadeS).mul(uSastrugi);
        const gradS = rotTN(
            vec2(sas.g.x.mul(1 / 2.3), sas.g.y.mul(stretch.div(2.3))),
            cS, sS,
        ).mul(ampS);

        // Wind ripples: λ0.42 m transverse corrugation, strongest in hollows.
        const angR = veer.mul(0.5).add(WIND_ANGLE);
        const cR = angR.cos();
        const sR = angR.sin();
        const fadeR = smoothstep(0.06, 0.3, fp).oneMinus();
        const prR = rotN(worldXZ, cR, sR);
        const rip = tslNoised(vec2(prR.x.mul(2.9 / 0.42), prR.y.mul(1 / 0.42)));
        const ampR = float(0.018).mul(mix(1.0, 0.1, exposureF)).mul(fadeR).mul(uSastrugi);
        const gradR = rotTN(
            vec2(rip.yz.x.mul(2.9 / 0.42), rip.yz.y.mul(1 / 0.42)),
            cR, sR,
        ).mul(ampR);

        // Grain: λ0.115 m — keeps the normal field alive under the camera.
        const cG = Math.cos(WIND_ANGLE);
        const sG = Math.sin(WIND_ANGLE);
        const fadeG = smoothstep(0.016, 0.08, fp).oneMinus();
        const prG = rotN(worldXZ, cG, sG);
        const grn = tslNoised(prG.mul(1 / 0.115));
        const gradG = rotTN(grn.yz.mul(1 / 0.115), cG, sG).mul(float(0.0075).mul(fadeG));

        // --- slopes ADD before ever becoming a normal (snowflow rule) --------
        const fineMask = mix(1.0, 0.3, comp); // compacted trail flattens detail
        const fineGrad = gradS.add(gradR).add(gradG).mul(fineMask)
            .clamp(vec2(-1.5, -1.5), vec2(1.5, 1.5));
        const macroGx = normalWorld.x.div(normalWorld.y.max(0.2)).negate();
        const macroGz = normalWorld.z.div(normalWorld.y.max(0.2)).negate();
        const gx = macroGx.add(fineGrad.x);
        const gz = macroGz.add(fineGrad.y);
        const nGeo = normalize(vec3(gx.negate(), 1.0, gz.negate()));

        // Tiled detail map folds in LAST (t0 band now owned by real sastrugi).
        const t0 = texture(norTex, worldXZ.mul(1 / 1.7)).rg.mul(2).sub(1);
        const t1 = texture(norTex, worldXZ.mul(1 / 0.35)).rg.mul(2).sub(1);
        const nearFade = smoothstep(48.0, 14.0, camDist);
        const t2 = texture(norTex, worldXZ.mul(1 / 0.12)).rg.mul(2).sub(1)
            .mul(nearFade);
        const tilt = t0.mul(0.25).add(t1.mul(0.4)).add(t2.mul(0.45))
            .mul(mix(1.0, 0.45, comp));
        const N = normalize(nGeo.add(vec3(tilt.x, 0.0, tilt.y).mul(0.85)));

        // Analytic lee-slope self-shadow — now on the sastrugi-inclusive
        // normal, so each ridge carries its own lit flank and shaded flank
        // under the raking key. This is the "carved" read.
        const geoShadow = mix(
            float(0.26),
            float(1.0),
            smoothstep(0.0, 0.11, nGeo.dot(uSunDir)),
        );

        // --- surface state (plan §4.5 / snowflow snow.fragment) --------------
        // Base albedo: high, narrow, slightly blue — never 1.0.
        const baseAlbedo = vec3(0.855, 0.885, 0.945);
        const compAlbedo = vec3(0.62, 0.665, 0.755);
        const bermAlbedo = vec3(0.895, 0.92, 0.965); // brighter AND bluer
        const albedo = mix(
            mix(baseAlbedo, compAlbedo, comp.mul(0.85)),
            bermAlbedo,
            berm.mul(0.55),
        );
        const roughness = mix(mix(float(0.62), float(0.34), comp), float(0.78), berm.mul(0.7));
        const thickness = mix(mix(float(1.0), float(0.35), comp), float(1.0), berm.mul(0.6));
        const wrapW = mix(float(0.62), float(0.15), comp);

        // --- wrapped diffuse (sun key + moon fill) ---------------------------
        const wrapDiffuse = (nl, w) => max(0.0, nl.add(w).div(w.add(1.0).mul(w.add(1.0))));
        const NdotL = N.dot(L);
        const NdotML = N.dot(ML);
        const INV_PI = float(0.3183098862);
        const direct = albedo.mul(INV_PI).mul(uSunRadiance)
            .mul(wrapDiffuse(NdotL, wrapW)).mul(geoShadow)
            .add(albedo.mul(INV_PI).mul(moonRadiance).mul(wrapDiffuse(NdotML, float(0.5))));

        // --- back-scatter subsurface (snowflow lib/shading.wgsl) -------------
        const deepTint = vec3(0.55, 0.72, 1.0);
        const shallowTint = vec3(0.94, 0.965, 1.0);
        const sssTint = mix(shallowTint, deepTint, thickness);
        const backScatter = (light) => {
            const H = normalize(light.add(N.mul(0.28)));
            const lobe = pow(clamp(V.dot(H.negate()), 0.0, 1.0), mix(3.0, 9.0, thickness));
            return lobe.mul(mix(1.0, 0.3, thickness));
        };
        const sss = uSunRadiance.mul(sssTint).mul(backScatter(L))
            .mul(geoShadow.mul(0.58).add(0.42))
            .add(moonRadiance.mul(sssTint).mul(backScatter(ML)).mul(0.6));

        // --- GGX specular (moon = crisp cool sheen, sun = broad warm) --------
        const ggx = (light, radiance) => {
            const H = normalize(V.add(light));
            const NdotH = clamp(N.dot(H), 0.0, 1.0);
            const nl = clamp(N.dot(light), 0.0, 1.0);
            const a = roughness.mul(roughness);
            const a2 = a.mul(a);
            const denom = NdotH.mul(NdotH).mul(a2.sub(1.0)).add(1.0);
            const D = a2.div(denom.mul(denom).mul(Math.PI).max(1e-6));
            const F = float(0.028).add(pow(clamp(V.dot(H), 0.0, 1.0).oneMinus(), 5.0).mul(0.97));
            return radiance.mul(D).mul(F).mul(nl).mul(0.25);
        };
        // Damped: full-strength GGX on ridged normals reads as WET snow.
        const spec = ggx(ML, moonRadiance).mul(0.7).add(ggx(L, uSunRadiance).mul(0.3));

        // --- glints: cell-hashed crystal facets (snowflow snowGlints port) ---
        // World-anchored (no crawl), moon-driven, HARD grazing gate — sparkle
        // looking across the snow toward the light, matte looking down. Each
        // octave fades before its cells alias.
        const upG = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), step(0.95, N.y.abs()));
        const Tg = normalize(cross(upG, N));
        const Bg = cross(N, Tg);
        const Hm = normalize(V.add(ML));
        const glintOctave = (cell, sharpness, seed) => {
            const pc = worldXZ.add(seed);
            const id = pc.div(cell).floor();
            const r = tslHash22(id);
            const r2 = tslHash22(id.add(vec2(19.73, 7.31)));
            const occupied = step(r2.x, 0.62);
            const centre = id.add(0.5).add(r.sub(0.5).mul(0.72)).mul(cell);
            const dd = pc.sub(centre).length().div(cell * 0.17);
            const disc = dd.mul(dd).oneMinus().clamp(0.0, 1.0);
            const angF = r.y.mul(6.28318530718);
            const tiltF = r2.y.mul(0.26).add(0.10);
            const facet = normalize(
                N.add(Tg.mul(angF.cos()).add(Bg.mul(angF.sin())).mul(tiltF)),
            );
            const nh = facet.dot(Hm).clamp(0.0, 1.0);
            return disc.mul(pow(nh, sharpness)).mul(occupied);
        };
        const NdotVg = N.dot(V).clamp(0.0, 1.0);
        const graze = pow(NdotVg.oneMinus(), 4.0);
        const NdotMLc = clamp(NdotML, 0.0, 1.0);
        const lightGate = smoothstep(0.02, 0.35, NdotMLc)
            .mul(smoothstep(0.55, 0.95, NdotMLc).mul(0.55).oneMinus());
        const fadeGa = smoothstep(0.052 * 0.55, 0.052 * 2.2, fp).oneMinus();
        const fadeGb = smoothstep(0.185 * 0.55, 0.185 * 2.2, fp).oneMinus();
        const glintSum = glintOctave(0.052, 780.0, vec2(0.0, 0.0)).mul(fadeGa)
            .add(glintOctave(0.185, 1500.0, vec2(53.1, 17.9)).mul(1.35).mul(fadeGb));
        const glints = moonRadiance.mul(9.0)
            .mul(glintSum).mul(graze).mul(lightGate)
            .mul(uGlint).mul(0.55)
            .mul(mix(1.0, 0.3, comp));

        // --- ambient: hemisphere from the shared sky + snow bounce -----------
        const skyUp = skyColor(vec3(0.0, 1.0, 0.0));
        const skyHor = skyColor(normalize(vec3(uSunDir.x, 0.12, uSunDir.z)));
        const hemi = mix(skyHor, skyUp, N.y.mul(0.5).add(0.5)).mul(uAmbient).mul(7.0);
        const bounce = skyUp.mul(0.28).mul(clamp(N.y.negate().mul(0.5).add(0.5), 0.0, 1.0))
            .mul(albedo).mul(uAmbient).mul(7.0);
        const skySpecDir = reflect(V.negate(), N);
        const Fr = float(0.028).add(
            max(roughness.oneMinus(), 0.028).sub(0.028)
                .mul(pow(clamp(N.dot(V), 1e-4, 1.0).oneMinus(), 5.0)),
        );
        const skySpec = skyColor(skySpecDir).mul(Fr).mul(uAmbient).mul(7.0);
        // Hollows lose a little sky too — keeps lee faces from floating.
        const ambient = albedo.mul(INV_PI).mul(hemi.add(bounce)).add(skySpec)
            .mul(geoShadow.mul(0.25).add(0.75));

        // --- trench occlusion: scales FINISHED radiance, darkens toward blue --
        const ao = comp.mul(0.38).oneMinus();
        const caveTint = mix(vec3(1.0), deepTint, ao.oneMinus().mul(0.95));

        const lit = direct.add(sss.mul(albedo)).add(spec).add(ambient).add(glints)
            .mul(ao).mul(caveTint);

        // --- aerial perspective through the same sky -------------------------
        const viewVec = positionWorld.sub(cameraPosition);
        const dist = viewVec.length();
        // Fog starts past the foreground (snowflow fogStart=24) and its tint is
        // pulled from the *horizon*, never from downward rays — otherwise the
        // warm band smears across the whole ground plane.
        const fogAmt = exp(
            dist.sub(28.0).max(0.0).mul(-0.0045)
                .mul(exp(positionWorld.y.mul(-0.045)))
        ).oneMinus().clamp(0.0, 1.0);
        const fogDir = normalize(viewVec);
        const fogTint = skyColor(normalize(vec3(fogDir.x, fogDir.y.max(0.015), fogDir.z)));
        const final = mix(lit, fogTint, fogAmt.mul(0.8));

        return toneMapping(tonemapMode, uExposure, final);
    })();

    const slab = new THREE.Mesh(geo, snowMat);
    slab.frustumCulled = false;
    scene.add(slab);

    // ----------------------------------------------------------- live hooks
    window.__SNOWLAB__ = {
        setSun,
        setWarm,
        setAmbient: (a) => { uAmbient.value = a; },
        setExposure: (e) => { uExposure.value = e; },
        setSastrugi: (s) => { uSastrugi.value = s; },
        setGlint: (g) => { uGlint.value = g; },
    };

    const freeCam = params.get('free') === '1';

    return {
        cameraRadius: 40,
        camera(_time, cam) {
            if (freeCam) return;
            cam.position.set(0, 2.6, 34);
            cam.lookAt(0, 0.6, -60);
            if (cam.far < 1400) {
                cam.far = 1400;
                cam.updateProjectionMatrix();
            }
        },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            scene.remove(slab);
            scene.remove(dome);
            geo.dispose();
            snowMat.dispose();
            domeGeo.dispose();
            domeMat.dispose();
            norTex.dispose();
            delete window.__SNOWLAB__;
        },
    };
}
