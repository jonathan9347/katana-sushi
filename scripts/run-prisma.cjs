const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '..', 'backend', '.env');

// Build final env: prefer runtime/provided environment variables (process.env).
// By default, do NOT read `backend/.env` in production/CI. This avoids leaking
// or accidentally overriding platform-provided secrets during builds.
// To force reading the file (for local dev), either set `USE_ENV_FILE=true`
// or run with `NODE_ENV` !== 'production'.
const finalEnv = { ...process.env };
const shouldReadEnvFile = process.env.USE_ENV_FILE === 'true' || (process.env.NODE_ENV || 'development') !== 'production';

if (shouldReadEnvFile && fs.existsSync(envPath)) {
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
    if (!Object.prototype.hasOwnProperty.call(finalEnv, key)) {
      finalEnv[key] = value;
    }
  }
}

const args = process.argv.slice(2);
const command = process.platform === 'win32' ? 'node.exe' : 'node';
const prismaBin = path.resolve(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');

// finalEnv is already prepared above.

const result = execFileSync(command, [prismaBin, ...args], {
  cwd: path.resolve(__dirname, '..'),
  env: finalEnv,
  stdio: 'inherit'
});

if (result) {
  process.stdout.write(result);
}
