import { spawnSync } from 'node:child_process';

const base = 'http://127.0.0.1:4178/reports/wolfhour-overhaul/prototype.html?';
const shots = [
    ['moon-idle-t8', '1280x720', 't=8&quality=High&shipping=1'],
    ['moon-idle-t32', '1280x720', 't=32&quality=High&shipping=1'],
    ['moon-late-corona', '1280x720', 't=24&quality=High&shipping=1&event=combo&eventAge=1.25&combo=3&pointerY=-1'],
    ['moon-portrait', '540x960', 't=32&quality=Low&shipping=1&pointerX=-1&pointerY=-1'],
];
for (const [name, viewport, query] of shots) {
    const result = spawnSync(process.execPath, ['reports/wolfhour-overhaul/capture-original.mjs'], {
        env: {
            ...process.env,
            WOLFHOUR_CAPTURE_DIR: 'reports/wolfhour-moon-refinement',
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
