// OS-enforced boundary for CLI gods (Kimi, and any future native CLI).
//
// Why this exists: the Claude SDK gives us canUseTool, so we deny a bad tool call before it runs.
// A native CLI god has no such hook — it runs its own tools in its own process. So the boundary
// moves down to the kernel: seatbelt (sandbox-exec) enforces it regardless of what the model decided.
//
// This profile is DENY-BIASED on the three things that actually hurt:
//   - READS   — denied across the owner's $HOME, re-allowed only for the god's roots. An earlier version
//               denied only writes; an adversarial review proved a god could then read ~/.ssh/id_rsa,
//               ~/.secrets/*, ~/.aws, any .env and exfiltrate them (empirically: $HOME read ALLOWED,
//               TCP egress succeeded). See docs/GATE-RESULTS.md FINDING 3.
//   - WRITES  — denied everywhere, re-allowed only for the god's roots, then the launcher/config are
//               carved back out so a god cannot trojan the binary the owner runs next (FINDING 4).
//   - NETWORK — NOT denied here, and this is deliberate: a CLI god's model is server-side (Kimi calls
//               api.kimi.com), so denying egress kills the god. Read-confinement is the compensating
//               control — with no owner secret readable, open egress has nothing sensitive to send.
//
// ponytail: sandbox-exec is deprecated-but-working and macOS-only. It buys a real kernel boundary today.
// Docker-per-god (D3, phase 2) is the portable structural answer and also confines network; swap this
// out there and keep the ProviderAdapter contract.
import { platform, homedir } from "node:os";
import { writeFileSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Real, symlink-free path. seatbelt sees /private/var/folders, not /var/folders — a non-canonical
 *  deny-carveout silently fails to match while a blanket temp allow does, which is a write-open bug. */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Every directory ABOVE an allowed root, as exact literals, for a metadata-only allow.
 *
 * A confined root that lives under $HOME (every worktree does — the repo is in the owner's home) is reachable
 * only through ancestors the `deny file-read*` above swallows. Most programs never notice: seatbelt checks the
 * resolved path, so opening a file inside an allowed root needs no ancestor stat. `git` is the exception — it
 * walks the chain explicitly and dies before it opens anything (MEASURED 2026-07-28 inside the land gate:
 * `git init` -> "fatal: Invalid path '<HOME>': Operation not permitted", and every later git in the tree
 * -> exit 128). That made the DEFAULT land gate unrunnable for 23 of 65 ./src suites, which was misread as
 * "the suites are self-referential" — they are not; git simply could not start.
 *
 * The grant is as narrow as the problem: `file-read-metadata` (stat, never open) on EXACT literals (never
 * `subpath`, so no child of those directories is matched). Measured delta with the rule on: `stat($HOME)`
 * succeeds; `readdir($HOME)`, `stat($HOME/.ssh)`, reading any file and every write stay EPERM. What leaks is
 * the mode/mtime of directories whose existence the god's own worktree path already spells out.
 */
function ancestorMetadata(roots: string[]): string {
  const dirs = new Set<string>();
  for (const root of roots) {
    let cur = dirname(canonical(root));
    while (cur !== "/" && cur !== "." && cur !== dirname(cur)) {
      dirs.add(cur);
      cur = dirname(cur);
    }
  }
  if (dirs.size === 0) return "";
  return `(allow file-read-metadata ${[...dirs].map((d) => `(literal ${JSON.stringify(d)})`).join(" ")})`;
}

/**
 * The runtime binary itself, as a read root for EVERY god.
 *
 * MEASURED 2026-08-12 on a live dispatch (hephaestus/kimi, phase 06, two runs, both dead at the turn cap):
 *
 *     /bin/bash: bun: command not found
 *     ls: <HOME>/.bun/bin/bun: Operation not permitted
 *
 * PATH is inherited and DOES contain the runtime's directory — the seatbelt is what makes the lookup fail,
 * because the binary sits under $HOME and `deny file-read* $HOME` swallows it. So the god could not run
 * `bun test`, `tsc`, or the project's own gate; it spent every one of its 24 turns hunting for the runtime
 * and died. That is the whole of "successful god dispatches on a product phase: 0 of 3".
 *
 * Not a widening of what a god may DO: it already runs arbitrary commands through its Bash tool, and every
 * one of them is confined by this same profile. What was missing was the ability to check its own work —
 * without it the god is blind and learns the verdict only from the gate, one expensive iteration later.
 *
 * A FILE, never `dirname`: the gate learned that re-allowing the directory of a binary that sits directly in
 * $HOME re-opens all of $HOME (CONSTRAINTS). The ancestors of this path get metadata-only access from
 * `ancestorMetadata`, which is exactly what a PATH lookup needs and nothing more.
 */
export function runtimeReadRoots(): string[] {
  return [canonical(process.execPath)];
}

export class SandboxUnavailable extends Error {}

export interface SandboxPolicy {
  /** Roots the god may write. Everything else is read-only or denied. */
  write: string[];
  /** Roots the god may read beyond system defaults. $HOME is denied except these. */
  read: string[];
  /** Subpaths carved back out of `write` — the launcher binary, config, credentials. Last rule wins. */
  denyWrite?: string[];
  /** Host temp is a real side effect. Gates set false and grant one exact scratch root separately. */
  allowGlobalTemp?: boolean;
  /** CLI providers need egress; candidate gates default to a separate deny-all profile in backend.ts. */
  network?: "allow" | "deny" | "loopback";
  /** Deny inspecting sibling/parent processes, whose argv/env are outside the filesystem policy. */
  processInfo?: "allow" | "deny";
  /** Raw extra profile lines appended LAST (seatbelt: last match wins). The escape hatch for composed
   *  capabilities that need layered allow/deny the fixed shape cannot express — e.g. a daimon-ops grant
   *  that re-opens the repo but re-denies .olympuz except the daimon db. Caller owns correctness. */
  extraRules?: string[];
}

/**
 * Build a seatbelt profile and return the argv prefix that runs a command under it.
 * Seatbelt evaluates rules in order and the LAST match wins — that is why the deny/re-allow/deny-carveout
 * layering below works.
 */
export function sandboxPrefix(policy: SandboxPolicy): string[] {
  if (platform() !== "darwin") {
    // Fail closed. Silently running an ungated CLI god on Linux is exactly the "it said it wouldn't"
    // failure this module exists to prevent.
    throw new SandboxUnavailable("seatbelt sandbox is macOS-only — a CLI god must not run unconfined; use Docker-per-god (D3 phase 2) on this platform");
  }
  if (policy.write.length === 0) throw new SandboxUnavailable("refusing to build a sandbox with no writable root");
  if (policy.read.length === 0) throw new SandboxUnavailable("refusing to build a sandbox with no readable root");

  // Canonicalize every root so the deny/allow rules match the paths seatbelt actually sees.
  const sp = (paths: string[]) => paths.map((p) => `(subpath ${JSON.stringify(canonical(p))})`).join(" ");
  const home = canonical(homedir());
  const tempWrites = policy.allowGlobalTemp === false ? "" : ' (subpath "/private/var/folders") (subpath "/private/tmp")';
  const network = policy.network === "deny"
    ? "(deny network*)"
    : policy.network === "loopback"
      ? `(deny network*)
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))`
      : "";
  const processInfo = policy.processInfo === "deny"
    ? `(deny process-info* mach-task-name mach-task-special-port*)
; KERN_PROCARGS2 is the sysctl path to another process's argv/env. Deny that process family without
; blanket-denying sysctl-read: Bun legitimately reads harmless CPU/OS sysctls during startup.
(deny sysctl-read (sysctl-name-prefix "kern.proc"))
; Bun/libsystem must inspect their own process during startup. Keep that narrow self-read while
; foreign PIDs, sysctl process arguments and Mach task ports remain denied.
(allow process-info* (target self))`
    : "";

  const profile = `(version 1)
(allow default)

; --- ambient authority: candidate gates get neither sockets nor sibling process metadata ---
${network}
${processInfo}

; --- reads: deny the owner's home, re-allow only the god's roots (secrets live in $HOME) ---
(deny file-read* (subpath ${JSON.stringify(home)}))
(allow file-read* ${sp(policy.read)})

; --- ancestors of those roots: stat only, exact directories, so path resolution (git) can walk down ---
${ancestorMetadata(policy.read)}

; --- writes: deny everywhere, re-allow only the caller's roots (plus global temp when requested) ---
(deny file-write*)
(allow file-write* ${sp(policy.write)}${tempWrites} (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr"))
${policy.denyWrite && policy.denyWrite.length ? `\n; --- carve-outs: never writable even inside a writable root (launcher/config persistence vectors) ---\n(deny file-write* ${sp(policy.denyWrite)})` : ""}
${policy.extraRules && policy.extraRules.length ? `\n; --- capability-specific layered rules (last match wins) ---\n${policy.extraRules.join("\n")}` : ""}
`;
  const file = join(mkdtempSync(join(tmpdir(), "olympuz-sb-")), "god.sb");
  writeFileSync(file, profile, { mode: 0o600 });
  return ["sandbox-exec", "-f", file];
}
