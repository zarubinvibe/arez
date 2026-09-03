// Фаза D Деймоса — scope-манифест port-owns-reads + многошаговая цепочка (REQ-31/REQ-15/REQ-33).
//
// Манифест пишет КООРДИНАТОР, не атакующий агент: бог не подделает свой scope (generator≠verifier, как гейт
// в REQ-09). Любое действие агента проходит через assertInScope - предложение расширить свой периметр
// отклоняется детерминированно, а не «судья согласился». Арес бьёт только объявленную цель на 127.0.0.1.
//
// Цепочка - то, чем автономный атакующий опаснее: две сцепленные техники без рук страшнее тридцати под
// ручным управлением (soul: ранжируй по автономии цепочки). Фан-аут заперт на MAX_DEPTH=1 (LIM-01, daimons:[]):
// цепочку ведёт ОДИН агент последовательно, спавн под-агентов запрещён. Net/shell-грант несёт риск-флаг D8
// на разовый человеческий гейт (REQ-33), а не молча исполняется.
import { resolve } from "node:path";

export const MAX_DEPTH = 1; // REQ-15: глубина фан-аута. Цепочка - последовательность одного агента, не дерево.

export interface ScopeManifest {
  /** Единственный порт, который Арес вправе бить (REQ-14). */
  port: number;
  /** Пути, которые агент вправе атаковать/менять. */
  owns: string[];
  /** Пути, читаемые агентом (owns читаемы неявно). */
  reads: string[];
  /** Провенанс: манифест, «написанный» агентом, недействителен - scope задаёт координатор. */
  author: "coordinator" | string;
}

export interface ScopeResult {
  ok: boolean;
  problems: string[];
}

/** Массив непустых строк-путей: пустая строка в owns/reads = resolve("") -> текущий каталог (утечка scope). */
function badPathList(v: unknown): boolean {
  return !Array.isArray(v) || v.some((p) => typeof p !== "string" || p.trim() === "");
}

/**
 * Манифест действителен только от координатора, с валидным портом, непустым owns и корректными списками путей.
 * Агент свой scope не авторит (бог не подделает). Пустая строка или не-строка в owns/reads отвергается: иначе
 * resolve("") расширяет scope до текущего каталога (находка codex #7), а reads:123 роняет .some (находка #7).
 */
export function validateManifest(m: ScopeManifest): ScopeResult {
  const problems: string[] = [];
  if (m.author !== "coordinator") problems.push(`scope не от координатора (author=${m.author}) - бог не авторит свой периметр`);
  if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535) problems.push(`порт вне диапазона 1..65535: ${m.port}`);
  if (!Array.isArray(m.owns) || m.owns.length === 0) problems.push(`owns пуст - нечего атаковать в рамках scope`);
  else if (badPathList(m.owns)) problems.push(`owns содержит пустой/не-строковый путь`);
  if (badPathList(m.reads)) problems.push(`reads не список непустых строк-путей`);
  return { ok: problems.length === 0, problems };
}

export type ActionKind = "read" | "write" | "hit";
export interface Action {
  kind: ActionKind;
  /** путь (read/write) либо "127.0.0.1:<port>" (hit). */
  target: string;
}

// Лексическая проверка: `..` нормализуется resolve(), хвостовой слэш и префикс-коллизия (/a/bc под /a/b)
// обработаны. ponytail: symlink НЕ резолвится здесь намеренно - в модуле нет файлового sink, а realpath
// принадлежит месту реальной операции чтения/записи (там symlink уводит в /etc). Резолвить симлинк тут -
// сканировать ФС на каждый scope-чек без sink, который бы этим воспользовался. Добавить realpath, когда
// появится sink (находка codex #10, MEDIUM: без sink симлинк-обход неэксплуатируем).
function isUnder(child: string, root: string): boolean {
  const c = resolve(child);
  const r = resolve(root);
  return c === r || c.startsWith(r + "/");
}

export interface ScopeVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * Пускает действие ТОЛЬКО внутри объявленного scope. hit - строго на манифестный 127.0.0.1:<port> (ни чужой
 * loopback, ни другой порт). write - под owns. read - под owns или reads. Всё прочее отклонено: попытка выйти
 * за периметр - это атака чужого сервиса, а не аудит.
 */
export function assertInScope(m: ScopeManifest, a: Action): ScopeVerdict {
  // Недействительный манифест не даёт разрешений вообще: некоординаторский scope блокирует любое действие
  // (находка codex #6 - assertInScope доверял манифесту, не проверив его провенанс/форму).
  const mv = validateManifest(m);
  if (!mv.ok) return { allowed: false, reason: `манифест недействителен: ${mv.problems.join("; ")}` };

  if (a.kind === "hit") {
    const want = `127.0.0.1:${m.port}`;
    if (a.target !== want) return { allowed: false, reason: `hit вне scope: ${a.target} != ${want} (только объявленная цель)` };
    return { allowed: true, reason: "hit по объявленной цели" };
  }
  if (a.kind === "write") {
    if (m.owns.some((o) => isUnder(a.target, o))) return { allowed: true, reason: "write под owns" };
    return { allowed: false, reason: `write вне owns: ${a.target}` };
  }
  if (a.kind === "read") {
    if (m.owns.some((o) => isUnder(a.target, o)) || m.reads.some((r) => isUnder(a.target, r))) {
      return { allowed: true, reason: "read под owns/reads" };
    }
    return { allowed: false, reason: `read вне owns/reads: ${a.target}` };
  }
  // Неизвестный вид действия ОТКЛОНЯЕТСЯ явно (находка codex #9: default нельзя пускать в read-ветку).
  return { allowed: false, reason: `неизвестный вид действия: ${(a as Action).kind}` };
}

export interface ChainStep {
  technique: string;
  action: Action;
  /** Шаг просит спавн под-агента - запрещён (MAX_DEPTH=1, daimons:[]). */
  spawns?: boolean;
  /** Шагу нужен net/shell-грант - риск-флаг D8 на разовый человеческий гейт (REQ-33). */
  needsGrant?: "net" | "shell";
}

export interface ChainResult {
  /** 0 - цепочка автономна и в scope. Иначе 1 (вышла за scope или потребовала запрещённый спавн). */
  exitCode: number;
  /** Техники, отработавшие автономно и в scope - по их числу ранжируется опасность (автономия цепочки). */
  advanced: string[];
  /** Где цепочка упёрлась (out-of-scope / спавн). */
  blockedAt?: { step: ChainStep; reason: string };
  /** Шаги, ждущие разового человеческого гейта D8 - не провал, пауза (REQ-33). */
  heldForGrant: ChainStep[];
  depth: number;
}

export type Execute = (step: ChainStep) => boolean; // продвинулась ли техника (наблюдаемо), инъекция

/**
 * Ведёт цепочку последовательно одним агентом. Каждый шаг: scope-чек -> запрет спавна -> D8-грант? -> исполнение.
 * Первый выход за scope или запрос спавна ОСТАНАВЛИВАЕТ цепочку (fail-closed). Шаг с net/shell-грантом
 * помечается HELD под D8 и не исполняется автономно. Автономия = число продвинувшихся в scope техник.
 */
export function runChain(m: ScopeManifest, steps: ChainStep[], execute: Execute): ChainResult {
  const advanced: string[] = [];
  const heldForGrant: ChainStep[] = [];
  // Недействительный манифест не ведёт цепочку вообще - даже пустую (находка codex #6): fail-closed на входе.
  const mv = validateManifest(m);
  if (!mv.ok) {
    return { exitCode: 1, advanced, blockedAt: { step: steps[0] ?? ({ technique: "-", action: { kind: "hit", target: "-" } } as ChainStep), reason: `манифест недействителен: ${mv.problems.join("; ")}` }, heldForGrant, depth: MAX_DEPTH };
  }
  for (const step of steps) {
    if (step.spawns) {
      return { exitCode: 1, advanced, blockedAt: { step, reason: "спавн под-агента запрещён (MAX_DEPTH=1, LIM-01)" }, heldForGrant, depth: MAX_DEPTH };
    }
    const v = assertInScope(m, step.action);
    if (!v.allowed) {
      return { exitCode: 1, advanced, blockedAt: { step, reason: v.reason }, heldForGrant, depth: MAX_DEPTH };
    }
    if (step.needsGrant) {
      heldForGrant.push(step); // D8: не исполняем автономно, ждём разового гейта человека
      continue;
    }
    if (execute(step)) advanced.push(step.technique);
  }
  return { exitCode: 0, advanced, heldForGrant, depth: MAX_DEPTH };
}
