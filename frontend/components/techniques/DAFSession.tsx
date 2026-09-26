/**
 * DAFSession.tsx
 *
 * Tier 3 — DAF (Delayed Auditory Feedback) practice session.
 * Loads the hosted daf.html via WebView (on-device, no backend round-trip).
 * When the user stops the session, a self-report fluency rating overlay appears.
 * Rating (1–5) is logged to CTkM as score = rating × 20.
 *
 * Package required: react-native-webview
 *   Install: npx expo install react-native-webview
 *
 * ─── SETUP ──────────────────────────────────────────────────────────────────
 * 1. Push clario-daf/daf.html to GitHub Pages (or any stable HTTPS host).
 * 2. Replace DAF_URL below with the real URL.
 * 3. The HTML file already posts 'session_ended' via window.Flutter.postMessage().
 *    This WebView catches it via onMessage to trigger the self-report overlay.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { auth } from '@/firebase';
import { useLanguage } from '@/context/LanguageContext';
import { TechniqueAPI } from '@/lib/techniqueApi';
import { TechniqueGuide } from '@/lib/techniqueData';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable,
  StatusBar, StyleSheet, Text, View,
} from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * URL of the hosted daf.html on GitHub Pages.
 * Replace with your real GitHub Pages URL once deployed.
 */
export const DAF_URL =
  process.env.EXPO_PUBLIC_DAF_URL || 'https://mshaiel.github.io/clario-daf/daf.html';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  technique: TechniqueGuide;
  accentColor: string;
  onClose: () => void;
}

const RATINGS = [
  { value: 1, label: 'Much worse', emoji: '😞' },
  { value: 2, label: 'Slightly worse', emoji: '😕' },
  { value: 3, label: 'No change', emoji: '😐' },
  { value: 4, label: 'Slightly better', emoji: '🙂' },
  { value: 5, label: 'Much better!', emoji: '😄' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function DAFSession({ visible, technique, accentColor, onClose }: Props) {
  const { language } = useLanguage();
  const [webViewReady, setWebViewReady] = useState(false);
  const [showSelfReport, setShowSelfReport] = useState(false);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const sessionStartRef = useRef(Date.now());
  const uid = auth.currentUser?.uid ?? 'anon';

  const statusBarHeight = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

  const handleClose = () => {
    setWebViewReady(false);
    setShowSelfReport(false);
    setSelectedRating(null);
    setSubmitting(false);
    setSubmitted(false);
    onClose();
  };

  // Catch messages from the daf.html (window.Flutter.postMessage)
  const handleMessage = (event: WebViewMessageEvent) => {
    if (event.nativeEvent.data === 'session_ended') {
      setShowSelfReport(true);
    }
  };

  const handleSubmitRating = async () => {
    if (!selectedRating) return;
    setSubmitting(true);
    const score = selectedRating * 20; // 1→20, 2→40, 3→60, 4→80, 5→100
    const duration = Math.round((Date.now() - sessionStartRef.current) / 1000);
    await TechniqueAPI.logProgress(uid, technique.backendReady.techniqueId, score, duration, {
      rating: selectedRating,
      type: 'daf_self_report',
    });
    setSubmitting(false);
    setSubmitted(true);
  };

  // JS injected into the WebView to bridge postMessage → React Native's onMessage
  const INJECTED_JS = `
    (function() {
      window.Flutter = {
        postMessage: function(msg) {
          window.ReactNativeWebView.postMessage(msg);
        }
      };
    })();
    true;
  `;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={[styles.root, { paddingTop: statusBarHeight }]}>

        {/* ── HEADER ────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? 52 : 16 }]}>
          <Pressable
            onPress={handleClose}
            style={styles.closeBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Close DAF session"
          >
            <Ionicons name="chevron-down" size={22} color="#FFFFFF99" />
          </Pressable>

          <View style={styles.headerCenter}>
            <View style={[styles.modeBadge, { backgroundColor: accentColor + '22', borderColor: accentColor + '55' }]}>
              <Ionicons name="headset-outline" size={11} color={accentColor} />
              <Text style={[styles.modeBadgeText, { color: accentColor }]}>DAF SESSION</Text>
            </View>
            <Text style={styles.headerName} numberOfLines={1}>{technique.title}</Text>
          </View>

          <View style={{ width: 36 }} />
        </View>

        {/* Accent underline */}
        <View style={[styles.accentLine, { backgroundColor: accentColor }]} />

        {/* ── HEADPHONE WARNING ─────────────────────────────────────── */}
        <View style={[styles.warnBanner, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B44' }]}>
          <Ionicons name="warning-outline" size={15} color="#F59E0B" />
          <Text style={styles.warnText}>
            Use <Text style={styles.warnBold}>wired headphones only</Text> — Bluetooth adds unpredictable delay that breaks DAF.
          </Text>
        </View>

        {/* ── WEBVIEW ───────────────────────────────────────────────── */}
        <View style={styles.webViewContainer}>
          {!webViewReady && (
            <View style={styles.webViewLoader}>
              <ActivityIndicator size="large" color={accentColor} />
              <Text style={[styles.loaderText, { color: accentColor + 'AA' }]}>Loading DAF interface…</Text>
            </View>
          )}
          <WebView
            source={{ uri: DAF_URL }}
            style={[styles.webView, { opacity: webViewReady ? 1 : 0 }]}
            injectedJavaScript={INJECTED_JS}
            onMessage={handleMessage}
            onLoad={() => setWebViewReady(true)}
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={['*']}
          />
        </View>

        {/* ── SELF-REPORT OVERLAY ───────────────────────────────────── */}
        {showSelfReport && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.overlay}>
            <Animated.View
              entering={FadeInUp.duration(400)}
              style={[styles.reportCard, { borderColor: accentColor + '40' }]}
            >
              {submitted ? (
                /* ── Thank-you state ── */
                <View style={styles.thankyouWrap}>
                  <Text style={styles.thankyouEmoji}>🎉</Text>
                  <Text style={styles.thankyouTitle}>Session Logged!</Text>
                  <Text style={styles.thankyouSub}>Your DAF practice has been recorded.</Text>
                  <Pressable
                    onPress={handleClose}
                    style={[styles.doneBtn, { backgroundColor: accentColor }]}
                  >
                    <Text style={styles.doneBtnText}>Done</Text>
                  </Pressable>
                </View>
              ) : (
                /* ── Rating state ── */
                <>
                  <View style={[styles.reportIconWrap, { backgroundColor: accentColor + '20' }]}>
                    <Ionicons name="mic-outline" size={28} color={accentColor} />
                  </View>
                  <Text style={styles.reportTitle}>How did your fluency feel?</Text>
                  <Text style={styles.reportSub}>
                    Rate your speech fluency during the DAF session compared to without it.
                  </Text>

                  <View style={styles.ratingRow}>
                    {RATINGS.map(r => (
                      <Pressable
                        key={r.value}
                        onPress={() => setSelectedRating(r.value)}
                        style={[
                          styles.ratingBtn,
                          selectedRating === r.value && {
                            backgroundColor: accentColor + '22',
                            borderColor: accentColor,
                          },
                        ]}
                      >
                        <Text style={styles.ratingEmoji}>{r.emoji}</Text>
                        <Text style={[
                          styles.ratingLabel,
                          selectedRating === r.value && { color: accentColor },
                        ]}>
                          {r.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Pressable
                    onPress={handleSubmitRating}
                    disabled={!selectedRating || submitting}
                    style={[
                      styles.submitBtn,
                      { backgroundColor: selectedRating ? accentColor : accentColor + '33' },
                    ]}
                  >
                    {submitting
                      ? <ActivityIndicator color="#FFF" size="small" />
                      : <Text style={styles.submitBtnText}>Log Session</Text>}
                  </Pressable>

                  <Pressable onPress={handleClose} style={styles.skipBtn}>
                    <Text style={styles.skipText}>Skip</Text>
                  </Pressable>
                </>
              )}
            </Animated.View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070B12' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 12, gap: 10,
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 4 },
  modeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  modeBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  headerName: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },
  accentLine: { height: 2, marginHorizontal: 20, borderRadius: 1, opacity: 0.7, marginBottom: 0 },

  // Warning
  warnBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: 16, marginVertical: 10, padding: 12,
    borderRadius: 10, borderWidth: 1,
  },
  warnText: { flex: 1, fontSize: 12, color: '#FFFFFF99', lineHeight: 17 },
  warnBold: { color: '#F59E0B', fontWeight: '700' },

  // WebView
  webViewContainer: { flex: 1 },
  webViewLoader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 10,
  },
  loaderText: { fontSize: 14, fontWeight: '500' },
  webView: { flex: 1 },

  // Self-report overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000CC',
    alignItems: 'center', justifyContent: 'flex-end',
    zIndex: 100,
  },
  reportCard: {
    width: '100%', backgroundColor: '#0F1520',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, borderBottomWidth: 0,
    padding: 28, paddingBottom: 48,
    alignItems: 'center', gap: 14,
  },
  reportIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  reportTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4 },
  reportSub: { fontSize: 13, color: '#FFFFFF66', textAlign: 'center', lineHeight: 19 },

  // Rating buttons
  ratingRow: { width: '100%', gap: 8 },
  ratingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 14, borderWidth: 1.5, borderColor: '#FFFFFF18',
  },
  ratingEmoji: { fontSize: 22 },
  ratingLabel: { fontSize: 14, fontWeight: '600', color: '#FFFFFF88' },

  // Submit
  submitBtn: {
    width: '100%', paddingVertical: 15,
    borderRadius: 16, alignItems: 'center', marginTop: 4,
  },
  submitBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  skipBtn: { paddingVertical: 8 },
  skipText: { color: '#FFFFFF44', fontSize: 13, fontWeight: '500' },

  // Thank-you
  thankyouWrap: { alignItems: 'center', gap: 10, paddingVertical: 12 },
  thankyouEmoji: { fontSize: 48 },
  thankyouTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  thankyouSub: { fontSize: 14, color: '#FFFFFF66', textAlign: 'center' },
  doneBtn: { paddingHorizontal: 48, paddingVertical: 14, borderRadius: 28, marginTop: 8 },
  doneBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
