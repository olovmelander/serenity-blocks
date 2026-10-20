// SessionStart hook: give a Claude worktree session the main checkout's node_modules.
// The desktop app's worktrees (.claude/worktrees/<name>/) start without node_modules,
// and it doesn't apply worktree.symlinkDirectories, so this links it in (a junction on
// Windows, no admin needed). In the main checkout, or when node_modules exists, it does nothing.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function readHookCwd() {
  try {
    const input = fs.readFileSync(0, 'utf8');
    return JSON.parse(input).cwd || process.cwd();
  } catch {
    return process.cwd();
  }
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

try {
  const cwd = readHookCwd();
  const top = path.resolve(git(cwd, 'rev-parse', '--show-toplevel'));
  const mainRoot = path.dirname(path.resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir')));
  if (top === mainRoot) process.exit(0);

  const link = path.join(top, 'node_modules');
  const target = path.join(mainRoot, 'node_modules');
  if (fs.existsSync(link) || !fs.existsSync(target)) process.exit(0);

  fs.symlinkSync(target, link, 'junction');
  console.log(`Linked node_modules from ${mainRoot}`);
} catch (err) {
  console.error(`link-node-modules: ${err.message}`);
}
