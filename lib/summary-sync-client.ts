type SyncOptions = {
  getHeaders: () => Promise<Record<string,string>>;
  waitForSaves: () => Promise<unknown>;
  onError: (message: string) => void;
  fetcher?: typeof fetch;
  schedule?: typeof setTimeout;
  clear?: typeof clearTimeout;
};

// Coalesce saves and retry a busy sync only while this page and consent remain active.
export function scheduleSummarySync(options: SyncOptions) {
  const fetcher = options.fetcher || fetch;
  const schedule = options.schedule || setTimeout;
  const clear = options.clear || clearTimeout;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  async function attempt() {
    try {
      await options.waitForSaves();
      if (cancelled) return;
      const headers = await options.getHeaders();
      const response = await fetcher("/api/connections/google",{ headers });
      if (!response.ok) return;
      const status = await response.json();
      if (cancelled || !status.enabled) return;
      const synced = await fetcher("/api/connections/google/sync",{ method: "POST",headers });
      if (cancelled) return;
      if (synced.status === 409) { timer = schedule(attempt,65000); return; }
      if (!synced.ok) {
        const result = await synced.json();
        if (!cancelled) options.onError(result.error || "Google 摘要尚未同步，原始记录已保留。");
      }
    } catch {
      if (!cancelled) options.onError("摘要同步网络中断，Supabase 原始记录不受影响。");
    }
  }
  timer = schedule(attempt,2500);
  return () => { cancelled = true; clear(timer); };
}
