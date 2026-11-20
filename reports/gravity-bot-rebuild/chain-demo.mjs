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
    'Read boards from the top down. Each letter identifies a locked body. A dot is an empty cell. Row 1 sits on the floor. ' +
    'Each wave shows the board just before its full rows disappear. Columns and rotations use the game’s zero-based piece origin and clockwise quarter turns.', ''];
const board = rows => ['```text', ...(rows.length ? rows : ['..........']), '```', ''];
for (const lock of run.track.slice(0, fire.lock)) {
    output.push('## Lock ' + lock.lock + ' · ' + lock.shape, '', 'Column ' + lock.x + ', rotation ' + lock.rotation +
        '. Inputs were ' + lock.inputs.map(a => a.type + (a.dir === undefined ? '' : ' ' + a.dir) + ' (tick ' + a.tick + ')').join(', ') + '.', '');
    const proof = lock.expected.findIndex(step => step.waves >= 4);
    if (proof >= 0) output.push('Before locking, the bot forecast ' + lock.expected[proof].waves +
        ' waves in ' + (proof + 1) + (proof ? ' more pieces.' : ' more piece.'), '');
    for (let w = 0; w < lock.waves.length; w++) {
        const rows = lock.waveBoards[w];
        const full = rows.flatMap((row, i) => row.includes('.') ? [] : [rows.length - i]).reverse();
        if (full.length !== lock.waves[w]) throw Error('Wave board and clear count disagree');
        output.push('Wave ' + (w + 1) + ' clears ' + (full.length === 1 ? 'row ' : 'rows ') + full.join(', ') + '.', '', ...board(rows));
    }
    if (lock.waves.length) output.push('After the fragments settle', '');
    output.push(...board(lock.rows));
}
output.push('At the end of the fire the score was ' + fire.score + ' and cumulative outgoing garbage was ' +
    fire.attack + ' rows.', '', 'Reproduce the walkthrough from the repository root.', '',
    '```powershell', 'node reports/gravity-bot-rebuild/chain-demo.mjs ' + seed + ' chain-replay.md', '```', '');
writeFileSync(file, output.join('\n'), { flag: 'wx' });
