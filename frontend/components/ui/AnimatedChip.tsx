import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

interface AnimatedChipProps {
  label: string;
  iconName: string;
  iconColor: string;
  backgroundColor: string;
  textColor: string;
  borderWidth?: number;
  borderColor?: string;
  onPress: () => void;
}

export function AnimatedChip({
  label,
  iconName,
  iconColor,
  backgroundColor,
  textColor,
  borderWidth = 0,
  borderColor = 'transparent',
  onPress,
}: AnimatedChipProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = () => {
    scale.value = withSpring(0.94, { damping: 20, stiffness: 150 });
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 20, stiffness: 150 });
  };

  return (
    <Animated.View style={[animatedStyle, { borderRadius: 8, overflow: 'hidden' }]}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[styles.chip, { backgroundColor, borderWidth, borderColor }]}
      >
        <Ionicons name={iconName as any} size={12} color={iconColor} />
        <Text style={[styles.text, { color: textColor }]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});
