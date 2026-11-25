/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE CITY'S WALLS AND ROOFS (2026-11-25 rebuild), one material for every tower box,
 * tier, ledge and drum of chapter 8.
 *
 * The 2026-10 facade drew a window as a flat pane in a flat wall: a tower was a box with a grid on
 * it, and the walls the arrival stands between (a third of those frames) had nothing to show an eye
 * 30 u away. This one gives a wall DEPTH without a triangle more, and a building its parts:
 *
 *   bays that fit   a whole number of bays between two solid corners on every face (no window cut by
 *                   a corner), floors that run on through a tower's setbacks, a parapet over the
 *                   last whole floor;
 *   a recess        every window sits back in its wall (`rd`, by style): the eye's ray is carried
 *                   from the wall's face to the glass, and where it leaves the opening first it
 *                   meets a jamb, the sill or the head, each lit its own way. A lit room throws its
 *                   light on its own reveals;
 *   a room          behind the glass (interior mapping, as before, now from the glass plane), with
 *                   a frame, a mullion, blinds drawn to a level of their own and curtains;
 *   a base, a shaft a lit shopfront floor at the street, plant floors (louvres) up the shaft,
 *   and a top       spandrels, stains under the sills, a coping, light washing up a tier from the
 *                   setback it stands on;
 *   the signs' spill what each sign of the boulevard throws on the wall round it (the wall glow map,
 *                   odyssey-neon-city-plan.js bakeNeonWallGlow): pools of its colour on the stone
 *                   and in the glass;
 *   a roof          a coping round it, pavers or a membrane with seams, skylights lit from below,
 *                   solar rows, a helipad on the tall flat ones, a row of lamps inside the parapet,
 *                   a door lamp's pool, rain standing in puddles.
 *
 * Parts (`aArch.w`, NEON_PART): a storey-bearing box, a ledge slab, a drum (a prism whose `uv.x`
 * runs round its perimeter); +4 on the part that carries the tower's top.
 *
 * The four flat varyings keep the names the layout test pins (vCityFacade, vCityDimensions,
 * vCityFaceNormal, vCityGutter).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    clamp,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    min,
    mix,
    mod,
    normalGeometry,
    normalize,
    oneMinus,
    reflect,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { STREET_Y } from './odyssey-neon-city-plan.js';
import { NEON_FACADE_MODULE } from './odyssey-neon-architecture.js';
import {
    NEON_AIR,
    neonAir,
    neonCityPos,
    neonGlow,
    neonIgnition,
    neonSpireLight,
    neonWallGlow,
} from './odyssey-neon-light.tsl.js';
import { neonSkyLite } from './odyssey-neon-sky.tsl.js';
import { hash21 } from './odyssey-tsl-noise.js';
import { latticeNoise3 } from './odyssey-lattice-noise.js';

/** The facade's own numbers (corridor units), beside the value settings the chapter passes. */
export const NEON_FACADE = Object.freeze({
    /** The street floor's height: shopfronts. */
    groundHeight: 4.6,
    /** The solid band over the last whole floor of every part. */
    parapet: 0.95,
    /** How far a tier's foot is washed by the lamps on the setback it stands on. */
    washReach: 9,
    /** Roof modules. */
    skylightCell: [5.2, 4.2],
    paver: 1.3,
    solarRow: 2.3,
    lampEvery: 2.1,
});

/** A drum's facets (the prism the rounds are drawn on): its bays are dealt a whole number to each. */
export const DRUM_FACETS = 24;

/**
 * @param {*} uTime
 * @param {*} uEnergy
 * @param {{ uCityLight?: *, uDim?: *, neon: object, interiors?: boolean, relief?: boolean,
 *   settings: object }} options `settings` is CH8_FACADE_VALUE_SETTINGS; `interiors` and `relief`
 *   are the tier's (Low draws flat panes with no room behind them).
 */
export function createNeonFacadeMaterial(uTime, uEnergy, {
    uCityLight, uDim, neon, interiors = true, relief = true, settings,
} = {}) {
    const S = settings;
    const F = NEON_FACADE;
    const M = NEON_FACADE_MODULE;
    const N = neon;
    const arrivalLight = uCityLight ?? uniform(1);
    const dim = uDim ?? uniform(0);

    // Constant per tower/face. Perspective interpolation introduces tiny per-pixel seed differences
    // that the hashes amplify into speckled, crawling windows: flat, `either` (WebGPU's
    // compatibility mode rejects plain `flat`).
    const aFacade = varying(attribute('aFacade', 'vec4'), 'vCityFacade').setInterpolation('flat', 'either');
    const aDims = varying(attribute('aDims', 'vec3'), 'vCityDimensions').setInterpolation('flat', 'either');
    const aArch = varying(attribute('aArch', 'vec4'), 'vCityArch').setInterpolation('flat', 'either');
    const n = varying(normalGeometry, 'vCityFaceNormal').setInterpolation('flat', 'either');
    // The resolve: whole buildings gutter out as uDim rises (per-building threshold).
    const gutter = varying(hash21(vec2(aFacade.x, 91.7)), 'vCityGutter').setInterpolation('flat', 'either');
    const pcVarying = neonCityPos(N, 'vCityPos');

    const colorNode = Fn(() => {
        const seed = aFacade.x;
        const occupancy = aFacade.y;
        const warmBias = aFacade.z;
        const hero = aFacade.w;
        const style = aArch.x;
        const partFoot = aArch.y;
        const tint = aArch.z;
        const partCode = floor(aArch.w.add(0.5)).toVar();
        const kind = mod(partCode, 4.0).toVar();
        const isLedge = step(0.5, kind).mul(step(kind, 1.5)).toVar();
        const isRound = step(1.5, kind).toVar();
        const isTop = step(0.5, mod(floor(partCode.div(4.0)), 2.0)).toVar();
        const isPad = step(7.5, partCode);
        const pc = pcVarying.toVar();

        const isRoof = step(0.5, abs(n.y)).toVar();
        const isSide = oneMinus(isRoof).toVar();
        const onX = step(0.5, abs(n.x));
        const partH = aDims.y;
        const perimeter = aDims.x.add(aDims.z).mul(1.5708);
        const faceW = mix(mix(aDims.x, aDims.z, onX), perimeter, isRound).toVar();

        // ── The style's module (punched 0, ribbon 1, curtain 2, piers 3) ──
        const sRibbon = step(0.5, style).mul(step(style, 1.5)).toVar();
        const sCurtain = step(1.5, style).mul(step(style, 2.5)).toVar();
        const sPiers = step(2.5, style).toVar();
        const sPunched = oneMinus(sRibbon).mul(oneMinus(sCurtain)).mul(oneMinus(sPiers)).toVar();
        const byStyle = (values) => sPunched.mul(values[0]).add(sRibbon.mul(values[1])).add(sCurtain.mul(values[2]))
            .add(sPiers.mul(values[3]));
        const bayAim = byStyle(M.bay);
        const floorH = byStyle(M.storey).toVar();
        // A solid corner on the masonry styles, a thin one on the glass; none round a drum.
        const corner = byStyle(M.corner).mul(oneMinus(isRound)).toVar();
        const span = max(faceW.sub(corner.mul(2.0)), 0.5).toVar();
        // A whole number of bays a face; round a drum, a whole number to each of its facets.
        const baysFlat = max(floor(span.div(bayAim).add(0.5)), 1.0);
        const baysRound = max(floor(span.div(bayAim.mul(DRUM_FACETS)).add(0.5)), 1.0).mul(DRUM_FACETS);
        const bays = mix(baysFlat, baysRound, isRound).toVar();
        const bayW = span.div(bays).toVar();
        const loX = byStyle(M.loX).toVar();
        const loY = byStyle(M.loY).toVar();
        const hiY = byStyle(M.hiY).toVar();
        // How far the glass sits behind the wall's face.
        const recess = byStyle(M.recess);

        // Under MSAA an interpolated coordinate leaves 0..1 on a thin far face.
        const vUv = clamp(uv(), 0.0, 1.0).toVar();
        const fx = vUv.x.mul(faceW).toVar();
        const fy = partFoot.add(vUv.y.mul(partH)).toVar();
        const partTop = partFoot.add(partH).toVar();
        const g = vec2(fx.sub(corner).div(bayW), fy.div(floorH)).toVar();
        const cell = floor(g).toVar();
        const f = fract(g).toVar();
        const fw = fwidth(g).max(vec2(1e-4, 1e-4)).toVar();
        const lod = smoothstep(0.22, 0.7, max(fw.x, fw.y)).toVar();
        // A second, finer fade for what is a few centimetres wide (frames, joints, slats).
        const fine = oneMinus(smoothstep(0.03, 0.12, max(fw.x, fw.y))).toVar();
        // Per-face seed so the four faces of one tower don't repeat; floors use the TOWER seed so
        // a lit floor wraps the whole building. (Cells shifted positive for the hash.)
        const faceSeed = seed.add(n.x.mul(3.17)).add(n.z.mul(7.31)).mul(oneMinus(isRound)).add(seed.mul(isRound));
        const cellH = vec2(cell.x.add(2.0), cell.y).toVar();

        // ── Which floors bear windows ──
        const inSpan = smoothstep(corner.sub(fw.x.mul(bayW)), corner, fx)
            .mul(oneMinus(smoothstep(faceW.sub(corner), faceW.sub(corner).add(fw.x.mul(bayW)), fx)))
            .toVar();
        const floorTop = cell.y.add(1.0).mul(floorH);
        const wholeFloor = step(floorTop.add(F.parapet), partTop.add(0.01));
        const isGround = step(cell.y, 0.5).mul(step(partFoot, 0.5)).toVar();
        // Plant floors: a band of louvres every so often up the shaft, the same round the tower.
        const plantRnd = hash21(vec2(cell.y, seed.mul(1.93).add(41.0)));
        const isPlant = step(0.93, plantRnd).mul(step(3.5, cell.y)).mul(oneMinus(sCurtain.mul(0.5))).toVar();
        const bearsWindows = inSpan.mul(wholeFloor).mul(oneMinus(isPlant)).mul(oneMinus(isLedge)).mul(isSide)
            .toVar();
        // The shopfront: one wide opening a bay.
        const oLoX = mix(loX, float(0.06), isGround).toVar();
        const oHiX = oneMinus(oLoX).toVar();
        const oLoY = mix(loY, float(0.08), isGround).toVar();
        const oHiY = mix(hiY, float(0.9), isGround).toVar();
        const meanPane = oHiX.sub(oLoX).mul(oHiY.sub(oLoY));

        // ── The eye's ray in the wall's own frame: along the face, up, into the wall ──
        const V = normalize(pc.sub(N.camCity)).toVar();
        const vdotn = clamp(dot(V, n).negate(), 0.0, 1.0).toVar();
        const T = vec3(n.z, 0.0, n.x.negate());
        const vAlong = dot(V, T).toVar();

        // ── THE RECESS: carry the ray from the wall's face to the glass ──
        const rect = (p) => smoothstep(oLoX, oLoX.add(fw.x), p.x)
            .mul(oneMinus(smoothstep(oHiX.sub(fw.x), oHiX, p.x)))
            .mul(smoothstep(oLoY, oLoY.add(fw.y), p.y))
            .mul(oneMinus(smoothstep(oHiY.sub(fw.y), oHiY, p.y)));
        const opening = rect(f).toVar();
        let w = f;
        let atGlass = float(1.0);
        let jamb = float(0.0);
        let sillHit = float(0.0);
        let headHit = float(0.0);
        let depthFrac = float(1.0);
        if (relief) {
            const depth = recess.mul(mix(float(1.0), float(1.5), isGround));
            const shift = vec2(vAlong.div(bayW), V.y.div(floorH)).mul(depth.div(max(vdotn, 0.14)))
                .mul(oneMinus(lod))
                .toVar();
            const off = clamp(shift, vec2(-0.7, -0.7), vec2(0.7, 0.7)).toVar();
            w = f.add(off).toVar();
            atGlass = rect(w).toVar();
            // Where the ray leaves the opening before the glass, it meets a jamb, the sill or the head.
            const tx = mix(f.x.sub(oLoX), oHiX.sub(f.x), step(0.0, off.x)).div(max(abs(off.x), 1e-4)).toVar();
            const ty = mix(f.y.sub(oLoY), oHiY.sub(f.y), step(0.0, off.y)).div(max(abs(off.y), 1e-4)).toVar();
            jamb = step(tx, ty).toVar();
            sillHit = oneMinus(jamb).mul(step(off.y, 0.0)).toVar();
            headHit = oneMinus(jamb).mul(step(0.0, off.y)).toVar();
            depthFrac = clamp(min(tx, ty), 0.0, 1.0).toVar();
        }
        const pane = mix(opening, meanPane, lod).mul(bearsWindows).toVar();
        const glassShare = mix(atGlass, float(0.86), lod).toVar();

        // ── WHICH windows are lit (the ignition ring raises the city's floor count) ──
        const ign = neonIgnition(N, pc);
        const inWave = ign.level.sub(NEON_AIR.arrivalNeon).div(1 - NEON_AIR.arrivalNeon).toVar();
        const cityLight = mix(arrivalLight, float(S.ignitedLight), inWave);
        // HASH BUDGET: one hash per FLOOR, one per tenant RUN, one per WINDOW.
        const floorRnd = hash21(vec2(cell.y, seed.mul(0.731))).toVar();
        const floorOn = step(oneMinus(occupancy.mul(cityLight)), floorRnd);
        const runKey = vec2(floor(cellH.x.div(4.0)), cell.y.add(faceSeed.mul(11.0))).toVar();
        const runRnd = hash21(runKey).toVar();
        const winRnd = hash21(cellH.add(vec2(faceSeed.mul(5.3), faceSeed.mul(1.9)))).toVar();
        // ALIVE: a third of the tenants are restless. Their run of windows goes on or off every
        // half minute or so, each on its own clock, easing over a few seconds.
        const restless = step(0.66, fract(runRnd.mul(17.3)));
        const turnPhase = uTime.div(fract(runRnd.mul(7.7)).mul(30.0).add(26.0)).add(runRnd.mul(13.0)).toVar();
        const epoch = floor(turnPhase).mul(restless).toVar();
        const turn = smoothstep(0.86, 1.0, fract(turnPhase)).mul(restless);
        const runA = hash21(runKey.add(vec2(epoch.mul(3.0), epoch.mul(5.0))));
        const runB = hash21(runKey.add(vec2(epoch.add(restless).mul(3.0), epoch.add(restless).mul(5.0))));
        const runLit = mix(step(1.0 - S.floorFill, runA), step(1.0 - S.floorFill, runB), turn);
        const inFloor = floorOn.mul(runLit).mul(step(0.1, winRnd));
        const single = step(oneMinus(occupancy.mul(S.scatter).mul(cityLight)), winRnd);
        // Most shops are open: the street floor is the city's lit base.
        const shopOpen = step(0.3, fract(runRnd.mul(3.3))).mul(isGround);
        const buildingAlive = step(dim, gutter.mul(0.98).add(0.01)).toVar();
        // THE ENDING'S WAVE (the journey done): a ring of light from the spire switches every
        // window on as it passes, window by window (each a little after the ring, by its hash).
        const spireD = length(vec2(pc.x.sub(S.spire[0]), pc.z.sub(S.spire[1]))).toVar();
        const waveR = N.endWave;
        const waved = oneMinus(smoothstep(waveR.sub(50.0), waveR, spireD.add(winRnd.mul(110.0))))
            .mul(step(0.16, winRnd)).toVar();
        const waveFront = smoothstep(waveR.sub(120.0), waveR.sub(30.0), spireD)
            .mul(oneMinus(smoothstep(waveR.sub(30.0), waveR.add(12.0), spireD)))
            .mul(smoothstep(1.0, 40.0, waveR));
        const lit = max(max(max(inFloor, single), shopOpen).mul(buildingAlive), waved).mul(bearsWindows).toVar();

        // ── WHAT colour: warm rooms, cool offices, a neon floor now and then, a television ──
        const warmRnd = fract(floorRnd.mul(13.37).add(0.37));
        // (Half the towers lean cool; even those keep a good share of warm rooms.)
        const isWarm = step(warmRnd, warmBias.mul(0.55).add(0.4));
        const neonFloor = step(0.965, fract(floorRnd.mul(31.71).add(0.11)));
        const lampTone = fract(winRnd.mul(61.7));
        const warm = mix(vec3(1.0, 0.46, 0.16), vec3(1.0, 0.68, 0.36), lampTone).mul(S.warmGain);
        const cool = mix(vec3(0.2, 0.78, 0.86), vec3(0.42, 0.66, 1.0), lampTone).mul(S.coolGain);
        const neonTint = mix(vec3(1.0, 0.18, 0.66), vec3(0.0, 0.85, 1.0), step(0.5, fract(seed.mul(3.7)))).toVar();
        const telly = step(0.94, fract(winRnd.mul(19.3))).mul(oneMinus(isGround));
        const tellyStep = floor(uTime.mul(1.7).add(winRnd.mul(31.0)));
        const tellyGlow = hash21(vec2(tellyStep, winRnd.mul(97.0).add(5.0))).mul(0.5).add(0.5);
        const shopTone = fract(runRnd.mul(29.9));
        const shopCol = mix(
            mix(vec3(1.0, 0.72, 0.42), vec3(0.7, 0.9, 1.0), step(0.55, shopTone)),
            neonTint,
            step(0.82, shopTone),
        ).mul(S.warmGain * 1.25);
        const wcolor = mix(
            mix(
                mix(mix(cool, warm, isWarm), neonTint.mul(S.neonGain), neonFloor),
                vec3(0.42, 0.6, 1.0).mul(tellyGlow).mul(S.coolGain),
                telly,
            ),
            shopCol,
            isGround,
        ).toVar();

        // ── A ROOM behind every lit pane (interior mapping from the glass plane) ──
        let room = float(1.0);
        if (interiors) {
            const vt = vAlong.div(bayW).toVar();
            const vy = V.y.div(floorH).toVar();
            const vn = max(vdotn, 0.06).div(bayW.mul(1.5)).toVar();
            const tx = mix(w.x, oneMinus(w.x), step(0.0, vt)).div(max(abs(vt), 1e-4)).toVar();
            const ty = mix(w.y, oneMinus(w.y), step(0.0, vy)).div(max(abs(vy), 1e-4)).toVar();
            const tz = float(1.0).div(vn).toVar();
            const tHit = min(tz, min(tx, ty)).toVar();
            const back = step(tz, min(tx, ty)).toVar();
            const side = oneMinus(back).mul(step(tx, ty)).toVar();
            const flat = oneMinus(back).mul(oneMinus(side));
            const hx = w.x.add(vt.mul(tHit)).toVar();
            const hy = w.y.add(vy.mul(tHit)).toVar();
            const hz = clamp(vn.mul(tHit), 0.0, 1.0).toVar();
            // The back wall: brighter up by the lamps, a door or a picture, a shelf dark at its foot.
            const furnish = step(hy, fract(winRnd.mul(23.1)).mul(0.34).add(0.12))
                .mul(step(fract(hx.mul(1.7).add(winRnd.mul(5.0))), 0.62));
            const door = step(abs(hx.sub(fract(winRnd.mul(9.1)).mul(0.5).add(0.25))), 0.09).mul(step(hy, 0.7))
                .mul(step(0.5, fract(winRnd.mul(3.9))));
            // ...and a lamp's pool of light on it, the corners of the room left dim.
            const lampAt = vec2(fract(winRnd.mul(9.7)).mul(0.6).add(0.2), fract(winRnd.mul(5.9)).mul(0.3).add(0.5));
            const lampOff = vec2(hx.sub(lampAt.x), hy.sub(lampAt.y).mul(floorH.div(bayW)));
            const pool = float(1.0).div(dot(lampOff, lampOff).mul(9.0).add(1.0));
            const backShade = mix(float(0.3), float(1.5), pool)
                .mul(mix(float(1.0), float(0.36), furnish))
                .mul(mix(float(1.0), float(0.55), door));
            const sideShade = mix(float(0.8), float(0.3), hz);
            // The floor takes a pool of light near the window; the ceiling carries the lamps.
            const desks = step(0.55, fract(hx.mul(2.6).add(winRnd.mul(3.0)))).mul(step(0.4, fract(hz.mul(2.3)))).mul(0.4);
            const floorShade = mix(float(0.5), float(0.2), hz).mul(oneMinus(desks));
            const lamp = oneMinus(smoothstep(0.1, 0.34, abs(fract(hx.mul(2.0)).sub(0.5))));
            const ceilShade = mix(float(0.8), float(1.6), lamp.mul(oneMinus(hz)));
            const shade = back.mul(backShade).add(side.mul(sideShade))
                .add(flat.mul(mix(floorShade, ceilShade, step(0.0, vy))));
            room = mix(shade, float(0.82), lod).toVar();
        }

        // ── On the glass plane: the frame, a mullion, blinds and curtains (not on the Low tier) ──
        const gu = clamp(w.x.sub(oLoX).div(oHiX.sub(oLoX)), 0.0, 1.0).toVar();
        const gv = clamp(w.y.sub(oLoY).div(oHiY.sub(oLoY)), 0.0, 1.0).toVar();
        let bars = float(0.0);
        let blind = float(0.0);
        let curtain = float(0.0);
        let dressing = (roomShade) => vec3(roomShade, roomShade, roomShade);
        if (interiors) {
            const paneW = oHiX.sub(oLoX).mul(bayW).toVar();
            const paneH = oHiY.sub(oLoY).mul(floorH).toVar();
            const frameEdge = min(min(gu, oneMinus(gu)).mul(paneW), min(gv, oneMinus(gv)).mul(paneH));
            const mullionAt = mix(float(0.5), float(0.333), isGround);
            const mullionX = abs(fract(gu.div(mullionAt.mul(2.0)).add(0.5)).sub(0.5)).mul(mullionAt.mul(2.0)).mul(paneW);
            const transomY = abs(gv.sub(mix(float(0.66), float(0.78), isGround))).mul(paneH);
            const bar = (d, half) => oneMinus(smoothstep(half, half + 0.05, d));
            bars = max(
                bar(frameEdge, 0.055),
                max(
                    bar(mullionX, 0.04).mul(sPunched.add(isGround).min(1.0)),
                    bar(transomY, 0.04).mul(sPiers.add(isGround).min(1.0)),
                ),
            ).mul(fine).toVar();
            const hasBlind = step(0.74, fract(winRnd.mul(7.9))).mul(oneMinus(isGround));
            const blindLevel = fract(winRnd.mul(53.1)).mul(0.62).add(0.2);
            blind = hasBlind.mul(step(oneMinus(blindLevel), gv)).mul(oneMinus(lod)).toVar();
            const slat = mix(float(0.82), step(0.4, fract(gv.mul(15.0))).mul(0.45).add(0.55), fine);
            const hasCurtain = step(0.7, fract(winRnd.mul(41.3))).mul(oneMinus(hasBlind)).mul(oneMinus(isGround))
                .mul(oneMinus(sCurtain));
            const drape = fract(winRnd.mul(77.7)).mul(0.16).add(0.12);
            curtain = hasCurtain.mul(max(step(gu, drape), step(oneMinus(drape), gu))).mul(oneMinus(lod)).toVar();
            const fold = sin(gu.mul(70.0)).mul(0.14).add(0.86);
            // Things on the sill, dark against the room: a plant, a pile of books, a cat.
            const sillRnd = hash21(vec2(floor(gu.mul(5.0)).add(3.0), winRnd.mul(71.0).add(2.0)));
            const clutter = step(gv, sillRnd.mul(0.3)).mul(step(0.55, sillRnd)).mul(step(0.5, fract(winRnd.mul(27.7))))
                .mul(oneMinus(isGround))
                .mul(fine);
            dressing = (roomShade) => mix(
                mix(vec3(roomShade, roomShade, roomShade).mul(oneMinus(clutter.mul(0.8))), vec3(0.5, 0.36, 0.3).mul(fold), curtain),
                vec3(0.46, 0.42, 0.36).mul(slat).mul(gv.mul(0.5).add(0.6)),
                blind,
            );
        }

        // Per-window brightness spread + a rare slow flicker.
        const winGain = fract(winRnd.mul(13.7)).mul(0.45).add(0.6).add(isGround.mul(0.25));
        const flick = sin(uTime.mul(winRnd.mul(2.0).add(0.4)).add(winRnd.mul(40.0))).mul(0.5).add(0.5);
        const flicker = mix(1.0, flick.mul(0.6).add(0.4), step(0.985, fract(winRnd.mul(31.1))));
        const energyGain = uEnergy.mul(0.25).add(0.82).mul(ign.front.mul(0.9).add(1.0))
            .mul(waveFront.mul(1.6).add(1.0))
            .mul(flicker)
            .toVar();
        const roomLight = wcolor.mul(winGain).mul(energyGain).mul(lit).toVar();
        const behindGlass = dressing(room);
        const windows = roomLight.mul(behindGlass).mul(oneMinus(bars)).mul(pane).mul(glassShare);

        // ── The city's light on this wall ──
        const hAbove = max(pc.y.sub(STREET_Y), 0.0).toVar();
        const glowSign = neonGlow(N, pc, 0).mul(ign.level).toVar();
        const glowLow = neonGlow(N, pc, 1).toVar();
        const lowLit = glowLow.mul(ign.level).toVar();
        // Walls that face the boulevard take its light in full, the ends of the blocks part of it.
        const toLane = clamp(n.x.mul(pc.x.sign().negate()), 0.0, 1.0).toVar();
        const facing = toLane.mul(0.85).add(abs(n.z).mul(0.38)).add(0.1).toVar();
        const fromBelow = lowLit.mul(exp(hAbove.mul(-1 / 18))).mul(1.4)
            .add(glowSign.min(vec3(1.2, 1.2, 1.2)).mul(exp(max(hAbove.sub(54.0), 0.0).mul(-1 / 26))).mul(0.34));
        // THE SIGNS' SPILL: a pool of each sign's colour on the wall round it.
        const spill = neonWallGlow(N, pc).mul(ign.level)
            .mul(toLane.add(abs(n.z).mul(0.6)).add(isRoof.mul(0.3)))
            .mul(0.55)
            .toVar();
        // Every other street has its own signs: a per-block tint rising off the outer streets.
        const streetTint = mix(vec3(0.9, 0.12, 0.55), vec3(0.0, 0.62, 0.85), step(0.5, fract(seed.mul(1.37))));
        const sideStreet = streetTint.mul(exp(hAbove.negate().div(14.0))).mul(0.1).mul(ign.level);
        // The sky's light on a wall: what the vault shows in the direction the wall faces.
        const skyFace = neonSkyLite(N.sky, normalize(vec3(n.x, n.y.add(0.4), n.z)));
        const skyLight = skyFace.mul(smoothstep(-60.0, 120.0, pc.y).mul(0.6).add(0.4)).mul(0.34).toVar();
        const spire = neonSpireLight(N, pc, n).toVar();
        // Lamps on a setback wash the tier that stands on it: warm, white, or the tower's own neon.
        const washRnd = fract(seed.mul(5.71));
        const washCol = mix(
            mix(vec3(1.0, 0.62, 0.3), vec3(0.7, 0.86, 1.0), step(0.6, washRnd)),
            neonTint,
            max(step(0.86, washRnd), step(0.5, hero)),
        );
        const footH = max(fy.sub(partFoot), 0.0).toVar();
        const washOn = step(0.3, washRnd).mul(step(0.5, partFoot)).mul(oneMinus(isLedge));
        const wash = washCol.mul(exp(footH.mul(-1 / (F.washReach * 0.5))).mul(0.9).add(exp(footH.mul(-1 / (F.washReach * 2.5))).mul(0.16)))
            .mul(washOn).mul(ign.level).mul(max(buildingAlive, waved))
            .mul(N.seamReveal)
            .toVar();
        // THE SUN'S LAST LIGHT: low down the boulevard, it rakes the walls that face the lane far
        // along it and lies warm on every roof and ledge; it dies with the dusk (the sky's own
        // sunGlow) and under a closed deck.
        const toSun = normalize(N.sunPos.sub(pc)).toVar();
        const sunFace = smoothstep(0.02, 0.4, dot(n, toSun)).toVar();
        const lastLight = N.sky.sunGlow.mul(sunFace).mul(N.sky.cover.mul(-0.55).add(1.0)).mul(0.36).toVar();
        // The deck over the city is lit from below and gives some of it back to the roofs.
        const deckLight = N.sky.cityGlow.mul(N.sky.cover.mul(0.6).add(0.4)).mul(isRoof.mul(0.75).add(0.07));
        const light = fromBelow.mul(facing).add(sideStreet).add(skyLight).add(spire)
            .add(lastLight)
            .add(deckLight)
            .add(spill)
            .add(wash.mul(2.2))
            .add(N.sky.burst.mul(0.22))
            .toVar();

        // ── The wall: masonry in the tower's own tint ──
        const tone = fract(seed.mul(0.618)).mul(0.4).add(0.8);
        const masonry = mix(
            mix(vec3(0.2, 0.15, 0.13), vec3(0.1, 0.125, 0.17), smoothstep(0.2, 0.3, tint)),
            mix(vec3(0.17, 0.09, 0.13), vec3(0.08, 0.135, 0.15), smoothstep(0.7, 0.8, tint)),
            smoothstep(0.45, 0.55, tint),
        ).mul(tone).mul(0.62).toVar();
        // Piers: every other bay on the punched walls, every bay on the stone ones; they stand a
        // little proud, so the side turned from the eye is in its own shade.
        const pierEvery = mix(float(0.5), float(1.0), sPiers);
        const pierPhase = fract(g.x.mul(pierEvery).add(0.035)).toVar();
        const pier = step(0.93, pierPhase).mul(oneMinus(sCurtain)).mul(inSpan).toVar();
        const pierShade = smoothstep(0.86, 0.93, pierPhase).mul(oneMinus(step(0.93, pierPhase))).mul(step(0.0, vAlong))
            .add(smoothstep(0.07, 0.0, pierPhase).mul(step(vAlong, 0.0)))
            .mul(oneMinus(sCurtain))
            .mul(inSpan)
            .mul(fine);
        // The slab's edge at every floor, a spandrel under every window, stains run down from the sills.
        const slabLine = oneMinus(smoothstep(0.02, 0.05, f.y)).mul(fine);
        const underSill = step(f.y, oLoY).mul(step(oLoX, f.x)).mul(step(f.x, oHiX));
        // No two panels took the weather alike; rain has run in streaks from every ledge and stained
        // the wall under each sill; the masonry styles show their courses close to. (One noise read,
        // and none on the Low tier.)
        let weather = mix(float(1.0), float(0.7), slabLine).mul(mix(float(1.0), float(0.66), pierShade));
        if (relief) {
            const streak = latticeNoise3(vec3(fx.mul(2.7), fy.mul(0.045), seed.mul(0.71).add(9.0))).toVar();
            const panelTone = mix(float(1.0), fract(winRnd.mul(87.3)).mul(0.34).add(0.8), oneMinus(lod));
            const streaks = mix(float(0.9), smoothstep(0.25, 0.75, streak).mul(0.42).add(0.66), oneMinus(lod));
            const course = mix(float(0.94), step(0.16, fract(fy.div(0.36))).mul(0.2).add(0.8), fine.mul(sPunched.add(sPiers)));
            weather = weather.mul(mix(float(1.0), streak.mul(0.5).add(0.5), underSill.mul(oneMinus(lod))))
                .mul(panelTone)
                .mul(streaks)
                .mul(course);
        }
        // A sill under each window catches the sky.
        const sill = smoothstep(oLoY.sub(0.09), oLoY.sub(0.05), f.y).mul(oneMinus(smoothstep(oLoY.sub(0.03), oLoY, f.y)))
            .mul(step(oLoX, f.x)).mul(step(f.x, oHiX))
            .mul(oneMinus(lod))
            .mul(oneMinus(sCurtain));
        // A ledge every sixth floor catches the street's light on its underside (low floors).
        const ledge = oneMinus(smoothstep(0.0, 0.11, f.y)).mul(step(mod(cell.y, 6.0), 0.5)).mul(oneMinus(lod));
        const ledgeLight = lowLit.mul(exp(hAbove.mul(-1 / 22))).mul(0.8).add(glowSign.mul(0.12))
            .mul(ledge)
            .mul(facing);
        // The parapet: a solid band, its coping a line of lighter stone; the wall under a ledge or
        // a coping stands in its shade.
        const fromTop = max(partTop.sub(fy), 0.0).toVar();
        const coping = oneMinus(smoothstep(0.16, 0.24, fromTop)).mul(fine);
        const eaveShade = mix(float(0.72), float(1.0), smoothstep(0.24, 1.6, fromTop));
        // Plant floors: louvres.
        const louvre = mix(float(0.5), step(0.5, fract(f.y.mul(8.0))).mul(0.42).add(0.3), fine);

        const m = oneMinus(vdotn);
        const fres = m.mul(m).mul(m).toVar();
        // Rain runs down the glass: rivulets of brighter, wetter glass that mirror the street.
        const riv = latticeNoise3(vec3(fx.mul(0.55), fy.mul(0.028).add(uTime.mul(0.32)), seed.mul(0.37)));
        const wet = mix(float(0.55), smoothstep(0.4, 0.78, riv).mul(0.9).add(0.4), oneMinus(lod));
        // GLAZING THAT TAKES THE SKY: each pane mirrors the vault along the reflected ray, and below
        // the horizon the glowing mist, the canyon's light and the signs. No two panes are hung
        // quite true, and each is a little bowed.
        const tip = fract(winRnd.mul(47.3)).sub(0.5).mul(0.42).add(w.y.sub(0.5).mul(0.3));
        const R = reflect(V, n).add(vec3(0.0, tip, 0.0)).toVar();
        const skyMirror = neonSkyLite(N.sky, normalize(R)).mul(smoothstep(0.0, 0.5, R.y)).mul(0.34)
            .min(vec3(0.24, 0.24, 0.24))
            .mul(N.sky.cover.mul(-0.55).add(1.0))
            .toVar();
        const across = float(44.0).div(max(abs(R.x), 0.2));
        const landsAt = hAbove.add(R.y.mul(across));
        const oppositeSigns = neonGlow(N, vec3(pc.x.negate(), pc.y, pc.z.add(R.z.mul(across))), 0)
            .min(vec3(0.9, 0.9, 0.9))
            .mul(ign.level).mul(oneMinus(smoothstep(0.0, 0.4, R.y)))
            .mul(smoothstep(-6.0, 6.0, landsAt))
            .mul(exp(max(landsAt.sub(34.0), 0.0).mul(-1 / 26)));
        const mirrored = skyMirror
            .add(oppositeSigns.mul(0.3))
            .add(N.mistLow.mul(1.0))
            .add(lowLit.mul(exp(hAbove.mul(-1 / 70))).mul(0.32))
            .add(glowSign.mul(exp(max(hAbove.sub(24.0), 0.0).mul(-1 / 30))).mul(0.12))
            .add(spill.mul(0.22))
            .add(N.sky.burst.mul(0.6))
            .toVar();
        const glassBase = float(0.06).add(sCurtain.mul(0.3)).add(sRibbon.mul(0.08));
        const sheen = mirrored.mul(fres.mul(0.55).add(glassBase)).mul(wet).mul(N.wet.mul(0.5).add(0.5)).toVar();
        // An unlit room: black glass, the pale back of a blind or a curtain behind it.
        const dressed = max(blind.mul(0.055), curtain.mul(0.03));
        const glassCol = vec3(0.003, 0.004, 0.01).add(sheen).add(skyLight.add(lowLit.mul(0.2)).mul(dressed));
        const frameCol = masonry.mul(0.5).mul(light).add(roomLight.mul(0.05));
        const glazed = mix(glassCol, frameCol, bars);

        const litFace = masonry.mul(light).toVar();
        const diffuse = litFace.mul(mix(float(1.0), float(1.3), pier)).mul(weather).mul(eaveShade)
            .mul(mix(float(1.0), louvre, isPlant.mul(inSpan)))
            .add(masonry.mul(skyLight).mul(sill).mul(2.2))
            .add(masonry.mul(skyLight.mul(1.6).add(light.mul(0.5))).mul(coping))
            // The curtain wall's spandrel is glass too, back-painted: it mirrors and never lights.
            .add(sheen.mul(0.55).mul(sCurtain).mul(oneMinus(pane)).mul(inSpan)
                .mul(oneMinus(isPlant)))
            .toVar();
        // The reveal: the jamb turned from the light, the sill that takes the sky and the rain, the
        // head in shade; a lit room's light on all three, strongest by the glass.
        const revealLight = jamb.mul(0.6).add(sillHit.mul(1.3)).add(headHit.mul(0.32))
            .mul(mix(float(1.0), float(0.62), depthFrac));
        const roomSpill = roomLight.mul(jamb.mul(0.3).add(sillHit.mul(0.42)).add(headHit.mul(0.5)))
            .mul(depthFrac.mul(0.7).add(0.3));
        const revealCol = masonry.mul(1.15).mul(light.mul(revealLight).add(skyLight.mul(sillHit).mul(1.4)));
        const inOpening = mix(revealCol, glazed.add(diffuse.mul(0.06)), glassShare);
        const wall = mix(diffuse, inOpening, pane);
        // A ledge slab (the step of a setback, a cornice): its underside and edge take the street's
        // light, its top the sky.
        const ledgeUnder = lowLit.mul(exp(hAbove.mul(-1 / 40))).mul(1.1).add(glowSign.mul(0.3)).mul(facing.add(0.3));
        const slab = masonry.mul(ledgeUnder.add(skyLight.mul(1.2)).add(spire).add(spill.mul(0.6)));
        const body = mix(wall, slab, isLedge);

        // ── THE ROOF: the eye flies over most of the city's ──
        const rx = vUv.x.mul(aDims.x).toVar();
        const rz = vUv.y.mul(aDims.z).toVar();
        const roofSpan = min(aDims.x, aDims.z).toVar();
        const rimBox = min(min(rx, aDims.x.sub(rx)), min(rz, aDims.z.sub(rz)));
        const rimRound = float(0.5).sub(length(vUv.sub(0.5))).mul(roofSpan);
        const rimDist = mix(rimBox, rimRound, isRound).toVar();
        const fr = max(fwidth(rx), fwidth(rz)).max(1e-4).toVar();
        const roofFine = oneMinus(smoothstep(0.12, 0.5, fr)).toVar();
        const roofFar = smoothstep(0.5, 1.6, fr).toVar();
        const copingR = oneMinus(smoothstep(0.42, fr.add(0.5), rimDist)).toVar();
        const gutterShade = mix(float(0.55), float(1.0), smoothstep(0.5, 1.5, rimDist));
        const inField = smoothstep(0.9, 1.3, rimDist).toVar();
        const roofRnd = fract(seed.mul(7.13)).toVar();
        // What the roof is: pavers, skylights, solar rows, or a membrane with seams.
        const hasSkylights = step(0.28, roofRnd).mul(step(roofRnd, 0.52)).mul(step(11.0, roofSpan)).toVar();
        const gravel = latticeNoise3(vec3(rx.mul(0.7), rz.mul(0.7), seed.mul(0.21)));
        // Pavers or a membrane with seams, and solar rows: not on the Low tier.
        let field = float(1.0);
        let solar = float(0.0);
        if (relief) {
            const isPaved = step(roofRnd, 0.28);
            const hasSolar = step(0.52, roofRnd).mul(step(roofRnd, 0.66)).mul(step(11.0, roofSpan)).toVar();
            const paverCell = floor(vec2(rx, rz).div(F.paver));
            const paverTone = hash21(paverCell.add(vec2(seed.mul(2.1).add(7.0), 3.0))).mul(0.3).add(0.85);
            const paverEdge = min(abs(fract(rx.div(F.paver)).sub(0.5)), abs(fract(rz.div(F.paver)).sub(0.5)));
            const paving = mix(float(1.0), paverTone.mul(smoothstep(0.5, 0.44, paverEdge).mul(0.25).add(0.75)), roofFine);
            const seams = mix(float(1.0), smoothstep(0.0, 0.03, abs(fract(rx.div(3.6)).sub(0.5))).mul(0.25).add(0.75), roofFine);
            const solarF = fract(rz.div(F.solarRow));
            solar = step(0.16, solarF).mul(step(solarF, 0.84)).mul(step(0.5, fract(rx.div(5.4)).mul(0.9).add(0.1)))
                .mul(hasSolar)
                .mul(inField)
                .mul(roofFine)
                .toVar();
            field = mix(seams, paving, isPaved);
        }
        // Skylights: a lit room under glass, a grid of bars across it.
        const skyCell = floor(vec2(rx.div(F.skylightCell[0]), rz.div(F.skylightCell[1])));
        const skyF = fract(vec2(rx.div(F.skylightCell[0]), rz.div(F.skylightCell[1])));
        const skyRnd = hash21(skyCell.add(vec2(seed.mul(1.7).add(11.0), seed.mul(0.3).add(5.0)))).toVar();
        const skyBox = smoothstep(0.2, fr.mul(0.2).add(0.2), skyF.x).mul(oneMinus(smoothstep(0.8, fr.mul(0.2).add(0.8), skyF.x)))
            .mul(smoothstep(0.22, fr.mul(0.24).add(0.22), skyF.y))
            .mul(oneMinus(smoothstep(0.78, fr.mul(0.24).add(0.78), skyF.y)));
        const skylight = skyBox.mul(step(0.5, skyRnd)).mul(hasSkylights).mul(inField).mul(oneMinus(roofFar))
            .toVar();
        const skyBars = mix(float(0.8), step(0.14, fract(skyF.x.mul(5.0))).mul(step(0.2, fract(skyF.y.mul(3.0)))), roofFine);
        const skyGlow = mix(vec3(1.0, 0.66, 0.34), vec3(0.6, 0.85, 1.0), step(0.8, skyRnd))
            .mul(skyBars).mul(S.warmGain * 0.8).mul(fract(skyRnd.mul(9.7)).mul(0.5).add(0.5));
        // A helipad on the tall flat roofs.
        const padR = roofSpan.mul(0.34).toVar();
        const padC = vec2(rx.sub(aDims.x.mul(0.5)), rz.sub(aDims.z.mul(0.5))).toVar();
        const padD = length(padC).toVar();
        const hasPad = isPad.mul(isRoof).toVar();
        const padRing = oneMinus(smoothstep(0.18, fr.add(0.3), abs(padD.sub(padR))));
        const hBar = max(
            step(abs(abs(padC.x).sub(padR.mul(0.3))), padR.mul(0.07)).mul(step(abs(padC.y), padR.mul(0.46))),
            step(abs(padC.x), padR.mul(0.3)).mul(step(abs(padC.y), padR.mul(0.07))),
        );
        const padPaint = max(padRing, hBar).mul(hasPad).mul(oneMinus(roofFar)).toVar();
        // ...twelve green lamps round it.
        const padTurn = atan(padC.y, padC.x).mul(12 / 6.2832);
        const padLamps = oneMinus(smoothstep(0.25, fr.add(0.45), abs(padD.sub(padR.add(1.1)))))
            .mul(mix(oneMinus(smoothstep(0.1, 0.2, abs(fract(padTurn).sub(0.5)).mul(padR).mul(0.5))), float(0.12), roofFar))
            .mul(hasPad);
        // A row of lamps inside the parapet, round the roof.
        const along = mix(rx, rz, step(min(rx, aDims.x.sub(rx)), min(rz, aDims.z.sub(rz))));
        const lampAcross = rimDist.sub(0.85);
        const lampAlong = fract(along.div(F.lampEvery)).sub(0.5).mul(F.lampEvery);
        const lampR2 = lampAcross.mul(lampAcross).add(lampAlong.mul(lampAlong));
        const lampRow = float(1.0);
        // A lamp near, the row's mean light far.
        const lampDot = mix(
            oneMinus(smoothstep(0.03, fr.mul(0.6).add(0.07), lampR2)).add(float(0.05).div(lampR2.add(0.12))),
            oneMinus(smoothstep(0.1, fr.add(0.3), abs(lampAcross))).mul(0.2),
            roofFar,
        ).mul(step(0.5, rimDist));
        const lampOn = step(0.56, fract(seed.mul(13.7)));
        const lampCol = mix(vec3(1.0, 0.72, 0.4), neonTint, step(0.8, fract(seed.mul(17.9))));
        const edgeLamps = lampCol.mul(lampRow).mul(lampDot).mul(lampOn).mul(S.warmGain * 0.85);
        // A door lamp throws a pool across the roof.
        const lampAt = vec2(fract(seed.mul(3.31)).mul(0.5).add(0.25).mul(aDims.x), fract(seed.mul(9.17)).mul(0.5).add(0.25).mul(aDims.z));
        const lampD = length(vec2(rx, rz).sub(lampAt));
        const lq = lampD.div(roofSpan.mul(0.22).add(1.5));
        const poolLight = vec3(1.0, 0.66, 0.36).mul(float(1.0).div(lq.mul(lq).add(1.0))).mul(0.5)
            .mul(ign.level)
            .mul(max(buildingAlive, waved));
        const puddleR = smoothstep(0.58, 0.68, latticeNoise3(vec3(rx.mul(0.09), rz.mul(0.09), seed.mul(0.53))))
            .mul(inField).mul(oneMinus(skylight)).mul(oneMinus(solar));
        const roofAlbedo = masonry.mul(0.7).mul(gravel.mul(0.5).add(0.75))
            .mul(field)
            .mul(gutterShade);
        // First light lies along the roofs: the low sun's warm wash, only at the journey's dawn.
        const dawnWash = N.sky.sunGlow.mul(N.sky.dawn).mul(0.5);
        // The parapet's lamps light the roof inside them.
        const lampWash = lampCol.mul(lampOn).mul(exp(max(rimDist.sub(0.85), 0.0).mul(-1 / 3.2))).mul(0.55)
            .mul(ign.level)
            .mul(max(buildingAlive, waved));
        const roofLight = skyLight.mul(3.0).add(spire).add(lowLit.mul(0.06)).add(glowSign.mul(0.05))
            .add(spill.mul(0.5))
            .add(poolLight)
            .add(lampWash)
            .add(wash.mul(0.5))
            .add(dawnWash)
            .add(N.sky.burst.mul(0.5))
            .toVar();
        const padCol = vec3(0.5, 0.46, 0.3).mul(roofLight.add(skyLight));
        const roofLit = mix(roofAlbedo.mul(roofLight), padCol, padPaint)
            .add(masonry.mul(lowLit.mul(0.5).add(skyLight.mul(1.5)).add(roofLight.mul(0.4))).mul(copingR).mul(1.3))
            .add(skyMirror.add(N.mistLow).mul(fres.mul(0.9).add(0.12)).mul(puddleR.mul(0.85).add(0.15))
                .mul(N.wet))
            .add(skyMirror.mul(fres.mul(1.4).add(0.5)).mul(solar));
        const roofGlow = skyGlow.mul(skylight).add(edgeLamps.mul(oneMinus(copingR)))
            .add(vec3(0.3, 1.0, 0.55).mul(padLamps).mul(0.4))
            .mul(ign.level)
            .mul(max(buildingAlive, waved))
            .mul(isRoof);

        // ── Hero towers: neon edge meters that fill as the ignition passes + a crown ──
        const isHero = step(0.5, hero);
        const heroCol = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.2, 0.7), step(1.5, hero));
        const edgeDist = min(vUv.x, oneMinus(vUv.x)).mul(faceW).toVar();
        // THE SUN'S RIM: looking toward the low sun, the towers' corners, parapets and ledges catch
        // it. A line thinner than a pixel keeps its light instead of crawling.
        const sunward = clamp(dot(V, N.sky.sunDir), 0.0, 1.0);
        const edgeAA = max(fwidth(edgeDist), 0.02);
        const cornerLine = oneMinus(smoothstep(0.1, edgeAA.add(0.2), edgeDist)).mul(float(0.2).div(edgeAA.add(0.2)))
            .mul(oneMinus(isRound));
        const crownEdge = oneMinus(smoothstep(0.3, 0.9, fromTop));
        const rim = N.sky.sunGlow.mul(sunward.mul(sunward))
            .mul(cornerLine.mul(0.2).add(crownEdge.mul(0.12)).add(ledge.mul(0.26)).add(isLedge.mul(0.24)))
            .mul(isSide)
            .mul(N.sky.cover.mul(-0.6).add(1.0));
        const edgeTrim = oneMinus(smoothstep(0.18, 0.75, edgeDist)).mul(oneMinus(isRound));
        const fill = mix(float(0.28), float(1.0), inWave);
        const meterSeg = smoothstep(0.08, 0.2, abs(fract(fy.mul(0.16)).sub(0.5)));
        const meter = step(vUv.y, fill).mul(mix(1.0, meterSeg, oneMinus(lod)));
        const crownBand = oneMinus(smoothstep(0.4, 1.2, fromTop))
            .add(smoothstep(5.0, 5.6, fromTop).mul(oneMinus(smoothstep(6.4, 7.0, fromTop))).mul(0.6));
        const chase = sin(fy.mul(0.09).sub(uTime.mul(1.6)).add(seed)).mul(0.25).add(0.75);
        const trim = heroCol.mul(edgeTrim.mul(chase).mul(meter).add(crownBand.mul(inWave.mul(0.6).add(0.4))))
            .mul(isHero).mul(isSide).mul(S.trimGain)
            .mul(oneMinus(isLedge))
            .mul(max(buildingAlive, waved));

        // A line of light along the coping of some towers' tops.
        // ...and along every ledge of others: each setback drawn in a line of the tower's own light.
        const lineAA = max(fwidth(fromTop), 1e-3);
        const copingLine = oneMinus(smoothstep(0.1, lineAA.add(0.3), fromTop)).mul(float(0.3).div(lineAA.add(0.3)).min(1.0));
        const crownLine = washCol.mul(copingLine.mul(isTop).mul(step(0.62, washRnd)).mul(oneMinus(isLedge))
            .add(isLedge.mul(step(0.5, washRnd)).mul(0.7)))
            .mul(isSide)
            .mul(ign.level).mul(max(buildingAlive, waved))
            .mul(0.5);
        const structure = mix(body, roofLit, isRoof);
        // Lit only once the tunnel's mouth opens (`seamReveal`, the 7->8 carry).
        const lights = windows.add(roomSpill.mul(masonry.mul(4.0)).mul(pane).mul(oneMinus(glassShare)))
            .add(trim).add(rim).add(crownLine)
            .add(ledgeLight.mul(isSide).mul(oneMinus(isLedge)))
            .add(roofGlow)
            .mul(N.seamReveal);
        const air = neonAir(N, pc, glowLow);
        // The air: lit windows punch a little further through it than the walls do.
        return mix(structure.add(lights), air.colour, air.amount)
            .add(lights.mul(air.amount).mul(oneMinus(air.amount)).mul(0.35));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-facade';
    material.colorNode = colorNode;
    material.userData.emitsBloom = true;
    material.userData.valueTiers = S;
    return material;
}
