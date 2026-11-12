"""Okapi BM25 over short documents (a concept's label words). Pure Python: the taxonomy has a few thousand concepts."""
from __future__ import annotations

import math
from collections import Counter


class Bm25Index:
    def __init__(self, docs: dict[str, list[str]], k1: float = 1.2, b: float = 0.5):
        self.k1, self.b = k1, b
        self.docs = {d: Counter(words) for d, words in docs.items()}
        self.lengths = {d: sum(c.values()) for d, c in self.docs.items()}
        self.avg_len = (sum(self.lengths.values()) / len(self.lengths)) if self.lengths else 1.0
        df: Counter[str] = Counter()
        self.postings: dict[str, list[str]] = {}
        for d, c in self.docs.items():
            for w in c:
                df[w] += 1
                self.postings.setdefault(w, []).append(d)
        n = len(self.docs)
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}

    def _term(self, doc: str, word: str) -> float:
        tf = self.docs[doc][word]
        norm = self.k1 * (1 - self.b + self.b * self.lengths[doc] / self.avg_len)
        return self.idf[word] * tf * (self.k1 + 1) / (tf + norm)

    def search(self, query: dict[str, float], limit: int = 50, among: set[str] | None = None) -> list[tuple[str, float]]:
        """`query` maps word → weight (row label words 1.0, heading words less). Returns (doc, score), best first."""
        scores: Counter[str] = Counter()
        for w, weight in query.items():
            for d in self.postings.get(w, ()):
                if among is None or d in among:
                    scores[d] += weight * self._term(d, w)
        return scores.most_common(limit)

    def coverage(self, doc: str, query: dict[str, float]) -> float:
        """Share of the document's words the query names (1.0 = every label word was asked for)."""
        c = self.docs.get(doc)
        if not c:
            return 0.0
        idf_total = sum(self.idf[w] for w in c)
        return sum(self.idf[w] for w in c if w in query) / idf_total if idf_total else 0.0
