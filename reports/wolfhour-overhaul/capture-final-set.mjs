import { spawnSync } from 'node:child_process';
const base = 'http://127.0.0.1:4178/reports/wolfhour-overhaul/prototype.html?t=8&quality=';
const shots = [
    ['original-final-high', '1280x720', 'http://127.0.0.1:4177/reports/wolfhour-overhaul/baseline.html?wolfhourSeed=73013&t=8'],
    ['reference-final-high', '1280x720', `${base}High&shipping=1`],
    ['reference-final-square', '900x900', `${base}High&shipping=1`],
    ['reference-final-combo', '1280x720', `${base}High&shipping=1&event=combo&eventAge=0.35&combo=5`],
    ['reference-final-crash', '1280x720', `${base}High&shipping=1&event=crash&eventAge=1.7&combo=5`],
    ['reference-final-portrait', '540x960', `${base}Low&shipping=1`],
    ['reference-final-playground', '1280x720', `${base}High&shipping=0`],
];
// One isolated scene/browser at a time; never overlap GPU validation sessions.
for (const [name, viewport, url] of shots) {
    console.log(`Capturing ${name}`);
    const result = spawnSync(process.execPath, ['reports/wolfhour-overhaul/capture-original.mjs'], {
        env: { ...process.env, WOLFHOUR_CAPTURE_NAME: name, WOLFHOUR_VIEWPORT: viewport, WOLFHOUR_CAPTURE_URL: url },
        encoding: 'utf8', windowsHide: true,
    });
    if (result.status !== 0) {
        console.error(result.stdout, result.stderr, result.error || '');
        process.exit(result.status || 1);
    }
    console.log(`${name}: ready, captured, two measurement windows, no browser errors`);
}
