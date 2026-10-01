import { spawnSync } from 'node:child_process';

const base = 'http://127.0.0.1:4178/reports/wolfhour-overhaul/prototype.html?';
const shots = [
    ['revised-idle', '1280x720', 't=8&quality=High&shipping=1'],
    ['revised-combo', '1280x720', 't=8&quality=High&shipping=1&event=combo&eventAge=0.35&combo=5'],
    ['revised-descent', '1280x720', 't=8&quality=High&shipping=1&event=crash&eventAge=1.05&combo=5&pointerX=0.8&pointerY=-0.4'],
    ['revised-impact', '1280x720', 't=8&quality=High&shipping=1&event=crash&eventAge=1.7&combo=5&pointerX=0.8&pointerY=-0.4'],
    ['revised-left', '1280x720', 't=24&quality=High&shipping=1&pointerX=-1&pointerY=0.6'],
    ['revised-right', '1280x720', 't=24&quality=High&shipping=1&pointerX=1&pointerY=-0.6'],
    ['revised-portrait', '540x960', 't=50&quality=Low&shipping=1&pointerX=1&pointerY=1'],
    ['revised-board', '1280x720', 't=50&quality=High&shipping=0&board=1&pointerX=-0.7&pointerY=0.2'],
    ['revised-wide', '1536x432', 't=50&quality=High&shipping=1&pointerX=1&pointerY=1'],
];
for (const [name, viewport, query] of shots) {
    console.log(`Capturing ${name}`);
    const result = spawnSync(process.execPath, ['reports/wolfhour-overhaul/capture-original.mjs'], {
        env: {
            ...process.env,
            WOLFHOUR_CAPTURE_DIR: 'reports/wolfhour-motion-audit',
            WOLFHOUR_CAPTURE_NAME: name,
            WOLFHOUR_VIEWPORT: viewport,
            WOLFHOUR_CAPTURE_URL: base + query,
        },
        encoding: 'utf8', windowsHide: true,
    });
    if (result.status !== 0) {
        console.error(result.stdout, result.stderr, result.error || '');
        process.exit(result.status || 1);
    }
    console.log(`${name}: captured, no browser errors`);
}
