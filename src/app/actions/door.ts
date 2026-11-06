'use server';

import { revalidatePath } from 'next/cache';
import { runAction, type ActionResult } from '@/app/actions/_result';
import { getKioskConfig } from '@/lib/config/kiosk-config';
import { serverEnv } from '@/lib/env';
import {
  getLocation as getControllerLocation,
  listDoors as listControllerDoors,
} from '@/lib/locker-controller';
import {
  ServiceError,
  listDoors,
  openOccupiedDoor,
  seedDoorsFromController,
} from '@/lib/services/booking-service';
import type { DoorView } from '@/types/domain';

/**
 * Door Server Actions.
 *
 * The kiosk screen reads doors on the server and calls these actions,
 * so the locker-controller address never reaches the browser and a
 * controller outage degrades to a failed result instead of a crash.
 */

/** Pages that render door state and must be refreshed. */
const DOOR_VIEWS = ['/', '/admin', '/admin/doors'] as const;

function revalidateDoorViews(): void {
  for (const path of DOOR_VIEWS) revalidatePath(path);
}

/** Customer: open a door they have the PIN for. */
export async function openOccupiedDoorAction(
  doorNumber: string,
  pin: string,
): Promise<ActionResult<{ openCount: number }>> {
  return runAction('door.openOccupied', async () => {
    const result = await openOccupiedDoor(doorNumber, pin);
    revalidateDoorViews();
    return result;
  });
}

/**
 * Reconcile the door table with the physical controller.
 *
 * The controller reports doors as an object keyed by door number; every
 * key that has no record yet is inserted. An unreachable controller is
 * reported as a failure rather than thrown.
 */
export async function syncDoorsAction(): Promise<ActionResult<{ added: number }>> {
  return runAction('door.sync', async () => {
    const [doorsResult, locationResult] = await Promise.all([
      listControllerDoors(),
      getControllerLocation(),
    ]);

    if (!doorsResult.ok) {
      throw new ServiceError(
        doorsResult.error ?? 'Locker controller is unreachable',
        502,
        'CONTROLLER_UNAVAILABLE',
      );
    }

    const controllerDoors = Object.keys(doorsResult.data?.data?.doors ?? {});

    // A missing location is not fatal: doors can still be seeded under
    // the operator's own name and corrected on the next successful sync.
    const reportedLocation = locationResult.ok ? (locationResult.data?.location ?? '').trim() : '';

    const added = await seedDoorsFromController(
      controllerDoors,
      reportedLocation || serverEnv.app.operatorName,
      getKioskConfig().promoActive ? 'PROMO' : '',
    );

    revalidateDoorViews();
    return { added };
  });
}

/** Every active door, without the customer PIN fields. */
export async function listDoorsAction(): Promise<ActionResult<DoorView[]>> {
  return runAction('door.list', async () => listDoors());
}
