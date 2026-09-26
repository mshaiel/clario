/**
 * Practice Tab
 * Location: app/(tabs)/practice.tsx
 *
 * Phase 3 rewrite — wired to CUA backend:
 *
 * Panel A (no modules): Generate Training Plan button → POST /v1/training/generate
 * Panel B (modules exist): Downloadable module cards using DownloadContext (same OTA
 *   ZIP flow as assessments). Tapping a cached module shows a ModeSelectSheet
 *   (same as assessment modules) to choose AI Assisted or Efficient before navigating.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { GeneratePlanModal, type PlanParams } from '@/components/practice/GeneratePlanModal';
import { TrainingModuleCard } from '@/components/practice/TrainingModuleCard';
import { BrandWaveform } from '@/components/ui/BrandWaveform';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { useAICoPilot } from '@/context/AICoPilotContext';
import { DownloadContext } from '@/context/DownloadContext';
import { useLanguage } from '@/context/LanguageContext';
import { auth } from '@/firebase';
import { UAB_API } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { clearTrainingProgress } from '@/lib/progressService';
import type { TrainingModuleManifest } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';


// ─── Empty / Generate panel ───────────────────────────────────────────────────
function GeneratePanel({
  isGenerating,
  lastMessage,
  onGenerate,
  PRIMARY,
  text,
  subtle,
  surface,
  border,
  isDark,
}: {
  isGenerating: boolean;
  lastMessage: string | null;
  onGenerate: () => void;
  PRIMARY: string;
  text: string;
  subtle: string;
  surface: string;
  border: string;
  isDark: boolean;
}) {
  return (
    <View style={[
      styles.generateCard,
      { backgroundColor: surface, borderColor: border },
      !isDark && styles.cardLightShadow
    ]}>
      <View style={[styles.generateIconArea, { backgroundColor: PRIMARY + '0A' }]}>
        <View style={[styles.generateIconInner, { backgroundColor: PRIMARY + '18' }]}>
          <Ionicons name="fitness-outline" size={34} color={PRIMARY} />
        </View>
      </View>
      <Text style={[styles.generateTitle, { color: text }]}>No Training Plan Yet</Text>
      <Text style={[styles.generateBody, { color: subtle }]}>
        Complete at least one assessment session, then generate your personalised
        training exercises here. The plan adapts to your speech profile.
      </Text>

      {lastMessage && (
        <View style={[styles.messageChip, { backgroundColor: PRIMARY + '0E', borderColor: PRIMARY + '20' }]}>
          <Ionicons name="information-circle-outline" size={14} color={PRIMARY} />
          <Text style={[styles.messageChipText, { color: PRIMARY }]} numberOfLines={2}>
            {lastMessage}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[
          styles.generateBtn,
          { backgroundColor: isGenerating ? PRIMARY + '66' : PRIMARY },
        ]}
        onPress={onGenerate}
        disabled={isGenerating}
        activeOpacity={0.85}
      >
        {isGenerating ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <Ionicons name="sparkles" size={18} color="#FFF" />
        )}
        <Text style={styles.generateBtnText}>
          {isGenerating ? 'Generating plan…' : 'Generate Training Plan'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function PracticeScreen() {
  const { resolvedTheme } = useAppTheme();
  const router = useRouter();
  const { language } = useLanguage();
  const { setAiEnabled } = useAICoPilot();
  const user = auth.currentUser;
  const downloadContext = useContext(DownloadContext);

  const isDark   = resolvedTheme.dark;
  const PRIMARY  = resolvedTheme.colors.primary;
  const bg       = isDark ? '#0C0F14' : '#F2F5F9';
  const text     = resolvedTheme.colors.text;
  const subtle   = isDark ? '#7A8FA3' : '#59677A';
  const surface  = isDark ? '#161B24' : '#FFFFFF';
  const border   = isDark ? '#252D3A' : '#D1D8E2';

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(14)).current;

  const [modules, setModules]           = useState<TrainingModuleManifest[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateMsg, setGenerateMsg]   = useState<string | null>(null);
  const [showModal, setShowModal]       = useState(false);
  const [autoSeverity, setAutoSeverity] = useState(0);

  // Removed Mode sheet state

  // ── Entrance animation ─────────────────────────────────────────────────────
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 14, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // ── Fetch training modules ─────────────────────────────────────────────────
  const loadModules = useCallback(async () => {
    if (!user?.uid) { setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const result = await UAB_API.fetchTrainingModules(user.uid, language);
      setModules(result);
    } catch (e) {
      console.warn('[Practice] fetchTrainingModules failed:', e);
      setModules([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid, language]);

  // Reload whenever the tab comes into focus
  useFocusEffect(useCallback(() => { loadModules(); }, [loadModules]));

  // ── Generate plan ──────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!user?.uid || isGenerating) return;
    haptics.medium();

    // Pre-fetch the gamification severity so the modal can display it
    try {
      const { getGamificationSnapshot } = require('@/lib/gamificationService');
      const { stats } = await getGamificationSnapshot(user.uid, language);
      setAutoSeverity(1.0 - (stats.overallAccuracy / 100.0));
    } catch {
      setAutoSeverity(0.5);
    }

    setShowModal(true);
  }, [user?.uid, isGenerating, language]);

  const proceedGenerate = useCallback(async (params: PlanParams) => {
    if (!user?.uid) return;
    setShowModal(false);
    setIsGenerating(true);
    setGenerateMsg(null);

    try {
      const severity = Math.min(1, Math.max(0, autoSeverity * params.severityMultiplier));
      const userStats = {
        severity,
        fatigue: params.fatigue,
        age:     params.age,
        delta:   params.delta,
      };

      // Clear local storage for old training modules before generating new ones
      if (downloadContext?.clearTrainingModules) {
        await downloadContext.clearTrainingModules();
      }

      // Clear all progress on training modules from firestore and cache
      await clearTrainingProgress();

      const result = await UAB_API.generateTrainingPlan(user.uid, language, userStats);
      setGenerateMsg(result.message);
      if (result.success && result.module_count > 0) {
        await loadModules();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generation failed. Try again.';
      setGenerateMsg(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [user?.uid, language, loadModules, autoSeverity, downloadContext]);

  // ── Tap a module → navigate directly to practice session ───────────────────
  const handleModuleStart = useCallback((moduleId: string) => {
    const mod = modules.find((m) => m.id === moduleId);
    if (!mod) return;

    router.push({
      pathname: '/practice/session' as any,
      params: {
        moduleId:   mod.id,
        errorName:  mod.error_name,
        majorType:  mod.major_type,
        language:   mod.language,
        severity:   mod.severity.toString(),
        levelCount: mod.level_count.toString(),
      },
    });
  }, [modules, router]);


  const hasModules = modules.length > 0;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* ── Soft glowing top background overlay ── */}
      <GradientGlow color={PRIMARY} isDark={isDark} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* ── Page header ── */}
          <View style={styles.pageHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pageTitle, { color: text }]}>
                Your <Text style={{ color: PRIMARY }}>Training</Text>
              </Text>
              <Text style={[styles.pageSubtitle, { color: subtle }]}>
                Personalised exercises, adapted for you.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity
                style={[styles.refreshBtn, { backgroundColor: PRIMARY + '12' }]}
                onPress={() => { haptics.light(); loadModules(); }}
                disabled={isLoading}
              >
                {isLoading
                  ? <ActivityIndicator size="small" color={PRIMARY} />
                  : <Ionicons name="refresh" size={18} color={PRIMARY} />}
              </TouchableOpacity>
              <BrandWaveform size="sm" />
            </View>
          </View>

          {/* ── Hero status card ── */}
          <View style={[styles.heroCard, { backgroundColor: surface, borderColor: border }]}>
            <View style={[styles.heroIcon, { backgroundColor: PRIMARY + '14' }]}>
              <Ionicons name="sparkles" size={18} color={PRIMARY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.heroTitle, { color: text }]}>
                {hasModules ? "Today's Training" : 'No Plan Yet'}
              </Text>
              <Text style={[styles.heroBody, { color: subtle }]}>
                {hasModules
                  ? `${modules.length} module${modules.length !== 1 ? 's' : ''} ready — tap a module to begin`
                  : 'Generate a plan after completing your first assessment.'}
              </Text>
            </View>
            <View style={[styles.countChip, { backgroundColor: PRIMARY + '16' }]}>
              <Text style={[styles.countChipText, { color: PRIMARY }]}>
                {hasModules ? `${modules.length} Ready` : 'No Plan'}
              </Text>
            </View>
          </View>

          {/* ── Section label ── */}
          <Text style={[styles.sectionLabel, { color: subtle }]}>
            {hasModules ? 'YOUR TRAINING MODULES' : 'GET STARTED'}
          </Text>

          {/* ── Loading state ── */}
          {isLoading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={PRIMARY} />
              <Text style={[styles.loadingText, { color: subtle }]}>
                Loading your training modules…
              </Text>
            </View>
          )}

          {/* ── Generate panel (no modules) ── */}
          {!isLoading && !hasModules && (
            <GeneratePanel
              isGenerating={isGenerating}
              lastMessage={generateMsg}
              onGenerate={handleGenerate}
              PRIMARY={PRIMARY}
              text={text}
              subtle={subtle}
              surface={surface}
              border={border}
              isDark={isDark}
            />
          )}

          {/* ── Module list ── */}
          {!isLoading && hasModules && (
            <>
              {modules.map((mod) => (
                <TrainingModuleCard
                  key={mod.id}
                  module={mod}
                  onStart={handleModuleStart}
                />
              ))}

              {/* Regenerate option at bottom */}
              <TouchableOpacity
                style={[styles.regenerateBtn, { backgroundColor: surface, borderColor: border }]}
                onPress={handleGenerate}
                disabled={isGenerating}
                activeOpacity={0.8}
              >
                {isGenerating
                  ? <ActivityIndicator size="small" color={text} />
                  : <Ionicons name="refresh-outline" size={16} color={text} />}
                <Text style={[styles.regenerateBtnText, { color: text }]}>
                  {isGenerating ? 'Regenerating plan…' : 'Regenerate training plan'}
                </Text>
              </TouchableOpacity>

              {generateMsg && (
                <Text style={[styles.generateMsgText, { color: subtle }]}>
                  {generateMsg}
                </Text>
              )}
            </>
          )}
        </Animated.View>
      </ScrollView>

      {/* ── Generate plan modal ── */}
      <GeneratePlanModal
        visible={showModal}
        autoSeverity={autoSeverity}
        onConfirm={proceedGenerate}
        onClose={() => setShowModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 42,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  pageSubtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Hero card ────────────────────────────────────────────────────────────────
  heroCard: {
    borderWidth: 1,
    borderRadius: 28,
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  heroBody:  { fontSize: 13, marginTop: 4, lineHeight: 18 },
  countChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  countChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  // ── Section label ─────────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 16,
    marginLeft: 4,
  },

  // ── Loading ───────────────────────────────────────────────────────────────────
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  loadingText: { fontSize: 12, fontWeight: '500' },

  // ── Generate card ─────────────────────────────────────────────────────────────
  generateCard: {
    borderWidth: 1,
    borderRadius: 28,
    padding: 28,
    alignItems: 'center',
    marginBottom: 16,
  },
  cardLightShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 3,
  },
  generateIconArea: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  generateIconInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 10,
    textAlign: 'center',
  },
  generateBody: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  messageChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    alignSelf: 'stretch',
  },
  messageChipText: { fontSize: 13, lineHeight: 18, flex: 1, fontWeight: '500' },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 56,
    borderRadius: 28,
    paddingHorizontal: 24,
    alignSelf: 'stretch',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  generateBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // ── Regenerate ────────────────────────────────────────────────────────────────
  regenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 16,
    marginTop: 10,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  regenerateBtnText: { fontSize: 13, fontWeight: '700' },
  generateMsgText: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 8,
  },
});
