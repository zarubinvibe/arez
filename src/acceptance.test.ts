import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { runAcceptance } from "./acceptance.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("приёмочный сценарий Деймоса: все фазы A-D зелены на реальном каталоге дома (REQ-08)", () => {
  const r = runAcceptance(ROOT);
  const broken = r.checks.filter((c) => !c.ok).map((c) => `${c.phase}: ${c.detail}`);
  assert.equal(r.ok, true, `сломанные фазы: ${broken.join(" | ")}`);
  assert.deepEqual(r.checks.map((c) => c.phase), ["A", "B", "C", "D"]);
});
