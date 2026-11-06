import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load `.env` files for standalone entry points.
 *
 * Next.js reads `.env.local`/`.env` itself, but the hardware gateway and
 * the scripts run as plain Node processes. Without this the gateway would
 * sign hardware tokens with a different secret than the web app verifies
 * them with, and every kiosk socket would be rejected.
 *
 * Import this module first, before anything that reads `process.env` —
 * `@/lib/env` captures its values at module load.
 */
const files = ['.env.local', '.env'];

for (const file of files) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  try {
    // Node's loader never overwrites variables that are already set, so a
    // real environment always wins over the file.
    process.loadEnvFile(path);
  } catch (error) {
    console.warn(
      `[env] could not load ${file}: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
