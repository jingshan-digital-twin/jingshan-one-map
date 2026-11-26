import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const setup = spawnSync(process.execPath, ['scripts/database.mjs', 'setup'], { cwd: root, stdio: 'inherit' });
if (setup.error) throw setup.error;
if (setup.status !== 0) process.exit(setup.status ?? 1);

const options = { cwd: root, stdio: 'inherit' };
const api = spawn(process.execPath, ['--env-file=.env', '--watch', 'server/index.ts'], options);
const web = spawn(process.execPath, ['--env-file=.env', 'node_modules/vite/bin/vite.js'], options);
const children = [api, web];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = code;
}

for (const child of children) {
  child.on('exit', (code) => stop(code ?? 0));
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
