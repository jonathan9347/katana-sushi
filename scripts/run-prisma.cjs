const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '..', 'backend', '.env');
const env = {};

// Only read backend/.env if it exists. On CI/build systems (Render) this file
// may be absent by design because secrets are injected via the dashboard.
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
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
} else {
  // No local .env found — that's fine for CI/build environments.
}

const args = process.argv.slice(2);
const command = process.platform === 'win32' ? 'node.exe' : 'node';
const prismaBin = path.resolve(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');

// Build final env: prefer runtime/provided environment variables (process.env).
// Only use values from backend/.env when the key is not already set in process.env.
const finalEnv = { ...process.env };
for (const k of Object.keys(env)) {
  if (!Object.prototype.hasOwnProperty.call(finalEnv, k)) {
    finalEnv[k] = env[k];
  }
}

const result = execFileSync(command, [prismaBin, ...args], {
  cwd: path.resolve(__dirname, '..'),
  env: finalEnv,
  stdio: 'inherit'
});

if (result) {
  process.stdout.write(result);
}
