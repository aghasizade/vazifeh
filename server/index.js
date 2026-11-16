import { openDatabase } from './db.js';
import { createApp, lanAddresses } from './app.js';
import { closeAll } from './live.js';
import { startScheduler } from './scheduler.js';
import { secureDemoAccounts } from './demo.js';

export async function startServer({ dataDir, port = 8090, staticDir, downloadsDir, version = '1.0.0', host = '0.0.0.0' }) {
  const db = openDatabase(dataDir);
  secureDemoAccounts(db);
  const app = createApp(db, { staticDir, downloadsDir, version });
  const scheduler = startScheduler(db);

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => resolve(listener));
    listener.on('error', reject);
  });

  return {
    db,
    port,
    addresses: lanAddresses(port),
    close() {
      scheduler.stop();
      closeAll();
      server.close();
      db.close();
    }
  };
}
