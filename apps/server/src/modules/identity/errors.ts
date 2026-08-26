export type IdentityErrorCode =
  | "invalid_username"
  | "weak_password"
  | "registration_closed"
  | "username_taken"
  | "account_limit_reached"
  | "invalid_credentials"
  | "invalid_current_password"
  | "account_disabled"
  | "authentication_required"
  | "admin_required"
  | "account_not_found"
  | "admin_username_conflict"
  | "cannot_disable_self"
  | "cannot_reset_self"
  | "cannot_delete_admin"
  | "invalid_origin";

export class IdentityError extends Error {
  public readonly statusCode: number;
  public readonly code: IdentityErrorCode;

  public constructor(code: IdentityErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
