/**
 * Pyrestorm — the anvil: the pyrocumulonimbus the column spreads into, seen from below.
 *
 * One broad sheet at the anvil's base, shaded as the underside of a storm: its outline an
 * eroded ellipse that widens downwind; lumps at two scales and, on the higher tiers, mammatus
 * pouches hanging from it; lit from below by the eruption (the crater's fountain and the lava's
 * glow under each point), from inside by the lightning (a soft glow round each bolt, the whole
 * sheet at a perfect clear), a little by the night sky at its thin edges. The far reaches melt
 * into the sky's own colour.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    clamp,
    cos,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { ANVIL, CRATER, columnPoint } from './pyrestorm-core.js';
import {
    fireLightAt, lightningAt, noise3, wideGlowAt,
} from './pyrestorm-tsl.js';
import { skyColour } from './pyrestorm-sky.js';

/** How fast the anvil streams downwind (m/s; time-lapsed, as the column climbs). */
const STREAM = 46;

/**
 * The anvil's underside height field at a point (metres up from the base), and its lumps. The
 * cloud streams away downwind (`slide`: metres along its run so far) and turns over as it goes:
 * its pouches are a slice of 3D noise that moves through the noise with the clock, so no lump
 * keeps its shape for long.
 */
function underside(u, t, xz, slide, detail) {
    const at = xz.sub(slide);
    const a = texture(t.noise, at.div(16000.0)).r;
    const b = texture(t.noise, at.div(5200.0).add(vec2(0.31, 0.77))).g;
    let h = a.mul(560.0).add(b.mul(300.0));
    if (detail > 1) {
        // Mammatus: rounded pouches hanging under the base, in ranks drawn out along the wind.
        const q = vec3(at.div(vec2(2300.0, 2300.0)), u.time.mul(0.011));
        const m = noise3(t.lattice, q);
        const pouch = smoothstep(0.38, 0.86, m.x.mul(0.7).add(b.mul(0.3)));
        const fine = smoothstep(0.3, 0.9, m.y);
        h = h.sub(pouch.mul(pouch).mul(360.0)).sub(fine.mul(70.0));
    }
    return h;
}

export function createAnvil(u, t, tier) {
    const span = 1.15;
    const geometry = new THREE.PlaneGeometry(ANVIL.along * 2 * span, ANVIL.across * 2 * span, 96, 56);
    geometry.rotateX(-Math.PI / 2);
    // Into the anvil's frame: along the wind, across it, at its base (a slight rise downwind).
    const pos = geometry.attributes.position;
    const ca = Math.cos(ANVIL.heading);
    const sa = Math.sin(ANVIL.heading);
    for (let i = 0; i < pos.count; i++) {
        const along = pos.getX(i);
        const across = -pos.getZ(i);
        const x = ANVIL.x + ca * along - sa * across;
        const z = ANVIL.z + sa * along + ca * across;
        const y = ANVIL.base + 260 * (along / ANVIL.along) + 300 * (across / ANVIL.across) ** 2;
        pos.setXYZ(i, x, y, z);
    }
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormAnvil';
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.fog = false;
    // The head: where the column flattens into the anvil.
    const top = columnPoint(0.95);
    const head = new THREE.Vector2(top[0], top[2]);
    const wind = new THREE.Vector2(Math.cos(ANVIL.heading), Math.sin(ANVIL.heading));
    material.outputNode = Fn(() => {
        const P0 = positionWorld;
        const rel = P0.xz.sub(vec2(ANVIL.x, ANVIL.z));
        // The anvil's frame: along the wind and across it, in half-lengths.
        const al = rel.x.mul(ca).add(rel.y.mul(sa)).div(ANVIL.along);
        const ac = rel.y.mul(ca).sub(rel.x.mul(sa)).div(ANVIL.across);
        // Outline: an ellipse widening downwind, eroded.
        const widen = float(1.25).add(al.mul(0.2)).max(0.8);
        const r = sqrt(al.mul(al).add(ac.div(widen).mul(ac.div(widen))));
        // The cloud streams downwind: every field of it slides along the run.
        const slide = vec2(wind.x, wind.y).mul(u.time.mul(STREAM)).toVar();
        const e1 = texture(t.noise, P0.xz.sub(slide).div(9000.0).add(vec2(0.2, 0.6))).r;
        const e2 = texture(t.noise, P0.xz.sub(slide).div(2600.0).add(vec2(0.7, 0.1))).b;
        const edge = r.add(e1.sub(0.5).mul(0.42)).add(e2.sub(0.5).mul(0.16)).sub(u.cover.sub(1.0).max(0.0).mul(0.3));
        // The eruption's phase: a thin anvil breaks into patches (the stars show between them),
        // a thick one roofs the sky. Nearest the column's head it holds together longest.
        const headD0 = length(P0.xz.sub(vec2(head.x, head.y))).div(9000.0);
        const hole = float(1.0).sub(u.cover).max(0.0).mul(1.3)
            .sub(0.3);
        const patch = smoothstep(hole, hole.add(0.3), e1.mul(0.62).add(e2.mul(0.38)).add(exp(headD0.mul(headD0).negate()).mul(0.3)));
        const body = float(1.0).sub(smoothstep(0.72, 1.02, edge)).mul(patch).toVar();
        // Thin near the edge, thick at the head over the column.
        const thick = clamp(body.mul(0.6).add(exp(headD0.mul(headD0).negate()).mul(0.6)).add(u.cover.sub(1.0).mul(0.5)), 0.0, 1.0);

        // The underside's relief, as a normal (pointing down, bent by the lumps).
        const { xz } = P0;
        const h0 = underside(u, t, xz, slide, tier.anvilDetail);
        const e = 320.0;
        const hx = underside(u, t, xz.add(vec2(e, 0.0)), slide, tier.anvilDetail);
        const hz = underside(u, t, xz.add(vec2(0.0, e)), slide, tier.anvilDetail);
        // The relief's slopes, exaggerated: at this range a true slope barely turns the normal, and
        // the lumps would light as one flat sheet.
        const N = normalize(vec3(hx.sub(h0).div(e).mul(1.9), float(-1.0), hz.sub(h0).div(e).mul(1.9))).toVar();
        const P = vec3(P0.x, P0.y.add(h0), P0.z).toVar();

        // ── Light ──
        // The eruption below: the fountain's light and the lava under this point.
        const fire = fireLightAt(u, P, N).mul(1.6);
        // The eruption's own light under the anvil: strongest over the column, fading downwind.
        const fromHead = length(P.xz.sub(vec2(head.x, head.y)));
        // Each lump lit by its slope toward the column's burning foot: faces turned to it glow,
        // the folds between them go dark.
        const toFoot = normalize(vec3(CRATER.x, CRATER.y + 1600.0, CRATER.z).sub(P));
        const relief = clamp(N.dot(toFoot).mul(1.25).add(0.5), 0.16, 1.35);
        // Hot orange near the column, sinking through red to nothing downwind: the far reaches
        // are lit by the lava under them and by the storm, not by the fountain.
        const nearGlow = exp(fromHead.div(-8000.0));
        const farGlow = exp(fromHead.div(-24000.0));
        const glowUnder = u.fireColour.mul(mix(vec3(1.0, 0.5, 0.32), vec3(1.0, 1.0, 1.0), nearGlow))
            .mul(nearGlow.mul(2.6).add(farGlow.mul(0.4)))
            .mul(u.fountain.add(u.burst.mul(0.6)).mul(u.activity)).mul(relief);
        // The moon on the cloud's thin upwind edge: a cool rim where it thins out to the sky.
        const moonRim = u.moon.mul(float(1.0).sub(thick)).mul(float(1.0).sub(thick)).mul(0.22);
        const lava = u.fireColour.mul(wideGlowAt(t, P.xz).mul(0.13).add(0.012)).mul(u.activity);
        const bolts = lightningAt(u, P, N, 1);
        // A perfect clear: sheet lightning sweeps the anvil from the head downwind.
        const along01 = al.mul(0.5).add(0.5);
        const sheetBand = exp(along01.sub(u.sheet.x).div(0.12).mul(along01.sub(u.sheet.x).div(0.12)).negate())
            .add(smoothstep(0.0, 1.0, u.sheet.x.sub(along01)).mul(0.25));
        // It lights the cloud's own lumps, not a flat band: brightest where the underside hangs low.
        const lumpLit = clamp(h0.div(-500.0).add(0.55), 0.25, 1.0).mul(e2.mul(0.6).add(0.4));
        const sheet = u.bolt.mul(sheetBand.mul(u.sheet.y).mul(lumpLit).mul(body).mul(0.65));
        // The blast's shock front passes as a pale ring.
        const dShock = length(P.sub(vec3(CRATER.x, CRATER.y, CRATER.z))).sub(u.shock.x);
        const shock = exp(dShock.div(380.0).mul(dShock.div(380.0)).negate()).mul(u.shock.y);
        // The night: a little sky on the thin edges.
        const sky = u.ambient.mul(float(1.5).sub(thick));
        const light = fire.add(glowUnder).add(lava).add(bolts).add(sheet)
            .add(sky)
            .add(moonRim)
            .add(vec3(0.45, 0.45, 0.5).mul(shock))
            .toVar();
        // Pouches facing the fire take its light; their shadowed tops stay dark.
        const pouchDark = clamp(N.y.negate().mul(1.4).sub(0.35), 0.0, 1.0);
        const albedo = u.ash.mul(mix(float(0.55), float(0.85), pouchDark)).mul(float(1.0).sub(thick.mul(0.25)));
        const col = albedo.mul(light).toVar();
        // Distance: the far anvil melts into the sky behind it.
        const toP = P.sub(u.eye);
        const dist = length(toP);
        const dir = toP.div(dist);
        const far = smoothstep(24000.0, 60000.0, dist);
        col.assign(mix(col, skyColour(u, t, dir), far.mul(0.75)));
        // Whole inside its outline (a star through the cloud's body reads as painted on it); thin
        // only at its edge.
        const alpha = body.mul(1.35).min(1.0).mul(mix(float(0.97), float(1.0), thick));
        return vec4(col.mul(alpha), alpha);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PyrestormAnvil';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return {
        mesh,
        meshes: [mesh],
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export {
    abs, cos, max, sin,
};
