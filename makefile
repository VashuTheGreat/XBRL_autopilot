.PHONY: dev start test rebuild rebuild-fast rebuild-skip-chroma engine-authority engine-rules clean

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
	uv run uvicorn api.app:app --host 127.0.0.1 --port 7860 --reload

start:
	uv run uvicorn api.app:app --host 127.0.0.1 --port 7860

test:
	uv run --extra dev pytest -v

rebuild:
	uv run python -m src.ingestion.rebuild_knowledge_base $(EXTRA_ARGS)

rebuild-fast:
	uv run python -m src.ingestion.rebuild_knowledge_base --skip-chroma

rebuild-skip-chroma:
	uv run python -m src.ingestion.rebuild_knowledge_base --skip-chroma

# only the engine authorities (knowledge_base/*_engine_authority.json, ADR-0010); then: make engine-rules
engine-authority:
	uv run python -m src.ingestion.build_engine_authorities

# only the executable business rules (knowledge_base/*_engine_rules.json + *_rule_coverage.json and
# docs/generated/rule-coverage-*.md, ADR-0011); needs the engine authorities
engine-rules:
	uv run python -m src.ingestion.build_engine_rules

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	rm -rf .pytest_cache .ruff_cache

# Catch-all rule so make does not error on extra goal arguments
%:
	@:
