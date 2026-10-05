/**
 * Neon District — architecture.
 *
 * Every building is one instanced box; the facade is drawn in the fragment shader from the wall's
 * own metres: bays and floors, a window in each cell, and behind each lit window a ROOM (interior
 * mapping: the view ray is intersected with the room's back wall, side walls, floor and ceiling,
 * so the rooms slide past in true parallax as the street scrolls). Rooms have furniture
 * silhouettes, blinds or curtains, and their own light — tungsten, daylight tube, a television,
 * or the building's neon accent.
 *
 * The walls are unlit geometry shaded by the district's light: the glow map (what this stretch of
 * street's signs throw), the smog's skylight, neon trim that fills like a level meter as the
 * district's power rises, and the gameplay pulses (lock shells, clear waves) that switch dark
 * windows on as they pass.
 *
 * Two materials from one recipe: the scrolling street (rooms) and the megatowers standing in the
 * smog (flat windows, lit whole floors at a time).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
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
    positionGeometry,
    positionWorld,
    pow,
    select,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import {
    STREET,
    ndAtmosphere,
    ndBoxAA,
    ndClearLight,
    ndGlow,
    ndHash11,
    ndHash21,
    ndHash23,
    ndLockLight,
    ndWrapZ,
} from './neon-district-tsl.js';
import { NEON_PALETTE } from './neon-district-layout.js';
import { linRGB } from './neon-district-core.js';

/** Four walls and a roof of a unit box (no floor): positions in −0.5..0.5, outward normals. */
function createBoxShell() {
    const faces = [
        {
            n: [1, 0, 0], a: [0.5, -0.5, 0.5], b: [0.5, -0.5, -0.5], c: [0.5, 0.5, -0.5], d: [0.5, 0.5, 0.5],
        },
        {
            n: [-1, 0, 0], a: [-0.5, -0.5, -0.5], b: [-0.5, -0.5, 0.5], c: [-0.5, 0.5, 0.5], d: [-0.5, 0.5, -0.5],
        },
        {
            n: [0, 0, 1], a: [-0.5, -0.5, 0.5], b: [0.5, -0.5, 0.5], c: [0.5, 0.5, 0.5], d: [-0.5, 0.5, 0.5],
        },
        {
            n: [0, 0, -1], a: [0.5, -0.5, -0.5], b: [-0.5, -0.5, -0.5], c: [-0.5, 0.5, -0.5], d: [0.5, 0.5, -0.5],
        },
        {
            n: [0, 1, 0], a: [-0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [0.5, 0.5, -0.5], d: [-0.5, 0.5, -0.5],
        },
    ];
    const positions = [];
    const normals = [];
    const indices = [];
    faces.forEach((f, i) => {
        positions.push(...f.a, ...f.b, ...f.c, ...f.d);
        normals.push(...f.n, ...f.n, ...f.n, ...f.n);
        const o = i * 4;
        indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
    });
    return { positions, normals, indices };
}

/**
 * @param {object} u       shared district uniforms
 * @param {object[]} boxes plan.boxes or plan.megaBoxes
 * @param {object} [opts]
 * @param {boolean} [opts.scroll=true]  the boxes flow with the street
 * @param {boolean} [opts.rooms=true]   interior-mapped rooms (off for megatowers and low tiers)
 * @param {string} [opts.name]
 * @returns {{ mesh: THREE.Mesh, material: THREE.Material, geometry: THREE.BufferGeometry }}
 */
export function createFacades(u, boxes, opts = {}) {
    const scroll = opts.scroll !== false;
    const rooms = opts.rooms !== false;
    const count = boxes.length;
    const shell = createBoxShell();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(shell.indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(shell.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(shell.normals, 3));

    const aPos = new Float32Array(count * 4);
    const aSize = new Float32Array(count * 4);
    const aGrid = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    const aAccent = new Float32Array(count * 3);
    boxes.forEach((b, i) => {
        aPos.set([b.x, b.y, b.z, b.seed], i * 4);
        aSize.set([b.w, b.h, b.d, b.plinth ? 1 : 0], i * 4);
        aGrid.set([b.bay, b.floor, b.winX, b.winY], i * 4);
        aLook.set([b.lit, b.warm, b.tone, b.trim], i * 4);
        aAccent.set(linRGB(NEON_PALETTE[b.accent].hex), i * 3);
    });
    geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 4));
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 4));
    geometry.setAttribute('aGrid', new THREE.InstancedBufferAttribute(aGrid, 4));
    geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(aLook, 4));
    geometry.setAttribute('aAccent', new THREE.InstancedBufferAttribute(aAccent, 3));
    geometry.instanceCount = count;

    const pos = attribute('aPos', 'vec4');
    const sizeA = attribute('aSize', 'vec4');
    const grid = attribute('aGrid', 'vec4');
    const look = attribute('aLook', 'vec4');
    const accent = attribute('aAccent', 'vec3');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = opts.name || 'NeonDistrictFacades';
    material.fog = false;
    material.side = THREE.FrontSide;

    const localMetres = positionGeometry.mul(sizeA.xyz);
    const zc = scroll ? ndWrapZ(pos.z.add(u.scroll)) : pos.z;
    material.positionNode = vec3(
        pos.x.add(localMetres.x),
        pos.y.add(localMetres.y).add(sizeA.y.mul(0.5)),
        zc.add(localMetres.z),
    );

    const vLocal = varying(localMetres, 'ndLocal');

    material.colorNode = Fn(() => {
        const size = sizeA.xyz;
        const N = normalGeometry;
        const pW = positionWorld;
        const rel = pW.sub(cameraPosition);
        const V = normalize(rel);
        const roof = step(0.5, N.y);
        const T = vec3(N.z.negate(), 0.0, N.x);
        const faceW = max(dot(size, abs(T)), 0.5);
        const uM = dot(vLocal, T);
        const vM = vLocal.y.add(size.y.mul(0.5));
        // Integer per-instance seed, rounded and split into two small integers: interpolation
        // noise must never reach a hash, and a hash input must stay exactly representable.
        const seed = floor(pos.w.add(0.5));
        const seedA = mod(seed, 64.0);
        const seedB = floor(seed.div(64.0));

        // ── The wall's grid: bays across, floors up (above the shopfront plinth) ──
        // The counts are floors of interpolated per-instance values: a hair of bias keeps a wall
        // that divides exactly (a storey count times the storey height) from flickering between two.
        const nBays = max(floor(faceW.div(grid.x).add(0.02)), 1.0);
        const bayW = faceW.div(nBays);
        const gu = uM.div(faceW).add(0.5).mul(nBays);
        const plinthH = sizeA.w.mul(STREET.plinth);
        const vF = vM.sub(plinthH).div(grid.y);
        const nFloors = max(floor(size.y.sub(plinthH).sub(0.9).div(grid.y).add(0.02)), 0.0);
        const inFloors = step(0.0, vF).mul(step(vF, nFloors.sub(0.001)));
        const cell = vec2(floor(gu), floor(vF));
        const f = vec2(fract(gu), fract(vF));
        const faceId = floor(N.x.mul(3.0).add(N.z.mul(7.0)).add(0.5));
        const cellSeed = cell.add(vec2(seedA.mul(3.0).add(faceId), seedB.mul(5.0)));
        const h3 = ndHash23(cellSeed);

        // fwidth before any branch (uniform control flow).
        const fw = vec2(fwidth(gu), fwidth(vF));
        const detail = float(1.0).sub(smoothstep(0.22, 0.6, max(fw.x, fw.y)));

        const half = vec2(grid.z, grid.w).mul(0.5);
        const lo = vec2(0.5, 0.53).sub(half);
        const hi = vec2(0.5, 0.53).add(half);
        const winMask = ndBoxAA(f, lo, hi, fw.mul(0.75).add(0.002)).mul(inFloors);

        // ── The district's light on this wall ──
        const glow = ndGlow(u, pW).mul(exp(max(pW.y.sub(3.0), 0.0).mul(-0.085)));
        const lock = ndLockLight(u, pW);
        const clear = ndClearLight(u, pW.z);
        const pulse = lock.add(clear.rgb);
        const skyLight = u.hazeHigh.mul(1.6).add(u.hazeLow.mul(0.35))
            .mul(smoothstep(4.0, 90.0, pW.y).mul(0.75).add(0.25));

        // ── Wall ──
        const grime = u.noise(vec2(uM.mul(0.031).add(seed.mul(0.07)), vM.mul(0.012))).r;
        const streak = u.noise(vec2(uM.mul(0.42).add(seed.mul(0.03)), vM.mul(0.021))).g;
        const tone = look.z.mul(mix(float(0.55), float(1.25), grime)).mul(mix(float(1.0), float(0.62), smoothstep(0.55, 0.8, streak)));
        const albedo = mix(vec3(0.03, 0.034, 0.046), vec3(0.046, 0.04, 0.05), look.y).mul(tone);
        // Panel joints and a ledge under every floor line that catches light from below.
        const jointX = float(1.0).sub(smoothstep(0.0, 0.035, min(f.x, float(1.0).sub(f.x)).mul(bayW)));
        const ledge = float(1.0).sub(smoothstep(0.0, 0.07, f.y)).mul(inFloors);
        // Cladding, by building: cast panels, brick courses, or ribbed metal sheet.
        const clad = mod(seedA, 3.0);
        const brick = step(0.5, clad).mul(step(clad, 1.5));
        const ribbed = step(1.5, clad);
        const course = vM.div(0.3);
        const bond = fract(uM.div(0.62).add(step(0.5, fract(course.mul(0.5))).mul(0.5)));
        const mortar = float(1.0).sub(smoothstep(0.0, 0.1, min(fract(course), min(bond, float(1.0).sub(bond)).mul(2.0))));
        const ribs = sin(uM.mul(21.0)).mul(0.16).add(0.92);
        const fine = float(1.0).sub(smoothstep(0.012, 0.05, fwidth(vM)));
        const cladding = mix(float(1.0), float(1.0).sub(mortar.mul(0.5)), brick.mul(fine))
            .mul(mix(float(1.0), ribs, ribbed.mul(fine)));
        const wallShade = float(1.0).sub(jointX.mul(0.45).mul(detail).mul(float(1.0).sub(brick))).mul(cladding);
        // Rain runs down the walls: at a glancing angle they mirror the street's neon.
        const ndv = max(dot(V.negate(), N), 0.0);
        const rivulets = u.noise(vec2(uM.mul(1.7).add(seed.mul(0.11)), vM.mul(0.08).add(u.time.mul(0.045)))).b;
        const sheen = pow(float(1.0).sub(ndv), 3.0).mul(smoothstep(0.3, 0.72, rivulets).mul(0.75).add(0.25)).mul(u.rain);
        const wall = albedo.mul(wallShade).mul(vec3(0.028, 0.038, 0.066).add(glow.mul(0.85)).add(skyLight.mul(3.4)))
            .add(albedo.mul(pulse).mul(3.6))
            .add(glow.add(pulse).mul(ledge).mul(0.026).mul(detail))
            .add(glow.mul(0.085).add(u.hazeLow.mul(0.28)).add(pulse.mul(0.1)).mul(sheen))
            .toVar();

        // Air-conditioning units bolted under some windows: a boxy shadow with a grille and a lamp.
        const acOn = step(0.7, fract(h3.y.mul(5.7))).mul(inFloors).mul(detail);
        const ac = vec2(f.x.mul(bayW).sub(bayW.mul(0.5)).sub(0.12), f.y.mul(grid.y).sub(0.1));
        const acBox = step(0.0, ac.x).mul(step(ac.x, 0.78)).mul(step(0.0, ac.y)).mul(step(ac.y, 0.46))
            .mul(acOn);
        const grille = step(0.5, fract(ac.y.mul(13.0))).mul(0.35).add(0.5);
        const acTop = smoothstep(0.4, 0.46, ac.y);
        const acLamp = step(length(ac.sub(vec2(0.7, 0.07))), 0.022).mul(acBox);
        wall.assign(mix(wall, wall.mul(grille).mul(0.7).add(glow.mul(acTop).mul(0.012)), acBox));
        wall.addAssign(vec3(0.2, 1.0, 0.45).mul(acLamp).mul(1.4).mul(u.neon));
        // ... and the streak each one leaves down the wall.
        const drip = step(0.0, ac.x).mul(step(ac.x, 0.78)).mul(step(ac.y, 0.0)).mul(acOn)
            .mul(smoothstep(-1.6, 0.0, ac.y));
        wall.mulAssign(float(1.0).sub(drip.mul(0.3)));

        // Shopfront plinth: shutter lines, and a light band under the first floor.
        const inPlinth = step(vM, plinthH).mul(sizeA.w);
        const shutter = smoothstep(0.35, 0.5, abs(fract(vM.mul(5.2)).sub(0.5))).mul(0.5).add(0.5);
        wall.assign(mix(wall, wall.mul(shutter).mul(0.7), inPlinth.mul(detail)));
        const band = ndBoxAA(
            vec2(vM, 0.5),
            vec2(plinthH.sub(0.17), 0.0),
            vec2(plinthH.sub(0.1), 1.0),
            vec2(fwidth(vM).add(0.004), 0.01),
        ).mul(sizeA.w).mul(step(0.5, ndHash11(seedA.mul(1.3).add(seedB))))
            // An LED strip: lit runs with gaps at the piers.
            .mul(step(0.08, fract(gu)));

        // ── Neon trim: the roofline, and corner strips that fill as the district charges ──
        const trimOn = look.w;
        const roofLine = ndBoxAA(
            vec2(vM, 0.5),
            vec2(size.y.sub(0.5), 0.0),
            vec2(size.y.sub(0.26), 1.0),
            vec2(fwidth(vM).add(0.004), 0.01),
        );
        const edgeDist = faceW.mul(0.5).sub(abs(uM));
        const corner = float(1.0).sub(smoothstep(0.1, 0.1 + 0.16, abs(edgeDist.sub(0.34))))
            .mul(step(plinthH, vM));
        const charge = u.power.mul(ndHash11(seedA.add(seedB.mul(1.7))).mul(0.5).add(0.6)).add(clear.w.mul(0.5));
        const fill = float(0.1).add(charge);
        const meterSeg = smoothstep(0.1, 0.24, abs(fract(vM.mul(0.45)).sub(0.5)));
        const meter = step(vM.sub(plinthH).div(max(size.y.sub(plinthH), 1.0)), fill).mul(meterSeg);
        const flick = sin(u.time.mul(ndHash11(seedB.add(seedA.mul(2.3))).mul(3.0).add(1.5)).add(seed.mul(0.4))).mul(0.08).add(0.92);
        const trim = roofLine.mul(1.6).add(corner.mul(meter).mul(1.25)).mul(trimOn)
            .add(band.mul(0.42))
            .mul(flick);
        const trimCol = mix(accent, vec3(1.0, 0.78, 0.3), u.heat.mul(0.85));
        const trimLight = trimCol.mul(trim).mul(u.neon).mul(2.6)
            .add(trimCol.mul(trim).mul(pulse).mul(3.0));

        // ── Windows ──
        const lit = step(h3.x, look.x.add(u.power.mul(0.2)).add(clear.w.mul(0.16)));
        const warmShare = look.y.mul(0.6).add(0.22);
        const kind = h3.y;
        const tv = step(0.94, kind);
        const neonRoom = step(0.9, h3.z);
        const tvFlick = ndHash21(vec2(floor(u.time.mul(9.0)), cellSeed.x.add(cellSeed.y))).mul(0.5).add(0.5);
        const lamp = mix(vec3(0.62, 0.8, 1.0), vec3(1.0, 0.66, 0.36), step(fract(kind.mul(7.31)), warmShare));
        const roomCol = mix(mix(lamp, accent, neonRoom), vec3(0.22, 0.42, 1.0).mul(tvFlick), tv);
        const bright = pow(h3.z, 3.0).mul(1.25).add(0.34);

        // Inside the window rect: a frame, a mullion in the wide ones, a transom in some.
        const inWin = clamp(f.sub(lo).div(hi.sub(lo)), 0.0, 1.0);
        const winW = bayW.mul(grid.z);
        const winH = grid.y.mul(grid.w);
        const panes = step(2.3, winW).add(1.0);
        const frameD = min(min(inWin.x, float(1.0).sub(inWin.x)).mul(winW), min(inWin.y, float(1.0).sub(inWin.y)).mul(winH));
        const mullD = float(0.5).sub(abs(fract(inWin.x.mul(panes)).sub(0.5))).mul(winW.div(panes));
        const transomOn = step(0.55, fract(h3.x.mul(9.7)));
        const transomD = mix(float(9.0), abs(inWin.y.sub(0.7)).mul(winH), transomOn);
        const barD = min(frameD, min(mullD, transomD));
        const barAA = max(fw.x.mul(bayW), fw.y.mul(grid.y)).mul(0.8).add(0.004);
        const glassMask = smoothstep(float(0.04).sub(barAA), float(0.04).add(barAA), barD);

        let roomLight;
        if (rooms) {
            // Interior mapping: the ray from the window plane into a room bayW x floor x depth.
            const roomH = grid.y;
            const roomD = bayW.mul(1.25);
            const rd = vec3(dot(V, T), V.y, dot(V, N).negate());
            const ro = vec3(f.x.mul(bayW), f.y.mul(roomH), 0.0);
            const safe = (v) => v.add(select(v.greaterThanEqual(0.0), float(1e-4), float(-1e-4)));
            const tx = step(0.0, rd.x).mul(bayW).sub(ro.x).div(safe(rd.x));
            const ty = step(0.0, rd.y).mul(roomH).sub(ro.y).div(safe(rd.y));
            const tz = roomD.div(max(rd.z, 1e-3));
            const t = min(tz, min(tx, ty));
            const hit = ro.add(rd.mul(t));
            const isBack = step(tz, min(tx, ty));
            const isSlab = float(1.0).sub(isBack).mul(step(ty, tx));
            // Back wall: furniture silhouettes rising from the floor.
            const bw = hit.xy.div(vec2(bayW, roomH));
            const fcell = floor(bw.x.mul(4.0));
            const fh = ndHash21(vec2(fcell, cellSeed.x.add(cellSeed.y.mul(3.0))));
            const furniture = step(fh, 0.6).mul(step(bw.y, fh.mul(0.75).add(0.12)));
            // A picture or a screen on the wall in some rooms, a door in others.
            const hung = step(0.55, fh).mul(step(abs(bw.x.sub(0.68)), 0.16)).mul(step(abs(bw.y.sub(0.6)), 0.14));
            const door = step(fh, 0.3).mul(step(abs(bw.x.sub(0.2)), 0.11)).mul(step(bw.y, 0.7));
            const back = mix(mix(float(0.62), float(0.14), furniture), float(1.15), hung).mul(float(1.0).sub(door.mul(0.55)));
            // Ceiling: tiles, and a light panel — what you see looking up into a lit room.
            const ceiling = step(0.0, rd.y);
            const cz = hit.z.div(roomD);
            const cx = hit.x.div(bayW);
            const panel = step(abs(cx.sub(0.5)), 0.2).mul(step(abs(cz.sub(0.45)), 0.3));
            const tiles = step(0.06, fract(cx.mul(4.0))).mul(step(0.06, fract(cz.mul(4.0)))).mul(0.12).add(0.3);
            const slab = mix(float(0.2), mix(tiles, float(1.7), panel), ceiling);
            const surface = isBack.mul(back).add(isSlab.mul(slab))
                .add(float(1.0).sub(isBack).sub(isSlab).mul(0.42));
            roomLight = surface.mul(exp(t.mul(-0.19)));
            // Blinds (slats from the top) or a drawn curtain.
            const dress = fract(kind.mul(13.7));
            const blindDepth = fract(h3.z.mul(5.3)).mul(0.85).add(0.1);
            const slats = step(0.45, fract(inWin.y.mul(winH).mul(11.0)));
            const blinds = step(dress, 0.2).mul(step(float(1.0).sub(blindDepth), inWin.y));
            roomLight = mix(roomLight, mix(float(0.05), float(0.46), slats), blinds);
            const curtain = step(0.87, dress);
            const folds = sin(inWin.x.mul(winW).mul(16.0).add(cellSeed.x)).mul(0.1).add(0.42);
            roomLight = mix(roomLight, folds, curtain);
        } else {
            // Megatowers: whole floors lit at once, flat panes.
            const floorHash = ndHash21(vec2(cell.y, seedA.add(seedB.mul(7.0))));
            roomLight = float(0.7).mul(mix(float(1.0), float(1.7), step(floorHash, 0.14)));
        }
        const fres = pow(float(1.0).sub(max(dot(V.negate(), N), 0.0)), 3.0);
        const glass = u.hazeLow.mul(0.3).add(glow.mul(0.35)).mul(fres.mul(0.85).add(0.06));
        const mains = u.neon.mul(0.94).add(0.06);
        const roomOut = roomCol.mul(roomLight).mul(bright).mul(mains).mul(1.15);
        // A pulse switches dark windows on for a moment and lifts the lit ones.
        const wake = pulse.mul(float(1.15).sub(lit.mul(0.6)));
        const frameCol = albedo.mul(0.5).mul(glow.add(0.1)).add(roomCol.mul(lit).mul(0.035)).add(pulse.mul(0.05));
        // The glass sits back in the wall: the reveal shades its edges.
        const reveal = smoothstep(0.0, 0.24, frameD).mul(0.62).add(0.38);
        const pane = mix(frameCol, roomOut.mul(lit).mul(reveal).add(glass).add(wake), glassMask);
        // A sill under each window catches the light of the street.
        const sillY = lo.y.sub(f.y).mul(grid.y);
        const sill = step(0.0, sillY).mul(step(sillY, 0.09)).mul(step(lo.x.sub(0.02), f.x)).mul(step(f.x, hi.x.add(0.02)))
            .mul(inFloors)
            .mul(detail);
        wall.addAssign(glow.mul(0.03).add(skyLight.mul(0.12)).add(pulse.mul(0.04)).mul(sill));

        // Distant cells are smaller than a pixel: fade to the wall's true average.
        const area = grid.z.mul(grid.w);
        const average = wall.mul(float(1.0).sub(area.mul(inFloors)))
            .add(roomCol.mul(look.x.mul(area).mul(0.6)).mul(inFloors).mul(mains))
            .add(pulse.mul(area).mul(inFloors));
        const face = mix(average, mix(wall, pane, winMask), detail).add(trimLight);

        const roofCol = albedo.mul(skyLight.mul(5.0).add(0.08));
        return ndAtmosphere(u, mix(face, roofCol, roof), pW);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return { mesh, material, geometry };
}
