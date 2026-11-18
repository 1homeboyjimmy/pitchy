"""SMTP submission uses an authenticated TLS connection with trusted certificates."""
import ssl
from unittest.mock import MagicMock

import pytest

from email_utils import send_email


@pytest.fixture
def smtp(monkeypatch):
    for key, value in {
        "APP_ENV": "prod", "SMTP_HOST": "postbox.cloud.yandex.net", "SMTP_PORT": "587",
        "SMTP_USER": "test-api-id", "SMTP_PASS": "test-api-secret", "SMTP_TLS": "true",
        "SMTP_FROM": "Pitchy <noreply@pitchy.pro>",
    }.items():
        monkeypatch.setenv(key, value)
    connection = MagicMock()
    transport = MagicMock()
    transport.return_value.__enter__.return_value = connection
    monkeypatch.setattr("email_utils.smtplib.SMTP", transport)
    return transport, connection


def test_postbox_uses_certificate_verification_and_configured_sender(smtp):
    transport, connection = smtp
    send_email("recipient@example.test", "Test", "SMTP integration check")
    transport.assert_called_once_with("postbox.cloud.yandex.net", 587, timeout=10)
    context = connection.starttls.call_args.kwargs["context"]
    assert context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED
    connection.login.assert_called_once_with("test-api-id", "test-api-secret")
    message = connection.send_message.call_args.args[0]
    assert message["From"].addresses[0].display_name == "Pitchy"
    assert message["From"].addresses[0].addr_spec == "noreply@pitchy.pro"
    assert [call[0] for call in connection.method_calls] == ["starttls", "login", "send_message"]


def test_untrusted_certificate_prevents_authentication_and_delivery(smtp):
    _, connection = smtp
    connection.starttls.side_effect = ssl.SSLCertVerificationError("Untrusted test certificate")
    with pytest.raises(ssl.SSLCertVerificationError):
        send_email("recipient@example.test", "Test", "SMTP integration check")
    connection.login.assert_not_called()
    connection.send_message.assert_not_called()
