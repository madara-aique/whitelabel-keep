import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { getKioskConfig } from '@/lib/config/kiosk-config';
import { KioskProvider } from '@/context/kiosk-provider';
import { ToastProvider } from '@/context/toast-provider';
import { HardwareProvider } from '@/context/hardware-provider';

/**
 * Root layout (Server Component).
 *
 * Reads the site configuration once per request and hands the
 * serializable subset to the client providers, so no branding, price or
 * endpoint is baked into the bundle.
 */
const poppins = localFont({
  src: [
    { path: '../assets/fonts/poppins/Poppins-Light.ttf', weight: '300', style: 'normal' },
    { path: '../assets/fonts/poppins/Poppins-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../assets/fonts/poppins/Poppins-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../assets/fonts/poppins/Poppins-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../assets/fonts/poppins/Poppins-Bold.ttf', weight: '700', style: 'normal' },
    { path: '../assets/fonts/poppins/Poppins-Black.ttf', weight: '900', style: 'normal' },
  ],
  variable: '--font-poppins',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const config = getKioskConfig();
  return {
    title: {
      default: config.appName,
      template: `%s · ${config.appName}`,
    },
    description: `Self-service locker payment kiosk operated by ${config.operatorName}.`,
    applicationName: config.appName,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0b1220',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getKioskConfig();

  return (
    <html lang={config.locale} className={poppins.variable}>
      <body>
        <ToastProvider>
          <KioskProvider config={config}>
            <HardwareProvider config={config}>{children}</HardwareProvider>
          </KioskProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
