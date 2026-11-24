// Pooled tables from record.mjs output: node tables.mjs <file.jsonl> [more files]
import { readFileSync } from 'node:fs';

const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN);
const q = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');

for (const file of process.argv.slice(2)) {
    const games = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const tiers = [...new Set(games.flatMap((g) => g.tiers))].sort((a, b) => b - a);
    const decided = games.filter((g) => g.decided).length;
    console.log(`\n# ${file.split(/[\\/]/).pop()}: ${games.length} games of ${games[0].tiers.join(' v ')} (${games[0].rules}), ${decided} decided, ${games.length - decided} at the time limit, mean ${f(mean(games.map((g) => g.seconds)), 0)} s`);
    for (const tier of tiers) {
        const seats = games.flatMap((g) => g.seats.flatMap((s, i) => (g.tiers[i] === tier ? [{ ...s, min: (g.seconds - g.down[i]) / 60, frags: g.frags?.[i] ?? 0 }] : [])));
        const sum = (k) => seats.reduce((t, s) => t + s[k], 0);
        const min = sum('min');
        const locks = sum('locks');
        const fires = seats.flatMap((s) => s.fires);
        const sent = fires.reduce((t, x) => t + x[0] - 1, 0);
        const sizes = [['2', (n) => n === 2], ['3', (n) => n === 3], ['4', (n) => n === 4], ['5-7', (n) => n >= 5 && n <= 7], ['8-11', (n) => n >= 8 && n <= 11], ['12+', (n) => n >= 12]];
        console.log(`## tier ${tier}: ${seats.length} seats, ${locks} pieces, ${f(min, 1)} min alive, ${f(locks / min, 1)} pieces/min`);
        console.log(`lines/piece ${f(sum('lines') / locks)}, sent/piece ${f(sum('sent') / locks)}, sent/min ${f(sum('sent') / min, 1)}, sent/line ${f(sum('sent') / sum('lines'))}, rows in/min ${f(sum('rowsIn') / min, 1)}, settle lines/100 pieces ${f(100 * sum('settleLines') / locks)}, clean boards/100 ${f(100 * sum('clean') / locks, 3)}, deaths ${seats.reduce((t, s) => t + s.deaths.length, 0)} (${f(seats.reduce((t, s) => t + s.deaths.length, 0) / min, 2)}/min), frags ${sum('frags')}`);
        console.log(`fires ${fires.length} (one in ${f(locks / fires.length, 1)} pieces), mean ${f(mean(fires.map((x) => x[0])))} lines, 90% ${q(fires.map((x) => x[0]), 0.9)}, waves ${f(mean(fires.map((x) => x[1])))}, singles ${f(100 * sum('singles') / (sum('singles') + fires.length), 0)}% of clears`);
        console.log('size | share | per 100 pieces | share of rows sent | waves | tallest | mean height | covered | garbage rows | pieces since last | straight');
        for (const [name, pick] of sizes) {
            const x = fires.filter((y) => pick(y[0]));
            if (!x.length) continue;
            console.log([name, `${f(100 * x.length / fires.length, 1)}%`, f(100 * x.length / locks), `${f(100 * x.reduce((t, y) => t + y[0] - 1, 0) / sent, 0)}%`, f(mean(x.map((y) => y[1]))), f(mean(x.map((y) => y[2])), 1),
                f(mean(x.map((y) => y[3])), 1), f(mean(x.map((y) => y[4])), 1), f(mean(x.map((y) => y[5])), 1), f(mean(x.map((y) => y[6])), 1), `${f(100 * x.filter((y) => y[7] === 'I').length / x.length, 0)}%`].join(' | '));
        }
        const big = fires.filter((x) => x[0] >= 5);
        const roofed = big.filter((x) => x[8]?.[2]);
        console.log(`fires of 5+: ${big.length}; main column roofed ${f(100 * roofed.length / big.length, 0)}%, of those an edge column ${f(100 * roofed.filter((x) => x[8][0] === 0 || x[8][0] === 9).length / roofed.length, 0)}%, rows in it ${f(mean(roofed.map((x) => x[8][1])), 1)}, straights parked ${f(mean(roofed.map((x) => x[8][3])))}`);
        const b = seats.map((s) => s.boards);
        const n = b.reduce((t, x) => t + x.n, 0);
        console.log(`any board: tallest ${f(b.reduce((t, x) => t + x.max, 0) / n, 1)}, above 20 rows ${f(100 * b.reduce((t, x) => t + x.over20, 0) / n, 1)}%, roofed column with 3+ rows ${f(100 * b.reduce((t, x) => t + x.roofed3, 0) / n, 0)}%, straight parked on it ${f(100 * b.reduce((t, x) => t + x.parked, 0) / n, 0)}%, two or more ${f(100 * b.reduce((t, x) => t + x.parked2, 0) / n, 0)}%; heights ${Array.from({ length: 10 }, (_, c) => f(b.reduce((t, x) => t + x.heights[c], 0) / n, 1)).join(' ')}`);
        const offers = {};
        for (const s of seats) for (const [k, v] of Object.entries(s.offers)) { const t = offers[k] ??= [0, 0, 0, 0]; v.forEach((x, i) => { t[i] += x; }); }
        console.log('offer: times, took whole, took 2+, took nothing:', Object.entries(offers).map(([k, v]) => `${k}${k === '8' ? '+' : ''}: ${v[0]} ${f(100 * v[1] / v[0], 0)}% ${f(100 * v[2] / v[0], 0)}% ${f(100 * v[3] / v[0], 0)}%`).join(' | '));
        const react = seats.flatMap((s) => s.reaction);
        if (react.length) console.log(`after 3+ rows: next fire in ${f(mean(react.map((x) => x[1])), 1)} pieces, ${f(mean(react.map((x) => x[2])), 1)} lines (n ${react.length})`);
        const deaths = seats.flatMap((s) => s.deaths);
        if (deaths.length) console.log(`at death: tallest ${f(mean(deaths.map((x) => x[0])), 1)}, centre ${f(mean(deaths.map((x) => x[1])), 1)}, pieces since own last fire ${f(mean(deaths.map((x) => x[2])), 1)} (n ${deaths.length})`);
    }
}
