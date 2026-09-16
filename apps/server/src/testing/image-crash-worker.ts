// Only launched against an explicitly isolated database by the integration suite.
import { createDatabase } from "../db/database.js";
import { loadTestDatabaseUrl } from "./test-database-url.js";
import { PostgresImageAnalysisRepository } from "../modules/image-analysis/postgres-repository.js";

const database = createDatabase(loadTestDatabaseUrl());
const repository = new PostgresImageAnalysisRepository(database.database);
const taskId = process.env.TEST_IMAGE_ANALYSIS_ID;
if (!taskId) throw new Error("missing_test_analysis_id");
const attempt = await repository.beginAttempt(taskId);
if (typeof attempt === "string") throw new Error(attempt);
process.send?.({ type: "started", taskId });
// Model request never returns; parent kills this process after the database claim commits.
setInterval(() => undefined, 1000);
