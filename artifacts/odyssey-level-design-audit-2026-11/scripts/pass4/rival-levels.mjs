// Level design pass 4: how a local versus bot of each level fares in the player's well against each rival.
// It plays the game's own duel (OdysseyBotMatch as shipped) through the benchmark runtime.
//
//   node rival-levels.mjs <out.jsonl> [--orbs 5,10,…] [--levels 2,3,…,9] [--seeds 12001+5,13001+5] [--workers 12]
//
// One line per match: orb, seed, level, the level the seat read at for that match, outcome (win, loss,
// or censored when it reached 30 simulated minutes or 3,000 pieces), knockouts and length. Resumes.
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAttempt } from '../../../../scripts/odyssey-benchmark/runtime.mjs';

// 60 seeds: the campaign's 15 and 45 others.
export const SEEDS = '12001+5,13001+5,16001+5,71001+5,73001+16,75001+16,77001+8';
export const RIVALS = [5, 10, 18, 26, 34, 48, 56, 60];
export const LEVELS = [2, 3, 4, 5, 6, 7, 8, 9];

if (process.send) {
    console.log = () => {};
    console.debug = () => {};
    process.on('message', async (task) => {
        try {
            const attempt = await runAttempt({
                levelId: task.orb, seed: task.seed, localLevel: task.level, wallBudgetMs: 3600000,
                maxSimSeconds: 1800, maxPieces: 3000,
            });
            if (attempt.outcome === 'error') throw new Error(`${task.orb}/${task.seed}/${task.level}: ${attempt.reason}`);
            const players = attempt.duel.telemetry.players;
            process.send({
                result: {
                    ...task,
                    readAt: attempt.localJudgmentTier,
                    outcome: attempt.outcome,
                    reason: attempt.reason,
                    stars: attempt.stars,
                    seconds: attempt.metrics.time,
                    knockouts: [attempt.duel.playerFrags, attempt.duel.botFrags],
                    rounds: attempt.duel.round,
                    rowsSent: players.map((p) => p.attackLinesSent),
                    uncredited: players.map((p) => p.uncreditedDeaths),
                },
            });
        } catch (error) { process.send({ error: error.stack }); }
    });
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [out, ...rest] = process.argv.slice(2);
    const option = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i < 0 ? fallback : rest[i + 1]; };
    const orbs = option('orbs', RIVALS.join(',')).split(',').map(Number);
    const levels = option('levels', LEVELS.join(',')).split(',').map(Number);
    const workers = Number(option('workers', '12'));
    const key = (r) => `${r.orb}/${r.seed}/${r.level}`;
    const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => key(JSON.parse(l))) : []);
    const tasks = [];
    for (const block of option('seeds', SEEDS).split(',')) {
        const [start, count] = block.split('+').map(Number);
        for (let seed = start; seed < start + count; seed++) {
            for (const orb of orbs) for (const level of levels) if (!done.has(key({ orb, seed, level }))) tasks.push({ orb, seed, level });
        }
    }
    // The long matches first: the late rivals against the middle levels.
    tasks.sort((a, b) => b.orb - a.orb);
    const total = tasks.length;
    let finished = 0;
    let failed = 0;
    const started = Date.now();
    await new Promise((resolveAll) => {
        let alive = Math.min(workers, total);
        if (!alive) resolveAll();
        for (let i = 0; i < Math.min(workers, total); i++) {
            const child = fork(fileURLToPath(import.meta.url), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
            const next = () => {
                const task = tasks.shift();
                if (task) child.send(task);
                else { child.kill(); if (--alive === 0) resolveAll(); }
            };
            child.on('message', ({ result, error }) => {
                if (error) { failed++; console.error(error); } else appendFileSync(out, `${JSON.stringify(result)}\n`);
                if (++finished % 200 === 0 || finished === total) console.log(`${finished}/${total} after ${Math.round((Date.now() - started) / 1000)} s`);
                next();
            });
            next();
        }
    });
    console.log(`done: ${finished} matches, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}
