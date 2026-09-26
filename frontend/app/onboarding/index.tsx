/**
 * Language Selection Screen
 * Location: app/onboarding/index.tsx
 *
 * Step 1 of 7 — shown only when onboardingStep === 'language'.
 *
 * For every other step (sound-check, persona, triage) we return a
 * <Redirect> synchronously in the render body so there is zero flash
 * of the language-selection UI. A useEffect-based redirect fires after
 * paint, which is too late — the language screen renders for one frame
 * and the user sees it briefly.
 */

import React from 'react';
import { Redirect, useRouter } from 'expo-router';

import { QuestionLayout } from '@/components/onboarding/QuestionLayout';
import { OptionCard } from '@/components/onboarding/OptionCard';
import { useLanguage } from '@/context/LanguageContext';
import { useOnboardingActions, useOnboardingState } from '@/context/OnboardingContext';
import { useState } from 'react';

export default function LanguageScreen() {
  const router = useRouter();
  const { setLanguage } = useLanguage();
  const { confirmLanguageAndProceed } = useOnboardingActions();
  const { onboardingStep, isInitialized } = useOnboardingState();

  const [selected, setSelected] = useState<'english' | 'urdu' | null>(null);

  // ── Synchronous render-path redirect ─────────────────────────────────────
  // We are NOT using useEffect here because state from context may not have
  // propagated yet when the screen first mounts — a useEffect fires after
  // paint, causing a one-frame flash of the language UI.
  // Returning <Redirect> in the render body is instantaneous.
  if (!isInitialized) return null;

  if (onboardingStep === 'sound-check') {
    return <Redirect href="/onboarding/sound-check" />;
  }
  if (onboardingStep === 'persona') {
    return <Redirect href="/onboarding/persona" />;
  }
  if (onboardingStep === 'triage') {
    return <Redirect href="/onboarding/triage" />;
  }

  // ── Language selection UI (onboardingStep === 'language') ─────────────────
  const handleNext = () => {
    if (!selected) return;
    setLanguage(selected);
    confirmLanguageAndProceed(selected);
    router.replace('/onboarding/sound-check');
  };

  return (
    <QuestionLayout
      title="Let's get started"
      subtitle="Which language do you want to improve your speech in?"
      progress={1 / 6}
      onNext={handleNext}
      nextDisabled={!selected}
    >
      <OptionCard
        title="English"
        description="I want to practice English pronunciation."
        selected={selected === 'english'}
        onPress={() => setSelected('english')}
      />
      <OptionCard
        title="Urdu (اردو)"
        description="میں اردو بول چال بہتر کرنا چاہتا ہوں۔"
        selected={selected === 'urdu'}
        onPress={() => setSelected('urdu')}
      />
    </QuestionLayout>
  );
}
