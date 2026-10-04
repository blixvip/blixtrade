// The radar's HTTP API (docs/API.md). Same contract as the classic page: errors are { error: "sentence" }.
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/${path}`, { signal: AbortSignal.timeout(init?.method ? 120_000 : 20_000), ...init });
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(body.error || String(r.status));
  return body as T;
}

export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
