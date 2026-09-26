
/**
 * Persona Screen
 * Location: app/onboarding/persona.tsx
 *
 * New step 3 of 7 in the onboarding flow.
 * Collects `target_persona` (child | teen | adult) which is required
 * by the UAB questionnaire payload to calibrate the clinical tensor.
 *
 * Style: matches existing OptionCard / QuestionLayout pattern exactly.
 */

import React from 'react';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { QuestionLayout } from '@/components/onboarding/QuestionLayout';
import { OptionCard } from '@/components/onboarding/OptionCard';
import { useOnboarding } from '@/context/OnboardingContext';
import { TargetPersona } from '@/lib/types';

interface PersonaOption {
  id: TargetPersona;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const PERSONA_OPTIONS: PersonaOption[] = [
  {
    id: 'child',
    title: 'Child',
    description: 'Age 3 – 12 · Early speech development exercises.',
    icon: 'happy-outline',
  },
  {
    id: 'teen',
    title: 'Teen',
    description: 'Age 13 – 17 · Focused on social confidence and fluency.',
    icon: 'school-outline',
  },
  {
    id: 'adult',
    title: 'Adult',
    description: 'Age 18 + · Professional and everyday speech clarity.',
    icon: 'person-outline',
  },
];

export default function PersonaScreen() {
  const router = useRouter();
  const { profile, setTargetPersona, confirmPersonaAndProceed } = useOnboarding();

  const handleNext = () => {
    confirmPersonaAndProceed();
    router.push('/onboarding/triage');
  };

  return (
    <QuestionLayout
      title="Who is this for?"
      subtitle="This helps us personalise the difficulty and style of your exercises."
      progress={3 / 6} // Step 3 of 6
      onBack={() => router.replace('/onboarding/sound-check')}
      onNext={handleNext}
      nextDisabled={!profile.target_persona}
      nextLabel="Continue"
    >
      {PERSONA_OPTIONS.map((option) => (
        <OptionCard
          key={option.id}
          title={option.title}
          description={option.description}
          icon={option.icon}
          selected={profile.target_persona === option.id}
          onPress={() => setTargetPersona(option.id)}
        />
      ))}
    </QuestionLayout>
  );
}
