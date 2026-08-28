import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

describe("container runtime secret boundary", () => {
  it("keeps host secrets private and drops privileges before starting application code", async () => {
    const [dockerfile, entrypoint, compose, preflight] = await Promise.all([
      readFile(resolve(repositoryRoot, "deployment/Dockerfile"), "utf8"),
      readFile(resolve(repositoryRoot, "deployment/container-entrypoint.sh"), "utf8"),
      readFile(resolve(repositoryRoot, "deployment/compose.yaml"), "utf8"),
      readFile(resolve(repositoryRoot, "deployment/scripts/preflight.sh"), "utf8"),
    ]);

    expect(dockerfile).toContain("COPY --from=build /usr/sbin/gosu /usr/local/bin/gosu");
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/exercise-app-entrypoint"]');
    expect(dockerfile).toContain('CMD ["node", "apps/server/dist/entrypoints/api.js"]');
    expect(entrypoint).toContain("/tmp/exercise-app-secrets");
    expect(entrypoint).toContain('chmod 0440 "$target_path"');
    expect(entrypoint).toContain('exec /usr/local/bin/gosu node:node "$@"');
    expect(entrypoint).not.toContain("printf '%s' \"$source_path\"");
    expect(compose).toContain('command: ["node", "apps/server/dist/entrypoints/setup.js"]');
    expect(compose).toContain('command: ["node", "apps/server/dist/entrypoints/worker.js"]');
    expect(compose).toContain("cap_add:\n    - CHOWN\n    - SETGID\n    - SETUID\n  cap_drop:\n    - ALL");
    expect(compose).toContain("no-new-privileges:true");
    expect(preflight).toContain('[ ! -L "$file_path" ]');
  });
});
