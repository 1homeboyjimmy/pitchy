from accelerator_csv import csv_content, csv_filename


def test_csv_is_excel_compatible_and_formula_safe():
    content = csv_content([
        ["Имя", "Ответ", "Пусто"],
        ["Егор", 'Текст; с "кавычками"\nи переносом', None],
        ["Формула", "=2+2", ""],
    ])
    text = content.decode("utf-8")

    assert text.startswith("\ufeffИмя;Ответ;Пусто\r\n")
    assert '"Текст; с ""кавычками""\nи переносом"' in text
    assert "Формула;'=2+2;\r\n" in text


def test_csv_filename_is_stable():
    assert csv_filename("cohort-report").startswith("cohort-report-")
    assert csv_filename("cohort-report").endswith(".csv")
