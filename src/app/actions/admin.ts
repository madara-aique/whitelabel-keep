'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/app/actions/_result';
import { requireSessionUser, signOut } from '@/lib/auth';
import { openAllDoors } from '@/lib/locker-controller';
import { changePinSchema } from '@/lib/schemas/booking';
import {
  ServiceError,
  changeDoorPin,
  clearDoor,
  listOccupiedDoors,
  rebookDoor,
} from '@/lib/services/booking-service';

/**
 * Operator Server Actions.
 *
 * Every action authenticates before it touches a door. The helper that
 * wraps them turns the "not signed in" error into a `401` result, so an
 * unauthenticated call fails cleanly instead of throwing.
 */

/** Operator pages that render door or booking state. */
const ADMIN_VIEWS = ['/admin', '/admin/doors', '/admin/transactions'] as const;

function revalidateAdminViews(): void {
  for (const path of ADMIN_VIEWS) revalidatePath(path);
}

/** Empty and archive a door a customer left behind. */
export async function clearDoorAction(
  doorNumber: string,
): Promise<ActionResult<{ doorNumber: string }>> {
  return runAction('admin.clearDoor', async () => {
    const user = await requireSessionUser();
    await clearDoor(doorNumber, user.email);
    revalidateAdminViews();
    return { doorNumber };
  });
}

/** Put a closed door back into service without a new payment. */
export async function rebookDoorAction(
  doorNumber: string,
): Promise<ActionResult<{ doorNumber: string }>> {
  return runAction('admin.rebookDoor', async () => {
    const user = await requireSessionUser();
    await rebookDoor(doorNumber, user.email);
    revalidateAdminViews();
    return { doorNumber };
  });
}

/** Set a new customer PIN on a door. */
export async function changeDoorPinAction(
  doorNumber: string,
  pin: string,
): Promise<ActionResult<{ doorNumber: string }>> {
  return runAction('admin.changeDoorPin', async () => {
    const user = await requireSessionUser();
    const parsed = changePinSchema.parse({ doorNumber, pin });
    await changeDoorPin(parsed.doorNumber, parsed.pin, user.email);
    revalidateAdminViews();
    return { doorNumber: parsed.doorNumber };
  });
}

/**
 * Emergency sweep: energise every lock, then empty each occupied door.
 *
 * The controller call is a single bulk command, but clearing is done
 * per door so one stubborn door cannot abort the rest of the sweep —
 * the caller gets a per-door failure report instead.
 */
export async function openAllAndClearAction(): Promise<
  ActionResult<{ cleared: number; failed: { doorNumber: string; error: string }[] }>
> {
  return runAction('admin.openAllAndClear', async () => {
    const user = await requireSessionUser();

    const opened = await openAllDoors();
    if (!opened.ok) {
      throw new ServiceError(
        opened.error ?? 'Locker controller is unreachable',
        502,
        'CONTROLLER_UNAVAILABLE',
      );
    }

    const occupied = await listOccupiedDoors();
    const failed: { doorNumber: string; error: string }[] = [];
    let cleared = 0;

    for (const door of occupied) {
      try {
        await clearDoor(door.doorNumber, user.email);
        cleared += 1;
      } catch (error) {
        failed.push({
          doorNumber: door.doorNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    revalidateAdminViews();
    return { cleared, failed };
  });
}

/** End the operator session and return to the sign-in page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/admin/login' });
}
