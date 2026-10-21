/**
 * Pyrestorm — the air's own sheets: the fissure's fume (the gas and steam its vents breathe out all
 * the time, climbing and widening as it leans downwind, lit orange from below by its own fire) and
 * the ash falling out of the anvil in curtains (a dirty thunderstorm's virga), lit at their tops by
 * the anvil's glow and from inside by its lightning.
 *
 * Not puffs (a cloud of puffs reads as a pile of balls at any count, docs/PYRESTORM_VISUAL_OVERHAUL
 * § bubble wrap): each plume is one tall sheet that turns about its own upright axis to face the
 * eye, its body a column profile widening with height, its billows two octaves of the lattice's 3D
 * noise read in the plume's own frame (across in widths, so the billows grow as it widens) and
 * carried up it. Two sheets a vent, a tall narrow one and a short wide one, so a plume has depth.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    exp,
    float,
    normalize,
    positionGeometry,
    smoothstep,
    vec2,
    vec3,
    vec4,
    varying,
} from 'three/tsl';
import {
    ANVIL, COLUMN, CRATER, FISSURE, landHeight,
} from './pyrestorm-core.js';
import {
    aerial, lightningAt, noise3, pyBlackbody, wideGlowAt,
} from './pyrestorm-tsl.js';

/** Where along the fissure its three vents stand (the jets' and the curtain's own places). */
export const FISSURE_VENTS = Object.freeze([0.22, 0.55, 0.81]);

/** The sheets: (along the fissure, width m, height m, lean m downwind at the top, seed). */
export const FUME_SHEETS = Object.freeze([
    Object.freeze([0.22, 1000, 2100, 1100, 0.13]),
    Object.freeze([0.22, 1500, 1200, 500, 0.71]),
    Object.freeze([0.55, 1150, 2400, 1250, 0.37]),
    Object.freeze([0.55, 1700, 1350, 600, 0.89]),
    Object.freeze([0.81, 950, 1900, 1000, 0.52]),
    Object.freeze([0.81, 1400, 1100, 450, 0.24]),
]);

/** The wind the fume leans on (xz, unit): the column's own drift. */
const WIND = (() => {
    const l = Math.hypot(COLUMN.drift[0], COLUMN.drift[1]) || 1;
    return Object.freeze([COLUMN.drift[0] / l, COLUMN.drift[1] / l]);
})();

export function createFume(u, t) {
    const n = FUME_SHEETS.length;
    // Per sheet: (base x, y, z, seed) and (width, height, lean, —).
    const base = new Float32Array(n * 4);
    const size = new Float32Array(n * 4);
    FUME_SHEETS.forEach(([along, width, height, lean, seed], i) => {
        const x = FISSURE.a[0] + (FISSURE.b[0] - FISSURE.a[0]) * along;
        const z = FISSURE.a[1] + (FISSURE.b[1] - FISSURE.a[1]) * along;
        base.set([x, landHeight(x, z) - 10, z, seed], i * 4);
        size.set([width, height, lean, 0], i * 4);
    });
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 8);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4));
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 4));
    const aBase = attribute('aBase', 'vec4');
    const aSize = attribute('aSize', 'vec4');

    const material = sheetMaterial('PyrestormFume');

    const vWorld = varying(vec3(0.0), 'vPyFumeWorld');
    material.vertexNode = Fn(() => {
        const up = positionGeometry.y.add(0.5);
        const across = positionGeometry.x;
        // Turned about its upright axis to face the eye; leaning downwind as it climbs (rows bend).
        const toEye = u.eye.xz.sub(aBase.xz);
        const facing = normalize(toEye.add(vec2(1e-3, 0.0)));
        const right = vec3(facing.y.negate(), 0.0, facing.x);
        const lean = up.mul(up).mul(aSize.z);
        const P = aBase.xyz
            .add(right.mul(across.mul(aSize.x)))
            .add(vec3(0.0, up.mul(aSize.y), 0.0))
            .add(vec3(WIND[0], 0.0, WIND[1]).mul(lean));
        vWorld.assign(P);
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(P, 1.0)));
    })();

    const vLocal = varying(positionGeometry.xy, 'vPyFumeLocal');
    material.outputNode = Fn(() => {
        const v = vLocal.y.add(0.5).toVar();
        const x = vLocal.x.mul(2.0);
        const seed = aBase.w;
        const height = aSize.y;
        // The column: narrow at the vent, widening as it climbs.
        const w = v.mul(0.72).add(0.16);
        const nx = x.div(w).toVar();
        const profile = exp(nx.mul(nx).mul(-2.0))
            .mul(smoothstep(0.0, 0.06, v))
            .mul(float(1.0).sub(smoothstep(0.5, 1.0, v)));
        // Billows carried up the plume (in the plume's own frame: they grow as it widens).
        const climb = u.time.mul(13.0);
        const q = vec3(
            nx.mul(1.25).add(seed.mul(17.0)),
            v.mul(height).sub(climb).div(w.mul(520.0)),
            seed.mul(5.0).add(u.time.mul(0.015)),
        );
        const n1 = noise3(t.lattice, q);
        const n2 = noise3(t.lattice, q.mul(2.4).add(vec3(3.1, 1.7, 0.0)));
        const billow = n1.x.mul(0.62).add(n2.y.mul(0.38));
        const density = smoothstep(0.32, 0.78, billow.add(profile.mul(0.42)).sub(0.12)).mul(profile).toVar();
        // Light from below: the vents' fire and the river they feed, strongest at the foot.
        const P = vWorld;
        const rise = v.mul(height);
        const below = exp(rise.div(-460.0));
        const fire = u.fireColour.mul(wideGlowAt(t, P.xz).mul(1.6).add(0.55)).mul(below).mul(1.9);
        const sky = u.ambient.mul(1.4);
        // Thin edges let the fire through; the thick heart of a billow is darker.
        const albedo = u.ash.mul(1.4).mul(float(1.0).sub(density.mul(0.35)));
        const col = albedo.mul(fire.add(sky)).toVar();
        // The vents' own incandescence glows through the fume's foot.
        col.addAssign(pyBlackbody(float(0.62)).mul(exp(rise.div(-140.0))).mul(0.22));
        const alpha = clamp(density.mul(0.8), 0.0, 1.0).mul(u.activity.mul(0.6).add(0.4)).toVar();
        const seen = aerial(u, t, P, col);
        return vec4(seen.mul(alpha), alpha);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.name = 'PyrestormFume';
    const ash = createAshFall(u, t);
    mesh.frustumCulled = false;
    mesh.renderOrder = 23;
    return {
        mesh,
        meshes: [mesh, ash.mesh],
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose?.();
            ash.dispose();
        },
    };
}

/**
 * The ash falling out of the anvil: (along its run, across it, in its half-lengths; width m; the
 * share of the way down it reaches; seed). Placed under the anvil's near reaches, where they hang
 * in the right-hand sky between the card, the HUD and the frame's edge.
 */
export const ASH_CURTAINS = Object.freeze([
    Object.freeze([-0.9, 0.2, 3600, 0.78, 0.17]),
    Object.freeze([-0.8, 0.38, 4400, 0.7, 0.63]),
    Object.freeze([-0.68, 0.02, 3800, 0.66, 0.41]),
    Object.freeze([-0.6, 0.3, 5200, 0.6, 0.88]),
    Object.freeze([-0.93, 0.45, 3000, 0.74, 0.29]),
]);

function createAshFall(u, t) {
    const n = ASH_CURTAINS.length;
    const ca = Math.cos(ANVIL.heading);
    const sa = Math.sin(ANVIL.heading);
    // Per sheet: (top x, y, z, seed) and (width, height, slant x, slant z): the ash lags upwind of
    // where it fell from as it drops through slower air.
    const top = new Float32Array(n * 4);
    const size = new Float32Array(n * 4);
    ASH_CURTAINS.forEach(([al, ac, width, reach, seed], i) => {
        const x = ANVIL.x + ca * al * ANVIL.along - sa * ac * ANVIL.across;
        const z = ANVIL.z + sa * al * ANVIL.along + ca * ac * ANVIL.across;
        const y = ANVIL.base + 260 * al + 300 * ac * ac - 120;
        top.set([x, y, z, seed], i * 4);
        size.set([width, y * reach, -WIND[0] * 1800, -WIND[1] * 1800], i * 4);
    });
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 8);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry.setAttribute('aTop', new THREE.InstancedBufferAttribute(top, 4));
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 4));
    const aTop = attribute('aTop', 'vec4');
    const aSize = attribute('aSize', 'vec4');
    const material = sheetMaterial('PyrestormAshFall');

    const vWorld = varying(vec3(0.0), 'vPyAshWorld');
    material.vertexNode = Fn(() => {
        // down: 0 at the cloud's base, 1 at the curtain's foot.
        const down = float(0.5).sub(positionGeometry.y);
        const toEye = u.eye.xz.sub(aTop.xz);
        const facing = normalize(toEye.add(vec2(1e-3, 0.0)));
        const right = vec3(facing.y.negate(), 0.0, facing.x);
        const P = aTop.xyz
            .add(right.mul(positionGeometry.x.mul(aSize.x)))
            .sub(vec3(0.0, down.mul(aSize.y), 0.0))
            .add(vec3(aSize.z, 0.0, aSize.w).mul(down.mul(down)));
        vWorld.assign(P);
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(P, 1.0)));
    })();

    const vLocal = varying(positionGeometry.xy, 'vPyAshLocal');
    material.outputNode = Fn(() => {
        const down = float(0.5).sub(vLocal.y).toVar();
        const x = vLocal.x.mul(2.0);
        const seed = aTop.w;
        // Streaks of falling ash, drawn out down the curtain, falling; ragged where it thins out.
        const q = vec3(x.mul(5.5).add(seed.mul(23.0)), down.mul(1.6).sub(u.time.mul(0.035)), seed.mul(7.0));
        const n1 = noise3(t.lattice, q);
        const n2 = noise3(t.lattice, q.mul(vec3(2.6, 1.4, 1.0)).add(vec3(1.3, 4.1, 0.0)));
        const streak = n1.x.mul(0.6).add(n2.y.mul(0.4));
        const edge = x.abs().add(n1.y.sub(0.5).mul(0.5));
        const profile = float(1.0).sub(smoothstep(0.35, 0.95, edge))
            .mul(smoothstep(0.0, 0.08, down))
            .mul(float(1.0).sub(smoothstep(0.35, 1.0, down.add(n2.x.sub(0.5).mul(0.3)))));
        const density = smoothstep(0.38, 0.72, streak).mul(profile).toVar();
        const P = vWorld;
        // Lit at its top by the anvil's own glow (the eruption under it, fading downwind), from
        // inside by the lightning, and a little by the night.
        const fromCrater = P.xz.sub(vec2(CRATER.x, CRATER.z)).length().div(20000.0);
        const glow = u.fireColour.mul(exp(down.mul(-2.2)).mul(1.4).add(0.12))
            .mul(float(1.0).div(fromCrater.mul(fromCrater).add(1.0)))
            .mul(u.fountain.mul(u.activity));
        const bolts = lightningAt(u, P, vec3(0.0, 1.0, 0.0), 1).mul(0.35);
        const col = u.ash.mul(0.8).mul(glow.add(bolts).add(u.ambient.mul(1.2))).toVar();
        const alpha = clamp(density.mul(0.5), 0.0, 1.0).toVar();
        const seen = aerial(u, t, P, col);
        return vec4(seen.mul(alpha), alpha);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.name = 'PyrestormAshFall';
    mesh.frustumCulled = false;
    // With the anvil (made first, so drawn first): the curtains hang in front of its underside.
    mesh.renderOrder = 20;
    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose?.();
        },
    };
}

/** A sheet of the air: premultiplied "over", both faces, no depth written. */
function sheetMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.fog = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}
