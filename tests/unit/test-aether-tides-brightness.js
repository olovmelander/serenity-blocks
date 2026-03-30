import assert from 'node:assert/strict';
import AetherTidesTheme from '../../src/themes/aether-tides/aether-tides-theme.js';

function runAetherTidesBrightnessTests() {
    const theme = new AetherTidesTheme();
    const config = theme.getConfig();

    assert.equal(config.BLOOM_INTENSITY, 0.45, 'Aether Tides bloom intensity should be subtly reduced');
    assert.equal(config.BLOOM_THRESHOLD, 0.62, 'Aether Tides bloom threshold should be raised to reduce clipping');

    assert.deepEqual(
        theme.scaleVisualColor({ r: 1.0, g: 0.5, b: 0.25 }),
        { r: 0.88, g: 0.44, b: 0.22 },
        'Non-tetromino visuals should use the theme-local brightness scalar',
    );

    assert.deepEqual(
        theme.getTetrominoConfig(),
        {
            I: { color: '#00FFFF' },
            J: { color: '#0000FF' },
            L: { color: '#FF00FF' },
            O: { color: '#FFFF00' },
            S: { color: '#00FF00' },
            T: { color: '#800080' },
            Z: { color: '#FF0000' },
            ghost: { color: '#FFFFFF', opacity: 0.3 },
        },
        'Tetromino colors should remain unchanged by the background brightness pass',
    );
}

try {
    runAetherTidesBrightnessTests();
    console.log('test-aether-tides-brightness: PASS');
    process.exit(0);
} catch (error) {
    console.error('test-aether-tides-brightness: FAIL');
    console.error(error);
    process.exit(1);
}
