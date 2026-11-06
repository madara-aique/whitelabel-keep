import type { Metadata } from 'next';
import Link from 'next/link';
import { signOutAction } from '@/app/actions/admin';
import { AdminNav } from '@/components/admin/admin-nav';
import { getSessionUser } from '@/lib/auth';
import { getKioskConfig } from '@/lib/config/kiosk-config';

/**
 * Operator shell.
 *
 * This layout is deliberately *unguarded*: it also wraps `/admin/login`,
 * which has to stay reachable while nobody is signed in. The redirect
 * every operator screen sits behind lives in the `(protected)` route
 * group instead.
 *
 * The chrome itself is rendered only for a signed-in operator, so the
 * sign-in screen cannot advertise navigation to screens the visitor is
 * not allowed to open.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const config = getKioskConfig();

  return {
    title: {
      default: `${config.appName} operator console`,
      template: `%s · ${config.appName} operator console`,
    },
    robots: { index: false, follow: false },
  };
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  const config = getKioskConfig();

  return (
    <div className="min-h-full">
      <header className="border-b border-kiosk-border bg-kiosk-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <Link href={user ? '/admin' : '/admin/login'} className="block">
            <span className="block text-sm uppercase tracking-wide text-kiosk-muted">
              {config.operatorName}
            </span>
            <span className="block text-xl font-semibold text-white">{config.appName}</span>
          </Link>

          {user ? (
            <div className="flex items-center gap-4">
              <span className="max-w-[16rem] truncate text-sm text-kiosk-muted">{user.email}</span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="min-h-touch rounded-2xl border border-kiosk-border px-4 text-base font-medium text-slate-100 transition hover:bg-kiosk-bg"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>

        {user ? <AdminNav /> : null}
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
