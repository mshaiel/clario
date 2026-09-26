import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutAnimation,
  Modal,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

import { AICoPilotToggle, AI_ACCENT } from '@/components/detection/AICoPilotToggle';
import { AIFeedbackBubble } from '@/components/detection/AIFeedbackBubble';
import { VoiceVisualizer } from '@/components/detection/VoiceVisualizer';
import { MicButton } from '@/components/practice/MicButton';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePracticeAnalysis } from '@/hooks/usePracticeAnalysis';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';
import { UAB_API } from '@/lib/api';
import { clarioAssistant } from '@/lib/clarioAssistant';
import { buildTargetsJson, extractIpaTokens, getDiagnosisInfo } from '@/lib/practiceUtils';
import type { Language } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const FOIL_SLATE = '#94A3B8';

type Phase = 'discrimination' | 'production';
type SessionState = 'idle' | 'playing_audio' | 'awaiting_tap' | 'recording' | 'processing' | 'result';
type ResultState = 'correct' | 'incorrect' | null;
type Side = 'left' | 'right';

const MIC_HOLD_DELAY_MS = 240;

function normalizePhoneme(phoneme: string) {
  return phoneme.replace(/[\/\s]/g, '').trim().toLowerCase();
}

function formatPhoneme(phoneme: string) {
  const trimmed = phoneme.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}/`;
}

function getReplacementIssue(expectedPhonemes: string[], observedPhonemes: string[]) {
  const longest = Math.max(expectedPhonemes.length, observedPhonemes.length);

  for (let index = 0; index < longest; index += 1) {
    const expected = expectedPhonemes[index];
    const observed = observedPhonemes[index];

    if (expected && !observed) {
      return `Missing sound: expected ${formatPhoneme(expected)} but nothing was heard`;
    }

    if (!expected && observed) {
      return `Extra sound heard: ${formatPhoneme(observed)}`;
    }

    if (expected && observed && normalizePhoneme(expected) !== normalizePhoneme(observed)) {
      return `Expected ${formatPhoneme(expected)} but heard ${formatPhoneme(observed)} at position ${index + 1}`;
    }
  }

  if (expectedPhonemes.length && observedPhonemes.length) {
    return `Expected ${expectedPhonemes.map(formatPhoneme).join(' ')} but heard ${observedPhonemes.map(formatPhoneme).join(' ')}`;
  }

  return 'Sound mismatch detected';
}


function PhonemePills({ phonemes, color, bg }: { phonemes: string[]; color: string; bg: string }) {
  return (
    <View style={styles.pillRow}>
      {phonemes.map((phoneme, i) => (
        <View key={`${phoneme}-${i}`} style={[styles.pill, { backgroundColor: bg }]}>
          <Text style={[styles.pillText, { color }]}>{phoneme}</Text>
        </View>
      ))}
    </View>
  );
}

function MinimalPairsErrorModal({
  visible,
  title,
  subtitle,
  issueText,
  targetWord,
  observedWord,
  onRetry,
  surface,
  text,
  subtle,
  border,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  issueText: string;
  targetWord: string;
  observedWord: string;
  onRetry: () => void;
  surface: string;
  text: string;
  subtle: string;
  border: string;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onRetry}>
      <View style={modalStyles.backdrop}>
        <TouchableOpacity style={modalStyles.backdropTap} activeOpacity={1} onPress={onRetry} />
        <View style={[modalStyles.sheet, { backgroundColor: surface, borderColor: border }]}> 
          <View style={[modalStyles.iconCircle, { backgroundColor: '#EF44441A' }]}> 
            <Ionicons name="close-circle" size={32} color="#EF4444" />
          </View>
          <Text style={[modalStyles.title, { color: text }]}>{title}</Text>
          <Text style={[modalStyles.subtitle, { color: subtle }]}>{subtitle}</Text>
          <View style={[modalStyles.issueBox, { backgroundColor: surface, borderColor: border }]}> 
            <Text style={[modalStyles.issueLabel, { color: subtle }]}>Exact issue</Text>
            <Text style={[modalStyles.issueText, { color: text }]}>{issueText}</Text>
          </View>
          <View style={[modalStyles.matchesBox, { borderColor: border }]}> 
            <View style={modalStyles.matchRow}>
              <View style={[modalStyles.pill, { backgroundColor: '#10B98114' }]}> 
                <Text style={[modalStyles.pillText, { color: '#10B981' }]}>Target</Text>
              </View>
              <Text style={[modalStyles.heardLabel, { color: subtle }]} numberOfLines={1}>
                {targetWord || '—'}
              </Text>
            </View>
            <View style={modalStyles.matchRow}>
              <View style={[modalStyles.pill, { backgroundColor: '#EF444414' }]}> 
                <Text style={[modalStyles.pillText, { color: '#EF4444' }]}>Observed</Text>
              </View>
              <Text style={[modalStyles.heardLabel, { color: subtle }]} numberOfLines={1}>
                {observedWord || 'Try again'}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={[modalStyles.retryBtn, { backgroundColor: '#EF4444' }]} onPress={onRetry} activeOpacity={0.85}>
            <Ionicons name="refresh" size={16} color="#FFF" />
            <Text style={modalStyles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export function MinimalPairsScreen() {
  const EXERCISE_CARD_HEIGHT = 420;
  const [aiBubbleTop, setAiBubbleTop] = useState<number>(EXERCISE_CARD_HEIGHT + 24);
  const { resolvedTheme } = useAppTheme();
  const { aiEnabled, setAiEnabled } = useAICoPilot();
  const router = useRouter();
  const session = usePracticeSession();
  const tts = useTTSPlayback();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; language?: string }>();

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg = isDark ? '#080A10' : '#F0F4F8';
  const text = resolvedTheme.colors.text;
  const subtle = isDark ? '#7A8FA3' : '#8D9FAE';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const border = isDark ? '#252D3A' : '#E2E8EF';

  const [aiBubbleMessage, setAiBubbleMessage] = useState<string | null>(null);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

  const hasPlayedIntroRef = useRef(false);
  const waitingPromiseRef = useRef<Promise<void> | null>(null);

  // Two-step clinical protocol: Discrimination -> Production
  const [phase, setPhase] = useState<Phase>('discrimination');
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [resultState, setResultState] = useState<ResultState>(null);
  const [selectedSide, setSelectedSide] = useState<Side | null>(null);
  const [selfCorrectionAttempt, setSelfCorrectionAttempt] = useState(false);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [observedWord, setObservedWord] = useState<string | null>(null);
  const [errorIssue, setErrorIssue] = useState<string>('');

  const micHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micArmedRef = useRef(false);

  // Stop assistant audio on unmount
  useEffect(() => {
    return () => clarioAssistant.stop();
  }, []);

  // Play intro on mount
  useEffect(() => {
    if (!aiEnabled || !session.payload?.assistantLines || hasPlayedIntroRef.current) return;
    hasPlayedIntroRef.current = true;
    setIsAssistantSpeaking(true);
    clarioAssistant.playIntro(
      session.payload.assistantLines,
      session.payload.moduleDir ?? '',
      session.currentItemIndex > 0 ? 'resume' : 'fresh',
      (params.language as Language) ?? 'english',
      (text) => setAiBubbleMessage(text)
    ).finally(() => setIsAssistantSpeaking(false));
  }, [aiEnabled, session.payload?.assistantLines, session.currentItemIndex, session.payload?.moduleDir, params.language]);

  const { startRecording, stopRecording, metering } = useAudioRecorder();

  const { errorName, majorType } = getDiagnosisInfo(session.card?.diagnosis, session.payload?.setDiagnosis);
  const { analyzeRecording } = usePracticeAnalysis(
    String(session.card?.id ?? ''),
    errorName,
    majorType,
    (params.language as 'english' | 'urdu') ?? 'english',
    (params.mode as any) ?? 'efficient'
  );

  const pair = session.currentItem;

  // Randomize which side shows target vs foil
  const [isFlipped, setIsFlipped] = useState(false);

  const targetData = useMemo(() => {
    if (pair?.target) {
      return {
        word: String(pair.target.word ?? '').toUpperCase(),
        phonemes: extractIpaTokens(String(pair.target.ipa ?? '')).map((p: string) => `/${p}/`),
      };
    }
    if (pair?.target_word || pair?.word) {
      return {
        word: String(pair.target_word ?? pair.word ?? '').toUpperCase(),
        phonemes: extractIpaTokens(String(pair.ipa ?? '')).map((p: string) => `/${p}/`),
      };
    }
    return { word: 'CAP', phonemes: ['/k/', '/æ/', '/p/'] };
  }, [pair]);

  const foilData = useMemo(() => {
    if (pair?.foil) {
      return {
        word: String(pair.foil.word ?? '').toUpperCase(),
        phonemes: extractIpaTokens(String(pair.foil.ipa ?? '')).map((p: string) => `/${p}/`),
      };
    }
    if (pair?.foil_word) {
      return {
        word: String(pair.foil_word ?? '').toUpperCase(),
        phonemes: extractIpaTokens(String(pair.foil_ipa ?? '')).map((p: string) => `/${p}/`),
      };
    }
    return { word: 'TAP', phonemes: ['/t/', '/æ/', '/p/'] };
  }, [pair]);

  const leftCard = isFlipped ? foilData : targetData;
  const rightCard = isFlipped ? targetData : foilData;
  const targetSide: Side = isFlipped ? 'right' : 'left';

  // Randomize on item change & Reset Flow
  useEffect(() => {
    setIsFlipped(Math.random() > 0.5);
    setPhase('discrimination');
    setSessionState('idle');
    setResultState(null);
    setSelectedSide(null);
    setSelfCorrectionAttempt(false);
    setErrorHint(null);
    setObservedWord(null);
    setErrorIssue('');
    setShowErrorModal(false);
  }, [session.currentItemIndex]);

    // Discrimination mode: play audio then await tap
  const startDiscrimination = useCallback(async () => {
    setSessionState('playing_audio');
    setResultState(null);
    setSelectedSide(null);
    setSelfCorrectionAttempt(false);

    const speakWord = pair?.target?.word ?? pair?.target_word ?? pair?.word ?? 'cap';
    await tts.playWord(speakWord);
    setSessionState('awaiting_tap');
  }, [pair, tts]);

  // Handle card tap in discrimination mode
  const onCardTap = useCallback((side: Side) => {
    if (sessionState !== 'awaiting_tap') return;

    const correct = side === targetSide;
    setSelectedSide(side);
    setResultState(correct ? 'correct' : 'incorrect');
    setErrorHint(correct ? null : 'Try again and listen more carefully.');
    setErrorIssue(correct ? '' : getReplacementIssue(targetData.phonemes, side === 'left' ? leftCard.phonemes : rightCard.phonemes));
    setShowErrorModal(!correct);
    setSessionState('result');
    if (!selfCorrectionAttempt || correct) {
      session.recordAttempt(correct ? 'correct' : 'incorrect', {
        word: correct ? targetData.word : foilData.word,
        mode: 'discrimination',
      });
    }
  }, [sessionState, targetSide, session, selfCorrectionAttempt, targetData.word, foilData.word]);

  // Production mode: mic recording
  const onMicPressIn = useCallback(async () => {
    if (sessionState === 'idle') {
      micArmedRef.current = true;
      if (micHoldTimeoutRef.current) {
        clearTimeout(micHoldTimeoutRef.current);
      }

      micHoldTimeoutRef.current = setTimeout(async () => {
        if (!micArmedRef.current) return;

        setResultState(null);
        setSelectedSide(null);
        setSelfCorrectionAttempt(false);
        setSessionState('recording');

        try {
          await startRecording();
        } catch (error) {
          micArmedRef.current = false;
          setSessionState('idle');
          console.error('[MinimalPairs] startRecording failed:', error);
        }
      }, MIC_HOLD_DELAY_MS);
    }
  }, [sessionState, startRecording]);

  const onMicPressOut = useCallback(async () => {
    if (micHoldTimeoutRef.current) {
      clearTimeout(micHoldTimeoutRef.current);
      micHoldTimeoutRef.current = null;
    }

    if (!micArmedRef.current) return;
    micArmedRef.current = false;

    if (sessionState !== 'recording') {
      setSessionState('idle');
      return;
    }

    if (sessionState === 'recording') {
      setSessionState('processing');

      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        waitingPromiseRef.current = clarioAssistant.playWaiting(
          session.payload.assistantLines,
          session.payload.moduleDir ?? '',
          (params.language as Language) ?? 'english',
          (text) => setAiBubbleMessage(text)
        );
        waitingPromiseRef.current.finally(() => setIsAssistantSpeaking(false));
      }

      const uri = await stopRecording();
      if (uri) {
        const targetWord = pair?.target?.word ?? pair?.target_word ?? pair?.word ?? leftCard.word;
        const rawIpa = String(pair?.target?.ipa ?? pair?.ipa ?? '').trim();
        const fallbackIpa = targetData.phonemes.map((p) => p.replace(/\//g, '')).join(' ');
        const targetsJson = buildTargetsJson(targetWord, rawIpa || fallbackIpa);
        if (!targetsJson) {
          console.warn('[MinimalPairs] Missing target IPA; skipping analysis');
          setSessionState('idle');
          clarioAssistant.stop();
          return;
        }

        try {
          const expectedPhonemesIpa = rawIpa || fallbackIpa;
          const analysis = await UAB_API.analyzePhonemesOnly(
            uri,
            expectedPhonemesIpa,
            (params.language as Language) ?? 'english'
          );

          // For phoneme-only analysis, we display the raw extracted phonemes as the observed text
          if (analysis.detected_phonemes?.length) {
            const detectedPhonemes = analysis.detected_phonemes.map((phoneme: string) => formatPhoneme(phoneme));
            setObservedWord(detectedPhonemes.join(' '));
            setErrorIssue(getReplacementIssue(targetData.phonemes, detectedPhonemes));
          } else {
            setObservedWord(null);
            setErrorIssue(`Expected ${targetData.phonemes.map(formatPhoneme).join(' ')} but no clear sound was detected`);
          }

          // Use strict phoneme matching threshold since Whisper word alignment is bypassed
          const isCorrect = (analysis?.accuracy_score ?? 0) >= 65;
          setResultState(isCorrect ? 'correct' : 'incorrect');
          setErrorHint(isCorrect ? null : 'Try again and focus on the target sound.');
          setShowErrorModal(!isCorrect);
          setSessionState('result');
          if (isCorrect) {
            setErrorIssue('');
          }

          if (waitingPromiseRef.current) {
            await waitingPromiseRef.current;
            waitingPromiseRef.current = null;
          }

          if (aiEnabled && session.payload?.assistantLines) {
            setIsAssistantSpeaking(true);
            clarioAssistant.playValidation(
              session.payload.assistantLines,
              session.payload.moduleDir ?? '',
              isCorrect ? 0 : 1,
              (params.language as Language) ?? 'english',
              (text) => setAiBubbleMessage(text)
            ).finally(() => setIsAssistantSpeaking(false));
          }

          if (!selfCorrectionAttempt || isCorrect) {
            session.recordAttempt(isCorrect ? 'correct' : 'incorrect', { mode: 'production' });
          }
        } catch (error) {
          console.error('[MinimalPairs] analyzePhonemesOnly failed:', error);
          setSessionState('idle');
          clarioAssistant.stop();
        }
      } else {
        setSessionState('idle');
        clarioAssistant.stop();
      }
    }
  }, [sessionState, stopRecording, analyzeRecording, pair, leftCard.word, session, aiEnabled, params.language, selfCorrectionAttempt, targetData.word, errorName, majorType]);

  const onRetry = useCallback(() => {
    setShowErrorModal(false);
    if (resultState === 'incorrect') {
      setSelfCorrectionAttempt(true);
      setResultState(null);
      setSelectedSide(null);
      setErrorHint(null);
      setObservedWord(null);
      setErrorIssue('');
      if (phase === 'discrimination') {
        setSessionState('awaiting_tap');
      } else {
        setSessionState('idle');
      }
      return;
    }
    setResultState(null);
    setSelectedSide(null);
    setSelfCorrectionAttempt(false);
    setErrorHint(null);
    setObservedWord(null);
    setErrorIssue('');
    setSessionState('idle');
    setShowErrorModal(false);
  }, [resultState, phase]);

  const onContinue = useCallback(async () => {
    clarioAssistant.stop();
    
    if (phase === 'discrimination') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPhase('production');
      setSessionState('idle');
      setResultState(null);
      setSelectedSide(null);
      setSelfCorrectionAttempt(false);
      setErrorHint(null);
      setShowErrorModal(false);
        setAiBubbleMessage(`Great! Now you say it. Say the word: ${targetData.word}`);
        // Set the bubble message immediately without playing audio
        if (aiEnabled && session.payload?.assistantLines) {
          setAiBubbleMessage(`Great! Now you say it. Say the word: ${targetData.word}`);
        }
    } else {
      const hasNext = session.nextItem();
      if (hasNext) {
        if (aiEnabled && session.payload?.assistantLines) {
          setIsAssistantSpeaking(true);
          clarioAssistant.playTransition(
            session.payload.assistantLines,
            session.payload.moduleDir ?? '',
            (params.language as Language) ?? 'english',
            (text) => setAiBubbleMessage(text)
          ).finally(() => setIsAssistantSpeaking(false));
        }
      } else {
        if (aiEnabled && session.payload?.assistantLines) {
          setIsAssistantSpeaking(true);
          await clarioAssistant.playCompletion(
            session.payload.assistantLines,
            session.payload.moduleDir ?? '',
            (params.language as Language) ?? 'english'
          );
          setIsAssistantSpeaking(false);
        }
        await session.completeSession();
        setTimeout(() => router.back(), 500);
      }
    }
  }, [phase, session, router, aiEnabled, params.language, targetData.word]);

  // Clean, clinical styling for the cards. Only highlight the selected side.
  const getCardStyle = (side: Side) => {
    const isSelected = selectedSide === side;

    if (!isSelected) {
      return {
        bg: surface,
        border: border,
        textColor: isDark ? '#D6DEEA' : '#243244',
        pillBg: isDark ? '#1A2230' : '#F1F5FA'
      };
    }

    if (resultState === 'correct') {
      return {
        bg: '#10B98112',
        border: '#10B981',
        textColor: '#10B981',
        pillBg: '#10B98120'
      };
    }

    // Incorrect selection
    return {
      bg: '#EF444410',
      border: '#EF4444',
      textColor: '#EF4444',
      pillBg: '#EF444420'
    };
  };

  const leftStyle = getCardStyle('left');
  const rightStyle = getCardStyle('right');

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <GradientGlow color={PRIMARY} isDark={isDark} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: border, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 4 : 8 }]}>
        <TouchableOpacity onPress={() => { tts.stop(); router.back(); }} style={[styles.closeBtn, { backgroundColor: isDark ? '#1A2030' : '#EEF1F5' }]}>
          <Ionicons name="close" size={18} color={subtle} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={[styles.modeChip, { backgroundColor: isDark ? '#1A2030' : '#EEF1F5' }]}>
            <Text style={[styles.modeChipText, { color: subtle }]}>Minimal Pairs</Text>
          </View>
          <Text style={[styles.headerMeta, { color: subtle }]}>{session.progressLabel}</Text>
        </View>

        <AICoPilotToggle state={aiEnabled ? 'idle' : 'off'} onToggle={() => setAiEnabled(!aiEnabled)} />
      </View>

      {aiEnabled && <View style={[styles.aiGlowStrip, { backgroundColor: AI_ACCENT + '28' }]} />}

      <View style={[styles.progressTrack, { backgroundColor: isDark ? '#1A2030' : '#E6EBF0' }]}>
        <View style={[styles.progressFill, { width: `${session.progress * 100}%`, backgroundColor: PRIMARY }]} />
      </View>

      {aiEnabled && aiBubbleMessage && (
        <AIFeedbackBubble
          message={aiBubbleMessage}
          isSpeaking={isAssistantSpeaking}
          onDismiss={() => setAiBubbleMessage(null)}
          style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 0 }}
        />
      )}

      <View style={styles.content}>
        <View
          style={[styles.exerciseCard, { backgroundColor: surface, borderColor: border, shadowColor: PRIMARY, height: EXERCISE_CARD_HEIGHT }]}
        > 
          <View style={[styles.exerciseCardGlow, { backgroundColor: PRIMARY + '10' }]} />

          {/* hero panel removed per UI request */}

          {/* Mode chips */}
          <View style={styles.chipRow}>
            <View style={[styles.modeChip, { backgroundColor: PRIMARY + '12' }]}> 
              <Ionicons name={phase === 'discrimination' ? 'ear-outline' : 'mic-outline'} size={12} color={PRIMARY} />
              <Text style={[styles.modeChipText, { color: PRIMARY }]}> 
                {phase === 'discrimination' ? 'Step 1: Discrimination' : 'Step 2: Production'}
              </Text>
            </View>
            {aiEnabled && (
              <View style={[styles.modeChip, { backgroundColor: AI_ACCENT + '12' }]}> 
                <Ionicons name="sparkles" size={11} color={AI_ACCENT} />
                <Text style={[styles.modeChipText, { color: AI_ACCENT }]}>AI Assisted</Text>
              </View>
            )}
          </View>

          {/* Instruction */}
          <View style={[styles.instructionChip, { backgroundColor: PRIMARY + '14' }]}> 
            <Ionicons name={phase === 'discrimination' ? 'ear-outline' : 'mic-outline'} size={12} color={PRIMARY} />
            <Text style={[styles.instructionText, { color: PRIMARY }]}> 
              {phase === 'discrimination'
                ? (sessionState === 'awaiting_tap' ? 'Tap the word you heard' : 'Listen to the word')
                : `Say the word: ${targetData.word}`}
            </Text>
          </View>

          {/* Play button for discrimination */}
          {phase === 'discrimination' && sessionState === 'idle' && (
            <TouchableOpacity
              style={[styles.playAudioBtn, { backgroundColor: PRIMARY, shadowColor: PRIMARY }]}
              onPress={startDiscrimination}
              activeOpacity={0.85}
            >
              <Ionicons name="play" size={20} color="#FFF" />
              <Text style={styles.playAudioBtnText}>Play Word</Text>
            </TouchableOpacity>
          )}

          {sessionState === 'playing_audio' && (
            <View style={styles.playingIndicator}>
              <Ionicons name="volume-high" size={20} color={PRIMARY} />
              <Text style={[styles.playingText, { color: PRIMARY }]}>Playing…</Text>
            </View>
          )}

          {/* Cards */}
          <View style={styles.cardsContainer}>
            {phase === 'production' ? (
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.cardTouchArea, styles.productionCardTouchArea]}
                onPress={() => undefined}
                disabled
              >
                <View style={[
                  styles.wordCard,
                  styles.productionWordCard,
                  {
                    backgroundColor: resultState === 'correct'
                      ? '#10B98112'
                      : resultState === 'incorrect'
                        ? '#EF444410'
                        : surface,
                    borderColor: sessionState === 'recording' ? PRIMARY + '70' : resultState === 'correct'
                      ? '#10B981'
                      : resultState === 'incorrect'
                        ? '#EF4444'
                        : border,
                    shadowColor: sessionState === 'recording' ? PRIMARY : resultState === 'correct' ? PRIMARY : '#0B1220',
                    shadowOpacity: sessionState === 'recording' ? 0.22 : resultState === 'correct' ? 0.28 : 0.08,
                    shadowRadius: sessionState === 'recording' ? 24 : resultState === 'correct' ? 14 : 10,
                    shadowOffset: { width: 0, height: resultState === 'correct' ? 8 : 4 },
                    elevation: sessionState === 'recording' ? 8 : resultState === 'correct' ? 6 : 2,
                    overflow: 'hidden',
                  },
                ]}>
                  <View style={[styles.cardGlow, { backgroundColor: sessionState === 'recording' ? PRIMARY + '10' : 'transparent' }]} />
                  <Text
                    style={[styles.wordText, styles.productionWordText, { color: resultState === 'correct' ? '#10B981' : resultState === 'incorrect' ? '#EF4444' : subtle }]}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    minimumFontScale={0.55}
                  >
                    {targetData.word}
                  </Text>
                  <PhonemePills
                    phonemes={targetData.phonemes}
                    color={resultState === 'correct' ? '#10B981' : resultState === 'incorrect' ? '#EF4444' : subtle}
                    bg={resultState === 'correct' ? '#10B98120' : resultState === 'incorrect' ? '#EF444420' : isDark ? '#222A36' : '#F1F4F7'}
                  />
                  <View style={{ alignItems: 'center', marginTop: 14 }}>
                    <MicButton
                      sessionState={sessionState}
                      color={PRIMARY}
                      subtle={subtle}
                      disabled={phase !== 'production' || sessionState === 'processing' || sessionState === 'playing_audio' || sessionState === 'result' || isAssistantSpeaking}
                      onPressIn={onMicPressIn}
                      onPressOut={onMicPressOut}
                    />
                  </View>
                  {/* Result badges */}
                  {resultState === 'correct' && (
                    <View style={[styles.resultBadge, { backgroundColor: '#10B981' }]}>
                      <Ionicons name="checkmark" size={12} color="#FFF" />
                    </View>
                  )}
                  {resultState === 'incorrect' && (
                    <View style={[styles.resultBadge, { backgroundColor: '#EF4444' }]}>
                      <Ionicons name="close" size={12} color="#FFF" />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ) : (
              <>
                {/* Left Card - Discrimination */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.cardTouchArea, styles.discriminationCardTouchArea]}
                  onPress={() => onCardTap('left')}
                  disabled={sessionState !== 'awaiting_tap'}
                >
                  <View style={[
                    styles.wordCard,
                    {
                      backgroundColor: leftStyle.bg,
                      borderColor: leftStyle.border,
                      shadowColor: selectedSide === 'left' ? PRIMARY : '#0B1220',
                      shadowOpacity: selectedSide === 'left' ? 0.28 : 0.08,
                      shadowRadius: selectedSide === 'left' ? 14 : 10,
                      shadowOffset: { width: 0, height: selectedSide === 'left' ? 8 : 4 },
                      elevation: selectedSide === 'left' ? 6 : 2,
                    },
                  ]}>
                    <Text
                      style={[styles.wordText, { color: leftStyle.textColor }]}
                      adjustsFontSizeToFit
                      numberOfLines={1}
                      minimumFontScale={0.55}
                    >
                      {leftCard.word}
                    </Text>
                    <PhonemePills
                      phonemes={leftCard.phonemes}
                      color={leftStyle.textColor}
                      bg={leftStyle.pillBg}
                    />
                    {selectedSide === 'left' && resultState === 'correct' && (
                      <View style={[styles.resultBadge, { backgroundColor: '#10B981' }]}>
                        <Ionicons name="checkmark" size={12} color="#FFF" />
                      </View>
                    )}
                    {selectedSide === 'left' && resultState === 'incorrect' && (
                      <View style={[styles.resultBadge, { backgroundColor: '#EF4444' }]}>
                        <Ionicons name="close" size={12} color="#FFF" />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>

                {/* Right Card - Discrimination */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={[styles.cardTouchArea, styles.discriminationCardTouchArea]}
                  onPress={() => onCardTap('right')}
                  disabled={sessionState !== 'awaiting_tap'}
                >
                  <View style={[
                    styles.wordCard,
                    {
                      backgroundColor: rightStyle.bg,
                      borderColor: rightStyle.border,
                      shadowColor: selectedSide === 'right' ? PRIMARY : '#0B1220',
                      shadowOpacity: selectedSide === 'right' ? 0.28 : 0.08,
                      shadowRadius: selectedSide === 'right' ? 14 : 10,
                      shadowOffset: { width: 0, height: selectedSide === 'right' ? 8 : 4 },
                      elevation: selectedSide === 'right' ? 6 : 2,
                    },
                  ]}>
                    <Text
                      style={[styles.wordText, { color: rightStyle.textColor }]}
                      adjustsFontSizeToFit
                      numberOfLines={1}
                      minimumFontScale={0.55}
                    >
                      {rightCard.word}
                    </Text>
                    <PhonemePills
                      phonemes={rightCard.phonemes}
                      color={rightStyle.textColor}
                      bg={rightStyle.pillBg}
                    />
                    {selectedSide === 'right' && resultState === 'correct' && (
                      <View style={[styles.resultBadge, { backgroundColor: '#10B981' }]}>
                        <Ionicons name="checkmark" size={12} color="#FFF" />
                      </View>
                    )}
                    {selectedSide === 'right' && resultState === 'incorrect' && (
                      <View style={[styles.resultBadge, { backgroundColor: '#EF4444' }]}>
                        <Ionicons name="close" size={12} color="#FFF" />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              </>
            )}
          </View>

          {sessionState === 'recording' && (
            <View style={styles.visualizerWrap}>
              <VoiceVisualizer metering={metering} isRecording={true} />
            </View>
          )}
        </View>

      </View>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: border, paddingBottom: Math.max(insets.bottom + 14, 24) }]}>
        {/* Mic moved to center of production card */}

        {phase === 'discrimination' && (
          <Text style={[styles.footerLabel, { color: subtle }]}>
            {sessionState === 'idle' && 'Press play to hear the word'}
            {sessionState === 'playing_audio' && 'Listening…'}
            {sessionState === 'awaiting_tap' && 'Which word did you hear?'}
            {sessionState === 'result' && (resultState === 'correct' ? 'Great contrast!' : 'Try once more')}
          </Text>
        )}

        {sessionState === 'result' && (
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: isDark ? '#162033' : '#F1F5FA', borderColor: border }]}
              onPress={onRetry}
            >
              <Ionicons name="refresh" size={16} color={text} />
              <Text style={[styles.actionBtnText, { color: text }]}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionBtn, 
                styles.actionBtnPrimary, 
                { backgroundColor: PRIMARY }
              ]}
              onPress={onContinue}
            >
              <Text style={[styles.actionBtnText, { color: '#FFF' }]}>
                Continue
              </Text>
              <Ionicons name="arrow-forward" size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <MinimalPairsErrorModal
        visible={showErrorModal}
        title="Pronunciation Error"
        subtitle={phase === 'discrimination'
          ? 'The selected word did not match the target.'
          : (errorHint ?? 'Your pronunciation needs another pass.')}
        issueText={errorIssue || (phase === 'discrimination'
          ? getReplacementIssue(targetData.phonemes, selectedSide === 'left' ? leftCard.phonemes : rightCard.phonemes)
          : `Expected ${targetData.phonemes.map(formatPhoneme).join(' ')} but heard ${observedWord || 'nothing'}`)}
        targetWord={targetData.word}
        observedWord={phase === 'discrimination'
          ? (selectedSide === 'left' ? leftCard.word : rightCard.word)
          : (observedWord || targetData.word)}
        onRetry={onRetry}
        surface={surface}
        text={text}
        subtle={subtle}
        border={border}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerMeta: { fontSize: 12, marginTop: 2, fontWeight: '500' },
  aiGlowStrip: { height: 3 },
  progressTrack: {
    height: 6,
    marginHorizontal: 24,
    marginTop: 12,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 999 },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  exerciseCard: {
    borderWidth: 1,
    borderRadius: 28,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    alignSelf: 'stretch',
    flex: 1,
    overflow: 'hidden',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
  },
  exerciseCardGlow: {
    height: 4,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  heroPanel: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextWrap: { flex: 1 },
  heroTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  heroSubtitle: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  heroMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  heroMetaText: {
    fontSize: 11,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  /* aiBubbleOverlay removed; using aiBubbleSlot below the card */
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  modeChipText: { fontSize: 11, fontWeight: '700' },
  aiBubbleSlot: { minHeight: 80, marginBottom: 4 },
  aiBubbleOverlayBottom: {
    position: 'absolute',
    left: 16,
    right: 16,
    top:  (/* will be set dynamically via layout */ 0) as any,
    alignItems: 'center',
    zIndex: 40,
    elevation: 40,
    pointerEvents: 'none',
  },
  micInnerDock: {
    position: 'absolute',
    right: 14,
    bottom: 12,
  },
  instructionChip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  instructionText: { fontSize: 12, fontWeight: '700' },
  playAudioBtn: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    marginBottom: 16,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  playAudioBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  playingIndicator: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  playingText: {
    fontSize: 14,
    fontWeight: '700',
  },
  cardsContainer: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
    flex: 1,
  },
  cardTouchArea: { alignSelf: 'stretch', minWidth: 0 },
  discriminationCardTouchArea: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
  },
  wordCard: {
    width: '100%',
    minHeight: 168,
    borderWidth: 1.5,
    borderRadius: 28,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
  },
  productionCardTouchArea: {
    width: '100%',
    alignItems: 'center',
    minWidth: 0,
  },
  productionWordCard: {
    width: '100%',
    maxWidth: '100%',
    minHeight: 280,
    paddingVertical: 24,
    justifyContent: 'center',
    gap: 16,
    borderRadius: 32,
  },
  productionWordText: {
    fontSize: 38,
    marginTop: 0,
    marginBottom: 0,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  wordText: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 4,
    marginBottom: 8,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  resultBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorHint: {
    marginTop: 10,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  errorHintText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '800',
  },
  visualizerWrap: {
    marginTop: 14,
    alignItems: 'center',
  },
  footer: {
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 18,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  micDock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginBottom: 2,
  },
  micButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLabel: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '500',
  },
  cardActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    width: '100%', marginTop: 16, gap: 10,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 13,
  },
  actionBtnPrimary: { borderWidth: 0 },
  actionBtnText: { fontSize: 14, fontWeight: '700' },
  cardGlow: { height: 4, position: 'absolute', top: 0, left: 0, right: 0 },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 44,
    alignItems: 'center',
  },
  iconCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  issueBox: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
  },
  issueLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  issueText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  matchesBox: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    marginBottom: 24,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  pillText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  heardLabel: {
    fontSize: 11,
    flex: 1,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 27,
    shadowColor: '#EF4444',
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  retryBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
