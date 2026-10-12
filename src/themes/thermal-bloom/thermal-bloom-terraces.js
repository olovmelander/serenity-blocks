/**
 * Thermal Bloom — the Stair: travertine terraces stepping down from the Chalice's mound toward
 * the bottom-right corner (iris-springs.md §1.2, §3.6.3, §3.15).
 *
 * The generator is the Stage A0 lab's "s4", ported three-free to thermal-bloom-bake.js: scalloped
 * rims (lower envelopes of lobes convex downhill, never crossing), each scallop holding its own
 * flat pool at the height of its lowest rim point, risers dropping from each white lip in two to
 * four micro-steps onto the next tier's floor, which rises gently uphill so the water fills only a
 * band behind each rim. Heights are baked into the mesh (no vertex texture fetch on either
 * backend); a layout texture read only in the fragment stage at level 0 says, per texel, how far
 * the downhill rim is, the tier (read NEAREST: a filtered id is garbage), how far down a riser
 * the point is, and whether it is under water.
 *
 * The look, against the neighbours (§3.15, not halcyon-apex): cream and apricot dominate; the
 * pools are milky and opaque, lit from within (colloidal silica scatters sunlight inside the
 * water: albedo × sun × (1 − e^(−σd))), never mirrors; turquoise only where a pool is deep; the
 * risers streaked apricot and chocolate where runoff flows, hung with dripstone curtains (their
 * folds tilt the normal across the slope), darker in the cavity under each lip; the tiers follow
 * a natural slope with no axis of symmetry. Wrap lighting gives the travertine a subsurface feel;
 * aerial perspective as everywhere. The footprint's rim fades into pale sinter and is discarded
 * in its last sliver, so it never fights the basin's ground.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    cross,
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
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    step,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    createThermalBloomTexture,
    tbAerial,
    tbBounce,
    tbGlint,
    tbHash21,
    tbPart,
    tbBlooms,
    tbSchlick,
    tbSteamVeil,
} from './thermal-bloom-tsl.js';
import { STAIR, bakeStair } from './thermal-bloom-bake.js';

/** Grid rows (along) and columns (across) of the Stair's mesh per tier's layout size. */
function gridFor(tier) {
    if (tier.stairBake <= 384) return { rows: 300, columns: 150 };
    if (tier.stairBake <= 512) return { rows: 360, columns: 200 };
    return { rows: 440, columns: 240 };
}

/** The Stair's colours (linear). */
const C = Object.freeze({
    cream: vec3(0.84, 0.79, 0.64),
    lip: vec3(0.9, 0.88, 0.83),
    apricot: vec3(0.77, 0.36, 0.13),
    chocolate: vec3(0.25, 0.1, 0.045),
    rust: vec3(0.52, 0.12, 0.024),
    milky: vec3(0.42, 0.76, 0.76),
    turquoise: vec3(0.1, 0.58, 0.66),
    /** The bright milky band behind a lip, where the water is shallowest and most lit. */
    milkyLip: vec3(0.66, 0.9, 0.88),
    sinter: vec3(0.72, 0.68, 0.6),
    /** Old travertine on the outer flanks: grey-brown, stained, long dry. */
    old: vec3(0.31, 0.27, 0.22),
    /** The mats the Stair stands in, for its footprint's last fade. */
    mats: vec3(0.3, 0.26, 0.22),
});

/**
 * The Stair part.
 * @param {object} u     the shared uniforms
 * @param {object} tier  the quality tier
 * @param {object} tex   the world's baked textures (the noise atlas)
 */
export function createTerraces(u, tier, tex) {
    const { rows, columns } = gridFor(tier);
    const bake = bakeStair({
        tiers: tier.stairTiers, rows, columns, layoutSize: tier.stairBake,
    });
    const geometry = new THREE.BufferGeometry();
    // Lifted a hand's breadth so the Stair always stands on the ground, never in it.
    for (let i = 1; i < bake.positions.length; i += 3) bake.positions[i] += 0.12;
    geometry.setAttribute('position', new THREE.BufferAttribute(bake.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(bake.uvs, 2));
    geometry.setAttribute('edge', new THREE.BufferAttribute(bake.edges, 1));
    geometry.setIndex(new THREE.BufferAttribute(bake.indices, 1));
    geometry.computeVertexNormals();
    // One typed array, two views: linear for the distances, nearest for the tier id.
    const layoutLinear = createThermalBloomTexture(bake.layout, bake.layoutSize, bake.layoutSize, {
        name: 'thermal-bloom-stair-layout', filter: 'linear', wrap: 'clamp',
    });
    const layoutNearest = createThermalBloomTexture(bake.layout, bake.layoutSize, bake.layoutSize, {
        name: 'thermal-bloom-stair-tiers', filter: 'nearest', wrap: 'clamp',
    });

    const stairFn = Fn(() => {
        const st = clamp(uv(), 0.0, 1.0).toVar();
        const lay = texture(layoutLinear, st).level(0).toVar();
        const tierId = texture(layoutNearest, st).level(0).y.mul(255.0 / 16.0).add(0.5).floor().toVar();
        const rimDist = lay.x.mul(24.0).toVar();
        const riser = lay.z.toVar();
        // The water's depth is continuous in the layout (0.5 at the shore): a crisp, smooth shore.
        const shoreW = max(fwidth(lay.w), 0.004);
        const water = smoothstep(float(0.5).sub(shoreW), float(0.5).add(shoreW), lay.w).toVar();
        const edge = attribute('edge', 'float').toVar();
        edge.lessThan(0.12).discard();

        const P = positionWorld.toVar();
        // The footprint's last, nearly flat sliver lies on the basin's own ground: drop it, so the
        // Stair rises straight out of the mats instead of standing on a pale skirt.
        P.y.lessThan(0.4).and(edge.lessThan(0.5)).discard();
        const toCam = u.camPos.sub(P);
        const dist = length(toCam).toVar();
        const V = toCam.div(max(dist, 1e-3)).toVar();
        // Metres along the slope (downhill) and across it: the streaks run down the slope.
        const along = st.y.mul((STAIR.sMax - STAIR.sMin) * STAIR.length);
        const across = st.x.sub(0.5).mul(STAIR.halfWidth * 2);
        // Runoff fans: wide washes running down several tiers (each 10–30 m across, widening
        // downhill), apricot where the mats live in the outflow, fresh white where it is new.
        const fanX = across.div(along.mul(0.006).add(0.6));
        const streakA = texture(tex.noise, vec2(fanX.mul(0.07 / 4), along.mul(0.006 / 4))).x
            .mul(0.75).add(texture(tex.noise, vec2(across.mul(0.4 / 8), along.mul(0.05 / 8))).y.mul(0.25));
        const freshN = texture(tex.noise, vec2(fanX.mul(0.05 / 4).add(0.5), along.mul(0.005 / 4))).y;
        const fresher = smoothstep(0.62, 0.8, freshN);
        const streakB = texture(tex.noise, vec2(across.mul(0.05 / 4), along.mul(0.3 / 4))).x;
        const onRiser = float(1.0).sub(water).mul(smoothstep(0.995, 0.97, riser)).mul(smoothstep(0.5, 1.5, tierId))
            .toVar();
        const lip = exp(riser.div(0.12).mul(riser.div(0.12)).negate()).mul(onRiser).toVar();
        // Apricot and chocolate only along a few runoff fans; elsewhere the risers stay cream.
        const stain = smoothstep(0.56, 0.7, streakA).mul(smoothstep(0.15, 0.6, streakB)).mul(float(1.0).sub(fresher))
            .toVar();
        const dark = smoothstep(0.55, 0.9, streakA).mul(smoothstep(0.3, 1.0, riser));
        // Risers: cream, streaked apricot (chocolate where the runoff is deepest, toward the foot),
        // white at the lip, hung with dripstone curtains: fine folds down the face, their grooves
        // darker toward the foot.
        const curtain = texture(tex.noise, vec2(across.mul(2.2 / 16), along.mul(0.08 / 16))).z;
        const riserCol = mix(C.cream, mix(C.apricot, C.chocolate, dark.mul(0.8)), stain.mul(0.95))
            .mul(mix(float(1.0), curtain.mul(0.2).add(0.88), smoothstep(0.35, 0.9, riser)));
        const riserLit = mix(riserCol, C.lip, lip);
        // Tier tops above the water: wet cream travertine, faintly stained.
        const fresh = mix(mix(C.cream.mul(0.95), C.sinter, streakB.mul(0.6)), C.apricot, stain.mul(0.55));
        // Travertine is fresh white only where water flows: far from the active rim, and toward
        // the Stair's sides, a tier's surface is old, grey-brown and stained.
        const sideways = smoothstep(0.55, 0.95, st.x.mul(2.0).sub(1.0).abs());
        const age = max(smoothstep(4.0, 13.0, rimDist), sideways).mul(0.85);
        const topCol = mix(fresh, mix(C.old, C.apricot.mul(0.55), stain.mul(0.4)), age.mul(float(1.0).sub(fresher)))
            .toVar();
        // Below the last rim the runoff spreads over the Stair's foot: an apron of wet travertine
        // washed apricot and brown by the mats that live in the outflow.
        const foot = smoothstep(bake.tiers - 0.5, bake.tiers, tierId).mul(0.85);
        const runoff = mix(C.apricot.mul(0.85), C.chocolate.mul(1.6), streakB.mul(0.7)).mul(0.9);
        topCol.assign(mix(topCol, mix(runoff, C.sinter.mul(0.8), streakA.mul(0.5)), foot));
        // Pools: milky, turquoise only where deep; rust-stained at their uphill margins.
        const depth = clamp(float(1.0).sub(rimDist.div(3.5)), 0.0, 1.0);
        const knobsBase = texture(tex.noise, vec2(across, along).mul(0.9 / 16)).w;
        const margin = smoothstep(0.55, 0.85, texture(tex.noise, vec2(across.mul(0.12 / 4), along.mul(0.6 / 4))).y)
            .mul(smoothstep(3.0, 5.5, rimDist));
        const behindLip = smoothstep(1.4, 0.25, rimDist);
        const poolCol = mix(
            mix(mix(C.milky, C.turquoise, depth.mul(0.75)), C.milkyLip, behindLip.mul(0.55)),
            C.rust,
            margin.mul(0.18),
        );
        const solid = mix(topCol, riserLit, onRiser).toVar();
        // The locks' blooms on this side: the brimming terrace's sheet scours the riser below to
        // wet cream, then streamers in the piece's colour grow down it and bleach (§3.7).
        const bloom = tbBlooms(u, positionWorld, 1, () => u.stairDown, tex);
        solid.assign(mix(solid, vec3(0.8, 0.77, 0.66), bloom.scour.mul(0.85)));
        solid.assign(mix(solid, bloom.tint, bloom.cover));
        // The seasons on the dry travertine: rime in First Frost, snow in Deep Cold on the old,
        // long-dry flanks and tier tops away from the flow; the running water keeps its own.
        const coldStone = smoothstep(0.1, 0.6, age).mul(float(1.0).sub(water)).mul(float(1.0).sub(lip));
        const driftN = smoothstep(0.4, 0.7, streakB.add(knobsBase.mul(0.6)));
        solid.assign(mix(solid, vec3(0.8, 0.82, 0.84), u.frost.mul(coldStone).mul(driftN).mul(0.35)));
        solid.assign(mix(solid, vec3(0.78, 0.81, 0.86), u.snow.mul(coldStone).mul(driftN.mul(0.5).add(0.4))));
        // Rough travertine: a blistered, knobbly surface, fading to its mean under a pixel.
        const knobs = knobsBase.sub(0.5);
        solid.mulAssign(float(1.0).add(knobs.mul(0.16).mul(float(1.0).sub(smoothstep(0.08, 0.3, fwidth(along))))));

        // ── Light ──
        // Dripstone curtains: vertical folds on the risers tilt the normal across the slope.
        const fold = texture(tex.noise, vec2(across.mul(1.6 / 16), along.mul(0.12 / 16))).z.sub(0.5);
        const Nbase = normalize(normalWorld).toVar();
        const side = normalize(cross(vec3(0.0, 1.0, 0.0), Nbase).add(vec3(1e-4, 0.0, 0.0)));
        const N = normalize(Nbase.add(side.mul(fold.mul(onRiser).mul(0.9)))).toVar();
        const ndl = dot(N, u.sunDir);
        const wrapLit = clamp(ndl.add(0.35).div(1.35), 0.0, 1.0);
        const skyAmb = mix(u.haze, u.zenith, 0.55).mul(N.y.mul(0.25).add(0.3)).add(tbBounce(u, N));
        // The cavity under each lip and the foot of each riser.
        const ao = float(1.0).sub(smoothstep(0.6, 1.0, riser).mul(onRiser).mul(0.5));
        const solidLit = solid.mul(u.sunColor.mul(wrapLit.mul(1.02)).add(skyAmb)).mul(ao);
        // The pools glow from within; a faint sky sheen at grazing angles, never a mirror.
        const inScatter = float(1.0).sub(exp(depth.mul(-2.0).sub(0.6)));
        const poolLit = poolCol.mul(u.sunColor.mul(max(u.sunDir.y, 0.0).mul(1.5).mul(inScatter).add(0.45))
            .add(u.zenith.mul(0.3)));
        const fres = min(tbSchlick(max(V.y, 0.0), float(0.02)), 0.12).add(bloom.front.mul(0.25));
        const poolOut = mix(poolLit, mix(u.haze, u.zenith, 0.5).mul(1.05), fres).toVar();
        // Bubble trains: in some 2 m cells of the pools a bead rises every few seconds — a
        // bright point just before it breaks, then a ring spreading from where it broke — gone
        // where a pixel is wider than a bead.
        const bc = vec2(across, along).div(2.2);
        const cell = floor(bc);
        const hb = tbHash21(cell.add(vec2(3.1, 7.7)));
        const site = cell.add(vec2(tbHash21(cell.add(1.3)), tbHash21(cell.add(5.9))).mul(0.6).add(0.2));
        const period = hb.mul(4.0).add(2.5);
        const bAge = fract(u.time.div(period).add(hb.mul(13.0))).mul(period);
        const rd = length(bc.sub(site)).mul(2.2);
        const bPx = max(fwidth(along), 1e-3);
        const ringW = max(bPx.mul(1.2), 0.04);
        const ringD = rd.sub(bAge.mul(0.8)).div(ringW);
        // A bright crest with a faint dark trough just inside it.
        const ring = exp(ringD.mul(ringD).negate()).sub(exp(ringD.add(1.4).mul(ringD.add(1.4)).negate()).mul(0.4))
            .mul(exp(bAge.mul(-1.8)));
        const bead = smoothstep(bPx.add(0.06), 0.0, rd).mul(smoothstep(period.sub(0.7), period, bAge));
        const bubbleGate = step(hb, 0.6).mul(smoothstep(0.6, 1.2, rimDist))
            .mul(float(1.0).sub(smoothstep(0.12, 0.35, bPx)));
        // The ring a faint brightening; the bead at its break a glint above the bloom's knee.
        poolOut.addAssign(u.sunColor.mul(ring.mul(0.18).add(bead.mul(2.4)).mul(bubbleGate)));
        const col = mix(solidLit, poolOut, water).toVar();
        // Glints where the overflow sheets slide over the lips and down the risers' wet faces.
        const sheetWet = lip.add(water.mul(behindLip).mul(0.6)).add(onRiser.mul(stain).mul(0.35));
        col.addAssign(tbGlint(u, P, N, V, clamp(sheetWet, 0.0, 1.0), 0.22, 0.6));
        // Low, dry ground (the foot and the outer flanks) fades through old, stained travertine
        // into the mats around the Stair; the pools keep their water.
        const light = u.sunColor.mul(wrapLit.mul(1.1)).add(skyAmb);
        const low = smoothstep(0.3, 0.7, P.y).max(smoothstep(0.35, 0.7, edge)).mul(smoothstep(0.03, 0.4, edge));
        const flankCol = mix(C.mats, mix(C.old, C.apricot.mul(0.6), stain.mul(0.5)), smoothstep(0.05, 0.6, low))
            .toVar();
        // In Deep Cold the Stair's foot meets snow, as the basin round it does.
        flankCol.assign(mix(flankCol, vec3(0.6, 0.63, 0.68), u.snow.mul(0.85)));
        const keep = max(smoothstep(0.35, 0.9, low), water.mul(smoothstep(0.03, 0.2, edge)));
        col.assign(mix(flankCol.mul(light), col, keep));
        const outCol = tbAerial(u, tbSteamVeil(u, col, P), dist, V.negate());
        return vec4(max(outCol, vec3(0.0)), 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ depthTest: true, depthWrite: true });
    material.name = 'ThermalBloomStair';
    material.fog = false;
    material.colorNode = stairFn();
    const part = tbPart('ThermalBloomStair', geometry, material, 8);
    part.textures = [layoutLinear, layoutNearest];
    part.tiers = bake.tiers;
    /**
     * Lay the Stair from the Chalice's flank (`top`, world xz) down toward the bottom-right
     * corner (`toward`, world xz). Its local +z (downhill) turns onto that direction.
     */
    const at = { x: 0, z: 0, angle: 0 };
    const probe = {};
    part.place = (top, toward) => {
        const dx = toward[0] - top[0];
        const dz = toward[1] - top[1];
        at.x = top[0];
        at.z = top[1];
        at.angle = Math.atan2(dx, dz);
        part.mesh.position.set(top[0], 0, top[1]);
        part.mesh.rotation.set(0, at.angle, 0);
        part.mesh.updateMatrix();
        part.mesh.updateMatrixWorld(true);
        u.stairDown.value.set(Math.sin(at.angle), Math.cos(at.angle));
    };
    /** The Stair's surface height (metres) under a world point (0 off its footprint). */
    part.heightAt = (x, z) => {
        const dx = x - at.x;
        const dz = z - at.z;
        const c = Math.cos(at.angle);
        const s = Math.sin(at.angle);
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        bake.gen.sample(lz / STAIR.length, lx, probe);
        return Math.max(0, probe.height + 0.12);
    };
    part.dispose = () => {
        layoutLinear.dispose();
        layoutNearest.dispose();
    };
    return part;
}
