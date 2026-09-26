/**
 * Phase A — Sound Recognition
 * Location: app/onboarding/phase-a.tsx
 *
 * Audio-first identification. One full-screen card per subtype.
 * User listens and responds: "Yes, that's me" / "Sometimes" / "Nope".
 *
 * Card set filtered by profile.primaryConcern:
 * fluency   → 3 cards
 * phonology → 5 cards
 * both/unsure → 8 cards
 *
 * Exit:
 * ≥1 confirmed → drill-down
 * 0 confirmed  → phase-c
 */

import { SoundCard } from '@/components/onboarding/SoundCard';
import { useLanguage } from '@/context/LanguageContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { prepareDrillDown } from '@/lib/drillDownStore';
import { haptics } from '@/lib/haptics';
import { ALL_SUBTYPES, ClinicalSubtype, FLUENCY_SUBTYPES, PHONOLOGY_SUBTYPES } from '@/lib/onboardingData';
import { Language } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  PanResponder,
  Platform,
  Animated as RNAnimated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ttsService } from '@/lib/ttsService';

const { width: screenWidth } = Dimensions.get('window');
const CARD_WIDTH  = screenWidth - 48;
const CARD_HEIGHT = 480;

// ── Isolated Swipeable Card Component ──────────────────────────────────────
// By placing the PanResponder and animated value in a child component, 
// we ensure that each card has its own unique animation state. 
// When the card is swiped away and unmounted, we never need to awkwardly reset it to 0.
interface SwipeableCardProps {
  subtype: ClinicalSubtype;
  language: Language;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}

const SwipeableCard = React.memo(({ subtype, language, onSwipeRight, onSwipeLeft }: SwipeableCardProps) => {
  const translateX = useRef(new RNAnimated.Value(0)).current;
  const isAnimating = useRef(false);

  // Keep references fresh without recreating the PanResponder
  const callbacks = useRef({ onSwipeRight, onSwipeLeft });
  callbacks.current = { onSwipeRight, onSwipeLeft };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isAnimating.current,
      onMoveShouldSetPanResponder: (_, gs) =>
        !isAnimating.current && Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.2,
      onPanResponderGrant: () => {
        if (!isAnimating.current) translateX.stopAnimation();
      },
      onPanResponderMove: (_, gs) => {
        translateX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (isAnimating.current) return;
        translateX.stopAnimation((value: number) => {
          const finalDx = Math.abs(value) > Math.abs(gs.dx) ? value : gs.dx;
          const shouldSwipe = Math.abs(finalDx) > 80 || (Math.abs(finalDx) > 30 && Math.abs(gs.vx) > 0.5);

          if (shouldSwipe) {
            isAnimating.current = true;
            const isRightSwipe = finalDx >= 0;
            const toValue = isRightSwipe ? 500 : -500;
            RNAnimated.timing(translateX, {
              toValue,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              // DO NOT reset translateX here! The component is about to be unmounted.
              // This prevents the card from flashing back to the center.
              if (isRightSwipe) callbacks.current.onSwipeRight();
              else callbacks.current.onSwipeLeft();
            });
          } else {
            isAnimating.current = true;
            RNAnimated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
              friction: 8,
            }).start(() => {
              isAnimating.current = false;
            });
          }
        });
      },
      onPanResponderTerminate: () => {
        if (isAnimating.current) return;
        RNAnimated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start(() => {
          isAnimating.current = false;
        });
      },
    })
  ).current;

  const yesOpacity = translateX.interpolate({ inputRange: [0, 60, 120],   outputRange: [0, 0.6, 1], extrapolate: 'clamp' });
  const noOpacity  = translateX.interpolate({ inputRange: [-120, -60, 0], outputRange: [1, 0.6, 0], extrapolate: 'clamp' });
  const cardRotate = translateX.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-5deg', '0deg', '5deg'], extrapolate: 'clamp' });

  return (
    <RNAnimated.View
      style={[styles.activeCard, { transform: [{ translateX }, { rotate: cardRotate }] }]}
      {...panResponder.panHandlers}
    >
      {/* YES overlay */}
      <RNAnimated.View style={[styles.swipeOverlay, styles.swipeOverlayRight, { opacity: yesOpacity }]}>
        <View style={[styles.swipeBadge, { backgroundColor: '#2CC775' }]}>
          <Ionicons name="checkmark" size={26} color="#FFF" />
          <Text style={styles.swipeBadgeText}>YES</Text>
        </View>
      </RNAnimated.View>

      {/* SKIP overlay */}
      <RNAnimated.View style={[styles.swipeOverlay, styles.swipeOverlayLeft, { opacity: noOpacity }]}>
        <View style={[styles.swipeBadge, { backgroundColor: '#FF453A' }]}>
          <Ionicons name="close" size={26} color="#FFF" />
          <Text style={styles.swipeBadgeText}>SKIP</Text>
        </View>
      </RNAnimated.View>

      <SoundCard subtype={subtype} language={language} />
    </RNAnimated.View>
  );
});

// ── Main Screen Component ──────────────────────────────────────────────────
export default function PhaseAScreen() {
  const router = useRouter();
  const { profile, clearSelections, setPhaseASelections } = useOnboarding();
  const { language } = useLanguage();
  const { resolvedTheme } = useAppTheme();

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const subtle  = isDark ? '#7A8FA3' : '#8D9FAE';
  const bg      = isDark ? '#0C0F14' : '#F8FAFB';

  // Filter card set by triage category
  const subtypes = useMemo(() => {
    if (profile.primaryConcern === 'fluency')   return FLUENCY_SUBTYPES;
    if (profile.primaryConcern === 'phonology') return PHONOLOGY_SUBTYPES;
    return ALL_SUBTYPES;
  }, [profile.primaryConcern]);

  // Reset swipe state every time this screen gains focus.
  // useEffect([]) only fires on mount — if Expo Router keeps the screen in the
  // stack (which it does), the refs survive across navigation and the stale
  // confirmed IDs from a previous session would leak into the next one.
  // useFocusEffect fires on every focus, guaranteeing a clean slate.
  const [cardIndex, setCardIndex] = useState(0);
  const swipeDecisions = useRef<Record<string, boolean>>({});

  const resetPhaseAState = useCallback(() => {
    clearSelections();
    swipeDecisions.current = {};
    setCardIndex(0);
  }, [clearSelections]);

  useFocusEffect(
    useCallback(() => {
      resetPhaseAState();
      return () => { ttsService.stopPlayback(); };
    }, [resetPhaseAState])
  );

  const currentSubtype = subtypes[cardIndex];
  const totalCards = subtypes.length;
  const isFirst = cardIndex === 0;

  const advance = useCallback(() => {
    if (cardIndex < totalCards - 1) {
      setCardIndex((prev) => prev + 1);
    } else {
      const confirmedIds = subtypes
        .filter((subtype) => swipeDecisions.current[subtype.id])
        .map((subtype) => subtype.id);

      if (confirmedIds.length > 0) {
        setPhaseASelections(confirmedIds);
        prepareDrillDown(confirmedIds);
        router.push('/onboarding/drill-down');
      } else {
        router.push('/onboarding/phase-c');
      }
    }
  }, [cardIndex, totalCards, router, subtypes, setPhaseASelections]);

  const handleConfirm = useCallback(() => {
    swipeDecisions.current[currentSubtype.id] = true;
    advance();
  }, [advance, currentSubtype.id]);

  const handleSkip = useCallback(() => {
    swipeDecisions.current[currentSubtype.id] = false;
    advance();
  }, [advance, currentSubtype.id]);

  const handleBack = useCallback(() => {
    if (isFirst) return;
    haptics.selection();
    setCardIndex((prev) => prev - 1);
  }, [isFirst]);

  const handleListBack = useCallback(() => {
    resetPhaseAState();
    router.back();
  }, [resetPhaseAState, router]);

  const dots = Array.from({ length: totalCards });
  const remaining    = totalCards - cardIndex;
  const visibleCount = Math.min(remaining, 3);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={handleListBack}
          style={styles.backLink}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={16} color={subtle} />
          <Text style={[styles.backLinkText, { color: subtle }]}>List</Text>
        </TouchableOpacity>
        <View style={styles.dotRow}>
          {dots.map((_, i) => {
            const active = i === cardIndex;
            const past   = i < cardIndex;
            return (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    width: active ? 22 : 8,
                    backgroundColor: past || active ? PRIMARY : isDark ? '#1E2530' : '#E0E6EA',
                    opacity: active ? 1 : past ? 0.6 : 0.35,
                  },
                ]}
              />
            );
          })}
        </View>
        <View style={styles.backLinkSpacer} />
      </View>

      {/* ── Card stack ── */}
      <View style={styles.stackContainer}>
        <View style={styles.stackArea}>

          {/* Ghost card 2 — furthest back */}
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
          {/* We now use FadeIn to make the next card smoothly 'unfade' into view */}
          <Animated.View
            key={`card-${cardIndex}`}
            entering={FadeIn.duration(200)}
            style={styles.activeCardWrap}
          >
            <SwipeableCard
              subtype={currentSubtype}
              language={language as Language}
              onSwipeRight={handleConfirm}
              onSwipeLeft={handleSkip}
            />
          </Animated.View>

        </View>
      </View>

      {/* ── Bottom bar: Previous + counter ── */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          onPress={handleBack}
          disabled={isFirst}
          style={[styles.prevBtn, { opacity: isFirst ? 0 : 1 }]}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={16} color={subtle} />
          <Text style={[styles.prevText, { color: subtle }]}>Previous</Text>
        </TouchableOpacity>

        <Animated.View entering={FadeIn.duration(400)}>
          <Text style={[styles.counterText, { color: subtle }]}>
            {cardIndex + 1} / {totalCards}
          </Text>
        </Animated.View>

        <View style={{ width: 90 }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  topBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 60,
  },
  backLinkText: {
    fontSize: 14,
    fontWeight: '500',
  },
  backLinkSpacer: { minWidth: 60 },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    justifyContent: 'center',
  },
  dot: { height: 5, borderRadius: 3 },

  stackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 24,
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
    borderRadius: 28,
    borderWidth: 1.5,
  },
  ghost1: {
    top: 14,
    transform: [{ scale: 0.94 }],
    zIndex: 2,
    opacity: 0.85,
  },
  ghost2: {
    top: 0,
    transform: [{ scale: 0.88 }],
    zIndex: 1,
    opacity: 0.6,
  },
  activeCardWrap: {
    position: 'absolute',
    top: 28,
    left: 0,
    right: 0,
    height: CARD_HEIGHT,
    zIndex: 3,
  },
  activeCard: {
    flex: 1,
  },

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
  swipeBadge: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  swipeBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 1.6,
  },

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  prevBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 90,
  },
  prevText: {
    fontSize: 14,
    fontWeight: '600',
  },
  counterText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});