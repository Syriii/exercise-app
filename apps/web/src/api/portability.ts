import { apiRequest } from "./client";

export interface PortabilityTask { id: string; type: "data_export" | "account_deletion"; status: "pending" | "running" | "succeeded" | "failed" | "cancelled"; lastErrorCode: string | null; downloadAvailable: boolean; expiresAt: string | null; createdAt: string; updatedAt: string; completedAt: string | null; }

export const portabilityApi = {
  listTasks: () => apiRequest<PortabilityTask[]>("/api/v1/portability/tasks"),
  requestExport: () => apiRequest<PortabilityTask>("/api/v1/portability/exports", { method: "POST" }),
  downloadUrl: (taskId: string) => `/api/v1/portability/exports/${taskId}/download`,
  requestAccountDeletion: (confirmationUsername: string, password: string) => apiRequest<PortabilityTask>("/api/v1/portability/account-deletion", { method: "POST", body: JSON.stringify({ confirmationUsername, password }) }),
};
