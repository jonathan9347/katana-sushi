const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '..', 'backend', '.env');
const envFile = fs.readFileSync(envPath, 'utf8');
const env = {};

for (const line of envFile.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  let value = trimmed.slice(idx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const args = process.argv.slice(2);
const command = process.platform === 'win32' ? 'node.exe' : 'node';
const prismaBin = path.resolve(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');
const result = execFileSync(command, [prismaBin, ...args], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, ...env },
  stdio: 'inherit'
});

if (result) {
  process.stdout.write(result);
}
