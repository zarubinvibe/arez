// Фаза A Деймоса — runnable-плейбук recon->exploit->prove + оркестрация 6 сканеров в exit-код (REQ-28).
//
// Деймос - не сканер, а ОРКЕСТРАЦИЯ: Арес ведёт цель через разведку -> пробу -> доказательство и оставляет
// после себя не отчёт, а вечный регрессионный тест. Ключевая разница с strix: strix отдаёт SARIF-самозаявку,
// Деймос отдаёт ИСПОЛНЕННЫЙ тест, красный до фикса и зелёный после. Этот модуль - тонкая логика поверх
// арсенала: он сводит выход сканеров в exit-код кампании и не пускает в находку то, что не прошло observed-RED.
//
// Исполнение инъектируется (recon/exploit/prove - функции): пробу гонит Арес, доказательство наблюдает
// координатор (generator≠verifier), а тесты не зависят от сети и живой цели. Логика тут чистая и проверяемая.
import { classifyProof, type Proof } from "./observed-red.ts";
import type { Scanner } from "./catalog.ts";

/** Что разведка нашла на поверхности цели: где вход, какой сканер это поднял. */
export interface ReconHit {
  surface: string;
  scanner: string;
}

/**
 * Попытка эксплойта против одной находки разведки. `claimed` - Арес УТВЕРЖДАЕТ дыру (иначе честный сброс:
 * recon-ложь, проба не воспроизвелась). `runnable` - эксплойт исполним; false claimed = "теоретически
 * атакующий мог бы", а это мусор, не находка (LIM-09).
 */
export interface Attempt {
  hit: ReconHit;
  technique: string;
  claimed: boolean;
  runnable: boolean;
}

export interface Finding {
  attempt: Attempt;
  proof: Proof;
}

export interface Rejected {
  attempt: Attempt;
  reason: string;
}

export interface CampaignResult {
  /** 0 - кампания честна: каждый заявленный либо доказан RED->GREEN, либо честно сброшен. Иначе 1. */
  exitCode: number;
  scannersRun: string[];
  /** Доказанные RED->GREEN и запертые регрессией. */
  findings: Finding[];
  /** recon поднял, но Арес не заявил (проба не воспроизвелась) - честный сброс, не находка и не дефект. */
  dropped: Attempt[];
  /** Театр (полый тест), теория (незапускаемый claim) или открытая дыра (фикс не закрыл) - делают кампанию RED. */
  rejected: Rejected[];
}

export type Recon = (scanner: Scanner) => ReconHit[];
export type Exploit = (hit: ReconHit) => Attempt;
export type Prove = (attempt: Attempt) => Proof;

/**
 * Оркестрирует сканеры в exit-код одной кампании. Сканеры идут В ПОРЯДКЕ КАТАЛОГА (deimos первым - он и есть
 * оркестратор). Каждый claimed-эксплойт ОБЯЗАН пройти observed-RED, иначе кампания краснеет:
 *   - незапускаемый claim -> отклонён как теория (LIM-09);
 *   - полый тест (зелёный до фикса) -> отклонён как театр (LIM-08);
 *   - фикс не закрыл дыру -> отклонён, дыра открыта;
 *   - proven RED->GREEN -> находка, заперта.
 * Незаявленные попытки - честный сброс: кампания без находок зелёная, если ничего не отклонено.
 */
export function runPlaybook(
  scanners: Scanner[],
  recon: Recon,
  exploit: Exploit,
  prove: Prove,
): CampaignResult {
  const findings: Finding[] = [];
  const dropped: Attempt[] = [];
  const rejected: Rejected[] = [];
  const scannersRun: string[] = [];

  for (const scanner of scanners) {
    scannersRun.push(scanner.name);
    for (const hit of recon(scanner)) {
      const attempt = exploit(hit);
      if (!attempt.claimed) {
        dropped.push(attempt); // recon-ложь / проба не воспроизвелась - честно молчим
        continue;
      }
      if (!attempt.runnable) {
        rejected.push({ attempt, reason: "теория, не находка: незапускаемый claim (LIM-09)" });
        continue;
      }
      const proof = prove(attempt);
      // Не доверяем полю `kind` - оно подделываемо (находка codex #3: {kind:"proven", preCode:0}).
      // Пере-выводим вердикт из НАБЛЮДЁННЫХ кодов: находкой становится только реальный RED->GREEN.
      const verdict = classifyProof(proof.preCode, proof.postCode);
      if (verdict.kind === "proven") {
        findings.push({ attempt, proof: verdict });
      } else {
        // hollow (театр, LIM-08), fix-failed (дыра открыта) или infra-failed (мусор) - все валят кампанию.
        rejected.push({ attempt, reason: verdict.reason });
      }
    }
  }

  return {
    exitCode: rejected.length === 0 ? 0 : 1,
    scannersRun,
    findings,
    dropped,
    rejected,
  };
}
