
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useAppTheme } from '@/theme-provider';

export default function IndexScreen() {
  const { resolvedTheme } = useAppTheme();

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: resolvedTheme.colors.background }}>
      <ActivityIndicator size="large" color={resolvedTheme.colors.primary} />
    </View>
  );
}
