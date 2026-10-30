// `npm run demo` / `npm run demo:reset`: runs the platform's demo script.
const { spawnSync } = require('child_process');
const path = require('path');

const reset = process.argv.includes('--reset');
const name = reset ? 'demo-reset' : 'demo';
const r = process.platform === 'win32'
  ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, `${name}.ps1`)], { stdio: 'inherit' })
  : spawnSync('bash', [path.join(__dirname, `${name}.sh`)], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
