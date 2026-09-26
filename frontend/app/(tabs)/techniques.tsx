import { TechniqueGrid } from '@/components/techniques/TechniqueGrid';
import { TechniqueModal } from '@/components/techniques/TechniqueModal';
import { BrandWaveform } from '@/components/ui/BrandWaveform';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { SortKey, sortTechniques, useTechniques } from '@/hooks/useTechniques';
import { haptics } from '@/lib/haptics';
import { SUBTYPE_COLORS, SUBTYPE_LABELS, TechniqueGuide, TURQUOISE } from '@/lib/techniqueData';
import { TestType } from '@/lib/types';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

const SORT_OPTIONS: { key: SortKey; label: string; icon: string }[] = [
  { key: 'difficulty', label: 'Easy → Hard',   icon: 'trending-up-outline' },
  { key: 'category',   label: 'Category',      icon: 'grid-outline' },
  { key: 'subtype',    label: 'Error Type',    icon: 'pulse-outline' },
  { key: 'review',     label: 'Review Status', icon: 'checkmark-circle-outline' },
];

export default function TechniquesScreen() {
  const { resolvedTheme } = useAppTheme();
  const {
    userTechniques,
    userSubtypes,
    filterBySubtype,
    isReviewed,
    getReviewDate,
    markReviewed,
    unmarkReviewed,
    reviewStats,
    reviewMap,
  } = useTechniques();

  const [selectedTechnique, setSelectedTechnique] = useState<TechniqueGuide | null>(null);
  const [selectedSubtype, setSelectedSubtype]     = useState<TestType | 'all'>('all');
  const [sortKey, setSortKey]                     = useState<SortKey>('difficulty');
  const [sortDropdownOpen, setSortDropdownOpen]   = useState(false);

  // Load persisted sort preference
  useEffect(() => {
    AsyncStorage.getItem('@techniques_sort_key').then((val: string | null) => {
      if (val && SORT_OPTIONS.some(o => o.key === val)) setSortKey(val as SortKey);
    });
  }, []);

  // -- Derived colors --------------------------------------------------------
  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#0C0F14' : '#F2F5F9';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const text    = resolvedTheme.colors.text;
  const subtle  = isDark ? '#7A8FA3' : '#59677A';

  // -- Subtypes present in the user's technique list -------------------------
  const availableSubtypes: TestType[] = useMemo(() => {
    const seen = new Set<TestType>();
    for (const t of userTechniques) {
      for (const s of t.subtypes) {
        if (userSubtypes.includes(s)) seen.add(s);
      }
    }
    return Array.from(seen);
  }, [userTechniques, userSubtypes]);

  // -- Filtered and sorted techniques ----------------------------------------
  const displayed = useMemo(
    () => filterBySubtype(selectedSubtype),
    [selectedSubtype, filterBySubtype],
  );

  const sortedDisplayed = useMemo(
    () => sortTechniques(displayed, sortKey, reviewMap),
    [displayed, sortKey, reviewMap],
  );

  // -- Handlers --------------------------------------------------------------
  const handleSubtypePress = useCallback((sub: TestType | 'all') => {
    haptics.light();
    setSelectedSubtype(sub);
  }, []);

  const handleCardPress = useCallback((technique: TechniqueGuide) => {
    setSelectedTechnique(technique);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedTechnique(null);
  }, []);

  const handleMarkReviewed = useCallback(() => {
    if (selectedTechnique) markReviewed(selectedTechnique.id);
  }, [selectedTechnique, markReviewed]);

  const handleUnmarkReviewed = useCallback(() => {
    if (selectedTechnique) unmarkReviewed(selectedTechnique.id);
  }, [selectedTechnique, unmarkReviewed]);

  const handleSortPress = useCallback((key: SortKey) => {
    haptics.light();
    setSortKey(key);
    setSortDropdownOpen(false);
    AsyncStorage.setItem('@techniques_sort_key', key);
  }, []);

  // -- Memoized list header (prevents FlatList header remounting) ------------
  const ListHeader = useMemo(() => (
    <Animated.View entering={FadeIn.duration(400).delay(100)}>

      {/* -- PAGE HEADER ---------------------------------------------------- */}
      <View style={styles.pageHeader}>
        <Text style={[styles.pageTitle, { color: PRIMARY }]}>Techniques</Text>
        <BrandWaveform size="sm" />
      </View>

      {/* -- REVIEW STATS --------------------------------------------------- */}
      <View style={styles.statsRow}>
        <View style={[styles.statPill, { backgroundColor: '#2CC77518' }]}>
          <Ionicons name="checkmark-circle" size={14} color="#2CC775" />
          <Text style={[styles.statText, { color: '#2CC775' }]}>
            {reviewStats.reviewed} Reviewed
          </Text>
        </View>
        <View style={[styles.statPill, { backgroundColor: isDark ? '#FFA72618' : '#E6850E18' }]}>
          <Ionicons name="time-outline" size={14} color={isDark ? '#FFA726' : '#E6850E'} />
          <Text style={[styles.statText, { color: isDark ? '#FFA726' : '#E6850E' }]}>
            {reviewStats.pending} Pending
          </Text>
        </View>
      </View>

      {/* -- DISORDER PILLS ------------------------------------------------- */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsRow}
      >
        <Pressable
          onPress={() => handleSubtypePress('all')}
          accessibilityLabel="Show all my techniques"
          accessibilityRole="button"
          accessibilityState={{ selected: selectedSubtype === 'all' }}
          style={[
            styles.pill,
            selectedSubtype === 'all'
              ? { backgroundColor: TURQUOISE }
              : { backgroundColor: surface },
          ]}
        >
          <Text style={[
            styles.pillText,
            { color: selectedSubtype === 'all' ? '#FFF' : text },
            selectedSubtype !== 'all' && { opacity: 0.7 },
          ]}>
            All
          </Text>
        </Pressable>

        {availableSubtypes.map((sub: TestType) => {
          const active   = selectedSubtype === sub;
          const subColor = SUBTYPE_COLORS[sub] ?? TURQUOISE;
          return (
            <Pressable
              key={sub}
              onPress={() => handleSubtypePress(sub)}
              accessibilityLabel={`Filter by ${SUBTYPE_LABELS[sub] ?? sub}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.pill,
                active
                  ? { backgroundColor: subColor }
                  : { backgroundColor: surface, borderWidth: 1.5, borderColor: subColor + '50' },
              ]}
            >
              <Text style={[
                styles.pillText,
                { color: active ? '#FFF' : subColor },
              ]}>
                {SUBTYPE_LABELS[sub] ?? sub}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* -- RESULTS COUNT + SORT BUTTON ------------------------------------ */}
      <View style={styles.sortRow}>
        <Text style={[styles.resultsCount, { color: subtle }]}>
          {sortedDisplayed.length} {sortedDisplayed.length === 1 ? 'technique' : 'techniques'}
        </Text>
        <Pressable
          onPress={() => { haptics.light(); setSortDropdownOpen(true); }}
          accessibilityLabel="Sort techniques"
          accessibilityRole="button"
          style={[styles.sortButton, { backgroundColor: surface, borderColor: isDark ? '#252D3A' : '#D1D8E2' }]}
        >
          <Ionicons name="swap-vertical-outline" size={14} color={subtle} />
          <Text style={[styles.sortButtonText, { color: subtle }]}>
            {SORT_OPTIONS.find(o => o.key === sortKey)?.label ?? 'Sort'}
          </Text>
          <Ionicons name="chevron-down-outline" size={13} color={subtle} />
        </Pressable>
      </View>

    </Animated.View>
  ), [PRIMARY, text, isDark, surface, subtle, selectedSubtype, availableSubtypes, sortedDisplayed.length, reviewStats, handleSubtypePress, sortKey, sortDropdownOpen]);

  // -- Empty state -----------------------------------------------------------
  const EmptyState = useMemo(() => (
    <Animated.View entering={FadeInDown.duration(400)} style={styles.emptyState}>
      <Ionicons name="search-outline" size={40} color={subtle} />
      <Text style={[styles.emptyTitle, { color: text }]}>No techniques found</Text>
      <Text style={[styles.emptySubtitle, { color: subtle }]}>
        Try selecting a different filter above.
      </Text>
    </Animated.View>
  ), [text, subtle]);

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* ── Soft glowing top background overlay ── */}
      <GradientGlow color={PRIMARY} isDark={isDark} />

      <TechniqueGrid
        techniques={sortedDisplayed}
        onPress={handleCardPress}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={EmptyState}
        isReviewed={isReviewed}
      />

      <TechniqueModal
        visible={!!selectedTechnique}
        technique={selectedTechnique}
        onClose={handleCloseDetail}
        reviewed={selectedTechnique ? isReviewed(selectedTechnique.id) : false}
        reviewDate={selectedTechnique ? getReviewDate(selectedTechnique.id) : null}
        onMarkReviewed={handleMarkReviewed}
        onUnmarkReviewed={handleUnmarkReviewed}
      />

      {/* -- SORT DROPDOWN -------------------------------------------------- */}
      <Modal
        visible={sortDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortDropdownOpen(false)}
      >
        <Pressable style={styles.dropdownOverlay} onPress={() => setSortDropdownOpen(false)}>
          <Pressable
            style={[styles.dropdownMenu, { backgroundColor: surface, borderColor: isDark ? '#252D3A' : '#D1D8E2' }]}
            onPress={() => {}}
          >
            <Text style={[styles.dropdownTitle, { color: subtle }]}>Sort by</Text>
            {SORT_OPTIONS.map(opt => {
              const active = sortKey === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => handleSortPress(opt.key as SortKey)}
                  style={[styles.dropdownItem, active && { backgroundColor: TURQUOISE + '18' }]}
                >
                  <Ionicons name={opt.icon as any} size={16} color={active ? TURQUOISE : subtle} />
                  <Text style={[styles.dropdownItemText, { color: active ? TURQUOISE : text, fontWeight: active ? '700' : '500' }]}>
                    {opt.label}
                  </Text>
                  {active && <Ionicons name="checkmark" size={16} color={TURQUOISE} style={{ marginLeft: 'auto' as any }} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Page header
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 24,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
  },

  // Review stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Pills
  pillsRow: {
    paddingHorizontal: 24,
    gap: 8,
    paddingBottom: 14,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },

  // Results count + sort row
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 10,
  },
  resultsCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  sortButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Sort dropdown
  dropdownOverlay: {
    flex: 1,
    backgroundColor: '#00000050',
    justifyContent: 'flex-end',
  },
  dropdownMenu: {
    marginHorizontal: 16,
    marginBottom: 32,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dropdownTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dropdownItemText: {
    fontSize: 15,
  },
});
