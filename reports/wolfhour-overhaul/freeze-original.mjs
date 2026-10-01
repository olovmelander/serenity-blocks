import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const directory = 'reports/wolfhour-overhaul/original';
// Captured before this overhaul. Keep the original A/B reproducible after edits.
const revision = '14b576a1a9f2e7003bc63eaa4d89c66d0767ab92';
mkdirSync(directory, { recursive: true });
const files = execFileSync('git', ['ls-tree', '--name-only', `${revision}:src/themes/wolfhour`], { encoding: 'utf8' }).trim().split('\n');
for (const name of files) {
    if (!name.endsWith('.js')) continue;
    let source = execFileSync('git', ['show', `${revision}:src/themes/wolfhour/${name}`], { encoding: 'utf8' });
    source = source.replace(/from (['"])(\.\.[^'"]+)\1/g, (_, quote, specifier) => {
        const target = path.posix.normalize(`/src/themes/wolfhour/${specifier}`);
        return `from ${quote}${target}${quote}`;
    });
    writeFileSync(path.join(directory, name), source);
}
