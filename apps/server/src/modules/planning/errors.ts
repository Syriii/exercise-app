export type PlanningErrorCode =
  | "invalid_planning_input"
  | "planning_revision_conflict"
  | "measurement_not_found";

export class PlanningError extends Error {
  public constructor(
    public readonly code: PlanningErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
