// Pass 4: the local bot level at which a player is even with each rival, shipped and proposed.
// Usage: node chart-levels.mjs <out.svg>
import { writeFileSync } from 'node:fs';

const [outFile] = process.argv.slice(2);
// null = the player already wins half or more at level 2, the lowest level played.
const RIVALS = [
    { id: 5, name: 'Cinder', tier: 1, shipped: null, climb: null },
    { id: 10, name: 'Coral', tier: 2, shipped: null, climb: null },
    { id: 18, name: 'Willow', tier: 3, shipped: null, climb: null },
    { id: 26, name: 'Frost', tier: 4, shipped: null, climb: 3.6 },
    { id: 34, name: 'Zephyr', tier: 5, shipped: 2.3, climb: 4.6 },
    { id: 48, name: 'Nova', tier: 6, shipped: 3.2, climb: 5.3 },
    { id: 56, name: 'Prism', tier: 7, shipped: 3.0, climb: 6.4 },
    { id: 60, name: 'Neon', tier: 8, shipped: 3.5, climb: 6.8 },
];
const W = 1200;
const INK = '#191919';
const MUTED = '#666666';
const GRID = '#e3e5e8';
const BAND = '#f4f5f7';
const SURFACE = '#ffffff';
const BLUE = '#257de0';
const ORANGE = '#f47230';
const TARGET = '#dbe9fb';
const out = [];
const text = (x, y, s, { size = 13, fill = INK, anchor = 'start', weight = 400 } = {}) => out.push(
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`,
);
const diamond = (x, y, r, fill, hollow) => `<path d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z" fill="${hollow ? SURFACE : fill}" stroke="${hollow ? fill : SURFACE}" stroke-width="2"/>`;
const dot = (x, y, r, fill, hollow) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${hollow ? SURFACE : fill}" stroke="${hollow ? fill : SURFACE}" stroke-width="2"/>`;

const left = 250;
const right = W - 60;
const top = 170;
const row = 44;
const bottom = top + row * RIVALS.length;
const xOf = (level) => left + ((level - 1) / 8) * (right - left);
text(40, 46, 'The level a player must reach to be even with each rival', { size: 26, weight: 700 });
text(40, 72, 'A local versus bot of each level played the player’s well. A mark sits where that player starts winning half the matches.', { size: 14, fill: MUTED });
let lx = 40;
const legend = (mark, label, width) => { out.push(mark(lx + 8, 105)); text(lx + 24, 110, label); lx += width; };
legend((x, y) => dot(x, y, 6, ORANGE), 'Shipped today', 150);
legend((x, y) => diamond(x, y, 7.5, BLUE), 'Proposed: versus rules, each rival one tier up', 370);
legend((x, y) => dot(x, y, 6, MUTED, true), 'Hollow: even below level 2', 240);
out.push(`<rect x="${lx}" y="96" width="26" height="18" fill="${TARGET}"/>`);
text(lx + 34, 110, 'The bar asked for the finish');
// the target band, levels 6 to 7
out.push(`<rect x="${xOf(6)}" y="${top - 8}" width="${xOf(7) - xOf(6)}" height="${bottom - top + 8}" fill="${TARGET}"/>`);
RIVALS.forEach((r, i) => {
    const y = top + i * row;
    if (i % 2) out.push(`<rect x="40" y="${y}" width="${xOf(6) - 40}" height="${row}" fill="${BAND}"/><rect x="${xOf(7)}" y="${y}" width="${right + 20 - xOf(7)}" height="${row}" fill="${BAND}"/>`);
});
for (let level = 1; level <= 9; level++) {
    out.push(`<path d="M${xOf(level)} ${top - 8}V${bottom}" stroke="${GRID}" stroke-width="1"/>`);
    text(xOf(level), bottom + 22, String(level), { size: 12, fill: MUTED, anchor: 'middle' });
}
text((left + right) / 2, bottom + 44, 'Local versus bot level of the player', { size: 12, fill: MUTED, anchor: 'middle' });
RIVALS.forEach((r, i) => {
    const y = top + i * row + row / 2;
    text(52, y + 5, `${r.id} · ${r.name}`, { size: 14, weight: 600 });
    text(170, y + 5, `tier ${r.tier}`, { size: 12, fill: MUTED });
    const sx = r.shipped === null ? xOf(1.5) : xOf(r.shipped);
    const cx = r.climb === null ? xOf(1.5) : xOf(r.climb);
    // Two lanes a row, so marks that share a value stay apart.
    out.push(dot(sx, y - 8, 6, r.shipped === null ? MUTED : ORANGE, r.shipped === null));
    out.push(r.climb === null ? dot(cx, y + 8, 6, MUTED, true) : diamond(cx, y + 8, 7.5, BLUE));
    if (r.shipped !== null) text(sx + 12, y - 4, r.shipped.toFixed(1), { size: 12, fill: MUTED });
    if (r.climb !== null) text(cx + 13, y + 12, r.climb.toFixed(1), { size: 12, weight: 600 });
});
text(40, bottom + 74, 'Shipped: 20 matches a level. Proposed: 60 a level, so each value is good to about half a level. Matches still undecided after 30 simulated minutes count as not won.', { size: 12, fill: MUTED });
const H = bottom + 96;
writeFileSync(outFile, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Helvetica, Arial, sans-serif">
<rect width="${W}" height="${H}" fill="${SURFACE}"/>
${out.join('\n')}
</svg>
`);
console.log(`wrote ${outFile} (${W}x${H})`);
