import os
import sys
from dotenv import load_dotenv

# Load env vars from .env file
load_dotenv()

# Force APP_ENV to production to bypass the dev mock in email_utils
os.environ["APP_ENV"] = "production"

try:
    from email_utils import send_email
except ImportError:
    # Add current directory to sys.path if running from root
    sys.path.append(os.getcwd())
    from email_utils import send_email


def main():
    recipient = input("Введите email получателя (куда отправить тест): ").strip()
    if not recipient:
        print("Email не введен.")
        return

    print(f"Попытка отправки письма на {recipient}...")
    print(f"SMTP Server: {os.getenv('SMTP_HOST')}:{os.getenv('SMTP_PORT')}")
    print(f"SMTP User: {os.getenv('SMTP_USER')}")

    try:
        send_email(
            to_email=recipient,
            subject="Тестовое письмо от Pitchy (Yandex Postbox)",
            body=(
                "Это тестовое письмо для проверки настройки Yandex Cloud Postbox.\n\n"
                "Если вы читаете это, значит настройка успешна!"
            )
        )
        print("✅ Письмо успешно отправлено! Проверьте папку 'Входящие' или 'Спам'.")
    except Exception as e:
        print("❌ Ошибка при отправке письма:")
        print(e)


if __name__ == "__main__":
    main()
