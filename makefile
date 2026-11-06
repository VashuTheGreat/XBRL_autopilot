dev:
	uv run uvicorn main:app --host 0.0.0.0 --port 7860 --reload

start:
	uv run uvicorn main:app --host 0.0.0.0 --port 7860


test:
	uv run pytest