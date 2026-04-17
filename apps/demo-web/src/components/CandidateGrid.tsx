import type { RankedItem } from "@edgereco/sdk";
import { ScoreBreakdown } from "./ScoreBreakdown.js";

export interface CandidateGridProps {
  items: readonly RankedItem[];
  onClick: (itemId: string) => void;
  onFavorite: (itemId: string) => void;
}

export function CandidateGrid({ items, onClick, onFavorite }: CandidateGridProps) {
  return (
    <div className="candidate-grid">
      <h2>Candidates ({items.length})</h2>
      <ul>
        {items.map((item, index) => (
          <li key={item.id} className="candidate-card" data-item-id={item.id}>
            <div className="rank">#{index + 1}</div>
            <div className="title">{item.title}</div>
            <div className="meta">
              <span className="category">{item.category}</span>
              <span className="tags">{item.tags.join(", ")}</span>
            </div>
            <div className="score">score: {item.finalScore.toFixed(3)}</div>
            <ScoreBreakdown breakdown={item.scoreBreakdown} />
            <div className="actions">
              <button type="button" onClick={() => onClick(item.id)}>
                Click
              </button>
              <button type="button" onClick={() => onFavorite(item.id)}>
                &#9733; Favorite
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
