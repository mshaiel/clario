/**
 * useTechniques.ts
 * Data hook for the Techniques tab.
 *
 * Key behaviours:
 *   - Only shows techniques relevant to the user's diagnosed subtypes.
 *   - "All" pill means "all of my disorders", not every technique.
 *   - Integrates per-technique review tracking (reviewed / pending).
 *   - Categories are scoped to the currently filtered set.
 */

import { useLanguage } from '@/context/LanguageContext';
import { useOnboarding } from '@/context/OnboardingContext';
import {
  CATEGORIES,
  CATEGORY_MAP,
  CategoryMeta,
  ENGLISH_TECHNIQUES,
  TechniqueGuide,
  URDU_TECHNIQUES,
} from '@/lib/techniqueData';
import {
  TechniqueReviewMap,
  loadReviewMap,
  markTechniqueReviewed,
  unmarkTechniqueReviewed,
} from '@/lib/techniqueReviewService';
import { QuestionnaireSelection, TechniqueCategory, TestType } from '@/lib/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

// ── Sorting ───────────────────────────────────────────────────────────────────

export type SortKey = 'difficulty' | 'category' | 'subtype' | 'review';

const DIFF_ORDER: Record<string, number> = { Beginner: 0, Intermediate: 1, Advanced: 2 };

/**
 * Sort a technique list by the chosen key.
 * Reviewed items always sink below unreviewed ones regardless of sort key.
 */
export function sortTechniques(
  techniques: TechniqueGuide[],
  sortKey: SortKey,
  reviewMap: TechniqueReviewMap,
): TechniqueGuide[] {
  return [...techniques].sort((a, b) => {
    // Always sink reviewed to bottom
    const aR = reviewMap[a.id] ? 1 : 0;
    const bR = reviewMap[b.id] ? 1 : 0;
    if (aR !== bR) return aR - bR;

    // Within same group, apply primary sort key
    switch (sortKey) {
      case 'difficulty':
        return (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1);
      case 'category':
        return a.category.localeCompare(b.category)
          || (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1);
      case 'subtype':
        return (a.subtypes[0] ?? '').localeCompare(b.subtypes[0] ?? '')
          || (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1);
      case 'review':
      default:
        return (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1);
    }
  });
}

export function useTechniques() {
  const { language } = useLanguage();
  const { profile } = useOnboarding();

  // ── All techniques for the current language ──────────────────────────────
  const allTechniques = language === 'urdu' ? URDU_TECHNIQUES : ENGLISH_TECHNIQUES;

  // ── Active subtypes from the user's clinical profile ─────────────────────
  const activeSubtypes: TestType[] = useMemo(() => {
    if (!profile?.selections?.length) return [];
    return profile.selections.map((s: QuestionnaireSelection) => s.subtype);
  }, [profile?.selections]);

  const userSubtypes: TestType[] = activeSubtypes;

  // ── Techniques relevant to this user (union of their subtypes) ────────────
  // When the user has no profile yet, fall back to all techniques so the
  // screen isn't empty during initial load.
  const userTechniques: TechniqueGuide[] = useMemo(() => {
    if (!activeSubtypes.length) return allTechniques;
    const seen = new Set<string>();
    const result: TechniqueGuide[] = [];
    for (const t of allTechniques) {
      if (!seen.has(t.id) && t.subtypes.some((s: TestType) => activeSubtypes.includes(s))) {
        seen.add(t.id);
        result.push(t);
      }
    }
    return result;
  }, [allTechniques, activeSubtypes]);

  // ── Filter by a single subtype (or 'all' = all user techniques) ──────────
  const filterBySubtype = useCallback(
    (subtype: TestType | 'all'): TechniqueGuide[] => {
      if (subtype === 'all') return userTechniques;
      const seen = new Set<string>();
      return userTechniques.filter((t) => {
        if (seen.has(t.id)) return false;
        if (t.subtypes.includes(subtype)) { seen.add(t.id); return true; }
        return false;
      });
    },
    [userTechniques],
  );

  // ── Filter by category (on top of current slice) ─────────────────────────
  const filterByCategory = useCallback(
    (techniques: TechniqueGuide[], category: TechniqueCategory | 'all'): TechniqueGuide[] => {
      if (category === 'all') return techniques;
      return techniques.filter((t) => t.category === category);
    },
    [],
  );

  // ── Categories scoped to a given technique slice ──────────────────────────
  const getCategoriesFor = useCallback(
    (techniques: TechniqueGuide[]): CategoryMeta[] => {
      const present = new Set(techniques.map((t) => t.category));
      return CATEGORIES.filter((c: CategoryMeta) => present.has(c.label));
    },
    [],
  );

  // ── Review tracking ──────────────────────────────────────────────────────
  const [reviewMap, setReviewMap] = useState<TechniqueReviewMap>({});

  useEffect(() => {
    loadReviewMap(language).then(setReviewMap);
  }, [language]);

  const markReviewed = useCallback(
    async (techniqueId: string) => {
      const updated = await markTechniqueReviewed(techniqueId, language);
      setReviewMap(updated);
    },
    [language],
  );

  const unmarkReviewed = useCallback(
    async (techniqueId: string) => {
      const updated = await unmarkTechniqueReviewed(techniqueId, language);
      setReviewMap(updated);
    },
    [language],
  );

  const isReviewed = useCallback(
    (techniqueId: string): boolean => !!reviewMap[techniqueId],
    [reviewMap],
  );

  const getReviewDate = useCallback(
    (techniqueId: string): string | null => reviewMap[techniqueId]?.reviewedAt ?? null,
    [reviewMap],
  );

  const reviewStats = useMemo(() => {
    const total = userTechniques.length;
    const reviewed = userTechniques.filter((t) => !!reviewMap[t.id]).length;
    return { total, reviewed, pending: total - reviewed };
  }, [userTechniques, reviewMap]);

  return {
    allTechniques,
    userTechniques,
    activeSubtypes,
    userSubtypes,
    filterBySubtype,
    filterByCategory,
    getCategoriesFor,
    allCategories: CATEGORIES,
    CATEGORY_MAP,
    // Review tracking
    reviewMap,
    markReviewed,
    unmarkReviewed,
    isReviewed,
    getReviewDate,
    reviewStats,
  };
}
