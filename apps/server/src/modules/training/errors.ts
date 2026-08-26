export type TrainingErrorCode =
  | "training_template_not_found"
  | "training_session_not_found"
  | "training_session_item_not_found"
  | "training_program_not_found"
  | "training_program_unit_not_found"
  | "training_program_unit_started"
  | "training_schedule_not_found"
  | "training_schedule_unavailable"
  | "training_session_closed"
  | "training_session_in_progress"
  | "training_revision_conflict"
  | "invalid_training_input"
  | "invalid_time_zone";

export class TrainingError extends Error {
  public constructor(
    public readonly code: TrainingErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "TrainingError";
  }
}
