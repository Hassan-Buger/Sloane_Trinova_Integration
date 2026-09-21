/**
 * Server Entry Point
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './middleware/sanitizer.js';

const app = createApp();

app.listen(config.port, () => {
  logger.info(`Trinova API Server listening on port ${config.port} [env: ${config.env}]`);
});
