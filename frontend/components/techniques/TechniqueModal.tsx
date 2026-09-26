/**
 * TechniqueModal.tsx — Tabbed technique detail screen
 *
 * Three-tab layout:
 *   1. Learn    — hero, description, step-by-step how-to
 *   2. Practice — audio model, incorrect/correct, practice words, sentence
 *   3. Tips     — pro tips, relevant disorders, category context
 *
 * Bottom sticky bar with "Mark as Reviewed" CTA + review timestamp.
 *
 * Changes from V1:
 *   - Tabbed UI replaces single-scroll layout
 *   - DIFFICULTY_STYLES imported from @/lib/techniqueData (no local copy)
 *   - stepRow now has flexDirection: 'row' (was missing)
 *   - direction uses isRTL dynamically instead of hardcoded 'ltr'
 *   - Minimal-pair words containing '/' are split into separate chips
 *   - Review tracking with bottom bar CTA
 *   - Category color theming throughout
 *   - PlaybackWave shared-value declarations made explicit
 */
import { useLanguage } from '@/context/LanguageContext';
import { haptics } from '@/lib/haptics';
import {
  CATEGORY_MAP,
  DIFFICULTY_STYLES,
  SUBTYPE_COLORS,
  SUBTYPE_LABELS,
  TECHNIQUE_YOUTUBE_IDS,
  TechniqueGuide,
  TURQUOISE,
  getTechniqueTier,
} from '@/lib/techniqueData';
import { YouTubeOverlay } from '@/components/techniques/YouTubeOverlay';
import { TechniquePracticeSession } from '@/components/techniques/TechniquePracticeSession';
import { DAFSession } from '@/components/techniques/DAFSession';
import { ttsService } from '@/lib/ttsService';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// ─── Types ─────────────────────────────────────────────────────────────────

type TabKey = 'learn' | 'practice' | 'tips';

interface Tab {
  key: TabKey;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { key: 'learn',    label: 'Learn',    icon: 'book-outline' },
  { key: 'practice', label: 'Practice', icon: 'mic-outline' },
  { key: 'tips',     label: 'Tips',     icon: 'bulb-outline' },
];

interface Props {
  visible: boolean;
  technique: TechniqueGuide | null;
  onClose: () => void;
  reviewed?: boolean;
  reviewDate?: string | null;
  onMarkReviewed?: () => void;
  onUnmarkReviewed?: () => void;
}

// ─── Animated wave bar ─────────────────────────────────────────────────────

const WaveBar = ({ value, color }: { value: SharedValue<number>; color: string }) => {
  const style = useAnimatedStyle(() => ({
    height: value.value,
    backgroundColor: color,
    borderRadius: 2,
    width: 3.5,
  }));
  return <Animated.View style={style} />;
};

function PlaybackWave({ isPlaying, color }: { isPlaying: boolean; color: string }) {
  const bar0 = useSharedValue(3);
  const bar1 = useSharedValue(3);
  const bar2 = useSharedValue(3);
  const bar3 = useSharedValue(3);
  const bar4 = useSharedValue(3);
  const bars = [bar0, bar1, bar2, bar3, bar4];

  useEffect(() => {
    if (isPlaying) {
      bars.forEach((bar, i) => {
        const maxH = 14 + Math.random() * 10;
        const dur  = 280 + Math.random() * 180;
        bar.value = withDelay(
          i * 55,
          withRepeat(
            withSequence(
              withTiming(maxH, { duration: dur / 2, easing: Easing.inOut(Easing.ease) }),
              withTiming(3,    { duration: dur / 2, easing: Easing.inOut(Easing.ease) })
            ),
            -1,
            true
          )
        );
      });
    } else {
      bars.forEach(bar => { bar.value = withTiming(3, { duration: 200 }); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, bars]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 }}>
      {bars.map((bar, i) => (
        <View key={i}><WaveBar value={bar} color={color} /></View>
      ))}
    </View>
  );
}

// ─── Word Chip ─────────────────────────────────────────────────────────────

function WordChip({
  word, isActive, cardBg, textColor, accentColor, onPress,
}: {
  word: string;
  isActive: boolean;
  cardBg: string;
  textColor: string;
  accentColor: string;
  onPress: (word: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(word)}
      accessibilityLabel={`Practice word: ${word}`}
      accessibilityRole="button"
      style={({ pressed }: { pressed: boolean }) => [
        styles.wordChip,
        { backgroundColor: cardBg, opacity: pressed ? 0.7 : 1 },
        isActive && { backgroundColor: accentColor + '22' },
      ]}
    >
      <Text style={[styles.wordChipText, { color: textColor }]}>{word}</Text>
    </Pressable>
  );
}

// ─── Learn Tab ─────────────────────────────────────────────────────────────

function VideoCard({
  isTier1,
  accentColor,
  hasVideo,
  onPress,
}: {
  isTier1: boolean;
  accentColor: string;
  hasVideo: boolean;
  onPress: () => void;
}) {
  if (!isTier1) return null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Watch video demonstration"
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.videoCard,
        { backgroundColor: accentColor + '14', borderColor: accentColor + '40', opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={[styles.videoCardIconWrap, { backgroundColor: accentColor + '22' }]}>
        <Ionicons name="logo-youtube" size={26} color={accentColor} />
      </View>
      <View style={styles.videoCardText}>
        <Text style={[styles.videoCardTitle, { color: accentColor }]}>
          {hasVideo ? 'Watch Demonstration' : 'Video Demonstration'}
        </Text>
        <Text style={styles.videoCardSub}>
          {hasVideo
            ? 'See a therapist demonstrate this technique'
            : 'Video will be linked here soon'}
        </Text>
      </View>
      <Ionicons
        name={hasVideo ? 'play-circle' : 'time-outline'}
        size={22}
        color={accentColor}
      />
    </Pressable>
  );
}

function LearnTab({
  technique, catColor, diff, isDark, textColor, rowDir, isTier1, onWatchVideo,
}: {
  technique: TechniqueGuide;
  catColor: string;
  diff: typeof DIFFICULTY_STYLES[keyof typeof DIFFICULTY_STYLES];
  isDark: boolean;
  textColor: string;
  rowDir: 'row' | 'row-reverse';
  isTier1: boolean;
  onWatchVideo: () => void;
}) {
  const hasVideo = !!TECHNIQUE_YOUTUBE_IDS[technique.id];
  return (
    <Animated.View entering={FadeInDown.duration(300)}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: catColor + '18' }]}>
          <Ionicons name={technique.icon as any} size={30} color={catColor} />
        </View>

        <Text style={[styles.heroTitle, { color: textColor }]}>
          {technique.title}
        </Text>

        {technique.romanizedTitle && (
          <Text style={[styles.heroRomanized, { color: textColor }]}>
            {technique.romanizedTitle}
          </Text>
        )}

        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: isDark ? diff.bgDark : diff.bg }]}>
            <Text style={[styles.badgeText, { color: diff.text }]}>{technique.difficulty}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: catColor + '22' }]}>
            <Text style={[styles.badgeText, { color: catColor }]}>{technique.category}</Text>
          </View>
        </View>

        {/* Subtype tags */}
        <View style={styles.subtypeRow}>
          {technique.subtypes.map((sub) => {
            const c = SUBTYPE_COLORS[sub] ?? catColor;
            return (
              <View key={sub} style={[styles.badge, { backgroundColor: c + '1A' }]}>
                <Text style={[styles.badgeText, { color: c }]}>
                  {SUBTYPE_LABELS[sub] ?? sub}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* What & Why */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: textColor }]}>What & Why</Text>
        <View style={[styles.descCard, { backgroundColor: isDark ? '#161B24' : '#FFFFFF' }]}>
          <Text style={[styles.descText, { color: textColor }]}>
            {technique.description}
          </Text>
        </View>
      </View>

      {/* Video Card — Tier 1 only */}
      {isTier1 && (
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: textColor }]}>Video</Text>
          <VideoCard
            isTier1={isTier1}
            accentColor={catColor}
            hasVideo={hasVideo}
            onPress={onWatchVideo}
          />
        </View>
      )}

      {/* How To */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: textColor }]}>Step-by-Step</Text>
        {technique.howTo.map((step: string, i: number) => (
          <View key={i} style={[styles.stepRow, { flexDirection: rowDir }]}>
            <View style={[styles.stepNum, { backgroundColor: catColor }]}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={[styles.stepText, { color: textColor }]}>
              {step}
            </Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

// ─── Practice Tab ──────────────────────────────────────────────────────────

function PracticeTab({
  technique, catColor, cardBg, textColor,
  isPlaying, playingWord, onPlayModel, onPlayWord,
  isTier1, onWatchVideo,
}: {
  technique: TechniqueGuide;
  catColor: string;
  cardBg: string;
  textColor: string;
  isPlaying: boolean;
  playingWord: string | null;
  onPlayModel: () => void;
  onPlayWord: (word: string) => void;
  isTier1: boolean;
  onWatchVideo: () => void;
}) {
  const hasVideo = !!TECHNIQUE_YOUTUBE_IDS[technique.id];
  return (
    <Animated.View entering={FadeInDown.duration(300)}>

      {/* Tier 1: Video banner at top of practice tab */}
      {isTier1 && (
        <View style={[styles.section, { marginTop: 20 }]}>
          <Text style={[styles.sectionHeader, { color: textColor }]}>Watch First</Text>
          <VideoCard
            isTier1={isTier1}
            accentColor={catColor}
            hasVideo={hasVideo}
            onPress={onWatchVideo}
          />
          <View style={[styles.tier1Note, { backgroundColor: catColor + '10', borderColor: catColor + '30' }]}>
            <Ionicons name="information-circle-outline" size={15} color={catColor} />
            <Text style={[styles.tier1NoteText, { color: textColor }]}>
              This is a self-guided technique. Watch the video, follow the steps, then mark it as practiced.
            </Text>
          </View>
        </View>
      )}

      {/* Listen & Model */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: textColor }]}>Listen & Model</Text>
        <View style={[styles.listenCard, { backgroundColor: cardBg }]}>
          {technique.example.incorrect && (
            <View style={styles.exampleBlock}>
              <Text style={[styles.exampleLabel, { color: '#FF5252' }]}>INCORRECT</Text>
              <View style={[styles.exampleAccentCard, { borderLeftColor: '#FF5252', backgroundColor: '#FF525210' }]}>
                <View style={[styles.exampleIconWrap, { backgroundColor: '#FF525220' }]}>
                  <Ionicons name="close-circle" size={16} color="#FF5252" />
                </View>
                <Text style={[styles.exampleIncorrect, { color: textColor }]}>
                  {technique.example.incorrect}
                </Text>
              </View>
            </View>
          )}
          <View style={styles.exampleBlock}>
            <Text style={[styles.exampleLabel, { color: catColor }]}>CORRECT</Text>
            <View style={[styles.exampleAccentCard, { borderLeftColor: catColor, backgroundColor: catColor + '12' }]}>
              <View style={[styles.exampleIconWrap, { backgroundColor: catColor + '25' }]}>
                <Ionicons name="checkmark-circle" size={16} color={catColor} />
              </View>
              <Text style={[styles.exampleCorrect, { color: textColor }]}>
                {technique.example.correct}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.playBtnFull, { backgroundColor: catColor }]}
            onPress={onPlayModel}
            accessibilityLabel={isPlaying ? 'Stop audio' : 'Play audio example'}
            accessibilityRole="button"
          >
            <Ionicons name={isPlaying ? 'stop-circle' : 'play-circle'} size={22} color="#FFF" />
            <Text style={styles.playBtnFullText}>{isPlaying ? 'Stop' : 'Play Example'}</Text>
            <View style={styles.playBtnWave}>
              <PlaybackWave isPlaying={isPlaying} color="#FFF" />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Practice Words */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: textColor }]}>Practice Words</Text>
        <View style={styles.chipGrid}>
          {technique.practiceWords.flatMap((word: string) => {
            // Split minimal pairs (e.g. 'blue/buhlue') into separate chips
            if (word.includes('/')) {
              return word.split('/').map((part) => (
                <WordChip
                  key={part.trim()}
                  word={part.trim()}
                  isActive={playingWord === part.trim()}
                  cardBg={cardBg}
                  textColor={textColor}
                  accentColor={catColor}
                  onPress={onPlayWord}
                />
              ));
            }
            return (
              <WordChip
                key={word}
                word={word}
                isActive={playingWord === word}
                cardBg={cardBg}
                textColor={textColor}
                accentColor={catColor}
                onPress={onPlayWord}
              />
            );
          })}
        </View>

        {technique.practiceSentence && (
          <View style={[styles.sentenceCard, { borderLeftColor: catColor, backgroundColor: catColor + '08' }]}>
            <Text style={[styles.sentenceText, { color: textColor }]}>
              {technique.practiceSentence}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ─── Tips Tab ──────────────────────────────────────────────────────────────

function TipsTab({
  technique, catColor, isDark, cardBg, textColor,
}: {
  technique: TechniqueGuide;
  catColor: string;
  isDark: boolean;
  cardBg: string;
  textColor: string;
}) {
  return (
    <Animated.View entering={FadeInDown.duration(300)}>
      {/* Pro Tips */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: textColor }]}>Pro Tips</Text>
        {technique.tips.map((tip: string, i: number) => (
          <View key={i} style={[styles.tipCard, { backgroundColor: cardBg }]}>
            <Ionicons name="bulb-outline" size={18} color="#FFA726" style={styles.tipIcon} />
            <Text style={[styles.tipText, { color: textColor }]}>{tip}</Text>
          </View>
        ))}
      </View>

      {/* Relevant Disorders */}
      <View style={styles.section}>
        <Text style={[styles.sectionHeader, { color: textColor }]}>Relevant For</Text>
        <View style={styles.contextTagRow}>
          {technique.subtypes.map((sub) => {
            const c = SUBTYPE_COLORS[sub] ?? catColor;
            return (
              <View key={sub} style={[styles.contextBadge, { backgroundColor: c + '1A' }]}>
                <Ionicons name="medical-outline" size={13} color={c} />
                <Text style={[styles.contextBadgeText, { color: c }]}>
                  {SUBTYPE_LABELS[sub] ?? sub}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Category context */}
      <View style={[styles.section, styles.lastSection]}>
        <Text style={[styles.sectionHeader, { color: textColor }]}>Category</Text>
        <View style={[styles.categoryCard, { backgroundColor: catColor + '12' }]}>
          <Ionicons name={technique.icon as any} size={20} color={catColor} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.categoryTitle, { color: catColor }]}>
              {technique.category}
            </Text>
            <Text style={[styles.categoryDesc, { color: textColor }]}>
              {technique.difficulty} level technique
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Main modal ────────────────────────────────────────────────────────────

export function TechniqueModal({
  visible,
  technique,
  onClose,
  reviewed = false,
  reviewDate,
  onMarkReviewed,
  onUnmarkReviewed,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const { language, isRTL } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabKey>('learn');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingWord, setPlayingWord] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [showPractice, setShowPractice] = useState(false);
  const [showDAF, setShowDAF] = useState(false);

  const isDark    = resolvedTheme.dark;
  const bgColor   = isDark ? '#0C0F14' : '#F8FAFB';
  const cardBg    = isDark ? '#161B24' : '#FFFFFF';
  const textColor = resolvedTheme.colors.text;
  const border    = isDark ? '#252D3A' : '#EDF0F3';
  const subtle    = isDark ? '#7A8FA3' : '#8D9FAE';

  useEffect(() => {
    if (!visible) {
      setIsPlaying(false);
      setPlayingWord(null);
      setActiveTab('learn');
      setShowVideo(false);
      setShowPractice(false);
      setShowDAF(false);
      ttsService.stopPlayback();
    }
    return () => {
      ttsService.stopPlayback();
    };
  }, [visible]);

  if (!technique) return null;

  const catMeta   = CATEGORY_MAP[technique.category];
  const catColor  = catMeta?.color ?? TURQUOISE;
  const diff      = DIFFICULTY_STYLES[technique.difficulty];
  const rowDir    = isRTL ? 'row-reverse' as const : 'row' as const;
  const isTier1   = getTechniqueTier(technique) === 1;
  const isTier3   = getTechniqueTier(technique) === 3;
  const videoId   = TECHNIQUE_YOUTUBE_IDS[technique.id] ?? null;

  const handleOpenVideo = () => setShowVideo(true);

  const handlePlayModel = async () => {
    if (isPlaying) {
      await ttsService.stopPlayback();
      setIsPlaying(false);
      return;
    }
    try {
      setIsPlaying(true);
      await ttsService.synthesizeAndPlay(technique.example.audioText, language);
    } catch (e) {
      console.error(e);
    } finally {
      setIsPlaying(false);
    }
  };

  const handlePlayWord = async (word: string) => {
    haptics.light();
    if (playingWord === word) {
      await ttsService.stopPlayback();
      setPlayingWord(null);
      return;
    }
    try {
      setPlayingWord(word);
      await ttsService.synthesizeAndPlay(word, language);
    } catch (e) {
      console.error(e);
    } finally {
      setPlayingWord(null);
    }
  };

  const handleReviewToggle = () => {
    haptics.medium();
    if (reviewed) {
      onUnmarkReviewed?.();
    } else {
      onMarkReviewed?.();
    }
  };

  const handleTabPress = (tab: TabKey) => {
    haptics.light();
    setActiveTab(tab);
  };

  const formattedReviewDate = reviewDate
    ? new Date(reviewDate).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null;

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: bgColor }]}>

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <View style={[
          styles.header,
          {
            backgroundColor: bgColor,
            borderBottomColor: border,
            paddingTop: Platform.OS === 'android'
              ? (StatusBar.currentHeight ?? 24)
              : 50,
            height: Platform.OS === 'android'
              ? 56 + (StatusBar.currentHeight ?? 24)
              : 106,
          },
        ]}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Close technique"
            accessibilityRole="button"
            style={styles.headerBack}
          >
            <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={24} color={textColor} />
          </TouchableOpacity>

          <Text style={[styles.headerTitle, { color: textColor }]} numberOfLines={1}>
            {technique.title}
          </Text>

          <View style={[styles.headerIcon, { backgroundColor: catColor + '18' }]}>
            <Ionicons name={technique.icon as any} size={16} color={catColor} />
          </View>
        </View>

        {/* ── TAB BAR ─────────────────────────────────────────────────── */}
        <View style={[styles.tabBar, { borderBottomColor: border }]}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => handleTabPress(tab.key)}
                accessibilityLabel={`${tab.label} tab`}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.tab, active && { borderBottomColor: catColor }]}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={16}
                  color={active ? catColor : subtle}
                />
                <Text style={[
                  styles.tabLabel,
                  { color: active ? catColor : subtle },
                  active && styles.tabLabelActive,
                ]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── TAB CONTENT ─────────────────────────────────────────────── */}
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          key={activeTab}
        >
          {activeTab === 'learn' && (
            <LearnTab
              technique={technique}
              catColor={catColor}
              diff={diff}
              isDark={isDark}
              textColor={textColor}
              rowDir={rowDir}
              isTier1={isTier1}
              onWatchVideo={handleOpenVideo}
            />
          )}
          {activeTab === 'practice' && (
            <PracticeTab
              technique={technique}
              catColor={catColor}
              cardBg={cardBg}
              textColor={textColor}
              isPlaying={isPlaying}
              playingWord={playingWord}
              onPlayModel={handlePlayModel}
              onPlayWord={handlePlayWord}
              isTier1={isTier1}
              onWatchVideo={handleOpenVideo}
            />
          )}
          {activeTab === 'tips' && (
            <TipsTab
              technique={technique}
              catColor={catColor}
              isDark={isDark}
              cardBg={cardBg}
              textColor={textColor}
            />
          )}
        </ScrollView>

        {/* ── BOTTOM BAR ──────────────────────────────────────────────── */}
        {/* Tier 2: model-scored practice */}
        {!isTier1 && !isTier3 && (
          <Pressable
            onPress={() => setShowPractice(true)}
            style={[styles.practiceBtn, { backgroundColor: catColor }]}
            accessibilityLabel="Start practice session"
            accessibilityRole="button"
          >
            <Ionicons name="mic-circle-outline" size={20} color="#FFF" />
            <Text style={styles.practiceBtnText}>Start Practice Session</Text>
            <Ionicons name="arrow-forward" size={16} color="#FFF" />
          </Pressable>
        )}

        {/* Tier 3: DAF WebView */}
        {isTier3 && (
          <Pressable
            onPress={() => setShowDAF(true)}
            style={[styles.practiceBtn, { backgroundColor: catColor }]}
            accessibilityLabel="Start DAF session"
            accessibilityRole="button"
          >
            <Ionicons name="headset-outline" size={20} color="#FFF" />
            <Text style={styles.practiceBtnText}>Start DAF Session</Text>
            <Ionicons name="arrow-forward" size={16} color="#FFF" />
          </Pressable>
        )}

        <View style={[styles.bottomBar, { backgroundColor: bgColor, borderTopColor: border }]}>
          {reviewed ? (
            <View style={styles.bottomReviewed}>
              <View style={styles.bottomReviewedLeft}>
                <Ionicons name="checkmark-circle" size={20} color="#2CC775" />
                <Text style={[styles.bottomReviewedText, { color: textColor }]}>
                  {isTier1 ? 'Practiced' : 'Reviewed'}
                  {formattedReviewDate ? ` \u00B7 ${formattedReviewDate}` : ''}
                </Text>
              </View>
              <Pressable
                onPress={handleReviewToggle}
                accessibilityLabel="Undo"
                accessibilityRole="button"
                style={[styles.undoBtn, { borderColor: border }]}
              >
                <Text style={[styles.undoBtnText, { color: subtle }]}>Undo</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={handleReviewToggle}
              accessibilityLabel={isTier1 ? 'Mark as practiced today' : 'Mark as reviewed'}
              accessibilityRole="button"
              style={[styles.reviewBtn, { backgroundColor: catColor }]}
            >
              <Ionicons
                name={isTier1 ? 'checkmark-done-circle-outline' : 'checkmark-circle-outline'}
                size={20}
                color="#FFF"
              />
              <Text style={styles.reviewBtnText}>
                {isTier1 ? 'Mark as Practiced Today' : 'Mark as Reviewed'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* DAF session — Tier 3 only */}
        <DAFSession
          visible={showDAF}
          technique={technique}
          accentColor={catColor}
          onClose={() => setShowDAF(false)}
        />

        {/* Practice session — Tier 2 only */}
        <TechniquePracticeSession
          visible={showPractice}
          technique={technique}
          accentColor={catColor}
          onClose={() => setShowPractice(false)}
        />

        {/* YouTube overlay — Tier 1 only */}
        <YouTubeOverlay
          visible={showVideo}
          videoId={videoId}
          techniqueTitle={technique.title}
          steps={technique.howTo}
          accentColor={catColor}
          onClose={() => setShowVideo(false)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  tabLabelActive: {
    fontWeight: '700',
  },

  // Scroll
  scroll: { paddingBottom: 100 },

  // Hero
  hero: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
    alignItems: 'flex-start',
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 16,
  },
  heroRomanized: {
    fontSize: 15,
    fontWeight: '400',
    opacity: 0.5,
    marginTop: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  subtypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    alignItems: 'flex-start',
  },

  // Sections
  section: {
    marginTop: 28,
    paddingHorizontal: 0,
  },
  lastSection: {
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 24,
    marginBottom: 16,
  },

  // Description card (Learn tab)
  descCard: {
    marginHorizontal: 24,
    borderRadius: 12,
    padding: 16,
  },
  descText: {
    fontSize: 15,
    lineHeight: 22,
    opacity: 0.85,
  },

  // Start Practice button (Tier 2)
  practiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 0,
    paddingVertical: 15,
    borderRadius: 16,
  },
  practiceBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },

  // Video card (Tier 1)
  videoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 24,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  videoCardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  videoCardText: {
    flex: 1,
    gap: 3,
  },
  videoCardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  videoCardSub: {
    fontSize: 12,
    color: '#8D9FAE',
    lineHeight: 17,
  },

  // Tier 1 info note (Practice tab)
  tier1Note: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 24,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  tier1NoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.8,
  },

  // How To steps
  stepRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
    paddingTop: 4,
  },

  // Listen & Model
  listenCard: {
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  exampleBlock: {
    gap: 6,
  },
  exampleLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
    marginLeft: 2,
  },
  exampleAccentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  exampleIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  exampleIncorrect: {
    flex: 1,
    fontSize: 15,
    textDecorationLine: 'line-through',
    opacity: 0.55,
  },
  exampleCorrect: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  playBtnFull: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 2,
  },
  playBtnFullText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  playBtnWave: {
    marginLeft: 4,
  },

  // Practice words
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 24,
  },
  wordChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  wordChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  sentenceCard: {
    marginHorizontal: 24,
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  sentenceText: {
    fontSize: 14,
    lineHeight: 20,
  },

  // Tips
  tipCard: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 24,
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
    alignItems: 'flex-start',
  },
  tipIcon: {
    marginTop: 1,
    flexShrink: 0,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
  },

  // Context badges (Tips tab)
  contextTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 24,
  },
  contextBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  contextBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Category context card (Tips tab)
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 24,
    padding: 14,
    borderRadius: 12,
  },
  categoryTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  categoryDesc: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
  },
  reviewBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  bottomReviewed: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomReviewedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomReviewedText: {
    fontSize: 14,
    fontWeight: '600',
  },
  undoBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  undoBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
