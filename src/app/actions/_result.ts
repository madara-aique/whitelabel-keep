import { ZodError } from 'zod';
import { ServiceError } from '@/lib/services/booking-service';

/**
 * Shared result envelope for every Server Action.
 *
 * Server Actions must not throw useful errors across the client
 * boundary: a thrown error is redacted in production and the caller
 * cannot branch on it. Each action therefore funnels its work through
 * `runAction`, which converts validation, domain and unexpected errors
 * into a discriminated union the client can handle.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code?: string;
      status?: number;
      details?: unknown;
    };

/** Message thrown by `requireSessionUser()` when nobody is signed in. */
const UNAUTHORIZED_MESSAGE = 'UNAUTHORIZED';

/**
 * Convert a thrown error into the failure branch. Zod problems carry
 * flattened field details; domain problems keep their status and code;
 * anything else is logged and reported generically so internals never
 * leak to the kiosk.
 */
export function actionFailure(error: unknown, tag: string): ActionResult<never> {
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      status: 422,
      details: error.flatten(),
    };
  }

  if (error instanceof ServiceError) {
    return {
      ok: false,
      error: error.message,
      code: error.code,
      status: error.status,
    };
  }

  if (error instanceof Error && error.message === UNAUTHORIZED_MESSAGE) {
    return {
      ok: false,
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
      status: 401,
    };
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error(`[action] ${tag}: ${message}`);
  return {
    ok: false,
    error: 'Something went wrong. Please try again.',
    code: 'INTERNAL_ERROR',
    status: 500,
  };
}

/** Run an action body, always resolving to a result instead of throwing. */
export async function runAction<T>(
  tag: string,
  work: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return actionFailure(error, tag);
  }
}
