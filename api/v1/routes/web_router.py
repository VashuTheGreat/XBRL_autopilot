import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from src.core.logger import logger

router = APIRouter(tags=["Web"])

BASE_DIR = Path(__file__).resolve().parent.parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
EVAL_DATASET_PATH = BASE_DIR / "evals" / "generated_dataset_3.json"
EVAL_METRICS_PATH = BASE_DIR / "evals" / "results" / "metrics_results_4.json"
EVAL_GUARDRAILS_PATH = BASE_DIR / "evals" / "results" / "guardrails_eval_results_3.json"

EVAL_METRICS = (
    ("answer_relevancy", "Answer relevancy"),
    ("answer_correctness", "Answer correctness"),
    ("faithfulness", "Faithfulness"),
    ("context_precision", "Context precision"),
    ("context_recall", "Context recall"),
)



# ==================== The Frontend UI ===============================
@router.get("/", response_class=HTMLResponse, summary="Serve Multi-RAG Chat Interface")
async def get_index(request: Request):
    logger.info("Rendering Multi-RAG Web Interface")
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "app_name": "Multi-RAG",
            "tagline": "Chai & Code Advanced Retrieval Pipeline",
        },
    )


@router.get("/eval", response_class=HTMLResponse, summary="Show RAG and guardrails evaluations")
async def get_evaluation_results(request: Request):
    try:
        dataset = json.loads(EVAL_DATASET_PATH.read_text(encoding="utf-8"))
        metric_results = json.loads(EVAL_METRICS_PATH.read_text(encoding="utf-8"))
        guardrail_results = json.loads(EVAL_GUARDRAILS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.error("Evaluation artifacts could not be loaded", error=str(exc))
        raise HTTPException(status_code=503, detail="Evaluation results are unavailable.") from exc

    scores_by_question = {}
    for metric_key, _ in EVAL_METRICS:
        for result in metric_results.get(metric_key, []):
            question = result.get("question")
            score = result.get(metric_key)
            if question and isinstance(score, (int, float)):
                scores_by_question.setdefault(question, {})[metric_key] = float(score)

    metric_summaries = []
    for metric_key, label in EVAL_METRICS:
        values = [
            result[metric_key]
            for result in metric_results.get(metric_key, [])
            if isinstance(result.get(metric_key), (int, float))
        ]
        mean = Decimal(str(sum(values))) / max(len(values), 1)
        mean = mean.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP) if values else Decimal(0)
        metric_summaries.append({"label": label, "mean": float(mean), "display": f"{mean:.3f}"})

    samples = []
    for sample in dataset.get("rag_samples", []):
        sample_metrics = [
            {
                "key": metric_key,
                "label": label,
                "value": scores_by_question.get(sample.get("question"), {}).get(metric_key),
            }
            for metric_key, label in EVAL_METRICS
        ]
        sample_values = [metric["value"] for metric in sample_metrics if metric["value"] is not None]
        sample_average = sum(sample_values) / len(sample_values) if sample_values else None
        samples.append({
            "id": sample.get("id"),
            "domain": sample.get("domain", "general"),
            "question": sample.get("question", ""),
            "reference": sample.get("reference", ""),
            "answer": sample.get("actual_response", ""),
            "contexts": sample.get("actual_contexts", []),
            "metrics": sample_metrics,
            "average": sample_average,
        })

    sample_averages = [sample["average"] for sample in samples if sample["average"] is not None]
    overall_average = sum(sample_averages) / len(sample_averages) if sample_averages else 0

    guardrail_counts = {
        result: sum(item.get("result") == result for item in guardrail_results)
        for result in ("TP", "TN", "FP", "FN")
    }
    guardrail_correct = guardrail_counts["TP"] + guardrail_counts["TN"]
    guardrail_precision = guardrail_counts["TP"] / max(guardrail_counts["TP"] + guardrail_counts["FP"], 1)
    guardrail_recall = guardrail_counts["TP"] / max(guardrail_counts["TP"] + guardrail_counts["FN"], 1)
    guardrail_accuracy = guardrail_correct / max(len(guardrail_results), 1)
    guardrail_metrics = [
        {"label": "Guardrail precision", "display": f"{guardrail_precision:.3f}", "value": guardrail_precision},
        {"label": "Guardrail recall", "display": f"{guardrail_recall:.3f}", "value": guardrail_recall},
        {"label": "Guardrail accuracy", "display": f"{guardrail_accuracy:.3f}", "value": guardrail_accuracy},
        *[
            {"label": result, "display": str(guardrail_counts[result]), "value": None}
            for result in ("TP", "TN", "FP", "FN")
        ],
    ]

    return templates.TemplateResponse(
        request=request,
        name="eval.html",
        context={
            "app_name": "Multi-RAG Evaluation",
            "metrics": metric_summaries,
            "guardrail_metrics": guardrail_metrics,
            "samples": samples,
            "overall_average": overall_average,
            "guardrails": guardrail_results,
            "guardrail_counts": guardrail_counts,
            "guardrail_correct": guardrail_correct,
            "guardrail_total": len(guardrail_results),
            "dataset_file": EVAL_DATASET_PATH.name,
            "metrics_file": EVAL_METRICS_PATH.name,
            "guardrails_file": EVAL_GUARDRAILS_PATH.name,
        },
    )
