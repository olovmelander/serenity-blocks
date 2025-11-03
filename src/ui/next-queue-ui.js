import { SHAPES, COLORS } from '../core/constants.js';

const BLOCK_SIZE = 16;
const PADDING = 5;

function drawMiniBlock(ctx, x, y, color) {
    // Draw solid colored block without individual borders
    ctx.fillStyle = color;
    ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);
}

export function drawPiece(canvas, pieceKey) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const shape = SHAPES[pieceKey];
    const color = COLORS[pieceKey];

    const rows = shape.length;
    const cols = shape[0].length;

    canvas.width = cols * BLOCK_SIZE + PADDING * 2;
    canvas.height = rows * BLOCK_SIZE + PADDING * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Disable anti-aliasing for crisp pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;

    // Draw as one solid path to avoid any gaps between blocks
    ctx.fillStyle = color;
    ctx.beginPath();

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (shape[row][col]) {
                const x = PADDING + col * BLOCK_SIZE;
                const y = PADDING + row * BLOCK_SIZE;
                ctx.rect(x, y, BLOCK_SIZE, BLOCK_SIZE);
            }
        }
    }

    ctx.fill();
}

export function updateNextQueue(nextPieces) {
    const queueContainer = document.getElementById('next-queue-container');
    if (!queueContainer) return;
    queueContainer.innerHTML = '';

    queueContainer.classList.remove('next-queue-container');
    queueContainer.classList.add('player-next-pieces', 'single-player-next');

    const slotsToRender = 3;

    for (let index = 0; index < slotsToRender; index += 1) {
        const pieceKey = nextPieces[index];
        const pieceContainer = document.createElement('div');
        pieceContainer.className = 'player-next-piece';
        if (index === 0) {
            pieceContainer.classList.add('highlight');
        }

        const canvas = document.createElement('canvas');
        pieceContainer.appendChild(canvas);
        queueContainer.appendChild(pieceContainer);

        if (pieceKey) {
            drawPiece(canvas, pieceKey);
        } else {
            pieceContainer.classList.add('empty');
        }
    }
}
