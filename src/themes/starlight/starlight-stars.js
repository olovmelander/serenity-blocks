/**
 * Starlight — the stars: the field, the glints of the brightest and of the stars the board has
 * kindled, and the lines of the constellations.
 *
 * THE FIELD. Every star is a strip of quads laid along its own circle round the pole, from
 * where it stands now back to where it stood `exposure` radians ago. With the shutter closed the
 * strip is one round point; as a chain opens it the point draws a trail, a capsule shaded in the
 * fragment (a bright head, a tail that fades), and with the mirror below the arcs close into
 * circles. Nothing is accumulated: a trail is a function of the sky's angle and the exposure, so
 * a frozen clock replays it exactly.
 *
 * Each part is drawn twice: in the sky, and in the lake (the same instances, their direction
 * mirrored and bent by the water's slope, dimmer). Stars set behind the far hills.
 *
 * GLINTS. The brightest stars of the catalogue and every kindled star carry a small lens flare:
 * a soft heart, a halo and four thin spikes, fixed to the lens (they do not turn with the sky).
 * A kindled star flashes when its mote arrives.
 *
 * LINES. A figure's lines are thin strips between two sky directions, drawn on from one star to
 * the other with a bright point at the tip, short of the stars at both ends.
 */
import * as THREE from 'three/webgpu';
import {
    abs,
    attribute,
    cameraPosition,
    clamp,
    cross,
    exp,
    float,
    floor,
    fract,
    int,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    FIGURES_KEPT, FIGURE_LINES, FIGURE_STARS,
} from './starlight-core.js';
import {
    SKY_RADIUS, mirrorDir, mirrorShare, ridges, sized, skyDir, skyTangent, starColour,
} from './starlight-tsl.js';

/** Catalogue stars bright enough to carry a glint (the catalogue is sorted brightest first). */
export const BRIGHT_GLINTS = 36;
export const KINDLED = FIGURES_KEPT * FIGURE_STARS;
export const GLINTS = BRIGHT_GLINTS + KINDLED;
export const LINES = FIGURES_KEPT * FIGURE_LINES;
const LINE_SEGMENTS = 6;

const additive = () => new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
    fog: false,
});

/** How bright the air lets a thing at height `y` (the sine of its altitude) through, and how red. */
const throughAir = (y) => {
    const mass = float(1.0).div(max(y, 0.0).add(0.06));
    const kept = exp(mass.sub(1.0).mul(-0.17));
    return { kept, tint: mix(vec3(1.0, 0.78, 0.56), vec3(1.0, 1.0, 1.0), kept) };
};

/** 1 above the far hills, 0 behind them. */
const aboveHills = (noise, d) => {
    const crest = ridges(noise, d);
    return smoothstep(0.0, 0.004, d.y.sub(max(crest.x, crest.y)));
};

// ── The field ────────────────────────────────────────────────────────────────────

function stripGeometry(segments) {
    // position = (share of the trail 0 head … 1 tail, side −1 | +1, cap +1 head | −1 tail | 0)
    const rowsCount = segments + 1;
    const position = new Float32Array(rowsCount * 2 * 3);
    const index = [];
    for (let i = 0; i < rowsCount; i += 1) {
        for (let s = 0; s < 2; s += 1) {
            const v = (i * 2 + s) * 3;
            position[v] = i / segments;
            position[v + 1] = s === 0 ? -1 : 1;
            let cap = 0;
            if (i === 0) cap = 1;
            else if (i === segments) cap = -1;
            position[v + 2] = cap;
        }
        if (i < segments) {
            const o = i * 2;
            index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
    }
    return { position: new THREE.BufferAttribute(position, 3), index };
}

function fieldMaterial({
    u, noise, tier, mirrored,
}) {
    const material = additive();
    const polar = attribute('aPolar', 'vec4'); // cos ρ, sin ρ, θ, magnitude
    const look = attribute('aLook', 'vec4'); // temperature, twinkle phase, twinkle rate, random
    const share = positionGeometry.x;
    const side = positionGeometry.y;
    const cap = positionGeometry.z;

    // Scene-linear light of a star of this magnitude (2 → 1.0; five magnitudes fainter → 0.063).
    const light = exp(polar.w.sub(2.0).mul(-0.5526));
    // Its point's radius in pixels, and the quad that holds the point and its soft skirt.
    const pixels = light.sqrt().mul(0.52).add(0.9);
    const half = sized(u, pixels.mul(2.4), 1.5);

    const head = polar.z.add(u.skyAngle);
    const angle = head.sub(share.mul(u.exposure));
    const d = skyDir(u, polar.x, polar.y, angle);
    const along = skyTangent(u, angle);
    const across = cross(d, along);
    // The trail's length on the sky, in quad half-widths.
    const reach = u.exposure.mul(polar.y).div(half);

    const sees = aboveHills(noise, d);
    const air = throughAir(d.y);
    let centre = d;
    let alongOut = along;
    let acrossOut = across;
    let shown = sees;
    if (mirrored) {
        centre = mirrorDir(u, noise, cameraPosition, d, tier);
        alongOut = vec3(along.x, along.y.negate(), along.z);
        acrossOut = vec3(across.x, across.y.negate(), across.z);
        // The lake gives back less, and nothing of a star whose image the swell lifts off it.
        shown = sees.mul(mirrorShare(centre)).mul(step(centre.y, -0.0006)).mul(0.86);
    }
    const offset = alongOut.mul(cap).add(acrossOut.mul(side)).mul(half);
    // A star behind the hills (or below the cap of the sky the frame can see) is not drawn.
    material.positionNode = cameraPosition.add(centre.add(offset.mul(step(0.002, shown))).mul(SKY_RADIUS));

    // Twinkle: the air's own, strongest low in the sky, stilled by a long exposure.
    const beat = sin(u.time.mul(look.z).add(look.y)).mul(sin(u.time.mul(look.z).mul(0.37).add(look.y.mul(1.7))));
    const depth = exp(max(d.y, 0.0).div(-0.16)).mul(0.5).add(0.09).mul(u.shutter.oneMinus());
    const twinkle = beat.mul(depth).add(1.0);

    const colour = starColour(look.x).mul(air.tint);
    const vColour = varying(vec4(colour.mul(light).mul(air.kept).mul(shown).mul(twinkle)
        .mul(u.starPower), reach));
    // (arc position in half-widths: −1 at the head's cap … reach + 1 at the tail's, side)
    const vAt = varying(vec2(share.mul(reach).sub(cap), side));

    const a = vAt.x;
    const lenA = max(vColour.w, 0.0);
    const da = a.sub(clamp(a, 0.0, lenA));
    const b = vAt.y;
    // The capsule (the whole trail) and the point at its head.
    const body = exp(da.mul(da).add(b.mul(b)).mul(-5.6));
    const point = exp(a.mul(a).add(b.mul(b)).mul(-5.6));
    const tail = clamp(a.div(max(lenA, 1e-3)), 0.0, 1.0).oneMinus();
    // The trail is dimmer than the star that draws it, fades to its end, and a long exposure
    // spreads the light thinner still.
    const drawn = body.mul(tail.mul(tail.mul(0.6).add(0.4))).mul(float(0.62).div(u.shutter.mul(0.7).add(1.0)));
    material.outputNode = vec4(vColour.rgb.mul(max(point, drawn)).mul(1.5), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}

function createField({
    u, noise, tier, catalog,
}) {
    // The same stars as two meshes: one quad a star while the shutter is closed (most of the
    // time), the whole strip once it opens. Same material and the same attribute layout, so the
    // second costs no pipeline of its own.
    const quad = stripGeometry(1);
    const strip = stripGeometry(tier.segments);
    const polar = new THREE.InstancedBufferAttribute(catalog.polar, 4);
    const look = new THREE.InstancedBufferAttribute(catalog.look, 4);
    const build = (count, mirrored) => {
        const material = fieldMaterial({
            u, noise, tier, mirrored,
        });
        const mesh = (shape, trailing) => {
            const geometry = new THREE.InstancedBufferGeometry();
            geometry.setIndex(shape.index);
            geometry.setAttribute('position', shape.position);
            geometry.setAttribute('aPolar', polar);
            geometry.setAttribute('aLook', look);
            geometry.instanceCount = count;
            const drawn = new THREE.Mesh(geometry, material);
            drawn.frustumCulled = false;
            drawn.renderOrder = mirrored ? 20 : 21;
            drawn.name = `starlight-field${mirrored ? '-mirror' : ''}${trailing ? '-trails' : ''}`;
            return drawn;
        };
        return { material, points: mesh(quad, false), trails: mesh(strip, true) };
    };
    const sky = build(catalog.count, false);
    const lake = build(Math.max(1, Math.round(catalog.count * tier.mirror)), true);
    const parts = [sky, lake];
    const setTrailing = (on) => {
        parts.forEach((part) => {
            part.points.visible = !on;
            part.trails.visible = on;
        });
    };
    setTrailing(false);
    return {
        objects: [lake.points, lake.trails, sky.points, sky.trails],
        setTrailing,
        dispose() {
            parts.forEach((part) => {
                part.points.geometry.dispose();
                part.trails.geometry.dispose();
                part.material.dispose();
            });
        },
    };
}

// ── Glints ───────────────────────────────────────────────────────────────────────

function glintMaterial({
    u, noise, tier, mirrored,
}) {
    const material = additive();
    const polar = attribute('aGlint', 'vec4'); // cos ρ, sin ρ, θ, the moment it was kindled
    // rgb, and the figure's slot + the star's weight (a weight of 0 = not there)
    const paint = attribute('aGlintPaint', 'vec4');
    const weight = fract(paint.w);
    const figure = u.figures.element(int(floor(paint.w).add(0.5)));
    const born = u.time.sub(polar.w);
    const there = step(0.0, born).mul(step(0.001, weight)).mul(figure.x);
    const d = skyDir(u, polar.x, polar.y, polar.z.add(u.skyAngle));
    const sees = aboveHills(noise, d);
    const air = throughAir(d.y);
    let centre = d;
    let shown = sees.mul(there);
    if (mirrored) {
        centre = mirrorDir(u, noise, cameraPosition, d, tier);
        shown = shown.mul(mirrorShare(centre)).mul(step(centre.y, -0.0006)).mul(0.8);
    }
    // The flash of arrival: the glint opens wide for a moment, then settles.
    const arrival = exp(max(born, 0.0).mul(-3.2));
    const pixels = weight.mul(30.0).add(18.0).mul(arrival.mul(1.5).add(1.0)).mul(figure.y.mul(0.5).add(1.0));
    const span = u.design.mul(pixels);
    const size = span.mul(step(0.002, shown));
    const corner = u.camRight.mul(positionGeometry.x).add(u.camUp.mul(positionGeometry.y)).mul(2.0);
    material.positionNode = cameraPosition.add(centre.add(corner.mul(size)).mul(SKY_RADIUS));

    const breath = sin(u.time.mul(1.3).add(polar.z.mul(7.0))).mul(0.1).add(1.0);
    const power = weight.mul(air.kept).mul(shown).mul(breath)
        .mul(arrival.mul(3.2).add(1.0).add(figure.y.mul(2.2)));
    // (the glint's half-size in pixels of the buffer: the fragment draws its spikes a pixel wide)
    const vLight = varying(vec4(paint.xyz.mul(air.tint).mul(power), span.div(u.texel)));
    const q = uv().sub(0.5).mul(2.0);
    const r2 = q.dot(q);
    const r = r2.sqrt();
    const edge = smoothstep(1.0, 0.72, r);
    // Sizes in pixels, so a spike is a pixel wide whatever the glint's size.
    const px = vLight.a;
    const heart = exp(r2.mul(px).mul(px).div(-4.6)).mul(2.6);
    const halo = exp(r.mul(-6.5)).mul(0.2);
    // Four spikes, a pixel wide and fading outward, a hair of a second pair between them.
    const spike = (x, y) => exp(abs(y).mul(px).mul(-1.15)).mul(exp(abs(x).mul(-3.6)));
    const qd = vec2(q.x.add(q.y), q.x.sub(q.y)).mul(0.7071);
    const spikes = spike(q.x, q.y).add(spike(q.y, q.x)).mul(0.55)
        .add(spike(qd.x, qd.y).add(spike(qd.y, qd.x)).mul(0.11));
    // A long exposure washes the spikes out; the arrival shows them at their longest.
    const flare = spikes.mul(u.shutter.mul(-0.55).add(1.0));
    material.outputNode = vec4(vLight.rgb.mul(heart.add(halo).add(flare)).mul(edge), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}

function createGlints({
    u, noise, tier, catalog,
}) {
    const base = new THREE.PlaneGeometry(1, 1);
    const polar = new Float32Array(GLINTS * 4);
    const paint = new Float32Array(GLINTS * 4);
    // The catalogue's brightest: there from the start (kindled long ago).
    const bright = Math.min(BRIGHT_GLINTS, catalog.count);
    for (let i = 0; i < bright; i += 1) {
        polar[i * 4] = catalog.polar[i * 4];
        polar[i * 4 + 1] = catalog.polar[i * 4 + 1];
        polar[i * 4 + 2] = catalog.polar[i * 4 + 2];
        polar[i * 4 + 3] = -1000;
        const mag = catalog.polar[i * 4 + 3];
        const temp = catalog.look[i * 4];
        // The CPU's copy of starColour, near enough for a flare.
        const warm = temp < 0.4;
        const weight = Math.max(0.06, Math.min(0.62, 0.42 * Math.exp(-0.5 * (mag - 0.5))));
        paint[i * 4] = warm ? 1.0 : 0.72 + 0.28 * (1 - temp);
        paint[i * 4 + 1] = warm ? 0.62 + 0.6 * temp : 0.84 + 0.12 * (1 - temp);
        paint[i * 4 + 2] = warm ? 0.36 + 1.2 * temp : 1.0;
        paint[i * 4 + 3] = FIGURES_KEPT + weight;
    }
    const polarAttr = new THREE.InstancedBufferAttribute(polar, 4);
    const paintAttr = new THREE.InstancedBufferAttribute(paint, 4);
    polarAttr.setUsage(THREE.DynamicDrawUsage);
    paintAttr.setUsage(THREE.DynamicDrawUsage);
    const build = (mirrored) => {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = base.index;
        geometry.setAttribute('position', base.attributes.position);
        geometry.setAttribute('uv', base.attributes.uv);
        geometry.setAttribute('aGlint', polarAttr);
        geometry.setAttribute('aGlintPaint', paintAttr);
        geometry.instanceCount = GLINTS;
        const mesh = new THREE.Mesh(geometry, glintMaterial({
            u, noise, tier, mirrored,
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = mirrored ? 24 : 25;
        mesh.name = mirrored ? 'starlight-glints-mirror' : 'starlight-glints';
        return mesh;
    };
    return {
        sky: build(false),
        lake: build(true),
        base,
        /**
         * Kindled star `slot` (0..KINDLED−1): where, when, what colour, and `weight` = its
         * figure's slot + how bright it is (a whole number = put out).
         */
        set(slot, cosRho, sinRho, theta, bornAt, rgb, weight) {
            const i = (BRIGHT_GLINTS + slot) * 4;
            polar[i] = cosRho;
            polar[i + 1] = sinRho;
            polar[i + 2] = theta;
            polar[i + 3] = bornAt;
            paint[i] = rgb[0];
            paint[i + 1] = rgb[1];
            paint[i + 2] = rgb[2];
            paint[i + 3] = weight;
            polarAttr.needsUpdate = true;
            paintAttr.needsUpdate = true;
        },
    };
}

// ── The figures' lines ───────────────────────────────────────────────────────────

function lineMaterial({
    u, noise, tier, mirrored,
}) {
    const material = additive();
    const from = attribute('aFrom', 'vec4'); // cos ρ, sin ρ, θ, the moment the line is drawn
    const to = attribute('aTo', 'vec4'); // cos ρ, sin ρ, θ, the figure's slot (−1 = no line)
    const t = positionGeometry.x; // 0 … 1 along the line
    const side = positionGeometry.y;
    const a = skyDir(u, from.x, from.y, from.z.add(u.skyAngle));
    const b = skyDir(u, to.x, to.y, to.z.add(u.skyAngle));
    const d = normalize(mix(a, b, t));
    const figure = u.figures.element(int(max(to.w, 0.0).add(0.5)));
    const there = step(-0.5, to.w).mul(step(0.0, u.time.sub(from.w)));
    let centre = d;
    let run = normalize(b.sub(a));
    let shown = aboveHills(noise, d).mul(there);
    if (mirrored) {
        centre = mirrorDir(u, noise, cameraPosition, d, tier);
        run = vec3(run.x, run.y.negate(), run.z);
        shown = shown.mul(mirrorShare(centre)).mul(step(centre.y, -0.0006)).mul(0.75);
    }
    const aside = normalize(cross(run, centre));
    const width = sized(u, 2.2, 1.4).mul(step(0.002, shown));
    material.positionNode = cameraPosition.add(centre.add(aside.mul(side).mul(width)).mul(SKY_RADIUS));

    const vAt = varying(vec2(t, side));
    const drawn = clamp(u.time.sub(from.w).div(0.55), 0.0, 1.0);
    const vLight = varying(vec4(u.line.mul(shown).mul(figure.x), drawn));
    const flareV = varying(figure.y);
    // Short of the stars at both ends; drawn on from the first to the second.
    const ends = smoothstep(0.06, 0.14, vAt.x).mul(smoothstep(0.94, 0.86, vAt.x));
    const on = smoothstep(0.0, 0.03, vLight.w.sub(vAt.x).add(0.03));
    const tip = exp(vAt.x.sub(vLight.w).mul(vAt.x.sub(vLight.w)).mul(-220.0)).mul(vLight.w.oneMinus().mul(4.0));
    const profile = exp(vAt.y.mul(vAt.y).mul(-4.5));
    const base = float(0.3).add(flareV.mul(1.6));
    material.outputNode = vec4(vLight.rgb.mul(profile).mul(ends).mul(on.mul(base).add(tip)), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}

function createLines({ u, noise, tier }) {
    const rowsCount = LINE_SEGMENTS + 1;
    const position = new Float32Array(rowsCount * 2 * 3);
    const index = [];
    for (let i = 0; i < rowsCount; i += 1) {
        for (let s = 0; s < 2; s += 1) {
            const v = (i * 2 + s) * 3;
            position[v] = i / LINE_SEGMENTS;
            position[v + 1] = s === 0 ? -1 : 1;
        }
        if (i < LINE_SEGMENTS) {
            const o = i * 2;
            index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
    }
    const positionAttr = new THREE.BufferAttribute(position, 3);
    const from = new Float32Array(LINES * 4);
    const to = new Float32Array(LINES * 4);
    for (let i = 0; i < LINES; i += 1) {
        from[i * 4] = 1;
        to[i * 4] = 1;
        to[i * 4 + 3] = -1;
    }
    const fromAttr = new THREE.InstancedBufferAttribute(from, 4);
    const toAttr = new THREE.InstancedBufferAttribute(to, 4);
    fromAttr.setUsage(THREE.DynamicDrawUsage);
    toAttr.setUsage(THREE.DynamicDrawUsage);
    const build = (mirrored) => {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setIndex(index);
        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('aFrom', fromAttr);
        geometry.setAttribute('aTo', toAttr);
        geometry.instanceCount = LINES;
        const mesh = new THREE.Mesh(geometry, lineMaterial({
            u, noise, tier, mirrored,
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = mirrored ? 22 : 23;
        mesh.name = mirrored ? 'starlight-lines-mirror' : 'starlight-lines';
        return mesh;
    };
    return {
        sky: build(false),
        lake: build(true),
        /** Line `slot` (0..LINES−1) of figure `figure`, drawn at `at` from star a to star b. */
        set(slot, a, b, at, figure) {
            const i = slot * 4;
            from[i] = Math.cos(a.rho);
            from[i + 1] = Math.sin(a.rho);
            from[i + 2] = a.theta;
            from[i + 3] = at;
            to[i] = Math.cos(b.rho);
            to[i + 1] = Math.sin(b.rho);
            to[i + 2] = b.theta;
            to[i + 3] = figure;
            fromAttr.needsUpdate = true;
            toAttr.needsUpdate = true;
        },
        clear(slot) {
            to[slot * 4 + 3] = -1;
            toAttr.needsUpdate = true;
        },
    };
}

export function createStars({
    u, noise, tier, catalog,
}) {
    const field = createField({
        u, noise, tier, catalog,
    });
    const glints = createGlints({
        u, noise, tier, catalog,
    });
    const lines = createLines({ u, noise, tier });
    const stars = new THREE.Group();
    stars.name = 'starlight-stars';
    stars.add(...field.objects);
    const figures = new THREE.Group();
    figures.name = 'starlight-figures';
    figures.add(lines.lake, lines.sky, glints.lake, glints.sky);
    const meshes = [glints.sky, glints.lake, lines.sky, lines.lake];
    return {
        stars,
        figures,
        setGlint: glints.set,
        /** Draw every star as a trail (the shutter is open) or as one point (it is closed). */
        setTrailing: field.setTrailing,
        setLine: lines.set,
        clearLine: lines.clear,
        dispose() {
            meshes.forEach((mesh) => {
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
            glints.base.dispose();
            field.dispose();
        },
    };
}
