.PHONY: dev start test rebuild rebuild-fast rebuild-skip-chroma clean

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

dev:
	uv run uvicorn api.app:app --host 0.0.0.0 --port 7860 --reload

start:
	uv run uvicorn api.app:app --host 0.0.0.0 --port 7860

test:
	uv run pytest -v

rebuild:
	uv run python -m src.ingestion.rebuild_knowledge_base $(EXTRA_ARGS)

rebuild-fast:
	uv run python -m src.ingestion.rebuild_knowledge_base --skip-chroma

rebuild-skip-chroma:
	uv run python -m src.ingestion.rebuild_knowledge_base --skip-chroma

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache

# Catch-all rule so make does not error on extra goal arguments
%:
	@:
