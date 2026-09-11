// Injects VION_QUEUE_API_URL/VION_QUEUE_API_TOKEN from a local .env file into
// the committed environment.ts/environment.prod.ts placeholders at build time,
// so the real values never get hardcoded/committed. Runs automatically before
// `npm run build`/`build:docker` via the "pre<script>" npm convention.
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.warn('[write-env] No .env file found at ' + envPath + ' - leaving environment files as-is.');
  process.exit(0);
}

const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx === -1) continue;
  env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
}

const targets = [
  path.join(__dirname, '..', 'src', 'environments', 'environment.ts'),
  path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts')
];

for (const file of targets) {
  let contents = fs.readFileSync(file, 'utf8');
  contents = contents.replace(/vionQueueApiUrl: '[^']*'/, `vionQueueApiUrl: '${env.VION_QUEUE_API_URL ?? ''}'`);
  contents = contents.replace(/vionQueueApiToken: '[^']*'/, `vionQueueApiToken: '${env.VION_QUEUE_API_TOKEN ?? ''}'`);
  fs.writeFileSync(file, contents);
  console.log('[write-env] Updated ' + path.relative(process.cwd(), file));
}
