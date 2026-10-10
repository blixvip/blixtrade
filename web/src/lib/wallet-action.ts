import { toast, txToast } from "@/components/ui/toast";
import { loadMe } from "./ui";

type Action = "buy" | "sell" | "withdraw";
interface Labels { pending: string; confirmed: string; failed: string; detail?: string; mint?: string; symbol?: string; onReauth?: () => void }
let inFlight = false;

// All real-money controls share one submission lock and the same honest transaction status.
export async function walletAction(action: Action, body: unknown, labels: Labels): Promise<boolean> {
  if (inFlight) { toast("A wallet transaction is already being checked. Wait for its result."); return false; }
  inFlight = true;
  const notice = txToast(labels.pending, labels.detail || "Submitting transaction…", { mint: labels.mint, symbol: labels.symbol });
  try {
    const response = await fetch(`api/account/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    // A 4xx in plain text or HTML (accounts off, a proxy page) is still a clear "no": not "may still land".
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status >= 500) throw new Error("Submission response unavailable");
      notice.fail(labels.failed, result.error || `Request rejected (${response.status})`);
      if (result.confirm) labels.onReauth?.();
      return false;
    }
    const validSignature = typeof result.signature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(result.signature);
    const link = validSignature ? `https://solscan.io/tx/${result.signature}` : "#/account";
    if (result.status === "failed") { notice.fail(labels.failed, result.note || "The transaction failed on chain.", link); return false; }
    if (result.status !== "confirmed" || !validSignature) {
      notice.unknown("Confirmation pending", `${result.note || "The transaction may still land."} Check transaction history before trying again.`, link);
      return false;
    }
    // How long from sending until a block held it: the chip on the right.
    notice.ok(labels.confirmed, labels.detail || "Confirmed on Solana", link, result.landedMs > 0 ? `${(result.landedMs / 1000).toFixed(1)}s` : undefined);
    return true;
  } catch {
    notice.unknown("Confirmation pending", "The response was lost. The transaction may still land. Check transaction history before trying again.", "#/account");
    return false;
  } finally {
    inFlight = false;
    loadMe();
    window.dispatchEvent(new Event("blix:wallet-changed"));
  }
}
