export type TrainingSuggestionErrorCode =
  | "training_suggestion_not_found"
  | "training_suggestion_revision_conflict"
  | "invalid_training_suggestion_input";

export class TrainingSuggestionError extends Error {
  public constructor(
    public readonly code: TrainingSuggestionErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "TrainingSuggestionError";
  }
}
