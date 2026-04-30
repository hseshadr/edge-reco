from edgereco.search.hybrid import reciprocal_rank_fusion


def test_rrf_merges_two_lists() -> None:
    keyword_results = [("a", 10.0), ("b", 8.0), ("c", 5.0)]
    vector_results = [("b", 0.95), ("d", 0.90), ("a", 0.85)]
    merged = reciprocal_rank_fusion(keyword_results, vector_results, k=60)
    ids = [r[0] for r in merged]
    assert "b" in ids[:2]
    assert "a" in ids[:3]

def test_rrf_handles_empty_keyword() -> None:
    merged = reciprocal_rank_fusion([], [("a", 0.9)], k=60)
    assert len(merged) == 1
    assert merged[0][0] == "a"

def test_rrf_handles_empty_vector() -> None:
    merged = reciprocal_rank_fusion([("a", 5.0)], [], k=60)
    assert len(merged) == 1

def test_rrf_deduplicates() -> None:
    merged = reciprocal_rank_fusion(
        [("a", 10.0), ("b", 5.0)],
        [("a", 0.9), ("b", 0.8)],
        k=60,
    )
    ids = [r[0] for r in merged]
    assert len(ids) == len(set(ids))
