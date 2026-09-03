// arez doctor — гард дрейфа вендоренного ядра (REQ-41, ратифицировано владельцем 03.09).
//
// Сверяет sha256 каждого вендоренного примитива olympuz против vendor/olympuz/PINNED.json.
// Потолок назван честно: на чистой машине чужого разработчика апстрим olympuz недостижим
// (личный путь ломает REQ-05/REQ-23, сеть закрыта REQ-12), поэтому doctor ловит ЛОКАЛЬНУЮ
// подмену байт; дрейф апстрима ловит только разовый ручной `arez vendor` - репин с диффом.
// Расхождение = RED: инструмент никогда молча не доверяет изменившемуся байту.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface PinEntry {
  path: string;
  sha256: string;
}

export interface Pinned {
  source_commit: string;
  pinned_at: string;
  files: PinEntry[];
}

export function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export interface Drift {
  path: string;
  expected: string;
  actual: string | null;
}

export interface DoctorResult {
  ok: boolean;
  drift: Drift[];
}

/**
 * Обязательный набор вендоренных примитивов olympuz. Закреплён в КОДЕ, а не только в данных PINNED.json:
 * иначе пустой `files:[]` или пять дублей `package.json` дают зелёный doctor, не проверив ни одного примитива
 * (находка codex #12). Каждый из этих путей ОБЯЗАН быть в пине и совпасть на диске.
 */
export const REQUIRED_VENDOR = [
  "vendor/olympuz/src/gate.ts",
  "vendor/olympuz/src/land-gate-honesty.ts",
  "vendor/olympuz/src/loop.ts",
  "vendor/olympuz/src/oracle.ts",
  "vendor/olympuz/src/sandbox.ts",
];

/**
 * Зелёный, только если КАЖДЫЙ обязательный примитив запинен и его байты совпали. Отсутствующий вендоренный
 * файл - расхождение (actual: null). Пропуск примитива в пине - тоже расхождение: нельзя доверять байту,
 * который никто не обещал. Дубль пути в пине - расхождение: пин обязан быть однозначен.
 */
export function checkPinned(root: string, pinned: Pinned, required: string[] = REQUIRED_VENDOR): DoctorResult {
  const drift: Drift[] = [];
  const byPath = new Map<string, string>();
  for (const f of pinned.files) {
    if (byPath.has(f.path)) drift.push({ path: f.path, expected: "ДУБЛЬ В ПИНЕ", actual: byPath.get(f.path)! });
    else byPath.set(f.path, f.sha256);
  }
  // Обязательный набор: каждый примитив обязан быть в пине и совпасть на диске.
  for (const req of required) {
    const expected = byPath.get(req);
    if (!expected) {
      drift.push({ path: req, expected: "ОТСУТСТВУЕТ В ПИНЕ", actual: existsSync(join(root, req)) ? "на диске есть" : null });
      continue;
    }
    const abs = join(root, req);
    const actual = existsSync(abs) ? sha256File(abs) : null;
    if (actual !== expected) drift.push({ path: req, expected, actual });
  }
  // Плюс любой сверхштатный пин тоже сверяем - вендоренный байт не дрейфует молча.
  for (const f of pinned.files) {
    if (required.includes(f.path)) continue;
    const abs = join(root, f.path);
    const actual = existsSync(abs) ? sha256File(abs) : null;
    if (actual !== f.sha256) drift.push({ path: f.path, expected: f.sha256, actual });
  }
  return { ok: drift.length === 0, drift };
}
