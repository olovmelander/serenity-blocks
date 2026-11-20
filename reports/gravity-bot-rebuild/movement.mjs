// Instrument actual controls, including failed inputs and replanning, at native pace.
import { appendFileSync, writeFileSync } from 'node:fs';
import { recordedSeat } from './recorded-seat.mjs';

const out = process.argv[2];
writeFileSync(out, '', { flag: 'wx' });
for (const tier of [1, 2, 4, 7, 10]) for (let seed = 1001; seed <= 1008; seed++) {
    let attempted = 0, emitted = 0, engineRejected = 0, failed = 0, recovery = 0, lastRejected = false, repeats = 0;
    let below = 0, far = 0, sampled = 0, sampledFar = 0, previousAction = null, locked = 0, lastPieceAt = 0, lastSpawn;
    const reactions = [], perPiece = [];
    const seat = recordedSeat(tier, seed, () => {
        perPiece.push(attempted - locked); locked = attempted; previousAction = null;
    });
    const { state, bot } = seat;
    const recordChoice = (preferred, choice, sampledError) => {
        const distant = Math.abs(choice.x - preferred.x) >= 3;
        below++; if (distant) far++;
        if (sampledError) { sampled++; if (distant) sampledFar++; }
    };
    const choose = bot.chooseSelection.bind(bot);
    bot.chooseSelection = (ranked, ...args) => {
        // A deterministic fire override consumes no randomness. Observe calls to
        // the existing stream without adding draws or changing its sequence.
        const rng = bot.rng;
        let draws = 0;
        bot.rng = () => { draws++; return rng(); };
        try {
            const choice = choose(ranked, ...args);
            if (ranked.indexOf(choice) > 0) recordChoice(ranked[0], choice, draws >= 2);
            return choice;
        } finally { bot.rng = rng; }
    };
    const selectGravity = bot.chooseGravityMove.bind(bot);
    bot.chooseGravityMove = (preferred, alternatives) => {
        const choice = selectGravity(preferred, alternatives);
        if (choice !== preferred) recordChoice(preferred, choice, true);
        return choice;
    };
    const perform = bot.scheduler.perform.bind(bot.scheduler);
    bot.scheduler.perform = action => {
        const key = JSON.stringify(action); attempted++;
        const serial = state.piecesPlaced;
        const ok = perform(action);
        if (ok && lastSpawn !== serial) { reactions.push(Math.round(state.simTimeMs - lastPieceAt)); lastSpawn = serial; }
        if (lastRejected && ok) recovery++;
        if (lastRejected && key === previousAction && !ok) repeats++;
        if (!ok) failed++;
        lastRejected = !ok; previousAction = key;
        return ok;
    };
    try {
        let serial;
        for (let tick = 0; tick < 21600 && !state.isGameOver && state.piecesPlaced < 100; tick++) {
            if (state.currentPiece && serial !== state.piecesPlaced) {
                serial = state.piecesPlaced; lastPieceAt = state.simTimeMs;
            }
            for (const input of seat.step().input) {
                emitted++;
                if (input.disposition !== 'applied') engineRejected++;
            }
        }
        appendFileSync(out, JSON.stringify({ seed, tier, attempted, emitted, engineRejected, failed, recovery, repeats, below, far, sampled, sampledFar,
            reactions, perPiece, locks: state.piecesPlaced, topOut: state.isGameOver }) + '\n');
    } finally { seat.close(); }
}
