#!/usr/bin/env node
// arez CLI. Ponytail: одна точка входа, подкоманд ровно столько, сколько несёт цель - doctor, catalog, gate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { checkPinned, type Pinned } from "../src/doctor.ts";
import { loadCatalog } from "../src/catalog.ts";
import { runAcceptance } from "../src/acceptance.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// doctor - гард дрейфа вендоренного ядра (REQ-41). Exit 0 цело, 1 дрейф.
function doctor(): number {
  const pinned: Pinned = JSON.parse(readFileSync(join(ROOT, "vendor/olympuz/PINNED.json"), "utf8"));
  const r = checkPinned(ROOT, pinned);
  if (r.ok) {
    console.log(`doctor: вендоренное ядро цело (${pinned.files.length} примитивов, пин ${pinned.source_commit.slice(0, 12)})`);
    return 0;
  }
  console.error("doctor: ДРЕЙФ вендоренного ядра - байты разошлись с пином:");
  for (const d of r.drift) {
    console.error(`  ${d.path}: ждали ${d.expected.slice(0, 12)}, на диске ${d.actual ? d.actual.slice(0, 12) : "ФАЙЛА НЕТ"}`);
  }
  console.error("Починка: разовый ручной `arez vendor` - репин с диффом из достижимого источника.");
  return 1;
}

// catalog - инварианты сиденья Ареса: claude/top, daimons:[], 6 сканеров (REQ-19/REQ-26). Exit 0/1.
function catalog(): number {
  const r = loadCatalog(ROOT);
  if (r.ok) {
    const s = r.catalog!.skills.scanners;
    console.log(`catalog: сиденье ${r.catalog!.models.seat}, провайдер ${r.catalog!.models.provider}/${r.catalog!.models.minTier}, daimons:[], ${s.length} сканеров`);
    for (const sc of s) console.log(`  · ${sc.name} (${sc.class})`);
    return 0;
  }
  console.error("catalog: КРАСНЫЙ - инвариант сиденья нарушен:");
  for (const p of r.problems) console.error(`  ${p}`);
  return 1;
}

// gate - полная приёмка: node --test (0 fail, 0 skip - REQ-07) + catalog + doctor + сценарий A-D (REQ-08).
function gate(): number {
  // node --test отдельным процессом - координатор судит exit-код вне досягаемости агента (REQ-09).
  // TAP-репортер даёт машинные строки "# pass/# fail/# skipped N" - без него спек-репортер печатает "ℹ pass"
  // и парс skip молча вернул бы 0, а REQ-07 требует ДОКАЗАННЫЙ ноль пропущенных.
  const t = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "src/**/*.test.ts"], { cwd: ROOT, encoding: "utf8" });
  const out = (t.stdout || "") + (t.stderr || "");
  // Якорим к началу строки и берём ПОСЛЕДНЕЕ совпадение - итоговую сводку TAP. Иначе тест, печатающий
  // "# skipped 0" в свой лог, заспуфил бы ноль (находка codex #11). Нет сводки -> skip=1 (fail-closed).
  const lastMatch = (re: RegExp) => { const m = [...out.matchAll(re)].pop(); return m ? m[1] : undefined; };
  const skipped = Number(lastMatch(/^# skipped (\d+)/gm) ?? "1");
  if (t.status !== 0) {
    console.error("gate: node --test КРАСНЫЙ");
    console.error(out.split("\n").filter((l) => /^not ok|^# fail|Error/.test(l)).slice(0, 20).join("\n"));
    return 1;
  }
  if (skipped !== 0) {
    console.error(`gate: ${skipped} пропущенных тестов - REQ-07 требует ноль skip`);
    return 1;
  }
  const passed = Number(lastMatch(/^# pass (\d+)/gm) ?? "?");
  console.log(`gate: node --test зелёный (${passed} проб, 0 fail, 0 skip)`);

  if (catalog() !== 0) return 1;
  if (doctor() !== 0) return 1;

  const acc = runAcceptance(ROOT);
  for (const c of acc.checks) console.log(`  фаза ${c.phase}: ${c.ok ? "✓" : "✗"} ${c.detail}`);
  if (!acc.ok) {
    console.error("gate: приёмочный сценарий Деймоса A-D КРАСНЫЙ");
    return 1;
  }
  console.log("gate: ✓ зелёный - фазы A-D, каталог и doctor сошлись");
  return 0;
}

const cmds: Record<string, () => number> = { doctor, catalog, gate };
// --selftest / --self-check - тот же полный гейт под флагом, который ищет isolated-run чужой машины:
// доказательство, что дерево работает у постороннего, а не только на диске владельца.
const SELFTEST_FLAGS = new Set(["--selftest", "--self-test", "--selfcheck", "--self-check", "selftest"]);
const cmd = process.argv[2];
if (cmd && SELFTEST_FLAGS.has(cmd)) process.exit(gate());
if (!cmd || !cmds[cmd]) {
  console.error(`arez: подкоманды - ${Object.keys(cmds).join(", ")} (или --selftest)`);
  process.exit(2);
}
process.exit(cmds[cmd]());
