/**
 * ParagraphResultsScreen
 * Location: components/detection/ParagraphResultsScreen.tsx
 *
 * Full-screen post-session results view for Paragraph Mode.
 * Rendered after all background sentence analyses have resolved.
 * Shows overall accuracy banner + per-sentence cards with inline
 * error-word highlighting and tappable chips → ErrorDetailSheet.
 */

import React, { useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import type { AnalysisResponse, FlaggedWord } from '@/lib/types';
import type { Sentence } from '@/lib/types';
import type { SentenceState } from './ParagraphTextView';
import { ErrorDetailSheet, getErrorColor, getErrorLabel } from './ErrorDetailSheet';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
    sentences: Sentence[];
    /** Results keyed by sentence index. null = analysis failed for that sentence. */
    sentenceResults: Record<number, AnalysisResponse | null>;
    sentenceStates: SentenceState[];
    onDismissWord: (word: string, sentenceIdx: number) => void;
    onFinish: () => void;
    isFinishing: boolean;
    onRetry: () => void;
    theme: {
        bg: string;
        surface: string;
        border: string;
        text: string;
        subtle: string;
        primary: string;
    };
    isDark: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanWord(raw: string): string {
    return raw.replace(/[.,/#!$%^&*;:{}=\-_`~()?!"']/g, '').toLowerCase();
}

function scoreColor(accuracy: number): string {
    return accuracy >= 80 ? '#10B981' : accuracy >= 50 ? '#F59E0B' : '#EF4444';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ParagraphResultsScreen({
    sentences,
    sentenceResults,
    sentenceStates,
    onDismissWord,
    onFinish,
    isFinishing,
    onRetry,
    theme,
    isDark,
}: Props) {
    const insets = useSafeAreaInsets();

    const [sheetError, setSheetError] = useState<FlaggedWord | null>(null);
    const [sheetVisible, setSheetVisible] = useState(false);
    const [sheetSentenceIdx, setSheetSentenceIdx] = useState(-1);

    // ── Overall stats ────────────────────────────────────────────────────────
    const resultEntries = sentences.map((_, idx) => ({
        idx,
        result: sentenceResults[idx] ?? null,
    }));

    const validAccuracies = resultEntries
        .filter(({ result }) => result !== null && result.sentence_accuracy > 0)
        .map(({ result }) => result!.sentence_accuracy);

    const overallAccuracy =
        validAccuracies.length > 0
            ? Math.round(validAccuracies.reduce((a, b) => a + b, 0) / validAccuracies.length)
            : 0;

    const totalErrors = resultEntries.reduce(
        (sum, { result, idx }) =>
            sum +
            (result?.flagged_words ?? []).filter(
                (e) => !(sentenceStates[idx]?.dismissedWords.has(e.word) ?? false)
            ).length,
        0
    );

    const bannerColor = scoreColor(overallAccuracy);
    const scoreLabel =
        overallAccuracy >= 80
            ? 'Great session!'
            : overallAccuracy >= 50
                ? 'Good progress'
                : 'Keep practising';

    // ── Sheet helpers ─────────────────────────────────────────────────────────
    const openSheet = (error: FlaggedWord, sentenceIdx: number) => {
        setSheetError(error);
        setSheetSentenceIdx(sentenceIdx);
        setSheetVisible(true);
    };

    const sheetIsDismissed =
        sheetError && sheetSentenceIdx >= 0
            ? sentenceStates[sheetSentenceIdx]?.dismissedWords.has(sheetError.word) ?? false
            : false;

    // ── Per-sentence card ─────────────────────────────────────────────────────
    const renderCard = (sentence: Sentence, idx: number) => {
        const result = sentenceResults[idx] ?? null;
        const dismissed = sentenceStates[idx]?.dismissedWords ?? new Set<string>();
        const isFailed = result === null;
        const acc = result?.sentence_accuracy ?? 0;
        const flaggedWords: FlaggedWord[] = result?.flagged_words ?? [];
        const visibleErrors = flaggedWords.filter((e) => !dismissed.has(e.word));
        const allSkipped =
            !isFailed &&
            result!.word_results.length > 0 &&
            result!.word_results.every((w) => w.status === 'skipped');
        const isPerfect = !isFailed && !allSkipped && visibleErrors.length === 0;
        const cardAccentColor = isFailed ? theme.subtle : scoreColor(acc);

        const wordNodes = sentence.text.split(' ').map((rawWord, wIdx, arr) => {
            const clean = cleanWord(rawWord);
            const error = flaggedWords.find((e) => e.word.toLowerCase() === clean);
            const isDismissed = error ? dismissed.has(error.word) : false;
            const isSkipped =
                result?.word_results.find((w) => w.word.toLowerCase() === clean)?.status === 'skipped';
            const space = wIdx < arr.length - 1 ? ' ' : '';

            if (error && !isDismissed) {
                const ec = getErrorColor(error);
                return (
                    <Text
                        key={wIdx}
                        onPress={() => openSheet(error, idx)}
                        style={{ color: ec, fontWeight: '700', textDecorationLine: 'underline', textDecorationColor: ec }}
                    >
                        {rawWord}{space}
                    </Text>
                );
            }
            if (isDismissed) {
                return (
                    <Text key={wIdx} style={{ color: theme.subtle, textDecorationLine: 'line-through', opacity: 0.6 }}>
                        {rawWord}{space}
                    </Text>
                );
            }
            if (isSkipped) {
                return <Text key={wIdx} style={{ color: '#F59E0B' }}>{rawWord}{space}</Text>;
            }
            return <Text key={wIdx} style={{ color: theme.text }}>{rawWord}{space}</Text>;
        });

        return (
            <Animated.View
                key={idx}
                entering={FadeInUp.duration(320).delay(100 + idx * 70)}
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
                {/* Card header row */}
                <View style={styles.cardHeader}>
                    <View style={[styles.numBadge, { backgroundColor: cardAccentColor + '18' }]}>
                        <Text style={[styles.numBadgeText, { color: cardAccentColor }]}>
                            {idx + 1}
                        </Text>
                    </View>
                    <Text style={[styles.cardLabel, { color: theme.subtle }]} numberOfLines={1}>
                        Sentence {idx + 1}
                    </Text>
                    {!isFailed && (
                        <View style={[styles.accuracyPill, { backgroundColor: cardAccentColor + '18', borderColor: cardAccentColor + '40' }]}>
                            <Ionicons
                                name={acc >= 80 ? 'checkmark-circle' : 'alert-circle'}
                                size={11}
                                color={cardAccentColor}
                            />
                            <Text style={[styles.accuracyPillText, { color: cardAccentColor }]}>
                                {Math.round(acc)}%
                            </Text>
                        </View>
                    )}
                </View>

                {/* Divider */}
                <View style={[styles.divider, { backgroundColor: theme.border }]} />

                {/* Sentence text */}
                <Text style={[styles.sentenceText, { color: theme.text }]}>
                    {wordNodes}
                </Text>

                {/* Status line */}
                {isFailed && (
                    <View style={styles.statusRow}>
                        <Ionicons name="warning-outline" size={13} color="#F59E0B" />
                        <Text style={[styles.statusText, { color: '#F59E0B' }]}>
                            Analysis unavailable for this sentence
                        </Text>
                    </View>
                )}
                {allSkipped && (
                    <View style={styles.statusRow}>
                        <Ionicons name="mic-off-outline" size={13} color="#F59E0B" />
                        <Text style={[styles.statusText, { color: '#F59E0B' }]}>
                            Recording was not heard clearly
                        </Text>
                    </View>
                )}
                {isPerfect && (
                    <View style={styles.statusRow}>
                        <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                        <Text style={[styles.statusText, { color: '#10B981' }]}>No errors detected</Text>
                    </View>
                )}

                {/* Error chips */}
                {visibleErrors.length > 0 && (
                    <View style={styles.chipsRow}>
                        {visibleErrors.map((err, eIdx) => {
                            const ec = getErrorColor(err);
                            const label = getErrorLabel(err);
                            return (
                                <TouchableOpacity
                                    key={eIdx}
                                    style={[styles.chip, { backgroundColor: ec + '18', borderColor: ec + '40' }]}
                                    onPress={() => openSheet(err, idx)}
                                    activeOpacity={0.72}
                                >
                                    <View style={[styles.chipDot, { backgroundColor: ec }]} />
                                    <Text style={[styles.chipText, { color: ec }]}>{label}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}
            </Animated.View>
        );
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top }]}>
            <StatusBar
                barStyle={isDark ? 'light-content' : 'dark-content'}
                backgroundColor="transparent"
                translucent
            />

            {/* ── Score Banner ──────────────────────────────────────────────────── */}
            <Animated.View
                entering={FadeInDown.duration(400)}
                style={[styles.scoreBanner, { backgroundColor: bannerColor }]}
            >
                <Text style={styles.bannerLabel}>OVERALL ACCURACY</Text>
                <Text style={styles.bannerPercent}>
                    {overallAccuracy}
                    <Text style={styles.bannerPct}>%</Text>
                </Text>
                <Text style={styles.bannerSub}>{scoreLabel}</Text>
                <View style={styles.bannerMeta}>
                    <View style={styles.bannerMetaItem}>
                        <Ionicons name="document-text-outline" size={12} color="rgba(255,255,255,0.8)" />
                        <Text style={styles.bannerMetaText}>{sentences.length} sentences</Text>
                    </View>
                    <View style={styles.bannerMetaDot} />
                    <View style={styles.bannerMetaItem}>
                        <Ionicons
                            name={totalErrors === 0 ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                            size={12}
                            color="rgba(255,255,255,0.8)"
                        />
                        <Text style={styles.bannerMetaText}>
                            {totalErrors === 0 ? 'No errors' : `${totalErrors} error${totalErrors !== 1 ? 's' : ''}`}
                        </Text>
                    </View>
                </View>
            </Animated.View>

            {/* ── Sentence Cards ────────────────────────────────────────────────── */}
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 100, 120) }]}
                showsVerticalScrollIndicator={false}
            >
                <Animated.View entering={FadeIn.duration(300).delay(200)}>
                    <Text style={[styles.sectionLabel, { color: theme.subtle }]}>
                        SENTENCE BREAKDOWN
                    </Text>
                </Animated.View>
                {sentences.map((sentence, idx) => renderCard(sentence, idx))}
            </ScrollView>

            {/* ── Footer ───────────────────────────────────────────────────────── */}
            <Animated.View
                entering={FadeInUp.duration(340).delay(300)}
                style={[
                    styles.footer,
                    {
                        backgroundColor: theme.bg,
                        borderTopColor: theme.border,
                        paddingBottom: Math.max(insets.bottom + 8, 24),
                    },
                ]}
            >
                {totalErrors > 0 && (
                    <Text style={[styles.reviewHint, { color: theme.subtle }]}>
                        Tap underlined words or chips to review each error
                    </Text>
                )}
                <View style={styles.actionRow}>
                    <TouchableOpacity
                        style={[styles.retryBtn, { borderColor: theme.border, backgroundColor: theme.surface }]}
                        onPress={onRetry}
                        activeOpacity={0.75}
                    >
                        <Ionicons name="refresh-outline" size={17} color={theme.subtle} />
                        <Text style={[styles.retryText, { color: theme.subtle }]}>Retry</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.finishBtn,
                            { backgroundColor: '#10B981', shadowColor: '#10B981' },
                            isFinishing && { opacity: 0.65 },
                        ]}
                        onPress={onFinish}
                        disabled={isFinishing}
                        activeOpacity={0.85}
                    >
                        {isFinishing ? (
                            <ActivityIndicator color="#FFF" size="small" />
                        ) : (
                            <>
                                <Text style={styles.finishBtnText}>Finish Session</Text>
                                <Ionicons name="checkmark-circle-outline" size={18} color="#FFF" />
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </Animated.View>

            {/* ── Error Detail Sheet ────────────────────────────────────────────── */}
            <ErrorDetailSheet
                visible={sheetVisible}
                error={sheetError}
                isDismissed={sheetIsDismissed}
                onDismiss={() => {
                    if (sheetError && sheetSentenceIdx >= 0) {
                        onDismissWord(sheetError.word, sheetSentenceIdx);
                    }
                }}
                onClose={() => setSheetVisible(false)}
                accentColor={theme.primary}
                isDark={isDark}
                text={theme.text}
                subtle={theme.subtle}
                surface={theme.surface}
                border={theme.border}
                isAIMode={false}
            />
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    root: { flex: 1 },

    // ── Banner ─────────────────────────────────────────────────────────────────
    scoreBanner: {
        marginHorizontal: 16,
        marginTop: 14,
        borderRadius: 28,
        paddingHorizontal: 24,
        paddingVertical: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 18,
        elevation: 10,
    },
    bannerLabel: {
        color: 'rgba(255,255,255,0.72)',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 2,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    bannerPercent: {
        color: '#FFF',
        fontSize: 72,
        fontWeight: '800',
        letterSpacing: -3,
        lineHeight: 80,
    },
    bannerPct: {
        color: 'rgba(255,255,255,0.65)',
        fontSize: 28,
        fontWeight: '700',
        letterSpacing: -1,
    },
    bannerSub: {
        color: 'rgba(255,255,255,0.88)',
        fontSize: 15,
        fontWeight: '600',
        marginTop: 2,
        marginBottom: 10,
    },
    bannerMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    bannerMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    bannerMetaText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '500' },
    bannerMetaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.45)' },

    // ── Scroll ─────────────────────────────────────────────────────────────────
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 16, paddingTop: 20 },
    sectionLabel: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginBottom: 12,
    },

    // ── Sentence card ──────────────────────────────────────────────────────────
    card: {
        borderRadius: 20,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
        elevation: 3,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
    },
    numBadge: {
        width: 26,
        height: 26,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    numBadgeText: { fontSize: 12, fontWeight: '800' },
    cardLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
    accuracyPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        flexShrink: 0,
    },
    accuracyPillText: { fontSize: 11, fontWeight: '700' },
    divider: { height: 1, marginBottom: 12 },

    // ── Sentence text ──────────────────────────────────────────────────────────
    sentenceText: {
        fontSize: 18,
        fontWeight: '400',
        lineHeight: 30,
        letterSpacing: 0.1,
        marginBottom: 10,
        flexWrap: 'wrap',
    },

    // ── Status rows ────────────────────────────────────────────────────────────
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginBottom: 4,
    },
    statusText: { fontSize: 12, fontWeight: '500' },

    // ── Error chips ────────────────────────────────────────────────────────────
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 10,
        borderWidth: 1,
    },
    chipDot: { width: 6, height: 6, borderRadius: 3 },
    chipText: { fontSize: 12, fontWeight: '700' },

    // ── Footer ─────────────────────────────────────────────────────────────────
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 20,
        paddingTop: 14,
        borderTopWidth: 1,
        gap: 10,
    },
    reviewHint: { fontSize: 12, fontWeight: '400', textAlign: 'center' },
    actionRow: { flexDirection: 'row', gap: 10 },
    retryBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 17,
        borderRadius: 18,
        borderWidth: 1,
    },
    retryText: { fontSize: 15, fontWeight: '700', letterSpacing: -0.1 },
    finishBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 17,
        borderRadius: 18,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 8,
    },
    finishBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
});
