import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main() {
  const config = loadConfig();
  const { app, db } = await buildApp({ config });

  const shutdown = async (signal: string) => {
    console.log(`[tower] received ${signal}, shutting down...`);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.listen({ port: config.port, host: config.host });
  console.log(
    `[tower] listening on http://${config.host}:${config.port} (db=${db.driver}, allowPrivateFetch=${config.allowPrivateFetch})`,
  );
}

main().catch((err) => {
  console.error('[tower] fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
