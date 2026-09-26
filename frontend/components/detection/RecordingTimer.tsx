/**
 * Recording Timer Component
 * Visual countdown timer for recording session
 * Refactored to use Reanimated for UI-thread performance
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withSequence, 
  withTiming, 
  Easing 
} from 'react-native-reanimated';
import { useAppTheme } from '@/theme-provider';

interface Props {
  remainingTime: number;
  totalTime: number;
  isActive: boolean;
}

export function RecordingTimer({ remainingTime, totalTime, isActive }: Props) {
  const { resolvedTheme } = useAppTheme();
  
  // Shared value for scale
  const scale = useSharedValue(1);
  
  const progress = (totalTime - remainingTime) / totalTime;

  // Pulse animation when recording is active
  useEffect(() => {
    if (isActive) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1, // Infinite repeat
        true // Reverse
      );
    } else {
      scale.value = withTiming(1);
    }
  }, [isActive]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const getTimerColor = () => {
    if (remainingTime > 8) return '#43A047'; // Green - plenty of time
    if (remainingTime > 4) return '#FB8C00'; // Orange - warning
    return '#E53935'; // Red - critical
  };

  const getTimeWarning = () => {
    if (remainingTime > 8) return "Speaking...";
    if (remainingTime > 4) return "Wrap it up...";
    return "Time's almost up!";
  };

  const timerColor = getTimerColor();

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.timerCircle, { borderColor: timerColor }, animatedStyle]}>
        <Text style={[styles.timerText, { color: resolvedTheme.colors.text }]}>
          {remainingTime}s
        </Text>
        
        {/* Background Progress Ring (Static or could be animated similarly) */}
        <View style={styles.progressRing}>
           <View 
            style={[
              styles.progressFill, 
              { 
                height: `${progress * 100}%`,
                backgroundColor: timerColor
              }
            ]} 
          />
        </View>
      </Animated.View>

      <Text style={[styles.warningText, { color: timerColor }]}>
        {isActive ? getTimeWarning() : "Ready"}
      </Text>
      
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 100, height: 4, backgroundColor: resolvedTheme.colors.border, borderRadius: 2, overflow: 'hidden' }}>
          <View 
            style={[
              { 
                height: '100%', 
                width: `${progress * 100}%`,
                backgroundColor: timerColor
              }
            ]} 
          />
        </View>
        <Text style={[styles.progressText, { color: resolvedTheme.colors.text }]}>
          {Math.round(progress * 100)}% complete
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 20,
  },
  timerCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    position: 'relative',
    overflow: 'hidden', // Ensure fill stays inside
  },
  timerText: {
    fontSize: 24,
    fontWeight: '700',
    zIndex: 2,
  },
  progressRing: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    borderRadius: 56, // Slightly smaller than parent
    backgroundColor: 'transparent',
  },
  progressFill: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#E53935',
    opacity: 0.2, // Subtle background fill
  },
  warningText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  progressText: {
    fontSize: 12,
    opacity: 0.6,
  },
});