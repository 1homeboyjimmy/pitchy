import inspect

import main


def test_health_endpoint_has_no_jina_dependency():
    gather_source = inspect.getsource(main._gather_health).lower()
    render_source = inspect.getsource(main._render_health_html).lower()

    assert "jina" not in gather_source
    assert "jina" not in render_source


def test_health_html_renders_routerai_without_jina():
    html = main._render_health_html({
        "status": "ok",
        "summary": {"healthy": 1, "warning": 0, "down": 0, "skipped": 0},
        "checks": {
            "routerai": {
                "state": "healthy",
                "ok": True,
                "configured": True,
                "reranker_model": "voyageai/rerank-2.5-lite",
                "reranker_endpoint": "https://routerai.ru/api/v1/rerank",
            },
            "system": {},
        },
    }).lower()

    assert "routerai" in html
    assert "voyageai/rerank-2.5-lite" in html
    assert "https://routerai.ru/api/v1/rerank" in html
    assert "jina" not in html
