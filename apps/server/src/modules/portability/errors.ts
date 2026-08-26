export type PortabilityErrorCode = "portability_task_not_found" | "export_not_ready" | "account_confirmation_mismatch" | "account_deletion_not_allowed";

export class PortabilityError extends Error {
  public constructor(public readonly code: PortabilityErrorCode, message: string, public readonly statusCode: number) { super(message); }
}
