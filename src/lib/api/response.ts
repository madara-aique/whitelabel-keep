import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/**
 * Uniform JSON envelope for every Route Handler.
 *
 * The legacy API returned a different shape per endpoint (sometimes
 * `{data:{doors:[]}}`, sometimes `{data:{doors:{}}}`), which made
 * clients guess. Everything here is `{success, data}` or
 * `{success, error}`.
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: string;
  details?: unknown;
}

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function created<T>(data: T): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export function fail(
  error: string,
  status = 400,
  details?: unknown,
): NextResponse<ApiFailure> {
  return NextResponse.json({ success: false, error, details }, { status });
}

export function methodNotAllowed(allowed: string[]): NextResponse<ApiFailure> {
  return NextResponse.json(
    { success: false, error: 'Method not allowed' },
    { status: 405, headers: { allow: allowed.join(', ') } },
  );
}

/**
 * Convert a thrown error into a response. Validation problems become
 * 422 with field details; anything else becomes 500 and is logged with
 * a context tag so the failing route is identifiable.
 */
export function handleRouteError(
  error: unknown,
  context: string,
): NextResponse<ApiFailure> {
  if (error instanceof ZodError) {
    return fail('Validation failed', 422, error.flatten());
  }

  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error(`[api] ${context}: ${message}`);
  return fail('Internal server error', 500);
}
