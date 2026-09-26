/**
 * useTTSPlayback — Practice screen TTS wrapper
 *
 * Wraps ttsService.synthesizeAndPlay() with state tracking
 * and graceful error handling for practice screens.
 */

import { useLanguage } from '@/context/LanguageContext';
import ttsService from '@/lib/ttsService';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useTTSPlayback() {
  const { language } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = ttsService.onPlaybackChange((playing) => {
      if (mountedRef.current) setIsPlaying(playing);
    });
    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  const playWord = useCallback(
    async (text: string, gender: 'f' | 'm' = 'f'): Promise<boolean> => {
      try {
        await ttsService.synthesizeAndPlay(text, language, gender);
        return true;
      } catch (error) {
        console.warn('[useTTSPlayback] playWord failed:', error);
        return false;
      }
    },
    [language]
  );

  const playPhoneme = useCallback(
    async (phoneme: string, gender: 'f' | 'm' = 'f'): Promise<boolean> => {
      // For isolated phonemes, we wrap in a carrier to help TTS
      const ttsText = phoneme.length <= 2 ? `${phoneme}` : phoneme;
      try {
        await ttsService.synthesizeAndPlay(ttsText, language, gender);
        return true;
      } catch (error) {
        console.warn('[useTTSPlayback] playPhoneme failed:', error);
        return false;
      }
    },
    [language]
  );

  const playSentence = useCallback(
    async (sentence: string, gender: 'f' | 'm' = 'f'): Promise<boolean> => {
      try {
        await ttsService.synthesizeAndPlay(sentence, language, gender);
        return true;
      } catch (error) {
        console.warn('[useTTSPlayback] playSentence failed:', error);
        return false;
      }
    },
    [language]
  );

  const stop = useCallback(async () => {
    try {
      await ttsService.stopPlayback();
    } catch {}
  }, []);

  const synthesizeOnly = useCallback(
    async (text: string, gender: 'f' | 'm' = 'f'): Promise<string | null> => {
      try {
        return await ttsService.synthesizeOnly(text, language, gender);
      } catch (error) {
        console.warn('[useTTSPlayback] synthesizeOnly failed:', error);
        return null;
      }
    },
    [language]
  );

  const playFromUrl = useCallback(
    async (url: string): Promise<boolean> => {
      try {
        await ttsService.playFromUrl(url);
        return true;
      } catch (error) {
        console.warn('[useTTSPlayback] playFromUrl failed:', error);
        return false;
      }
    },
    []
  );

  return {
    isPlaying,
    playWord,
    playPhoneme,
    playSentence,
    synthesizeOnly,
    playFromUrl,
    stop,
  };
}
