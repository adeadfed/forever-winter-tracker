import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
execFileSync("python3", [path.join(root, "scripts", "test_scraper.py")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
});

await import("./build-standalone.mjs");
await import("./validate.mjs");
await import("./runtime-smoke.mjs");
