import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';

/**
 * Authorisation guard for every operator screen.
 *
 * The route group keeps `/admin/login` outside this layout: a layout
 * cannot read the current pathname, so "redirect unless you are already
 * on the sign-in page" is expressed by the file tree rather than by a
 * condition. Anything that renders under `(protected)` has a session by
 * the time its page runs.
 */
export const dynamic = 'force-dynamic';

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/admin/login');

  return <>{children}</>;
}
