import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/theme-provider';
import { useLanguage } from '@/context/LanguageContext';
import { AI_ACCENT } from '../detection/AICoPilotToggle';
import { useAICoPilot } from '@/context/AICoPilotContext'; // ✅ Added Context Import
import { haptics } from '@/lib/haptics';

// Decorative waveform — baked into the card surface as a texture
const CARD_WAVE = [0.3, 0.5, 0.7, 0.55, 0.9, 1, 0.85, 0.65, 0.45, 0.7, 0.5, 0.35, 0.6, 0.8, 0.5, 0.4];

interface Props {
  testTitle: string;
  testDescription: string;
  duration?: string;
  onStart: (aiEnabled: boolean) => void;
}

export function FocusCard({
  testTitle,
  testDescription,
  duration = '5–10 min',
  onStart,
}: Props) {
  const { resolvedTheme } = useAppTheme();
  const { language } = useLanguage();
  
  // ✅ REPLACED: Using global AI Co-Pilot state instead of local useState
  const { aiEnabled, setAiEnabled } = useAICoPilot();

  const PRIMARY = resolvedTheme.colors.primary;
  const langLabel = language === 'urdu' ? 'Urdu' : 'English';

  return (
    <View style={[styles.wrapper, { backgroundColor: PRIMARY }]}>

      {/* ── LABEL ROW ────────────────────────────────── */}
      <View style={styles.labelRow}>
        <Text style={[styles.sectionLabel, { color: '#FFFFFF', opacity: 0.6 }]}>
          TODAY'S FOCUS
        </Text>
      </View>

      {/* ── CARD SURFACE ───────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: resolvedTheme.dark ? '#161B24' : '#FFFFFF', borderColor: resolvedTheme.dark ? '#252D3A' : '#EAECEF' }]}>
        
        {/* Abstract Waveform Background */}
        <View style={styles.waveOverlay} pointerEvents="none">
          {CARD_WAVE.map((h, i) => (
            <View
              key={i}
              style={[styles.waveBar, { height: `${h * 100}%`, backgroundColor: PRIMARY, opacity: 0.04 }]}
            />
          ))}
        </View>

        <View style={styles.cardInner}>
          {/* Top row */}
          <View style={styles.topRow}>
            <View style={[styles.langBadge, { backgroundColor: PRIMARY + '20' }]}>
              <Text style={[styles.langText, { color: PRIMARY }]}>{langLabel.toUpperCase()}</Text>
            </View>
            <View style={styles.durationPill}>
              <Ionicons name="time-outline" size={14} color={resolvedTheme.colors.text} style={{ opacity: 0.5 }} />
              <Text style={[styles.durationText, { color: resolvedTheme.colors.text, opacity: 0.5 }]}>
                {duration}
              </Text>
            </View>
          </View>

          {/* Title / Desc */}
          <Text style={[styles.testTitle, { color: resolvedTheme.colors.text }]}>
            {testTitle}
          </Text>
          <Text style={[styles.testDesc, { color: resolvedTheme.colors.text, opacity: 0.6 }]}>
            {testDescription}
          </Text>

          {/* AI Co-Pilot Toggle */}
          <View style={[styles.aiToggleRow, { backgroundColor: resolvedTheme.dark ? '#1A1F2B' : '#F8FAFB', borderColor: resolvedTheme.dark ? '#252D3A' : '#EAECEF' }]}>
            <View style={styles.aiToggleTextWrap}>
              <View style={styles.aiIconTitle}>
                <Ionicons name="sparkles" size={14} color={AI_ACCENT} />
                <Text style={[styles.aiTitle, { color: resolvedTheme.colors.text }]}>AI Co-Pilot</Text>
              </View>
              <Text style={[styles.aiDesc, { color: resolvedTheme.colors.text, opacity: 0.5 }]}>
                Real-time pronunciation feedback
              </Text>
            </View>
            <Switch
              value={aiEnabled}
              onValueChange={setAiEnabled}
              trackColor={{ false: resolvedTheme.dark ? '#2A3344' : '#EAECEF', true: AI_ACCENT }}
              thumbColor="#FFFFFF"
              ios_backgroundColor={resolvedTheme.dark ? '#2A3344' : '#EAECEF'}
            />
          </View>

          {/* Action */}
          <TouchableOpacity
            style={[styles.startBtn, { backgroundColor: PRIMARY }]}
            activeOpacity={0.8}
            onPress={() => { haptics.medium(); onStart(aiEnabled); }}
          >
            <Text style={styles.startBtnText}>Start Session</Text>
            <Ionicons name="arrow-forward" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  
  // Card base
  card: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 10,
  },
  waveOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 80,
    gap: 3,
    paddingHorizontal: 0,
  },
  waveBar: {
    flex: 1,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  cardInner: {
    padding: 24,
    paddingBottom: 24,
  },

  // Top row
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  langBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  langText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  durationText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Title / Desc
  testTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  testDesc: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 20,
  },

  // AI Toggle Area
  aiToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
  },
  aiToggleTextWrap: {
    flex: 1,
  },
  aiIconTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  aiTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  aiDesc: {
    fontSize: 12,
  },

  // Button
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 54,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  startBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
