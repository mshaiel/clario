import LoadingScreen from '@/app/loading';
import { CustomTabBar } from '@/components/ui/CustomTabBar';
import { useOnboardingState } from '@/context/OnboardingContext';
import { haptics } from '@/lib/haptics';
import { useAppTheme } from '@/theme-provider';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

/**
 * This layout wraps ALL tab screens with an onboarding completion guard.
 *
 * WHY: Even with the root gatekeeper redirecting to /onboarding when the
 * profile is incomplete, there is a brief window during login/signup where
 * React renders the tab navigator before the gatekeeper's useEffect fires.
 * During this window, tab screens would render their content (showing
 * the plan, diagnostics etc) for a fraction of a second — the "flash".
 *
 * FIX: We check profile.completed here at the layout level. If it's false,
 * we render a blank loading screen INSTEAD of the Tabs navigator entirely.
 * The root gatekeeper then routes away from /(tabs) and everything is clean.
 */
export default function TabsLayout() {
  const { resolvedTheme } = useAppTheme();
  const { profile, isInitialized } = useOnboardingState();

  // Block rendering of ALL tab content until the onboarding context is
  // initialised. We do NOT check profile.completed here — the root _layout.tsx
  // already issues a <Redirect> away from /(tabs) when profile isn't complete.
  // Checking profile.completed here would destroy the Tabs navigator (and
  // unmount settings.tsx) the instant resetForLanguageChange sets
  // completed=false, causing the "stuck on Clario logo" bug.
  if (!isInitialized) {
    return (
      <View style={[styles.fill, { backgroundColor: resolvedTheme.colors.background }]}>
        <LoadingScreen />
      </View>
    );
  }

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
      screenListeners={{
        tabPress: () => {
          haptics.light();
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Tests',
        }}
      />
      <Tabs.Screen
        name="practice"
        options={{
          title: 'Practice',
        }}
      />
      <Tabs.Screen
        name="progress-report"
        options={{
          title: 'Progress',
        }}
      />
      <Tabs.Screen
        name="techniques"
        options={{
          title: 'Techniques',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
