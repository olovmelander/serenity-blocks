import { describe, expect, it } from 'vitest';
import { GameState, canPlacePiece, rotate } from '../../src/core/game.js';
import { SHAPES } from '../../src/core/constants.js';

function cloneShape(shape) {
    return shape.map((row) => row.slice());
}

function rotateShape(shape, direction = 'right') {
    if (direction === 'right') {
        return shape[0].map((_, i) => shape.map((row) => row[i]).reverse());
    }
    if (direction === 'left') {
        return shape[0].map((_, i) => shape.map((row) => row[i])).reverse();
    }
    return shape.map((row) => row.slice().reverse()).reverse();
}

function shapeAtRotation(shapeKey, rotation) {
    let shape = cloneShape(SHAPES[shapeKey]);
    for (let step = 0; step < rotation; step++) {
        shape = rotateShape(shape, 'right');
    }
    return shape;
}

function createPiece(shapeKey, rotation, x) {
    return {
        shapeKey,
        type: shapeKey,
        shape: shapeAtRotation(shapeKey, rotation),
        rotation,
        x,
        y: 0,
        color: shapeKey,
    };
}

function edgeRotate(shapeKey, rotation, x, direction) {
    const gameState = new GameState();
    gameState.currentPiece = createPiece(shapeKey, rotation, x);

    expect(canPlacePiece(gameState, gameState.currentPiece, x, 0)).toBe(true);
    return rotate(gameState, direction);
}

describe('edge wall rotation', () => {
    it.each(['T', 'J', 'L'])('rotates vertical %s pieces at the right wall', (shapeKey) => {
        expect(edgeRotate(shapeKey, 1, 8, 'right')).toBe(true);
        expect(edgeRotate(shapeKey, 1, 8, 'left')).toBe(true);
        expect(edgeRotate(shapeKey, 1, 8, 'flip')).toBe(true);
    });

    it.each(['T', 'J', 'L'])('rotates vertical %s pieces at the left wall', (shapeKey) => {
        expect(edgeRotate(shapeKey, 3, -1, 'right')).toBe(true);
        expect(edgeRotate(shapeKey, 3, -1, 'left')).toBe(true);
        expect(edgeRotate(shapeKey, 3, -1, 'flip')).toBe(true);
    });
});
