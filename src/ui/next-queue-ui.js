import { SHAPES, COLORS } from '../core/constants.js';

const BLOCK_SIZE = 16;
const PADDING = 5;

function drawMiniBlock(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, BLOCK_SIZE, BLOCK_SIZE);

    // Highlights & shadows for subtle depth
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(x, y, BLOCK_SIZE, 1);
    ctx.fillRect(x, y, 1, BLOCK_SIZE);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(x, y + BLOCK_SIZE - 1, BLOCK_SIZE, 1);
    ctx.fillRect(x + BLOCK_SIZE - 1, y, 1, BLOCK_SIZE);
}

function drawPiece(canvas, pieceKey) {
    const ctx = canvas.getContext('2d');
    const shape = SHAPES[pieceKey];
    const color = COLORS[pieceKey];

    const rows = shape.length;
    const cols = shape[0].length;

    canvas.width = cols * BLOCK_SIZE + PADDING * 2;
    canvas.height = rows * BLOCK_SIZE + PADDING * 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (shape[row][col]) {
                drawMiniBlock(ctx, PADDING + col * BLOCK_SIZE, PADDING + row * BLOCK_SIZE, color);
            }
        }
    }
}

export function updateNextQueue(nextPieces) {
    const queueContainer = document.getElementById('next-queue-container');
    if (!queueContainer) return;
    queueContainer.innerHTML = '';

    const nextLabel = document.createElement('div');
    nextLabel.className = 'next-queue-label';
    nextLabel.textContent = 'NEXT';
    queueContainer.appendChild(nextLabel);

    nextPieces.slice(0, 3).forEach((pieceKey, index) => {
        const pieceContainer = document.createElement('div');
        pieceContainer.className = 'next-queue-piece';
        if (index === 0) {
            pieceContainer.classList.add('highlight');
        }

        const canvas = document.createElement('canvas');
        pieceContainer.appendChild(canvas);
        queueContainer.appendChild(pieceContainer);

        drawPiece(canvas, pieceKey);
    });
}
