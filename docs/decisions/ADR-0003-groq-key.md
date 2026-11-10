# ADR-0003 · Groq API key is user-provided; proxy later
- **Status:** accepted (2026-11-10)
- **Decision:**
  - In development the key comes from the gitignored `.env`.
  - In the packaged app the user enters it in Settings, and it's stored with Electron `safeStorage`.
  - A key is never bundled.
  - Later, a licensed proxy server can hold one shared key and meter usage per licence.
- **Consequences:** AI features are disabled until a key is entered. Deterministic features always work.
