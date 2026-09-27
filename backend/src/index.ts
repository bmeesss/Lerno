import { createApp } from './app.js';
import { config, isDevDataMode } from './config.js';
import { pingDatabase } from './lib/db/index.js';

const app = createApp({ dbPing: pingDatabase });

app.listen(config.port, '0.0.0.0', () => {
  console.info(`Lerno API listening on port ${config.port} (${config.nodeEnv})`);
  if (isDevDataMode) {
    console.warn(
      'Running in development data mode (in-memory store). ' +
        'Set SUPABASE_URL/SUPABASE_ANON_KEY for the production data path.',
    );
  }
});
