# ADR-0005 · `.axbrl` zip project file + SQLite app DB
- **Status:** accepted (2026-11-10)
- **Decision:**
  - One filing = one `.axbrl` zip (manifest, filing, mapping, source xlsx, outputs, AI history). It's registered as a Windows file association.
  - Cross-project data (recent projects, mapping memory, settings) lives in `%APPDATA%/XBRL Autopilot/app.db`.
- **Why:**
  - Portable and inspectable, like `.docx`.
  - One file per filing matches how CAs organise their work.
  - Mapping memory must outlive individual projects.
