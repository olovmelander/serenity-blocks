// Pass 4: the campaign curve with the re-fitted rivals, and a regular player's wins against each rival.
// Usage: node chart.mjs <chart-data.json> <out.svg>
// chart-data.json: { orbs: [{ id, chapter, role, index }], rivals: [{ id, name, index, wins: { table, shipped, unfitted, proposed } }] }
// wins are shares (0-1) of matches a regular-paced player won.
import { readFileSync, writeFileSync } from 'node:fs';

const [dataFile, outFile] = process.argv.slice(2);
const data = JSON.parse(readFileSync(dataFile, 'utf8'));
const W = 1200;
const INK = '#191919';
const MUTED = '#666666';
const GRID = '#e3e5e8';
const BAND = '#f4f5f7';
const SURFACE = '#ffffff';
// Reference palette slots 1-3 (validated all-pairs on the light surface) and a neutral for the older table.
const BLUE = '#257de0';
const ORANGE = '#f47230';
const AQUA = '#00b894';
const NEUTRAL = '#8a8f98';
const CHAPTERS = ['Earth core', 'Ocean', 'Surface', 'Mountains', 'Sky', 'Space', 'Transcendence', 'Encore'];
const out = [];
const text = (x, y, s, { size = 13, fill = INK, anchor = 'start', weight = 400 } = {}) => out.push(
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`,
);
const diamond = (x, y, r, fill) => `<path d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z" fill="${fill}" stroke="${SURFACE}" stroke-width="2"/>`;
const square = (x, y, r, fill) => `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="${fill}" stroke="${SURFACE}" stroke-width="2"/>`;
const dot = (x, y, r, fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${SURFACE}" stroke-width="2"/>`;
const ring = (x, y, r, stroke) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${SURFACE}" stroke="${stroke}" stroke-width="2"/>`;

// ---- Panel 1: the curve ----
const left = 70;
const right = W - 30;
const top1 = 150;
const bottom1 = 470;
const xOf = (orb) => left + ((orb - 1) / 59) * (right - left);
const yOf = (index) => bottom1 - (index / 10) * (bottom1 - top1);
text(left - 40, 44, 'Plan A: the rivals on the versus play, fitted to today’s odds', { size: 26, weight: 700 });
text(left - 40, 70, 'Difficulty index of the 60 orbs in play order. The 52 solo orbs are unchanged since pass 3; the eight rivals carry plan A’s settings.', { size: 14, fill: MUTED });
// legend
let lx = left - 40;
const legend = (mark, label, width) => { out.push(mark(lx + 8, 99)); text(lx + 22, 104, label); lx += width; };
out.push(`<path d="M${lx} 99H${lx + 28}" stroke="${BLUE}" stroke-width="2"/>`);
out.push(dot(lx + 14, 99, 3.5, BLUE));
text(lx + 36, 104, 'Solo orb');
lx += 130;
legend((x, y) => square(x, y, 5, BLUE), 'Solo boss', 110);
legend((x, y) => diamond(x, y, 6.5, BLUE), 'Rival, plan A', 200);
const spans = CHAPTERS.map((name, i) => {
    const ids = data.orbs.filter((o) => o.chapter === i + 1).map((o) => o.id);
    return { name, from: Math.min(...ids), to: Math.max(...ids) };
});
spans.forEach((span, i) => {
    const x0 = i ? (xOf(span.from - 1) + xOf(span.from)) / 2 : left - 12;
    const x1 = i < spans.length - 1 ? (xOf(span.to) + xOf(span.to + 1)) / 2 : right + 12;
    if (i % 2) out.push(`<rect x="${x0}" y="${top1}" width="${x1 - x0}" height="${bottom1 - top1}" fill="${BAND}"/>`);
    text((x0 + x1) / 2, top1 - 10, `${i + 1} ${span.name}`, { size: 12, fill: MUTED, anchor: 'middle' });
});
for (let v = 0; v <= 10; v += 2) {
    out.push(`<path d="M${left - 12} ${yOf(v)}H${right + 12}" stroke="${GRID}" stroke-width="1"/>`);
    text(left - 20, yOf(v) + 4, String(v), { size: 12, fill: MUTED, anchor: 'end' });
}
out.push(`<text transform="translate(${left - 52} ${(top1 + bottom1) / 2}) rotate(-90)" font-size="12" fill="${MUTED}" text-anchor="middle">Difficulty index (0–10)</text>`);
for (const orb of [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]) text(xOf(orb), bottom1 + 20, String(orb), { size: 12, fill: MUTED, anchor: 'middle' });
text((left + right) / 2, bottom1 + 40, 'Orb in play order', { size: 12, fill: MUTED, anchor: 'middle' });
out.push(`<path d="${data.orbs.map((o, i) => `${i ? 'L' : 'M'}${xOf(o.id).toFixed(1)} ${yOf(o.index).toFixed(1)}`).join('')}" fill="none" stroke="${BLUE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
for (const o of data.orbs) {
    const x = xOf(o.id);
    const y = yOf(o.index);
    if (o.role === 'rival') out.push(diamond(x, y, 6.5, BLUE));
    else if (o.role === 'boss') out.push(square(x, y, 5, BLUE));
    else out.push(dot(x, y, 3.5, BLUE));
}
for (const r of data.rivals) {
    const x = xOf(r.id);
    // Where each label is clear of the line: above the mark, except beside it for the first two
    // rivals (their chapter's boss sits just above) and for the last one (the plot's edge).
    let place = { dx: 0, dy: -13, anchor: 'middle' };
    if (r.id === 5) place = { dx: -11, dy: 19, anchor: 'end' };
    else if (r.id === 10) place = { dx: 11, dy: -7, anchor: 'start' };
    else if (r.id === 60) place = { dx: -12, dy: 4, anchor: 'end' };
    const chapter = data.orbs.find((o) => o.id === r.id).chapter;
    // A halo in the band's own colour keeps the label legible where a segment passes behind it.
    out.push(`<text x="${x + place.dx}" y="${yOf(r.index) + place.dy}" font-size="12" font-weight="600" fill="${INK}" text-anchor="${place.anchor}" paint-order="stroke" stroke="${chapter % 2 ? SURFACE : BAND}" stroke-width="4" stroke-linejoin="round">${r.name} ${r.index.toFixed(1)}</text>`);
}

// ---- Panel 2: a regular player's wins ----
const top2 = 610;
const row = 34;
const l2 = 190;
const r2 = W - 60;
const px = (share) => l2 + share * (r2 - l2);
text(left - 40, top2 - 62, 'Matches a regular-paced player wins against each rival', { size: 18, weight: 700 });
lx = left - 40;
const legend2 = (mark, label, width) => { out.push(mark(lx + 8, top2 - 36)); text(lx + 22, top2 - 31, label); lx += width; };
legend2((x, y) => ring(x, y, 5, NEUTRAL), 'Pass 3’s table (a rival the game no longer ships)', 345);
legend2((x, y) => dot(x, y, 5.5, ORANGE), 'Shipped today', 135);
legend2((x, y) => dot(x, y, 5.5, AQUA), 'Versus play at today’s settings', 240);
legend2((x, y) => diamond(x, y, 7, BLUE), 'Versus play, plan A', 240);
for (let v = 0; v <= 100; v += 20) {
    out.push(`<path d="M${px(v / 100)} ${top2 - 8}V${top2 + row * data.rivals.length}" stroke="${GRID}" stroke-width="1"/>`);
    text(px(v / 100), top2 + row * data.rivals.length + 20, `${v}%`, { size: 12, fill: MUTED, anchor: 'middle' });
}
data.rivals.forEach((r, i) => {
    const y = top2 + i * row + row / 2 - 4;
    if (i % 2) out.push(`<rect x="${left - 40}" y="${y - row / 2}" width="${r2 - left + 70}" height="${row}" fill="${BAND}"/>`);
});
// Grid over the bands, marks over the grid.
for (let v = 0; v <= 100; v += 20) out.push(`<path d="M${px(v / 100)} ${top2 - 8}V${top2 + row * data.rivals.length - 4}" stroke="${GRID}" stroke-width="1"/>`);
data.rivals.forEach((r, i) => {
    const y = top2 + i * row + row / 2 - 4;
    text(left - 30, y + 4, `${r.id} · ${r.name}`, { size: 13, weight: 600 });
    // Four lanes a row, so marks that share a value stay apart.
    out.push(ring(px(r.wins.table), y - 9, 5, NEUTRAL));
    out.push(dot(px(r.wins.shipped), y - 3, 5.5, ORANGE));
    out.push(dot(px(r.wins.unfitted), y + 3, 5.5, AQUA));
    out.push(diamond(px(r.wins.proposed), y + 9, 7, BLUE));
});
text(left - 40, top2 + row * data.rivals.length + 48, data.note, { size: 12, fill: MUTED });

const H = top2 + row * data.rivals.length + 70;
writeFileSync(outFile, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Helvetica, Arial, sans-serif">
<rect width="${W}" height="${H}" fill="${SURFACE}"/>
${out.join('\n')}
</svg>
`);
console.log(`wrote ${outFile} (${W}x${H})`);
