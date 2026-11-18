import { writeFileSync } from 'node:fs';
import { liveOpening } from './live-openings.mjs';

const [first, file] = process.argv.slice(2);
const seed = Number(first);
const run = liveOpening(seed, 16, true);
const fire = run.track.find(lock => lock.waves.length >= 4);
if (!fire || run.rejected) throw Error('The native seat did not reproduce a four-wave opening with accepted inputs');
const output = ['# Building a chain from an empty board', '',
    'Tier 10 on standard seed ' + seed + ' fired ' + fire.waves.length + ' waves on lock ' + fire.lock +
    '. The bot could see the active piece and three previews. The local fixed clock ran at 60 ticks per second. Every input below was accepted.', '',
    'Read boards from the top down. Each letter identifies a locked body. A dot is an empty cell. The floor is below the final row. ' +
    'Columns and rotations use the game’s zero-based piece origin and clockwise quarter turns.', ''];
const board = rows => ['```text', ...(rows.length ? rows : ['..........']), '```', ''];
for (const lock of run.track.slice(0, fire.lock)) {
    output.push('## Lock ' + lock.lock + ' · ' + lock.shape, '', 'Column ' + lock.x + ', rotation ' + lock.rotation +
        '. Inputs were ' + lock.inputs.map(a => a.type + (a.dir === undefined ? '' : ' ' + a.dir) + ' (tick ' + a.tick + ')').join(', ') + '.', '');
    const proof = lock.expected.findIndex(step => step.waves >= 4);
    if (proof >= 0) output.push('Before locking, the bot forecast ' + lock.expected[proof].waves +
        ' waves in ' + (proof + 1) + ' more pieces.', '');
    for (let w = 0; w < lock.waves.length; w++) {
        output.push('Wave ' + (w + 1) + ' cleared ' + lock.waves[w] + (lock.waves[w] === 1 ? ' row.' : ' rows.'), '',
            ...board(lock.waveBoards[w]));
    }
    output.push(...board(lock.rows));
}
output.push('At the end of the fire the score was ' + fire.score + ' and cumulative outgoing garbage was ' +
    fire.attack + ' rows.', '', 'Reproduce from the feature worktree with the following command.', '',
    '```powershell', 'node reports/gravity-bot-rebuild/chain-demo.mjs ' + seed + ' chain-replay.md', '```', '');
writeFileSync(file, output.join('\n'), { flag: 'wx' });
