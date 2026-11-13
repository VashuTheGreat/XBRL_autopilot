def test_index_page(client):
    """GET / should render the Jinja2 index template with the current app branding."""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    content = response.text
    assert "DevOps Prep Multi-RAG" in content
    assert "Multi-RAG" in content
    assert "New Thread" in content
    assert "Ingest Documents" in content
    assert "theme-dark" in content


def test_eval_page_combines_rag_and_guardrails_results(client):
    response = client.get("/eval")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    content = response.text
    assert "Evaluation results" in content
    assert "metrics_results_4.json" in content
    assert "generated_dataset_3.json" in content
    assert "guardrails_eval_results_3.json" in content
    assert "0.960" in content
    assert "What is an AI agent in the DevOps lesson" in content
    assert "Average score" in content
    assert "Avg." in content
    assert "score-low" in content
    assert "score-mid" in content
    assert "score-high" in content
    assert "trace-1" in content
    assert "True positives" in content
    assert "6 / 6 correct" in content


def test_static_theme_css(client):
    """GET /static/css/theme.css should serve the stylesheet with 200 OK."""
    response = client.get("/static/css/theme.css")
    assert response.status_code == 200
    assert "text/css" in response.headers.get("content-type", "")
    assert "--accent-chai" in response.text
    assert "--user-avatar-bg" in response.text
    assert "--ai-avatar-bg" in response.text


def test_static_app_js(client):
    """GET /static/js/app.js should serve the JavaScript client logic with 200 OK."""
    response = client.get("/static/js/app.js")
    assert response.status_code == 200
    assert "javascript" in response.headers.get("content-type", "")
    assert "/api/v1/conversations" in response.text
    assert "multi_rag_threads" not in response.text
    assert "/api/v1/chat" in response.text
    assert "/api/v1/ingest" in response.text
