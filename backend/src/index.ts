import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.port, '0.0.0.0', () => {
  console.info(`Lerno API listening on port ${config.port} (${config.nodeEnv})`);
});
