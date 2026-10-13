/**
 * Pyrestorm — the sky dome.
 *
 * The watch's night: zenith to horizon, the dusk's afterglow (or the dawn's rose) low on its own
 * bearing, the haze over the country warmed where the lava glows under it, stars and a faint
 * Milky Way over the clear, upwind side (the anvil, drawn in front, roofs the rest).
 *
 * Drawn LAST among the opaque parts with the depth test on and no depth write, so it is shaded
 * only where the sky shows.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    clamp,
    exp,
    float,
    floor,
    length,
    max,
    mix,
    normalize,
    positionWorld,
    sin,
    smoothstep,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { CRATER, FISSURE } from './pyrestorm-core.js';
import { pyHash21, pyHash22, wideGlowAt } from './pyrestorm-tsl.js';

export const SKY_RADIUS = 85000;

/** The sky's colour along a direction (no stars): what the haze and the anvil's edges melt into. */
export function skyColour(u, t, dir) {
    const el = dir.y;
    const up = smoothstep(-0.02, 0.55, el);
    const base = mix(u.horizon, u.zenith, up.mul(up.mul(-0.4).add(1.4)).clamp(0.0, 1.0)).toVar();
    // The dusk (or dawn) low on its bearing.
    const bearing = atan(dir.x, dir.z.negate());
    const db = bearing.sub(u.duskBearing);
    const band = exp(abs(db).mul(-1.15)).mul(exp(max(el, 0.0).div(-0.09)));
    base.addAssign(u.dusk.mul(band));
    // Haze over the country: warm where the lava glows below it (the far field's wide glow,
    // read where this line meets a layer of smoke two kilometres up).
    const tSmoke = float(2000.0).sub(u.eye.y).div(max(el, 0.012));
    const at = u.eye.xz.add(dir.xz.mul(tSmoke.min(60000.0)));
    const g = wideGlowAt(t, at);
    base.addAssign(u.fireColour.mul(g.mul(0.075).mul(u.activity)).mul(exp(max(el, 0.0).div(-0.05))));
    return base;
}

export function createSky(u, t) {
    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 64, 32);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormSky';
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    const volcanoBearing = Math.atan2(CRATER.x, -CRATER.z);
    const fissureBearing = Math.atan2((FISSURE.a[0] + FISSURE.b[0]) / 2, -(FISSURE.a[1] + FISSURE.b[1]) / 2);
    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(u.eye)).toVar();
        const sky = skyColour(u, t, dir).toVar();
        const bearing = atan(dir.x, dir.z.negate());
        // The eruption's glow on the low smoke over the vents.
        const lobe = exp(abs(bearing.sub(volcanoBearing)).mul(-4.0)).mul(1.0)
            .add(exp(abs(bearing.sub(fissureBearing)).mul(-6.0)).mul(0.4));
        sky.addAssign(u.fireColour.mul(lobe.mul(0.05).mul(u.activity)).mul(exp(max(dir.y, 0.0).div(-0.06))));

        If(dir.y.greaterThan(-0.01), () => {
            // ── The Milky Way: a faint band across the upwind sky ──
            // The band arcs up the clear, upwind sky on the left (the anvil roofs the right).
            const across = dir.x.mul(0.667).sub(dir.y.mul(0.285)).sub(dir.z.mul(0.689));
            const bandW = exp(across.mul(across).mul(-26.0));
            const mw = texture(t.noise, vec2(bearing.mul(0.9), dir.y.mul(2.4))).r;
            const lanes = smoothstep(0.35, 0.75, texture(t.noise, vec2(bearing.mul(2.3), dir.y.mul(6.0)).add(0.3)).g);
            const milky = bandW.mul(mw.mul(0.9).add(0.1)).mul(float(1.0).sub(lanes.mul(0.55)));
            sky.addAssign(vec3(0.045, 0.04, 0.06).mul(milky).mul(u.stars).mul(smoothstep(0.03, 0.3, dir.y)));

            // ── Stars: a lattice on the sphere, one star a cell, two sizes ──
            const starLayer = (scale, keep, gain) => {
                const q = dir.mul(scale);
                const cell = floor(q);
                const h = pyHash21(cell.xy.add(cell.z.mul(17.31)));
                const jitter = vec3(pyHash22(cell.xz.add(3.7)), h).mul(0.56).add(0.22);
                const d = length(q.sub(cell.add(jitter)));
                // A star is about a pixel wide whatever the lens.
                const px = u.pixelAngle.mul(scale).mul(0.9).max(0.05);
                const bright = smoothstep(keep, 1.0, h).mul(exp(d.div(px).mul(d.div(px)).negate()));
                const twinkle = sin(u.time.mul(h.mul(3.0).add(1.4)).add(h.mul(90.0))).mul(0.25).add(0.75);
                const tint = mix(vec3(1.0, 0.82, 0.7), vec3(0.75, 0.85, 1.1), pyHash21(cell.yz));
                return tint.mul(bright).mul(twinkle).mul(gain);
            };
            const stars = starLayer(170.0, 0.9, 1.6).add(milky.mul(starLayer(420.0, 0.82, 0.7)));
            sky.addAssign(stars.mul(u.stars).mul(smoothstep(0.015, 0.2, dir.y)));
        });
        sky.assign(max(sky, vec3(0.0)));
        return vec4(sky, 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'PyrestormSky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {
        mesh,
        meshes: [mesh],
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export { clamp };
