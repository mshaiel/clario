import { Stack } from 'expo-router';
import React from 'react';

// This layout is intentionally simple — just a Stack navigator.
// All internal routing within the onboarding group is done by the
// individual screens themselves (e.g. onboarding/index.tsx calls
// router.replace when the user taps Next). This avoids the race
// condition where a layout-level useEffect fires router.replace
// while the Stack's children are still mounting or unmounting,
// which caused the 'sound-check not handled' dev warning.
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="sound-check" />
      <Stack.Screen name="persona" />
      <Stack.Screen name="triage" />
      <Stack.Screen name="assessment" />
      <Stack.Screen name="phase-a" options={{ animation: 'none' }} />
      <Stack.Screen name="phase-c" options={{ animation: 'none' }} />
      <Stack.Screen name="drill-down" />
      <Stack.Screen name="recap" options={{ animation: 'fade' }} />
    </Stack>
  );
}



