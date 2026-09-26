/**
 * Phase C — Behavioural Questionnaire
 * Location: app/onboarding/phase-c.tsx
 *
 * Clinically valid diagnostic questions.
 * UI: Three-way swipe (Right = Yes, Left = No, Up = Sometimes).
 */

import React, { useCallback, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  PanResponder,
  Animated as RNAnimated,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useOnboarding } from '@/context/OnboardingContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAppTheme } from '@/theme-provider';
import {
  PHASE_C_CARDS,
  PhaseCAnswers,
  PhaseCCard,
  computePhaseCWeights,
  FLUENCY_SUBTYPES,
  PHONOLOGY_SUBTYPES,
  ALL_SUBTYPES,
  ClinicalSubtype,
} from '@/lib/onboardingData';
import { haptics } from '@/lib/haptics';
import { prepareDrillDown } from '@/lib/drillDownStore';
import { Language } from '@/lib/types';
import { ttsService } from '@/lib/ttsService';

const { width: screenWidth } = Dimensions.get('window');
const CARD_WIDTH  = screenWidth - 48;
const CARD_HEIGHT = 480;

// ── Isolated Three-Way Swipeable Card ─────────────────────────────────────────
interface SwipeableDiagnosticCardProps {
  card: PhaseCCard;
  language: Language;
  onAnswer: (answer: 'yes' | 'no' | 'sometimes') => void;
  isDark: boolean;
  themeColors: any;
}

const SwipeableDiagnosticCard = React.memo(({ card, language, onAnswer, isDark, themeColors }: SwipeableDiagnosticCardProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const translateY = useRef(new RNAnimated.Value(0)).current;
  const isAnimating = useRef(false);

  React.useEffect(() => {
    return () => {
      ttsService.stopPlayback();
    };
  }, []);

  const callbacks = useRef({ onAnswer });
  callbacks.current = { onAnswer };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isAnimating.current,
      onMoveShouldSetPanResponder: (_, gs) => {
        if (isAnimating.current) return false;
        // Require a minimum movement threshold before hijacking the gesture
        return Math.abs(gs.dx) > 10 || Math.abs(gs.dy) > 10;
      },
      onPanResponderGrant: () => {
        if (!isAnimating.current) {
          translateX.stopAnimation();
          translateY.stopAnimation();
        }
      },
      onPanResponderMove: (_, gs) => {
        translateX.setValue(gs.dx);
        // Prevent downward swipes, only allow pulling UP for 'sometimes'
        translateY.setValue(gs.dy < 0 ? gs.dy : 0);
      },
      onPanResponderRelease: (_, gs) => {
        if (isAnimating.current) return;

        const dx = gs.dx;
        const dy = gs.dy < 0 ? gs.dy : 0; // Filter out positive (downward) Y
        
        // Determine the dominant axis of the gesture
        const isHorizontal = Math.abs(dx) > Math.abs(dy);
        let action: 'yes' | 'no' | 'sometimes' | null = null;

        if (isHorizontal) {
          if (Math.abs(dx) > 80 || Math.abs(gs.vx) > 0.5) {
            action = dx > 0 ? 'yes' : 'no';
          }
        } else {
          if (dy < -80 || gs.vy < -0.5) {
            action = 'sometimes';
          }
        }

        if (action) {
          isAnimating.current = true;
          const toX = action === 'yes' ? 500 : action === 'no' ? -500 : 0;
          const toY = action === 'sometimes' ? -800 : 0; // Animate heavily UP

          RNAnimated.parallel([
            RNAnimated.timing(translateX, { toValue: toX, duration: 200, useNativeDriver: true }),
            RNAnimated.timing(translateY, { toValue: toY, duration: 200, useNativeDriver: true }),
          ]).start(() => {
            callbacks.current.onAnswer(action!);
          });
        } else {
          // Snap back if threshold not met
          isAnimating.current = true;
          RNAnimated.parallel([
            RNAnimated.spring(translateX, { toValue: 0, friction: 8, useNativeDriver: true }),
            RNAnimated.spring(translateY, { toValue: 0, friction: 8, useNativeDriver: true }),
          ]).start(() => {
            isAnimating.current = false;
          });
        }
      },
      onPanResponderTerminate: () => {
        if (isAnimating.current) return;
        RNAnimated.parallel([
          RNAnimated.spring(translateX, { toValue: 0, friction: 8, useNativeDriver: true }),
          RNAnimated.spring(translateY, { toValue: 0, friction: 8, useNativeDriver: true }),
        ]).start(() => {
          isAnimating.current = false;
        });
      },
    })
  ).current;

  const handleTTS = useCallback(async () => {
    if (isPlaying) return;
    const textToSpeak = language === 'urdu' ? card.ttsPromptUrdu : card.ttsPrompt;
    try {
      setIsPlaying(true);
      await ttsService.synthesizeAndPlay(textToSpeak, language, 'f');
    } catch (_) {} finally {
      setIsPlaying(false);
    }
  }, [card, language, isPlaying]);

  const yesOpacity = translateX.interpolate({ inputRange: [0, 60, 120],   outputRange: [0, 0.6, 1], extrapolate: 'clamp' });
  const noOpacity  = translateX.interpolate({ inputRange: [-120, -60, 0], outputRange: [1, 0.6, 0], extrapolate: 'clamp' });
  
  // Opacity for upward swipe reveals the badge at the bottom of the card
  const sometimesOpacity = translateY.interpolate({ inputRange: [-120, -60, 0], outputRange: [1, 0.6, 0], extrapolate: 'clamp' });
  
  const cardRotate = translateX.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-5deg', '0deg', '5deg'], extrapolate: 'clamp' });

  return (
    <RNAnimated.View
      style={[
        styles.activeCard,
        { transform: [{ translateX }, { translateY }, { rotate: cardRotate }] }
      ]}
      {...panResponder.panHandlers}
    >
      {/* YES overlay (Right) */}
      <RNAnimated.View style={[styles.swipeOverlay, styles.swipeOverlayRight, { opacity: yesOpacity }]}>
        <View style={[styles.swipeBadge, { backgroundColor: '#2CC775' }]}>
          <Ionicons name="checkmark" size={26} color="#FFF" />
          <Text style={styles.swipeBadgeText}>YES</Text>
        </View>
      </RNAnimated.View>

      {/* NO overlay (Left) */}
      <RNAnimated.View style={[styles.swipeOverlay, styles.swipeOverlayLeft, { opacity: noOpacity }]}>
        <View style={[styles.swipeBadge, { backgroundColor: '#FF453A' }]}>
          <Ionicons name="close" size={26} color="#FFF" />
          <Text style={styles.swipeBadgeText}>NO</Text>
        </View>
      </RNAnimated.View>

      {/* SOMETIMES overlay (Bottom edge, revealed on swipe up) */}
      <RNAnimated.View style={[styles.swipeOverlayBottom, { opacity: sometimesOpacity }]}>
        <View style={[styles.swipeBadge, { backgroundColor: '#FF9F0A' }]}>
          <Ionicons name="remove" size={26} color="#FFF" />
          <Text style={styles.swipeBadgeText}>SOMETIMES</Text>
        </View>
      </RNAnimated.View>

      {/* Card Content UI */}
      <View style={[styles.cardContent, { backgroundColor: isDark ? '#131820' : '#FFFFFF', borderColor: isDark ? '#1A2330' : '#CED9E2' }]}>
        
        <View style={styles.iconCircle}>
          <Ionicons name="medical-outline" size={34} color={themeColors.primary} />
        </View>
        
        <Text style={[styles.cardQuestion, { color: themeColors.text }]}>
          {language === 'urdu' ? card.questionUrdu : card.question}
        </Text>

        <View style={[styles.cardNote, { backgroundColor: isDark ? '#1A222C' : '#F0F4F8' }]}>
          <Ionicons name="information-circle-outline" size={20} color={isDark ? '#7A8FA3' : '#8D9FAE'} />
          <Text style={[styles.cardNoteText, { color: isDark ? '#7A8FA3' : '#8D9FAE' }]}>
            {language === 'urdu' ? card.noteUrdu : card.note}
          </Text>
        </View>

        {/* Flexible spacer to push the TTS button to the bottom */}
        <View style={{ flex: 1 }} />

        {/* TTS Button at Bottom */}
        <TouchableOpacity 
          style={[styles.ttsBtnBottom, { backgroundColor: isDark ? '#1A222C' : '#F0F4F8' }]}
          onPress={handleTTS}
          disabled={isPlaying}
          activeOpacity={0.7}
        >
          <Ionicons name={isPlaying ? "volume-high" : "volume-medium"} size={20} color={themeColors.primary} />
          <Text style={[styles.ttsBtnText, { color: themeColors.primary }]}>
            {isPlaying ? "Playing..." : "Listen to example"}
          </Text>
        </TouchableOpacity>

      </View>
    </RNAnimated.View>
  );
});

// ── Main Screen Component ──────────────────────────────────────────────────
export default function PhaseCScreen() {
  const router = useRouter();
  const { profile, setPhaseASelections } = useOnboarding();
  const { language } = useLanguage();
  const { resolvedTheme } = useAppTheme();

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#5E7487' : '#9AABB8';
  const bg      = isDark ? '#0F1318' : '#F4F7FA';

  // Filter cards based on triage
  const currentPhaseCCards = useMemo(() => {
    const fluencyIds = FLUENCY_SUBTYPES.map(s => s.id);
    const phonoIds = PHONOLOGY_SUBTYPES.map(s => s.id);

    if (profile.primaryConcern === 'fluency') return PHASE_C_CARDS.filter(c => fluencyIds.includes(c.id));
    if (profile.primaryConcern === 'phonology') return PHASE_C_CARDS.filter(c => phonoIds.includes(c.id));
    return PHASE_C_CARDS;
  }, [profile.primaryConcern]);

  const [cardIndex, setCardIndex] = useState(0);
  const answers = useRef<PhaseCAnswers>({});

  const totalCards = currentPhaseCCards.length;
  const currentCard = currentPhaseCCards[cardIndex];
  const isFirst = cardIndex === 0;

  const handleBack = useCallback(() => {
    if (isFirst) return;
    haptics.selection();
    setCardIndex((prev) => prev - 1);
  }, [isFirst]);

  const finalize = useCallback((currentAnswers: PhaseCAnswers) => {
    const weightMap = computePhaseCWeights(currentAnswers);
    const hasWeights = (Object.values(weightMap) as number[]).some((w) => w >= 1);

    let ids: string[];
    if (hasWeights) {
      ids = Object.entries(weightMap)
        .filter(([, w]) => (w as number) >= 1)
        .map(([id]) => id);
    } else {
      // Fallback: use all subtypes for the user's primary concern
      const fallback: ClinicalSubtype[] =
        profile.primaryConcern === 'fluency'   ? FLUENCY_SUBTYPES   :
        profile.primaryConcern === 'phonology' ? PHONOLOGY_SUBTYPES :
        ALL_SUBTYPES;
      ids = fallback.map((s: ClinicalSubtype) => s.id);
    }

    setPhaseASelections(ids);
    prepareDrillDown(ids);
    router.push('/onboarding/drill-down');
  }, [profile.primaryConcern, router, setPhaseASelections]);

  const handleCardAnswer = useCallback((answer: 'yes' | 'no' | 'sometimes') => {
    if (!currentCard) return;
    
    (answers.current as any)[currentCard.id] = answer;

    if (cardIndex < totalCards - 1) {
      setCardIndex((prev) => prev + 1);
    } else {
      finalize(answers.current);
    }
  }, [cardIndex, currentCard, totalCards, finalize]);

  const remaining    = totalCards - cardIndex;
  const visibleCount = Math.min(remaining, 3);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>

      {/* ── Top Bar ── */}
      <Animated.View
        entering={FadeInDown.duration(380)}
        style={[styles.header, { backgroundColor: bg }]}
      >
        <TouchableOpacity
          onPress={handleBack}
          disabled={isFirst}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          style={[styles.headerBtn, {
            opacity: isFirst ? 0 : 1,
            backgroundColor: isDark ? '#1A222C' : '#EAEFF4',
          }]}
        >
          <Ionicons name="chevron-back" size={20} color={subtle} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: text }]}>Diagnostics</Text>
          <Text style={[styles.headerSub, { color: subtle }]}>
            {cardIndex + 1} of {totalCards}
          </Text>
        </View>

        <View style={styles.headerBtn} />
      </Animated.View>

      {/* ── Progress track ── */}
      <Animated.View
        entering={FadeIn.delay(80).duration(400)}
        style={styles.progressWrap}
      >
        <View style={[styles.progressTrack, { backgroundColor: isDark ? '#1A222C' : '#E2E8ED' }]}>
          <Animated.View
            style={[styles.progressFill, {
              backgroundColor: PRIMARY,
              width: `${Math.max(6, ((cardIndex + 1) / totalCards) * 100)}%`,
            }]}
          />
        </View>
      </Animated.View>

      {/* ── Card Stack ── */}
      <View style={styles.stackContainer}>
        <View style={styles.stackArea}>

          {/* Ghost card 2 */}
          {visibleCount >= 3 && (
            <View style={[
              styles.ghostCard,
              styles.ghost2,
              { backgroundColor: isDark ? '#131820' : '#F0F4F7', borderColor: isDark ? '#1A2330' : '#C8D8E0' },
            ]} />
          )}

          {/* Ghost card 1 */}
          {visibleCount >= 2 && (
            <View style={[
              styles.ghostCard,
              styles.ghost1,
              { backgroundColor: isDark ? '#131820' : '#F3F7FA', borderColor: isDark ? '#1A2330' : '#CED9E2' },
            ]} />
          )}

          {/* Active card */}
          <Animated.View
            key={`phc-${cardIndex}`}
            entering={FadeIn.duration(200)}
            style={styles.activeCardWrap}
          >
            {currentCard && (
              <SwipeableDiagnosticCard
                card={currentCard}
                language={language as Language}
                onAnswer={handleCardAnswer}
                isDark={isDark}
                themeColors={resolvedTheme.colors}
              />
            )}
          </Animated.View>

        </View>
      </View>
      
      {/* Interaction Hint (with inline icons) */}
      <Animated.View entering={FadeIn.delay(300).duration(500)} style={styles.hintWrap}>
        <View style={styles.hintRow}>
          <View style={styles.hintItem}>
            <Ionicons name="arrow-back" size={14} color={subtle} />
            <Text style={[styles.hintText, { color: subtle }]}>No</Text>
          </View>
          
          <View style={[styles.hintDot, { backgroundColor: subtle }]} />
          
          <View style={styles.hintItem}>
            <Ionicons name="arrow-up" size={14} color={subtle} />
            <Text style={[styles.hintText, { color: subtle }]}>Sometimes</Text>
          </View>
          
          <View style={[styles.hintDot, { backgroundColor: subtle }]} />
          
          <View style={styles.hintItem}>
            <Text style={[styles.hintText, { color: subtle }]}>Yes</Text>
            <Ionicons name="arrow-forward" size={14} color={subtle} />
          </View>
        </View>
      </Animated.View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 12 : 8,
    paddingBottom: 10,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },

  progressWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    zIndex: 1,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Stack styling (matches Phase A)
  stackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
  },
  stackArea: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT + 24,
    position: 'relative',
  },
  ghostCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: CARD_HEIGHT,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  ghost1: {
    top: 12,
    transform: [{ scale: 0.965 }],
    zIndex: 2,
  },
  ghost2: {
    top: 0,
    transform: [{ scale: 0.93 }],
    zIndex: 1,
  },
  activeCardWrap: {
    position: 'absolute',
    top: 24,
    left: 0,
    right: 0,
    height: CARD_HEIGHT,
    zIndex: 3,
  },
  activeCard: {
    flex: 1,
  },
  
  // Card Internal Content
  cardContent: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(52, 199, 89, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  cardQuestion: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 32,
    marginBottom: 32,
  },
  cardNote: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 10,
    width: '100%',
  },
  cardNoteText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  ttsBtnBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 100,
    gap: 8,
    marginTop: 20,
    width: '100%',
  },
  ttsBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  hintWrap: {
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    alignItems: 'center',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hintItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  hintText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  hintDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },

  // Swipe overlays
  swipeOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 110,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    pointerEvents: 'none',
  },
  swipeOverlayRight: { right: 20 },
  swipeOverlayLeft:  { left: 20 },
  swipeOverlayBottom: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
    pointerEvents: 'none',
  },
  swipeBadge: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 4,
  },
  swipeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: 1.4,
  },
});