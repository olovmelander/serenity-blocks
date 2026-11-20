// Seed-paired opponent trials. Player profiles, cadence and full frag victory rules are shared.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAttempt } from '../../scripts/odyssey-benchmark/runtime.mjs';

function observeMatchPoint(duel, pressEarlier, counts) {
    const bot = duel.bot;
    const onMatchPoint = () => duel.multiplayer.frags[1] + 1 === duel.targetFrags;
    if (pressEarlier) {
        const ordinary = bot.judgment || {};
        bot.judgment = { ...ordinary, get pressAtRows() {
            return onMatchPoint() ? Math.max(ordinary.pressAtRows || 0, 10) : ordinary.pressAtRows;
        } };
    }
    const adopt = bot.adoptPlan.bind(bot);
    bot.adoptPlan = plan => {
        if (onMatchPoint()) {
            counts.plans++;
            if (bot.opponentRoom() <= 10) counts.exposed++;
            if (plan?.candidate?.projectedAttack > 0) counts.attacks++;
        }
        return adopt(plan);
    };
}

if (process.send) {
    console.log = () => {}; console.debug = () => {};
    process.on('message', async ({ id, task }) => {
        try {
            const { orb, seed, profile, cadence, tier, judgment, frozen, campaign } = task;
            const atMatchPoint = { plans: 0, exposed: 0, attacks: 0 };
            const attempt = await runAttempt({
                levelId: orb, seed, profile, cadenceId: campaign ? cadence : 'human-' + cadence,
                // A time-sliced background worker can be descheduled while other applications run.
                // Only the simulated deadlines and piece caps may decide a measured game.
                rivalTier: tier, judgment, liveRival: !frozen, wallBudgetMs: 1800000,
                configureRival: task.matchPoint === undefined ? undefined
                    : duel => observeMatchPoint(duel, task.matchPoint, atMatchPoint),
                ...(campaign && { maxSimSeconds: 1800, maxPieces: 3000 }),
            });
            const { outcome, reason } = attempt;
            if (outcome === 'error' || reason === 'wall-budget') {
                throw Error(JSON.stringify({ orb, seed, profile, cadence, reason }));
            }
            process.send({ id, result: campaign ? attempt : { id: orb, seed, profile, cadence, outcome, reason,
                ...(task.matchPoint !== undefined && { atMatchPoint }) } });
        } catch (error) { process.send({ id, error: error.stack }); }
    });
} else {
    const [poolPath, ids, spec, out, optionsPath, workers = '3'] = process.argv.slice(2);
    const config = optionsPath === '-' ? {} : JSON.parse(readFileSync(optionsPath, 'utf8'));
    const { createPool } = await import(pathToFileURL(resolve(poolPath)));
    const pool = createPool(+workers, fileURLToPath(import.meta.url), process.env);
    const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean)
        .map(l => { const r = JSON.parse(l); return [r.id ?? r.levelId, r.seed, r.profile ?? r.profileId, r.cadence ?? r.cadenceId].join('/'); }) : []);
    const combinations = config.campaign ? [['stacker','deliberate'], ['stacker','native'], ['cascade','steady'], ['expert','native'], ['quad','native']]
        : [['stacker','regular'], ['stacker','strong'], ['cascade','regular'], ['cascade','strong']];
    const jobs = [];
    for (const block of spec.split(',')) {
        const [start, count] = block.split('+').map(Number);
        for (let seed = start; seed < start + count; seed++) for (const orb of ids.split(',').map(Number)) {
            for (const [profile, cadence] of combinations) {
                if (done.has([orb, seed, profile, cadence].join('/'))) continue;
                const task = { orb, seed, profile, cadence, tier: config.rivalTiers?.[orb],
                    judgment: config.judgments?.[orb], frozen: config.frozen === true, campaign: config.campaign,
                    matchPoint: config.matchPoint };
                jobs.push(pool.run(task).then(row => appendFileSync(out, JSON.stringify(row) + '\n')));
            }
        }
    }
    try { await Promise.all(jobs); } finally { pool.close(); }
}
