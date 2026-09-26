---
title: Clario Unified Assistant
emoji: 🎙️
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# Clario Unified Assistant

FastAPI backend for the Clario speech therapy platform. Provides assessment planning, AI-driven sentence generation, TTS audio synthesis, and adaptive learning for stuttering and phonological disorder therapy.

## Endpoints

| Method | Path                           | Description                                 |
| ------ | ------------------------------ | ------------------------------------------- |
| POST   | `/v1/questionnaire`            | Submit questionnaire and assign assessments |
| GET    | `/v1/assessments/{id}`         | Fetch assessment plan                       |
| GET    | `/v1/assessments/{id}/bundle`  | Download ZIP bundle (audio + manifest)      |
| POST   | `/v1/assessments/{id}/results` | Submit session results                      |
| GET    | `/v1/profile/{uid}`            | Get learner profile                         |
| POST   | `/v1/profile/{uid}/reset`      | Reset learner profile                       |

## Environment Variables

| Variable                         | Description                           |
| -------------------------------- | ------------------------------------- |
| `GOOGLE_CREDENTIALS_JSON` | Full contents of Firebase service account JSON |
| `HF_TOKEN`                       | HuggingFace write token for audio CDN |
| `GEMINI_API_KEY`                 | Google Gemini API key                 |
