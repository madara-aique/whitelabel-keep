// Must come first: @/lib/env reads process.env at module load.
import './load-env';

import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { serverEnv, validateServerEnv } from '@/lib/env';
import { getHardwareDriver } from '@/lib/hardware';
import { HardwareGateway } from '@/lib/hardware/gateway';

/**
 * Hardware gateway process.
 *
 * Runs separately from the Next.js server so that the device credential
 * and the socket broker live outside the web request lifecycle. The
 * browser only ever talks to this process, and only with a short-lived
 * token minted by the app.
 *
 *   npm run dev:gateway      # development
 *   node --import tsx src/server/gateway.ts
 */
const port = serverEnv.hardware.socketPort;

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        status: 'ok',
        driver: serverEnv.hardware.driver,
        connected: driver.isConnected(),
      }),
    );
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

const io = new SocketServer(httpServer, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  pingInterval: 10_000,
  pingTimeout: 20_000,
});

const driver = getHardwareDriver();
const gateway = new HardwareGateway(driver);
gateway.attach(io);

httpServer.listen(port, () => {
  const problems = validateServerEnv();
  console.log(`[gateway] listening on :${port} (driver=${serverEnv.hardware.driver})`);
  for (const problem of problems) {
    console.warn(`[gateway] config warning: ${problem}`);
  }
});

driver
  .connect()
  .then(() => console.log('[gateway] driver connected'))
  .catch((error: Error) => console.error(`[gateway] driver connection failed: ${error.message}`));

async function shutdown(signal: string): Promise<void> {
  console.log(`[gateway] ${signal} received, shutting down`);
  io.close();
  await driver.dispose().catch(() => undefined);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
