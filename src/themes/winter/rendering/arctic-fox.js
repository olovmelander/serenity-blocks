import * as THREE from 'three/webgpu';
import {
    uniform, attribute, normalWorld, normalize, dot, clamp, vec3,
    positionWorld, cameraPosition, length, smoothstep, mix,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import foxUrl from '../assets/arctic-fox.glb?url';

// ── Cool, even fur material (a tiny TSL shader, like the scene's snow drifts) ──
// The coat reads perfect snow-white with soft 3D form and is IMMUNE to the scene's
// strong warm fill light (it's unlit + self-shaded). The TRELLIS-baked dark eyes
// and nose come through the GLB's vertex colours.
const _MOON_DIR = new THREE.Vector3(1650, 1050, -2400).normalize();
const uFoxMoonDir = uniform(_MOON_DIR);
function makeFurMaterial() {
    const mat = new THREE.MeshBasicNodeMaterial();
    const albedo = attribute('color').xyz;            // TRELLIS vertex colours
    const nW = normalize(normalWorld);
    const moon = clamp(dot(nW, uFoxMoonDir), 0.0, 1.0);
    const up = clamp(nW.y, 0.0, 1.0);
    // high floor → snow-white coat; gentle moon + sky terms for soft form.
    const lit = clamp(moon.mul(0.38).add(up.mul(0.16)).add(0.66), 0.0, 1.12);
    const col = albedo.mul(lit).mul(vec3(0.93, 0.965, 1.03));
    // Atmospheric perspective: fade the fox into the cold haze with distance so a
    // far-off fox recedes toward the mountains instead of popping as crisp white —
    // this is what makes the scene's ~1km depth and majestic scale read.
    const dist = length(positionWorld.sub(cameraPosition));
    const haze = smoothstep(700.0, 2700.0, dist).mul(0.86);
    mat.colorNode = mix(col, vec3(0.60, 0.70, 0.82), haze);
    return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arctic foxes that roam the winter snow + frozen lake and BEHAVE like real foxes.
//
// Mesh: a TRELLIS.2-generated arctic fox (vertex-coloured white fur + dark eyes),
// rigged in Blender with five baked clips: Run, Listen, Pounce, Shake, LookAround.
// The model faces +Z by default (Blender −Y forward → glTF +Z after export_yup),
// so heading = atan2(dirX, dirZ).
//
// Each fox wanders a smooth full-depth loop (ground-following snow + ice via a
// downward raycast), then occasionally stops and runs a behaviour: the iconic
// mousing HUNT (Listen → Pounce: leap + headfirst dive), a snow Shake, or an alert
// LookAround. See the behaviour state machine below.
// ─────────────────────────────────────────────────────────────────────────────

const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _origin = new THREE.Vector3();

// Real arctic foxes bias their mousing pounce toward magnetic NORTH (~73% success
// when aligned, ~18% otherwise) — they use Earth's field as a rangefinder. Here
// "north" is the −Z aurora horizon (auroras ring the magnetic pole), with a slight
// east declination, so the foxes consistently dive toward the aurora — an observant
// viewer notices they all pounce the same way. (heading: model faces +Z, so
// rotation.y = atan2(dirX, dirZ).)
const MAG_NORTH = new THREE.Vector2(0.42, -0.91);            // NNE → toward the aurora
const MAG_NORTH_HEADING = Math.atan2(MAG_NORTH.x, MAG_NORTH.y);
function approachAngle(a, b, rate, dt) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = rate * dt;
    return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

export function createArcticFox(scene, {
    groundMeshes = [],     // meshes to raycast for ground height (snow drifts + lake ice)
    groundMesh = null,     // back-compat: a single ground mesh
    fallbackY = -260,      // FEET_Y if the raycast misses
    count = 3,
    scale = 190,
    footSink = 4,          // how far the paws settle into the snow/ice
} = {}) {
    const group = new THREE.Group();
    group.name = 'winter-arctic-fox';
    scene.add(group);

    const loader = new GLTFLoader();
    let src = null;                 // { scene, clip }
    let groundReady = false;
    const foxes = [];               // { root, mixer, path, speed, t }
    const meshes = [groundMesh, ...groundMeshes].filter(Boolean);

    // Raycast every ground mesh and take the HIGHEST hit so the fox stands on the
    // lake ice (above the carved basin floor) when over the lake, and on the snow
    // drifts everywhere else — a seamless snow⇄ice transition.
    function groundY(x, z) {
        if (!meshes.length) return fallbackY;
        if (!groundReady) { meshes.forEach((m) => m.updateMatrixWorld()); groundReady = true; }
        _origin.set(x, 2200, z);
        _ray.set(_origin, _down);
        let best = -Infinity;
        for (const m of meshes) {
            const hits = _ray.intersectObject(m, false);
            if (hits.length && hits[0].point.y > best) best = hits[0].point.y;
        }
        return best > -Infinity ? best : fallbackY;
    }

    // A big wandering loop that sweeps the FULL scene depth — from the far snow/ice
    // near the mountains (z≈−1800) right up close to the camera (z≈+430) and across
    // the width. Two harmonics keep it organic; results are clamped to the playable
    // rectangle (snow + frozen lake). Each fox gets its own centre/phase so the pack
    // spreads across the whole scene.
    function makePath(i) {
        const cx = (Math.random() - 0.5) * 360;
        const cz = -560 + (Math.random() - 0.5) * 220;
        const rx = 560 + Math.random() * 320;       // narrower → stays in frame
        const rz = 1000 + Math.random() * 230;      // deep: far treeline ⇄ near camera
        const dir = Math.random() < 0.5 ? 1 : -1;
        const ph = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.8;
        return (t) => {
            const a = dir * t + ph;
            const x = cx + rx * Math.cos(a) + 110 * Math.cos(2.3 * a + 0.7);
            const z = cz + rz * Math.sin(a) + 95 * Math.sin(1.7 * a + 0.3);
            return {
                x: THREE.MathUtils.clamp(x, -1150, 1150),
                z: THREE.MathUtils.clamp(z, -1840, 430),
            };
        };
    }

    // ── Behaviour state machine ───────────────────────────────────────────────
    // Foxes trot the path, then occasionally STOP and behave like real arctic foxes:
    //   • hunt   : Listen (head cocks, localising prey) → POUNCE (leap + headfirst
    //              dive — the iconic mousing move; the vertical hop is a JS arc)
    //   • look   : alert LookAround (tail raised, scanning)
    //   • shake  : shake the snow off
    // Clips crossfade for smooth transitions.
    const STATE_CLIP = {
        trot: 'Run', listen: 'Listen', pounce: 'Pounce', shake: 'Shake', look: 'LookAround',
        stretch: 'Stretch', scratch: 'Scratch', dig: 'Dig', rest: 'CurlSleep',
    };

    function play(fx, name, once, timeScale = 1) {
        const next = fx.actions[name];
        if (!next) return;
        next.reset();
        next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
        next.clampWhenFinished = once;
        next.enabled = true;
        next.setEffectiveTimeScale(timeScale);
        next.setEffectiveWeight(1);
        next.play();
        if (fx.current && fx.current !== next) next.crossFadeFrom(fx.current, 0.25, false);
        fx.current = next;
    }
    function setState(fx, s) {
        fx.state = s; fx.stateTime = 0;
        if (s === 'trot') {
            play(fx, 'Run', false, 1);   // timeScale matched to ground speed in update()
            fx.trotDur = 7 + Math.random() * 9;
            return;
        }
        if (s === 'listen') {
            // aim the coming pounce toward magnetic north (mostly) — the rest are the
            // foxes' less-aligned, lower-success attempts.
            fx.pounceHeading = Math.random() < 0.75
                ? MAG_NORTH_HEADING + (Math.random() - 0.5) * 0.5   // ≈ north ±14°
                : Math.random() * Math.PI * 2;                       // an "off" pounce
        }
        if (s === 'rest') {
            const a = fx.actions.CurlSleep;
            play(fx, 'CurlSleep', true, 0.6);   // a slow nap: curl → sleep (breathing) → uncurl
            fx.stateDur = a ? a.getClip().duration / 0.6 : 4.5;
            return;
        }
        const action = fx.actions[STATE_CLIP[s]];
        play(fx, STATE_CLIP[s], true, 1);
        fx.stateDur = action ? action.getClip().duration : 1.0;
    }
    function startBehavior(fx) {
        const r = Math.random();
        if (r < 0.30) setState(fx, 'listen');         // → the hunt (listen then pounce)
        else if (r < 0.45) setState(fx, 'look');
        else if (r < 0.57) setState(fx, 'shake');
        else if (r < 0.69) setState(fx, 'scratch');
        else if (r < 0.81) setState(fx, 'dig');
        else if (r < 0.91) setState(fx, 'stretch');
        else setState(fx, 'rest');                    // curl up to sleep → wake → stretch
    }
    function advanceState(fx) {
        if (fx.state === 'listen') setState(fx, 'pounce');       // the mousing hunt sequence
        else if (fx.state === 'rest') setState(fx, 'stretch');   // wake up with a stretch
        else setState(fx, 'trot');
    }

    // ── Greeting: when two foxes' paths cross they may stop to say hello ──
    // (adapted from sakura-twilight): proximity → %-chance → bow / hop / circle,
    // facing each other, then they part with a cooldown.
    const GREET_DIST = 320;       // world units — "stumble upon" range (~4 fox lengths)
    const GREET_CHANCE = 0.6;     // chance to greet on an encounter
    const GREET_DURATION = 3.0;   // seconds
    function startGreeting(a, b) {
        const type = Math.floor(Math.random() * 3);   // 0 bow · 1 hop · 2 circle
        const mid = a.root.position.clone().add(b.root.position).multiplyScalar(0.5);
        for (const [fx, partner] of [[a, b], [b, a]]) {
            fx.state = 'greet'; fx.stateTime = 0; fx.stateDur = GREET_DURATION;
            fx.greetPartner = partner; fx.greetType = type; fx.greetMid = mid;
            fx.basePos.copy(fx.root.position);
            fx.greetRadius = Math.hypot(fx.root.position.x - mid.x, fx.root.position.z - mid.z);
            fx.greetAng0 = Math.atan2(fx.root.position.z - mid.z, fx.root.position.x - mid.x);
            play(fx, 'Greet', false, 1);   // loops for the greeting duration
        }
        console.log(`[ArcticFox] greeting (${['bow', 'hop', 'circle'][type]})`);
    }
    // Pounce vertical hop, normalised τ over the clip: a small crouch dip, then a
    // hop that peaks mid-clip and lands by ~0.82 (matching the clip's dive→impact).
    function leapHeight(tau) {
        if (tau < 0.18) return -0.12 * Math.sin(Math.PI * tau / 0.18);
        const u = (tau - 0.18) / 0.64;
        return u >= 1 ? 0 : Math.sin(Math.PI * u);
    }
    function lungeAmt(tau) {
        return Math.max(0, Math.sin(Math.PI * tau)) * (tau < 0.6 ? 1 : 0.45);
    }

    async function load() {
        let gltf;
        try {
            gltf = await loader.loadAsync(foxUrl);
        } catch (e) {
            console.warn('[ArcticFox] failed to load arctic-fox.glb:', e);
            return;
        }
        gltf.scene.traverse((o) => {
            if (!o.isMesh) return;
            o.material = makeFurMaterial();   // cool even snow-white fur (TSL)
            o.frustumCulled = false;
            o.castShadow = false;
        });
        const clips = {};
        (gltf.animations ?? []).forEach((c) => { clips[c.name] = c; });
        src = { scene: gltf.scene, clips };
        for (let i = 0; i < count; i += 1) spawn(i);
        console.log(`[ArcticFox] loaded — ${foxes.length} foxes, clips=[${Object.keys(clips).join(', ')}]`);
    }

    function spawn(i) {
        if (!src) return;
        const root = new THREE.Group();
        const model = cloneHierarchy(src.scene);
        const s = scale * (0.85 + Math.random() * 0.3);
        model.scale.setScalar(s);
        root.add(model);
        group.add(root);

        const mixer = new THREE.AnimationMixer(model);
        const actions = {};
        for (const name in src.clips) actions[name] = mixer.clipAction(src.clips[name]);

        const fx = {
            root, mixer, actions,
            path: makePath(i),
            // SLOW travel so the vast scene (~1km to the mountains) takes a long
            // journey to cross — not seconds. The trot's leg cycle is matched to this
            // ground speed each frame in update() so it never foot-skates.
            speed: 0.045 + Math.random() * 0.022,
            modelScale: s,
            t: Math.random() * Math.PI * 2,
            leapAmp: s * 1.25,            // hop ≈ ~2× the fox's height (the real mousing leap)
            lungeAmp: s * 0.5,
            state: '', stateTime: 0, stateDur: 0, trotDur: 0,
            pounceHeading: MAG_NORTH_HEADING,
            greetCooldown: Math.random() * 4, greetPartner: null, greetType: 0,
            greetMid: new THREE.Vector3(), greetRadius: 0, greetAng0: 0,
            basePos: new THREE.Vector3(),
            prevX: 0, prevZ: 0, hasPrev: false,
            current: null,
        };
        foxes.push(fx);
        setState(fx, 'trot');
        fx.stateTime = Math.random() * fx.trotDur;   // stagger so they don't sync up
    }

    function update(dt) {
        // Greeting encounters: tick cooldowns, then pair-check trotting foxes.
        for (const fx of foxes) if (fx.greetCooldown > 0) fx.greetCooldown -= dt;
        for (let i = 0; i < foxes.length; i += 1) {
            const a = foxes[i];
            if (a.state !== 'trot' || a.greetCooldown > 0) continue;
            for (let j = i + 1; j < foxes.length; j += 1) {
                const b = foxes[j];
                if (b.state !== 'trot' || b.greetCooldown > 0) continue;
                const dx = a.root.position.x - b.root.position.x;
                const dz = a.root.position.z - b.root.position.z;
                if (dx * dx + dz * dz < GREET_DIST * GREET_DIST) {
                    if (Math.random() < GREET_CHANCE) startGreeting(a, b);
                    else { a.greetCooldown = 4; b.greetCooldown = 4; }   // passed by
                    break;
                }
            }
        }
        for (const fx of foxes) {
            if (fx.mixer) fx.mixer.update(dt);
            fx.stateTime += dt;
            fx.root.userData.foxState = fx.state;
            if (fx.state === 'trot') {
                fx.t += dt * fx.speed;
                const p = fx.path(fx.t);
                const pn = fx.path(fx.t + 0.03);   // lookahead → heading
                const gy = groundY(p.x, p.z) - footSink;
                fx.root.position.set(p.x, gy, p.z);
                const hx = pn.x - p.x;
                const hz = pn.z - p.z;
                if (hx * hx + hz * hz > 1e-5) fx.root.rotation.y = Math.atan2(hx, hz);
                fx.basePos.set(p.x, gy, p.z);
                // Match the trot's leg cadence to the actual ground speed so the slow
                // travel never foot-skates (stride distance per cycle scales with size).
                if (fx.hasPrev && dt > 1e-4 && fx.current) {
                    const mx = p.x - fx.prevX;
                    const mz = p.z - fx.prevZ;
                    const groundSpeed = Math.sqrt(mx * mx + mz * mz) / dt;
                    const strideRate = fx.modelScale * 0.66;   // units/s the clip strides at timeScale 1
                    fx.current.setEffectiveTimeScale(THREE.MathUtils.clamp(groundSpeed / strideRate, 0.25, 2.2));
                }
                fx.prevX = p.x; fx.prevZ = p.z; fx.hasPrev = true;
                if (fx.stateTime >= fx.trotDur) startBehavior(fx);
            } else if (fx.state === 'greet') {
                const partner = fx.greetPartner;
                if (partner) {                              // turn to face the friend
                    const px = partner.root.position.x - fx.root.position.x;
                    const pz = partner.root.position.z - fx.root.position.z;
                    if (px * px + pz * pz > 1) {
                        fx.root.rotation.y = approachAngle(fx.root.rotation.y, Math.atan2(px, pz), 4.0, dt);
                    }
                }
                const tau = THREE.MathUtils.clamp(fx.stateTime / fx.stateDur, 0, 1);
                if (fx.greetType === 1) {                   // excited hops
                    const hop = Math.max(0, Math.sin(tau * Math.PI * 4)) * (1 - tau * 0.4);
                    fx.root.position.set(fx.basePos.x, fx.basePos.y + hop * fx.modelScale * 0.45, fx.basePos.z);
                } else if (fx.greetType === 2) {            // circle around each other
                    const ang = fx.greetAng0 + tau * Math.PI * 2;
                    const cx = fx.greetMid.x + Math.cos(ang) * fx.greetRadius;
                    const cz = fx.greetMid.z + Math.sin(ang) * fx.greetRadius;
                    fx.root.position.set(cx, groundY(cx, cz) - footSink, cz);
                } else {                                    // bow — stay put
                    fx.root.position.copy(fx.basePos);
                }
                if (fx.stateTime >= fx.stateDur) {
                    setState(fx, 'trot');
                    fx.greetCooldown = 12 + Math.random() * 6;
                    fx.greetPartner = null;
                }
            } else {
                // While listening (and through the pounce) turn to face magnetic north.
                if (fx.state === 'listen' || fx.state === 'pounce') {
                    fx.root.rotation.y = approachAngle(fx.root.rotation.y, fx.pounceHeading, 2.6, dt);
                }
                if (fx.state === 'pounce') {
                    const tau = THREE.MathUtils.clamp(fx.stateTime / Math.max(0.01, fx.stateDur), 0, 1);
                    const f = lungeAmt(tau) * fx.lungeAmp;
                    fx.root.position.set(
                        fx.basePos.x + Math.sin(fx.root.rotation.y) * f,
                        fx.basePos.y + leapHeight(tau) * fx.leapAmp,
                        fx.basePos.z + Math.cos(fx.root.rotation.y) * f,
                    );
                } else if (fx.state === 'rest') {
                    // sink to lie down as it curls, rise as it uncurls (matches the clip)
                    const tau = THREE.MathUtils.clamp(fx.stateTime / Math.max(0.01, fx.stateDur), 0, 1);
                    const env = tau < 0.25 ? tau / 0.25 : (tau > 0.8 ? Math.max(0, (1 - tau) / 0.2) : 1);
                    fx.root.position.set(fx.basePos.x, fx.basePos.y - env * fx.modelScale * 0.30, fx.basePos.z);
                } else {
                    fx.root.position.copy(fx.basePos);
                }
                if (fx.stateTime >= fx.stateDur) advanceState(fx);
            }
        }
    }

    function dispose() {
        for (const fx of foxes) { if (fx.mixer) fx.mixer.stopAllAction(); group.remove(fx.root); }
        foxes.length = 0;
        scene.remove(group);
    }

    // debug handle (harmless): inspect/stage fox behaviours from the console
    group.userData.foxes = foxes;
    group.userData.setFoxState = setState;
    group.userData.forceGreet = () => { if (foxes.length >= 2) startGreeting(foxes[0], foxes[1]); };

    return { group, load, update, dispose };
}
