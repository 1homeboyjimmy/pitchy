# Pitchy Media Content Factory

## 1. Цель

Построить автоматизированный контент-завод для Pitchy, который будет регулярно готовить и публиковать русскоязычные статьи для Дзена через отдельный media-контур.

Основная цель системы:

- генерировать полезные статьи для предпринимателей, фаундеров, стартап-команд, фондов, акселераторов, трекеров и менторов;
- вести трафик на лид-магнит Pitchy;
- собирать лиды и аналитику по статьям;
- постепенно улучшать темы, промпты, CTA и качество публикаций;
- не публиковать материалы без редакционного контроля.

На старте нужен не полный автопостинг, а автоматическая публикация после ручного approve.

## 2. Принцип работы

Базовая схема:

```text
источники тем
-> сбор тем
-> скоринг тем
-> выбор темы
-> research brief
-> генерация статьи
-> quality check
-> Telegram approve
-> публикация на media-сайте
-> RSS для Дзена
-> переход на лид-магнит Pitchy
-> лид / регистрация / заявка
-> аналитика
-> улучшение следующих публикаций
```

Человек должен принимать редакционное решение, а техническая публикация должна быть автоматической.

После нажатия кнопки "Опубликовать" система сама:

- меняет статус статьи;
- проверяет slug, CTA, источники, обложку и quality score;
- публикует страницу статьи;
- добавляет статью в RSS;
- сохраняет дату публикации;
- формирует UTM-ссылку;
- ставит задачи сбора аналитики на 24, 48 и 72 часа.

## 3. Рекомендуемый стек реализации

Для MVP лучше делать отдельный сервис автоматизации, но архитектурно похожий на Pitchy.

Основной backend:

```text
Python
FastAPI
SQLAlchemy
Alembic
PostgreSQL
Pydantic
```

Фоновые задачи:

```text
asyncio background loops для MVP
Redis для lock/retry/cache, если понадобится
позже: Celery / Dramatiq / APScheduler, если фоновых задач станет много
```

Публичные статьи и RSS:

```text
FastAPI endpoints для RSS
Jinja2 или простой HTML renderer для статей на первом этапе
позже: Next.js frontend, если понадобится полноценный media-интерфейс
```

Telegram approve:

```text
Telegram Bot API
webhook endpoint в FastAPI
inline keyboard callback_data
HMAC/signature для внутренних команд, если approve будет проксироваться отдельным bridge
```

LLM-интеграции:

```text
OpenAI-compatible client
Pydantic/instructor для структурированных ответов
отдельные сервисы для topic scoring, brief, article generation, quality check
```

Поиск и research:

```text
Exa / Tavily / Perplexity-like search client
ручной allowlist источников
ограничение частоты обхода
сохранение source_url и source_snapshot/summary
```

Наблюдаемость:

```text
structured logging
Prometheus metrics
Sentry, если нужен crash reporting
Langfuse или аналог для LLM-traces
```

Тестирование:

```text
pytest
httpx AsyncClient для API tests
unit tests для status transitions
snapshot tests для RSS
tests для Telegram callback idempotency
```

## 4. Почему не начинать с WordPress

WordPress полезен как быстрая CMS, но для Pitchy MVP лучше начать с собственного publishing layer.

Причины:

- статьи становятся сущностью системы, а не внешним постом;
- проще контролировать статусы публикации;
- проще гарантировать, что в RSS не попадут черновики;
- проще связывать статьи с UTM, лидами и аналитикой;
- проще встроить Telegram approve и LLM quality check;
- меньше инфраструктуры и синхронизации.

WordPress можно оставить как запасной вариант, если позже понадобится редакторская CMS для людей. В таком случае Pitchy/media-сервис должен всё равно хранить mirror-метаданные статьи и статус публикации.

## 5. Структура репозитория

Рекомендуемая стартовая структура:

```text
app/
  main.py
  config.py
  db.py
  models.py
  schemas.py

  routers/
    health.py
    articles.py
    topics.py
    telegram.py
    rss.py
    admin.py

  services/
    topic_service.py
    brief_service.py
    article_service.py
    quality_service.py
    publish_service.py
    telegram_service.py
    rss_service.py
    analytics_service.py
    prompt_service.py

  clients/
    llm.py
    search.py
    telegram.py
    pitchy.py
    metrika.py

  jobs/
    scheduler.py
    collect_topics.py
    generate_article.py
    collect_metrics.py

alembic/
tests/
docker-compose.yml
Dockerfile
.env.example
README.md
```

## 6. Основные сущности данных

Минимальные таблицы для MVP:

```text
content_sources
content_topics
content_briefs
content_articles
content_article_versions
content_approvals
content_publications
content_metrics
content_leads
content_prompts
```

### content_sources

Источники тем:

- название;
- тип источника;
- URL;
- активен или нет;
- лимиты обхода;
- дата последнего обхода.

### content_topics

Кандидаты тем:

- title;
- summary;
- source_url;
- category;
- scores;
- status;
- reason;
- created_at.

### content_briefs

Research brief для выбранной темы:

- topic_id;
- target_audience;
- main_thesis;
- relevance;
- facts;
- sources;
- counterarguments;
- forbidden_claims;
- native_integration_type;
- cta_type.

### content_articles

Основная сущность статьи:

- topic_id;
- brief_id;
- title;
- slug;
- excerpt;
- content_html;
- category;
- tags;
- cta_url;
- cta_type;
- native_integration_type;
- cover_image_url;
- cover_prompt;
- source_list;
- status;
- quality_score;
- media_url;
- utm_url;
- scheduled_at;
- approved_at;
- published_at;
- rss_included_at.

### content_article_versions

История изменений:

- article_id;
- title;
- content_html;
- change_reason;
- created_at.

### content_approvals

Telegram approve-log:

- article_id;
- telegram_message_id;
- action;
- status;
- comment;
- actor;
- created_at.

### content_publications

Факт публикации:

- article_id;
- platform;
- platform_url;
- status;
- published_at.

### content_metrics

Метрики статьи:

- article_id;
- source;
- measured_at;
- views;
- clicks;
- ctr;
- leads;
- conversions.

### content_leads

Связь лида с контентом:

- article_id;
- name;
- email;
- telegram;
- startup_idea;
- utm_source;
- utm_medium;
- utm_campaign;
- utm_content;
- referrer;
- created_at.

### content_prompts

Версионирование промптов:

- name;
- version;
- prompt_text;
- model;
- is_active;
- created_at.

## 7. Статусы статьи

Статусы должны быть машинными и однозначными:

```text
idea
scored
selected
brief_ready
draft_ready
quality_failed
quality_passed
sent_to_approve
approved
scheduled
published
rss_included
rejected
postponed
```

Публикация должна быть идемпотентной.

Если Telegram callback или API-запрос publish придёт дважды, система должна вернуть уже опубликованную статью, а не создавать дубль.

Пример правила:

```text
if article.status == "published":
    return existing media_url
```

## 8. API MVP

Минимальный набор endpoint-ов:

```text
GET  /health

POST /content/articles
GET  /content/articles
GET  /content/articles/{id}
PATCH /content/articles/{id}

POST /content/articles/{id}/send-to-telegram
POST /content/articles/{id}/approve
POST /content/articles/{id}/publish
POST /content/articles/{id}/reject
POST /content/articles/{id}/postpone

GET /articles/{slug}
GET /feed/dzen.xml

POST /telegram/webhook
```

Позже добавить:

```text
POST /content/topics/collect
POST /content/topics/{id}/score
POST /content/topics/{id}/select
POST /content/briefs/generate
POST /content/articles/generate
POST /content/articles/{id}/quality-check
POST /content/articles/{id}/rewrite
POST /content/analytics/collect
```

## 9. Telegram approve

Telegram должен быть основным редакционным интерфейсом MVP.

Сообщение по статье:

```text
Новая статья

Тема:
Заголовок:
Рубрика:
Quality score:
Риск рекламности:
CTA:
Нативное упоминание:
Источники:
Preview:
```

Кнопки:

```text
Опубликовать
Переписать
Заголовок сильнее
Меньше рекламы
Отложить
Отклонить
```

Callback actions:

```text
publish:{article_id}
rewrite:{article_id}
better_title:{article_id}
less_ad:{article_id}
postpone:{article_id}
reject:{article_id}
```

Правило MVP:

```text
без Telegram approve статья не публикуется
```

## 10. RSS для Дзена

RSS должен генерироваться из собственной базы, а не из внешней CMS.

URL:

```text
/feed/dzen.xml
```

В RSS попадают только статьи, которые прошли все условия:

```text
status = published
approved_at is not null
quality_score >= threshold
content_html is not empty
cta_url is not empty
source_list is not empty
```

Не отдавать в RSS:

- черновики;
- отклонённые статьи;
- статьи без CTA;
- статьи без источников;
- статьи без quality check;
- статьи без публичного URL.

Минимальная структура item:

```xml
<item>
  <title>Заголовок статьи</title>
  <link>https://media.pitchy.pro/article-slug</link>
  <guid>https://media.pitchy.pro/article-slug</guid>
  <pubDate>Mon, 01 Jan 2026 09:00:00 +0300</pubDate>
  <description>Краткое описание статьи</description>
  <content:encoded><![CDATA[
    Полный HTML статьи
  ]]></content:encoded>
  <category>ИИ для стартапов</category>
</item>
```

## 11. Лид-магнит

Главный лид-магнит:

```text
Бесплатная ИИ-диагностика стартап-идеи
```

Целевой URL:

```text
https://pitchy.pro/ai-startup-diagnostic
```

Рекомендуемый сценарий:

```text
переход из статьи
-> ввод идеи
-> короткий preview результата
-> email/Telegram для полного результата
-> регистрация или переход в Pitchy
```

Для холодного трафика из Дзена важно сначала дать ценность, а не требовать регистрацию до результата.

Все CTA из статей должны иметь UTM:

```text
https://pitchy.pro/ai-startup-diagnostic
  ?utm_source=dzen
  &utm_medium=article
  &utm_campaign={article_slug}
```

Желательно сохранять UTM не только в Метрике, но и в своей базе.

## 12. LLM pipeline

LLM-логика должна быть разделена на отдельные шаги.

### Topic scoring

Вход:

- тема;
- источник;
- summary;
- категория.

Выход:

- score_reach;
- score_startup_fit;
- score_lead_potential;
- score_freshness;
- score_simplicity;
- score_sources;
- score_low_risk;
- score_total;
- reason.

### Research brief

Выход:

- главный тезис;
- почему тема актуальна;
- для кого статья;
- факты и аргументы;
- контраргументы;
- что нельзя утверждать;
- как встроить Pitchy;
- CTA;
- структура статьи;
- источники.

### Article generation

Выход:

- title;
- slug;
- excerpt;
- content_html;
- category;
- tags;
- cta_block;
- cover_prompt;
- source_list.

### Quality check

Выход:

- quality_score;
- is_publishable;
- problems;
- fixes;
- recommended_action.

Критерии:

- не похожа ли статья на рерайт;
- есть ли уникальный угол;
- есть ли польза;
- не слишком ли много рекламы;
- есть ли CTA;
- логично ли встроен Pitchy;
- есть ли спорные факты без источников;
- подходит ли заголовок;
- подходит ли статья под ЦА;
- есть ли риск для Дзена.

## 13. Использование RAG и similarity checks

Для защиты качества нужно использовать память опубликованных материалов.

Что индексировать:

- опубликованные статьи;
- удачные CTA;
- удачные заголовки;
- запрещённые формулировки;
- tone of voice;
- источники и краткие research notes.

Перед approve желательно проверять:

- похожесть на уже опубликованные статьи;
- похожесть на исходные материалы;
- повторяемость заголовков;
- частоту рекламных вставок;
- долю неподтверждённых утверждений.

Это снижает риск однотипных AI-текстов и рерайта.

## 14. Рубрики на старте

Стартовые рубрики:

```text
Ошибки фаундеров
ИИ для стартапов
Проверка бизнес-идей
Инвестиции и акселераторы
Разборы стартапов
```

## 15. Формат статьи

Рекомендуемая структура:

```text
заголовок
лид
проблема
пример / история
разбор
практические шаги
мягкое упоминание Pitchy
CTA
вывод
источники
```

Длина:

```text
4 000-7 000 знаков
```

Требования:

- русский язык;
- живой стиль;
- без канцелярита;
- без "как нейросеть";
- без дешёвого кликбейта;
- без агрессивной рекламы;
- с примерами;
- с пользой для предпринимателя;
- с мягким CTA;
- с источниками.

## 16. Нативная интеграция Pitchy

Использовать три уровня интеграции.

### Уровень 1

Без названия продукта.

Пример:

```text
Часть этих задач уже можно автоматизировать с помощью ИИ: от формулировки гипотез до подготовки первых материалов для проверки идеи.
```

### Уровень 2

Мягкое упоминание Pitchy.

Пример:

```text
Мы строим ИИ-экосистему для стартапов, которая помогает фаундерам пройти путь от идеи до первых проверок: сформулировать гипотезы, найти слабые места и понять следующие шаги.
```

### Уровень 3

CTA.

Пример:

```text
Если у вас есть идея стартапа, можно пройти бесплатную ИИ-диагностику. Система покажет слабые места идеи, риски и первые шаги для проверки гипотезы.
```

Распределение:

```text
40% статей — уровень 1
40% статей — уровень 2
20% статей — уровень 3
```

## 17. Очередность разработки

Рекомендуемые первые коммиты:

```text
1. project scaffold, Docker Compose, healthcheck
2. database models and Alembic init
3. article CRUD and status transitions
4. public article rendering and Dzen RSS
5. Telegram approve webhook
6. LLM schemas and quality check
7. topic, brief, article generation pipeline
8. analytics jobs
```

Первый рабочий milestone:

```text
создать статью через API
-> отправить её в Telegram
-> нажать "Опубликовать"
-> увидеть статью на публичном URL
-> увидеть её в /feed/dzen.xml
```

Только после этого стоит подключать полноценный сбор тем и генерацию статей.

## 18. Что не делать в начале

Не начинать с полного n8n-пайплайна.

Сначала нужен устойчивый backend API, который n8n сможет дёргать позже.

Не делать полный автопостинг без approve.

Не делать WordPress обязательной частью MVP.

Не хранить статусы публикаций только в n8n.

Не отдавать в RSS статьи без quality check, CTA и источников.

Не требовать регистрацию до первой ценности на лид-магните.

## 19. MVP definition of done

MVP можно считать готовым, когда работает цепочка:

```text
ручное создание статьи
-> Telegram approve
-> автоматическая публикация
-> публичная страница статьи
-> RSS для Дзена
-> CTA с UTM
-> сохранение лида/события
-> базовая аналитика статьи
```

После этого можно безопасно наращивать:

- автоматический сбор тем;
- LLM scoring;
- генерацию research brief;
- генерацию статей;
- генерацию обложек;
- автоматическую переработку слабых текстов;
- weekly reports;
- оптимизацию по лидам.
