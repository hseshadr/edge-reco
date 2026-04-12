import type { ProfileSnapshot } from "@edgereco/sdk";

export interface ProfilePanelProps { profile: ProfileSnapshot; onReset: () => void; }

function AffinityBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="affinity-bar" style={{ display: "inline-block", width: 120, height: 8, background: "#eee" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: "#4a90e2" }} />
    </div>
  );
}

export function ProfilePanel({ profile, onReset }: ProfilePanelProps) {
  const categories = Object.entries(profile.categoryAffinity).sort((a, b) => b[1] - a[1]);
  const tags = Object.entries(profile.tagAffinity).sort((a, b) => b[1] - a[1]);
  return (
    <aside className="profile-panel">
      <h2>Local profile</h2>
      <div className="click-count">Clicks this session: {profile.sessionClickCount}</div>
      <h3>Category affinity</h3>
      {categories.length === 0
        ? <div className="muted">(empty — click some items to start)</div>
        : <ul>{categories.map(([name, value]) => (
            <li key={name}><span className="cat">{name}</span> <AffinityBar value={value} /> <span className="val">{value.toFixed(2)}</span></li>
          ))}</ul>}
      <h3>Tag affinity</h3>
      {tags.length === 0
        ? <div className="muted">(empty)</div>
        : <ul>{tags.map(([name, value]) => (<li key={name}>{name}: {value.toFixed(2)}</li>))}</ul>}
      <h3>Recently viewed</h3>
      {profile.recentlyViewed.length === 0
        ? <div className="muted">(empty)</div>
        : <ol>{profile.recentlyViewed.map((id) => (<li key={id}>{id}</li>))}</ol>}
      <button type="button" onClick={onReset}>Reset profile</button>
    </aside>
  );
}
