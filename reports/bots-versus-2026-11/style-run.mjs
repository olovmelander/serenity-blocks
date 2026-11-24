// One expert on one board, versus feel, recorded attacks arriving; what it sends, how it dies and
// how it builds, in the playbook's terms.
import { readFileSync } from 'node:fs';
import { GravityBotController } from '../../src/core/ai/gravity-bot-controller.js';
import { GarbageQueue } from '../../src/core/garbage.js';
import { seededRandom } from '../../src/utils/helpers.js';
import { deal, replay, spawn } from '../bot-ai-audit-2026-11/solo.mjs';
import { prepareVersusBoard, takeGarbage } from '../gravity-bot-rebuild/shipped-versus.mjs';
import { bestClear, garbageRows, heights, readBoard, shafts } from './board-measures.mjs';

const ATTACKS = process.env.VERSUS_ATTACKS || 'C:/Users/olovm/serenity-blocks-private/quadra-demos/data/attacks-in-duels.json';
const pool = JSON.parse(readFileSync(ATTACKS, 'utf8'));
const meanRows = pool.reduce((t, a) => t + a.n, 0) / pool.length;
console.debug = () => {};

export async function styleRun(seed, {
    pieces = 300, rate = 0.33, tier = 10, versusWeights = null, search, units = 1, offers = true,
} = {}) {
    const rng = seededRandom((seed ^ 0x5bd1e995) >>> 0);
    const out = { seed, rate, pieces: 0, lines: 0, singles: 0, sent: 0, settle: 0, rowsIn: 0, dug: 0, deaths: 0, clean: 0, tallest: 0, boards: 0, parkedBoards: 0,
        fires: [], offers: {}, openers: [], reactions: [], deathsLoaded: 0 };
    const queue = new GarbageQueue({ maxLines: 20 });
    let state = deal(seed, (s) => prepareVersusBoard(s, 'shipped'));
    const make = () => {
        const bot = new GravityBotController({ playerState: state, playerIndex: 0, difficulty: tier, actions: {}, rng: seededRandom((seed ^ 0x85ebca6b) >>> 0), versus: true, versusWeights, pendingRows: () => queue.getTotalLines() });
        if (search) Object.assign(bot.searchConfig, search);
        bot.planUnitsPerMs *= units;
        return bot;
    };
    let bot = make();
    let attack = 0; let sinceFire = 0; let life = 0; let roofAt = null; let reacting = null; let firstFire = true;
    while (out.pieces < pieces) {
        if (rng() < rate / meanRows) {
            const a = pool[Math.floor(rng() * pool.length)];
            attack++;
            a.holes.forEach((holeMask, i) => queue.enqueue({ type: 'line', holeMask, attackId: `x${attack}`, rowIndex: i, variant: 'normal', color: '#888', connectAbove: i > 0, connectBelow: i < a.holes.length - 1, isLastInBurst: i === a.holes.length - 1 }));
        }
        const key = state.currentPiece.shapeKey;
        const board = readBoard(state.boardGrid);
        const h = heights(board);
        const max = Math.max(...h);
        const main = shafts(board)[0] ?? null;
        out.tallest += max; out.boards++;
        if (main?.roofed && main.rows >= 3 && main.straights >= 1) out.parkedBoards++;
        if (roofAt === null && main?.roofed && main.rows >= 3) roofAt = life;
        const offer = offers ? bestClear(board, key) : 0;
        const garbage = garbageRows(board);
        const plan = bot.plan();
        if (!plan) throw Error('no plan');
        const waves = [];
        let own = 0; let settled = 0;
        const note = (summary) => {
            const lines = summary.totalLines ?? summary.depth ?? 0;
            out.lines += lines;
            out.sent += Math.max(0, lines - 1) + (summary.sendForPerfectClear && lines ? Math.floor((1 + lines) / 2) : 0);
            if (summary.sendForPerfectClear) out.clean++;
            if (summary.source === 'garbage-settle') { settled += lines; out.settle += lines; return; }
            own = lines;
        };
        await replay(state, plan.actions, {
            onGarbageReady: note,
            onLineClear: (n) => waves.push(Number(n) || n?.length || 0),
            spawnPiece: () => {
                const taken = takeGarbage(state, queue, { rules: 'shipped', onGarbageReady: note });
                out.rowsIn += taken.rows;
                if (taken.rows >= 3) reacting = { rows: taken.rows, pieces: -1 };
                spawn(state);
            },
        });
        out.pieces++; life++; sinceFire++;
        if (reacting) reacting.pieces++;
        if (offer) { const a = out.offers[Math.min(8, offer)] ??= [0, 0, 0]; a[0]++; a[1] += Number(own >= 2); a[2] += Number(own === 0); }
        if (own === 1) out.singles++;
        if (own >= 1) out.dug += Math.max(0, garbage - garbageRows(readBoard(state.boardGrid)));
        if (own >= 2) {
            out.fires.push({ lines: own, waves: waves.length, first: waves[0] ?? 0, biggest: Math.max(0, ...waves), max, edge: Boolean(main?.roofed && (main.col === 0 || main.col === 9)), rows: main?.rows ?? 0, straights: main?.roofed ? main.straights : 0, since: sinceFire, key });
            if (firstFire) { out.openers.push({ lines: own, piece: life, roof: roofAt }); firstFire = false; }
            if (reacting && reacting.pieces > 0) { out.reactions.push([reacting.rows, reacting.pieces, own]); reacting = null; }
            sinceFire = 0;
        }
        if (state.isGameOver) {
            out.deaths++;
            if (main?.roofed && main.rows >= 3 && (main.col === 0 || main.col === 9)) out.deathsLoaded++;
            state.reset?.();
            state = deal((seed + 7919 * out.deaths) >>> 0, (s) => prepareVersusBoard(s, 'shipped'));
            while (queue.entries.length) queue.dequeueLineBurst();
            bot = make(); life = 0; sinceFire = 0; roofAt = null; reacting = null; firstFire = true;
        }
    }
    return out;
}

const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN);
const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : NaN);

/** The playbook's numbers from a set of runs. */
export function style(runs) {
    const sum = (k) => runs.reduce((t, r) => t + r[k], 0);
    const p = sum('pieces');
    const fires = runs.flatMap((r) => r.fires);
    const big = fires.filter((f) => f.lines >= 5);
    const off = {};
    for (const r of runs) for (const [k, v] of Object.entries(r.offers)) { const t = off[k] ??= [0, 0, 0]; v.forEach((x, i) => { t[i] += x; }); }
    const openers = runs.flatMap((r) => r.openers);
    return {
        pieces: p, sent: sum('sent') / p, sentPerLine: sum('sent') / sum('lines'), lines: sum('lines') / p, deaths: 1000 * sum('deaths') / p,
        fire: mean(fires.map((f) => f.lines)), five: 100 * big.length / p, eight: 100 * fires.filter((f) => f.lines >= 8).length / p,
        edge: big.length ? big.filter((f) => f.edge).length / big.length : 0, parked: big.length ? big.filter((f) => f.edge && f.straights >= 1).length / big.length : 0,
        two: (() => { const x = fires.filter((f) => f.lines >= 8); return x.length ? x.filter((f) => f.straights >= 2).length / x.length : 0; })(),
        chain: 100 * big.filter((f) => f.biggest <= 2).length / p, shaft: 100 * big.filter((f) => f.biggest >= 4).length / p, firstOne: big.length ? big.filter((f) => f.first === 1).length / big.length : 0,
        singles: sum('singles') / Math.max(1, sum('lines')), pass2: off[2] ? off[2][2] / off[2][0] : 0, pass3: off[3] ? off[3][2] / off[3][0] : 0,
        tallest: sum('tallest') / sum('boards'), parkedBoards: sum('parkedBoards') / sum('boards'), dug: sum('dug') / Math.max(1, sum('rowsIn')), settle: 100 * sum('settle') / p,
        reactPieces: med(runs.flatMap((r) => r.reactions.map((x) => x[1]))), opener: mean(openers.map((o) => o.lines)), openerPiece: med(openers.map((o) => o.piece)), roofPiece: med(openers.filter((o) => o.roof !== null).map((o) => o.roof)),
        tall: big.length ? med(big.map((f) => f.max)) : NaN,
    };
}

/** How far a style is from the playbook's numbers (0 = all met). Each part is a share of its target. */
export const TARGETS = { eight: 1.0, two: 0.6, edge: 0.75, parked: 0.65, shaft: 1.4, chain: 1.0, fire: 3.9, pass2: 0.4, singlesMax: 0.12, tallest: 11.5, opener: 6.3, sentPerLine: 0.65 };
export function distance(s) {
    const under = (x, t) => Math.max(0, (t - (Number.isFinite(x) ? x : 0)) / t);
    return {
        eight: under(s.eight, TARGETS.eight), two: under(s.two, TARGETS.two), edge: under(s.edge, TARGETS.edge), parked: under(s.parked, TARGETS.parked), shaft: under(s.shaft, TARGETS.shaft), chain: under(s.chain, TARGETS.chain), fire: under(s.fire, TARGETS.fire),
        pass2: Math.abs(s.pass2 - TARGETS.pass2) / TARGETS.pass2, singles: Math.max(0, (s.singles - TARGETS.singlesMax) / TARGETS.singlesMax), tallest: Math.abs(s.tallest - TARGETS.tallest) / TARGETS.tallest, opener: under(s.opener, TARGETS.opener), sentPerLine: under(s.sentPerLine, TARGETS.sentPerLine),
    };
}

if (process.argv[1].endsWith('style-run.mjs')) {
    const [first = '1', count = '6', cfg = '{}'] = process.argv.slice(2);
    const opts = JSON.parse(cfg);
    const t0 = Date.now();
    const runs = [];
    for (let s = Number(first); s < Number(first) + Number(count); s++) runs.push(await styleRun(s, opts));
    const s = style(runs);
    console.log(JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))));
    console.log('distance', JSON.stringify(Object.fromEntries(Object.entries(distance(s)).map(([k, v]) => [k, Math.round(v * 100) / 100]))), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
