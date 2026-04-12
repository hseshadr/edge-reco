import { useState } from "react";
import type { ScoreBreakdown as Breakdown } from "@edgereco/sdk";

export interface ScoreBreakdownProps { breakdown: Breakdown; }

export function ScoreBreakdown({ breakdown }: ScoreBreakdownProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="score-breakdown">
      <button type="button" onClick={() => setOpen((p) => !p)} aria-expanded={open}>
        {open ? "Hide" : "Show"} breakdown
      </button>
      {open && (
        <dl>
          <dt>Popularity</dt><dd>{breakdown.popularity.toFixed(3)}</dd>
          <dt>Category match</dt><dd>{breakdown.categoryMatch.toFixed(3)}</dd>
          <dt>Tag match</dt><dd>{breakdown.tagMatch.toFixed(3)}</dd>
          <dt>Freshness</dt><dd>{breakdown.freshness.toFixed(3)}</dd>
          <dt>Repetition penalty</dt><dd>{"\u2212"}{breakdown.repetitionPenalty.toFixed(3)}</dd>
        </dl>
      )}
    </div>
  );
}
