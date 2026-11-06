import { afterEach, describe, expect, it, vi } from 'vitest';
import { cn, fetchWithTimeout, formatMoney, isRecord, pad } from '@/lib/utils';

describe('cn', () => {
  it('joins the class names it is given', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('drops falsy values', () => {
    expect(cn('px-2', null, undefined, false, '', 'py-1')).toBe('px-2 py-1');
  });

  it('lets the last conflicting tailwind utility win', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});

describe('formatMoney', () => {
  it('formats an integer amount with the default symbol', () => {
    expect(formatMoney(1250)).toBe('PHP 1,250');
  });

  it('honours a custom symbol', () => {
    expect(formatMoney(1250, '$')).toBe('$ 1,250');
  });

  it('truncates fractional amounts', () => {
    expect(formatMoney(99.9)).toBe('PHP 99');
  });

  it('falls back to zero for a non-finite amount', () => {
    expect(formatMoney(Number.NaN)).toBe('PHP 0');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('PHP 0');
  });
});

describe('pad', () => {
  it('left-pads a value to the requested width', () => {
    expect(pad(7, 3)).toBe('007');
    expect(pad(0, 6)).toBe('000000');
  });

  it('leaves a value that is already wider than the width alone', () => {
    expect(pad(1234, 2)).toBe('1234');
  });
});

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ transId: 'REF-1' })).toBe(true);
  });

  it('rejects arrays, null and primitives', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('REF-1')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the fetch response and forwards the init it was given', async () => {
    const response = new Response('{"status":"ok"}', { status: 200 });
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(response),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWithTimeout('/api/health', { method: 'GET', timeoutMs: 500 });

    expect(result).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/health');
    expect(call?.[1]?.method).toBe('GET');
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the request when the timeout elapses', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchWithTimeout('/api/slow', { timeoutMs: 50 });
    const rejection = expect(pending).rejects.toThrow(/abort/i);

    await vi.advanceTimersByTimeAsync(50);
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
