// The task oracle — who writes the exit-code check for a task phrased in the owner's words.
//
// The council (2026-07-20) named the hole nobody had for two days: the project invariant is that the verdict
// is an EXIT CODE, never a model's opinion — so every arbitrary word-task needs someone to turn the words
// into an executable check. The owner does not read code. The god does not judge itself. No phase owned this,
// and it is the whole product: yesterday two markdown reports landed precisely because "done" was never
// defined measurably, independent of the god's own report.
//
// So Zeus writes the oracle BEFORE the god's first token, and it is frozen. Author-of-the-statement and
// author-of-the-work are different — the same generator≠verifier discipline, lifted from the exit-code level
// to the level of stating the task. Three machine-checkable conditions, all here.

export interface Oracle {
  /** The acceptance command — exit 0 means the task is done. A word-goal that cannot become a command is
   *  rejected at validation, never silently turned into "the god writes a report". */
  cmd: string[];
  /** The files whose change the oracle's verdict depends on. Condition 3: the landing diff MUST touch one of
   *  these — without it, a markdown report passes a "non-empty diff" check honestly while changing nothing the
   *  oracle reads (the gap that let two reports land). */
  reads: string[];
  /** The owner's words the oracle was distilled from — provenance for the digest, NEVER the verdict. */
  goal: string;
}

export type OracleValidation = { ok: true; oracle: Oracle } | { ok: false; reason: string };

/**
 * Condition 1 — the oracle is a COMMAND with a read-surface. A goal that cannot be expressed as an exit-code
 * command ("improve the code", "разберись почему", "дизайн") is rejected HERE, before a token is spent.
 * Auto-converting such a goal into "the god writes a report" is forbidden: that is exactly how two markdown
 * files landed. Such a task is either not a task for the swarm, or its oracle is a `grill-me` with the owner.
 */
export function validateOracle(candidate: { cmd?: unknown; reads?: unknown; goal?: unknown }): OracleValidation {
  const cmd = candidate.cmd;
  if (!Array.isArray(cmd) || cmd.length === 0 || cmd.some((a) => typeof a !== "string" || a.trim() === "")) {
    return {
      ok: false,
      reason:
        "оракул должен быть командой с кодом возврата. Задача, не выразимая командой " +
        "(improve/разберись/дизайн), — не задача для роя, либо её оракул это grill-me с владельцем. " +
        "Превращать её в «бог напишет отчёт» запрещено: именно так приземлились два markdown.",
    };
  }
  const reads = candidate.reads;
  if (!Array.isArray(reads) || reads.length === 0 || reads.some((p) => typeof p !== "string" || p.trim() === "")) {
    return {
      ok: false,
      reason:
        "оракул обязан назвать файлы, чьё изменение он проверяет (условие 3). Без них markdown-отчёт " +
        "проходит проверку «непустой diff» честно, а задача остаётся невыполненной.",
    };
  }
  return { ok: true, oracle: { cmd: cmd as string[], reads: reads as string[], goal: typeof candidate.goal === "string" ? candidate.goal : "" } };
}

export interface OracleRun {
  exitCode: number;
  passed: boolean;
  output: string;
}

/**
 * Run the oracle command in `cwd`. Zeus authored it, so it is trusted coordinator code — but bounded by a wall
 * clock so a bad oracle cannot hang the coordinator (the same instinct as the gate's GATE_TIMEOUT_MS). The
 * verdict is the exit code, nothing else.
 */
export function runOracle(cwd: string, oracle: Oracle, timeoutMs = 60_000): OracleRun {
  const [exe, ...args] = oracle.cmd;
  try {
    const r = Bun.spawnSync([exe!, ...args], { cwd, timeout: timeoutMs, stdout: "pipe", stderr: "pipe" });
    const out = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
    const exitCode = r.exitCode ?? 1; // a killed-by-timeout run has a null exitCode → treat as failed
    return { exitCode, passed: exitCode === 0, output: out.trim() };
  } catch (e) {
    // The SPAWN itself failed — the executable is not in PATH, `cwd` does not exist, the file is not
    // executable. Bun throws here instead of returning a result, and a throw takes down the coordinator
    // over what is merely a failed task: one typo in an oracle kills the whole run. This function promises
    // that the verdict is an exit code and nothing else, so the throw becomes a verdict.
    //
    // The reason MUST name the command: a silent failure is indistinguishable from the task itself failing,
    // and at night that costs an hour of "why is the oracle red".
    const err = e as { code?: unknown; message?: unknown };
    const code = typeof err?.code === "string" ? err.code : "ENOENT";
    const detail = typeof err?.message === "string" ? ` — ${err.message}` : "";
    return {
      exitCode: 127, // shell convention: command not found
      passed: false,
      output: `оракул не запустился: ${code}: ${exe} (${oracle.cmd.join(" ")})${detail}`,
    };
  }
}

/**
 * Condition 2 — the oracle FAILS before the work. An oracle that is already green on the untouched tree proves
 * nothing (yesterday phase 02 "closed" on exactly that emptiness). Returns true when it correctly fails.
 */
export function oracleFailsOnBaseline(cwd: string, oracle: Oracle): boolean {
  return !runOracle(cwd, oracle).passed;
}

/**
 * Condition 3 — the landing diff touches a file the oracle reads. A changed path covers the oracle if it
 * equals one of `reads` or sits under it (a read may name a directory). Empty intersection = the work did not
 * touch what the oracle measures, so it is NOT done however non-empty and honestly-authored the diff is.
 */
export function diffCoversOracle(changedPaths: string[], oracle: Oracle): boolean {
  return changedPaths.some((p) => oracle.reads.some((r) => p === r || p.startsWith(r.endsWith("/") ? r : r + "/")));
}

export interface OracleAcceptance {
  accepted: boolean;
  reason: string;
}

/**
 * The task's acceptance, AFTER the god's work: the oracle must now PASS (exit 0) AND the landing diff must
 * touch a file the oracle reads. Both, because either alone is a hole: a passing oracle with a report-only
 * diff means the check was already satisfiable without the task; a covering diff with a failing oracle means
 * the work touched the right file but did not achieve the goal.
 */
export function acceptTaskLanding(landedTreeCwd: string, changedPaths: string[], oracle: Oracle): OracleAcceptance {
  const run = runOracle(landedTreeCwd, oracle);
  if (!run.passed) return { accepted: false, reason: `оракул задачи не прошёл (exit ${run.exitCode})` };
  if (!diffCoversOracle(changedPaths, oracle)) {
    return { accepted: false, reason: `diff не касается ни одного файла оракула (${oracle.reads.join(", ")}) — задача не засчитана` };
  }
  return { accepted: true, reason: "оракул прошёл и diff касается файлов оракула" };
}

// ─────────────────────────────────────────────────────────────────────────────
// must_haves — the node's acceptance contract (P2-1).
//
// The hole this closes: `bun run verify` gives an exit code, so "did it break anything" is answered — but
// "is this what the owner asked for" is answered by NOBODY. A feature with zero tests passes the gate green.
// That is why the first landing in this repo's history put a draft on main and reported success.
//
// A must-have IS an Oracle. Not a new shape: `cmd` already gives the exit code, `reads` already names the
// files the diff must touch, `goal` already carries the owner's words as provenance and never as verdict —
// and `validateOracle` already refuses a goal that cannot become a command, which is the one door through
// which "the god writes a report" walked in. One oracle is the list of one. A phase's `acceptance` (plan
// schema, phase 03) is this same list one altitude up; the plan→DAG wiring carries it down onto the nodes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a must-have's command gets executed. INJECTED, and that is the whole security design: the tree being
 * judged holds the god's just-written code, so the node path must run it CONFINED (through `runGate`, which
 * already owns the seatbelt, `protect` and the wall clock). Passing a runner in means no caller can reach
 * the node path with the host spawner by accident — the unconfined `runOracle` above is not reachable from
 * here. This project has already had to fix host-execution of god code twice (the pre-commit hook, and git
 * config-redirect); this is the same class, closed by construction rather than by remembering.
 */
export type OracleRunner = (cwd: string, cmd: string[]) => Promise<OracleRun>;

export type BaselineCheck = { ok: true } | { ok: false; reason: string };

/**
 * Condition 2, lifted to a list: EVERY must-have must be RED before the god starts. One that is already
 * green proves nothing about the work — it hands the node a pass it did not earn, which is exactly how
 * phase 02 once "closed" on emptiness. The reason NAMES the offenders: "some must-have was already green"
 * costs an hour at night, the command that was green costs nothing to read.
 */
export async function mustHavesFailOnBaseline(cwd: string, mustHaves: Oracle[], run: OracleRunner): Promise<BaselineCheck> {
  if (mustHaves.length === 0) return { ok: false, reason: "пустой must_haves — приёмки нет, а выглядит как есть" };
  const green: string[] = [];
  for (const mh of mustHaves) {
    if ((await run(cwd, mh.cmd)).passed) green.push(mh.cmd.join(" "));
  }
  if (green.length > 0) {
    return { ok: false, reason: `must-have зелёный ДО работы, значит ничего не проверяет: ${green.join(" · ")}` };
  }
  return { ok: true };
}

/**
 * The node's acceptance AFTER the work: every must-have now PASSES **and** the landing diff touches what
 * each one reads. Both, per must-have, because either alone is a hole — a passing check with a report-only
 * diff means it was satisfiable without the task; a covering diff with a failing check means the work
 * touched the right file and missed the goal.
 *
 * An EMPTY list is refused rather than trivially accepted: `must_haves: []` reads to a human as "acceptance
 * exists" while asserting nothing, and a vacuous pass is the failure mode this whole contract exists to end.
 */
export async function acceptNodeLanding(
  landedTreeCwd: string,
  changedPaths: string[],
  mustHaves: Oracle[],
  run: OracleRunner,
): Promise<OracleAcceptance> {
  if (mustHaves.length === 0) return { accepted: false, reason: "пустой must_haves — узел не принят: приёмка обязана что-то утверждать" };
  for (const mh of mustHaves) {
    const r = await run(landedTreeCwd, mh.cmd);
    if (!r.passed) {
      return { accepted: false, reason: `must-have не выполнен (exit ${r.exitCode}): ${mh.cmd.join(" ")}` };
    }
    if (!diffCoversOracle(changedPaths, mh)) {
      return { accepted: false, reason: `must-have прошёл, но diff не касается его файлов (${mh.reads.join(", ")}): ${mh.cmd.join(" ")}` };
    }
  }
  return { accepted: true, reason: `все must_haves выполнены и покрыты diff-ом (${mustHaves.length})` };
}
