import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPinned, sha256File, REQUIRED_VENDOR, type Pinned } from "./doctor.ts";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "arez-doctor-"));
  mkdirSync(join(root, "vendor"), { recursive: true });
  writeFileSync(join(root, "vendor", "x.ts"), "export const a = 1;\n");
  return root;
}

const REQ = ["vendor/x.ts"]; // синтетический обязательный набор для юнит-фикстур

test("зелёный, когда байты совпали с пином", () => {
  const root = fixture();
  const sha = sha256File(join(root, "vendor", "x.ts"));
  const pinned: Pinned = { source_commit: "abc", pinned_at: "2026-09-03", files: [{ path: "vendor/x.ts", sha256: sha }] };
  assert.equal(checkPinned(root, pinned, REQ).ok, true);
  rmSync(root, { recursive: true, force: true });
});

test("RED на подменённом байте", () => {
  const root = fixture();
  const pinned: Pinned = { source_commit: "abc", pinned_at: "2026-09-03", files: [{ path: "vendor/x.ts", sha256: "deadbeef" }] };
  const r = checkPinned(root, pinned, REQ);
  assert.equal(r.ok, false);
  assert.equal(r.drift[0].path, "vendor/x.ts");
  rmSync(root, { recursive: true, force: true });
});

test("RED на пропавшем вендоренном файле - actual null", () => {
  const root = fixture();
  const pinned: Pinned = { source_commit: "abc", pinned_at: "2026-09-03", files: [{ path: "vendor/gone.ts", sha256: "x" }] };
  const r = checkPinned(root, pinned, ["vendor/gone.ts"]);
  assert.equal(r.ok, false);
  assert.equal(r.drift[0].actual, null);
  rmSync(root, { recursive: true, force: true });
});

test("пустой пин НЕ зелёный при непустом обязательном наборе (codex #12)", () => {
  const root = fixture();
  const pinned: Pinned = { source_commit: "abc", pinned_at: "2026-09-03", files: [] };
  const r = checkPinned(root, pinned, REQ);
  assert.equal(r.ok, false);
  assert.equal(r.drift[0].expected, "ОТСУТСТВУЕТ В ПИНЕ");
  rmSync(root, { recursive: true, force: true });
});

test("дубль пути в пине - RED (пин обязан быть однозначен)", () => {
  const root = fixture();
  const sha = sha256File(join(root, "vendor", "x.ts"));
  const pinned: Pinned = { source_commit: "abc", pinned_at: "2026-09-03", files: [{ path: "vendor/x.ts", sha256: sha }, { path: "vendor/x.ts", sha256: sha }] };
  const r = checkPinned(root, pinned, REQ);
  assert.equal(r.ok, false);
  assert.ok(r.drift.some((d) => d.expected === "ДУБЛЬ В ПИНЕ"));
  rmSync(root, { recursive: true, force: true });
});

test("реальный обязательный набор доктора - ровно 5 примитивов ядра", () => {
  assert.equal(REQUIRED_VENDOR.length, 5);
  assert.ok(REQUIRED_VENDOR.every((p) => p.startsWith("vendor/olympuz/src/")));
});

test("реальный PINNED.json проекта совпадает с вендоренными байтами (гард живого дома)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const repo = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const pinned: Pinned = JSON.parse(readFileSync(join(repo, "vendor/olympuz/PINNED.json"), "utf8"));
  assert.ok(pinned.files.length >= 5, "пять примитивов ядра запинены");
  assert.equal(checkPinned(repo, pinned).ok, true);
});
