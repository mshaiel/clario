/**
 * Diagnostics Screen
 * Location: app/diagnostics.tsx
 *
 * Accepts optional `bundledIds` param (comma-separated sentence IDs from bundled
 * JSON files). When present, DetectionSession skips the OTA zip read and uses
 * the bundled sentences directly — enabling mock testing without any real download.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Platform, StatusBar } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme } from '@/theme-provider';
import { DetectionSession } from '@/components/detection/DetectionSession';
import { TestTypeSelector } from '@/components/detection/TestTypeSelector';
import type { TestType } from '@/lib/types';
import { BrandWaveform } from '@/components/ui/BrandWaveform';

const STATUSBAR_HEIGHT = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 32) : 0;
export default function DiagnosticsScreen() {
  const { resolvedTheme } = useAppTheme();
  const router = useRouter();

  /**
   * params.testId    — moduleId (e.g. "mock_velar_english")
   * params.testType  — category  (e.g. "velar_fronting")
   * params.bundledIds — comma-separated sentence IDs from bundled JSON (mock mode)
   */
  const params = useLocalSearchParams<{
    testId?: string;
    testType?: string;
    bundledIds?: string;
    paragraphMode?: string;
  }>();

  // Parse bundled sentence IDs if provided
  const bundledSentenceIds: string[] = params.bundledIds
    ? params.bundledIds.split(',').filter(Boolean)
    : [];

  const initialParagraphMode = params.paragraphMode === '1';

  // Local state for manual selection fallback
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(params.testId || null);
  const [selectedTestType, setSelectedTestType] = useState<TestType | null>(
    (params.testType as TestType) || null
  );

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#0C0F14' : '#F2F5F9';
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#59677A';

  const handleSessionEnd = () => {
    if (params.testId) {
      router.back();
    } else {
      setSelectedModuleId(null);
      setSelectedTestType(null);
    }
  };

  // 1. Launch directly if we have a moduleId (normal flow from Dashboard)
  if (selectedModuleId && selectedTestType) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <DetectionSession
          moduleId={selectedModuleId}
          testType={selectedTestType}
          bundledSentenceIds={bundledSentenceIds.length > 0 ? bundledSentenceIds : undefined}
          initialParagraphMode={initialParagraphMode}
          onEnd={handleSessionEnd}
        />
      </>
    );
  }

  // 2. Fallback Menu (Manual selection)
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg, paddingTop: STATUSBAR_HEIGHT }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor="transparent"
        translucent
      />
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <View>
          <Text style={[styles.pageTitle, { color: text }]}>Assessments</Text>
          <Text style={[styles.pageSubtitle, { color: subtle }]}>
            Select a test category to begin
          </Text>
        </View>
        <BrandWaveform size="sm" />
      </View>

      <TestTypeSelector
        onSelectTest={(type) => {
          setSelectedTestType(type);
          setSelectedModuleId(type);
        }}
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
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
  },
  pageTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6, marginBottom: 3 },
  pageSubtitle: { fontSize: 13, fontWeight: '400' },

});