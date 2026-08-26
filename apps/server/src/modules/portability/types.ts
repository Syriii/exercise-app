export type PortabilityTaskType = "data_export" | "account_deletion";
export type PortabilityTaskStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface PortabilityTask {
  readonly id: string;
  readonly type: PortabilityTaskType;
  readonly status: PortabilityTaskStatus;
  readonly lastErrorCode: string | null;
  readonly downloadAvailable: boolean;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export interface PortabilityWorkItem extends PortabilityTask {
  readonly userId: string;
  readonly subjectId: string | null;
}

export interface ExportDownload {
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface UserExportEnvelope {
  readonly schemaVersion: "exercise-app-user-export-v1";
  readonly exportedAt: string;
  readonly account: Readonly<Record<string, unknown>>;
  readonly data: Readonly<Record<string, readonly unknown[]>>;
  readonly lifecycle: {
    readonly includesOriginalPhotos: false;
    readonly excludesCredentialsAndSessions: true;
    readonly temporaryMedia: readonly unknown[];
  };
}
