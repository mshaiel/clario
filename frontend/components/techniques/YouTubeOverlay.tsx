/**
 * YouTubeOverlay.tsx
 *
 * Full-screen modal overlay for embedded YouTube video demonstrations.
 * Used for Tier 1 (passive/educational) techniques.
 *
 * When videoId is null (user hasn't linked a video yet), renders a
 * polished "Video Coming Soon" placeholder — never an error.
 *
 * Package required: react-native-youtube-iframe
 *   Install: npx expo install react-native-youtube-iframe
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import YoutubePlayer from 'react-native-youtube-iframe';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  /** YouTube video ID, e.g. 'dQw4w9WgXcQ'. Pass null if not yet configured. */
  videoId: string | null;
  techniqueTitle: string;
  steps: string[];
  accentColor?: string;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function YouTubeOverlay({
  visible,
  videoId,
  techniqueTitle,
  steps,
  accentColor = '#1FB7BC',
  onClose,
}: Props) {
  const [playerReady, setPlayerReady] = useState(false);

  const handleClose = () => {
    setPlayerReady(false);
    onClose();
  };

  const statusBarHeight =
    Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: statusBarHeight + (Platform.OS === 'ios' ? 54 : 16) }]}>
          <Pressable
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.closeBtn}
            accessibilityLabel="Close video"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>

          <View style={styles.headerCenter}>
            <Text style={styles.headerLabel}>VIDEO DEMONSTRATION</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {techniqueTitle}
            </Text>
          </View>

          {/* Balance the close button */}
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* ── VIDEO AREA ───────────────────────────────────────────────── */}
          <View style={styles.videoWrapper}>
            {videoId ? (
              <>
                {/* Loader shown until player signals ready */}
                {!playerReady && (
                  <View style={styles.loaderOverlay}>
                    <ActivityIndicator size="large" color={accentColor} />
                    <Text style={styles.loaderText}>Loading video…</Text>
                  </View>
                )}

                <YoutubePlayer
                  height={220}
                  width={SCREEN_WIDTH}
                  videoId={videoId}
                  onReady={() => setPlayerReady(true)}
                  forceAndroidAutoplay={false}
                  webViewStyle={{ opacity: playerReady ? 1 : 0 }}
                  webViewProps={{
                    // ── iOS critical: without this the player is blocked inline ──
                    allowsInlineMediaPlayback: true,
                    mediaPlaybackRequiresUserAction: false,
                    // Prevents blank white flash on iOS
                    allowsFullscreenVideo: true,
                  }}
                  initialPlayerParams={{
                    controls: true,
                    modestbranding: true,
                    rel: false,
                    fs: true,
                    // Required on iOS to prevent autoplay block
                    preventFullScreen: false,
                  }}
                />
              </>
            ) : (
              /* ── PLACEHOLDER (no video linked yet) ────────────────────── */
              <Animated.View
                entering={FadeIn.duration(400)}
                style={styles.placeholder}
              >
                <View style={[styles.placeholderIconRing, { borderColor: accentColor + '44' }]}>
                  <View style={[styles.placeholderIconBg, { backgroundColor: accentColor + '1A' }]}>
                    <Ionicons name="logo-youtube" size={44} color={accentColor} />
                  </View>
                </View>

                <Text style={styles.placeholderTitle}>Video Coming Soon</Text>
                <Text style={styles.placeholderSub}>
                  A clinical demonstration video for this technique will be available here.
                  Until then, follow the written steps below.
                </Text>

                {/* Decorative play button */}
                <View style={[styles.comingSoonBadge, { backgroundColor: accentColor + '22', borderColor: accentColor + '44' }]}>
                  <Ionicons name="time-outline" size={14} color={accentColor} />
                  <Text style={[styles.comingSoonText, { color: accentColor }]}>
                    Link will be added soon
                  </Text>
                </View>
              </Animated.View>
            )}
          </View>


          {/* ── INFO CARD ────────────────────────────────────────────────── */}
          <Animated.View
            entering={FadeInUp.duration(400).delay(100)}
            style={[styles.infoCard, { backgroundColor: '#1A1F2A', borderColor: accentColor + '33' }]}
          >
            <Ionicons name="information-circle-outline" size={18} color={accentColor} />
            <Text style={styles.infoText}>
              Watch the full demonstration before practicing. You can pause anytime
              to review individual steps.
            </Text>
          </Animated.View>

          {/* ── QUICK STEPS REFERENCE ────────────────────────────────────── */}
          {steps.length > 0 && (
            <Animated.View
              entering={FadeInUp.duration(400).delay(200)}
              style={styles.stepsSection}
            >
              <Text style={styles.stepsTitle}>Quick Reference</Text>
              {steps.map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={[styles.stepNum, { backgroundColor: accentColor }]}>
                    <Text style={styles.stepNumText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </Animated.View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0D13',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FFFFFF18',
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF12',
    borderRadius: 18,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#FFFFFF55',
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  // Video wrapper — enforces 16:9 aspect ratio
  videoWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#000000',
    zIndex: 10,
  },
  loaderText: {
    color: '#888888',
    fontSize: 13,
  },

  // Placeholder (no video linked)
  placeholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 32,
    backgroundColor: '#0D1117',
  },
  placeholderIconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIconBg: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  placeholderSub: {
    fontSize: 13,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 19,
  },
  comingSoonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  comingSoonText: {
    fontSize: 12,
    fontWeight: '600',
  },


  // Info card
  infoCard: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#AAAAAA',
    lineHeight: 19,
  },

  // Steps reference
  stepsSection: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  stepsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: '#CCCCCC',
    lineHeight: 20,
    paddingTop: 3,
  },
});
