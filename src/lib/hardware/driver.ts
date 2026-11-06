/**
 * Device-level hardware abstraction.
 *
 * A driver only moves notes and locks. All accounting — what counts as
 * the right denomination, when a session is paid up — lives in
 * `BillSession`, so every driver behaves identically from the UI's
 * point of view.
 */
export interface HardwareDriver {
  /** Short identifier surfaced in diagnostics. */
  readonly kind: string;

  connect(): Promise<void>;
  dispose(): Promise<void>;
  isConnected(): boolean;

  /**
   * Ask the device to start reading notes. `onNote` is called once per
   * note the customer feeds, with its face value.
   */
  startNoteIntake(onNote: (denomination: number) => void): Promise<void>;

  /** Stop reading notes and release the mechanism. */
  stopNoteIntake(): Promise<void>;

  /** Hand a note back to the customer (used when we cannot give change). */
  returnNote(): Promise<void>;

  /** Keep the note currently held. */
  keepNote(): Promise<void>;

  /** Energise the lock on each of the given doors. */
  openDoors(doorNumbers: string[]): Promise<void>;

  /**
   * Mock/emulator drivers only: pretend the customer fed a note, so the
   * full payment flow can be exercised without hardware attached.
   */
  feedNote?(denomination: number): Promise<void>;
}

export class HardwareDriverError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HardwareDriverError';
    this.code = code;
  }
}
