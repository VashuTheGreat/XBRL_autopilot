# ADR-0014 · Qdrant Vector Database, In-Memory Chatbot State Engine & Hybrid Reranking

- **Status:** accepted (2026-11-13).
- **Context:**
  - Previous implementations used local ChromaDB storage for embedding collections, introducing filesystem coupling and inconsistent local state.
  - The application required an in-memory XBRL consultation chatbot for Indian MCA statutory filings (AOC-4, CRA-4) that manages multi-turn conversation state without introducing an external persistent database (PostgreSQL, SQLite, or Redis).
  - Taxonomy concept recommendation required a high-precision retrieval mechanism capable of finding exact line items even when standard embeddings struggle with specialized accounting terminology (e.g., "Revenue from operations finance company" vs "Revenue from operations").
  - Informal prints and emoji logging needed replacement with professional, structured observability to trace end-to-end execution.

- **Decision:**
  1. **Qdrant Vector Database Migration across Exactly Four Collections:**
     - Replaced local ChromaDB with Qdrant Cloud (`fe6c821a-bb9f-4e84-b611-fa9f7236bd69.us-west-2-0.aws.cloud.qdrant.io:6333`).
     - Standardized on four canonical collection names in `src/constants.py`:
       - `ci_taxonomy`: Corporate Insolvency taxonomy concepts.
       - `cost_taxonomy`: Costing taxonomy concepts.
       - `ind_as_taxonomy`: Indian Accounting Standards taxonomy concepts.
       - `xbrl_agent`: MCA/XBRL statutory guidelines (`data/agent/MCA.txt`) for agent RAG.
     - Vectors configured with 768 dimensions using `sentence-transformers/all-mpnet-base-v2` and Cosine distance metric.
     - `make rebuild` triggers `python3 -m src.pipeline.rebuild_knowledge_base_pipeline`, which deletes existing collections if present, recreates all four fresh, builds engine authorities and rules, and populates the collections.

  2. **In-Memory Chatbot Architecture (LangGraph StateGraph):**
     - Retained an in-memory architecture backed by `langgraph.checkpoint.memory.InMemorySaver` and an in-memory thread dictionary `_active_threads` (`src/services/memory/inmemory.py`).
     - Exposed REST API endpoints under `/api/v1/conversations` (create, list, get history, delete, send message) and `/api/v1/chat` (direct chat with streaming SSE and synchronous JSON).
     - Ensured thread isolation: deleting a thread purges its checkpoint state from memory.
     - Resolved serialization safety: sanitized all node outputs (including `retreived_content` and metadata) to pure Python types (`str`, `dict`, `int`, `float`, `bool`) to prevent `TypeError: Type is not msgpack serializable: numpy.float32`.

  3. **Hybrid Search & Neural Reranking:**
     - Implemented `HybridSearchService` (`src/services/retrieval/hybrid.py`) combining dense Qdrant vector retrieval with sparse `rank-bm25` keyword retrieval using LangChain `EnsembleRetriever` (50/50 reciprocal rank fusion).
     - Built automatic fallback: if Qdrant collection is empty or offline, retrieval gracefully falls back to BM25 keyword matching directly from knowledge base JSON files.
     - Replaced heavy default reranker with lightweight `ms-marco-TinyBERT-L-2-v2` (3.26MB, ~25ms on CPU) in `RerankerService` (`src/services/retrieval/reranker.py`).
     - Added exact label match boosting: queries exactly matching an element's label receive a top score of 1.0 (100% confidence).

  4. **Professional Logging & Logfire Observability:**
     - Removed all casual prints, operational prints, and emoji logging across the Python codebase.
     - Added Logfire spans tracing complete execution:
       `API → Service → Pipeline → Retrieval → Reranker → Response`.
     - Logged important operational metrics: collection selected, retrieved candidate count, reranker scores, and structured exception details.

- **Consequences:**
  - Zero local filesystem database corruption risks from ChromaDB.
  - Chatbot state is ephemeral and process-bound (resets on sidecar restart), meeting the strict in-memory requirement without database overhead.
  - High accuracy in taxonomy concept recommendations with 100% confidence for exact accounting terms.
  - Seamless full-system rebuilds via `make rebuild` with complete visibility into any extraction or vector ingestion step.
