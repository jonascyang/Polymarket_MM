import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(workspaceRoot, relativePath), "utf8");
}

describe("server deployment assets", () => {
  test("includes a systemd shadow service that runs the shadow runtime from an env-defined workdir", () => {
    const service = readWorkspaceFile("ops/systemd/predictfun-mm-shadow.service");

    expect(service).toContain("Description=Predict.fun MM shadow runtime");
    expect(service).toContain("EnvironmentFile=/etc/predictfun-mm/predictfun-mm.env");
    expect(service).toContain(
      "ExecStart=/usr/bin/env bash -lc 'cd \"$PREDICT_MM_WORKDIR\" && npm run shadow'"
    );
    expect(service).toContain("Restart=always");
    expect(service).toContain("KillSignal=SIGINT");
  });

  test("includes a systemd batch service and timer for recurring research runs", () => {
    const service = readWorkspaceFile("ops/systemd/predictfun-mm-batch.service");
    const timer = readWorkspaceFile("ops/systemd/predictfun-mm-batch.timer");

    expect(service).toContain("Description=Predict.fun MM research batch run");
    expect(service).toContain(
      "ExecStart=/usr/bin/env bash -lc 'cd \"$PREDICT_MM_WORKDIR\" && npm run batch -- --first=100 --report-json'"
    );
    expect(timer).toContain("Description=Run Predict.fun MM research batch hourly");
    expect(timer).toContain("OnCalendar=hourly");
    expect(timer).toContain("Persistent=true");
  });

  test("documents the server soak workflow in the README", () => {
    const readme = readWorkspaceFile("README.md");

    expect(readme).toContain("## Server operation");
    expect(readme).toContain("ops/systemd/predictfun-mm-shadow.service");
    expect(readme).toContain("ops/systemd/predictfun-mm-batch.timer");
    expect(readme).toContain("/etc/predictfun-mm/predictfun-mm.env");
    expect(readme).toContain("npm install");
    expect(readme).toContain("systemctl enable --now predictfun-mm-shadow.service");
    expect(readme).toContain("PREDICT_API_BASE_URL=https://api.predict.fun/v1");
  });
});
