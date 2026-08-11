from tbank_payment_service import build_receipt, token


def test_tbank_token_uses_root_scalar_fields_only():
    payload = {"TerminalKey": "T", "Amount": 100, "OrderId": "1", "Receipt": {"Items": []}}
    assert len(token(payload, "secret")) == 64
    assert token(payload, "secret") == token({**payload, "Receipt": {"Items": [{"Name": "ignored"}]}}, "secret")


def test_receipt_amounts_are_in_kopecks():
    item = build_receipt(name="Pitchy subscription", amount_rub=1.0, email="user@example.com")["Items"][0]
    assert item["Price"] == 100
    assert item["Amount"] == 100
    assert item["PaymentObject"] == "service"
