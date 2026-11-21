import { SHAPES } from '../core/constants.js';
import { drawPieceSolid, trimShape } from '../rendering/canvas/canvas-drawing-utils.js';

/** Use the solo well's own sizing and glass in composition checks, including its portrait ledger. */
export function mountSoloWellPreview(themeId, tetrominos, withHud) {
    const root = document.createElement('div');
    root.id = `${themeId}-theme`;
    root.className = 'active';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    root.innerHTML = `
        <link rel="stylesheet" href="./styles/keystone-solo.css">
        <div class="single-player-stage" data-board="well"
            style="display:flex;--sb-board-fill:.85;--sb-board-floor:520px;color:#efe9dc;font:14px system-ui">
          <div id="single-player-container">
            <div class="single-player-card player-card" id="single-player-card" data-player="solo">
              <div class="single-player-piece-previews">
                <div class="player-next-pieces" style="display:flex"></div>
              </div>
              <div class="player-board-section">
                <div id="phaser-game-container">
                  <canvas width="240" height="480" style="width:100%;height:100%"></canvas>
                </div>
                <div id="single-player-border"></div>
              </div>
            </div>
          </div>
        </div>`;
    const paint = (canvas, key, x, y, cell) => drawPieceSolid(
        canvas.getContext('2d'),
        trimShape(SHAPES[key]),
        x,
        y,
        cell,
        { ...tetrominos, color: tetrominos.colors[key] },
    );
    const queue = root.querySelector('.player-next-pieces');
    ['J', 'O', 'L'].forEach((key, index) => {
        const tile = document.createElement('canvas');
        tile.width = 80;
        tile.height = 48;
        tile.className = `player-next-piece${index === 0 ? ' highlight' : ''}`;
        const shape = trimShape(SHAPES[key]);
        paint(tile, key, (80 - shape[0].length * 15) / 2, (48 - shape.length * 15) / 2, 15);
        queue.append(tile);
    });
    const board = root.querySelector('#phaser-game-container canvas');
    const pieces = [['S', 0, 18], ['I', 3, 19], ['O', 7, 18], ['T', 3, 3]];
    pieces.forEach(([key, x, y]) => paint(board, key, x * 24, y * 24, 24));
    if (withHud) {
        const hud = document.createElement('div');
        hud.className = 'single-player-stats-bar';
        hud.style.display = 'flex';
        for (const [label, value] of [['Score', '2,400'], ['Level', '1'], ['Lines', '8']]) {
            const stat = document.createElement('div');
            stat.className = 'single-player-stat';
            stat.innerHTML = `<span class="single-player-stat-label">${label}</span>`
                + `<span class="single-player-stat-value">${value}</span>`;
            hud.append(stat);
        }
        root.querySelector('.single-player-stage').append(hud);
    }
    document.body.appendChild(root);
    return root;
}
