import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadCatalog } from "./catalog.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Живой каталог дома - зелёный со всеми инвариантами семьи.
test("реальный каталог arez валиден: сиденье ares, claude/top, daimons:[], 6 сканеров", () => {
  const r = loadCatalog(ROOT);
  assert.equal(r.ok, true, `проблемы: ${r.problems.join("; ")}`);
  assert.equal(r.catalog!.skills.scanners.length, 6);
  assert.equal(r.catalog!.models.daimons.length, 0);
  assert.ok(r.catalog!.skills.scanners.some((s) => s.name === "deimoz"));
});

// Помощник: собрать временный каталог из объектов и провалидировать без проверки плейбуков на диске.
function withCatalog(models: unknown, skills: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "arez-cat-"));
  mkdirSync(join(dir, "catalog"));
  writeFileSync(join(dir, "catalog/models.json"), JSON.stringify(models));
  writeFileSync(join(dir, "catalog/skills.json"), JSON.stringify(skills));
  try {
    return loadCatalog(dir, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const goodModels = { seat: "ares", provider: "claude", minTier: "top", daimons: [], tiers: {} };
const sc = (name: string) => ({ name, class: "x", gives: "y", playbook: "z.md" });
const goodSkills = { scanners: ["deimoz", "a", "b", "c", "d", "e"].map(sc) };

test("daimons не пуст - RED (LIM-01: Арес лист)", () => {
  const r = withCatalog({ ...goodModels, daimons: ["scout"] }, goodSkills);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("daimons")));
});

test("minTier ниже top - RED (вниз по силе Ареса не сдвигают)", () => {
  const r = withCatalog({ ...goodModels, minTier: "default" }, goodSkills);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("minTier")));
});

test("не 6 сканеров - RED (REQ-19)", () => {
  const r = withCatalog(goodModels, { scanners: ["deimoz", "a", "b"].map(sc) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("сканеров")));
});

test("нет оркестратора deimoz - RED (REQ-28)", () => {
  const r = withCatalog(goodModels, { scanners: ["a", "b", "c", "d", "e", "f"].map(sc) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("deimoz")));
});

test("провайдер не claude - RED", () => {
  const r = withCatalog({ ...goodModels, provider: "kimi" }, goodSkills);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("провайдер")));
});

test("models.json = null (JSON) - RED, не проскакивает мимо проверок (codex #13)", () => {
  const r = withCatalog(null, goodSkills);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("не объект")));
});

test("плейбук вне санкционированного каталога (.md-файл) - RED (codex #14)", () => {
  const dir = mkdtempSync(join(tmpdir(), "arez-cat-pb-"));
  mkdirSync(join(dir, "catalog"));
  writeFileSync(join(dir, "catalog/models.json"), JSON.stringify(goodModels));
  // playbook="." (каталог) раньше проходил existsSync; теперь нужен обычный .md в vendor/porting-src/skills/
  const bad = { scanners: ["deimoz", "a", "b", "c", "d", "e"].map((n) => ({ name: n, class: "x", gives: "y", playbook: "." })) };
  writeFileSync(join(dir, "catalog/skills.json"), JSON.stringify(bad));
  try {
    const r = loadCatalog(dir, true); // playbookMustExist
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes("не валидный .md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
