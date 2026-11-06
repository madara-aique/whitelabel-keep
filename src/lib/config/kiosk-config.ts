import { serverEnv } from '@/lib/env';
import { isWithinPromoWindow, type KioskConfig } from '@/types/domain';

/**
 * Build the serializable configuration a Client Component is allowed to
 * see. Resolved per request on the server, so changing the promo window
 * or door rate is an environment change, not a rebuild.
 */
export function getKioskConfig(now: Date = new Date()): KioskConfig {
  const promoActive = isWithinPromoWindow(
    now,
    serverEnv.promo.startDate,
    serverEnv.promo.endDate,
    serverEnv.promo.enabled,
  );

  return {
    appName: serverEnv.app.name,
    operatorName: serverEnv.app.operatorName,
    currencySymbol: serverEnv.app.currencySymbol,
    locale: serverEnv.app.locale,
    supportEmail: serverEnv.app.supportEmail,
    supportPhone: serverEnv.app.supportPhone,
    doorRate: serverEnv.kiosk.doorRate,
    effectiveRate: promoActive ? serverEnv.promo.rate : serverEnv.kiosk.doorRate,
    promoActive,
    promoRate: serverEnv.promo.rate,
    billAcceptorEnabled: serverEnv.kiosk.billAcceptorEnabled,
    eWalletEnabled: serverEnv.paymentGateway.enabled,
    idleTimeoutSeconds: serverEnv.kiosk.idleTimeoutSeconds,
    maxAliasLength: serverEnv.kiosk.maxAliasLength,
    pinLength: serverEnv.kiosk.pinLength,
    acceptedBills: serverEnv.kiosk.acceptedBills,
    hardwareEnabled: serverEnv.hardware.enabled,
    hardwareGatewayPort: serverEnv.hardware.socketPort,
  };
}

/** Format an amount for display using the currency symbol. */
export function formatAmount(amount: number): string {
  return `${serverEnv.app.currencySymbol} ${Number.isFinite(amount) ? amount.toLocaleString('en-US') : 0}`;
}

/**
 * PINs that are trivially guessable and therefore rejected when a
 * customer sets one.
 */
const COMMON_PINS = new Set([
  '123456',
  '654321',
  '111111',
  '222222',
  '333333',
  '444444',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',
  '000000',
  '567890',
  '098765',
]);

export function isCommonPin(pin: string): boolean {
  return COMMON_PINS.has(pin);
}
