import { test } from "node:test";
import assert from "node:assert/strict";
import { runPlaybook, type ReconHit, type Attempt } from "./phase-a.ts";
import { classifyProof } from "./observed-red.ts";
import type { Scanner } from "./catalog.ts";

const scanner = (name: string): Scanner => ({ name, class: "x", gives: "y", playbook: "z.md" });
const SIX = ["deimos", "security-bounty-hunter", "sast-scan", "secret-scan", "mcp-scan", "vuln-triage"].map(scanner);

const hit = (surface: string, s: string): ReconHit => ({ surface, scanner: s });
const attempt = (h: ReconHit, claimed: boolean, runnable: boolean): Attempt => ({
  hit: h,
  technique: "sqli",
  claimed,
  runnable,
});

test("оркестрация гонит все 6 сканеров в порядке каталога, deimos первым", () => {
  const r = runPlaybook(SIX, () => [], () => attempt(hit("_", "_"), false, false), () => classifyProof(1, 0));
  assert.deepEqual(r.scannersRun, SIX.map((s) => s.name));
  assert.equal(r.scannersRun[0], "deimos");
});

test("proven RED->GREEN -> находка, exit 0", () => {
  const recon = (s: Scanner) => (s.name === "sast-scan" ? [hit("web/app.js", s.name)] : []);
  const exploit = (h: ReconHit) => attempt(h, true, true);
  const prove = () => classifyProof(1, 0); // red до фикса, green после
  const r = runPlaybook(SIX, recon, exploit, prove);
  assert.equal(r.exitCode, 0);
  assert.equal(r.findings.length, 1);
  assert.equal(r.rejected.length, 0);
});

test("незапускаемый claim -> отклонён как теория, exit 1 (LIM-09)", () => {
  const recon = (s: Scanner) => (s.name === "deimos" ? [hit("эндпойнт", s.name)] : []);
  const exploit = (h: ReconHit) => attempt(h, true, false); // claim без исполнимого эксплойта
  const r = runPlaybook(SIX, recon, exploit, () => classifyProof(1, 0));
  assert.equal(r.exitCode, 1);
  assert.equal(r.findings.length, 0);
  assert.ok(r.rejected[0].reason.includes("теория"));
});

test("полый тест (зелёный до фикса) -> отклонён как театр, exit 1 (LIM-08)", () => {
  const recon = (s: Scanner) => (s.name === "deimos" ? [hit("x", s.name)] : []);
  const exploit = (h: ReconHit) => attempt(h, true, true);
  const prove = () => classifyProof(0, 0); // green до фикса = полый
  const r = runPlaybook(SIX, recon, exploit, prove);
  assert.equal(r.exitCode, 1);
  assert.ok(r.rejected[0].reason.includes("полый"));
});

test("фикс не закрыл дыру -> отклонён, дыра открыта, exit 1", () => {
  const recon = (s: Scanner) => (s.name === "deimos" ? [hit("x", s.name)] : []);
  const exploit = (h: ReconHit) => attempt(h, true, true);
  const prove = () => classifyProof(1, 1); // красный до и после
  const r = runPlaybook(SIX, recon, exploit, prove);
  assert.equal(r.exitCode, 1);
  assert.ok(r.rejected[0].reason.includes("не закрыл"));
});

test("незаявленная попытка -> честный сброс, кампания зелёная без находок", () => {
  const recon = (s: Scanner) => (s.name === "secret-scan" ? [hit("файл", s.name)] : []);
  const exploit = (h: ReconHit) => attempt(h, false, false); // recon поднял, но не воспроизвелось
  const r = runPlaybook(SIX, recon, exploit, () => classifyProof(1, 0));
  assert.equal(r.exitCode, 0);
  assert.equal(r.findings.length, 0);
  assert.equal(r.dropped.length, 1);
  assert.equal(r.rejected.length, 0);
});

test("подделанный proof {kind:proven, preCode:0} НЕ проходит - вердикт из кодов (codex #3)", () => {
  const recon = (s: Scanner) => (s.name === "deimos" ? [hit("x", s.name)] : []);
  const exploit = (h: ReconHit) => attempt(h, true, true);
  // Лживый proof: kind говорит proven, но коды - полый тест (preCode 0). Гейт обязан пере-вывести из кодов.
  const forged = () => ({ real: true, kind: "proven" as const, preCode: 0, postCode: 1, reason: "fake" });
  const r = runPlaybook(SIX, recon, exploit, forged);
  assert.equal(r.exitCode, 1);
  assert.equal(r.findings.length, 0);
  assert.ok(r.rejected[0].reason.includes("полый"));
});
