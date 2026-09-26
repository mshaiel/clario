import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type SessionState = 'idle' | 'playing_audio' | 'awaiting_tap' | 'recording' | 'processing' | 'result' | 'success' | 'failure';

interface MicButtonProps {
  sessionState: SessionState;
  color: string;
  subtle: string;
  disabled?: boolean;
  error?: string | null;       // ← surface the recorder's error here
  onPressIn: () => void;
  onPressOut: () => void;
}

// ─── geometry ────────────────────────────────────────────────────────────────
// All sizing in one place so ring/button/outer stay mathematically consistent.
const BTN = 68;           // button diameter
const RING = 96;           // ring diameter (BTN + 28)
const OUTER = RING + 4;     // outer container width/height — enough to contain the ring at max scale (1.18 × 96 ≈ 113 < 120)
const RING_OFFSET = (OUTER - RING) / 2;   // absolute inset so the ring is centred inside outer
// ─────────────────────────────────────────────────────────────────────────────

export function MicButton({
  sessionState,
  color,
  subtle,
  disabled,
  error,
  onPressIn,
  onPressOut,
}: MicButtonProps) {
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;

  // Error toast fade
  const errorOpacity = useRef(new Animated.Value(0)).current;
  const errorOffset = useRef(new Animated.Value(6)).current;

  // ── ring pulse ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (sessionState === 'recording') {
      ringOpacity.setValue(0.45);
      const anim = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ringScale, { toValue: 1.18, duration: 700, useNativeDriver: true }),
            Animated.timing(ringOpacity, { toValue: 0.12, duration: 700, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ringScale, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(ringOpacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
          ]),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      ringScale.setValue(1);
      ringOpacity.setValue(0);
    }
  }, [sessionState, ringScale, ringOpacity]);

  // ── error toast ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (error) {
      // Slide up + fade in
      errorOffset.setValue(8);
      errorOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(errorOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(errorOffset, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      // Fade out
      Animated.timing(errorOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
  }, [error, errorOpacity, errorOffset]);

  // ── colours ─────────────────────────────────────────────────────────────────
  const btnColor =
    sessionState === 'processing' || disabled ? color + '40' :
      sessionState === 'recording' ? '#EF4444' :
        sessionState === 'success' ? '#10B981' :
          sessionState === 'failure' ? '#EF4444' :
            color;

  const ringColor = sessionState === 'recording' ? '#EF4444' : color;

  // ── icon ────────────────────────────────────────────────────────────────────
  const iconName =
    sessionState === 'processing' ? 'sync-outline' :
      sessionState === 'recording' ? 'square' :
        sessionState === 'success' ? 'checkmark' :
          sessionState === 'failure' ? 'close' :
            'mic';

  // ── hint text ───────────────────────────────────────────────────────────────
  const hintText =
    sessionState === 'idle' ? 'Hold to record' :
      sessionState === 'recording' ? 'Release to stop' :
        sessionState === 'processing' ? 'Analyzing…' :
          sessionState === 'success' ? 'Great sound!' :
            sessionState === 'failure' ? 'Try again' :
              '';

  return (
    // ── OUTER wrapper: fixed dimensions so nothing around it shifts ─────────
    <View style={styles.wrapper}>

      {/* ── ring + button live inside a fixed-size box ─────────────────────── */}
      <View style={styles.buttonBox}>
        {/* Animated ring — absolutely placed inside buttonBox */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              borderColor: ringColor + '70',
              transform: [{ scale: ringScale }],
              opacity: ringOpacity,
              top: RING_OFFSET,
              left: RING_OFFSET,
            },
          ]}
        />

        {/* Button — centred inside buttonBox */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.button, { backgroundColor: btnColor }]}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          disabled={sessionState === 'processing' || disabled}
        >
          <Ionicons name={iconName} size={28} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* ── hint label: fixed height so it never reflowing the card ─────────── */}
      <Text style={[styles.hint, { color: subtle }]} numberOfLines={1}>
        {hintText}
      </Text>

      {/* ── error toast: floats above, doesn't push layout ──────────────────── */}
      {error ? (
        <Animated.View
          style={[
            styles.errorToast,
            {
              opacity: errorOpacity,
              transform: [{ translateY: errorOffset }],
            },
          ]}
          pointerEvents="none"
        >
          <Ionicons name="alert-circle" size={13} color="#FFF" style={styles.errorIcon} />
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── outer wrapper ────────────────────────────────────────────────────────────
  // Fixed width keeps the card column stable. Height = buttonBox + hint + gap.
  wrapper: {
    alignItems: 'center',
    width: OUTER,
    // We do NOT set a fixed height here — we let the three children stack
    // naturally, but since each child has a fixed size, the total is stable.
  },

  // ── button box ──────────────────────────────────────────────────────────────
  // Sized exactly to contain the ring even at its largest scale (1.18 × 96 ≈ 113).
  // The ring is absolute inside this box, so it NEVER affects document flow.
  buttonBox: {
    width: OUTER,
    height: OUTER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
  },

  button: {
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow so the button lifts off the card surface
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },

  // ── hint ─────────────────────────────────────────────────────────────────────
  // Fixed lineHeight = fixed height. marginTop replaces the gap prop
  // (gap isn't reliable on older RN versions).
  hint: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    marginTop: 8,
    textAlign: 'center',
  },

  // ── error toast ──────────────────────────────────────────────────────────────
  // Absolutely positioned so it overlays, never pushing card content.
  errorToast: {
    position: 'absolute',
    bottom: '100%',        // floats above the wrapper
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',     // near-black, works on light & dark cards
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    maxWidth: 220,
    // shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 6,
  },

  errorIcon: {
    marginRight: 5,
    color: '#FF6B6B',
  },

  errorText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
});