// Проба честности гейта посадки. Западня, которую она закрывает, ЗАМЕРЕНА (bun 1.3.14):
//
//   внешний проект БЕЗ тестов          → `bun test ./src` = exit 1  — не примет НИЧЕГО
//   он же с одним ПУСТЫМ `*.test.ts`   → `bun test ./src` = exit 0  — примет ЧТО УГОДНО
//
// Обе половины на неизменённом дереве выглядят как исправный судья: одна всегда красная, другая всегда
// зелёная, и код возврата про это молчит. Гейт посадки чужого проекта задаётся флагом `--land-gate`, то
// есть строкой, которую никто не проверял.
//
// Дисциплина взята оттуда, где она в этом проекте уже работает: `mustHavesFailOnBaseline` (oracle.ts) не
// верит приёмочной команде, пока та не покраснела на baseline. Здесь то же самое, одним уровнем выше:
//
//   1. гейт обязан быть ЗЕЛЁНЫМ на неизменённом mainRef — иначе судить им нечего (первая половина западни);
//   2. гейт обязан ПОКРАСНЕТЬ хотя бы на одном заведомо сломанном дереве (вторая половина).
//
// Заведомо сломанное дерево машина ищет сама, обнуляя по ОДНОМУ отслеженному файлу за раз. Почему именно
// обнуление, а не удаление и не порча мусором — замерено на двух проектах:
//
//   · мусор (несинтаксический текст) роняет ЛЮБОЙ раннер на разборе — краснеет и слепой гейт, сигнала нет;
//   · удаление всего дерева тоже краснит слепой гейт (`bun test ./src` без ./src = exit 1) — сигнала нет;
//   · обнуление ОДНОГО файла оставляет дерево синтаксически загружаемым и семантически пустым:
//       честный проект  (add.ts + настоящий add.test.ts): обнулить add.ts     → exit 1  ✓ краснеет
//       пусто-зелёный   (lib.ts + ПУСТОЙ empty.test.ts):  обнулить оба файла → exit 0  ✓ отвергнут
//
// Обнуление манифеста (`package.json`) bun-гейт НЕ красит (замерено) — эвристик «пропускать манифесты»
// не нужно, и их здесь нет: устаревшая эвристика хуже отсутствующей.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { gitEnv } from "./env";
import { landingRootFor } from "./merge-queue";
import { LAND_GATE_PROTECT, landGateTier } from "./land-gate";
import { ensureDepsLink } from "./worktree-deps";

/** Потолок прогонов гейта на поиск сломанного дерева. Каждый прогон — полная приёмка чужого проекта. */
export const DEFAULT_MAX_PROBES = 12;

export interface GateHonestyRequest {
  /** ОДНОРАЗОВАЯ рабочая копия цели на mainRef. Файлы в ней обнуляются — настоящее дерево сюда нельзя. */
  tree: string;
  /** Настоящий корень цели. Нужен ровно для одного: отказать, если `tree` — он же. */
  projectRoot: string;
  /** Отслеженные файлы цели, относительными путями, в порядке пробы. */
  candidates: string[];
  /** Прогон гейта в `tree`. true — зелёный. Тот же confined-раннер, что судит посадку. */
  runGate: (tree: string) => Promise<boolean>;
  maxProbes?: number;
}

export interface GateHonestyVerdict {
  ok: boolean;
  /** Файл, обнуление которого покрасило гейт. Есть только у принятого гейта. */
  witness?: string;
  reason: string;
  /** Сколько раз гейт исполнялся на СЛОМАННОМ дереве (прогон на неизменённом не считается). */
  probes: number;
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Доказать, что гейт посадки способен вынести оба вердикта. Возвращает вердикт — не бросает: вызывающий
 * отказывает миссии сам, до первого токена, и печатает причину оператору.
 */
export async function proveGateReddens(req: GateHonestyRequest): Promise<GateHonestyVerdict> {
  const tree = canonical(req.tree);
  const project = canonical(req.projectRoot);
  // Обнулять файлы владельца проба права не имеет ни при каких данных. Проверка стоит ПЕРВОЙ — раньше любого
  // чтения и любого прогона: дальше по функции файлы уже пишутся.
  if (tree === project) {
    return { ok: false, reason: "проба честности требует одноразовую копию цели — на настоящем дереве проекта она обнуляла бы файлы владельца", probes: 0 };
  }
  if (!req.candidates.length) {
    return { ok: false, reason: "нечего обнулять: список отслеженных файлов цели пуст — доказать красноту гейта не на чем", probes: 0 };
  }

  if (!(await req.runGate(tree))) {
    return { ok: false, reason: "гейт красен на неизменённом mainRef — судить им нечего: он отвергнет любую работу бога, а не только плохую", probes: 0 };
  }

  const max = req.maxProbes ?? DEFAULT_MAX_PROBES;
  let probes = 0;
  for (const rel of req.candidates) {
    if (probes >= max) break;
    const file = resolve(tree, rel);
    // Кандидат приходит из `git ls-files` цели, но путь всё равно проверяется: побег за пределы одноразового
    // дерева означал бы, что проба обнулила файл, который никто не восстановит.
    if (!isInside(file, tree)) {
      return { ok: false, reason: `кандидат ${JSON.stringify(rel)} ведёт вне одноразового дерева (${file}) — проба не пишет за его пределами`, probes };
    }
    if (!existsSync(file)) continue;
    const saved = readFileSync(file);
    let red: boolean;
    try {
      writeFileSync(file, "");
      probes++;
      red = !(await req.runGate(tree));
    } finally {
      // Восстановление в finally, а не после: упавший гейт иначе оставил бы дерево обнулённым, и следующая
      // проба судила бы уже сломанный проект — красный «свидетель» из ниоткуда.
      writeFileSync(file, saved);
    }
    if (red) {
      return { ok: true, witness: rel, reason: `гейт покраснел на обнулённом ${rel} — он судит содержимое цели`, probes };
    }
  }

  return {
    ok: false,
    reason: `ни одно обнуление из ${probes} не покрасило гейт — он зелен независимо от содержимого цели и примет любую работу бога`,
    probes,
  };
}

/** Отслеженные файлы цели на `ref`, относительными путями. Порядок git — детерминированный. */
export function trackedFiles(projectRoot: string, ref: string, env: Record<string, string>, exclude: string[] = []): string[] {
  const r = Bun.spawnSync(["git", "-C", projectRoot, "ls-tree", "-r", "--name-only", "-z", ref], { env, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) return [];
  const skip = new Set(exclude.map((p) => p.replace(/^\.\//, "")));
  return new TextDecoder()
    .decode(r.stdout)
    .split("\0")
    .filter((p) => p !== "" && !skip.has(p));
}

/**
 * Проба честности на НАСТОЯЩЕЙ цели: одноразовое дерево на `mainRef` + тот же confined-раннер, что судит
 * посадку. Живёт здесь, а не в `cli.ts`, по той же причине, по какой из него уехал `land-gate.ts`: cli.ts
 * запускает миссию на импорте, поэтому ничто не может его импортировать, и «проба гоняет настоящий гейт»
 * осталось бы утверждением, за которым не стоит ни один код возврата.
 */
export async function proveLandGateOnProject(o: {
  projectRoot: string;
  gateCmd: string[];
  mainRef: string;
  timeoutMs?: number;
  maxProbes?: number;
  /** Только для тестов: подменяет confined-раннер. Продакшн всегда гоняет настоящий гейт посадки. */
  runGate?: (tree: string) => Promise<boolean>;
}): Promise<GateHonestyVerdict> {
  const env = gitEnv();
  const root = landingRootFor(o.projectRoot);
  mkdirSync(root, { recursive: true });
  const tree = mkdtempSync(join(root, "honesty-"));
  rmSync(tree, { recursive: true, force: true }); // `worktree add` требует, чтобы путь не существовал
  const add = Bun.spawnSync(["git", "worktree", "add", "--detach", tree, o.mainRef], { cwd: o.projectRoot, env, stdout: "pipe", stderr: "pipe" });
  if (add.exitCode !== 0) {
    return { ok: false, reason: `одноразовое дерево на ${o.mainRef} не создалось: ${new TextDecoder().decode(add.stderr).trim()}`, probes: 0 };
  }
  try {
    // Те же зависимости, что увидит настоящий кандидат посадки (merge-queue делает ровно этот симлинк):
    // без них гейт красен по причине «модуль не найден», и проба объявила бы честным судьёй сломанное окружение.
    ensureDepsLink(tree, join(o.projectRoot, "node_modules"));
    // Судится ЯРУС ОПЕРАТОРА, а не полный гейт. Ярус типов фиксирован и нескипаем; когда проба гоняла оба
    // разом, на пусто-зелёном проекте свидетелем оказывался обнулённый `tsconfig.json` — гейт краснел от
    // сломанного tsc, а не от того, что судит код, и слепая приёмка получала «доказано» (замерено).
    const tier = landGateTier({ repoRoot: o.projectRoot, gateCmd: o.gateCmd, timeoutMs: o.timeoutMs }, o.gateCmd);
    const runner = o.runGate ?? (async (t: string) => (await tier(t)).pass);
    return await proveGateReddens({
      tree,
      projectRoot: o.projectRoot,
      // `LAND_GATE_PROTECT` исключён: гейт восстанавливает эти файлы из main перед каждым прогоном, так что
      // их обнуление ничего не докажет — проба лишь сожгла бы на них свой потолок.
      candidates: trackedFiles(o.projectRoot, o.mainRef, env, LAND_GATE_PROTECT),
      runGate: runner,
      maxProbes: o.maxProbes,
    });
  } finally {
    Bun.spawnSync(["git", "worktree", "remove", "--force", tree], { cwd: o.projectRoot, env, stdout: "ignore", stderr: "ignore" });
    rmSync(tree, { recursive: true, force: true });
  }
}
