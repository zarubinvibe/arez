// The Zeus-side half of the plan-gate. Replaces the blocking `prompt()` (which only works with a human at
// the terminal) with a poll of the mailbox the server writes to — so the owner can approve from the phone.
//
// Authority stays here, in the Zeus thread, by construction: Zeus computes the plan hash from ITS OWN
// in-memory DAG and polls for a decision keyed by that hash. The server can only set the decision on a plan
// Zeus already proposed (requestGate) — it cannot inject a plan, and it never calls markMissionApproved.
import { dagHash } from "./hash";
import type { Dag } from "./dag";
import type { Store } from "./state";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PollingGateOpts {
  /** Poll interval. 750ms is imperceptible to a human and negligible load on a local SQLite read. */
  pollMs?: number;
  /**
   * How long to wait before giving up. Default: forever — D8's "closed the phone mid-run, opened it hours
   * later, approved" is the normal case, so a risky mission parks until the owner answers. A finite timeout
   * is opt-in (CI) and is treated as a REJECTION (fail-closed: an unattended risky plan must never auto-run).
   */
  timeoutMs?: number;
  /** Called once, when Zeus starts waiting — lets the CLI tell the operator where to approve. */
  onWaiting?: (info: { missionId: string; planHash: string }) => void;
}

/**
 * An approvePlan that publishes the pending plan to the mailbox and waits for the server to record the
 * human's decision. Shape matches MissionDeps.approvePlan: (dag, missionId) => Promise<boolean>.
 */
export function pollingApprovePlan(store: Store, opts: PollingGateOpts = {}): (dag: Dag, missionId: string) => Promise<boolean> {
  const pollMs = opts.pollMs ?? 750;
  return async (dag, missionId) => {
    const planHash = dagHash(dag);
    // Publish the exact plan + its hash for the phone to render and bind its approval to. Idempotent, so a
    // resume that re-enters the gate for the same plan just re-reads the pending row.
    store.requestGate(missionId, planHash, JSON.stringify(dag));
    opts.onWaiting?.({ missionId, planHash });

    const deadline = opts.timeoutMs != null ? Date.now() + opts.timeoutMs : null;
    for (;;) {
      const decision = store.getGateDecision(missionId, planHash);
      if (decision === "approve") return true;
      if (decision === "reject") return false;
      if (deadline != null && Date.now() >= deadline) return false; // fail-closed timeout = reject
      await sleep(pollMs);
    }
  };
}
