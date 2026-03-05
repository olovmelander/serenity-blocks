import assert from 'node:assert/strict';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

function runPoolingTests() {
    const theme = new WolfhourTheme();
    theme.scene = { add() {} };
    theme.effectPools.starBurst = [];

    let createdCount = 0;
    const active = [];
    const buildFn = () => {
        createdCount += 1;
        return {
            visible: false,
            userData: {},
            geometry: { dispose() {} },
            material: { dispose() {} },
        };
    };
    const resetFn = (effect) => {
        effect.userData.startTime = theme.time;
    };

    theme.qualityPreset.maxStarBursts = 2;
    const first = theme.acquireReactiveEffect('starBurst', active, buildFn, resetFn);
    const second = theme.acquireReactiveEffect('starBurst', active, buildFn, resetFn);
    const third = theme.acquireReactiveEffect('starBurst', active, buildFn, resetFn);

    assert.ok(first, 'First acquire should succeed');
    assert.ok(second, 'Second acquire should succeed');
    assert.equal(third, null, 'Acquire beyond capacity should return null');
    assert.equal(createdCount, 2, 'Pool should create up to capacity only');

    theme.releaseReactiveEffect('starBurst', active, 1, second);
    const reused = theme.acquireReactiveEffect('starBurst', active, buildFn, resetFn);
    assert.equal(reused, second, 'Acquire should reuse released effect object');

    theme.releaseReactiveEffect('starBurst', active, active.indexOf(first), first);
    theme.releaseReactiveEffect('starBurst', active, active.indexOf(reused), reused);

    for (let i = 0; i < 30; i += 1) {
        const a = theme.acquireReactiveEffect('starBurst', active, buildFn, resetFn);
        const b = theme.acquireReactiveEffect('starBurst', active, buildFn, resetFn);
        if (a) theme.releaseReactiveEffect('starBurst', active, active.indexOf(a), a);
        if (b) theme.releaseReactiveEffect('starBurst', active, active.indexOf(b), b);
    }

    assert.equal(createdCount, 2, 'Pool should not grow under repeated burst cycles');
}

try {
    runPoolingTests();
    console.log('test-wolfhour-effect-pooling: PASS');
    process.exit(0);
} catch (error) {
    console.error('test-wolfhour-effect-pooling: FAIL');
    console.error(error);
    process.exit(1);
}
