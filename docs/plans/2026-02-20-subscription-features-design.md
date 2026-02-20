# Subscription Tiers & Features Design
Date: 2026-02-20

## Overview
This document outlines the business and technical design for the subscription models in the AI Startup Analyzer application, based on brainstormed features tailored for the Russian VC/Startup market.

We employ a 2-tier Qualitative Feature-Gating Strategy to drive upgrades. 

## Tier 1: Профессиональный (Pro)
**Target Audience**: Solo-founders, private business angels.
**Price**: 599 ₽ / month (Recommended)

### Limits
- **Projects**: 5 active projects (startups/analyses).
- **Messages**: Unlimited AI chat messages.

### Features
- **Base Scoring**: Core textual scoring (Investment Score, Strengths, Weaknesses, Market Summary).
- **Standard Prompts**: System predefined instructions.
- **Pitch Deck Builder**: Automatically generate structure and slide text from a short text description of the idea.
- **Chat Roleplay (Pitch Simulation)**: AI acts as a hostile/skeptical investor to grill founders on their deck.
- **Exporting Options**: 
  - Standard PDF export (with service watermark).
  - TXT / Clipboard export.
- **History**: Permanent retention of all chats and analyses.

## Tier 2: Премиум (Premium / B2B)
**Target Audience**: Venture Funds, Syndicates, Serial Angels.
**Price**: 999 ₽ / month (or higher based on market feedback).

### Limits
- **Projects**: Unlimited.
- **Messages**: Unlimited (subject to fair use).

### Features (All Pro features +)
- **Custom Prompts**: Ability to inject custom analysis frameworks (e.g., Y-Combinator style, Unit Economics focus).
- **Batch Processing**: Upload up to 20 PDFs at once and receive a consolidated cross-ranked Excel/CSV table sorting the startups by Investment Score.
- **White-label PDF Reports**: Unbranded/custom branded PDF generation for client sharing without AI watermarks.
- **Web-search Research Agents**: AI autonomously searches the web for Russian competitors, verifies legal entity status, finds founder news, and injects external context into the report.
- **Dynamic Financial Analysis**: Extract financial tables from pitch decks and dynamically extrapolate metrics/generate forecasts (Runway, CAC/LTV).

## Open Technical Considerations
- **LLM Routing**: Batch Processing and Web-Search Agents will require significantly more compute and orchestrating multiple YandexGPT calls or Background Workers (Celery/Redis Queue).
- **PDF Generation**: Will require a robust frontend or backend PDF library (e.g., Playwright, reportlab) capable of handling custom logos and styling.
- **Rate Limiting**: Needs strict Db-level constraints to track "Projects" vs "Reports".
