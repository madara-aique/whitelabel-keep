import type { Metadata } from 'next';
import { LoginForm } from '@/components/admin/login-form';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui';

/**
 * Operator sign-in.
 *
 * A Server Component shell around a Client Component form: this page
 * lives outside the `(protected)` route group, so it stays reachable
 * while signed out.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Sign in' };

export default function AdminLoginPage() {
  return (
    <div className="mx-auto w-full max-w-md py-6">
      <Card>
        <CardHeader>
          <CardTitle>Operator sign-in</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-6 text-sm text-kiosk-muted">
            Sign in to manage lockers, clear doors that customers left behind, and reset pickup PINs.
          </p>
          <LoginForm />
        </CardBody>
      </Card>
    </div>
  );
}
