import assert from 'node:assert/strict';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

function runReactiveQueueTests() {
    const theme = new WolfhourTheme();
    theme.activeQualityLevel = 'High';
    theme.flags.noAdaptivePacing = false;
    theme.scene = { add() {} };
    theme.effectState = {
        starBurstIntensity: 0,
        cosmicRiftIntensity: 0,
        celestialBeamIntensity: 0,
        mountainPulse: 0,
        mountainShockwave: 0,
        spiritSurge: 0,
        bloomBoost: 0,
        nebulaBoost: 0,
        nebulaColorShift: 0,
        nebulaDefinition: 0,
        ambientScatter: 0,
        ambientSwirl: 0,
        cameraShake: 0,
    };

    const spawnOrder = [];
    theme.createMeteor = () => { spawnOrder.push('meteor'); theme.meteors.push({}); return true; };
    theme.createCelestialBeam = () => { spawnOrder.push('beam'); theme.celestialBeams.push({}); return true; };
    theme.createStarBurst = () => { spawnOrder.push('starBurst'); theme.starBursts.push({}); return true; };
    theme.createMeteorCrash = () => { spawnOrder.push('crash'); theme.meteorCrashes.push({}); return true; };

    const now = performance.now();
    theme.enqueueReactiveToken('meteor', {}, now - 10);
    theme.enqueueReactiveToken('beam', {}, now - 9);
    theme.enqueueReactiveToken('starBurst', {}, now - 8);
    theme.processReactiveQueue();

    assert.deepStrictEqual(
        spawnOrder.slice(0, 2),
        ['meteor', 'beam'],
        'High quality budget should process meteor(2) + beam(1) first',
    );
    assert.equal(theme.reactiveQueue.length, 1, 'One token should remain queued after budget is exhausted');

    const droppedBefore = theme.reactiveMetrics.tokensDropped;
    theme.enqueueReactiveToken('crash', {}, now - 5000);
    theme.processReactiveQueue();
    assert.ok(
        theme.reactiveMetrics.tokensDropped > droppedBefore,
        'Expired token should increment dropped counter',
    );
    assert.ok(theme.effectState.bloomBoost > 0, 'Expiry should convert into bloom fallback intensity');
    assert.ok(theme.effectState.nebulaDefinition > 0, 'Expiry should boost nebula definition fallback');
    assert.ok(theme.effectState.cameraShake > 0, 'Expiry should boost camera shake fallback');
}

try {
    runReactiveQueueTests();
    console.log('test-wolfhour-reactive-queue: PASS');
    process.exit(0);
} catch (error) {
    console.error('test-wolfhour-reactive-queue: FAIL');
    console.error(error);
    process.exit(1);
}
