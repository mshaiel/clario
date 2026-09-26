import { ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';

import LoadingScreen from '@/app/loading';
import { AICoPilotProvider } from '@/context/AICoPilotContext';
import { DownloadProvider } from '@/context/DownloadContext';
import { LanguageProvider, useLanguage } from '@/context/LanguageContext';
import { OnboardingProvider, useOnboardingState } from '@/context/OnboardingContext';
import { auth } from '@/firebase';
import { AppThemeProvider, useAppTheme } from '@/theme-provider';

function InnerLayout() {
  const { resolvedTheme } = useAppTheme();
  const segments = useSegments();
  const router = useRouter();

  const { isLanguageLoaded } = useLanguage();
  const { profile, isLoading, isInitialized, isSyncing, onboardingStep } = useOnboardingState();
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // Track the last navigation target we dispatched so we don't re-navigate
  // on every re-render once we're already on the correct screen.
  const lastNavRef = useRef<string | null>(null);

  useEffect(() => {
    const subscriber = onAuthStateChanged(auth, (u: User | null) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return subscriber;
  }, []);

  const isAppReady = isAuthReady && isLanguageLoaded && isInitialized && !isLoading;

  // ── Drive all auth/onboarding routing from a single effect ───────────────
  //
  // KEY DESIGN DECISION: We NEVER return <Redirect> from InnerLayout because
  // that would unmount the <Stack> navigator before it can process the
  // navigation action, causing "REPLACE not handled by any navigator".
  //
  // Instead: always render the <Stack>, show a LoadingScreen overlay while
  // the app initialises, then use router.replace() from a useEffect once
  // the Stack is mounted and ready.
  useEffect(() => {
    if (!isAppReady) return; // Wait until Stack is mounted and data is ready

    const seg0 = segments[0] as string | undefined;
    const inTabsGroup       = seg0 === '(tabs)';
    const inOnboardingGroup = seg0 === 'onboarding';
    const inAuthScreens     = seg0 === 'login' || seg0 === 'signup' || seg0 === 'forgot-password';
    const inStandalonePracticeMock = seg0 === 'practice';

    let target: string | null = null;

    if (!user) {
      // Not logged in — go to login (but stay put if already on an auth screen)
      if (!inAuthScreens) target = '/login';
    } else if (!profile.completed) {
      // Logged in but onboarding not finished.
      // EXCEPTION: if we're on signup and profile isn't complete yet, it means
      // Firebase fired onAuthStateChanged(newUser) before signOut() completed
      // (the signup flow signs out immediately after creating the account).
      // Do NOT route away — let the signup flow finish its own signOut + redirect.
      if (seg0 === 'signup') return;
      if (!isSyncing && !inOnboardingGroup) {
        if (onboardingStep === 'triage')           target = '/onboarding/triage';
        else if (onboardingStep === 'sound-check') target = '/onboarding/sound-check';
        else if (onboardingStep === 'persona')     target = '/onboarding/persona';
        else                                       target = '/onboarding';
      }
    } else {
      // Onboarding complete — go directly to Home (navigates away from login/signup too)
      if (!inTabsGroup && seg0 !== 'diagnostics' && !inStandalonePracticeMock) target = '/(tabs)/home';
    }

    // Only navigate when moving somewhere new — avoid re-navigating to the
    // same screen on every context update while already there.
    if (target !== null && target !== lastNavRef.current) {
      lastNavRef.current = target;
      router.replace(target as any);
    } else if (target === null) {
      // We're on the right screen — clear so future transitions aren't blocked
      lastNavRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppReady, user, profile.completed, onboardingStep, isSyncing, segments]);

  // ── Always render the Stack so the navigator is always mounted ────────────
  // The LoadingScreen overlay sits above it and hides any flash during init.
  return (
    <ThemeProvider value={resolvedTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="index" />
        <Stack.Screen name="loading" />
        <Stack.Screen name="diagnostics" />
        <Stack.Screen name="practice/auditory_bombardment" />
        <Stack.Screen name="practice/phoneme_isolation" />
        <Stack.Screen name="practice/minimal_pairs" />
        <Stack.Screen name="practice/syllable_chaining" />
        <Stack.Screen name="practice/carrier_phrases" />
        <Stack.Screen name="practice/pacing" />
        <Stack.Screen name="practice/shadowing" />
        <Stack.Screen name="practice/speed_drills" />
        <Stack.Screen name="practice/session" />
      </Stack>
      <StatusBar style={resolvedTheme.dark ? 'light' : 'dark'} />

      {/* Loading overlay — rendered on TOP of the Stack so screens below
          are never visible during initialisation or auth state transitions */}
      {!isAppReady && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: resolvedTheme.colors.background, zIndex: 999 },
          ]}
        >
          <LoadingScreen />
        </View>
      )}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <LanguageProvider>
        <OnboardingProvider>
          <DownloadProvider>
            <AICoPilotProvider>
              <InnerLayout />
            </AICoPilotProvider>
          </DownloadProvider>
        </OnboardingProvider>
      </LanguageProvider>
    </AppThemeProvider>
  );
}
