from routerai_client import looks_like_upstream_error


def test_detects_bot_block_returned_as_model_content():
    assert looks_like_upstream_error("[Error 403]: Blocked by bot detection.")


def test_detects_cloudflare_block_page():
    assert looks_like_upstream_error("Just a moment... Cloudflare Ray ID: abc")


def test_does_not_reject_normal_investment_answer():
    assert not looks_like_upstream_error(
        "Идея решает понятную проблему, но частота использования слишком низкая."
    )
