import { useLocalSearchParams } from 'expo-router';
import { getPracticeCardById } from '../lib/practiceSessionStore';

export function usePracticeExercise() {
  const params = useLocalSearchParams<{ exerciseId?: string }>();
  const exerciseId = typeof params.exerciseId === 'string' ? params.exerciseId : '';
  const exerciseCard = exerciseId ? getPracticeCardById(exerciseId) : null;

  return {
    exerciseId,
    exerciseCard,
    payload: exerciseCard?.payload ?? null,
  };
}
