from rag import _merge_chroma_candidates


def test_merge_chroma_candidates_orders_by_cosine_distance():
    entries = [
        {"text": "A" * 60, "metadata": {"category": "first"}},
        {"text": "B" * 60, "metadata": {"category": "second"}},
        {"text": "C" * 60, "metadata": {"category": "third"}},
    ]

    result = _merge_chroma_candidates(entries, [0.4, 0.1, 0.25])

    assert [entry["metadata"]["category"] for entry in result] == [
        "second",
        "third",
        "first",
    ]
    assert [entry["score"] for entry in result] == [0.9, 0.75, 0.6]


def test_merge_chroma_candidates_deduplicates_and_filters_tiny_chunks():
    duplicate = "Useful candidate " * 5
    entries = [
        {"text": duplicate, "metadata": {"source": "slower duplicate"}},
        {"text": "tiny", "metadata": {}},
        {"text": duplicate, "metadata": {"source": "better duplicate"}},
    ]

    result = _merge_chroma_candidates(entries, [0.5, 0.01, 0.2])

    assert len(result) == 1
    assert result[0]["metadata"]["source"] == "better duplicate"
