"""Encrypt temporary credential exports before they leave the backend host."""
import base64
import json
import os
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def encrypt_export(data, public_key_pem):
    public_key = serialization.load_pem_public_key(public_key_pem.encode())
    key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    encrypted = AESGCM(key).encrypt(nonce, json.dumps(data, ensure_ascii=False).encode(), b"pitchy-resident-import-v1")
    wrapped = public_key.encrypt(key, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return {"version": 1, "key": base64.b64encode(wrapped).decode(),
            "nonce": base64.b64encode(nonce).decode(), "ciphertext": base64.b64encode(encrypted).decode()}


def decrypt_export(envelope, private_key_pem):
    if envelope["version"] != 1:
        raise ValueError("Unsupported export format")
    private_key = serialization.load_pem_private_key(private_key_pem.encode(), password=None)
    key = private_key.decrypt(base64.b64decode(envelope["key"]),
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    data = AESGCM(key).decrypt(base64.b64decode(envelope["nonce"]), base64.b64decode(envelope["ciphertext"]), b"pitchy-resident-import-v1")
    return json.loads(data)
