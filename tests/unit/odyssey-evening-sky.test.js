/**
 * THE EVENING (chapter 5's own sky; the sky pass, 2026-11-17): its schedule, its lights against
 * the real camera, its cloud floor and cap against the real rail, and its shaders on both
 * backends without a GPU.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
    float, normalize, positionWorld, cameraPosition, uniform, vec3,
} from 'three/tsl';
import { build, unassignedReads } from './helpers/tsl-node-build.js';
import { createOdysseyCameraRig } from './helpers/odyssey-camera-rig.js';
import {
    ODYSSEY_EVENING,
    ODYSSEY_EVENING_U,
    ODYSSEY_MOON,
    eveningActT,
    eveningAir,
    eveningCirrusColour,
    eveningCirrusCover,
    eveningCloudLitShare,
    eveningCloudWhite,
    eveningDome,
    eveningLights,
    eveningMoonDirection,
    eveningSunDirection,
    odysseyEveningAt,
    updateOdysseyEvening,
} from '../../src/rendering/odyssey/world/odyssey-evening.js';
import {
    CLOUD_SEA_SLOPE_RANGE,
    ODYSSEY_CLOUD_SEA,
    bakeCloudSeaField,
    cloudSeaCover,
    createOdysseyCloudSea,
    planCloudSeaLobes,
} from '../../src/rendering/odyssey/world/odyssey-cloud-sea.js';
import {
    ODYSSEY_SUMMIT_CAP,
    createOdysseySummitCap,
    summitCapLife,
} from '../../src/rendering/odyssey/world/odyssey-summit-cap.js';
import {
    ODYSSEY_WALL_GUSTS,
    createOdysseyWallGusts,
    wallGustsRevealAt,
} from '../../src/rendering/odyssey/world/odyssey-wall-gusts.js';
import { ODYSSEY_WORLD_SUN } from '../../src/rendering/odyssey/chapter-environments/shared/chapter-profile.js';
import { ODYSSEY_MASSIFS, odysseyWorldHeight } from '../../src/rendering/odyssey/world/odyssey-world-height.js';
import { findHeroSummit } from '../../src/rendering/odyssey/composition/odyssey-summit-spindrift.js';
import { getOdysseyPathPointAt } from '../../src/rendering/odyssey/path-utils.js';
import { getLevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { orbitEarthAt } from '../../src/rendering/odyssey/composition/odyssey-orbit-earth.js';

const BACKENDS = [['WGSL', THREE.WGSLNodeBuilder], ['GLSL', THREE.GLSLNodeBuilder]];
const DEG = Math.PI / 180;
const layout = getLevelRegistry().getPresentationLayout();
const cp = layout.chapterPositions;
/** Orbs 27..34 (chapter 5), journey progress. */
const ORBS = layout.levelPositions.slice(26, 34);
const at = (p, time = 0) => odysseyEveningAt(eveningActT(p), time);

function expectClean(result, label) {
    expect(result.thrown, `${label} threw: ${result.thrown?.message}`).toBeUndefined();
    expect(result.heard, `${label} said: ${result.heard.join(' | ')}`).toEqual([]);
    expect(result.fragment.length, `${label} fragment`).toBeGreaterThan(200);
}

describe('the evening: its schedule', () => {
    it('is keyed on the layout it was written for (the act it converts to)', () => {
        // The schedule is authored in journey progress and converted with these two numbers; a
        // re-layout that moves Act II must re-derive them (as the bow's windows and the colour
        // script are re-derived).
        expect(cp[1]).toBeCloseTo(0.0649, 3);
        expect(cp[5] - cp[1]).toBeCloseTo(0.6894, 3);
        expect(ORBS[0]).toBeCloseTo(cp[4], 3);
    });

    it('is nothing at all below chapter 4\'s last orb: chapters 2-4 keep their noon', () => {
        [0.07, 0.15, 0.25, 0.30, 0.334].forEach((p) => {
            const e = at(p, 37);
            expect(e.dusk, `dusk at ${p}`).toBe(0);
            expect(e.moon).toBe(0);
            expect(e.cloud).toBe(0);
            expect(e.sea).toBe(0);
            expect(e.cap).toBe(0);
            expect(e.shafts).toBe(0);
            expect(e.stars).toBe(0);
            expect(e.glory).toBe(0);
            expect(e.belt).toBe(0);
            expect(e.breath).toBe(1);
            expect(e.sunElevation).toBeCloseTo(Math.asin(ODYSSEY_WORLD_SUN[1] / Math.hypot(...ODYSSEY_WORLD_SUN)), 9);
        });
    });

    it('runs through the whole climb: every orb stands at its own hour', () => {
        const dusk = ORBS.map((p) => at(p).dusk);
        // L27 just begun, L32 (the eye at the summit's height) the sun low; each orb between a
        // real step on from the last.
        expect(dusk[0]).toBeGreaterThan(0.01);
        expect(dusk[0]).toBeLessThan(0.08);
        for (let i = 1; i <= 5; i += 1) expect(dusk[i] - dusk[i - 1], `L${27 + i}`).toBeGreaterThan(0.12);
        expect(dusk[5]).toBeGreaterThan(0.95);
        expect(dusk[6]).toBe(1);
        expect(dusk[7]).toBe(1);
    });

    it('lets the sky\'s sun sink and never rise, on the world sun\'s own bearing', () => {
        let last = Infinity;
        for (let p = 0.30; p <= 0.76; p += 0.002) {
            const e = at(p).sunElevation;
            expect(e).toBeLessThanOrEqual(last + 1e-12);
            last = e;
        }
        expect(at(0.33).sunElevation / DEG).toBeCloseTo(15, 0);
        expect(at(0.66).sunElevation / DEG).toBeCloseTo(ODYSSEY_EVENING.sunTo, 6);
        // Low enough for the belt, and the antisolar point still falls on the cloud floor from
        // the summit's height (~310 u over its tops): within the floor's reach.
        const reach = 310 / Math.tan(ODYSSEY_EVENING.sunTo * DEG);
        expect(reach).toBeGreaterThan(ODYSSEY_CLOUD_SEA.clear[1] + ODYSSEY_CLOUD_SEA.ramp);
        expect(reach).toBeLessThan(5200);
        const dir = eveningSunDirection(4.5 * DEG);
        expect(dir.length()).toBeCloseTo(1, 9);
        const flat = Math.hypot(ODYSSEY_WORLD_SUN[0], ODYSSEY_WORLD_SUN[2]);
        expect(Math.atan2(dir.z, dir.x))
            .toBeCloseTo(Math.atan2(ODYSSEY_WORLD_SUN[2] / flat, ODYSSEY_WORLD_SUN[0] / flat), 9);
    });

    it('never steps: every field is continuous in progress (no pops on the rail)', () => {
        const fields = ['dusk', 'sunElevation', 'warm', 'belt', 'beltAt', 'beltWidth', 'shadow', 'shadowTop',
            'stars', 'moon', 'rays', 'shafts', 'cloud', 'sea', 'cap', 'glory', 'breath'];
        // The fastest thing here comes in over ~0.014 of progress (the shafts and the moon, across
        // the 4->5 glide, about a second and a half of travel): nothing may be quicker than that.
        // (Each field against its own range: the shafts' gain runs past 1 at the seam's fan.)
        const step = 0.0005;
        const samples = [];
        for (let p = 0.30; p <= 0.78; p += step) samples.push([p, at(p, 11)]);
        const range = Object.fromEntries(fields.map((f) => {
            const values = samples.map(([, e]) => e[f]);
            return [f, Math.max(Math.max(...values) - Math.min(...values), 1)];
        }));
        samples.slice(1).forEach(([p, now], i) => {
            const before = samples[i][1];
            fields.forEach((f) => {
                expect(Math.abs(now[f] - before[f]) / range[f], `${f} at ${p.toFixed(4)}`).toBeLessThan(0.06);
            });
        });
    });

    it('orders the evening: shafts with the gold, the belt with the low sun, the stars last', () => {
        // L27 .. L29: the low sun's shafts across the sky; no belt yet.
        expect(at(ORBS[2]).shafts).toBeGreaterThan(0.9);
        expect(at(ORBS[2]).shafts).toBeLessThanOrEqual(1);
        // THE FAN at the seam: strongest where the chapter begins, eased back up the wall.
        expect(at(ORBS[0]).shafts).toBeGreaterThan(2);
        expect(at(ORBS[0]).shafts).toBeGreaterThan(at(0.37).shafts);
        expect(at(ORBS[1]).shafts).toBeCloseTo(1, 6);
        expect(at(ORBS[1]).belt).toBeLessThan(0.02);
        // L31 on: the belt and its rays; the shafts have gone.
        expect(at(ORBS[4]).belt).toBeGreaterThan(0.8);
        expect(at(ORBS[5]).shafts).toBe(0);
        // No star before the eye is out above the summit; the field by the top of the climb.
        expect(at(ORBS[5]).stars).toBe(0);
        expect(at(ORBS[6]).stars).toBeGreaterThan(0);
        expect(at(ORBS[6]).stars).toBeLessThan(0.25);
        expect(at(0.722).stars).toBeGreaterThan(0.9);
        // The floor has gathered and the cap has formed by the time they are looked down on.
        expect(at(ORBS[1]).sea).toBeGreaterThan(0);
        expect(at(ORBS[5]).sea).toBe(1);
        expect(at(ORBS[0]).cap).toBe(0);
        expect(at(ORBS[2]).cap).toBe(1);
        // The glory only where the eye is over the floor.
        expect(at(ORBS[4]).glory).toBe(0);
        expect(at(ORBS[6]).glory).toBe(1);
        expect(at(0.722).glory).toBe(0);
    });

    it('eases the clouds\' light where the round Earth takes over, under the same low sun', () => {
        const peak = at(ORBS[5]).cloud;
        expect(peak).toBeGreaterThan(0.45);
        expect(at(0.7225).cloud).toBeCloseTo(ODYSSEY_EVENING.clearShare, 6);
        // ...and they are gold from the first orb of the chapter, not only once the dusk is deep.
        expect(at(ORBS[0]).cloud).toBeGreaterThan(0.33);
        expect(at(0.333).cloud).toBe(0);
        // ...and the Earth has arrived before the evening's light has eased, lit by the evening's
        // own low sun (the evening Earth of odyssey-orbit-earth.js: it used to arrive in daylight,
        // its sun at 0.3 rad and more).
        expect(orbitEarthAt(0.66, cp).presence).toBe(1);
        const earthSun = orbitEarthAt(ODYSSEY_EVENING.clear[0], cp).sunElevation;
        expect(earthSun).toBeGreaterThan(0.04);
        expect(earthSun).toBeLessThan(0.14);
    });

    it('breathes on the clock, within its bound, only while the evening runs', () => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let t = 0; t < 400; t += 1.5) {
            const b = at(0.50, t).breath;
            lo = Math.min(lo, b);
            hi = Math.max(hi, b);
            expect(at(0.20, t).breath).toBe(1);
        }
        expect(hi - lo).toBeGreaterThan(ODYSSEY_EVENING.breath);
        expect(hi).toBeLessThanOrEqual(1 + ODYSSEY_EVENING.breath + 1e-9);
        expect(lo).toBeGreaterThanOrEqual(1 - ODYSSEY_EVENING.breath - 1e-9);
    });

    it('writes its uniforms, and is neutral again when the journey leaves the evening', () => {
        updateOdysseyEvening(eveningActT(0.60), 12, null);
        expect(ODYSSEY_EVENING_U.dusk.value).toBeGreaterThan(0.9);
        expect(ODYSSEY_EVENING_U.sunDir.value.y).toBeLessThan(0.12);
        expect(ODYSSEY_EVENING_U.antiDir.value.dot(ODYSSEY_EVENING_U.sunDir.value)).toBeCloseTo(-1, 9);
        updateOdysseyEvening(eveningActT(0.20), 12, null);
        expect(ODYSSEY_EVENING_U.dusk.value).toBe(0);
        expect(ODYSSEY_EVENING_U.moon.value).toBe(0);
        const world = new THREE.Vector3(...ODYSSEY_WORLD_SUN).normalize();
        expect(ODYSSEY_EVENING_U.sunDir.value.distanceTo(world)).toBeLessThan(1e-9);
    });
});

describe('the evening: the moon, against the real camera', () => {
    const rig = createOdysseyCameraRig();
    const moon = eveningMoonDirection();
    const inFrame = (p, pad) => {
        const cam = rig.poseAt(p);
        return rig.inFrame(cam, cam.position.clone().addScaledVector(moon, 5000), pad);
    };

    it('stands over the summit\'s banner through the face of the climb', () => {
        expect(moon.length()).toBeCloseTo(1, 9);
        expect(ODYSSEY_MOON.elevationDeg).toBeGreaterThan(30);
        // L27 .. L30: in frame (L31's long lens holds the horn alone).
        ORBS.slice(0, 4).forEach((p, i) => expect(inFrame(p, 1), `L${27 + i}`).toBe(true));
    });

    it('is out of frame, look-around included, while the world\'s sky gives way to space', () => {
        // The dome fades into chapter 6's sky from p ~0.70; a moon fading with it must not be on
        // screen. The mouse's look-around turns the view at most 16 deg (LOOK_AROUND), a third of
        // the frame: 1.4 pads it.
        for (let p = 0.69; p <= 0.775; p += 0.005) expect(inFrame(p, 1.4), `p ${p.toFixed(3)}`).toBe(false);
    });

    it('is a half moon lit from the sun\'s side', () => {
        updateOdysseyEvening(eveningActT(0.50), 0, null);
        const light = ODYSSEY_EVENING_U.moonLight.value;
        expect(light.length()).toBeCloseTo(1, 6);
        // The sun stands about a quarter of the sky round from it: the light falls across its face.
        expect(Math.abs(light.z)).toBeLessThan(0.45);
        expect(Math.hypot(light.x, light.y)).toBeGreaterThan(0.85);
    });
});

describe('the sea of clouds', () => {
    it('bakes one plate, the same bytes every time, that tiles', () => {
        const a = bakeCloudSeaField(64);
        const b = bakeCloudSeaField(64);
        expect(a.data).toEqual(b.data);
        expect(a.cover).toBeGreaterThan(0.9);
        expect(planCloudSeaLobes().length).toBeGreaterThan(400);
        // Tiling: the height across the wrap is as smooth as it is anywhere else.
        const res = 128;
        const plate = bakeCloudSeaField(res);
        const h = (i, j) => plate.data[((j * res) + i) * 4];
        let inner = 0;
        let seam = 0;
        for (let j = 0; j < res; j += 1) {
            inner = Math.max(inner, Math.abs(h(res / 2, j) - h((res / 2) - 1, j)));
            seam = Math.max(seam, Math.abs(h(0, j) - h(res - 1, j)), Math.abs(h(j, 0) - h(j, res - 1)));
        }
        expect(seam).toBeLessThanOrEqual(inner + 40);
        // A floor with relief: most of it mid-height, some of it standing tall, lanes left open.
        let tall = 0;
        let open = 0;
        for (let k = 0; k < res * res; k += 1) {
            if (plate.data[k * 4] > 150) tall += 1;
            if (plate.data[k * 4] < 8) open += 1;
        }
        expect(tall / (res * res)).toBeGreaterThan(0.02);
        expect(open / (res * res)).toBeGreaterThan(0.004);
        expect(open / (res * res)).toBeLessThan(0.10);
        expect(CLOUD_SEA_SLOPE_RANGE).toBeGreaterThan(4);
    });

    it('is not there until the evening gathers it, and gathers from the horizon inward', () => {
        const S = ODYSSEY_CLOUD_SEA;
        const far = [S.centre.x - 7500, S.centre.z + 300];
        const near = [S.centre.x - 1900, S.centre.z + 300];
        expect(cloudSeaCover(far[0], far[1], 0)).toBe(0);
        expect(cloudSeaCover(near[0], near[1], 0)).toBe(0);
        expect(cloudSeaCover(far[0], far[1], 0.5)).toBeGreaterThan(0.9 * S.cover);
        expect(cloudSeaCover(near[0], near[1], 0.5)).toBeLessThan(0.1);
        expect(cloudSeaCover(near[0], near[1], 1)).toBeGreaterThan(0.5);
        // Gone at the mesh's rim (no straight edge on the horizon).
        expect(cloudSeaCover(S.centre.x + S.outer, S.centre.z, 1)).toBe(0);
    });

    it('leaves the mountain, the rail and the island\'s lee in clear air', () => {
        const S = ODYSSEY_CLOUD_SEA;
        // No cloud anywhere near the rail through chapters 4 and 5 (the eye never enters the floor).
        for (let p = 0.25; p <= 0.76; p += 0.004) {
            const pt = getOdysseyPathPointAt(p);
            expect(cloudSeaCover(pt.x, pt.z, 1), `rail at ${p.toFixed(3)}`).toBe(0);
            const dist = Math.hypot(pt.x - S.centre.x, pt.z - S.centre.z);
            if (p > 0.34) expect(dist, `rail at ${p.toFixed(3)}`).toBeLessThan(S.clear[0] - 200);
        }
        // The lee (east-north-east, where L33 looks down on the island) stays open further out
        // than the far side.
        const lee = cloudSeaCover(S.centre.x + (S.open[0] * 1400), S.centre.z + (S.open[1] * 1400), 1);
        const farSide = cloudSeaCover(S.centre.x - (S.open[0] * 1400), S.centre.z - (S.open[1] * 1400), 1);
        expect(lee).toBe(0);
        expect(farSide).toBeGreaterThan(0.2);
        // The floor's base is over the island's lowlands and under the summit: only the hero
        // massif stands through it near the rail.
        const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
        expect(S.base).toBeLessThan(hero.footY + hero.height - 300);
        expect(S.base).toBeGreaterThan(odysseyWorldHeight(S.centre.x + 1500, S.centre.z - 600) + 60);
        // Its tallest top stays under the eye at the summit's height (L33).
        expect(S.base + S.amp).toBeLessThan(getOdysseyPathPointAt(ORBS[6]).y + 30);
    });

    it('builds within its triangle budget and compiles on both backends', () => {
        const kit = {
            cameraPosition,
            skyAirAt: (dir) => eveningAir(vec3(0.6, 0.7, 0.9), dir, uniform(new THREE.Color(1, 0.7, 0.5))),
            toCloudOutput: (c) => c,
            sunColour: uniform(new THREE.Color(1, 0.7, 0.5)),
            cloudWhite: eveningCloudWhite(vec3(0.97, 0.975, 0.99), uniform(new THREE.Color(1, 0.7, 0.5))),
            aerialK: uniform(0.00025),
            cloudShadowLight: () => float(0.8),
        };
        const high = createOdysseyCloudSea({ ...kit, quality: 'high' });
        const low = createOdysseyCloudSea({ ...kit, quality: 'low' });
        // (the tops and the bed, on one ring)
        expect(high.triangles).toBeLessThanOrEqual(120000);
        expect(low.triangles).toBeLessThanOrEqual(44000);
        // The bed is a blended sheet under the opaque tops, drawn with the sea.
        expect(high.bed.material.transparent).toBe(true);
        expect(high.bed.material.depthWrite).toBe(false);
        expect(high.tops.material.transparent).toBe(false);
        // After the sea (1) by order, not by a sort tie: at a tie the water drew over it from high up.
        expect(high.bed.renderOrder).toBeGreaterThan(1);
        expect(high.mesh.visible).toBe(false);
        high.update(30, 0.6, true);
        expect(high.mesh.visible).toBe(true);
        high.update(30, 0.6, false);
        expect(high.mesh.visible).toBe(false);
        high.update(30, 0, true);
        expect(high.mesh.visible).toBe(false);
        // The drift is wrapped to one tile however long the session.
        high.update(1e6, 1, true);
        expect(Math.abs(high.uniforms.uDrift.value.x)).toBeLessThan(1);
        expect(Math.abs(high.uniforms.uDrift.value.y)).toBeLessThan(1);
        [high, low].forEach((sea) => {
            [sea.tops, sea.bed].forEach((layer) => {
                BACKENDS.forEach(([label, Builder]) => {
                    const result = build(Builder, layer);
                    expectClean(result, `${layer.name} ${label}`);
                    if (label === 'WGSL') expect(unassignedReads(result.fragment)).toEqual([]);
                });
            });
            sea.dispose();
        });
    });
});

describe('the summit\'s cap', () => {
    const hero = ODYSSEY_MASSIFS.find((m) => m.id === 'hero');
    const summit = findHeroSummit(odysseyWorldHeight, hero);

    it('forms and thins on the clock: never the same stack for long, never empty for long', () => {
        const C = ODYSSEY_SUMMIT_CAP;
        let some = 0;
        let all = 0;
        let none = 0;
        const N = 4000;
        for (let i = 0; i < N; i += 1) {
            const t = i * 1.7;
            const lives = C.lenses.map((l) => summitCapLife(t, l));
            lives.forEach((v) => {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            });
            if (lives.some((v) => v > 0.6)) some += 1;
            if (lives.every((v) => v > 0.6)) all += 1;
            if (lives.every((v) => v < 0.05)) none += 1;
        }
        expect(some / N).toBeGreaterThan(0.85);
        expect(all / N).toBeGreaterThan(0.08);
        expect(all / N).toBeLessThan(0.6);
        expect(none / N).toBeLessThan(0.05);
        // Continuous in time.
        C.lenses.forEach((l) => {
            for (let t = 0; t < 300; t += 0.25) {
                expect(Math.abs(summitCapLife(t + 0.25, l) - summitCapLife(t, l))).toBeLessThan(0.03);
            }
        });
    });

    it('stands in the lee, clear of the rail', () => {
        const C = ODYSSEY_SUMMIT_CAP;
        const foot = {
            x: summit.x + (C.wind[0] * C.lee),
            y: summit.y + C.lift,
            z: summit.z + (C.wind[1] * C.lee),
        };
        const gaps = [];
        for (let p = 0.25; p <= 0.78; p += 0.002) {
            const pt = getOdysseyPathPointAt(p);
            C.lenses.forEach((l) => {
                const cx = foot.x + (C.wind[0] * l.y * C.lean);
                const cz = foot.z + (C.wind[1] * l.y * C.lean);
                gaps.push(Math.hypot(pt.x - cx, pt.y - (foot.y + l.y), pt.z - cz) - (l.radius * C.stretch));
            });
        }
        const nearest = Math.min(...gaps);
        expect(nearest).toBeGreaterThan(110);
        // Above the tip, not on it.
        expect(foot.y - C.lenses[0].half).toBeGreaterThan(summit.y + 60);
    });

    it('is closed hulls in one draw, and compiles on both backends', () => {
        const sun = uniform(new THREE.Color(1, 0.7, 0.5));
        const cap = createOdysseySummitCap({
            summit,
            cameraPosition,
            skyAirAt: (dir) => eveningAir(vec3(0.6, 0.7, 0.9), dir, sun),
            toCloudOutput: (c) => c,
            sunColour: sun,
            cloudWhite: eveningCloudWhite(vec3(0.97, 0.975, 0.99), sun),
        });
        const pos = cap.mesh.geometry.getAttribute('position');
        expect(cap.mesh.geometry.instanceCount).toBe(ODYSSEY_SUMMIT_CAP.lenses.length);
        expect(cap.mesh.geometry.index.count / 3).toBeLessThan(2000);
        // The rim closes: the outermost ring of each side has no thickness.
        let rim = 0;
        for (let i = 0; i < pos.count; i += 1) {
            if (Math.hypot(pos.getX(i), pos.getZ(i)) > 0.9999) {
                rim += 1;
                expect(Math.abs(pos.getY(i))).toBeLessThan(1e-6);
            }
        }
        expect(rim).toBe(ODYSSEY_SUMMIT_CAP.segments * 2);
        expect(cap.mesh.visible).toBe(false);
        cap.update(10, 1, true);
        expect(cap.mesh.visible).toBe(true);
        cap.update(10, 0, true);
        expect(cap.mesh.visible).toBe(false);
        BACKENDS.forEach(([label, Builder]) => expectClean(build(Builder, cap.mesh), `summit cap ${label}`));
        cap.dispose();
    });
});

describe("the wall's gusts (the 4->5 seam's own event)", () => {
    it('are nothing in chapter 4, whole at L27, gone before L29', () => {
        expect(wallGustsRevealAt(0.30)).toBe(0);
        expect(wallGustsRevealAt(0.3356)).toBe(0);
        expect(wallGustsRevealAt(ORBS[0])).toBeGreaterThan(0.99);
        expect(wallGustsRevealAt(0.37)).toBe(1);
        expect(wallGustsRevealAt(ORBS[1])).toBeGreaterThan(0.6);
        expect(wallGustsRevealAt(ORBS[2])).toBe(0);
        for (let p = 0.33; p < 0.46; p += 0.0005) {
            expect(Math.abs(wallGustsRevealAt(p + 0.0005) - wallGustsRevealAt(p))).toBeLessThan(0.07);
        }
    });

    it('are born in the world, upwind of the rail up the wall, and cross it', () => {
        const C = ODYSSEY_WALL_GUSTS;
        const wind = new THREE.Vector3(...C.wind).normalize();
        // Half way down a run from the box's centre the gusts are passing the rail between L27
        // and L28 (the eye rises through them), not somewhere off the frame.
        const mid = new THREE.Vector3(...C.centre).addScaledVector(wind, C.run * 0.5);
        let nearest = Infinity;
        for (let p = ORBS[0]; p <= ORBS[1]; p += 0.002) {
            const pt = getOdysseyPathPointAt(p);
            nearest = Math.min(nearest, Math.hypot(pt.x - mid.x, pt.y - mid.y, pt.z - mid.z));
        }
        expect(nearest).toBeLessThan(140);
        // The box stands over the land, clear of the ground under it.
        expect(C.centre[1] - C.spread[1]).toBeGreaterThan(odysseyWorldHeight(C.centre[0], C.centre[2]) - 80);
    });

    it('compile on both backends, hidden until revealed', () => {
        const gusts = createOdysseyWallGusts({ sunColour: uniform(new THREE.Color(1, 0.8, 0.55)) });
        expect(gusts.mesh.geometry.instanceCount).toBe(ODYSSEY_WALL_GUSTS.count.high);
        expect(gusts.mesh.visible).toBe(false);
        gusts.update(5, 1, true);
        expect(gusts.mesh.visible).toBe(true);
        gusts.update(5, 1, false);
        expect(gusts.mesh.visible).toBe(false);
        BACKENDS.forEach(([label, Builder]) => expectClean(build(Builder, gusts.mesh), `wall gusts ${label}`));
        gusts.dispose();
    });
});

describe('the evening: its sky, on both backends', () => {
    it('builds the dome\'s air, its lights and the clouds\' white', () => {
        const sun = uniform(new THREE.Color(1, 0.7, 0.5));
        const dir = normalize(positionWorld.sub(cameraPosition));
        const material = new THREE.MeshBasicNodeMaterial();
        const air = eveningDome(eveningAir(vec3(0.5, 0.6, 0.9), dir, sun), dir, sun);
        material.colorNode = air
            .add(eveningLights(dir))
            .add(eveningCirrusColour(vec3(1), sun).mul(eveningCirrusCover(float(0.1))))
            .add(eveningCloudWhite(vec3(0.97, 0.975, 0.99), sun).mul(eveningCloudLitShare(0.7)));
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 8, 6), material);
        BACKENDS.forEach(([label, Builder]) => {
            const result = build(Builder, mesh);
            expectClean(result, `evening sky ${label}`);
            if (label === 'WGSL') expect(unassignedReads(result.fragment)).toEqual([]);
        });
    });
});
