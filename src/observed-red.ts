// Observed-RED — ядро анти-театра arez (Деймос, фаза B).
//
// Находка реальна ТОЛЬКО когда координатор САМ увидел, как эксплойт-тест краснеет на
// до-фиксном дереве и зеленеет после фикса. Само-отчётный RED не в счёт (generator≠verifier
// на уровне exit-кода). А тест, зелёный ДО фикса, - театр: он не воспроизводит дыру и потому
// ничего не доказывает. Это острейший гард спеки Деймоса 2026-07-27: без него Деймос = SARIF
// strix с лишними шагами. Логика тут чистая и проверяемая; исполнение (кто гонит тест) -
// в witnessRedGreen через инъекцию, чтобы гонял координатор, а не бог.
import { spawnSync } from "node:child_process";

export type ProofKind = "proven" | "hollow" | "fix-failed" | "infra-failed";

export interface Proof {
  real: boolean;
  kind: ProofKind;
  preCode: number;
  postCode: number;
  reason: string;
}

/**
 * Весь вердикт анти-театра как чистые данные. preCode/postCode - exit-коды, которые КООРДИНАТОР
 * наблюдал, гоняя эксплойт-тест на до- и после-фиксном дереве. Никогда не само-отчёт.
 *
 * Невалидный код (не целое: NaN/Infinity/undefined) НЕ доказывает RED - это инфра-сбой наблюдения,
 * а не воспроизведённая дыра (fail-closed: мусор на входе не открывает вердикт proven).
 */
export function classifyProof(preCode: number, postCode: number): Proof {
  if (!Number.isInteger(preCode) || !Number.isInteger(postCode)) {
    return {
      real: false,
      kind: "infra-failed",
      preCode,
      postCode,
      reason: "невалидный exit-код наблюдения - не доказательство RED (нужен целочисленный код)",
    };
  }
  if (preCode === 0) {
    return {
      real: false,
      kind: "hollow",
      preCode,
      postCode,
      reason: "полый тест: зелёный ДО фикса - он не воспроизводит дыру, доказывать нечего",
    };
  }
  if (postCode === 0) {
    return {
      real: true,
      kind: "proven",
      preCode,
      postCode,
      reason: "RED->GREEN: координатор видел exit!=0 на до-фиксном дереве и exit 0 после фикса",
    };
  }
  return {
    real: false,
    kind: "fix-failed",
    preCode,
    postCode,
    reason: "фикс не закрыл дыру: тест всё ещё красный после фикса",
  };
}

export interface RunResult {
  code: number;
  /** Имя сигнала, если процесс УБИТ (SIGTERM/SIGKILL/таймаут), а не завершился своим exit-кодом. */
  signal?: string | null;
  stdout?: string;
}

export type Runner = (state: "before" | "after") => RunResult;

/**
 * Свидетельствует RED->GREEN, гоняя эксплойт-тест в каждом состоянии через `run`. Раннер
 * инъектируется: исполнение принадлежит координатору (generator≠verifier), а тесты не зависят от git.
 *
 * До-фиксный запуск, УБИТЫЙ сигналом (таймаут/OOM/крэш), - это инфра-сбой, а не воспроизведённая
 * дыра: ненулевой код тут не от «теста, который поймал дыру», а от смерти процесса. Такой RED не
 * засчитывается (fail-closed), иначе полумёртвая среда штампует proven (находка codex #2).
 */
export function witnessRedGreen(run: Runner): Proof {
  const before = run("before");
  if (before.signal) {
    return { real: false, kind: "infra-failed", preCode: before.code, postCode: 0, reason: `до-фиксный тест убит сигналом ${before.signal} - инфра-сбой, не воспроизведение дыры` };
  }
  const after = run("after");
  return classifyProof(before.code, after.code);
}

/** Гонит команду в cwd и возвращает её exit-код - так координатор НАБЛЮДАЕТ, а не спрашивает. */
export function runTest(cmd: string, cwd: string): RunResult {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8" });
  // killed-by-timeout/сигналом даёт null status - читаем как провал, не как зелёный (fail-closed),
  // и НЕСЁМ сигнал наверх: witnessRedGreen отличит убитый до-фиксный тест от настоящего RED.
  return { code: r.status ?? 1, signal: r.signal, stdout: (r.stdout || "").trim() };
}
