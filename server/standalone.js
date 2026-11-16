// Runs the server: `npm run server` while developing, or as a systemd service on a Linux server.
// Environment: PORT, TASKS_DATA (data folder), TASKS_DOWNLOADS (installers for in-app updates), HOST.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every date and reminder is in Iran time, whatever the server's own clock zone is.
process.env.TZ = process.env.TZ || 'Asia/Tehran';

const { startServer } = await import('./index.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const port = Number(process.env.PORT) || 8090;
const dataDir = process.env.TASKS_DATA || path.join(root, '.data');

const server = await startServer({
  dataDir,
  staticDir: path.join(root, 'dist'),
  downloadsDir: process.env.TASKS_DOWNLOADS || path.join(dataDir, 'downloads'),
  port,
  host: process.env.HOST || '0.0.0.0',
  version: pkg.version
});
console.log(`Vazifeh server on http://localhost:${port}  (data: ${dataDir})`);
server.addresses.forEach((address) => console.log(`  LAN: ${address}`));

const shutdown = () => { server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
