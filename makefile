.PHONY: dev start test rebuild rebuild-fast rebuild-skip-chroma engine-authority engine-rules clean build-sidecar build-ui build-win build-linux build_app build-app app run dev-app

# Support passing arguments like:
# make rebuild ARGS="--skip-chroma"
# make rebuild-fast
# make rebuild-skip-chroma
# make rebuild skip-chroma
# make -- rebuild --skip-chroma

EXTRA_ARGS := $(ARGS)
ifneq (,$(filter skip-chroma --skip-chroma,$(MAKECMDGOALS)))
  EXTRA_ARGS := --skip-chroma
endif

# --- Launch Desktop Application ---
app:
	pnpm --filter ui dev



dev:
	with reload run python + ui serviers

start:
	pnpm --filter ui dev
test:
	uv run --extra dev pytest -v && run ui test

rebuild:
	uv run python -m src.pipeline.rebuild_knowledge_base_pipeline $(EXTRA_ARGS)


clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache build dist sidecar-dist ui/out ui/release

# --- Packaging & Distribution (Phase 11b / docs/10-packaging-release.md) ---

build-sidecar:
	@echo "==> Building Python sidecar bundle (PyInstaller)..."
	uv run pyinstaller sidecar.spec --distpath sidecar-dist --workpath build/pyinstaller --noconfirm

build-ui:
	@echo "==> Assembling deterministic engine authorities..."
	node engine/scripts/assemble-authority.mjs
	@echo "==> Building Electron + React UI bundles..."
	pnpm --filter ui build

build-win: build-sidecar build-ui
	@echo "==> Packaging Windows installer..."
	pnpm --filter ui exec electron-builder --win
	@mkdir -p dist
	@cp -f ui/release/*Setup*.exe dist/ 2>/dev/null || cp -f ui/release/*.exe dist/ 2>/dev/null || true
	@echo "==> Windows artifact ready in dist/:"
	@ls -lh dist/*.exe

build-linux: build-sidecar build-ui
	@echo "==> Packaging Linux AppImage & Debian package..."
	pnpm --filter ui exec electron-builder --linux
	@mkdir -p dist
	@cp -f ui/release/*.AppImage dist/ 2>/dev/null || true
	@cp -f ui/release/*.deb dist/ 2>/dev/null || true
	@echo "==> Linux artifacts ready in dist/:"
	@ls -lh dist/*.AppImage dist/*.deb

build_app: build-sidecar build-ui
	@echo "==> Packaging shareable applications for Windows and Linux..."
	pnpm --filter ui exec electron-builder --win --linux
	@mkdir -p dist
	@rm -f dist/*
	@cp -f ui/release/*Setup*.exe dist/ 2>/dev/null || cp -f ui/release/*.exe dist/ 2>/dev/null || true
	@cp -f ui/release/*.AppImage dist/ 2>/dev/null || true
	@cp -f ui/release/*.deb dist/ 2>/dev/null || true
	@echo ""
	@echo "=========================================================="
	@echo "  XBRL Autopilot - Shareable Application Build Complete!  "
	@echo "=========================================================="
	@echo "Artifacts placed in dist/:"
	@ls -lh dist/
	@echo "=========================================================="

build-app: build_app

# Catch-all rule so make does not error on extra goal arguments
%:
	@:
