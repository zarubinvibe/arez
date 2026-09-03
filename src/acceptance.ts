// Приёмочный сценарий Деймоса — прогоняет все четыре фазы A-D ВМЕСТЕ (REQ-08).
//
// Это не юнит-тест одной функции, а сквозной прогон реальных фаз: он доказывает, что каждый гейт зелен на
// честном входе И красен на театре - в обе стороны, иначе гейт декоративен. Исполнение везде инъектировано
// детерминированно, поэтому сценарий гоняется под `arez gate` без живой сети и живой цели, а координатор
// наблюдает его exit-код вне досягаемости атакующего агента (REQ-09).
import { loadCatalog } from "./catalog.ts";
import { classifyProof } from "./observed-red.ts";
import { runPlaybook, type ReconHit, type Attempt } from "./phase-a.ts";
import { witnessContainment } from "./phase-c.ts";
import { validateManifest, runChain, type ScopeManifest, type ChainStep } from "./phase-d.ts";

export interface PhaseCheck {
  phase: "A" | "B" | "C" | "D";
  ok: boolean;
  detail: string;
}

export interface AcceptanceResult {
  ok: boolean;
  checks: PhaseCheck[];
}

const scopeM: ScopeManifest = {
  port: 8931,
  owns: ["/tmp/arez-target/src"],
  reads: ["/tmp/arez-target/config"],
  author: "coordinator",
};

/**
 * Гонит A-D на реальном каталоге дома. Каждая фаза проверяется В ОБЕ СТОРОНЫ: честный вход даёт зелёный,
 * театр/выход-за-scope даёт красный. ok=true только когда все четыре фазы держат обе стороны.
 */
export function runAcceptance(root: string): AcceptanceResult {
  const checks: PhaseCheck[] = [];

  // Каталог - предусловие фаз (6 сканеров на сиденье). Красный каталог валит приёмку сразу.
  const cat = loadCatalog(root);
  if (!cat.ok) {
    return { ok: false, checks: [{ phase: "A", ok: false, detail: `каталог красный: ${cat.problems.join("; ")}` }] };
  }
  const scanners = cat.catalog!.skills.scanners;

  // --- Фаза A: recon->exploit->prove оркеструет 6 сканеров в exit-код ---
  const hitOn = (name: string) => (s: { name: string }): ReconHit[] => (s.name === name ? [{ surface: "web/app.js", scanner: s.name }] : []);
  const claim = (h: ReconHit, runnable: boolean): Attempt => ({ hit: h, technique: "sqli", claimed: true, runnable });
  // честная кампания: sast-scan поднял дыру, доказана RED->GREEN
  const honest = runPlaybook(scanners, hitOn("sast-scan"), (h) => claim(h, true), () => classifyProof(1, 0));
  // театр: тот же claim, но полый тест (зелёный до фикса) - обязан краснить кампанию
  const theater = runPlaybook(scanners, hitOn("sast-scan"), (h) => claim(h, true), () => classifyProof(0, 0));
  const aOk = honest.exitCode === 0 && honest.findings.length === 1 && theater.exitCode === 1;
  checks.push({ phase: "A", ok: aOk, detail: aOk ? "честная кампания зелёная, театр отвергнут" : `A сломана: honest=${honest.exitCode}, theater=${theater.exitCode}` });

  // --- Фаза B: observed-RED - ядро анти-театра (proven vs hollow) ---
  const bOk = classifyProof(1, 0).kind === "proven" && classifyProof(0, 0).kind === "hollow" && classifyProof(1, 1).kind === "fix-failed";
  checks.push({ phase: "B", ok: bOk, detail: bOk ? "RED->GREEN доказано, полый и незакрытый отвергнуты" : "B: классификатор доказательства сломан" });

  // --- Фаза C: канарейка доказывает containment в обе стороны ---
  const realCanary = (state: "confined" | "unconfined") => state === "unconfined"; // под seatbelt режется, без неё доходит
  const leakyCanary = () => true; // egress проходит даже под seatbelt - театр
  const cOk = witnessContainment(realCanary).kind === "contained" && witnessContainment(leakyCanary).kind === "leaky";
  checks.push({ phase: "C", ok: cOk, detail: cOk ? "containment реален, дырявая seatbelt отвергнута" : "C: канарейка не различает состояния" });

  // --- Фаза D: scope-манифест держит периметр, цепочка автономна в scope ---
  const manifestOk = validateManifest(scopeM).ok && !validateManifest({ ...scopeM, author: "ares" }).ok;
  const inScope: ChainStep[] = [
    { technique: "idor", action: { kind: "hit", target: "127.0.0.1:8931" } },
    { technique: "priv-esc", action: { kind: "hit", target: "127.0.0.1:8931" } },
  ];
  const outScope: ChainStep[] = [{ technique: "lateral", action: { kind: "hit", target: "127.0.0.1:9000" } }];
  const chainOk = runChain(scopeM, inScope, () => true).exitCode === 0 && runChain(scopeM, outScope, () => true).exitCode === 1;
  const dOk = manifestOk && chainOk;
  checks.push({ phase: "D", ok: dOk, detail: dOk ? "scope от координатора, цепочка автономна и в периметре" : "D: scope или цепочка сломаны" });

  return { ok: checks.every((c) => c.ok), checks };
}
