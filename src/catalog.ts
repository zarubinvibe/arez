// Каталог arez — сиденье Ареса и его сканеры как проверяемые данные, не проза.
//
// Реестр врёт, если его не сверять: соул описывает сиденье словами, но фактический набор Ареса
// приходит из catalog/. Гейт обязан подтвердить инварианты семьи ЗДЕСЬ, а не надеяться на прозу:
// провайдер claude с полом top (LIM: вниз по силе Ареса не сдвигают), daimons:[] (LIM-01, Арес - лист,
// фан-аут множит радиус поражения), и ровно 6 сканеров на сиденье (REQ-19/REQ-26). Деймос среди них -
// оркестратор, а не седьмой сканер: он ведёт остальных в цепочку и в exit-код.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Санкционированный каталог тел сканеров - плейбук обязан лежать именно тут (не "." и не "../утечка"). */
const PLAYBOOK_DIR = "catalog/scanners/";

/** Обычный .md-файл внутри санкционированного каталога. existsSync пропускал "." (каталог) и любой путь. */
function isValidPlaybook(root: string, rel: string): boolean {
  if (!rel.startsWith(PLAYBOOK_DIR) || rel.includes("..") || !rel.endsWith(".md")) return false;
  try {
    return statSync(join(root, rel)).isFile();
  } catch {
    return false;
  }
}

export interface Models {
  seat: string;
  provider: string;
  minTier: string;
  daimons: string[];
  tiers: Record<string, string>;
}

export interface Scanner {
  name: string;
  class: string;
  gives: string;
  playbook: string;
}

export interface Skills {
  scanners: Scanner[];
}

export interface Catalog {
  models: Models;
  skills: Skills;
}

const EXPECTED_SCANNERS = 6; // REQ-19: pantheon.ts:175 несёт 6 сканеров на сиденье Ареса.

export interface CatalogResult {
  ok: boolean;
  catalog?: Catalog;
  problems: string[];
}

/**
 * Читает и ВАЛИДИРУЕТ каталог. Зелёный только когда каждый инвариант семьи держится байтами файла.
 * root - корень репо; playbookMustExist проверяет, что тело каждого сканера на диске (в гейте - да,
 * в чужой установке порт-плейбуков лежит рядом).
 */
export function loadCatalog(root: string, playbookMustExist = true): CatalogResult {
  const problems: string[] = [];
  const modelsPath = join(root, "catalog/models.json");
  const skillsPath = join(root, "catalog/skills.json");

  let models: Models | undefined;
  let skills: Skills | undefined;
  try {
    const parsed = JSON.parse(readFileSync(modelsPath, "utf8"));
    // JSON.parse("null") -> null проходил бы `if(models)` мимо всех проверок и давал ok:true (находка codex #13).
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) problems.push(`catalog/models.json не объект`);
    else models = parsed as Models;
  } catch (e) {
    problems.push(`catalog/models.json не читается: ${(e as Error).message}`);
  }
  try {
    const parsed = JSON.parse(readFileSync(skillsPath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) problems.push(`catalog/skills.json не объект`);
    else skills = parsed as Skills;
  } catch (e) {
    problems.push(`catalog/skills.json не читается: ${(e as Error).message}`);
  }

  if (models) {
    if (models.seat !== "ares") problems.push(`сиденье не ares: ${models.seat}`);
    if (models.provider !== "claude") problems.push(`провайдер не claude: ${models.provider}`);
    if (models.minTier !== "top") problems.push(`minTier не top: ${models.minTier} (вниз по силе Ареса не сдвигают)`);
    // LIM-01: Арес - лист. daimons:[] держится каталогом, а не только соулом.
    if (!Array.isArray(models.daimons) || models.daimons.length !== 0) {
      problems.push(`daimons не пуст (LIM-01): Арес - лист, под-агентов не спавнит`);
    }
  }

  if (skills) {
    const s = skills.scanners;
    if (!Array.isArray(s)) {
      problems.push(`scanners не массив`);
    } else {
      if (s.length !== EXPECTED_SCANNERS) {
        problems.push(`сканеров ${s.length}, а сиденье несёт ${EXPECTED_SCANNERS} (REQ-19)`);
      }
      const names = new Set<string>();
      for (const sc of s) {
        if (!sc.name || !sc.class || !sc.gives || !sc.playbook) {
          problems.push(`сканер с неполными полями: ${JSON.stringify(sc.name ?? sc)}`);
          continue;
        }
        if (names.has(sc.name)) problems.push(`дубль сканера: ${sc.name}`);
        names.add(sc.name);
        if (playbookMustExist && !isValidPlaybook(root, sc.playbook)) {
          problems.push(`тело сканера ${sc.name} не валидный .md в ${PLAYBOOK_DIR}: ${sc.playbook}`);
        }
      }
      // Деймос - оркестратор цепочки, без него шесть разрозненных сканеров, а не Деймос (REQ-28).
      if (!names.has("deimos")) problems.push(`нет оркестратора deimos среди сканеров`);
    }
  }

  const ok = problems.length === 0;
  return { ok, catalog: ok ? { models: models!, skills: skills! } : undefined, problems };
}
