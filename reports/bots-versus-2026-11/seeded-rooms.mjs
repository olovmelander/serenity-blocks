// Seeded replays of live bot rooms on the shipped versus rules. Every lock (seat, piece, place,
// tick) goes into a hash, so a change that moves one placement shows. A room with `infinity` is
// Last Standing in a well of that many rows.
// node seeded-rooms.mjs write|check
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { duel } from '../bot-ai-audit-2026-11/duel.mjs';

const FILE = fileURLToPath(new URL('./seeded-rooms.json', import.meta.url));
const ROOMS = [
    { tiers: [10, 10], seed: 91001 }, { tiers: [10, 10], seed: 91002 }, { tiers: [9, 8], seed: 91003 }, { tiers: [7, 6], seed: 91004 },
    { tiers: [5, 4], seed: 91005 }, { tiers: [3, 1], seed: 91006 }, { tiers: [10, 10, 10], seed: 91007 }, { tiers: [10, 9, 8, 7], seed: 91008 },
    { tiers: [10, 10, 10, 10], seed: 91009 }, { tiers: [10, 10], seed: 91010, matchConfig: { attackRules: { forceAttackType: 'blind' } } },
    { tiers: [10, 10], seed: 91011, matchConfig: { attackRules: { forceAttackType: 'full_blind' } } },
    { tiers: [10, 10, 10], seed: 91012, matchConfig: { hotPotato: true } }, { tiers: [10, 10], seed: 91013, matchConfig: { minAttackLines: 4 } },
    { tiers: [10, 10], seed: 91014, infinity: 60 }, { tiers: [9, 7, 5], seed: 91015, infinity: 60 }, { tiers: [4, 2], seed: 91016, infinity: 40 },
];
const SECONDS = 120;
console.debug = () => {};
const log = console.log;
console.log = () => {};

async function play(room) {
    const hash = createHash('sha256');
    let locks = 0;
    let tick = 0;
    const result = await duel(Math.max(1, Math.min(9, room.tiers[0])), room.seed, false, SECONDS, {
        tiers: room.tiers, rules: 'shipped', live: true, useLocalStyles: true, matchConfig: room.matchConfig,
        ...(room.infinity ? { infinity: room.infinity } : { fixed: true, fragTarget: 7 }),
        observe: { lock(i, piece) { locks++; hash.update(`${tick}/${i}/${piece.shapeKey}/${piece.x}/${piece.y}/${piece.rotation ?? 0};`); } },
        afterFixedTick: () => { tick++; },
    });
    return { ...room, locks, frags: result.frags, ticks: result.ticksPlayed, sha256: hash.digest('hex') };
}

const mode = process.argv[2];
const played = [];
for (const room of ROOMS) played.push(await play(room));
if (mode === 'write') {
    writeFileSync(FILE, `${JSON.stringify(played, null, 1)}\n`);
    log(`${played.length} rooms written, ${played.reduce((t, r) => t + r.locks, 0)} locks`);
} else {
    const kept = JSON.parse(readFileSync(FILE, 'utf8'));
    const moved = kept.filter((room, i) => JSON.stringify(room) !== JSON.stringify(played[i]));
    log(moved.length ? `${moved.length} of ${kept.length} rooms moved: ${moved.map((r) => `${r.tiers.join('-')}@${r.seed}`).join(' ')}` : `all ${kept.length} rooms as recorded`);
    process.exitCode = moved.length ? 1 : 0;
}
