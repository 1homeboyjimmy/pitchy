# Media Pitchy: что можно сделать сейчас без доступа к серверам

## 1. Цель документа

Этот документ описывает только ту работу, которую можно делать уже сейчас локально и не переделывать после появления доступа к серверам.

Исключаем временные решения:

- без fake Telegram;
- без fake LLM;
- без временного mock API;
- без временной базы;
- без логики, которую потом придётся выбрасывать.

Идея: локально собрать production-ready ядро сервиса, а когда появится доступ к серверам, останется только развернуть его, прописать DNS, env-переменные, Caddy и внешние webhook-и.

## 2. Что можно сделать уже сейчас

Можно полностью реализовать:

- структуру репозитория;
- FastAPI backend;
- Docker Compose для локального запуска;
- PostgreSQL;
- SQLAlchemy-модели;
- Alembic-миграции;
- API для статей;
- status machine публикаций;
- публичный HTML-render статей;
- RSS для Дзена;
- Telegram webhook endpoint;
- контракты Telegram callback actions;
- LLM-клиент с реальными provider-конфигами;
- agent/service contracts;
- quality review schema;
- prompt registry;
- audit/logging таблицы;
- тесты status flow, RSS и idempotency.

Нельзя полноценно завершить без серверов:

- DNS для `media.pitchy.pro`;
- публичный HTTPS;
- Caddy production routing;
- Telegram webhook registration на публичный URL;
- подключение RSS в кабинет Дзена;
- live-сбор Яндекс Метрики;
- production secrets;
- production monitoring.

Эти части не влияют на архитектуру кода и добавляются на этапе deploy.

## 3. Локальный старт репозитория

Если репозиторий ещё не склонирован:

```powershell
cd C:\Users\s4nya\pitchy
git clone https://github.com/ssashkann/media-pitchy.git
cd media-pitchy
```

Если уже склонирован:

```powershell
cd C:\Users\s4nya\pitchy\media-pitchy
```

Первый коммит должен создать основу проекта, а не временные файлы.

## 4. Финальная структура проекта

Рекомендуемая структура:

```text
app/
  main.py
  config.py
  db.py
  models.py
  schemas.py
  enums.py
  errors.py

  routers/
    health.py
    articles.py
    topics.py
    telegram.py
    rss.py
    prompts.py

  services/
    content_orchestrator.py
    topic_service.py
    brief_service.py
    article_service.py
    quality_service.py
    publish_service.py
    telegram_service.py
    rss_service.py
    prompt_service.py
    analytics_service.py

  agents/
    base.py
    topic_scoring.py
    brief_research.py
    article_writer.py
    editor_review.py
    compliance_review.py
    fact_check.py
    title.py
    cta.py
    learning.py

  clients/
    llm.py
    telegram.py
    search.py
    pitchy.py
    metrika.py

  jobs/
    scheduler.py
    collect_topics.py
    collect_metrics.py

alembic/
tests/
docker-compose.yml
Dockerfile
.env.example
README.md
```

## 5. Docker Compose

Локально сразу использовать финальный подход:

```text
media-api
postgres
redis, если нужен для locks/retry/cache
```

Не использовать SQLite для MVP, потому что production будет на PostgreSQL.

Локальный запуск:

```powershell
docker compose up --build
```

Минимальная цель первого запуска:

```text
GET /health -> 200 OK
```

## 6. Конфигурация

Сразу сделать `.env.example` с production-переменными:

```env
APP_ENV=local
DATABASE_URL=postgresql+psycopg://media:media@postgres:5432/media_pitchy
REDIS_URL=redis://redis:6379/0

MEDIA_BASE_URL=http://localhost:8000
PUBLIC_MEDIA_BASE_URL=https://media.pitchy.pro

PITCHY_BASE_URL=https://pitchy.pro
PITCHY_API_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ALLOWED_CHAT_IDS=

LLM_PROVIDER=
MODEL_FAST=
MODEL_WRITER=
MODEL_REASONER=
MODEL_JUDGE=
MODEL_FACTCHECK=
MODEL_EMBEDDING=
MODEL_RERANK=

SEARCH_PROVIDER=
SEARCH_API_KEY=

METRIKA_COUNTER_ID=
METRIKA_OAUTH_TOKEN=
```

Важно: даже если ключей пока нет, имена переменных должны быть финальными.

## 7. База данных

Сейчас можно сделать финальные SQLAlchemy-модели и Alembic-миграции.

Минимальные таблицы:

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
agent_runs
```

### content_articles

Ключевая таблица:

```text
id
topic_id
brief_id
title
slug
excerpt
content_html
category
tags
cta_url
cta_type
native_integration_type
cover_image_url
cover_prompt
source_list
status
quality_score
media_url
utm_url
rewrite_count
scheduled_at
approved_at
published_at
rss_included_at
created_at
updated_at
```

### agent_runs

Для аудита ИИ-агентов:

```text
id
article_id
topic_id
agent_name
model
prompt_name
prompt_version
input_json
output_json
status
latency_ms
tokens_input
tokens_output
cost
error
created_at
```

Эта таблица нужна сразу, чтобы все решения агентов были воспроизводимыми.

## 8. Статусы публикации

Сразу реализовать status machine:

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

Переходы должны быть централизованы в `content_orchestrator.py` или `publish_service.py`.

Нельзя размазывать смену статусов по роутерам.

Обязательное правило:

```text
article cannot be published unless:
  status in approved|scheduled
  approved_at is not null
  quality_score >= threshold
  content_html exists
  cta_url exists
  source_list exists
```

Публикация должна быть идемпотентной:

```text
повторный publish возвращает existing media_url
повторный Telegram callback не создаёт дубль
повторное включение в RSS не создаёт дубль
```

## 9. API, которое можно сделать сейчас

Базовые endpoints:

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

Позже, когда будут подключены реальные ключи и источники:

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

Но сами роуты и сервисы можно создать уже сейчас.

## 10. Публичные статьи

Сейчас можно реализовать финальный render:

```text
GET /articles/{slug}
```

Минимальный HTML должен содержать:

- title;
- meta description;
- canonical;
- Open Graph tags;
- article body;
- CTA block;
- source list;
- publication date.

Даже если визуальный дизайн позже изменится, структура данных и endpoint останутся теми же.

## 11. RSS для Дзена

Сейчас можно реализовать финальный endpoint:

```text
GET /feed/dzen.xml
```

RSS должен генерироваться только из базы.

В RSS попадают только статьи:

```text
status = published или rss_included
approved_at is not null
published_at is not null
quality_score >= threshold
content_html is not empty
cta_url is not empty
source_list is not empty
```

Минимальный item:

```xml
<item>
  <title>...</title>
  <link>...</link>
  <guid>...</guid>
  <pubDate>...</pubDate>
  <description>...</description>
  <content:encoded><![CDATA[
    ...
  ]]></content:encoded>
  <category>...</category>
</item>
```

Сразу написать тест:

```text
draft article не попадает в RSS
rejected article не попадает в RSS
published article попадает в RSS
RSS валиден как XML
```

## 12. Telegram webhook

Даже без публичного сервера можно написать production endpoint:

```text
POST /telegram/webhook
```

Он должен:

- принимать Telegram update;
- проверять secret token;
- проверять allowed chat id;
- парсить callback_data;
- вызывать соответствующий service method;
- логировать approval action;
- быть идемпотентным.

Callback actions:

```text
publish:{article_id}
rewrite:{article_id}
better_title:{article_id}
less_ad:{article_id}
postpone:{article_id}
reject:{article_id}
```

До появления публичного сервера не нужно регистрировать webhook в Telegram.

Но сам endpoint, парсер callback и бизнес-логика должны быть финальными.

## 13. LLM-клиент

Сейчас можно реализовать реальный abstraction layer без временных заглушек.

Файл:

```text
clients/llm.py
```

Задача:

- читать provider/model из env;
- поддерживать OpenAI-compatible API, если провайдеры идут через совместимый endpoint;
- возвращать structured output;
- логировать model, latency, token usage;
- не скрывать ошибки;
- писать результат в `agent_runs`.

Рекомендуемые модельные профили:

```text
MODEL_FAST
MODEL_WRITER
MODEL_REASONER
MODEL_JUDGE
MODEL_FACTCHECK
MODEL_EMBEDDING
MODEL_RERANK
```

Рекомендуемая стартовая конфигурация по ролям:

```text
FAST -> GLM Flash/Air или Qwen small
WRITER -> Qwen Instruct
REASONER -> GLM flagship или Qwen Thinking
JUDGE -> GLM flagship
FACTCHECK -> GLM flagship
EMBEDDING/RERANK -> GLM или Cohere-compatible provider
```

Важно: writer и judge лучше держать на разных семействах моделей.

## 14. ИИ-агенты

Агенты реализуются как typed workers, а не как один большой автономный агент.

Базовый контракт:

```text
Agent input -> Pydantic schema
Agent output -> Pydantic schema
Agent run -> записывается в agent_runs
```

Список агентов:

```text
TopicScoringAgent
BriefResearchAgent
ArticleWriterAgent
EditorReviewAgent
ComplianceReviewAgent
FactCheckAgent
TitleAgent
CTAAgent
LearningAgent
```

Оркестрацией занимается не LLM, а `ContentPipelineOrchestrator`.

Агенты не должны напрямую менять статусы статьи.

Они возвращают structured result:

```json
{
  "ok": true,
  "score": 82,
  "blocking_reasons": [],
  "recommended_action": "send_to_approve"
}
```

А статус меняет orchestrator.

## 15. Quality review

Сейчас можно реализовать schema и хранение quality review.

Поля:

```text
unique_angle_score
audience_value_score
dzen_readiness_score
cta_score
fact_support_score
ad_risk_score
rewrite_required
blocking_reasons
evidence
```

Оценка не должна быть "из головы".

Для уникального угла:

- сравнение с прошлыми статьями через embeddings;
- сравнение с источниками;
- извлечение `angle_statement`;
- проверка, не является ли тема общим пересказом.

Для пользы ЦА:

- есть ли практические шаги;
- есть ли пример;
- есть ли конкретная проблема фаундера;
- можно ли применить совет без покупки Pitchy;
- нет ли абстрактного бизнес-текста.

Для Dzen readiness:

- заголовок без дешёвого кликбейта;
- лид быстро объясняет пользу;
- нет агрессивной рекламы;
- спорные факты имеют источники;
- есть CTA;
- есть excerpt;
- RSS item полный и валидный.

## 16. CTA evaluation

Сейчас можно реализовать модель данных и scoring-контракт.

CTA оценивается по:

- релевантности теме;
- мягкости интеграции;
- ясности действия;
- соответствию лид-магниту;
- отсутствию агрессивной продажи;
- похожести на CTA в предыдущих статьях;
- будущим метрикам CTR и conversion.

Когда исторических данных ещё нет, используется rule-based + LLM review.

Когда появятся данные, `CTAAgent` должен учитывать:

```text
past_cta_ctr
past_cta_conversion
rubric
native_integration_type
article_topic
```

## 17. Снижение галлюцинаций

Сейчас можно реализовать структуры и правила.

Правила:

- writer не придумывает факты сам;
- все факты должны приходить из brief/evidence;
- любая цифра требует source_url;
- любое "рынок растёт", "большинство", "часто" требует evidence;
- unsupported critical claims блокируют публикацию;
- сомнительные факты переписываются мягко или удаляются.

Нужны сущности:

```text
Claim
Evidence
FactCheckResult
UnsupportedClaim
```

Минимальный claim:

```json
{
  "claim": "...",
  "source_url": "...",
  "evidence_excerpt": "...",
  "confidence": 0.82
}
```

## 18. Prompt registry

Сейчас можно сделать таблицу и API для промптов.

```text
content_prompts
```

Поля:

```text
name
version
prompt_text
model_profile
is_active
created_at
```

Production-промпты не должны автоматически переписываться системой.

LearningAgent может создавать рекомендации, но не менять active prompt без approve.

## 19. Тесты, которые нужно написать сразу

Тесты должны покрывать финальную логику:

```text
test_health.py
test_article_crud.py
test_status_transitions.py
test_publish_idempotency.py
test_rss_filters.py
test_rss_xml_validity.py
test_telegram_callback_parser.py
test_telegram_publish_idempotency.py
test_quality_gate_blocks_publish.py
test_slug_uniqueness.py
```

Что важно проверить:

- нельзя опубликовать rejected article;
- нельзя опубликовать статью без approved_at;
- нельзя опубликовать статью без CTA;
- нельзя опубликовать статью без source_list;
- повторный publish не создаёт дубль;
- в RSS нет черновиков;
- callback `publish:{id}` работает идемпотентно;
- неизвестный callback action отклоняется.

## 20. Первые коммиты

Рекомендуемая последовательность:

```text
1. project scaffold, Docker Compose, healthcheck
2. database models and Alembic migration
3. article CRUD and status machine
4. public article render
5. Dzen RSS endpoint and RSS tests
6. publish service and idempotency tests
7. Telegram webhook parser and approval actions
8. LLM client abstraction and agent base classes
9. quality review schemas and gates
10. prompt registry and agent_runs audit
```

После этих коммитов сервис будет готов к deploy без архитектурной переделки.

## 21. Что отложить до доступа к серверам

Отложить:

- DNS-записи;
- Caddy production config;
- HTTPS-проверку;
- Telegram webhook registration;
- Яндекс Метрика live-интеграцию;
- подключение RSS в Дзен;
- production secrets;
- Grafana dashboards;
- production backup jobs.

Не откладывать:

- модели БД;
- миграции;
- API;
- RSS;
- status machine;
- idempotency;
- Telegram webhook endpoint;
- agent contracts;
- LLM client;
- quality gates;
- тесты.

## 22. Локальный definition of done

До доступа к серверам можно считать работу готовой, если локально:

```text
docker compose up --build запускает сервис
GET /health возвращает 200
POST /content/articles создаёт статью
POST /content/articles/{id}/approve меняет статус корректно
POST /content/articles/{id}/publish публикует статью
GET /articles/{slug} отдаёт публичный HTML
GET /feed/dzen.xml отдаёт валидный RSS
draft/rejected статьи не попадают в RSS
повторный publish не создаёт дублей
Telegram callback parser покрыт тестами
quality gate блокирует статью без CTA/source_list/approved_at
```

После этого серверный этап будет не разработкой с нуля, а развёртыванием уже готового ядра.
