/**
 * Shifting Sands — the world: builds and animates every element, owns the camera rig and the
 * event choreography. Shared by the theme (shifting-sands-theme.js) and the playground effect
 * (src/playground/effects/shifting-sands.effect.js), so what is iterated there is what ships.
 *
 * Everything that moves is closed-form in the world clock (plus event timestamps), so motion is
 * frame-rate independent and `seek(t)` reproduces any frame exactly for captures.
 */

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
    MOONS, REST_RIG, SUNS, dirFromAzEl, windDirXZ,
} from './shifting-sands-composition.js';
import {
    ATMOSPHERE_LOOK, createAtmosphere, createNoiseTexture,
} from './shifting-sands-tsl.js';
import { DuneField, createTerrain, GROUND_PULSE_SLOTS } from './shifting-sands-terrain.js';
import { createSky } from './shifting-sands-sky.js';
import { createFormations } from './shifting-sands-rocks.js';
import { WORM_SLOTS, WormDirector, createWorm } from './shifting-sands-worm.js';
import {
    BLOW_SLOTS, FX_TIERS, createSpiceBlows, createSpiceMotes, createSpindrift, createWormSand,
} from './shifting-sands-fx.js';

const DEG = Math.PI / 180;

/** Content budgets per quality tier. */
export const WORLD_TIERS = Object.freeze({
    Minimal: { clouds: false, stars: false, rockDetail: 0.5 },
    Low: { clouds: true, stars: false, rockDetail: 0.65 },
    Medium: { clouds: true, stars: true, rockDetail: 0.8 },
    High: { clouds: true, stars: true },
    Ultra: { clouds: true, stars: true },
    Extreme: { clouds: true, stars: true },
});

/** Degrees each sun sinks by full dusk. */
const DUSK_SINK = Object.freeze({ a: 2.2, b: 4.0 });

/** Where the thumper stands: on the sand just beyond the foot of the board. */
const THUMPER = Object.freeze({ x: 0, z: -150 });

/** Spice-blow sites, alternating between the side zones. */
const BLOW_SITES = Object.freeze([
    { az: -27, dist: 1050 },
    { az: 22, dist: 1250 },
    { az: -38, dist: 1500 },
    { az: 43, dist: 1100 },
    { az: -30, dist: 1900 },
    { az: 37, dist: 1700 },
]);

/** Frame-rate independent exponential approach: fraction of the gap closed in `dt`. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

function setLook(color, [hex, k]) {
    return color.setHex(hex, THREE.SRGBColorSpace).multiplyScalar(k);
}

export class ShiftingSandsWorld {
    /**
     * @param {object} opts
     * @param {THREE.Scene} opts.scene
     * @param {string} [opts.quality]
     * @param {boolean} [opts.capture] deterministic capture mode (no wall-clock randomness)
     */
    constructor({ scene, quality = 'High', capture = false } = {}) {
        this.scene = scene;
        this.quality = WORLD_TIERS[quality] ? quality : 'High';
        this.tier = WORLD_TIERS[this.quality];
        this.capture = capture;
        this.group = new THREE.Group();
        this.group.name = 'shifting-sands-world';
        this.time = 0;
        this.dusk = 0; // 0 golden hour → 1 deep dusk (level progression)
        this.duskTarget = 0;
        this.restPosition = new THREE.Vector3();
        this.restPitch = REST_RIG.pitchDeg * DEG;
        this.pointer = { x: 0, y: 0 };
        this.reducedMotion = false;
        this.parts = null;
        this.keepOut = []; // screen-x spans (fractions) covered by the gameplay boards and the HUD
        this.viewHalfAz = 0;
        this._tmpV = new THREE.Vector3();
        this._sunScreen = { x: 0.25, y: 0.3, visible: 1 };
        this._groundScratch = {
            h: 0, u: 0, amp: 0, base: 0, spice: 0,
        };
    }

    build() {
        const wind = windDirXZ();
        const sunA = dirFromAzEl(SUNS.a.az, SUNS.a.el);
        const sunB = dirFromAzEl(SUNS.b.az, SUNS.b.el);
        this.sunDirA = sunA;
        this.sunDirB = sunB;

        const look = ATMOSPHERE_LOOK.day;
        this.noiseTex = createNoiseTexture();
        const s = {
            uTime: uniform(0),
            uSunA: uniform(sunA.clone()),
            uSunB: uniform(sunB.clone()),
            uSunLightA: uniform(setLook(new THREE.Color(), look.sunLightA)),
            uSunLightB: uniform(setLook(new THREE.Color(), look.sunLightB)),
            uZenith: uniform(setLook(new THREE.Color(), look.zenith)),
            uUpper: uniform(setLook(new THREE.Color(), look.upper)),
            uHorizonWarm: uniform(setLook(new THREE.Color(), look.horizonWarm)),
            uHorizonCool: uniform(setLook(new THREE.Color(), look.horizonCool)),
            uFog: uniform(new THREE.Vector4(0.62e-4, 3.6e-4, 1 / 48, 0.88)),
            uDusk: uniform(0),
            uSunFlare: uniform(0),
            uWind: uniform(0.5),
            uGust: uniform(0),
            uSpiceGlow: uniform(0),
            uPxScale: uniform(1080 / (2 * Math.tan(25 * DEG))),
            uWindDir: uniform(new THREE.Vector2(wind.x, wind.z)),
            noiseTex: this.noiseTex,
        };
        s.atmosphere = createAtmosphere(s);
        this.shared = s;
        // Day/dusk endpoints of every atmosphere colour; applyDusk() lerps between them.
        this.lookPairs = ['sunLightA', 'sunLightB', 'zenith', 'upper', 'horizonWarm', 'horizonCool'].map((key) => ({
            target: s[`u${key[0].toUpperCase()}${key.slice(1)}`].value,
            day: setLook(new THREE.Color(), ATMOSPHERE_LOOK.day[key]),
            dusk: setLook(new THREE.Color(), ATMOSPHERE_LOOK.dusk[key]),
        }));
        this.appliedDusk = -1;
        this.applyDusk(0);

        // ── The erg ──
        this.field = new DuneField({ wind, offset: { x: 1830, z: -420 } });
        // Formations first: their solids join the shadow march.
        this.rocks = createFormations({ field: this.field, shared: s, detail: this.tier.rockDetail ?? 1 });
        this.field.extraHeight = this.rocks.heightAt;
        this.group.add(this.rocks.mesh);
        const mid = sunA.clone().add(sunB).multiplyScalar(0.5).normalize();
        this.terrain = createTerrain({
            field: this.field, shared: s, tierName: this.quality, shadowDir: mid,
        });
        this.group.add(this.terrain.mesh);

        // ── Sky ──
        this.sky = createSky(s, {
            clouds: this.tier.clouds,
            stars: this.tier.stars,
            uMoonA: uniform(dirFromAzEl(MOONS.a.az, MOONS.a.el)),
            uMoonB: uniform(dirFromAzEl(MOONS.b.az, MOONS.b.el)),
            moonRadA: MOONS.a.radiusDeg * DEG,
            moonRadB: MOONS.b.radiusDeg * DEG,
            sunRadA: SUNS.a.radiusDeg * DEG,
            sunRadB: SUNS.b.radiusDeg * DEG,
        });
        this.group.add(this.sky.mesh);

        // ── Shai-Hulud ──
        this.worm = createWorm(s, this.tier.worm || {});
        this.group.add(this.worm.mesh);
        // Captures replay the reference sequence of sites; in play every session draws its own.
        this.director = new WormDirector((x, z) => this.field.sample(x, z, this._groundScratch).h, {
            obstacles: this.rocks.obstacles,
            capture: this.capture,
            salt: this.capture ? 0 : Math.floor(Math.random() * 0xffffffff),
        });
        this.flash = 0;
        this.rumble = 0;

        // ── Sand, spice and dust ──
        const fx = FX_TIERS[this.quality] || FX_TIERS.High;
        this.fxTier = fx;
        this.wormSand = createWormSand(s, this.worm, fx.wormSand);
        this.motes = createSpiceMotes(s, fx.motes);
        this.spindrift = createSpindrift(s, this.field, fx.spindrift);
        this.blows = createSpiceBlows(s, fx.blowPerSlot);
        this.wormSand.mesh.visible = fx.wormSand > 0;
        this.spindrift.mesh.visible = this.spindrift.count > 0;
        this.group.add(this.wormSand.mesh, this.motes.mesh, this.spindrift.mesh, this.blows.mesh);
        this.blowSlot = 0;
        this.pulseSlot = 0;
        this.gust = 0;
        this.spiceGlow = 0;
        this.lastLockAt = -Infinity;

        // ── Rest camera: stand on the sand with the authored clearance ──
        let ground = -Infinity;
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            ground = Math.max(ground, this.field.height(Math.cos(a) * 12, Math.sin(a) * 12));
        }
        ground = Math.max(ground, this.field.height(0, 0));
        this.restPosition.set(0, ground + REST_RIG.clearance, 0);
        this.director.eye = this.restPosition;
        // Draw the first site now, while the build is the frame that stutters: the picker runs
        // cold here, warm on every later cycle.
        this.director.idleBreach(0);

        this.scene.add(this.group);
        return this;
    }

    /** Debug/perf: draw only these parts (dunes, sky, rocks, worm, fx). */
    showOnlyParts(parts) {
        this.parts = new Set(parts);
        const show = (obj, name) => { if (obj) obj.visible = this.parts.has(name); };
        show(this.terrain?.mesh, 'dunes');
        show(this.sky?.mesh, 'sky');
        show(this.rocks?.mesh, 'rocks');
        show(this.worm?.mesh, 'worm');
        ['wormSand', 'motes', 'spindrift', 'blows'].forEach((k) => show(this[k]?.mesh, 'fx'));
    }

    /**
     * The deepening dusk: every atmosphere colour slides toward its dusk value and both suns
     * sink (the bake stores horizon TANGENTS, so lower suns cast longer shadows for free).
     */
    applyDusk(d) {
        const k = Math.min(1, Math.max(0, d));
        if (Math.abs(k - this.appliedDusk) < 1e-4) return;
        this.appliedDusk = k;
        for (let i = 0; i < this.lookPairs.length; i++) {
            const p = this.lookPairs[i];
            p.target.copy(p.day).lerp(p.dusk, k);
        }
        dirFromAzEl(SUNS.a.az, SUNS.a.el - DUSK_SINK.a * k, this.sunDirA);
        dirFromAzEl(SUNS.b.az, SUNS.b.el - DUSK_SINK.b * k, this.sunDirB);
        this.shared.uSunA.value.copy(this.sunDirA);
        this.shared.uSunB.value.copy(this.sunDirB);
        this.shared.uDusk.value = k;
    }

    // ── Camera rig ────────────────────────────────────────────────────────────────

    /**
     * The rig breathes around the rest pose (slow, closed-form drift) and leans with the pointer.
     * @param {THREE.PerspectiveCamera} camera
     * @param {{time:number, pointerX?:number, pointerY?:number}} sim
     */
    updateCamera(camera, sim) {
        const t = sim.time ?? this.time;
        const px = sim.pointerX ?? 0;
        const py = sim.pointerY ?? 0;
        const p = this.restPosition;
        const m = this.reducedMotion ? 0 : 1;
        const bx = (Math.sin(t * 0.071) * 6 + Math.sin(t * 0.173 + 1.3) * 2.2) * m;
        const by = (Math.sin(t * 0.097 + 0.7) * 1.6 + Math.sin(t * 0.21) * 0.6) * m;
        const bz = Math.sin(t * 0.053 + 2.1) * 5 * m;
        // The ground trembles while the worm is near (a fine, decaying tremor; never a shake).
        const r = this.reducedMotion ? 0 : this.rumble;
        const tx = r * (Math.sin(t * 37.0) * 0.35 + Math.sin(t * 23.0 + 1.1) * 0.25);
        const ty = r * (Math.sin(t * 41.0 + 0.4) * 0.3);
        camera.position.set(p.x + bx + px * 14 + tx, p.y + by - py * 5 + ty, p.z + bz);
        const yaw = (Math.sin(t * 0.043) * 0.9 * m + px * 1.6) * DEG;
        const pitch = this.restPitch + (Math.sin(t * 0.061 + 0.4) * 0.35 * m - py * 0.9) * DEG;
        camera.rotation.order = 'YXZ';
        camera.rotation.set(pitch, -yaw, Math.sin(t * 0.05) * 0.12 * DEG * m);
        camera.updateMatrixWorld();
    }

    // ── Simulation ────────────────────────────────────────────────────────────────

    seek(t) {
        this.time = Math.max(0, t);
        this.director?.reset();
        this.flash = 0;
        this.rumble = 0;
    }

    /** Reduced motion: the rig holds still (no breathing, no tremor); events stay. */
    setReducedMotion(reduced) {
        this.reducedMotion = reduced === true;
    }

    /**
     * Game over / new game: the dusk returns to golden hour. A worm that has been called still
     * runs its course — forgetting it here would cut it out of the air in a single frame.
     */
    resetSession() {
        this.duskTarget = 0;
    }

    // ── Events (pure state writes; nothing is created at event time) ─────────────

    /** A thumper beat: a ring of lifted sand runs out across the erg from below the board. */
    onPieceLock() {
        if (this.time - this.lastLockAt < 0.12) return;
        this.lastLockAt = this.time;
        this.pushGroundPulse(THUMPER.x, THUMPER.z, 1);
    }

    onCombo(combo) {
        const c = Number.isFinite(combo) ? combo : 0;
        if (c < 2) return;
        this.spiceGlow = Math.max(this.spiceGlow, Math.min(1.4, 0.25 + c * 0.12));
        this.gust = Math.max(this.gust, Math.min(1, 0.2 + c * 0.08));
    }

    onLineClear(lines) {
        const n = Math.max(1, Math.min(4, lines | 0));
        this.gust = Math.max(this.gust, 0.45 + n * 0.14);
        this.flash = Math.max(this.flash, 0.25 + n * 0.12);
        this.shared.uSunFlare.value = Math.max(this.shared.uSunFlare.value, 0.15 + n * 0.08);
        if (n >= 4) {
            // A Tetris calls the worm: one great blow where it will break the surface. If the
            // last one it called is still above the sand, the spice answers instead.
            if (this.director.summon(this.time)) {
                const em = this.director.summonedEmergence();
                this.spawnSpiceBlowAt(em.x, em.z, this.director.summoned.t0 - 0.7, 1.5);
            } else {
                for (let i = 0; i < BLOW_SLOTS; i++) this.spawnSpiceBlow(this.time + i * 0.22, 1.3);
            }
            this.spiceGlow = Math.max(this.spiceGlow, 1.2);
        } else {
            for (let i = 0; i < Math.min(n, BLOW_SLOTS); i++) {
                this.spawnSpiceBlow(this.time + i * 0.22, 0.8 + n * 0.12);
            }
        }
    }

    pushGroundPulse(x, z, strength) {
        const slot = this.pulseSlot;
        this.pulseSlot = (this.pulseSlot + 1) % GROUND_PULSE_SLOTS;
        this.terrain.uniforms.uPulses.array[slot].set(x, z, this.time, strength);
    }

    /** Place a spice blow in a side zone (alternating), seated on the sand. */
    spawnSpiceBlow(t0, strength) {
        this.blowCount = (this.blowCount || 0) + 1;
        const site = BLOW_SITES[this.blowCount % BLOW_SITES.length];
        const az = site.az * DEG;
        this.spawnSpiceBlowAt(Math.sin(az) * site.dist, -Math.cos(az) * site.dist, t0, strength);
    }

    spawnSpiceBlowAt(x, z, t0, strength) {
        const slot = this.blowSlot;
        this.blowSlot = (this.blowSlot + 1) % BLOW_SLOTS;
        const y = this.field.sample(x, z, this._groundScratch).h;
        this.blows.uBlows.array[slot].set(x, y, z, t0);
        this.blows.uBlowPow.array[slot].set(strength, 0, 0, 0);
        this.pushGroundPulse(x, z, 1.6 * strength);
    }

    onLevelUp(level) {
        const n = Number.isFinite(level) ? level : 1;
        this.duskTarget = Math.min(1, Math.max(0, (n - 1) / 14));
    }

    /**
     * @param {{time:number, delta:number}} sim
     * @param {THREE.Camera} camera
     */
    update(sim, camera) {
        this.time = sim.time;
        const dt = Math.max(0, sim.delta || 0);
        const s = this.shared;
        s.uTime.value = this.time;
        this.dusk += (this.duskTarget - this.dusk) * approach(0.6, dt);
        this.applyDusk(this.dusk);
        // ── Worms: each slot writes its body, its sand and its marks on the erg ──
        const ws = this.director.update(this.time);
        this.worm.apply(ws.slots);
        this.wormSand.apply(ws.slots);
        const tu = this.terrain.uniforms;
        for (let i = 0; i < WORM_SLOTS; i++) {
            const st = ws.slots[i];
            tu.uSigns.array[i].set(st.sign.x, st.sign.z, st.sign.wake, st.sign.strength);
            tu.uSignDirs.array[i].set(st.sign.dx, st.sign.dz, 0, 0);
            tu.uPulses.array[GROUND_PULSE_SLOTS + i].set(st.ring.x, st.ring.z, st.ring.t0, st.ring.strength);
            for (let j = 0; j < 2; j++) {
                const well = st.wells[j];
                tu.uWells.array[i * 2 + j].set(well.x, well.z, well.radius, well.width);
                tu.uWellH.array[i * 2 + j].set(well.rim, well.bulge, well.crater, well.scar);
            }
        }
        const blowArr = this.blows.uBlows.array;
        let blowLive = false;
        for (let i = 0; i < blowArr.length; i++) {
            const age = this.time - blowArr[i].w;
            if (age > -1.5 && age < 6.5) blowLive = true;
        }
        this.blows.setActive(blowLive);
        this.rumble += (ws.rumble - this.rumble) * approach(ws.rumble > this.rumble ? 6 : 1.5, dt);
        this.flash += (0 - this.flash) * approach(2.5, dt);
        this.gust += (0 - this.gust) * approach(0.7, dt);
        this.spiceGlow += (0 - this.spiceGlow) * approach(0.5, dt);
        s.uGust.value = this.gust;
        s.uSpiceGlow.value = this.spiceGlow;
        s.uWind.value = 0.55 + Math.sin(this.time * 0.11) * 0.15 + Math.sin(this.time * 0.37 + 1.2) * 0.08;
        s.uSunFlare.value += (0 - s.uSunFlare.value) * approach(1.5, dt);

        if (camera) this.updateSunScreen(camera);
    }

    /** Project the primary sun into screen UV (y down) for the post's shafts and flare. */
    updateSunScreen(camera) {
        const v = this._tmpV.copy(this.sunDirA).multiplyScalar(10000).add(camera.position);
        v.project(camera);
        const inFront = v.z < 1 ? 1 : 0;
        this._sunScreen.x = v.x * 0.5 + 0.5;
        this._sunScreen.y = 0.5 - v.y * 0.5;
        const edgeFade = (c) => Math.max(0, 1 - Math.max(0, Math.abs(c) - 1) * 4);
        const onScreen = edgeFade(v.x) * edgeFade(v.y);
        this._sunScreen.visible = inFront * onScreen;
        // Far horizon line in screen UV (for the heat haze band).
        const h = this._tmpV.set(0, camera.position.y - 6, -12000).project(camera);
        this._sunScreen.horizonY = 0.5 - h.y * 0.5;
        return this._sunScreen;
    }

    getSunScreen() {
        return this._sunScreen;
    }

    /** Pixel-sized content follows the drawing buffer; the worm's range follows the lens. */
    setViewport(bufferHeight, camera) {
        const fov = (camera?.fov ?? REST_RIG.fov) * DEG;
        this.shared.uPxScale.value = Math.max(1, bufferHeight) / (2 * Math.tan(fov / 2));
        this.viewHalfAz = Math.atan(Math.tan(fov / 2) * (camera?.aspect ?? 16 / 9)) / DEG;
        this.syncWormView();
    }

    /**
     * The gameplay boards and the HUD (screen fractions, as the post's calm zones read them):
     * the worm keeps clear of what they cover.
     */
    setKeepOutRects(rects) {
        this.keepOut = (rects || []).filter(Boolean).map((r) => [r.x0, r.x1]);
        this.syncWormView();
    }

    syncWormView() {
        if (!this.director || !(this.viewHalfAz > 0)) return;
        const edge = Math.tan(this.viewHalfAz * DEG);
        const azOf = (x) => Math.atan((x * 2 - 1) * edge) / DEG;
        this.director.setView({
            halfAz: this.viewHalfAz,
            bands: this.keepOut.map(([x0, x1]) => [azOf(x0), azOf(x1)]),
        });
    }

    dispose() {
        this.scene.remove(this.group);
        this.terrain?.dispose();
        this.sky?.dispose();
        this.rocks?.dispose();
        this.rocks = null;
        this.worm?.dispose();
        this.worm = null;
        ['wormSand', 'motes', 'spindrift', 'blows'].forEach((k) => { this[k]?.dispose(); this[k] = null; });
        this.noiseTex?.dispose();
        this.terrain = null;
        this.sky = null;
        this.noiseTex = null;
    }
}
