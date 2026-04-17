import { createEdgeRecoSdk } from "@edgereco/sdk";
import type { EdgeRecoSdk, ProfileSnapshot, RankedResponse } from "@edgereco/sdk";
import { useCallback, useEffect, useState } from "react";
import { CandidateGrid } from "./components/CandidateGrid.js";
import { ProfilePanel } from "./components/ProfilePanel.js";

const API_BASE_URL = "http://localhost:8000";
const CONTEXT_TYPE = "homepage";
const LIMIT = 30;

export function App() {
  const [sdk, setSdk] = useState<EdgeRecoSdk | null>(null);
  const [ranked, setRanked] = useState<RankedResponse | null>(null);
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const instance = await createEdgeRecoSdk({ apiBaseUrl: API_BASE_URL });
        await instance.init();
        if (cancelled) return;
        setSdk(instance);
        setProfile(instance.getProfile());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!sdk) return;
    try {
      const response = await sdk.getCandidates({ contextType: CONTEXT_TYPE, limit: LIMIT });
      setRanked(response);
      setProfile(sdk.getProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sdk]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onClick = useCallback(
    async (itemId: string) => {
      if (!sdk) return;
      sdk.trackClick({ itemId, contextType: CONTEXT_TYPE });
      await new Promise((r) => setTimeout(r, 50)); // let profile write settle
      await refresh();
    },
    [sdk, refresh],
  );

  const onFavorite = useCallback(
    async (itemId: string) => {
      if (!sdk) return;
      sdk.trackFavorite({ itemId, contextType: CONTEXT_TYPE });
      await new Promise((r) => setTimeout(r, 50));
      await refresh();
    },
    [sdk, refresh],
  );

  const onReset = useCallback(async () => {
    if (!sdk) return;
    await sdk.resetProfile();
    await refresh();
  }, [sdk, refresh]);

  if (error) return <div className="error">Error: {error}</div>;
  if (!sdk || !ranked || !profile) return <div>Loading EdgeReco demo…</div>;

  return (
    <div className="demo-app">
      <header>
        <h1>EdgeReco — Phase 0 Demo</h1>
        <p>Click items to shape the local profile; the grid reranks live.</p>
      </header>
      <main className="layout" style={{ display: "flex", gap: "2rem" }}>
        <CandidateGrid items={ranked.items} onClick={onClick} onFavorite={onFavorite} />
        <ProfilePanel profile={profile} onReset={onReset} />
      </main>
    </div>
  );
}
