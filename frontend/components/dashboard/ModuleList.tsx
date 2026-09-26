/**
 * Module List
 * Location: components/dashboard/ModuleList.tsx
 * * Phase 8 Fix: Added explicit modules prop to match Thin Client architecture.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/theme-provider';

interface Module {
  id: string;
  title: string;
  description: string;
  progress: number;
  subtype: string;
}

interface Props {
  modules: Module[];
  onSelect: (id: string) => void;
}

export function ModuleList({ modules, onSelect }: Props) {
  const { resolvedTheme } = useAppTheme();
  const PRIMARY = resolvedTheme.colors.primary;

  return (
    <View style={styles.container}>
      {modules.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={[styles.card, { backgroundColor: resolvedTheme.colors.card, borderColor: resolvedTheme.colors.border }]}
          onPress={() => onSelect(item.id)}
          activeOpacity={0.7}
        >
          <View style={[styles.iconBox, { backgroundColor: PRIMARY + '15' }]}>
            <Ionicons name="journal-outline" size={20} color={PRIMARY} />
          </View>
          
          <View style={styles.textColumn}>
            <Text style={[styles.title, { color: resolvedTheme.colors.text }]}>{item.title}</Text>
            <Text style={[styles.desc, { color: resolvedTheme.dark ? '#7A8FA3' : '#8D9FAE' }]} numberOfLines={1}>
              {item.description}
            </Text>
            
            {/* Progress Bar */}
            <View style={styles.progressRow}>
              <View style={[styles.barBg, { backgroundColor: resolvedTheme.dark ? '#1E2530' : '#E8EDEF' }]}>
                <View style={[styles.barFill, { width: `${item.progress * 100}%`, backgroundColor: PRIMARY }]} />
              </View>
              <Text style={[styles.progressText, { color: PRIMARY }]}>
                {Math.round(item.progress * 100)}%
              </Text>
            </View>
          </View>

          <Ionicons name="chevron-forward" size={18} color={resolvedTheme.colors.border} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingBottom: 20 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  textColumn: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '700' },
  desc: { fontSize: 12, marginBottom: 6 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barBg: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  progressText: { fontSize: 10, fontWeight: '700', width: 28 },
});