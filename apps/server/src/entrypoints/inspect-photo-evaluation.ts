/** Read-only journal inspection; no credentials, model requests, writes or price recalculation. */
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { inspectPhotoEvaluationLog } from "../testing/photo-evaluation-inspection.js";

const [input, ...extra] = process.argv.slice(2);
if (!input || extra.length > 0 || !isAbsolute(input)) {
  console.error(JSON.stringify({ error: "inspection_requires_one_absolute_jsonl_path" }));
  process.exitCode = 1;
} else {
  try {
    const bytes = await readFile(input);
    console.log(JSON.stringify(inspectPhotoEvaluationLog(bytes), null, 2));
  } catch {
    // Never echo input contents, raw malformed records or filesystem error details.
    console.error(JSON.stringify({ error: "inspection_input_unreadable" }));
    process.exitCode = 1;
  }
}
