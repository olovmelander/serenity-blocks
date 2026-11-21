// A single expert playing for score. Each policy sees the same bags and receives
// a fresh state. Replay every control through the game and validate every wave.
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { calculateGarbage } from '../../src/core/garbage.js';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';
import { deal, replay, spawn } from '../bot-ai-audit-2026-11/solo.mjs';

const [baseline, output, first = '21841000', count = '64', limit = '120'] = process.argv.slice(2);
if (!baseline || !output) throw Error('Pass BASELINE_CHECKOUT OUTPUT.jsonl [FIRST_SEED COUNT LOCKS]');
const previous = await import(pathToFileURL(resolve(baseline, 'src/core/ai/gravity-bot-controller.js')));
writeFileSync(output, '', { flag: 'wx' });
for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
    for (const [policy, Controller] of [['baseline', previous.GravityBotController], ['candidate', GravityBotController]]) {
        const state = deal(seed);
        const bot = new Controller({ playerState: state, difficulty: 10, actions: {}, rng: () => 0.5 });
        const result = { seed, policy, locks: 0, score: 0, lines: 0, later: 0, fourWaves: 0, clean: 0, attack: 0 };
        try {
            while (result.locks < Number(limit) && !state.isGameOver) {
                const plan = bot.plan();
                const waves = [];
                await replay(state, plan.actions, {
                    spawnPiece: () => spawn(state),
                    onLineClear: n => waves.push(n),
                    onPerfectClear: () => { result.clean++; },
                    onGarbageReady: summary => { result.attack += calculateGarbage(summary).getTotalLines(); },
                });
                if (String(waves) !== String(plan.candidate.waves)) throw Error('Wave mismatch at ' + seed);
                result.locks++;
                result.lines += waves.reduce((sum, n) => sum + n, 0);
                result.later += waves.slice(1).reduce((sum, n) => sum + n, 0);
                result.fourWaves += Number(waves.length >= 4);
            }
            result.score = state.score;
            result.topOut = state.isGameOver;
            appendFileSync(output, JSON.stringify(result) + '\n');
        } finally { state.reset(); }
    }
}
