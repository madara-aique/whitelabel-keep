import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="kiosk-shell flex min-h-screen flex-col items-center justify-center text-center">
      <h1 className="kiosk-heading">Screen not found</h1>
      <p className="kiosk-label mt-3 max-w-md">
        The screen you were looking for is not part of this kiosk.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex min-h-touch items-center justify-center rounded-2xl bg-brand-600 px-10 text-lg font-semibold text-white"
      >
        Back to the start
      </Link>
    </main>
  );
}
