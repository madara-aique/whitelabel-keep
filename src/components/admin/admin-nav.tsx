'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Operator section navigation.
 *
 * A Client Component only because the active section is derived from the
 * current pathname; the label set itself is static and generic.
 */
const SECTIONS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/rebook', label: 'Rebook' },
  { href: '/admin/forgot-pin', label: 'Forgot PIN' },
  { href: '/admin/clear', label: 'Clear doors' },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Operator sections" className="border-t border-kiosk-border">
      <ul className="mx-auto flex w-full max-w-5xl flex-wrap gap-2 px-4 py-3">
        {SECTIONS.map((section) => {
          // `/admin` must not light up for every child route.
          const active =
            section.href === '/admin'
              ? pathname === '/admin'
              : pathname === section.href || pathname.startsWith(`${section.href}/`);

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-touch items-center rounded-2xl px-4 text-base font-medium transition',
                  active
                    ? 'bg-brand-600 text-white'
                    : 'text-kiosk-muted hover:bg-kiosk-bg hover:text-slate-100',
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
