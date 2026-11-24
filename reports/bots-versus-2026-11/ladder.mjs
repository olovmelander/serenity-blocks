// Ladder tables from record.mjs output. node ladder.mjs <folder>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const read = (prefix) => readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
/** Wilson 95% interval for a share of points. */
const interval = (p, n) => {
    const z = 1.96;
    const c = (p + z * z / (2 * n)) / (1 + z * z / n);
    const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n);
    return `${f(100 * (c - h), 0)}-${f(100 * (c + h), 0)}`;
};

console.log('Free-for-all to seven frags, ten-minute limit, both seat orders, same seeds');
console.log('pair | games | higher reached 7 first | lower first | time limit | frags higher:lower at the end | games led by higher | points % (95%) | frag share | mean s');
for (let hi = 10; hi > 1; hi--) {
    const lo = hi - 1;
    const games = [...read(`l${hi}v${lo}a-`), ...read(`l${hi}v${lo}b-`)];
    if (!games.length) continue;
    let win = 0; let lose = 0; let limit = 0; let fh = 0; let fl = 0; let led = 0; let points = 0; let tied = 0;
    for (const g of games) {
        const h = g.tiers.indexOf(hi);
        const [a, b] = [g.frags[h], g.frags[1 - h]];
        fh += a; fl += b;
        if (g.decided) { if (a > b) win++; else lose++; } else limit++;
        if (a > b) { led++; points++; } else if (a === b) { tied++; points += 0.5; }
    }
    const n = games.length;
    console.log([`${hi}-${lo}`, n, win, lose, limit, `${fh}:${fl}`, `${led} (${tied} tied)`, `${f(100 * points / n)} (${interval(points / n, n)})`, f(100 * fh / (fh + fl)), f(games.reduce((t, g) => t + g.seconds, 0) / n, 0)].join(' | '));
}

console.log('\nOne round, five-minute limit: last one standing. Shipped rules against the rules before the versus merge, same seeds');
console.log('pair | rules | games | higher won | lower won | both out | time limit | points % (95%) | decided only % | mean s | rows sent/min higher, lower | pieces/min higher, lower');
for (const hi of [10, 9, 8, 7, 6, 5, 4, 3, 2]) {
    const lo = hi - 1;
    for (const rules of ['pre-versus', 'shipped']) {
        const games = [...read(`s${hi}v${lo}a-${rules}-`), ...read(`s${hi}v${lo}b-${rules}-`)];
        if (!games.length) continue;
        let win = 0; let lose = 0; let both = 0; let limit = 0;
        const sent = [0, 0]; const locks = [0, 0]; let min = 0;
        for (const g of games) {
            const h = g.tiers.indexOf(hi);
            const [a, b] = [g.lost[h], g.lost[1 - h]];
            if (a && b) both++; else if (b) win++; else if (a) lose++; else limit++;
            min += g.seconds / 60;
            sent[0] += g.seats[h].sent; sent[1] += g.seats[1 - h].sent;
            locks[0] += g.seats[h].locks; locks[1] += g.seats[1 - h].locks;
        }
        const n = games.length;
        const points = win + 0.5 * (both + limit);
        console.log([`${hi}-${lo}`, rules, n, win, lose, both, limit, `${f(100 * points / n)} (${interval(points / n, n)})`, f(100 * win / (win + lose)), f(60 * min / n, 0),
            sent.map((x) => f(x / min)).join(', '), locks.map((x) => f(x / min, 0)).join(', ')].join(' | '));
    }
}
