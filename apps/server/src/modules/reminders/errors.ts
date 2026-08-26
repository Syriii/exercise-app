export type ReminderErrorCode = "invalid_reminder_input" | "reminder_revision_conflict";

export class ReminderError extends Error {
  public constructor(
    public readonly code: ReminderErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
