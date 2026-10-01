import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const directory = path.resolve('reports/wolfhour-motion-audit');
mkdirSync(directory, { recursive: true });
const results = [];
for (const script of ['typecheck', 'build', 'lint:ci', 'audit:theme-lifecycle']) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const command = `npm run ${script}`;
    console.log(`${startedAt} START ${command}`);
    const result = process.platform === 'win32'
        ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
            encoding: 'utf8', windowsHide: true, timeout: 360000, maxBuffer: 64 * 1024 * 1024,
        })
        : spawnSync('npm', ['run', script], {
            encoding: 'utf8', timeout: 360000, maxBuffer: 64 * 1024 * 1024,
        });
    const entry = {
        script,
        command,
        startedAt,
        completedAt: new Date().toISOString(),
        durationSeconds: (performance.now() - started) / 1000,
        exitCode: result.status,
        signal: result.signal,
        error: result.error ? String(result.error.stack || result.error) : null,
    };
    const log = `${JSON.stringify(entry, null, 2)}\n\nSTDOUT\n${result.stdout || ''}\nSTDERR\n${result.stderr || ''}`;
    writeFileSync(path.join(directory, `${script.replaceAll(':', '-')}.log`), log);
    results.push(entry);
    writeFileSync(path.join(directory, 'validation-status.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(entry));
}
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
