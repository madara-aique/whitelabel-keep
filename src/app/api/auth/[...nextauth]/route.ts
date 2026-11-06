import { handlers } from '@/lib/auth';

/**
 * NextAuth route handler.
 *
 * Sign-in, sign-out and session endpoints. The handlers are re-exported
 * as-is so the auth configuration stays in one module.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST } = handlers;
