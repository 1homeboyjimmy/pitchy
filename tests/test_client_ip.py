from starlette.requests import Request


def _request(peer: str, headers: list[tuple[bytes, bytes]]) -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/auth/login",
        "headers": headers,
        "client": (peer, 12345),
        "query_string": b"",
    })


def test_get_client_ip_uses_proxy_overwritten_real_ip():
    from main import get_client_ip

    request = _request("172.20.0.4", [(b"x-real-ip", b"203.0.113.10")])
    assert get_client_ip(request) == "203.0.113.10"


def test_get_client_ip_does_not_trust_forwarded_header_from_public_peer():
    from main import get_client_ip

    request = _request("203.0.113.20", [(b"x-real-ip", b"198.51.100.9")])
    assert get_client_ip(request) == "203.0.113.20"
