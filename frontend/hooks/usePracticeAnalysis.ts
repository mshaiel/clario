/**
 * usePracticeAnalysis — Hook
 * Location: hooks/usePracticeAnalysis.ts
 *
 * Mirrors the DetectionSession audio analysis flow for practice screens.
 * Supports two modes:
 *   - 'assistant' : sends audio to /assistant/analyze, gets coaching text + audio URL back,
 *                   plays coaching audio automatically via ttsService
 *   - 'efficient' : same call with mode='efficient', skips coaching audio (faster)
 *
 * test_type is derived from the module's error_name (normalized to snake_case).
 * Falls back to 'comprehensive' if the error_name doesn't map to a known test type.
 */

import { UAB_API, USE_MOCK } from '@/lib/api';
import { deriveTestType } from '@/lib/practiceUtils';
import { ttsService } from '@/lib/ttsService';
import type { AnalysisResponse, PracticeAnalysisMode, SodaEvent } from '@/lib/types';
import { useCallback, useRef, useState } from 'react';

export interface PracticeAnalysisResult {
  sentence_accuracy: number;
  transcript: string;
  flagged_words: AnalysisResponse['flagged_words'];
  word_results: AnalysisResponse['word_results'];
  coach_text: string | null;   // assistant_text from first flagged_word (mode=assistant)
  coach_audio: string | null;  // assistant_audio_url (mode=assistant)
  /**
   * Aggregated SODA events from all test-type results in the CAM response.
   * Empty array means the pronunciation was clinically clean.
   */
  soda_events: SodaEvent[];
}

export interface UsePracticeAnalysisReturn {
  analyzeRecording: (audioUri: string, itemId: string, targetsJson: string, forcedTestType?: string) => Promise<PracticeAnalysisResult | null>;
  isAnalyzing: boolean;
  lastResult: PracticeAnalysisResult | null;
}

export function usePracticeAnalysis(
  moduleId: string,
  errorName: string,
  majorType: string,
  language: 'english' | 'urdu',
  mode: PracticeAnalysisMode
): UsePracticeAnalysisReturn {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastResult, setLastResult] = useState<PracticeAnalysisResult | null>(null);
  const inFlightRef = useRef(false);

  const analyzeRecording = useCallback(
    async (audioUri: string, itemId: string, targetsJson: string, forcedTestType?: string): Promise<PracticeAnalysisResult | null> => {
      if (inFlightRef.current) return null;
      if (!audioUri) return null;
      if (!targetsJson) {
        console.error('[usePracticeAnalysis] targetsJson is required for analyze-text');
        return null;
      }

      inFlightRef.current = true;
      setIsAnalyzing(true);

      const testType = forcedTestType ?? deriveTestType(errorName, majorType);

      // Extract expected_phonemes from targetsJson when present so the full pipeline
      // can run surgical SODA detection via /analyze-text
      let expectedPhonemes: string | undefined;
      try {
        const targets = JSON.parse(targetsJson) as { word: string; expected_ipa: string[] }[];
        if (!Array.isArray(targets) || targets.length === 0) {
          console.error('[usePracticeAnalysis] targetsJson must include at least one target');
          return null;
        }
        if (Array.isArray(targets[0].expected_ipa) && targets[0].expected_ipa.length > 0) {
          expectedPhonemes = targets[0].expected_ipa.join(' ');
        } else {
          console.error('[usePracticeAnalysis] targetsJson targets must include expected_ipa');
          return null;
        }
      } catch {
        console.error('[usePracticeAnalysis] Invalid targetsJson; expected JSON array of targets');
        return null;
      }

      try {
        let response: AnalysisResponse;

        if (USE_MOCK) {
          // ── MOCK: simulate analysis ────────────────────────────────────────
          await new Promise((r) => setTimeout(r, 1300));
          const accuracy = 60 + Math.floor(Math.random() * 35);
          response = {
            sentence_id: itemId,
            sentence_accuracy: accuracy,
            transcript: '(mock transcript)',
            word_results: [],
            flagged_words: accuracy < 80 ? [{
              word: 'target',
              index_in_sentence: 0,
              error_category: 'phonology',
              error_type: 'substitution',
              expected_phoneme: expectedPhonemes?.split(' ')[0] ?? 'k',
              heard_phoneme: 't',
              assistant_text: mode === 'assistant' ? 'Try keeping the back of your tongue up for the target sound.' : undefined,
              assistant_audio_url: undefined,
            } as any] : [],
          };
          // ──────────────────────────────────────────────────────────────────
        } else {
          // All practice modules route through /analyze-text — accepts free text
          // directly rather than requiring a pre-baked sentence bank ID
          const raw = await UAB_API.analyzeText(
            audioUri,
            itemId,
            testType as any,
            mode,
            targetsJson,
            language,
            expectedPhonemes
          );

          // ── Normalise field names ──────────────────────────────────────────
          // CAM schema uses `accuracy_score`; frontend AnalysisResponse uses
          // `sentence_accuracy`. Handle both so a direct-to-CAM path still works.
          response = {
            ...raw,
            sentence_accuracy:
              (raw as any).sentence_accuracy ??
              (raw as any).accuracy_score ??
              0,
          } as AnalysisResponse;
        }

        // ── Aggregate SODA events from all per-test results ───────────────────
        // CAM returns results[<test_type>] = { detected_count, events[], ... }
        // We flatten all events into one list so the caller doesn't need to know
        // which test type fired.
        const allSodaEvents: SodaEvent[] = [];
        if (response.results) {
          for (const testResult of Object.values(response.results)) {
            if (testResult?.events?.length) {
              allSodaEvents.push(...testResult.events);
            }
          }
        }

        // Extract coaching from first flagged word (assistant mode only)
        const firstFlagged = response.flagged_words?.[0];
        const coachText = firstFlagged?.assistant_text ?? null;
        const coachAudioUrl = firstFlagged?.assistant_audio_url ?? null;

        // Play coaching audio if present and mode=assistant
        if (mode === 'assistant' && coachAudioUrl) {
          try {
            await ttsService.playFromUrl(coachAudioUrl);
          } catch (e) {
            console.warn('[usePracticeAnalysis] Coach audio playback failed:', e);
          }
        }

        const result: PracticeAnalysisResult = {
          sentence_accuracy: response.sentence_accuracy,
          transcript: response.transcript,
          flagged_words: response.flagged_words ?? [],
          word_results: response.word_results ?? [],
          coach_text: coachText,
          coach_audio: coachAudioUrl,
          soda_events: allSodaEvents,
        };

        setLastResult(result);
        return result;
      } catch (error) {
        console.error('[usePracticeAnalysis] analyzeRecording failed:', error);
        return null;
      } finally {
        inFlightRef.current = false;
        setIsAnalyzing(false);
      }
    },
    [errorName, majorType, language, mode]
  );

  return { analyzeRecording, isAnalyzing, lastResult };
}
