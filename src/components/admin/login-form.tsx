'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button } from '@/components/ui';

/**
 * Operator credentials form.
 *
 * The credentials provider is called directly from the client with
 * `redirect: false` so a rejected sign-in can be reported inline instead
 * of bouncing the operator through the provider's error page.
 */
const INPUT_CLASS =
  'min-h-touch w-full rounded-2xl border border-kiosk-border bg-kiosk-bg px-4 text-lg text-slate-100 transition placeholder:text-kiosk-muted focus:border-brand-400 focus:outline-none';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);

    try {
      const result = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (!result || result.error) {
        setError('Those credentials were not accepted. Check your email and password and try again.');
        return;
      }

      router.push('/admin');
      router.refresh();
    } catch {
      setError('Sign-in could not be completed. Check the connection to this kiosk and try again.');
    } finally {
      // The button must never stay stuck in its loading state.
      setBusy(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {error ? (
        <Alert tone="danger" title="Sign-in failed">
          {error}
        </Alert>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="operator-email" className="block text-sm font-medium text-kiosk-muted">
          Email
        </label>
        <input
          id="operator-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={INPUT_CLASS}
          placeholder="operator@example.com"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="operator-password" className="block text-sm font-medium text-kiosk-muted">
          Password
        </label>
        <input
          id="operator-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={INPUT_CLASS}
          placeholder="Your password"
        />
      </div>

      <Button type="submit" fullWidth loading={busy}>
        Sign in
      </Button>
    </form>
  );
}
