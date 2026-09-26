import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { AICoPilotToggle, AI_ACCENT } from '@/components/detection/AICoPilotToggle';
import { AIFeedbackBubble } from '@/components/detection/AIFeedbackBubble';
import { VoiceVisualizer } from '@/components/detection/VoiceVisualizer';
import { MicButton } from '@/components/practice/MicButton';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { usePracticeSession } from '@/hooks/usePracticeSession';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UAB_API } from '@/lib/api';
import { clarioAssistant } from '@/lib/clarioAssistant';
import { buildTargetsJson, getDiagnosisInfo, normaliseToSnakeCase } from '@/lib/practiceUtils';
import type { FlaggedWord, Language, TestType } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';

type SessionState = 'idle' | 'recording' | 'processing' | 'result';
type WordStatus = 'neutral' | 'correct' | 'warning' | 'error';

// ─── Phonology error label map ─────────────────────────────────────────────
const PROCESS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  velar_fronting: { label: 'Velar Fronting', color: '#8B5CF6', icon: 'swap-horizontal-outline' },
  stopping: { label: 'Stopping', color: '#EF4444', icon: 'remove-circle-outline' },
  gliding: { label: 'Gliding', color: '#F59E0B', icon: 'git-branch-outline' },
  cluster_reduction: { label: 'Cluster Reduction', color: '#EC4899', icon: 'layers-outline' },
  epenthesis: { label: 'Epenthesis', color: '#06B6D4', icon: 'add-circle-outline' },
  substitution: { label: 'Substitution', color: '#F97316', icon: 'swap-horizontal-outline' },
  omission: { label: 'Omission', color: '#6366F1', icon: 'remove-outline' },
  addition: { label: 'Addition', color: '#10B981', icon: 'add-outline' },
};
function getErrorMeta(fw: FlaggedWord) {
  if (fw.error_category === 'phonology') {
    const ph = fw as any;
    const key = ph.sub_test_type ?? ph.error_type ?? 'substitution';
    return PROCESS_LABELS[key] ?? PROCESS_LABELS.substitution;
  }
  return { label: fw.error_type, color: '#EF4444', icon: 'warning-outline' };
}

// ─── Clinical test-type router for carrier phrases ────────────────────────
// Rule:
//   - Specific phonology error (velar_fronting, stopping, etc.) → that detector
//   - General artic/substitution plan → 'phonology' (all 5 detectors)
//   - Fluency mode → infer from fluencyTechnique (prolonged_speech→prolongation, else blocks)
//   - Fluency error name maps directly (blocks, prolongation, repetition) → use it
const PHONOLOGY_PROCESSES = new Set<string>(
  ['velar_fronting', 'stopping', 'gliding', 'cluster_reduction', 'epenthesis']
);
const FLUENCY_PROCESSES = new Set<string>(['blocks', 'prolongation', 'repetition']);

function deriveCarrierTestType(
  errorName: string,
  majorType: string,
  isArtic: boolean,
  fluencyTechnique: string
): TestType {
  const key = normaliseToSnakeCase(errorName);
  if (PHONOLOGY_PROCESSES.has(key)) return key as TestType;
  if (FLUENCY_PROCESSES.has(key)) return key as TestType;
  if (!isArtic) {
    // Infer from fluency technique when error name is generic
    return fluencyTechnique === 'prolonged_speech' ? 'prolongation' : 'blocks';
  }
  // Articulation with generic error → run all 5 phonology detectors
  const major = normaliseToSnakeCase(majorType);
  if (major === 'artic' || major === 'phonology') return 'phonology';
  return 'comprehensive';
}

const TEAL = '#1FB7BC';

function FluencyTechniqueIcon({ technique, color }: { technique: string; color: string }) {
  switch (technique) {
    case 'easy_onset':
      return <Ionicons name="water-outline" size={14} color={color} />;
    case 'prolonged_speech':
      return <Ionicons name="timer-outline" size={14} color={color} />;
    case 'light_contact':
      return <Ionicons name="hand-left-outline" size={14} color={color} />;
    default:
      return <Ionicons name="pulse-outline" size={14} color={color} />;
  }
}


export function CarrierPhrasesScreen() {
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

  const [showBubble, setShowBubble] = useState(true);
  const [showPhonemeTip, setShowPhonemeTip] = useState(false);
  const [aiBubbleMessage, setAiBubbleMessage] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [statuses, setStatuses] = useState<WordStatus[]>([]);
  const [showTargetSlot, setShowTargetSlot] = useState(false);
  const [flaggedWords, setFlaggedWords] = useState<FlaggedWord[]>([]);
  const [sentenceAccuracy, setSentenceAccuracy] = useState<number>(0);
  const [transcript, setTranscript] = useState<string>('');
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

  const recordStartRef = useRef<number>(0);
  const hasPlayedIntroRef = useRef(false);
  const waitingPromiseRef = useRef<Promise<void> | null>(null);

  const handleAIBubbleMessage = useCallback((message: string) => {
    setShowBubble(true);
    setAiBubbleMessage(message);
  }, []);

  const dismissAIBubble = useCallback(() => {
    clarioAssistant.stop();
    setIsAssistantSpeaking(false);
    setAiBubbleMessage(null);
    setShowBubble(false);
  }, []);

  // Stop all audio on unmount
  useEffect(() => {
    return () => { clarioAssistant.stop(); tts.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play intro
  useEffect(() => {
    if (!aiEnabled || !session.payload?.assistantLines || hasPlayedIntroRef.current) return;
    hasPlayedIntroRef.current = true;
    setIsAssistantSpeaking(true);
    clarioAssistant.playIntro(
      session.payload.assistantLines,
      session.payload.moduleDir ?? '',
      session.currentItemIndex > 0 ? 'resume' : 'fresh',
      (params.language as Language) ?? 'english',
      handleAIBubbleMessage
    ).finally(() => setIsAssistantSpeaking(false));
  }, [aiEnabled, session.payload?.assistantLines, session.currentItemIndex, session.payload?.moduleDir, params.language, handleAIBubbleMessage]);

  const { startRecording, stopRecording, metering } = useAudioRecorder();

  const { errorName, majorType } = getDiagnosisInfo(session.card?.diagnosis, session.payload?.setDiagnosis);
  const lang = (params.language as Language) ?? 'english';
  const mode = (params.mode === 'assistant' ? 'assistant' : 'efficient') as 'efficient' | 'assistant';

  // Extract data
  const clinicalPurpose = String(session.payload?.items?.clinical_purpose ?? 'articulation');
  const isArticulation = clinicalPurpose === 'articulation';
  const fluencyTechnique = String(session.payload?.items?.fluency_technique ?? 'easy_onset');

  const phraseWords = useMemo(() => {
    const fullSentence = String(session.currentItem?.full_sentence ?? '').trim();
    if (!fullSentence) return ['I', 'see', 'a', 'key'];
    return fullSentence.split(/\s+/).filter(Boolean);
  }, [session.currentItem]);

  const rawTargetWordIndex = session.currentItem?.target_word_index;
  const targetIndex = Number.isInteger(rawTargetWordIndex) ? Number(rawTargetWordIndex) : phraseWords.length - 1;
  const targetWord = String(session.currentItem?.target_word ?? phraseWords[targetIndex] ?? '');
  const targetIpa = String(session.currentItem?.target_ipa ?? '');

  const hasPlayedPhraseRef = useRef(false);

  // Reset state when item changes
  useEffect(() => {
    setStatuses(phraseWords.map(() => 'neutral'));
    setSessionState('idle');
    setShowTargetSlot(false);
    setShowBubble(true);
    setFlaggedWords([]);
    setSentenceAccuracy(0);
    setTranscript('');
    setShowErrorModal(false);
    hasPlayedPhraseRef.current = false;
  }, [session.currentItemIndex]);

  // Auto-play model sentence ONLY when assistant is not speaking and we haven't played it yet for this item
  useEffect(() => {
    if (sessionState === 'idle' && !isAssistantSpeaking && !hasPlayedPhraseRef.current) {
      hasPlayedPhraseRef.current = true;
      const t = setTimeout(() => {
        tts.playSentence(
          session.currentItem?.full_sentence ?? phraseWords.join(' ')
        );
      }, 400);
      return () => clearTimeout(t);
    }
  }, [sessionState, isAssistantSpeaking, session.currentItem, phraseWords, tts]);

  // For fluency mode, show the target word as soon as recording starts
  useEffect(() => {
    if (sessionState === 'recording' && !isArticulation && !showTargetSlot) {
      setShowTargetSlot(true);
    }
  }, [sessionState, isArticulation, showTargetSlot]);

  const isSuccess = useMemo(() => sessionState === 'result' && sentenceAccuracy >= 70 && flaggedWords.length === 0, [sessionState, sentenceAccuracy, flaggedWords]);

  const onMicPressIn = useCallback(async () => {
    if (sessionState === 'idle') {
      setStatuses(phraseWords.map(() => 'neutral'));
      setShowTargetSlot(false);
      setSessionState('recording');
      recordStartRef.current = Date.now();
      await startRecording();
    }
  }, [sessionState, phraseWords, startRecording]);

  const onMicPressOut = useCallback(async () => {
    if (sessionState === 'recording') {
      setSessionState('processing');

      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        waitingPromiseRef.current = clarioAssistant.playWaiting(
          session.payload.assistantLines,
          session.payload.moduleDir ?? '',
          lang,
          handleAIBubbleMessage
        );
        waitingPromiseRef.current.finally(() => setIsAssistantSpeaking(false));
      }

      const uri = await stopRecording();
      const duration = Date.now() - recordStartRef.current;

      if (!uri || duration < 500) {
        setSessionState('idle');
        clarioAssistant.stop();
        if (duration < 500) console.warn('[CarrierPhrases] Recording too short, ignoring');
        return;
      }

      const fullSentence = session.currentItem?.full_sentence ?? phraseWords.join(' ');
      const rawIpa = String(session.currentItem?.target_ipa ?? '').trim();
      const fallbackPhoneme = String(session.targetPhoneme ?? '').trim();

      let targetsJson: string | null = null;
      if (isArticulation) {
        targetsJson = buildTargetsJson(targetWord, rawIpa || fallbackPhoneme);
        if (!targetsJson) {
          console.warn('[CarrierPhrases] Missing IPA targets, scoring as skipped');
          setSentenceAccuracy(0);
          setFlaggedWords([]);
          setStatuses(phraseWords.map(() => 'neutral'));
          setSessionState('result');
          return;
        }
      } else {
        targetsJson = JSON.stringify([{ word: fullSentence, expected_ipa: [] }]);
      }

      const testType = deriveCarrierTestType(errorName, majorType, isArticulation, fluencyTechnique);

      try {
        const analysis = await UAB_API.analyzeText(
          uri,
          fullSentence,
          testType,
          mode,
          targetsJson ?? '',
          lang
        );

        let fw = analysis?.flagged_words ?? [];
        
        // Filter out any stray SODA events caused by full-sentence alignment mismatches
        // Only keep errors that occurred exactly on our target word
        if (isArticulation) {
          fw = fw.filter((f) => f.index_in_sentence === targetIndex);
        }
        
        setFlaggedWords(fw);
        setSentenceAccuracy(analysis?.sentence_accuracy ?? 0);
        setTranscript(analysis?.transcript ?? '');

        // Build per-word statuses from flagged_words index
        const errorSet = new Set(fw.map((f) => f.index_in_sentence));
        const newStatuses: WordStatus[] = phraseWords.map((_, i) =>
          errorSet.has(i) ? 'error' : 'correct'
        );
        setStatuses(newStatuses);

        const strong = (analysis?.sentence_accuracy ?? 0) >= 70 && fw.length === 0;
        setSessionState('result');
        if (!strong) {
          setShowErrorModal(true);
        }

        session.recordAttempt(strong ? 'correct' : 'incorrect', {
          sentence_id: fullSentence.toLowerCase().replace(/\s+/g, '_').slice(0, 40),
          word: targetWord,
          mode: isArticulation ? 'articulation' : 'fluency',
          flagged_words: fw,
          accuracy_score: analysis?.sentence_accuracy ?? 0,
        });

        if (waitingPromiseRef.current) {
          await waitingPromiseRef.current;
          waitingPromiseRef.current = null;
        }

        if (aiEnabled && session.payload?.assistantLines) {
          setIsAssistantSpeaking(true);
          clarioAssistant.playValidation(
            session.payload.assistantLines,
            session.payload.moduleDir ?? '',
            fw.length,
            lang,
            handleAIBubbleMessage
          ).finally(() => setIsAssistantSpeaking(false));
        }
      } catch (e) {
        console.warn('[CarrierPhrases] Analysis error:', e);
        setFlaggedWords([]);
        setSentenceAccuracy(0);
        setStatuses(phraseWords.map(() => 'neutral'));
        setSessionState('result');
      }
    }
  }, [sessionState, stopRecording, session, phraseWords, isArticulation, targetIndex, targetWord, aiEnabled, lang, mode, errorName, majorType, fluencyTechnique, handleAIBubbleMessage]);

  const onRetry = useCallback(() => {
    setStatuses(phraseWords.map(() => 'neutral'));
    setFlaggedWords([]);
    setSentenceAccuracy(0);
    setTranscript('');
    setShowTargetSlot(false);
    setShowErrorModal(false);
    setSessionState('idle');
  }, [phraseWords]);

  const onContinue = useCallback(async () => {
    clarioAssistant.stop();
    tts.stop();
    const hasNext = session.nextItem();
    if (hasNext) {
      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        clarioAssistant.playTransition(
          session.payload.assistantLines,
          session.payload.moduleDir ?? '',
          lang,
          handleAIBubbleMessage
        ).finally(() => setIsAssistantSpeaking(false));
      }
    } else {
      if (aiEnabled && session.payload?.assistantLines) {
        setIsAssistantSpeaking(true);
        await clarioAssistant.playCompletion(
          session.payload.assistantLines,
          session.payload.moduleDir ?? '',
          lang
        );
        setIsAssistantSpeaking(false);
      }
      await session.completeSession();
      setTimeout(() => router.back(), 500);
    }
  }, [session, router, aiEnabled, lang, tts, handleAIBubbleMessage]);

  const isBubbleVisible = aiEnabled && showBubble && !!aiBubbleMessage;
  const showMicButton = !isBubbleVisible;

  const fluencyTechLabel =
    fluencyTechnique === 'easy_onset' ? 'Easy Onset'
      : fluencyTechnique === 'prolonged_speech' ? 'Prolonged Speech'
        : fluencyTechnique === 'light_contact' ? 'Light Contact'
          : 'Fluency Technique';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
      <GradientGlow color={isArticulation ? PRIMARY : TEAL} isDark={isDark} />
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <View style={[styles.header, { borderBottomColor: border, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 4 : 8 }]}>
        <TouchableOpacity onPress={() => { tts.stop(); router.back(); }} style={[styles.closeBtn, { backgroundColor: isDark ? '#1A2030' : '#EEF1F5' }]}>
          <Ionicons name="close" size={18} color={subtle} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={[styles.modeChip, { backgroundColor: isDark ? '#1A2030' : '#EEF1F5' }]}>
            <Text style={[styles.modeChipText, { color: subtle }]}>Carrier Phrases</Text>
          </View>
          <Text style={[styles.headerMeta, { color: subtle }]}>{session.progressLabel}</Text>
        </View>

        <AICoPilotToggle state={aiEnabled ? 'idle' : 'off'} onToggle={() => setAiEnabled(!aiEnabled)} />
      </View>

      {aiEnabled && <View style={[styles.aiGlowStrip, { backgroundColor: AI_ACCENT + '28' }]} />}

      <View style={[styles.progressTrack, { backgroundColor: isDark ? '#1A2030' : '#E6EBF0' }]}>
        <View style={[styles.progressFill, { width: `${session.progress * 100}%`, backgroundColor: isArticulation ? PRIMARY : TEAL }]} />
      </View>

      <View style={styles.content}>
        <View style={[styles.exerciseCard, { backgroundColor: surface, borderColor: border, shadowColor: isArticulation ? PRIMARY : TEAL }]}>
          <View style={[styles.exerciseCardGlow, { backgroundColor: (isArticulation ? PRIMARY : TEAL) + '10' }]} />

          <View style={styles.chipRow}>
            <View style={[styles.heroModeChip, { backgroundColor: (isArticulation ? PRIMARY : TEAL) + '12' }]}>
              <Ionicons name="mic-outline" size={12} color={isArticulation ? PRIMARY : TEAL} />
              <Text style={[styles.heroModeChipText, { color: isArticulation ? PRIMARY : TEAL }]}>
                {isArticulation ? 'Articulation' : 'Fluency'}
              </Text>
            </View>
            {!isArticulation && (
              <View style={[styles.heroModeChip, { backgroundColor: TEAL + '12' }]}>
                <FluencyTechniqueIcon technique={fluencyTechnique} color={TEAL} />
                <Text style={[styles.heroModeChipText, { color: TEAL }]}>{fluencyTechLabel}</Text>
              </View>
            )}
          </View>

          <View style={styles.phraseStage}>
            {sessionState !== 'result' ? (
              <>
                {!isArticulation && fluencyTechnique === 'easy_onset' && (
                  <View style={[styles.easyOnsetBar, { backgroundColor: TEAL + '22' }]}>
                    <View style={[styles.easyOnsetGradient, { backgroundColor: TEAL + '44' }]} />
                    <Text style={[styles.easyOnsetLabel, { color: TEAL }]}>Easy onset →</Text>
                  </View>
                )}
                <View style={styles.phraseRow}>
                  {phraseWords.map((word, index) => {
                    const isTarget = index === targetIndex;
                    const isFluencySlot = !isArticulation && isTarget && !showTargetSlot;
                    return (
                      <TouchableOpacity key={`${word}-${index}`} activeOpacity={0.8}
                        onPress={() => isTarget && setShowPhonemeTip((prev) => !prev)}
                        disabled={!isTarget} style={styles.phraseWordWrap}>
                        <Text style={[styles.phraseWord, { color: isTarget ? (isArticulation ? PRIMARY : TEAL) : text }, isTarget && styles.targetWord]}>
                          {isFluencySlot ? '____' : word}
                        </Text>
                        {isTarget && !isFluencySlot && <View style={[styles.targetUnderline, { backgroundColor: (isArticulation ? PRIMARY : TEAL) + '66' }]} />}
                        {isTarget && !isFluencySlot && (
                          <View style={[styles.targetChip, { backgroundColor: (isArticulation ? PRIMARY : TEAL) + '16' }]}>
                            <Text style={[styles.targetChipText, { color: isArticulation ? PRIMARY : TEAL }]}>TARGET</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={[styles.helperText, { color: subtle }]}>
                  {isArticulation ? 'Say the whole phrase smoothly' : 'Ease into the carrier frame'}
                </Text>

                {showPhonemeTip && targetIpa && (
                  <View style={[styles.phonemeTip, { backgroundColor: isDark ? '#1D2632' : '#F3F7FA', borderColor: border }]}>
                    <Text style={[styles.phonemeTipTitle, { color: text }]}>{targetWord} → /{targetIpa}/</Text>
                    <Text style={[styles.phonemeTipBody, { color: subtle }]}>Target phoneme in this carrier phrase.</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.successState}>
                <View style={styles.successIconWrap}>
                  <Ionicons name="checkmark-circle" size={80} color="#10B981" />
                </View>
                <Text style={[styles.successTitle, { color: text }]}>
                  {isArticulation ? 'Excellent Target Clarity!' : 'Great Fluency Control!'}
                </Text>
                <Text style={[styles.successSubtitle, { color: subtle }]}>
                  {Math.round(sentenceAccuracy)}% accuracy • No errors detected
                </Text>

                <View style={styles.cardActions}>
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: border }]} onPress={onRetry}>
                    <Ionicons name="refresh" size={16} color={text} />
                    <Text style={[styles.actionBtnText, { color: text }]}>Retry</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary, { backgroundColor: isArticulation ? PRIMARY : TEAL }]} onPress={onContinue}>
                    <Text style={[styles.actionBtnText, { color: '#FFF' }]}>Continue</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFF" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>

        {sessionState !== 'result' && (
          <View style={styles.instructionWrap}>
            <TouchableOpacity
              style={[styles.instructionChip, { backgroundColor: isDark ? '#1A2230' : '#F8FAFC', borderColor: border }]}
              onPress={() => tts.playSentence(session.currentItem?.full_sentence ?? phraseWords.join(' '))}
            >
              <Ionicons name="volume-medium" size={16} color={isArticulation ? PRIMARY : TEAL} />
              <Text style={[styles.instructionText, { color: text }]}>Listen to phrase</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.visualizerWrap}>
          {sessionState === 'recording' && <VoiceVisualizer metering={metering} isRecording={true} />}
        </View>

      </View>

      <View style={[styles.footer, { borderTopColor: border, paddingBottom: Math.max(insets.bottom + 14, 24) }]}>
        {isBubbleVisible ? (
          <View style={styles.micDock}>
            <AIFeedbackBubble
              message={aiBubbleMessage}
              isSpeaking={isAssistantSpeaking}
              onDismiss={dismissAIBubble}
              style={{ marginHorizontal: 0, marginBottom: 6, width: '100%' }}
            />
          </View>
        ) : null}

        {showMicButton ? (
          <View style={styles.micDock}>
            <MicButton
              sessionState={sessionState}
              onPressIn={onMicPressIn}
              onPressOut={onMicPressOut}
              disabled={sessionState === 'processing' || sessionState === 'result' || isAssistantSpeaking}
              color={isArticulation ? PRIMARY : TEAL}
              subtle={subtle}
            />
          </View>
        ) : null}

        <Text style={[styles.footerLabel, { color: subtle }]}>
          {sessionState === 'idle' && 'Hold to record full phrase'}
          {sessionState === 'recording' && 'Release to stop'}
          {sessionState === 'processing' && 'Analysing phrase…'}
          {sessionState === 'result' && 'Great phrase control'}
        </Text>
      </View>

      <Modal visible={showErrorModal} transparent animationType="slide" onRequestClose={() => setShowErrorModal(false)}>
        <View style={modalStyles.backdrop}>
          <TouchableOpacity style={modalStyles.backdropTap} onPress={onRetry} activeOpacity={1} />
          <View style={[modalStyles.sheet, { backgroundColor: surface, borderColor: border }]}>
            <View style={[modalStyles.iconCircle, { backgroundColor: '#EF444415' }]}>
              <Ionicons name="warning-outline" size={32} color="#EF4444" />
            </View>
            <Text style={[modalStyles.title, { color: text }]}>Let's try that again</Text>
            <Text style={[modalStyles.subtitle, { color: subtle }]}>
              Accuracy was {Math.round(sentenceAccuracy)}%. {transcript ? `We heard: "${transcript}"` : ''}
            </Text>

            {flaggedWords.length > 0 && (
              <ScrollView style={{ width: '100%', maxHeight: 240, marginBottom: 20 }}>
                <View style={styles.errorCards}>
                  {flaggedWords.map((fw, i) => {
                    const meta = getErrorMeta(fw);
                    const ph = fw as any;
                    return (
                      <View key={i} style={[styles.errorCard, { backgroundColor: meta.color + '12', borderColor: meta.color + '44' }]}>
                        <View style={styles.errorCardHeader}>
                          <Ionicons name={meta.icon as any} size={14} color={meta.color} />
                          <Text style={[styles.errorCardProcess, { color: meta.color }]}>{meta.label}</Text>
                          <View style={[styles.errorWordPill, { backgroundColor: meta.color + '22' }]}>
                            <Text style={[styles.errorWordPillText, { color: meta.color }]}>"{fw.word}"</Text>
                          </View>
                        </View>
                        {fw.error_category === 'phonology' && ph.expected_phoneme && (
                          <View style={styles.phonemeRow}>
                            <View style={[styles.phonemePill, { backgroundColor: isDark ? '#1A2A3A' : '#E8F4FD' }]}>
                              <Text style={[styles.phonemePillLabel, { color: subtle }]}>Expected</Text>
                              <Text style={[styles.phonemePillVal, { color: text }]}>/{ph.expected_phoneme}/</Text>
                            </View>
                            <Ionicons name="arrow-forward-outline" size={12} color={subtle} />
                            <View style={[styles.phonemePill, { backgroundColor: meta.color + '18' }]}>
                              <Text style={[styles.phonemePillLabel, { color: subtle }]}>Heard</Text>
                              <Text style={[styles.phonemePillVal, { color: meta.color }]}>/{ph.heard_phoneme || '—'}/</Text>
                            </View>
                          </View>
                        )}
                        {!!ph.assistant_text && (
                          <Text style={[styles.errorCoachText, { color: subtle }]}>{ph.assistant_text}</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            )}

            <TouchableOpacity style={[modalStyles.retryBtn, { backgroundColor: '#EF4444' }]} onPress={onRetry}>
              <Ionicons name="refresh" size={18} color="#FFF" />
              <Text style={modalStyles.retryBtnText}>Retry Phrase</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView >
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  closeBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerMeta: { fontSize: 12, marginTop: 2, fontWeight: '500' },
  aiGlowStrip: { height: 3 },
  progressTrack: { height: 8, marginHorizontal: 24, marginTop: 12, borderRadius: 6, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },

  exerciseCard: {
    width: '100%',
    minHeight: 280,
    borderWidth: 1.5,
    borderRadius: 32,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 10,
  },
  exerciseCardGlow: { height: 4, position: 'absolute', top: 0, left: 0, right: 0 },

  modeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  modeChipText: { fontSize: 11, fontWeight: '700' },

  chipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 },
  heroModeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  heroModeChipText: { fontSize: 11, fontWeight: '700' },

  phraseStage: { width: '100%', alignItems: 'center', justifyContent: 'center', flex: 1 },
  easyOnsetBar: { alignSelf: 'stretch', borderRadius: 10, padding: 8, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 8 },
  easyOnsetGradient: { width: 40, height: 4, borderRadius: 2 },
  easyOnsetLabel: { fontSize: 11, fontWeight: '700' },
  phraseRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, paddingHorizontal: 10 },
  phraseWordWrap: { position: 'relative', paddingHorizontal: 2, marginBottom: 16 },
  phraseWord: { fontSize: 28, fontWeight: '500' },
  targetWord: { fontSize: 34, fontWeight: '900', letterSpacing: -0.4 },
  targetUnderline: { height: 4, borderRadius: 2, marginTop: 4 },
  targetChip: { position: 'absolute', top: -16, alignSelf: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  targetChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  helperText: { marginTop: 24, textAlign: 'center', fontSize: 14, fontWeight: '600' },

  phonemeTip: { marginTop: 16, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, width: '90%' },
  phonemeTipTitle: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
  phonemeTipBody: { fontSize: 12, lineHeight: 18 },

  instructionWrap: { marginTop: 24, alignItems: 'center' },
  instructionChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  instructionText: { fontSize: 13, fontWeight: '700' },

  visualizerWrap: { marginTop: 14, height: 60, width: '100%', alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: 8, paddingHorizontal: 16, paddingBottom: 18, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  micDock: { alignSelf: 'stretch', alignItems: 'center', marginBottom: 6 },
  footerLabel: { marginTop: 10, fontSize: 13, fontWeight: '500' },

  successState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  successIconWrap: { marginBottom: 12 },
  successTitle: { fontSize: 22, fontWeight: '800', marginBottom: 6 },
  successSubtitle: { fontSize: 14, fontWeight: '500', marginBottom: 24 },
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', gap: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 14 },
  actionBtnPrimary: { borderWidth: 0 },
  actionBtnText: { fontSize: 15, fontWeight: '700' },

  errorCards: { marginTop: 12, gap: 10 },
  errorCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  errorCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  errorCardProcess: { fontSize: 12, fontWeight: '800', flex: 1 },
  errorWordPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  errorWordPillText: { fontSize: 11, fontWeight: '700' },
  phonemeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  phonemePill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center' },
  phonemePillLabel: { fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  phonemePillVal: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  errorCoachText: { fontSize: 11, lineHeight: 16, marginTop: 4, fontStyle: 'italic' },
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
