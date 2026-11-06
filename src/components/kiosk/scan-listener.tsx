'use client';

import { useRouter } from 'next/navigation';
import { useScanCode } from '@/hooks/use-scan-code';

/**
 * Listens for the operator barcode on the customer-facing screens.
 *
 * The scan code comes from the server-rendered configuration, never
 * from a public environment variable.
 */
export function ScanListener({
  adminScanCode,
  destination = '/admin',
}: {
  adminScanCode: string;
  destination?: string;
}) {
  const router = useRouter();

  useScanCode({
    onScan: (code) => {
      if (code === adminScanCode) router.push(destination);
    },
  });

  return null;
}
