/**
 * Wolfhour — the wolves' one material and the table it reads.
 *
 * Every wolf is a small quad. Its rig (wolfhour-wolf-rig.js) is a list of tapered capsules with a
 * depth toward the viewer, a coat tone and a fur length each; the table holds one row of them per
 * wolf (a float texture, read with textureLoad: no filtering, WebGPU and WebGL2 alike), followed by
 * the wolf's own numbers (its eyes, the moon's side, its coat). One shader for all of them:
 *
 *   - the capsules are unioned smoothly into one outline, as before;
 *   - under each pixel the nearest capsule's rounded surface gives a depth and a normal (a smooth
 *     maximum over the capsules), so the body has volume: near legs stand before far ones, the
 *     moon lights the back, the head and the shoulders, the belly keeps the snow's blue bounce;
 *   - the coat's three colours follow the capsules' tones (saddle, flank, pale legs and cheeks);
 *   - the outline frays into tufts where the fur is long (ruff, britches, brush) and stays clean
 *     on the legs and the muzzle;
 *   - a hairline of moonlight runs along the edges that face the moon, and the eyes give it back.
 *
 * One material and one pipeline for the whole night's wolves; a wolf's row is its mesh's own
 * number (`userData.wolfRow`, read per object).
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, clamp, dot, exp, float, fwidth, int, ivec2, length, max, min, mix, normalize,
    positionGeometry, smoothstep, sqrt, texture, textureLoad, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { CAPSULE_COUNT, CAPSULE_STRIDE } from './wolfhour-wolf-rig.js';

/** Texels a wolf's capsules take (three each), and the wolf's own texels after them. */
export const CAPSULE_TEXELS = (CAPSULE_COUNT * CAPSULE_STRIDE) / 4;
export const WOLF_TEXELS = Object.freeze({
    /** eye x, y, how open it is and faces the viewer; the wolf's fade */
    eye: CAPSULE_TEXELS,
    /** the far eye; the moon's side (the screen moon's x seen from the wolf's own frame) */
    eye2: CAPSULE_TEXELS + 1,
    /** a shake: the fur's shiver (x, y), how far the coat fluffs out; the wolf's fur seed */
    shake: CAPSULE_TEXELS + 2,
    /** the coat's dark, mid and pale (rgb); the eyes' gain, how deep it stands in the air, spare */
    dark: CAPSULE_TEXELS + 3,
    mid: CAPSULE_TEXELS + 4,
    pale: CAPSULE_TEXELS + 5,
});
export const TABLE_WIDTH = CAPSULE_TEXELS + 6;

/** The moon's direction for the wolves (screen x left, up, toward the viewer): a grazing light. */
export const WOLF_MOON = Object.freeze([-0.55, 0.78, 0.3]);
/**
 * Moonlight, the sky's fill, the snow's bounce and the rim, in the light the ranges are lit by
 * (linear, before the grade): moonlit snow there is about 0.9 of the moonlight, snow in shade
 * about 0.9 of the fill, so a white wolf's back is as bright as the snow it stands on and a grey
 * one's a quarter of it. Coats (wolfhour-wolf-coats.js) are albedos.
 */
const MOON_LIGHT = vec3(0.36, 0.44, 0.62);
const SKY_FILL = vec3(0.03, 0.05, 0.115);
const SNOW_BOUNCE = vec3(0.045, 0.062, 0.105);
const RIM = vec3(0.4, 0.5, 0.72);
/** The eyes' shine: the amber a wolf's eyes give a light back in. */
const EYE = vec3(1.0, 0.72, 0.3);
/** The light's balance: key, how far it wraps, its fall-off, fill, bounce. */
const LIGHT = Object.freeze({
    key: 1.15, wrap: 0.14, power: 1.6, fill: 1, bounce: 1,
});

/**
 * The table: `rows` wolves of TABLE_WIDTH texels. `data` is written by wolfhour-wolves.js each
 * frame (`touch()` afterwards).
 */
export function createWolfTable(rows) {
    const count = Math.max(1, Math.floor(rows));
    const data = new Float32Array(TABLE_WIDTH * count * 4);
    const map = new THREE.DataTexture(data, TABLE_WIDTH, count, THREE.RGBAFormat, THREE.FloatType);
    map.name = 'Wolfhour wolf table';
    map.minFilter = THREE.NearestFilter;
    map.magFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.NoColorSpace;
    map.needsUpdate = true;
    return {
        map,
        data,
        rows: count,
        /** Float offset of texel `texel` of row `row`. */
        offset: (row, texel = 0) => (row * TABLE_WIDTH + texel) * 4,
        touch() { map.needsUpdate = true; },
    };
}

/**
 * The wolves' material. `noise` is the sky's noise tile (its second channel is one octave of
 * value noise, a lattice every two texels); `uMoonTint` and `uShadeTint` are the hour of the
 * night's (the night light's `uMoon` and `uShade`).
 */
export function createWolfMaterial({
    table, noise, uMoonTint, uShadeTint,
}) {
    const uRow = uniform(0).onObjectUpdate(({ object }) => object.userData.wolfRow ?? 0);
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour wolf',
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const shape = Fn(() => {
        const p = positionGeometry.xy.toVar();
        const row = int(uRow.add(0.5)).toVar();
        const eye = textureLoad(table, ivec2(WOLF_TEXELS.eye, row)).toVar();
        const eye2 = textureLoad(table, ivec2(WOLF_TEXELS.eye2, row)).toVar();
        const shake = textureLoad(table, ivec2(WOLF_TEXELS.shake, row)).toVar();
        const dark = textureLoad(table, ivec2(WOLF_TEXELS.dark, row)).toVar();
        const mid = textureLoad(table, ivec2(WOLF_TEXELS.mid, row)).toVar();
        const pale = textureLoad(table, ivec2(WOLF_TEXELS.pale, row)).toVar();
        // The outline (d, with its gradient g), the front surface (z, its normal n) and the coat
        // (tone, fur length) of whichever capsule is nearest the viewer.
        const d = float(1e3).toVar();
        const g = vec2(0, 1).toVar();
        const z = float(-1e3).toVar();
        const n = vec3(0, 0, 1).toVar();
        const coat = vec2(0.5, 1).toVar();
        Loop(CAPSULE_COUNT, ({ i }) => {
            const c = i.mul(3).toVar();
            const a = textureLoad(table, ivec2(c, row)).toVar();
            const b = textureLoad(table, ivec2(c.add(1), row)).toVar();
            const e = textureLoad(table, ivec2(c.add(2), row)).toVar();
            const pa = p.sub(a.xy).toVar();
            const ba = a.zw.sub(a.xy).toVar();
            const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-4)), 0, 1).toVar();
            const q = pa.sub(ba.mul(h)).toVar();
            const len = max(length(q), 1e-4).toVar();
            const r = max(mix(b.x, b.y, h), 1e-3).toVar();
            const dist = len.sub(r).toVar();
            // Smooth union, carrying its gradient: m is the weight the union so far keeps.
            const k = max(b.z, 1e-3).toVar();
            const m = clamp(float(0.5).add(dist.sub(d).mul(0.5).div(k)), 0, 1).toVar();
            const dir = q.div(len).toVar();
            d.assign(mix(dist, d, m).sub(k.mul(m).mul(float(1).sub(m))));
            g.assign(mix(dir, g, m));
            // This capsule's rounded surface under the pixel; outside it, it falls away behind.
            const s = min(len.div(r), 1).toVar();
            const cz = sqrt(max(float(1).sub(s.mul(s)), 0)).toVar();
            const zf = mix(e.x, e.y, h).add(r.mul(cz)).sub(max(dist, 0).mul(3)).toVar();
            const kz = k.mul(0.7).add(0.25).toVar();
            const mz = clamp(float(0.5).add(zf.sub(z).mul(0.5).div(kz)), 0, 1).toVar();
            z.assign(mix(z, zf, mz).add(kz.mul(mz).mul(float(1).sub(mz))));
            n.assign(mix(n, vec3(dir.mul(s), cz), mz));
            coat.assign(mix(coat, vec2(b.w, e.z), mz));
        });
        const fur = coat.y.toVar();
        // Tufts: streaks that lie back along the body fray the edges that stand upright (the
        // ruff, the britches, the brush); shorter ones hang under the belly.
        const seed = shake.w;
        const lean = p.x.sub(p.y.mul(0.35)).toVar();
        const shiver = shake.xy;
        const n1 = texture(noise, vec2(lean.mul(0.496), p.y.mul(1.302)).div(64).add(vec2(seed, seed.mul(1.7)))
            .add(shiver)).g.toVar();
        const n2 = texture(noise, vec2(p.x.mul(1.364), p.y.mul(0.496)).div(64).add(vec2(seed.mul(2.3), 0.4))
            .add(shiver.mul(2.3))).g.toVar();
        const n3 = texture(noise, vec2(lean.mul(1.054), p.y.mul(2.604)).div(64).add(vec2(0.31, seed.mul(0.9)))).g
            .toVar();
        const tuft = max(n1.mul(0.7).add(n3.mul(0.3)).sub(0.4), 0).mul(1.7)
            .add(max(n2.sub(0.5), 0).mul(0.5));
        // (A shake fluffs the whole coat out by shake.z units.)
        const edge = d.sub(tuft.mul(fur).mul(shake.z.mul(1.6).add(1.1))).add(fur.mul(0.12)).sub(shake.z).toVar();
        const fw = max(fwidth(p.x).mul(0.75), 1e-3).toVar();
        const cover = float(1).sub(smoothstep(fw.negate(), fw, edge));
        // The normal: inside the union's fillets and the fringe no capsule stands under the
        // pixel, so the outline's own gradient is turned toward the viewer by how deep it lies.
        const inset = clamp(d.negate().div(2.2), 0, 1).toVar();
        const round = sqrt(max(float(1).sub(float(1).sub(inset).mul(float(1).sub(inset))), 0)).toVar();
        const gDir = g.div(max(length(g), 1e-3)).toVar();
        const flatness = n.z.div(max(length(n), 1e-3));
        const w = clamp(round.mul(0.9).sub(flatness).mul(4), 0, 1).toVar();
        const shaped = mix(n, vec3(gDir.mul(float(1).sub(round)), round), w).toVar();
        // Fur breaks the smooth surface a little.
        const rough = vec3(
            n3.sub(0.5).mul(0.05).mul(fur),
            n1.mul(0.6).add(n3.mul(0.4)).sub(0.5).mul(0.1)
                .mul(fur),
            0,
        );
        const normal = normalize(shaped.add(rough).add(vec3(0, 0, 1e-3))).toVar();
        // The moon stands upper left on screen; a mirrored wolf sees it from its other side.
        const moon = normalize(vec3(eye2.w.mul(WOLF_MOON[0]), WOLF_MOON[1], WOLF_MOON[2])).toVar();
        const ndl = dot(normal, moon).toVar();
        const lit = clamp(ndl.add(LIGHT.wrap).div(1 + LIGHT.wrap), 0, 1).pow(LIGHT.power);
        const sky = normal.y.mul(0.5).add(0.5);
        const bounce = normal.y.negate().max(0);
        // The coat: dark saddle, mid flank, pale legs, belly and cheeks, broken by the fur.
        const tone = clamp(coat.x.add(n1.sub(0.5).mul(0.22)).sub(normal.y.mul(0.06)), 0, 1).toVar();
        const albedo = mix(
            mix(dark.rgb, mid.rgb, smoothstep(0.02, 0.5, tone)),
            pale.rgb,
            smoothstep(0.5, 0.95, tone),
        ).toVar();
        // The far legs and the far ear stand back in the dusk.
        const near = mix(0.55, 1, smoothstep(-3.5, 1.5, z));
        const moonXY = normalize(moon.xy);
        const facing = dot(gDir, moonXY);
        const band = float(1).sub(smoothstep(0, max(fw.mul(2.2), 0.7), edge.negate()));
        const rim = band.mul(smoothstep(0.25, 0.9, facing));
        const sheen = clamp(ndl, 0, 1).pow(6).mul(0.25);
        const light = MOON_LIGHT.mul(uMoonTint).mul(lit).mul(LIGHT.key)
            .add(SKY_FILL.mul(uShadeTint).mul(sky.mul(0.7).add(0.3)).mul(LIGHT.fill))
            .add(SNOW_BOUNCE.mul(uShadeTint).mul(bounce).mul(LIGHT.bounce));
        const body = albedo.mul(light)
            .add(MOON_LIGHT.mul(uMoonTint).mul(sheen).mul(albedo.mul(0.3).add(0.02)))
            .mul(near)
            .add(RIM.mul(uMoonTint).mul(rim).mul(albedo.mul(0.9).add(0.22)));
        const eyeA = p.sub(eye.xy);
        const eyeB = p.sub(eye2.xy);
        const glint = exp(dot(eyeA, eyeA).mul(-9)).mul(eye.z).add(exp(dot(eyeB, eyeB).mul(-9)).mul(eye2.z));
        return vec4(body.add(EYE.mul(glint).mul(dark.w)), cover.mul(eye.w));
    })();
    material.colorNode = shape.rgb;
    material.opacityNode = shape.a;
    return material;
}
