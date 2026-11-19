import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { captureGarbage } from '../bot-ai-audit-2026-11/probes.mjs';
import { seededRandom } from '../../src/utils/helpers.js';
import { recordedSeat } from './recorded-seat.mjs';

const packet = await captureGarbage();
async function clip(tier, seed, underPressure) {
    const seat = recordedSeat(tier, seed), state = seat.state, frames = [];
    try {
        const dt = 1000 / 60;
        for (let tick = 0; tick < 60 * 18 && !state.isGameOver; tick++) {
            if (tick === 240 && underPressure) seat.queue.enqueue(packet);
            seat.step();
            const grid = state.boardGrid.map(row => row.map(c => c ? (c.type.length > 1 ? 'G' : c.type) : '.'));
            const piece = state.currentPiece;
            if (piece) piece.shape.forEach((row, y) => row.forEach((v, x) => {
                const iy = Math.floor(piece.y) + y, ix = piece.x + x;
                if (v && grid[iy] && ix >= 0 && ix < 10) grid[iy][ix] = piece.shapeKey.toLowerCase();
            }));
            const board = grid.slice(-20).map(row => row.join('')).join('');
            if (!frames.length || frames.at(-1)[1] !== board) frames.push([Math.round(tick * dt), board]);
        }
    } finally { seat.close(); }
    return frames;
}

const clips = [];
for (const [tier, seed, attack] of [[4, 93102, true], [1, 93105, false], [6, 93108, false], [2, 93110, true],
    [5, 93111, true], [3, 93112, false], [1, 93113, true], [6, 93116, true]]) {
    clips.push(await clip(tier, seed, attack));
}

const studyId = createHash('sha256').update(JSON.stringify(clips)).digest('hex');

function runStudy(boards, makeRandom, clipSet) {
    const pick = document.querySelector('#pick');
    const rating = document.querySelector('#rating');
    const note = document.querySelector('#note');
    const ctx = document.querySelector('canvas').getContext('2d');
    const responses = boards.map((_, i) => ({ clip: i + 1, rating: '', note: '' }));
    const orderSeed = Number(new URLSearchParams(location.search).get('order')
        ?? crypto.getRandomValues(new Uint32Array(1))[0]) >>> 0;
    const random = makeRandom(orderSeed);
    const order = boards.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((id, i) => pick.add(new Option((i + 1) + ' of ' + order.length, id)));
    const colors = { I: '#66cad9', T: '#bb8bdb', O: '#eab65b', S: '#85b87d',
        Z: '#d78078', J: '#759dd3', L: '#e39b64', G: '#808893' };
    let animation = 0;
    function replay() {
        cancelAnimationFrame(animation);
        const frames = boards[Number(pick.value)];
        const start = performance.now();
        let index = -1;
        function draw(now) {
            const before = index;
            while (index + 1 < frames.length && frames[index + 1][0] <= now - start) index++;
            if (index !== before) {
                ctx.clearRect(0, 0, 180, 360);
                [...frames[index][1]].forEach((cell, j) => {
                    if (cell === '.') return;
                    ctx.fillStyle = colors[cell.toUpperCase()];
                    ctx.globalAlpha = cell === cell.toUpperCase() ? 0.78 : 1;
                    ctx.fillRect((j % 10) * 18, Math.floor(j / 10) * 18, 17, 17);
                });
                ctx.globalAlpha = 1;
            }
            if (now - start < 18000) animation = requestAnimationFrame(draw);
        }
        animation = requestAnimationFrame(draw);
    }
    pick.onchange = () => {
        const current = responses[Number(pick.value)];
        rating.value = current.rating;
        note.value = current.note;
        replay();
    };
    function record() {
        Object.assign(responses[Number(pick.value)], { rating: rating.value, note: note.value });
    }
    rating.onchange = record;
    note.oninput = record;
    document.querySelector('#play').onclick = replay;
    const playedTier = document.querySelector('#tier');
    for (let tier = 1; tier <= 10; tier++) playedTier.add(new Option(tier, tier));
    document.querySelector('#save').onclick = () => {
        const playFeedback = playedTier.value ? {
            tier: Number(playedTier.value),
            fun: document.querySelector('#fun').value,
            note: document.querySelector('#play-note').value,
        } : null;
        const payload = { studyId: clipSet, orderSeed, order: order.map(id => id + 1), responses, playFeedback };
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        link.download = 'opponent-review.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    replay();
}

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Opponent movement study</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{background:#161d25;color:#f1f1ef;font:17px system-ui;margin:2em auto;max-width:35em;padding:0 1em}main{display:flex;gap:2em;align-items:flex-start;flex-wrap:wrap}canvas{background:#0f141a}button,select,textarea{font:inherit;margin:.3em .2em .3em 0}textarea{width:100%;display:block}button{padding:.3em .6em}label{display:block;margin:.7em 0}details{margin:1.2em 0}summary{cursor:pointer}</style>
<h1>Opponent movement study</h1><p>Watch each clip and judge whether the movements look plausible for a person playing. Record any move that influenced your answer.</p>
<main><canvas width="180" height="360" aria-label="Recorded Serenity Blocks board"></canvas><section>
<label>Clip <select id="pick"></select></label><button id="play">Replay</button>
<label>Plausible human movement <select id="rating"><option value="">Choose</option><option>Yes</option><option>No</option><option>Unsure</option></select></label>
<label>What did you notice?<textarea id="note" rows="4"></textarea></label></section></main>
<details><summary>After playing a live match</summary>
<label>Tier played <select id="tier"><option value="">Choose</option></select></label>
<label>Was that match fun? <select id="fun"><option value="">Choose</option><option>Yes</option><option>Mixed</option><option>No</option></select></label>
<label>What made it enjoyable or frustrating?<textarea id="play-note" rows="3"></textarea></label></details>
<button id="save">Download responses</button>
<script>(${runStudy.toString()})(${JSON.stringify(clips)}, ${seededRandom.toString()}, ${JSON.stringify(studyId)});</script></html>`;
writeFileSync(process.argv[2], html, { flag: 'wx' });
