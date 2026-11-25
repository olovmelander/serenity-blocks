// Fits the versus evaluation on three things: rows sent and survival against recorded attacks, how
// close the building is to the playbook's numbers for the strongest player, and how often the bot
// puts a piece exactly where he put it (agree.mjs). A small evolution strategy over the weights'
// logarithms; every generation plays the same seeds and the same positions for all candidates.
// node fit.mjs <out.jsonl> <generations> <population> <workers> [start weights.json]
// FIT_STYLE scales the style part (1 by default, 0 fits strength alone); FIT_AGREE the agreement
// (1.5; 0 leaves it out and needs no positions); FIT_FIXED holds weights.
import { fork } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { fileURLToPath } from 'node:url';
import { VERSUS_WEIGHTS } from '../../src/core/ai/versus-evaluation.js';

const FIXED = { vTests: VERSUS_WEIGHTS.vTests, kill: VERSUS_WEIGHTS.kill, ...JSON.parse(process.env.FIT_FIXED || '{}') };
const KEYS = Object.keys(VERSUS_WEIGHTS).filter((k) => !(k in FIXED));
const STYLE = Number(process.env.FIT_STYLE ?? 1);
const AGREE = Number(process.env.FIT_AGREE ?? 1.5);
const DEATH = Number(process.env.FIT_DEATH ?? 30);
const CAP = Number(process.env.FIT_CAP ?? 0.35);
const TIER = Number(process.env.FIT_TIER ?? 10);
const PARTS = { openerPiece: 0.1, eight: 0.14, two: 0.06, edge: 0.12, parked: 0.1, shaft: 0.16, chain: 0.1, fire: 0.16, pass2: 0.03, singles: 0.02, tallest: 0.1, opener: 0.14, sentPerLine: 0.06 };
const CALM = { seeds: 8, pieces: 240, rate: 0.33 };
const HARD = { seeds: 4, pieces: 240, rate: 0.75 };
// The player and the games the agreement is fitted on; his other games stay unseen, to check it.
const WHO = new RegExp(process.env.FIT_AGREE_WHO ?? 'stephen', 'i');
const GAMES = new RegExp(process.env.FIT_AGREE_GAMES ?? 'stephen-vs-alex|michvsn|2v2');
const POSITIONS = { chunks: 4, each: 300 };

if (process.send) {
    const { styleRun } = await import('./style-run.mjs');
    console.log = () => {};
    let pool = null;
    process.on('message', async ({ job, seed, weights, pieces, rate, offers, positions }) => {
        const versusWeights = { ...weights, ...FIXED };
        if (positions) {
            const { agreement, pick } = await import('./agree.mjs');
            pool ??= pick({ name: WHO, game: GAMES });
            const list = Array.from({ length: positions.count }, (_, j) => pool[(positions.offset + (positions.from + j) * positions.stride) % pool.length]);
            process.send({ job, r: agreement(list, { tier: TIER, versusWeights }) });
            return;
        }
        const r = await styleRun(seed, { tier: TIER, pieces, rate, offers, versusWeights });
        process.send({ job, r });
    });
} else {
    setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
    const [out, gens = '60', pop = '24', workers = '26', startFile] = process.argv.slice(2);
    const { style, distance } = await import('./style-run.mjs');
    console.log = console.info;
    let poolSize = 0;
    if (AGREE > 0) {
        const { pick } = await import('./agree.mjs');
        poolSize = pick({ name: WHO, game: GAMES }).length;
        console.log(`agreement on ${poolSize} positions`);
    }
    const start = startFile ? { ...VERSUS_WEIGHTS, ...JSON.parse(readFileSync(startFile, 'utf8')) } : VERSUS_WEIGHTS;
    let mean = KEYS.map((k) => Math.log(Math.max(0.02, start[k])));
    let sigma = KEYS.map(() => Number(process.env.FIT_SIGMA ?? 0.4));
    const kids = Array.from({ length: Number(workers) }, () => {
        const child = fork(fileURLToPath(import.meta.url), { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
        return child;
    });
    const runAll = (jobs) => new Promise((resolve) => {
        const results = new Array(jobs.length);
        let next = 0;
        let done = 0;
        for (const child of kids) {
            child.removeAllListeners('message');
            const give = () => { if (next < jobs.length) { const job = next++; child.send({ job, ...jobs[job] }); } };
            child.on('message', ({ job, r }) => {
                results[job] = r;
                done++;
                if (done === jobs.length) resolve(results); else give();
            });
            give();
        }
    });
    const gauss = () => { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); };
    const toWeights = (v) => Object.fromEntries(KEYS.map((k, i) => [k, Math.exp(v[i])]));
    const chunks = AGREE > 0 ? POSITIONS.chunks : 0;
    const per = CALM.seeds + HARD.seeds + chunks;
    for (let g = 0; g < Number(gens); g++) {
        const base = 100000 + g * 131;
        const stride = Math.max(1, Math.floor(poolSize / (POSITIONS.chunks * POSITIONS.each)));
        const cand = Array.from({ length: Number(pop) }, (_, i) => (i === 0 ? mean.slice() : mean.map((m, k) => m + sigma[k] * gauss())));
        const jobs = cand.flatMap((v) => {
            const weights = toWeights(v);
            return [...Array.from({ length: CALM.seeds }, (_, s) => ({ seed: base + s, weights, pieces: CALM.pieces, rate: CALM.rate, offers: STYLE > 0 })),
                ...Array.from({ length: HARD.seeds }, (_, s) => ({ seed: base + 50 + s, weights, pieces: HARD.pieces, rate: HARD.rate, offers: false })),
                ...Array.from({ length: chunks }, (_, c) => ({ weights, positions: { offset: g * 37, from: c * POSITIONS.each, count: POSITIONS.each, stride } }))];
        });
        const res = await runAll(jobs);
        const scored = cand.map((v, i) => {
            const runs = res.slice(i * per, (i + 1) * per);
            const calm = style(runs.slice(0, CALM.seeds));
            const hard = style(runs.slice(CALM.seeds, CALM.seeds + HARD.seeds));
            const placed = runs.slice(CALM.seeds + HARD.seeds);
            const agree = chunks ? placed.reduce((t, r) => t + r.same, 0) / Math.max(1, placed.reduce((t, r) => t + r.n, 0)) : 0;
            const d = distance(calm);
            const penalty = Object.entries(PARTS).reduce((t, [k, w]) => t + w * Math.min(1.5, Number.isFinite(d[k]) ? d[k] : 1), 0);
            const raw = calm.sent - DEATH * calm.deaths / 1000 + 0.35 * (hard.sent - DEATH * hard.deaths / 1000);
            // Past the cap more strength counts little: the style decides between strong players.
            const strength = Math.min(raw, CAP) + 0.2 * Math.max(0, raw - CAP);
            return { v, calm, hard, strength, penalty, agree, j: strength - STYLE * penalty + AGREE * agree };
        }).sort((a, b) => b.j - a.j);
        const mu = Math.ceil(Number(pop) / 4);
        const elite = scored.slice(0, mu);
        const wts = elite.map((_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
        const total = wts.reduce((t, x) => t + x, 0);
        const old = mean;
        mean = KEYS.map((_, k) => elite.reduce((t, e, i) => t + wts[i] / total * e.v[k], 0));
        sigma = sigma.map((s, k) => {
            const spread = Math.sqrt(elite.reduce((t, e, i) => t + wts[i] / total * (e.v[k] - old[k]) ** 2, 0));
            return Math.max(0.05, Math.min(0.6, 0.8 * s + 0.2 * spread * 1.3));
        });
        const centre = scored.find((s) => s.v === cand[0]);
        const r3 = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Math.round(x * 1000) / 1000]));
        appendFileSync(out, `${JSON.stringify({ g, mean: r3({ ...toWeights(mean), ...FIXED }), centre: { j: centre.j, strength: centre.strength, penalty: centre.penalty, agree: centre.agree, calm: r3(centre.calm), hard: r3({ sent: centre.hard.sent, deaths: centre.hard.deaths }) }, best: { j: scored[0].j, strength: scored[0].strength, penalty: scored[0].penalty, agree: scored[0].agree, weights: r3({ ...toWeights(scored[0].v), ...FIXED }) } })}\n`);
        const c = centre.calm;
        console.log(`gen ${g} J ${centre.j.toFixed(3)} (best ${scored[0].j.toFixed(3)}) strength ${centre.strength.toFixed(3)} style ${centre.penalty.toFixed(3)} agree ${(100 * centre.agree).toFixed(1)}% (best ${(100 * Math.max(...scored.map((s) => s.agree))).toFixed(1)}%) | sent ${c.sent.toFixed(3)} deaths ${c.deaths.toFixed(1)} hard ${centre.hard.sent.toFixed(2)}/${centre.hard.deaths.toFixed(0)} | fire ${c.fire.toFixed(2)} edge ${c.edge.toFixed(2)} parked ${c.parked.toFixed(2)} shaft ${c.shaft.toFixed(2)} chain ${c.chain.toFixed(2)} singles ${c.singles.toFixed(2)} pass2 ${c.pass2.toFixed(2)} tallest ${c.tallest.toFixed(1)} opener ${c.opener.toFixed(1)}`);
    }
    kids.forEach((child) => child.kill());
}
