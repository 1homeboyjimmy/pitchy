import requests
import random
import string
import sqlite3

BASE_URL = "http://localhost:8000"
DB_PATH = "app.db"

def random_string(length=10):
    return ''.join(random.choices(string.ascii_lowercase, k=length))


def main():
    # 0. Check health
    try:
        res = requests.get(f"{BASE_URL}/health")
        if res.status_code != 200:
            print("Server is not healthy or not running.")
            return
    except requests.exceptions.ConnectionError:
        print("Server is not running. Please start it with 'uvicorn main:app --reload'")
        return

    # 1. Register
    email = f"test_{random_string()}@example.com"
    password = "Password123"
    name = "Test User"
    
    print(f"Registering {email}...")
    res = requests.post(f"{BASE_URL}/auth/register", json={
        "email": email, "password": password, "name": name
    })

    if res.status_code != 200:
        print(f"Registration failed: {res.text}")
        return

    print("Registration successful (verification pending).")

    # 2. Manually verify in DB
    print("Manually verifying user in DB...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET email_verified = 1 WHERE email = ?", (email,))
    conn.commit()
    conn.close()
    print("User verified.")

    # 3. Login
    print("Logging in...")
    requests.post(f"{BASE_URL}/auth/login", json={
        "email": email, "password": password
    })
    
    # We strictly need the token. The backend sets a cookie.
    # The frontend uses this cookie.
    # For API calls, if we use requests.Session, it handles cookies.

    session = requests.Session()
    res = session.post(f"{BASE_URL}/auth/login", json={
        "email": email, "password": password
    })
    if res.status_code != 200:
        print(f"Login failed: {res.text}")
        return

    token = res.json().get("access_token")
    print(f"Logged in. Token: {token[:10]}...")

    # 4. Create Analysis
    print("Creating analysis...")
    analysis_name = f"Startup {random_string(5)}"
    category = "FinTech"
    description = "A revolutionary fintech app that uses AI to manage personal finances."
    
    # Note: This calls YandexGPT. If it fails, we might need to mock or handle it.
    res = session.post(f"{BASE_URL}/analysis", json={
        "name": analysis_name,
        "category": category,
        "description": description,
        "url": "http://example.com",
        "stage": "MVP"
    }, headers={"Authorization": f"Bearer {token}"})

    if res.status_code != 200:
        print(f"Analysis creation failed: {res.text}")
        # If it fails due to GPT error, we can't test list extraction fully,
        # but we can check if it saves anything.
        return

    created_data = res.json()
    print(f"Analysis created. ID: {created_data.get('id')}")
    print(f"Returned Name: {created_data.get('name')}")
    print(f"Returned Category: {created_data.get('category')}")

    # 5. List Analyses
    print("Fetching analysis list...")
    res = session.get(f"{BASE_URL}/analysis", headers={"Authorization": f"Bearer {token}"})

    if res.status_code != 200:
        print(f"List fetch failed: {res.text}")
        return

    items = res.json()
    print(f"Found {len(items)} items.")

    if len(items) == 0:
        print("Error: No items found.")
        return

    item = items[0]
    print("Checking first item:")
    print(f"  ID: {item.get('id')}")
    print(f"  Name: {item.get('name')}")
    print(f"  Category: {item.get('category')}")
    print(f"  Score: {item.get('investment_score')}")

    # Verification
    if item.get('name') == analysis_name and item.get('category') == category:
        print("SUCCESS: Name and Category correctly retrieved from payload parsing!")
    else:
        print(f"FAILURE: Expected name='{analysis_name}', category='{category}'.")
        print(
            f"Got name='{item.get('name')}', "
            f"category='{item.get('category')}'"
        )


if __name__ == "__main__":
    main()
