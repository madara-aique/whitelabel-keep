import type { HardwareDriver } from './driver';

/**
 * Development/emulator driver.
 *
 * Implements the full driver contract with no hardware attached, so the
 * kiosk can be demonstrated end to end. Notes are injected explicitly
 * through `feedNote()` — either from the kiosk UI's emulator controls or
 * from an automated test.
 */
export class MockHardwareDriver implements HardwareDriver {
  readonly kind = 'mock';

  private connected = false;
  private intake: ((denomination: number) => void) | null = null;
  private heldNote: number | null = null;
  private readonly openDoorLog: string[] = [];

  async connect(): Promise<void> {
    this.connected = true;
  }

  async dispose(): Promise<void> {
    this.connected = false;
    this.intake = null;
    this.heldNote = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async startNoteIntake(onNote: (denomination: number) => void): Promise<void> {
    this.intake = onNote;
  }

  async stopNoteIntake(): Promise<void> {
    this.intake = null;
    this.heldNote = null;
  }

  async returnNote(): Promise<void> {
    this.heldNote = null;
  }

  async keepNote(): Promise<void> {
    this.heldNote = null;
  }

  async openDoors(doorNumbers: string[]): Promise<void> {
    for (const doorNumber of doorNumbers) {
      this.openDoorLog.push(doorNumber);
    }
    if (this.openDoorLog.length > 500) {
      this.openDoorLog.splice(0, this.openDoorLog.length - 500);
    }
  }

  async feedNote(denomination: number): Promise<void> {
    this.heldNote = denomination;
    if (!this.intake) {
      this.heldNote = null;
      return;
    }
    this.intake(denomination);
  }

  /** Doors opened through this driver, for tests and diagnostics. */
  get openedDoors(): readonly string[] {
    return this.openDoorLog;
  }
}
