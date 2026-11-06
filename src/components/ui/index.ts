/**
 * Touch-first UI kit.
 *
 * Interactive primitives (Button, Modal, PinDisplay, Keypad, Toast) carry
 * their own `'use client'` boundary; layout primitives stay
 * server-compatible. Pages should import from this barrel so a kit change
 * lands everywhere at once.
 */

export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from '@/components/ui/button';
export {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  CardFooter,
  type CardProps,
  type CardHeaderProps,
  type CardTitleProps,
  type CardBodyProps,
  type CardFooterProps,
} from '@/components/ui/card';
export { Alert, type AlertProps, type AlertTone } from '@/components/ui/alert';
export {
  Spinner,
  SpinnerOverlay,
  type SpinnerProps,
  type SpinnerOverlayProps,
  type SpinnerSize,
} from '@/components/ui/spinner';
export { Modal, type ModalProps } from '@/components/ui/modal';
export { PinDisplay, type PinDisplayProps } from '@/components/ui/pin-display';
export { Keypad, type KeypadProps } from '@/components/ui/keypad';
export { Money, type MoneyProps, type MoneySize } from '@/components/ui/money';
export {
  Toast,
  ToastViewport,
  type ToastProps,
  type ToastViewportProps,
  type ToastMessage,
  type ToastTone,
} from '@/components/ui/toast';
