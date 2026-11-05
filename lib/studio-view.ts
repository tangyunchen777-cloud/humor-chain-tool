import type { Run } from "./studio";

// A new draft must never inherit the previously selected chain's history.
// Ignore a selected run ID left over from a different chain, too.
export function getChainHistory(
  allRuns: Run[],
  chainId: string | null,
  selectedRun: string | null,
) {
  const runs = chainId ? allRuns.filter((run) => run.chain_id === chainId) : [];
  return {
    runs,
    viewed: runs.find((run) => run.id === selectedRun) ?? runs[0],
  };
}
