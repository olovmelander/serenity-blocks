import assert from 'node:assert/strict';
import WolfhourTheme from '../../src/themes/wolfhour/wolfhour-theme.js';

function runQualitySourceTests() {
    const theme = new WolfhourTheme();
    const originalWindow = globalThis.window;

    try {
        globalThis.window = {
            settings: {
                graphicsQuality: 'Low',
                effectQuality: 'Ultra',
            },
        };
        assert.equal(
            theme.getCurrentQualityLevel(),
            'Ultra',
            'effectQuality should override graphicsQuality when both are present',
        );

        globalThis.window = {
            settings: {
                graphicsQuality: 'Medium',
            },
        };
        assert.equal(
            theme.getCurrentQualityLevel(),
            'Medium',
            'graphicsQuality should be used when effectQuality is absent',
        );

        globalThis.window = {
            settings: {},
        };
        assert.equal(theme.getCurrentQualityLevel(), 'High', 'Default should be High when no quality is set');
    } finally {
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
    }
}

try {
    runQualitySourceTests();
    console.log('test-wolfhour-quality-source: PASS');
    process.exit(0);
} catch (error) {
    console.error('test-wolfhour-quality-source: FAIL');
    console.error(error);
    process.exit(1);
}
