import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.cwd(), 'src', 'themes');

function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('-theme.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

function toRelative(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll('\\', '/');
}

function analyzeTheme(filePath) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = toRelative(filePath);
    const issues = [];

    const isBaseTheme = /class\s+BaseTheme/.test(source);
    const hasCleanup = /cleanup\s*\(/.test(source);
    const callsSuperCleanup = /super\.cleanup\s*\(/.test(source);
    if (hasCleanup && !callsSuperCleanup && !isBaseTheme) {
        issues.push('cleanup() without super.cleanup()');
    }

    // Phase 2: Detect themes with stop() but no cleanup() override
    const hasStop = /\bstop\s*\(\s*\)\s*\{/.test(source);
    if (hasStop && !hasCleanup && !isBaseTheme) {
        issues.push('has stop() but no cleanup() override');
    }

    if (/window\.addEventListener\([^\n]*\.bind\(this\)/.test(source)) {
        issues.push('window.addEventListener with bind(this)');
    }

    if (/window\.removeEventListener\([^\n]*\.bind\(this\)/.test(source)) {
        issues.push('window.removeEventListener with bind(this)');
    }

    const rawResizeCount = (source.match(/window\.addEventListener\('resize'/g) || []).length;
    const trackedResizeCount = (source.match(/registerEventListener\([^\n]*'resize'/g) || []).length;
    if (rawResizeCount > 0 && trackedResizeCount === 0 && !/boundResizeHandler|resizeHandler|onWindowResize/.test(source)) {
        issues.push('raw resize listener without obvious tracked handler');
    }

    return { relativePath, issues };
}

const files = walk(rootDir);
const report = files.map(analyzeTheme).filter((entry) => entry.issues.length > 0);

if (report.length === 0) {
    console.log('Theme lifecycle audit passed with no obvious issues.');
    process.exit(0);
}

console.log('Theme lifecycle audit found potential issues:\n');
report.forEach((entry) => {
    console.log(`${entry.relativePath}`);
    entry.issues.forEach((issue) => {
        console.log(`  - ${issue}`);
    });
    console.log('');
});

process.exitCode = 1;
