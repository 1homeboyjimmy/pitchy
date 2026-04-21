import re

def _rerank_chunks_simulated(query: str, entries: list[dict], distances: list[float]) -> list[dict]:
    query_words = set(re.findall(r'\w{3,}', query.lower()))
    scored = []
    for entry, dist in zip(entries, distances):
        doc = entry["text"]
        doc_words = set(re.findall(r'\w{3,}', doc.lower()))
        overlap = len(query_words & doc_words) / max(len(query_words), 1)
        similarity = max(0, 1 - dist)
        # NEW WEIGHTING: 0.9 Vector, 0.1 Lexical
        combined = 0.9 * similarity + 0.1 * overlap
        scored.append((entry, combined, similarity, overlap))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored

# TEST DATA
# Query: "анализ рынка"
# Doc 1: "рынок" (exact overlap but small)
# Doc 2: "рынков" (no overlap due to suffix, but high semantic similarity)
test_entries = [
    {"text": "Исследование рынка показало рост."},      # Overlap: 1.0 (рынка)
    {"text": "Аналитика различных рынков важна."},    # Overlap: 0.5 (аналитика matches query? no. market doesn't match)
]
# Simulate distances (Doc 2 is semantically closer)
test_distances = [0.2, 0.15] 

print("Simulating Rerank results for 'анализ рынка':")
results = _rerank_chunks_simulated("анализ рынка", test_entries, test_distances)

for entry, score, sim, overlap in results:
    print(f"Score: {score:.3f} | Sim: {sim:.3f} | Overlap: {overlap:.2f} | Text: {entry['text']}")
