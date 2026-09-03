import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProof, witnessRedGreen, runTest } from "./observed-red.ts";

test("полый тест (зелёный до фикса) отвергается", () => {
  const p = classifyProof(0, 0);
  assert.equal(p.real, false);
  assert.equal(p.kind, "hollow");
});

test("полый отвергается, даже если остаётся зелёным после - театр в обе стороны", () => {
  assert.equal(classifyProof(0, 1).kind, "hollow");
});

test("невалидный код (NaN/undefined/Infinity) НЕ доказывает RED -> infra-failed (codex #1)", () => {
  assert.equal(classifyProof(NaN, 0).kind, "infra-failed");
  assert.equal(classifyProof(NaN, 0).real, false);
  assert.equal(classifyProof(undefined as unknown as number, 0).kind, "infra-failed");
  assert.equal(classifyProof(Infinity, 0).kind, "infra-failed");
  assert.equal(classifyProof(1.5, 0).kind, "infra-failed"); // дробный код тоже невалиден
});

test("до-фиксный тест, УБИТЫЙ сигналом -> infra-failed, не proven (codex #2)", () => {
  // before убит сигналом (ненулевой code от смерти, не от пойманной дыры), after зелёный
  const run = (state: "before" | "after") =>
    state === "before" ? { code: 1, signal: "SIGTERM" } : { code: 0 };
  const p = witnessRedGreen(run);
  assert.equal(p.real, false);
  assert.equal(p.kind, "infra-failed");
});

test("runTest несёт сигнал наверх - живой убитый процесс", () => {
  const r = runTest("kill -TERM $$", process.cwd());
  assert.ok(r.signal, "сигнал пойман");
});

test("RED->GREEN - реальное доказательство", () => {
  const p = classifyProof(1, 0);
  assert.equal(p.real, true);
  assert.equal(p.kind, "proven");
});

test("фикс, оставивший тест красным, - не доказательство", () => {
  const p = classifyProof(1, 1);
  assert.equal(p.real, false);
  assert.equal(p.kind, "fix-failed");
});

test("witnessRedGreen гонит оба состояния через инъектированный раннер", () => {
  const seq: Record<string, number> = { before: 7, after: 0 };
  const p = witnessRedGreen((s) => ({ code: seq[s] }));
  assert.equal(p.real, true);
  assert.equal(p.kind, "proven");
});

test("witnessRedGreen ловит полый тест по наблюдению, а не по отчёту", () => {
  const p = witnessRedGreen(() => ({ code: 0 }));
  assert.equal(p.real, false);
  assert.equal(p.kind, "hollow");
});

test("runTest наблюдает настоящий exit-код", () => {
  assert.equal(runTest("exit 3", process.cwd()).code, 3);
  assert.equal(runTest("true", process.cwd()).code, 0);
});
