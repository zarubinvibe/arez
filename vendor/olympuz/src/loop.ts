// Build-verify loop — what turns GLOBAL rules 5/6/7/8 from prose into code.
//
// The god BUILDS. A deterministic gate JUDGES. The loop revises until the gate passes or a cap trips.
// Nothing here trusts a model's opinion of its own work: `ok` from the god is telemetry, the gate's
// exit code is the verdict.
//
// Three structural rules, each one learned by something breaking:
//
//  1. ORCHESTRATION INVERSION — the gate runs HERE, in the coordinator's process, as argv with an exit
//     code. Not as a background "judge god". apollon-v2 shipped a background verifier agent; it hung on
//     an MCP call, tripped the no-progress timeout, and killed a run whose build had already succeeded.
//     An exit code cannot hang the swarm, cannot be flattered, and costs nothing.
//
//  2. GENERATOR ≠ VERIFIER only holds if the generator cannot edit the verifier. The gate runs inside
//     the god's worktree — which the god may write. So a god can turn `bun test` green by deleting the
//     test. `protect` restores those paths from HEAD before every gate run and fails the iteration when
//     they were touched. Without this, rule 6 is decoration.
//
//  3. THE GATE EXECUTES THE GOD'S CODE. `bun test` runs test files the god just wrote — in our process,
//     as the owner. A Claude god is denied Bash at the tool gate; the gate would hand that capability
//     straight back. So the gate runs under the same seatbelt as a CLI god: it may read its worktree and
//     node_modules, write only its declared product roots plus exact scratch, and cannot read owner $HOME. See docs/GATE-RESULTS.md FINDING 3
//     for the read-confinement rationale — same threat, different door.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { LoopBudget, validateGuards, type LoopGuards, type LoopOutcome } from "./guards";
import { selectGateBackend, resolveExe, type Reapable } from "./backend";
import { GATE_RUNTIME_BIN, gateEnv, gitEnv } from "./env";
import { isLinkedWorktree, restoreWorktreeGitlink } from "./worktree-gitlink";
import { ensureDepsLink } from "./worktree-deps";

/** A gate verdict. `pass` is the exit code, not an opinion. */
export interface GateResult {
  pass: boolean;
  exitCode: number;
  /** Combined stdout+stderr, tail-trimmed. This is verbatim what the god is told it must fix. */
  output: string;
}

/**
 * A gate that hangs would wedge the coordinator — the exact failure inversion exists to prevent.
 *
 * This kill is not a belt-and-braces backstop, it is the ONLY one. Measured while building the spike:
 * `bun test`'s per-test timeout runs on the event loop, so it cannot interrupt a synchronous infinite
 * loop — a naive recursive fib(90) in a test file blocked the runner indefinitely and no test timeout
 * fired. A god can write such a test by accident. `timeout(1)` does not exist on macOS. So: here.
 */
const GATE_TIMEOUT_MS = 5 * 60_000;
/** The god sees the tail: a test runner prints the failures and the summary last. */
const GATE_OUTPUT_CHARS = 4000;

/** A lockfile diff means an install ran — forbidden to gods (sandbox has no network). Matched by basename. */
const LOCKFILES = ["bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];
/** ponytail: convention-match on the filename, not an AST — a god's suppression lives in a `*.test.ts` file. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function tail(s: string): string {
  return s.length <= GATE_OUTPUT_CHARS ? s : "…(trimmed)…\n" + s.slice(-GATE_OUTPUT_CHARS);
}

/**
 * The stall detector's input — and, until 2026-07-20, the reason it had never fired once.
 *
 * LoopBudget.record compares this iteration's fingerprint against the last one and counts a stall on a match
 * (src/guards.ts). The fingerprint used to be the RAW gate tail, and a test runner's tail ends with its own
 * wall-clock: `Ran 556 tests across 41 files. [16.93s]`. MEASURED — two runs of identical code the same
 * afternoon printed `[15.67s]` and `[16.93s]`. Two identical failures therefore never produced two identical
 * fingerprints, `stalled` reset every iteration, and the cheapest guard against a god burning the budget
 * while going nowhere was decoration. Same family as the NaN ceiling: armed-looking, never fires.
 *
 * What survives normalization is WHICH failures happened, not how long they took or in what order a parallel
 * runner printed them. The gate can be ANY command (`gate.kind === "command"`), so this must stay
 * format-agnostic — no parsing of bun's output shape, which would break the moment a phase uses a different
 * gate.
 *
 * The named trade-off: over-normalizing risks a FALSE stall (two genuinely different outputs collapsing to
 * one fingerprint), which stops a loop that was progressing. Each rule below is therefore narrow and covers
 * something provably volatile. Sorting lines only removes ordering — different content still differs.
 *
 * ponytail: returns the normalized string, not a hash. guards.ts compares strings either way, the tail is
 * already capped at 4000 chars, and an unhashed fingerprint has no collisions and can be eyeballed in a
 * debugger. A hash here would be pure ceremony.
 */
export function gateFingerprint(exitCode: number, output: string): string {
  const normalized = output
    // eslint-disable-next-line no-control-regex -- ANSI colour codes differ between TTY and pipe
    .replace(/\[[0-9;]*m/g, "")
    // `[16.93s]`, `12ms`, `1.2 µs` — the literal thing that broke this guard
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|µs|us|s|m)\b/g, "<dur>")
    // shas, uuids, object addresses: a fresh mkdtemp/commit every run
    .replace(/\b[0-9a-f]{7,}\b/gi, "<hex>")
    // /var/folders/xy/T/olympuz-reg-AbC123 — a new temp dir per run
    .replace(/(?:\/private)?\/(?:tmp|var\/folders)\/\S+/g, "<tmp>");
  return [
    String(exitCode),
    ...normalized
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .sort(),
  ].join("\n");
}

function git(cwd: string, args: string[]): { code: number; out: string } {
  // gitEnv, not the ambient env: the gate runs from a pre-commit hook, which exports GIT_DIR at the OUTER
  // repo and would make `-C cwd` a no-op — this function would then report churn for a tree it never read.
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { env: gitEnv() });
  return { code: r.exitCode, out: new TextDecoder().decode(r.stdout) };
}

/** worktree-relative `file` sits at or under `root` (a protect entry). Paths are '/'-joined, both relative. */
function isUnder(file: string, root: string): boolean {
  return file === root || file.startsWith(root.endsWith("/") ? root : root + "/");
}

/**
 * Pin the gate's own inputs to their HEAD state. A protected path means "this must be byte-for-byte what
 * HEAD has, or absent if HEAD has nothing" — and any deviation is tampering, restored before the gate runs.
 *
 * Two ways a god games the gate, both closed here:
 *   · MODIFY / DELETE a tracked protected file (weaken or remove the test) → `git checkout HEAD` restores it.
 *   · INJECT an untracked file that hijacks the runner. An adversarial review proved this live: a `bunfig.toml`
 *     the god adds — never in HEAD — carries `[test] preload=["cheat.ts"]`, and `bun test` runs cheat.ts
 *     (which calls process.exit(0)) BEFORE any assertion fails. `git checkout` deliberately ignores untracked
 *     files, so detection-by-diff alone misses it. So a pinned path that is untracked-but-present is removed.
 * The god's legitimate new SOURCE files are never pinned, so its actual work survives — only the named gate
 * surface (tests + runner config) is held to HEAD.
 */
export function restoreProtected(worktree: string, protect: string[]): string[] {
  if (!protect.length) return [];

  // Tracked protected paths modified or deleted vs HEAD → restore from HEAD. -z: git quotes non-ASCII
  // names otherwise and the split would corrupt them (CONSTRAINTS.md).
  const diff = git(worktree, ["diff", "-z", "--name-only", "HEAD", "--", ...protect]);
  if (diff.code !== 0) throw new Error(`gate cannot verify its own integrity: git diff failed in ${worktree}`);
  const modified = diff.out.split("\0").filter(Boolean);

  // Untracked files under a pinned path are injections a glob gate (`bun test`) still executes: a new
  // test file dropped into a protected tests/ dir, or a bunfig.toml preload. git diff never lists them
  // and git checkout never removes them — so detect with ls-files and remove with a pathspec-scoped clean.
  const others = git(worktree, ["ls-files", "-z", "--others", "--exclude-standard", "--", ...protect]);
  if (others.code !== 0) throw new Error(`gate cannot verify its own integrity: git ls-files failed in ${worktree}`);
  const injected = others.out.split("\0").filter(Boolean);

  // `git checkout HEAD -- a b` is ALL-OR-NOTHING across its pathspecs: one path HEAD never had (a `protect`
  // entry a caller always includes regardless of whether it exists yet — src/zeus.ts appends bunfig.toml +
  // bunfig.toml.local to EVERY bun-gate node, and neither is tracked in this repo) fails the WHOLE command
  // and restores NOTHING, including a real tampered file passed in the same call. Measured: `git checkout
  // HEAD -- a.txt nonexistent.txt` leaves a.txt untouched and exits 1. So restore one path at a time, and
  // only report the ones actually restored — a path HEAD never had cannot be "restored" from it, and the
  // caller's message must not claim otherwise.
  const restored: string[] = [];
  const removed: string[] = [];
  for (const path of modified) {
    if (git(worktree, ["cat-file", "-e", `HEAD:${path}`]).code !== 0) {
      // A protected path that `git diff HEAD` reports yet HEAD does NOT contain is an ADDED protect file —
      // and if it reached this loop rather than `ls-files --others`, it is STAGED (an untracked add would be
      // in `injected` instead, invisible to `diff HEAD`). This is exactly the shape a MERGE produces: the
      // mission-acceptance integration tree and the landing candidate both `git merge` the god's branch,
      // which STAGES every file it adds — so a `bunfig.toml` the god ships is staged-added, missed by
      // `ls-files --others`, and skipped here by the old `continue`. Adversarial audit 2026-07-27 shipped
      // exactly that (`[test] preload` → process.exit(0)) and it greened BOTH the mission judge and the
      // landing gate — the work reached the target. A protect file that HEAD never had cannot be restored;
      // it can only be REMOVED, the same verdict `clean` gives its untracked twin.
      git(worktree, ["rm", "-f", "-q", "--ignore-unmatch", "--", path]);
      removed.push(path);
      continue;
    }
    git(worktree, ["checkout", "HEAD", "--", path]);
    restored.push(path);
  }
  if (injected.length) git(worktree, ["clean", "-fd", "--", ...protect]); // scoped to protect roots — the god's real new source elsewhere is untouched

  return [...restored, ...injected, ...removed];
}

/**
 * Which gate-gaming signals a single ADDED line carries. `restoreProtected` closes "delete the test";
 * these close "keep the test but neuter it": skip/only/todo the assertion, `@ts-ignore` the type error,
 * `eslint-disable` the lint, or `process.exit(0)` before an assertion runs — the god silences the check
 * instead of fixing the code. Type/lint suppressions are gate-gaming in any file; the test modifiers and
 * a bare `process.exit(0)` only read as tampering inside a test file, so they are scoped to one.
 */
function suppressionsIn(line: string, file: string): string[] {
  const found: string[] = [];
  if (line.includes("@ts-ignore")) found.push("@ts-ignore");
  if (line.includes("@ts-expect-error")) found.push("@ts-expect-error");
  // @ts-nocheck disables type-checking for the WHOLE file — strictly stronger than @ts-ignore, and a red-team
  // slipped a type error past the gate with it because it was not on this list. Catch it too.
  if (line.includes("@ts-nocheck")) found.push("@ts-nocheck");
  if (line.includes("eslint-disable")) found.push("eslint-disable");
  if (TEST_FILE.test(file)) {
    // Match `.skip`/`.only`/`.todo`, their `If`/no-suffix cousins bun/jest actually ship (`skipIf`, `todoIf`,
    // `if`, `failing`), and the bracket form `["skip"]` a red-team used to dodge the dot-only regex. Executed
    // and measured: the old skip/only/todo-only list missed `test.skipIf(`, `describe.skipIf(`, `test.if(`,
    // `test.failing(` outright — a forgeable marker defense. `skipIf`/`todoIf` are listed BEFORE their bare
    // `skip`/`todo` prefixes: without the trailing `\b` this decides which one a leftmost-alternative match
    // reports (a red-team red-flag: `test.skipIf(` mislabeled as plain `.skip`), and ordering the longer form
    // first keeps the reported label correct regardless.
    const mod = line.match(/(?:\.|\[\s*["'])(skipIf|todoIf|failing|skip|only|todo|if)\b/);
    if (mod) found.push(mod[0]);
    // `xtest(...)` / `xdescribe(...)` are jest-style skip aliases: bare calls, not `.method()` — nothing to
    // anchor a leading dot/bracket on, so they need their own word-boundaried check.
    const xform = line.match(/\b(xtest|xdescribe)\s*\(/);
    if (xform) found.push(xform[1]!);
    if (/process\.exit\(\s*0\s*\)/.test(line)) found.push("process.exit(0)");
  }
  return found;
}

/**
 * Scan the god's ADDED lines (a `+` in `git diff -M HEAD`) for gate-gaming suppressions. ADDED-only is the
 * whole trick: a suppression already in HEAD is the gate's own baseline, not the god's tampering, so it
 * must never false-positive — only what THIS iteration introduced counts. Protected paths are excluded
 * because `restoreProtected` already reverted them; re-flagging here would double-count the same edit.
 * Rename-aware for the same reason: a legitimate MOVE of a file is not tampering just because the diff
 * machinery cannot pair it, and every suppression already sitting in HEAD is the baseline regardless of
 * which path it currently lives under.
 *
 * ponytail: parses the unified diff by hand (track the current file from the `+++ b/` header, read `+`
 * lines) rather than pulling a patch library — one pass, no deps. Ceiling: a non-ASCII worktree-relative
 * path git would quote in the patch header is out of scope (repo filenames are ASCII); the untracked-new-file
 * case is `restoreProtected`'s domain, not this scan's (`git diff HEAD` lists tracked changes only). A
 * whole test file DELETED (not moved) is a known separate gap: the scan only reads ADDED lines, so a
 * deletion produces none to flag — that is `restoreProtected`'s territory too, not fixed here. A SPLIT
 * move (content copied out of an existing file into a new one, old file merely truncated rather than
 * deleted) is also out of reach in principle, not just in this implementation: git's own rename detector
 * cannot pair a partial extraction either, so the moved lines read as newly added in the new file — the
 * same way they would for git itself.
 */
export function scanTamper(
  worktree: string,
  protect: string[],
  changedFiles?: string[],
): { suppressions: string[]; lockfileTouched: boolean } {
  let changed = changedFiles;
  if (!changed) {
    // -z so git does not quote non-ASCII names and corrupt the split (same rationale as restoreProtected).
    // -M: explicit rename detection, not left to the ambient `diff.renames` git config — this list feeds
    // the filter below, and a config-dependent pairing here would make that filter config-dependent too.
    const names = git(worktree, ["diff", "-M", "-z", "--name-only", "HEAD"]);
    if (names.code !== 0) throw new Error(`gate cannot scan for tampering: git diff failed in ${worktree}`);
    changed = names.out.split("\0").filter(Boolean);
  }

  const lockfileTouched = changed.some((f) => LOCKFILES.includes(f.split("/").pop() ?? ""));

  let suppressions: string[] = [];
  if (changed.length) {
    // One UNSCOPED, rename-aware diff — not `git diff HEAD -- ...changed`. Pathspec-scoping to a bare
    // name list is what breaks rename pairing: for a renamed file the old path is absent from the
    // pathspec (only the new name was in `changed`), so git has nothing to pair the new path against and
    // reports it as 100% ADDED — every pre-existing suppression line already in HEAD, merely relocated,
    // then reads as something the god just wrote. Measured: git pairs a real move in this repo
    // (src/token-confinement.test.ts → tests/harness/token-confinement.test.ts) as a rename at 65%
    // similarity when diffed normally, and does NOT when driven through that `-- <names>` pathspec.
    // `-M` makes rename detection explicit here too, for the same config-independence reason as above.
    // `changed` is still applied, but as a post-hoc filter on parsed file sections rather than a pathspec —
    // that keeps the documented contract for a caller-supplied `changedFiles` (only report within that set)
    // without feeding it back into git as a pathspec, which is the mechanism that broke pairing.
    const patch = git(worktree, ["diff", "-M", "HEAD"]);
    if (patch.code !== 0) throw new Error(`gate cannot scan for tampering: git diff failed in ${worktree}`);
    const changedSet = new Set(changed);

    let file = "";
    let skip = true; // until a header names a file, and stays true across a protected/deleted/unlisted file's hunk
    for (const line of patch.out.split("\n")) {
      if (line.startsWith("+++ ")) {
        const p = line.slice(4); // "+++ b/path" or "+++ /dev/null" for a deletion
        file = p === "/dev/null" ? "" : p.replace(/^b\//, "");
        skip = !file || !changedSet.has(file) || protect.some((r) => isUnder(file, r));
        continue;
      }
      if (skip || !line.startsWith("+")) continue; // "+++ " already handled; content "+" lines remain
      for (const sig of suppressionsIn(line.slice(1), file)) suppressions.push(`${file}: ${sig}`);
    }
  }

  return { suppressions, lockfileTouched };
}

export interface GateSpec {
  stop: LoopGuards["stopCondition"];
  worktree: string;
  /** Paths (worktree-relative) the gate owns and the god may not edit. Empty = the gate is game-able. */
  protect?: string[];
  /** Extra read roots the gate needs beyond its worktree — node_modules, the runtime binary. */
  readRoots?: string[];
  /** Existing worktree-relative roots an action may mutate. Undefined keeps ordinary whole-worktree gates. */
  writeRoots?: string[];
  /** Coordinator-only exception for a trusted landed regression suite. Candidate/default gates get no network. */
  trustedNetwork?: "loopback";
  /** Escape hatch for tests. Production gates run confined; see rule 3 above. */
  sandbox?: boolean;
  /** Абсолютный путь к node_modules координатора. Задан — судья ставит его ссылкой в дерево перед вердиктом. */
  depsLink?: string;
  /** Wall-clock ceiling. A hung gate is a failed gate, never a hung swarm. */
  timeoutMs?: number;
}

/** Run one gate, once. Exported raw so it can be exercised without a loop around it. */
/**
 * Remove gate scratch left behind by a crashed predecessor — coordinator litter, never the god's work.
 *
 * Since phase 11 the scratch is minted INSIDE the worktree, so a process death between mint and runGate's
 * `finally` leaves an untracked directory in a tree the tamper scan is built to police. Charging that to the
 * god is a false GATE TAMPERING naming a path it never wrote, so this runs FIRST, above every scan.
 *
 * Two deliberate narrownesses: only this exact prefix is touched, and a symlink wearing that name is UNLINKED
 * rather than walked. The directory being swept sits in a tree the god may write, so a path the god chose must
 * never become a path this recurses through.
 */
function sweepStaleScratch(worktree: string): void {
  const root = realpathSync(worktree);
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.name.startsWith(".olympuz-gate-tmp-")) continue;
    const stale = join(root, e.name);
    if (e.isSymbolicLink()) unlinkSync(stale);
    else rmSync(stale, { recursive: true, force: true });
  }
}

export async function runGate(spec: GateSpec): Promise<GateResult> {
  // The gate runs UNCONFINED host git in the god's tree — restoreProtected and scanTamper both do (git diff,
  // ls-files, checkout, clean). A god that redirected its worktree `.git` during its run would make those
  // execute config-driven code on the host (RED-TEAM 2026-07-20: the gate was the 4th such site). Reset the
  // git-link to trusted values FIRST, before any of them. Guarded because the gate also runs on plain-repo
  // test fixtures, which have no admin dir and no redirect vector (their `.git` is a real, untouched dir).
  if (isLinkedWorktree(spec.worktree)) restoreWorktreeGitlink(spec.worktree);
  // Та же дисциплина, на шаг дальше: судья обязан считать ЗАВИСИМОСТИ из дерева координатора, а не из того,
  // что бог оставил под именем `node_modules`. Снять нашу ссылку бог может (это его дерево — замерено, `rm`
  // проходит) и положить на её место свой каталог; тогда гейт резолвил бы подсунутый пакет и мог позеленеть
  // на подделке. Ссылка восстанавливается ПЕРЕД каждым вердиктом, рядом с восстановлением git-link и
  // `protect` — по той же причине, что и они: доверенное состояние ставит тот, кто судит. Без `depsLink`
  // (фикстуры, голые репо) — no-op, как и раньше.
  //
  // Провал — КРАСНЫЙ ВЕРДИКТ, не бросок и не «поехали дальше». Не бросок: см. абзац ниже про $7.00,
  // учтённые как ноль, — эта функция трогает каталог, которым распоряжается бог. Не «дальше»: без
  // доверенной ссылки гейт резолвил бы то, что бог оставил под этим именем, и мог бы позеленеть на
  // подделке; судья, не сумевший взвести своё доверенное состояние, обязан закрываться, а не смягчаться.
  if (spec.depsLink) {
    const failure = ensureDepsLink(spec.worktree, spec.depsLink);
    if (failure) {
      return {
        pass: false,
        exitCode: 1,
        output:
          `GATE UNRUNNABLE — координатор не смог поставить доверенную ссылку на зависимости в твоём worktree: ${failure}\n` +
          `Судить без неё нельзя: гейт резолвил бы то, что лежит у тебя под именем node_modules. ` +
          `Не создавай и не подменяй node_modules — зависимости даёт координатор.`,
      };
    }
  }
  // A THROW out of runGate is not a red gate — it unwinds through buildVerify into zeus's node catch, which
  // builds a digest with hardcoded `spentUsd: 0, spentTokens: 0`. Every ceiling in this project decrements by
  // REPORTED spend, so a god that can make runGate throw burns the subscription while the ceiling stands
  // still — the exact defect measured 2026-07-20 and re-opened by moving scratch into a directory the god
  // owns: `chmod 500` on a scratch-named directory made `rmSync` throw with EACCES, and two paid god runs
  // ($7.00 / 240k tokens) were accounted as zero (measured 2026-07-26). The god's own worktree state must
  // therefore produce a VERDICT, never an exception.
  try {
    sweepStaleScratch(spec.worktree);
  } catch (e) {
    return {
      pass: false,
      exitCode: 1,
      output:
        `GATE UNRUNNABLE — the coordinator could not clear its scratch directory in your worktree: ` +
        `${e instanceof Error ? e.message : String(e)}\n` +
        `A path named .olympuz-gate-tmp-* belongs to the gate, not to you. Remove it, and do not create, ` +
        `chmod or lock anything with that name.`,
    };
  }
  const tampered = restoreProtected(spec.worktree, spec.protect ?? []);
  if (tampered.length) {
    // Not a gate failure to be debugged — a refusal. The god changed what it is being measured against.
    return {
      pass: false,
      exitCode: 1,
      output:
        `GATE TAMPERING — you modified files the gate owns: ${tampered.join(", ")}\n` +
        `They have been restored from HEAD. The gate measures your source against tests you do not get to write.\n` +
        `Fix the code so the existing checks pass. Editing, weakening or deleting them is not a solution.`,
    };
  }

  // Second tamper class: the god kept the checks but neutered them (skip/ignore/disable/exit) or edited a
  // lockfile. Same refusal shape as above — a fail-closed no, not a red to debug. Cheap: reuses git diff.
  const scan = scanTamper(spec.worktree, spec.protect ?? []);
  if (scan.suppressions.length || scan.lockfileTouched) {
    const parts: string[] = [];
    if (scan.suppressions.length) parts.push(`suppressions you added: ${scan.suppressions.join(", ")}`);
    if (scan.lockfileTouched) parts.push(`you modified a lockfile (installs are forbidden to you)`);
    return {
      pass: false,
      exitCode: 1,
      output:
        `GATE TAMPERING — you silenced the check instead of fixing the code: ${parts.join("; ")}.\n` +
        `Remove it and make the real code pass. Skipping a test, ignoring a type or lint error, exiting a test\n` +
        `early or editing a lockfile is not a solution.`,
    };
  }

  if (spec.stop.kind === "marker") {
    const file = join(spec.worktree, spec.stop.file);
    const text = existsSync(file) ? await Bun.file(file).text() : "";
    const pass = text.includes(spec.stop.marker);
    return {
      pass,
      exitCode: pass ? 0 : 1,
      output: `marker ${JSON.stringify(spec.stop.marker)} ${pass ? "found in" : "NOT found in"} ${spec.stop.file}`,
    };
  }

  // The gate executes the god's just-written code, so it runs CONFINED. A backend turns (worktree,
  // readRoots, cmd) into a spawnable argv + a reaper (src/backend.ts): the seatbelt backend (macOS-native,
  // shipped) resolves the host `bun`, wraps it in a seatbelt profile, and puts it in its own perl-setsid
  // process group; the docker backend runs the image's linux bun in a worktree-only, --network none
  // container. Selection is fail-closed — a gate never runs unconfined. `sandbox:false` (tests only) skips it.
  const limit = spec.timeoutMs ?? GATE_TIMEOUT_MS;
  const declaredWrites = spec.writeRoots?.map((root) => {
    if (root.trim() === "" || isAbsolute(root) || root.split("/").includes("..") || root.includes("\0")) {
      throw new Error(`gate writeRoot must be a safe worktree-relative path: ${JSON.stringify(root)}`);
    }
    return resolve(spec.worktree, root);
  });
  // Scratch lives INSIDE the worktree (phase 11): the worktree is the isolation unit, so the gate's only
  // writable temp must not sit in a shared system directory every other process can reach. The two
  // consequences of that move are handled elsewhere and named here so neither is lost:
  //   · stale scratch from a crashed predecessor is swept by `sweepStaleScratch`, which runs at the very TOP
  //     of runGate — before the tamper scan, which would otherwise charge the coordinator's litter to the god;
  //   · it must never ride into a commit — see COMMIT_EXCLUDE_PATHSPECS in src/commit.ts.
  let scratch: string;
  try {
    scratch = mkdtempSync(join(realpathSync(spec.worktree), `.olympuz-gate-tmp-${process.pid}-`));
  } catch (e) {
    // Same reasoning as the sweep above: `chmod 500` on the worktree ROOT made this throw EACCES, and the
    // throw was worth an unbounded, unaccounted budget burn. A verdict costs the god its iteration; an
    // exception costs the owner the ceiling.
    return {
      pass: false,
      exitCode: 1,
      output:
        `GATE UNRUNNABLE — the coordinator could not create its scratch directory in your worktree: ` +
        `${e instanceof Error ? e.message : String(e)}\n` +
        `The worktree root must stay writable by the process that runs your gate.`,
    };
  }
  // Рантайм — в PATH гейта ЧЕРЕЗ SCRATCH, до выбора backend: обе ветки (конфайнмент и sandbox:false) берут
  // env из `gateEnv`, а он кладёт в PATH `<scratch>/runtime-bin`. Нужно потому, что тест внутри гейта имеет
  // право спавнить ГОЛОЕ имя `bun` — замерено на фазе 07 (hermes/codex, $8.11): замороженный контракт делает
  // `Bun.spawnSync(["bun", LINT])`, ловил `Executable not found in $PATH`, гейт краснел поверх УЖЕ ГОТОВОЙ
  // работы, а луп читал это как «не двигается» и сжигал итерации до `stalled`.
  //
  // ОБЁРТКА-СКРИПТ, а не симлинк: под профилем исполним только тот путь, который выдан грантом, а грант
  // канонизируется — симлинк не исполнить в принципе (тот же вывод, что часом раньше у провайдера codex).
  // Скрипт исполняется сам (шебанг `/bin/sh`) и передаёт управление реальному бинарю, который грантом выдан.
  // Через scratch, а не через `dirname(process.execPath)`: рантайм лежит под `$HOME`, а PATH кода кандидата
  // не имеет права нести домашний путь владельца.
  try {
    const runtimeBin = join(realpathSync(scratch), GATE_RUNTIME_BIN);
    mkdirSync(runtimeBin, { recursive: true });
    writeFileSync(join(runtimeBin, "bun"), `#!/bin/sh\nexec ${JSON.stringify(realpathSync(process.execPath))} "$@"\n`, { mode: 0o755 });
  } catch {
    // Не смогли положить обёртку — гейт всё равно поедет: свой `cmd[0]` backend резолвит сам. Потеряется
    // только находимость ГОЛОГО имени внутри тестов, и это станет видно красным, а не тишиной.
  }

  try {
    let argv: string[];
    let env: Record<string, string>;
    let reap: (p: Reapable) => void;
    if (spec.sandbox === false) {
      const [exe, ...rest] = spec.stop.cmd;
      const resolved = resolveExe(exe!);
      argv = [existsSync(resolved) ? realpathSync(resolved) : resolved, ...rest];
      env = gateEnv(realpathSync(spec.worktree), realpathSync(scratch));
      reap = (p) => {
        try {
          p.kill(9);
        } catch {}
      };
    } else {
      const confined = selectGateBackend().confine({
        worktree: spec.worktree,
        readRoots: spec.readRoots ?? [],
        writeRoots: declaredWrites,
        scratch,
        network: spec.trustedNetwork === "loopback" ? "loopback" : "none",
        cmd: spec.stop.cmd,
      });
      argv = confined.argv;
      env = confined.env;
      reap = confined.reap;
    }

    const proc = Bun.spawn(argv, { cwd: spec.worktree, stdout: "pipe", stderr: "pipe", env });

    // Drain the pipes in the background. Completion is the child EXITING or the clock RUNNING OUT — never
    // "the pipe reached EOF". Awaiting EOF is exactly the wedge: a surviving grandchild holds it open forever.
    const dec = new TextDecoder();
    let out = "";
    let err = "";
    const drain = Promise.allSettled([
      (async () => { for await (const c of proc.stdout as any) out += dec.decode(c); })(),
      (async () => { for await (const c of proc.stderr as any) err += dec.decode(c); })(),
    ]);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((res) => { timer = setTimeout(() => res("timeout"), limit); });
    const killed = (await Promise.race([proc.exited.then(() => "exited" as const), timedOut])) === "timeout";
    if (timer) clearTimeout(timer);

    // Bounded drain, both paths: on a clean exit the pipes EOF fast; on a hang (kill OR clean-exit-with-orphan)
    // a survivor may hold them open, so we cap the wait, then reap the group so nothing lingers into the next
    // iteration of an autonomous swarm.
    if (killed) reap(proc);
    await Promise.race([drain, Bun.sleep(1000)]);
    reap(proc);

    const exitCode = killed ? -1 : await proc.exited;
    // A killed gate must not read as a normal red: the god has to know it hung, or it will "fix" an
    // assertion its code never actually reached.
    const combined = out + err;
    const output = killed ? `GATE TIMEOUT after ${limit}ms — killed (did not terminate).\n${tail(combined)}` : tail(combined);
    return { pass: exitCode === 0 && !killed, exitCode, output };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export type LoopEvent =
  | { kind: "iteration"; n: number }
  | { kind: "god"; n: number; ok: boolean; costUsd: number; tokens?: number | null }
  | { kind: "gate"; n: number; pass: boolean; exitCode: number; output: string }
  | { kind: "budget"; spentUsd: number; budgetUsd: number }
  | { kind: "stop"; reason: LoopResult["reason"] };

export interface LoopResult {
  verdict: "passed" | "failed";
  reason: "passed" | LoopOutcome["stop"];
  iterations: number;
  spentUsd: number;
  /** Tokens the provider reported across the loop. Same-provider sum — see LoopSpend. */
  spentTokens: number;
  /** Iterations that reported no usage at all. >0 means spentUsd/spentTokens both UNDERCOUNT this loop. */
  blindIterations: number;
  gate: GateResult;
}

export interface BuildVerify {
  /** Validated fail-closed. No caps → no loop → GuardViolation. */
  guards: Partial<LoopGuards> | undefined;
  /**
   * Dispatch the god. `lastGate` is the pre-flight gate on iteration 1, the previous failure after that.
   *
   * `tokens` is what the provider reported for the iteration, or null when it reported nothing — null is
   * "unknown", never "free". The loop stays deliberately dumb about TokenUsage's shape: the caller flattens
   * (and folds in its daimons) so this layer needs no provider knowledge.
   */
  runGod: (lastGate: GateResult, iteration: number) => Promise<{ ok: boolean; costUsd: number; tokens?: number | null }>;
  /** Injected, so the loop's control flow is testable without spawning a process or spending a token. */
  runGate: () => Promise<GateResult>;
  onEvent?: (e: LoopEvent) => void;
}

/**
 * Build → verify → revise, under caps, fail-closed.
 *
 * Failure modes it is built to survive, in the order they actually happen:
 *   - the god never converges     → maxIterations
 *   - the god converges expensively → token_budget (kills the loop with the goal unmet; the ROI guard)
 *   - the god spins in place      → stall (the verifier's verdict has not moved in N iterations)
 * "Until the checker is happy" is not one of the exits. The DOLLAR figure is not one of the exits either,
 * since 2026-07-25: under the owner's subscriptions it is a list-price estimate of limit burn, so crossing
 * it warns once per loop (the `budget` event below) and the work continues — the real ceilings stay terminal.
 */
export async function buildVerify(o: BuildVerify): Promise<LoopResult> {
  const guards = validateGuards(o.guards);
  const budget = new LoopBudget(guards);
  // One warning per loop, not one per iteration past the estimate: a second ping carries no new information,
  // and a channel that repeats itself trains the operator to skim (the exact failure notify.ts's dedup exists for).
  let budgetWarned = false;

  // Pre-flight. The stop condition may already hold — a resumed run after a crash, a goal someone else
  // finished. Asking costs one exit code; finding out by dispatching a god costs a god.
  let gate = await o.runGate();
  o.onEvent?.({ kind: "gate", n: 0, ...gate });
  if (gate.pass) {
    o.onEvent?.({ kind: "stop", reason: "passed" });
    return { verdict: "passed", reason: "passed", iterations: 0, spentUsd: 0, spentTokens: 0, blindIterations: 0, gate };
  }

  for (;;) {
    const exhausted = budget.exhausted();
    if (exhausted) {
      o.onEvent?.({ kind: "stop", reason: exhausted.stop });
      const { stop, ...spend } = exhausted;
      return { verdict: "failed", reason: stop, ...spend, gate };
    }

    const n = budget.iteration + 1;
    o.onEvent?.({ kind: "iteration", n });

    const run = await o.runGod(gate, n);
    o.onEvent?.({ kind: "god", n, ...run });

    gate = await o.runGate();
    o.onEvent?.({ kind: "gate", n, ...gate });

    // The fingerprint is the VERIFIER's state, never the god's self-report. Same verdict, same output,
    // twice running = the loop is spinning. Stricter than diffing the god's artifact on purpose: a god
    // that rewrites code and still cannot move the gate is stalled by any definition worth having.
    // `tokens` absent OR null both mean the provider told us nothing — count the blindness, never a zero that
    // would read as "this iteration was free". `?? 0` only decides what to ADD to the running total; `blind` is
    // what the operator and the node digest actually see.
    const blind = run.tokens === null || run.tokens === undefined;
    budget.record({ costUsd: run.costUsd, tokens: run.tokens ?? 0, blind }, gateFingerprint(gate.exitCode, gate.output));

    // The dollar ESTIMATE is crossed: warn once and keep working (owner decision 2026-07-25 — subscriptions,
    // not per-API billing, so the number is limit burn, not money that ran out). The loop still ends on its
    // real stops: tokens, iterations, stalls — never on this number.
    if (!budgetWarned && budget.spent >= guards.budget.usd) {
      budgetWarned = true;
      o.onEvent?.({ kind: "budget", spentUsd: budget.spent, budgetUsd: guards.budget.usd });
    }

    if (gate.pass) {
      o.onEvent?.({ kind: "stop", reason: "passed" });
      return { verdict: "passed", reason: "passed", ...budget.spend, gate };
    }
  }
}

/** What the god is told after the gate rejected its work. The failure output is the spec for the fix. */
export function reviseGoal(goal: string, gate: GateResult, iteration: number): string {
  if (iteration <= 1) return goal;
  return `${goal}

## Your previous attempt did not pass the gate (iteration ${iteration - 1})

The gate is a deterministic check. It ran and it failed. You do not get to argue with it, and you may not
edit it — it is restored from HEAD before every run. Read the output, fix the cause, do not paper over it.

\`\`\`
${gate.output}
\`\`\``;
}
