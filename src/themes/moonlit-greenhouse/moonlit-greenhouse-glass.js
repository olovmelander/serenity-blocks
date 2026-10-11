/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Moonlit Greenhouse — the glass: the pointed vault, the side walls and the far end screen, seen
 * from inside, with the night beyond them.
 *
 * One mesh of the house's inner glass surface, parametrised by the glass's own coordinates
 * (metres along the house, metres of arc up from the spring; the side walls carry negative
 * heights below it), so every pane, bar and purlin is a line in those coordinates and the
 * moonlight function (mgGlazing) and this surface agree exactly. Each pixel shows:
 *   the sky beyond (mgSky) through old glass: every pane tilted a hair its own way, so the moon
 *   breaks a little at the bars, a pale green cast, a few panes fogged, a few vents propped open;
 *   the condensation: beads of water (the noise's bead field) that catch the moon's glow on their
 *   rims, and a film of mist on the glass that the moon lights into a wide halo round itself,
 *   cleared in streaks where drops have run down;
 *   the iron: glazing bars, purlins, the ridge and the spring beam, dark against the sky with a
 *   cold line of moonlight on the edge that faces the moon;
 *   the board's light: a clear's wave of moonlight runs across the glazing pane by pane, a lit
 *   pane flaring as the front passes; four lines flood every pane at once.
 * The main arched ribs are geometry (moonlit-greenhouse-iron.js) and stand in front of this.
 *
 * Drawn last of the opaque parts (depth-tested), so it is only shaded where the sky shows.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, floor,
    fract, fwidth, int, length, max, mix, normalize, positionWorld, select, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import {
    ARC, GLAZING, HOUSE,
} from './moonlit-greenhouse-core.js';
import {
    mgBlind, mgLine, mgLuma, mgPaneHash, mgSky,
} from './moonlit-greenhouse-tsl.js';

/** The glass surface: a strip across the house (left wall, vault, right wall) and the far screen. */
export function buildGlassGeometry(segments = 120) {
    const {
        halfSpan, spring, plinth, near, far,
    } = HOUSE;
    const wall = spring - plinth;
    const total = 2 * (ARC.length + wall);
    const positions = [];
    const glass = [];
    const index = [];
    // Across: u runs from the left wall's foot, up it, over the vault, down the right wall.
    const across = [];
    for (let i = 0; i <= segments; i += 1) {
        const u = (i / segments) * total;
        let x;
        let y;
        let s;
        let isWall = 0;
        if (u < wall) {
            x = -halfSpan;
            y = plinth + u;
            s = y - spring;
            isWall = 1;
        } else if (u < wall + ARC.length) {
            s = u - wall;
            const th = Math.PI - s / ARC.radius;
            x = ARC.offset + ARC.radius * Math.cos(th);
            y = spring + ARC.radius * Math.sin(th);
        } else if (u < wall + 2 * ARC.length) {
            s = wall + 2 * ARC.length - u; // arc length from the RIGHT spring
            const th = Math.PI - s / ARC.radius;
            x = -(ARC.offset + ARC.radius * Math.cos(th));
            y = spring + ARC.radius * Math.sin(th);
        } else {
            x = halfSpan;
            y = spring - (u - wall - 2 * ARC.length);
            s = y - spring;
            isWall = 1;
        }
        across.push({
            x, y, s, isWall,
        });
    }
    // Two rows along the house: the surface is straight along z.
    for (const z of [near, far]) {
        across.forEach((a) => {
            positions.push(a.x, a.y, z);
            glass.push(a.s, a.isWall);
        });
    }
    const n = across.length;
    for (let i = 0; i < segments; i += 1) {
        // Faces point INTO the house (toward the axis), seen from inside.
        index.push(i, i + 1, n + i, i + 1, n + i + 1, n + i);
    }
    // The far end screen: the pointed arch's outline fanned from a point at its foot's middle.
    const base = positions.length / 3;
    positions.push(0, 0, far);
    glass.push(0, 2);
    for (let i = 0; i <= segments; i += 1) {
        const a = across[i];
        positions.push(a.x, a.y, far);
        glass.push(a.y, 2);
    }
    positions.push(-halfSpan, 0, far);
    glass.push(0, 2);
    positions.push(halfSpan, 0, far);
    glass.push(0, 2);
    for (let i = 0; i < segments; i += 1) index.push(base, base + 2 + i, base + 1 + i);
    // The two corners under the side walls' plinths, down to the floor.
    index.push(base, base + 1, base + segments + 2, base, base + segments + 3, base + 1 + segments);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('aGlass', new THREE.Float32BufferAttribute(glass, 2));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
}

/**
 * The glass part. ctx = { tier, U, noise }.
 */
export function createGlass({ tier, U, noise }) {
    const geometry = buildGlassGeometry(tier.noise >= 512 ? 160 : 110);
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    material.name = 'moonlit-greenhouse-glass';
    const G = attribute('aGlass', 'vec2');
    const { night } = U;

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const d = normalize(p.sub(cameraPosition)).toVar();
        const along = p.z;
        const s = G.x;
        const kind = G.y;
        const isWall = kind.greaterThan(0.5).and(kind.lessThan(1.5));
        const isEnd = kind.greaterThan(1.5);
        // Pixel footprint in metres (for the iron's edges).
        const foot = max(fwidth(along), fwidth(s)).mul(1.2).add(0.002);
        // ── The iron.
        const g = GLAZING;
        const rib = mgLine(along, float(g.ribEvery), float(g.ribWidth * 0.55), foot);
        const bar = mgLine(along, float(g.barEvery), float(g.barWidth), foot);
        const purlin = mgLine(s, float(g.purlinEvery), float(g.purlinWidth), foot);
        const ridgeAt = float(ARC.length - g.ridgeWidth * 0.5);
        const ridge = smoothstep(ridgeAt.sub(foot), ridgeAt.add(foot), s);
        const springBeam = float(1.0).sub(smoothstep(float(0.12).sub(foot), float(0.12).add(foot), s));
        const ironVault = max(max(rib, bar), max(max(purlin, ridge), springBeam));
        const h = s.add(HOUSE.spring);
        const mullion = mgLine(along, float(g.mullionEvery), float(g.barWidth * 1.4), foot);
        const tw = float(g.transomWidth * 0.5);
        const transom = max(
            float(1.0).sub(smoothstep(tw, tw.add(foot), abs(h.sub(g.transoms[0])))),
            float(1.0).sub(smoothstep(tw, tw.add(foot), abs(h.sub(g.transoms[1])))),
        );
        const ironWall = max(mullion, transom);
        // The far screen: a grid of mullions and transoms in (x, height).
        const endBars = max(mgLine(p.x, float(1.2), float(0.06), foot), mgLine(s, float(1.5), float(0.06), foot));
        const iron = select(isEnd, endBars, select(isWall, ironWall, ironVault)).toVar();
        // ── The pane: which one, and its glass.
        const pi = select(isWall, floor(along.div(g.mullionEvery)), floor(along.div(g.barEvery)));
        const pj = select(isWall, floor(h.div(1.5)).sub(10.0), floor(s.div(g.purlinEvery)));
        const hp = mgPaneHash(pi, pj).toVar();
        const hq = mgPaneHash(pj.add(17.0), pi.sub(5.0));
        const vent = hp.lessThan(0.025);
        const fogged = hp.lessThan(0.0875).and(vent.not());
        // Old glass: each pane turns the view a hair its own way.
        const tilt = vec2(hq.sub(0.5), fract(hq.mul(7.3)).sub(0.5)).mul(select(vent, float(0.0), float(0.0045)));
        const dv = normalize(d.add(vec3(tilt.x, tilt.y, tilt.x.mul(0.5))));
        // The disc in the lens's image plane: round anywhere in the frame.
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1.0)));
        const ndc = clip.xy.div(clip.w);
        const disc = ndc.sub(U.moonNdc).mul(vec2(U.aspect, 1.0)).div(U.moonNdcRadius).add(tilt.mul(30.0));
        const sky = mgSky(dv, disc, U, noise, {
            stars: tier.stars, clouds: tier.clouds, trees: true,
        }).toVar();
        const tint = select(vent, vec3(1.0), vec3(0.82, 0.92, 0.88).mul(hq.mul(0.12).add(0.88)));
        // The lath blinds outside the vault: dark slats against the sky, the night between them.
        const blindSide = select(p.x.lessThan(0.0), float(-1.0), float(1.0));
        // The bay the moon is seen through (and its neighbours) keeps its blind up.
        const bayHere = floor(along.div(g.ribEvery));
        const moonsBay = abs(bayHere.sub(U.moonBay.x)).lessThan(1.5).and(blindSide.equal(U.moonBay.y));
        const blind = select(isWall.or(isEnd).or(moonsBay), float(1.0), mgBlind(along, blindSide, s, foot)).toVar();
        const lath = night.zenith.mul(0.6).add(night.moonlight.mul(0.004));
        const through = sky.mul(tint).mul(blind).add(lath.mul(float(1.0).sub(blind))).toVar();
        // ── Condensation: a film the moon lights into a halo, beads catching its glow.
        const toMoon = clamp(dot(d, U.moon), 0.0, 1.0);
        const away = float(1.0).sub(toMoon);
        const halo = exp(away.mul(-1.0 / 0.05)).mul(0.6).add(exp(away.mul(-1.0 / 0.18)).mul(0.2)).add(0.03);
        const glassUv = vec2(along.mul(0.55), s.mul(0.55));
        const film = texture(noise, glassUv.mul(0.35)).level(1.0);
        const runs = smoothstep(0.62, 0.78, texture(noise, vec2(along.mul(1.7), s.mul(0.06))).w);
        const filmAmount = select(fogged, float(0.9), film.x.mul(0.5).add(0.15)).mul(float(1.0).sub(runs.mul(0.7)))
            .mul(select(vent, float(0.0), float(1.0))).toVar();
        const veil = night.glassFog.mul(halo).mul(filmAmount).mul(0.28).mul(U.moonLight);
        // Fog scatters what is behind it: the film greys the view a little.
        through.assign(mix(through, vec3(mgLuma(through)).mul(0.8), filmAmount.mul(0.35)));
        let beads = vec3(0.0);
        if (tier.condensation > 0) {
            // Beads are a near thing: a few centimetres across, they read only where a pixel is
            // smaller than they are (the panes beside the eye); further off they are the film.
            const near = float(1.0).sub(smoothstep(0.004, 0.011, foot));
            const b1 = texture(noise, glassUv.mul(1.6)).y;
            let bead = b1;
            if (tier.condensation > 1) {
                bead = max(b1, texture(noise, glassUv.mul(3.7).add(vec2(0.37, 0.11))).y.mul(0.8));
            }
            const rim = smoothstep(0.1, 0.3, bead).mul(float(1.0).sub(smoothstep(0.4, 0.85, bead)));
            const core = smoothstep(0.75, 0.98, bead);
            const glint = rim.mul(halo.mul(1.4)).add(core.mul(exp(away.mul(-1.0 / 0.12)).mul(2.0)));
            beads = night.moonlight.mul(glint).mul(0.2).mul(near).mul(select(vent, float(0.0), float(1.0)))
                .mul(U.moonLight);
        }
        // ── The board's light on the panes. The wave runs in the glass's own coordinates: metres
        // along the house and metres of arc from the ridge down the vault and on down the walls,
        // so a front from the ridge reaches the springs and then runs down the side glazing.
        const paneAlong = pi.add(0.5).mul(select(isWall, float(g.mullionEvery), float(g.barEvery)));
        const paneS = select(isWall, floor(s.div(1.5)).add(0.5).mul(1.5), pj.add(0.5).mul(g.purlinEvery));
        const waves = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.paneWaveCount), type: 'int', condition: '<', name: 'wave',
        }, ({ wave }) => {
            const a = U.paneWaves.element(wave.mul(2));
            const b = U.paneWaves.element(wave.mul(2).add(1));
            const age = U.time.sub(a.z);
            const r = length(vec2(paneAlong.sub(a.x), paneS.sub(a.y).mul(1.25)));
            const x = r.sub(age.mul(b.w));
            // Dark ahead of the front, a pane flares as it arrives and settles a few metres behind.
            const ahead = float(1.0).sub(smoothstep(0.0, 0.7, x));
            const behind = float(1.0).sub(smoothstep(0.0, 3.2, x.negate()));
            const lit = ahead.mul(behind).mul(step01(age));
            const fade = exp(age.mul(-0.45));
            waves.addAssign(b.xyz.mul(a.w.mul(lit).mul(fade).mul(hp.mul(0.6).add(0.4))));
        });
        // Four lines: the moonlight floods the panes, those nearest the moon first and most.
        const nearMoon = exp(away.mul(-1.0 / 0.35)).mul(0.75).add(0.25);
        const floodHere = U.flood.mul(smoothstep(0.0, 0.5, U.flood.sub(hq.mul(0.35))));
        const flood = night.moonlight.mul(floodHere).mul(nearMoon).mul(0.26);
        const paneLight = waves.mul(0.22).add(flood);
        // ── The house mirrored in its own glass: at night the lit interior shows in the panes. The
        // view ray is reflected off the pane (its inward normal) and every lantern it passes near
        // leaves a soft warm image, blurred by the distance and the old glass, weighted by Fresnel.
        const centreX = select(p.x.lessThan(0.0), float(ARC.offset), float(-ARC.offset));
        const inward = select(isEnd, vec3(0.0, 0.0, 1.0), select(
            isWall,
            vec3(p.x.sign().negate(), 0.0, 0.0),
            normalize(vec3(centreX.sub(p.x), float(HOUSE.spring).sub(p.y), 0.0)),
        ));
        const r = d.sub(inward.mul(dot(d, inward).mul(2.0))).toVar();
        const cosI = clamp(dot(d, inward).negate(), 0.0, 1.0);
        const grazing = float(1.0).sub(cosI);
        const fresnel = grazing.mul(grazing).mul(grazing).mul(grazing).mul(grazing)
            .mul(0.92)
            .add(0.06);
        const images = vec3(0.0).toVar();
        Loop({
            start: int(0), end: int(U.lanternCount), type: 'int', condition: '<', name: 'lamp',
        }, ({ lamp }) => {
            const row = U.lanternRows.element(lamp);
            const toL = row.xyz.sub(p);
            const reach = max(dot(toL, r), 0.0);
            const miss = length(toL.sub(r.mul(reach)));
            const blur = reach.mul(0.035).add(0.12);
            const q = miss.div(blur);
            images.addAssign(vec3(row.w.mul(exp(q.mul(q).negate())).mul(smoothstep(0.2, 1.0, reach))));
        });
        const mirrored = night.lantern.mul(images).mul(U.lanternGain).mul(fresnel).mul(2.2);
        const glassLit = through.add(veil).add(beads).add(paneLight.mul(float(0.35).add(filmAmount))).add(mirrored);
        // ── The iron: near black, a cold line of moonlight on the edge facing the moon.
        const edge = smoothstep(0.35, 1.0, iron).mul(float(1.0).sub(smoothstep(0.85, 1.0, iron)));
        const ironLit = night.zenith.mul(0.25)
            .add(night.moonlight.mul(edge.mul(halo).mul(0.14)))
            .add(paneLight.mul(0.04));
        return vec4(mix(glassLit, ironLit, iron), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'moonlit-greenhouse-glass';
    mesh.frustumCulled = false;
    mesh.renderOrder = 40;
    return {
        mesh,
        dispose() {
            mesh.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}

/** 1 once a moment has come (age ≥ 0), 0 before. */
function step01(age) {
    return smoothstep(-0.001, 0.0, age);
}
