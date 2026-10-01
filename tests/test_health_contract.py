import inspect

import main


def test_health_endpoint_has_no_jina_dependency():
    gather_source = inspect.getsource(main._gather_health).lower()
    render_source = inspect.getsource(main._render_health_html).lower()

    assert "jina" not in gather_source
    assert "jina" not in render_source


def test_health_html_renders_polza_without_jina():
    html = main._render_health_html({
        "status": "ok",
        "summary": {"healthy": 1, "warning": 0, "down": 0, "skipped": 0},
        "checks": {
            "polza": {
                "state": "healthy",
                "ok": True,
                "configured": True,
            },
            "system": {},
        },
    }).lower()

    assert "polza" in html
    assert "jina" not in html
