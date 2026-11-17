/**
 * CORAL AND DEEP-SEA LIFE, AS FORMS (Odyssey masterpiece pass, follow-up 2026-11-17).
 *
 * The first cut strewed small flat-shaded shards over the sand and the lead's read was right:
 * "scraps of paper, not life". These are the forms a reef is recognised by, built round (every
 * vertex carries a smooth normal, so the surface's lamp rolls over them instead of flipping from
 * facet to facet) and built to be read at the 80-130 u the orbs' close-ups see them from:
 *
 *   tree     a branching coral: a trunk that forks twice into tapering, round-tipped branches
 *   fan      a sea fan: ribs radiating in one plane from a short stalk, each forking once
 *   tubes    a stand of tube sponges: upright pipes of different heights with flared rims
 *   anemone  a column crowned with tentacles that arc outward (soft: it sways)
 *   pen      a sea pen: a curved quill with leaflets up both sides (soft: it sways)
 *   dome     a brain-coral head: a smooth dome with meandering ridges
 *   table    a table coral: a wide thin plate on a stalk
 *
 * Each vertex also says how much of its own light it carries (`glow`: the tips, the rims and the
 * ridges, so a form is legible in the dark by its outline and not as a lit blob) and how far it
 * may sway (`sway`: its height above its foot, for the soft ones). Pure geometry; the material is
 * odyssey-ocean-scenery.js.
 */

/** A sink for smooth-shaded triangles: position, normal, colour, (glow, sway) per vertex. */
export function makeLifeSink() {
    const positions = [];
    const normals = [];
    const colours = [];
    const life = [];
    const vert = (p, n, c, glow, sway) => {
        positions.push(p[0], p[1], p[2]);
        normals.push(n[0], n[1], n[2]);
        colours.push(c[0], c[1], c[2]);
        life.push(glow, sway);
    };
    return {
        positions,
        normals,
        colours,
        life,
        /** A triangle of full vertices: each `{ p, n, c, glow, sway }`. */
        tri(a, b, c) {
            vert(a.p, a.n, a.c, a.glow ?? 0, a.sway ?? 0);
            vert(b.p, b.n, b.c, b.glow ?? 0, b.sway ?? 0);
            vert(c.p, c.n, c.c, c.glow ?? 0, c.sway ?? 0);
        },
    };
}

const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [(a[1] * b[2]) - (a[2] * b[1]), (a[2] * b[0]) - (a[0] * b[2]), (a[0] * b[1]) - (a[1] * b[0])];
const add = (a, b, s = 1) => [a[0] + (b[0] * s), a[1] + (b[1] * s), a[2] + (b[2] * s)];
const scale = (c, s) => [c[0] * s, c[1] * s, c[2] * s];
const mixc = (a, b, t) => [a[0] + ((b[0] - a[0]) * t), a[1] + ((b[1] - a[1]) * t), a[2] + ((b[2] - a[2]) * t)];

/**
 * A round tube along a path, tapering by `radii`, closed with a rounded tip (or left as an open
 * rim when `open`). `shade(i)` gives ring i's { c, glow }; `foot` is the y the sway is measured
 * from (null: rigid).
 */
export function addTube(sink, path, radii, {
    sides = 6, shade, foot = null, open = false,
}) {
    const rings = [];
    let ref = [0, 1, 0];
    for (let i = 0; i < path.length; i += 1) {
        const a = path[Math.max(0, i - 1)];
        const b = path[Math.min(path.length - 1, i + 1)];
        const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        // A frame round the tangent that does not twist: carry the last side vector along.
        if (Math.abs((t[0] * ref[0]) + (t[1] * ref[1]) + (t[2] * ref[2])) > 0.95) ref = [1, 0, 0];
        const u = norm(cross(t, ref));
        const v = cross(t, u);
        ref = cross(u, t);
        const { c, glow } = shade(i);
        const ring = [];
        for (let k = 0; k < sides; k += 1) {
            const ang = (k / sides) * Math.PI * 2;
            const n = add(scale(u, Math.cos(ang)), v, Math.sin(ang));
            const p = add(path[i], n, radii[i]);
            ring.push({
                p, n, c, glow, sway: foot === null ? 0 : Math.max(0, p[1] - foot),
            });
        }
        rings.push({ ring, t });
    }
    for (let i = 0; i < rings.length - 1; i += 1) {
        for (let k = 0; k < sides; k += 1) {
            const k1 = (k + 1) % sides;
            sink.tri(rings[i].ring[k], rings[i + 1].ring[k], rings[i].ring[k1]);
            sink.tri(rings[i].ring[k1], rings[i + 1].ring[k], rings[i + 1].ring[k1]);
        }
    }
    if (!open) {
        const last = rings.at(-1);
        const end = path.at(-1);
        const { c, glow } = shade(path.length - 1);
        const tipP = add(end, last.t, radii.at(-1) * 1.1);
        const tip = {
            p: tipP, n: last.t, c, glow, sway: foot === null ? 0 : Math.max(0, tipP[1] - foot),
        };
        for (let k = 0; k < sides; k += 1) sink.tri(last.ring[k], tip, last.ring[(k + 1) % sides]);
    }
    return rings;
}

/** A curved path from `from` along `dir`, bending toward `bend`, in `steps` points. */
function arcPath(from, dir, length, bend, amount, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        pts.push(add(add(from, dir, length * t), bend, amount * length * t * t));
    }
    return pts;
}

/** A branching coral. */
export function addTree(sink, c, rnd) {
    const dark = scale(c.colour, 0.22);
    const branch = (from, dir, length, radius, level) => {
        const bend = norm([rnd() - 0.5, 0.35, rnd() - 0.5]);
        const path = arcPath(from, dir, length, bend, 0.28, 3);
        const tipGlow = level === 0 ? 0.12 : 0.35 + (0.65 * (level / 2));
        const baseGlow = level === 0 ? 0.02 : 0.12 * level;
        addTube(sink, path, path.map((_, i) => radius * (1 - (0.42 * (i / 3)))), {
            sides: level === 0 ? 7 : 5,
            shade: (i) => {
                const t = i / 3;
                return {
                    c: mixc(mixc(dark, c.colour, 0.25 + (0.3 * level)), c.accent, t * (level / 2)),
                    glow: baseGlow + ((tipGlow - baseGlow) * t * t),
                };
            },
        });
        if (level >= 2) return;
        const forks = level === 0 ? 3 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
        const end = path.at(-1);
        const endDir = norm([path[3][0] - path[2][0], path[3][1] - path[2][1], path[3][2] - path[2][2]]);
        const side = norm(cross(endDir, [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]));
        const other = cross(endDir, side);
        for (let f = 0; f < forks; f += 1) {
            const a = ((f / forks) * Math.PI * 2) + (rnd() * 0.9);
            const spread = 0.55 + (rnd() * 0.35);
            const d = norm(add(add(scale(endDir, 1), side, Math.cos(a) * spread), other, Math.sin(a) * spread));
            branch(end, norm([d[0], Math.max(d[1], 0.15), d[2]]), length * (0.58 + (rnd() * 0.16)), radius * 0.58, level + 1);
        }
    };
    branch([c.x, c.y - (c.size * 0.08), c.z], norm([(rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.3]), c.size * 0.42, c.size * 0.075, 0);
}

/** A sea fan: ribs in one plane (facing `yaw`), each forking once. */
export function addFan(sink, c, rnd) {
    const ax = [Math.cos(c.yaw), 0, Math.sin(c.yaw)];
    const dark = scale(c.colour, 0.2);
    const foot = [c.x, c.y - (c.size * 0.05), c.z];
    const hub = add(foot, [0, 1, 0], c.size * 0.14);
    addTube(sink, [foot, hub], [c.size * 0.06, c.size * 0.05], {
        sides: 6, shade: () => ({ c: dark, glow: 0.02 }), open: true,
    });
    const ribs = 9;
    for (let r = 0; r < ribs; r += 1) {
        const a = (-0.62 + ((r / (ribs - 1)) * 1.24)) * (Math.PI / 2);
        const reach = c.size * (0.78 + (0.22 * Math.cos(a * 1.1)) + ((rnd() - 0.5) * 0.12));
        const dir = norm(add(scale(ax, Math.sin(a)), [0, 1, 0], Math.cos(a)));
        const path = arcPath(hub, dir, reach * 0.62, ax, (rnd() - 0.5) * 0.25, 3);
        addTube(sink, path, path.map((_, i) => c.size * (0.030 - (0.006 * i))), {
            sides: 4,
            shade: (i) => ({ c: mixc(dark, c.colour, 0.3 + (0.2 * i)), glow: 0.05 + (0.11 * i) }),
        });
        const mid = path.at(-1);
        for (let f = -1; f <= 1; f += 2) {
            const fa = a + (f * (0.16 + (rnd() * 0.10)));
            const fdir = norm(add(scale(ax, Math.sin(fa)), [0, 1, 0], Math.cos(fa)));
            const fp = arcPath(mid, fdir, reach * 0.42, ax, (rnd() - 0.5) * 0.3, 2);
            addTube(sink, fp, [c.size * 0.016, c.size * 0.012, c.size * 0.007], {
                sides: 4,
                shade: (i) => ({ c: mixc(c.colour, c.accent, i / 2), glow: 0.4 + (0.3 * i) }),
            });
        }
    }
}

/** A stand of tube sponges: pipes with flared, lit rims and a dark mouth. */
export function addTubes(sink, c, rnd) {
    const n = 4 + Math.floor(rnd() * 5);
    const dark = scale(c.colour, 0.24);
    for (let k = 0; k < n; k += 1) {
        const a = ((k / n) * Math.PI * 2) + (rnd() * 0.8);
        const out = k === 0 ? 0 : c.size * (0.10 + (rnd() * 0.20));
        const h = c.size * (k === 0 ? 1 : 0.4 + (rnd() * 0.5));
        const r = c.size * (0.075 + (rnd() * 0.035));
        const foot = [c.x + (Math.cos(a) * out), c.y - (c.size * 0.05), c.z + (Math.sin(a) * out)];
        const lean = norm([Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25]);
        const path = arcPath(foot, lean, h, [Math.cos(a), 0, Math.sin(a)], 0.10, 4);
        const radii = [r * 0.62, r * 0.92, r, r * 0.96, r * 1.22];
        const rings = addTube(sink, path, radii, {
            sides: 9,
            shade: (i) => ({ c: mixc(dark, c.colour, 0.2 + (0.2 * i)), glow: i === 4 ? 1 : 0.03 + (0.03 * i) }),
            open: true,
        });
        // The mouth: dark, a little way down inside the rim.
        const rim = rings.at(-1);
        const top = path.at(-1);
        const mouth = {
            p: add(top, rim.t, -r * 0.9), n: rim.t, c: scale(c.colour, 0.06), glow: 0, sway: 0,
        };
        for (let s = 0; s < rim.ring.length; s += 1) {
            sink.tri(rim.ring[s], mouth, rim.ring[(s + 1) % rim.ring.length]);
        }
    }
}

/** An anemone: a column crowned with tentacles that arc outward and sway. */
export function addAnemone(sink, c, rnd) {
    const dark = scale(c.colour, 0.3);
    const foot = [c.x, c.y - (c.size * 0.05), c.z];
    const h = c.size * 0.34;
    const r = c.size * 0.17;
    addTube(sink, [foot, add(foot, [0, 1, 0], h * 0.6), add(foot, [0, 1, 0], h)], [r * 0.85, r, r * 0.9], {
        sides: 9, shade: (i) => ({ c: mixc(dark, c.colour, 0.3 * i), glow: 0.03 }), foot: foot[1] + (h * 0.4),
    });
    const crown = add(foot, [0, 1, 0], h);
    const tentacles = 15;
    for (let k = 0; k < tentacles; k += 1) {
        const a = ((k / tentacles) * Math.PI * 2) + (rnd() * 0.3);
        const ringR = r * (k % 2 === 0 ? 0.75 : 0.4);
        const out = [Math.cos(a), 0, Math.sin(a)];
        const from = add(crown, out, ringR);
        const dir = norm(add(scale(out, k % 2 === 0 ? 0.75 : 0.3), [0, 1, 0], 1));
        const len = c.size * (0.52 + (rnd() * 0.3));
        const path = arcPath(from, dir, len, add(scale(out, 1), [0, -1, 0], 0.55), 0.38, 4);
        addTube(sink, path, path.map((_, i) => c.size * (0.030 - (0.0055 * i))), {
            sides: 4,
            shade: (i) => ({ c: mixc(c.colour, c.accent, i / 4), glow: 0.10 + (0.9 * ((i / 4) ** 2)) }),
            foot: crown[1],
        });
    }
}

/** A sea pen: a curved quill with leaflets up both sides; it sways. */
export function addPen(sink, c, rnd) {
    const dark = scale(c.colour, 0.3);
    const foot = [c.x, c.y - (c.size * 0.05), c.z];
    const ax = [Math.cos(c.yaw), 0, Math.sin(c.yaw)];
    const steps = 9;
    const spine = arcPath(foot, norm([ax[0] * 0.12, 1, ax[2] * 0.12]), c.size, [ax[2], 0, -ax[0]], 0.16, steps);
    addTube(sink, spine, spine.map((_, i) => c.size * (0.034 - (0.0026 * i))), {
        sides: 5, shade: (i) => ({ c: mixc(dark, c.colour, i / steps), glow: 0.05 + (0.15 * (i / steps)) }), foot: foot[1],
    });
    for (let i = 2; i <= steps; i += 1) {
        const t = i / steps;
        // The feather's outline: widest a third of the way up, tapering to the tip.
        const reach = c.size * 0.30 * Math.sin(Math.PI * Math.min(1, (t * 0.85) + 0.12)) * (0.85 + (rnd() * 0.3));
        for (let s = -1; s <= 1; s += 2) {
            const dir = norm(add(scale(ax, s), [0, 1, 0], 0.75));
            const path = arcPath(spine[i], dir, reach, [0, 1, 0], 0.3, 2);
            addTube(sink, path, [c.size * 0.020, c.size * 0.015, c.size * 0.008], {
                sides: 4,
                shade: (k) => ({ c: mixc(c.colour, c.accent, k / 2), glow: 0.22 + (0.39 * k) }),
                foot: foot[1],
            });
        }
    }
}

/** A brain-coral head: a smooth dome with meandering ridges. */
export function addDome(sink, c, rnd) {
    const rows = 6;
    const sides = 14;
    const seed = rnd() * 40;
    const grid = [];
    for (let j = 0; j <= rows; j += 1) {
        const lat = (j / rows) * (Math.PI / 2);
        const row = [];
        for (let i = 0; i < sides; i += 1) {
            const a = (i / sides) * Math.PI * 2;
            const lump = 1 + (0.10 * Math.sin((a * 3) + seed)) + (0.07 * Math.sin((a * 5) - (lat * 4) + seed));
            const n = norm([Math.cos(a) * Math.cos(lat), Math.sin(lat) * 1.15, Math.sin(a) * Math.cos(lat)]);
            // The meander: ridges that wind over the head, lighter than the grooves between.
            const ridge = 0.5 + (0.5 * Math.sin((a * 9) + (Math.sin(lat * 7 + seed) * 2.2) + (lat * 6)));
            row.push({
                p: [c.x + (n[0] * c.size * lump), c.y - (c.size * 0.1) + (n[1] * c.size * 0.72 * lump), c.z + (n[2] * c.size * lump)],
                n,
                c: mixc(scale(c.colour, 0.45), mixc(c.colour, c.accent, 0.35), ridge),
                glow: 0.04 + (0.30 * ridge * ridge),
                sway: 0,
            });
        }
        grid.push(row);
    }
    for (let j = 0; j < rows; j += 1) {
        for (let i = 0; i < sides; i += 1) {
            const i1 = (i + 1) % sides;
            sink.tri(grid[j][i], grid[j + 1][i], grid[j][i1]);
            sink.tri(grid[j][i1], grid[j + 1][i], grid[j + 1][i1]);
        }
    }
}

/** A table coral: a wide thin plate on a stalk, its rim lit. */
export function addTable(sink, c, rnd) {
    const sides = 14;
    const foot = [c.x, c.y - (c.size * 0.05), c.z];
    const plateY = c.y + (c.size * 0.5);
    addTube(sink, [foot, [c.x, plateY - (c.size * 0.08), c.z]], [c.size * 0.16, c.size * 0.11], {
        sides: 7, shade: () => ({ c: scale(c.colour, 0.3), glow: 0.02 }), open: true,
    });
    const seed = rnd() * 30;
    const rim = [];
    for (let i = 0; i < sides; i += 1) {
        const a = (i / sides) * Math.PI * 2;
        const wob = 0.88 + (0.14 * Math.sin((a * 3) + seed));
        rim.push([c.x + (Math.cos(a) * c.size * wob), plateY + (0.05 * c.size * Math.sin((a * 2) + seed)), c.z + (Math.sin(a) * c.size * wob)]);
    }
    const up = [0, 1, 0];
    const centreTop = {
        p: [c.x, plateY + (c.size * 0.04), c.z], n: up, c: scale(c.colour, 0.75), glow: 0.03, sway: 0,
    };
    const centreUnder = {
        p: [c.x, plateY - (c.size * 0.07), c.z], n: [0, -1, 0], c: scale(c.colour, 0.3), glow: 0, sway: 0,
    };
    for (let i = 0; i < sides; i += 1) {
        const i1 = (i + 1) % sides;
        const out0 = norm([rim[i][0] - c.x, 0.9, rim[i][2] - c.z]);
        const out1 = norm([rim[i1][0] - c.x, 0.9, rim[i1][2] - c.z]);
        const top0 = {
            p: rim[i], n: out0, c: mixc(c.colour, c.accent, 0.5), glow: 0.55, sway: 0,
        };
        const top1 = {
            p: rim[i1], n: out1, c: mixc(c.colour, c.accent, 0.5), glow: 0.55, sway: 0,
        };
        sink.tri(top0, centreTop, top1);
        const und0 = {
            ...top0, n: norm([out0[0], -0.6, out0[2]]), c: scale(c.colour, 0.4), glow: 0.1,
        };
        const und1 = {
            ...top1, n: norm([out1[0], -0.6, out1[2]]), c: scale(c.colour, 0.4), glow: 0.1,
        };
        sink.tri(und0, und1, centreUnder);
    }
}

/** The forms by name. */
export const CORAL_FORMS = Object.freeze({
    tree: addTree, fan: addFan, tubes: addTubes, anemone: addAnemone, pen: addPen, dome: addDome, table: addTable,
});
