/**
 * useSafeStyle — Android-safe layout utilities
 * Provides consistent header padding and spacing constants
 * that work reliably across Android devices where SafeAreaView
 * + static paddingTop is insufficient.
 */

import { useMemo } from 'react';
import { Platform, StatusBar } from 'react-native';

export function useSafeStyle() {
  return useMemo(() => {
    const androidStatusBarHeight = Platform.OS === 'android'
      ? (StatusBar.currentHeight ?? 24)
      : 0;

    return {
      /** Extra top padding for practice screen headers on Android */
      safeHeaderPaddingTop: Platform.OS === 'android'
        ? androidStatusBarHeight + 4
        : 8,

      /** Consistent vertical spacing that works on all Android versions */
      gap4: Platform.select({ android: { marginTop: 4 }, default: {} }),
      gap6: Platform.select({ android: { marginTop: 6 }, default: {} }),
      gap8: Platform.select({ android: { marginTop: 8 }, default: {} }),
      gap10: Platform.select({ android: { marginTop: 10 }, default: {} }),
      gap12: Platform.select({ android: { marginTop: 12 }, default: {} }),

      /** Platform-aware StatusBar height */
      statusBarHeight: androidStatusBarHeight,
    };
  }, []);
}
