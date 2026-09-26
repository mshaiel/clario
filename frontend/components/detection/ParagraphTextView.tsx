/**
 * ParagraphTextView
 * Location: components/detection/ParagraphTextView.tsx
 *
 * Renders all assessment sentences as a single continuous paragraph.
 * The active sentence is fully lit; all others are muted gray.
 * Error words (after completion) are underlined in red/amber.
 * Tapping an error word opens the detail sheet.
 */

import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { FlaggedWord, Sentence } from '@/lib/types';
import { containsUrduScript } from '@/lib/textDirection';

// ─── Types (exported so ParagraphModeSession can use them) ────────────────────

export type SentencePhase = 'pending' | 'active' | 'recording' | 'analyzing' | 'done';

export interface SentenceState {
  phase: SentencePhase;
  errors: FlaggedWord[];
  dismissedWords: Set<string>;
  accuracy: number;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  sentences: Sentence[];
  sentenceStates: SentenceState[];
  activeSentenceIndex: number;
  onWordPress: (error: FlaggedWord) => void;
  onActiveSentencePress: (sentence: Sentence) => void;
  onSentenceLayout: (index: number, y: number) => void;
  isDark: boolean;
  isRTL?: boolean;
  theme: {
    text: string;
    subtle: string;
    surface: string;
    border: string;
    primary: string;
  };
}

// ─── Word helpers ─────────────────────────────────────────────────────────────

function cleanWord(raw: string): string {
  return raw.replace(/[.,/#!$%^&*;:{}=\-_`~()?!"']/g, '').toLowerCase();
}

function findError(word: string, errors: FlaggedWord[]): FlaggedWord | undefined {
  const clean = cleanWord(word);
  return errors.find((e) => e.word.toLowerCase() === clean);
}

function getErrorColor(error: FlaggedWord): string {
  return error.error_category === 'fluency' ? '#F87171' : '#FBBF24';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ParagraphTextView({
  sentences,
  sentenceStates,
  activeSentenceIndex,
  onWordPress,
  onActiveSentencePress,
  onSentenceLayout,
  isDark,
  isRTL: isRTLProp,
  theme,
}: Props) {
  const isRTL = isRTLProp ?? sentences.some((sentence) => containsUrduScript(sentence.text));
  // Muted color for non-active text — consistent regardless of theme
  const dimColor = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
  const doneColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';

  return (
    <View style={styles.root}>
      {/*
        One single <Text> parent so all sentences wrap as real prose.
        Each sentence's words are inline children — no block-level wrappers.
        We use onLayout on invisible zero-height markers to track scroll positions.
      */}
      <Text style={[styles.prose, { writingDirection: isRTL ? 'rtl' : 'ltr', textAlign: isRTL ? 'right' : 'left' }] }>
        {sentences.map((sentence, sentenceIdx) => {
          const state = sentenceStates[sentenceIdx];
          if (!state) return null;

          const isActive = sentenceIdx === activeSentenceIndex;
          const isDone = state.phase === 'done';
          const isAnalyzing = state.phase === 'analyzing';
          const isPending = state.phase === 'pending';

          const rawWords = sentence.text.split(' ');

          // ── Per-sentence layout tracker (zero-size inline anchor) ────────
          const layoutAnchor = (
            <Text
              key={`anchor-${sentenceIdx}`}
              onLayout={(e) => onSentenceLayout(sentenceIdx, e.nativeEvent.layout.y)}
              style={styles.layoutAnchor}
            >
              {''}
            </Text>
          );

          // ── Words ────────────────────────────────────────────────────────
          const wordNodes = rawWords.map((rawWord, wordIdx) => {
            const isLastWord = wordIdx === rawWords.length - 1;
            const trailingSpace = isLastWord ? ' ' : ' '; // always a space between words

            // Error state (only after sentence is done)
            const error = isDone ? findError(rawWord, state.errors) : undefined;
            const isDismissed = error ? state.dismissedWords.has(error.word) : false;
            const hasError = !!error && !isDismissed;

            if (hasError) {
              const errColor = getErrorColor(error!);
              return (
                <Text
                  key={wordIdx}
                  onPress={() => onWordPress(error!)}
                  style={[
                    styles.errorWord,
                    {
                      color: errColor,
                      textDecorationColor: errColor,
                    },
                  ]}
                >
                  {rawWord}{trailingSpace}
                </Text>
              );
            }

            if (isDismissed) {
              return (
                <Text
                  key={wordIdx}
                  style={[styles.dismissedWord, { color: doneColor }]}
                >
                  {rawWord}{trailingSpace}
                </Text>
              );
            }

            // Regular word — color depends on sentence phase
            const wordColor = isActive || isAnalyzing
              ? theme.text                // fully lit for current sentence
              : isDone
                ? doneColor                 // slightly dimmed for completed sentences
                : dimColor;                 // very dim for upcoming sentences

            const wordWeight: any = isActive ? '500' : '400';

            return (
              <Text
                key={wordIdx}
                style={{ color: wordColor, fontWeight: wordWeight, writingDirection: isRTL ? 'rtl' : 'ltr' }}
              >
                {rawWord}{trailingSpace}
              </Text>
            );
          });

          // Sentence separator — single space between sentences (no newline)
          // For the last sentence, no separator needed
          const separator = sentenceIdx < sentences.length - 1
            ? <Text key={`sep-${sentenceIdx}`} style={{ color: dimColor }}>{''}</Text>
            : null;

          return (
            <React.Fragment key={sentenceIdx}>
              {layoutAnchor}
              {isActive && !isDone ? (
                <Text
                  onPress={() => onActiveSentencePress(sentence)}
                  style={[
                    styles.activeSentenceBubble,
                    {
                      backgroundColor: theme.primary + '1A',
                    },
                  ]}
                >
                  {wordNodes}
                  <Text style={styles.iconGap}>  </Text>
                  <Ionicons name="volume-medium" size={18} color={theme.primary} />
                </Text>
              ) : (
                wordNodes
              )}
              {separator}
            </React.Fragment>
          );
        })}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    paddingVertical: 4,
  },

  prose: {
    fontSize: 24,
    fontWeight: '400',
    lineHeight: 40,
    letterSpacing: 0.15,
  },

  layoutAnchor: {
    fontSize: 0,
    lineHeight: 0,
    height: 0,
    width: 0,
  },

  activeSentenceBubble: {
    paddingHorizontal: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },

  iconGap: {
    fontSize: 10,
  },

  errorWord: {
    fontWeight: '600',
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
  },

  dismissedWord: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
});