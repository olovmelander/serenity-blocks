/* eslint-disable import/no-extraneous-dependencies */
import { spawn } from 'child_process';
import electronPath from 'electron';

const args = process.argv.slice(2);
const env = { ...process.env };

if (args[0] === '--dev') {
    env.NODE_ENV = 'development';
    args.shift();
}

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, args, {
    stdio: 'inherit',
    env,
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 0);
});

child.on('error', (error) => {
    console.error(`[run-electron] Failed to start Electron: ${error.message}`);
    process.exit(1);
});
