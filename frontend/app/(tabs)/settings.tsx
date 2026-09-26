// app/(tabs)/settings.tsx
// Premium redesign — matches auth/techniques/dashboard design language
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import {
  deleteUser,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  User
} from 'firebase/auth';
import React, { useState, useRef, useEffect, useContext } from 'react';
import {
  Alert,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  Pressable,
  View,
  ScrollView,
  Animated as RNAnimated,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { auth } from '@/firebase';
import { useAppTheme } from '@/theme-provider';
import { useLanguage } from '@/context/LanguageContext';
import { useOnboardingActions } from '@/context/OnboardingContext';
import { DownloadContext } from '@/context/DownloadContext';
import LoadingScreen from '@/app/loading';
import { BrandWaveform } from '@/components/ui/BrandWaveform';
import { GradientGlow } from '@/components/ui/GradientGlow';
import { haptics } from '@/lib/haptics';

// ─── Section wrapper ───────────────────────────────────────────────────────────────────────
function Section({
  title,
  children,
  surface,
  border,
  subtle,
  danger = false,
}: {
  title: string;
  children: React.ReactNode;
  surface: string;
  border: string;
  subtle: string;
  danger?: boolean;
}) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={[sectionStyles.label, { color: danger ? '#E53935' : subtle }]}>
        {title.toUpperCase()}
      </Text>
      <View style={[sectionStyles.card, { backgroundColor: surface, borderColor: danger ? '#E5393520' : border }]}>
        {children}
      </View>
    </View>
  );
}
const sectionStyles = StyleSheet.create({
  wrap: { marginBottom: 28 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
});

// ─── Row: tappable ────────────────────────────────────────────────────────────
function SettingRow({
  icon,
  label,
  sublabel,
  onPress,
  danger = false,
  showChevron = true,
  rightSlot,
  iconBg,
  iconColor,
  isLast = false,
  border,
  textColor,
  subtleColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  onPress?: () => void;
  danger?: boolean;
  showChevron?: boolean;
  rightSlot?: React.ReactNode;
  iconBg: string;
  iconColor: string;
  isLast?: boolean;
  border: string;
  textColor: string;
  subtleColor: string;
}) {
  const finalLabelColor = danger ? '#E53935' : textColor;
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (onPress) scale.value = withSpring(0.97, { damping: 15, stiffness: 300 });
  };
  const handlePressOut = () => {
    if (onPress) scale.value = withSpring(1, { damping: 15, stiffness: 300 });
  };

  return (
    <>
      <Animated.View style={animatedStyle}>
        <Pressable
          style={rowStyles.row}
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          {/* Icon box */}
          <View style={[rowStyles.iconBox, { backgroundColor: iconBg }]}>
            <Ionicons name={icon} size={18} color={iconColor} />
          </View>

          {/* Labels */}
          <View style={rowStyles.textWrap}>
            <Text style={[rowStyles.label, { color: finalLabelColor }]}>
              {label}
            </Text>
            {sublabel ? (
              <Text style={[rowStyles.sublabel, { color: subtleColor }]}>{sublabel}</Text>
            ) : null}
          </View>

          {/* Right slot or chevron */}
          {rightSlot ?? (
            showChevron && onPress ? (
              <Ionicons name="chevron-forward" size={15} color="#C0CACF" />
            ) : null
          )}
        </Pressable>
      </Animated.View>
      {!isLast && <View style={[rowStyles.divider, { backgroundColor: border }]} />}
    </>
  );
}
const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 14,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: { flex: 1 },
  label: {
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  sublabel: {
    fontSize: 12,
    marginTop: 1,
    fontWeight: '400',
  },
  divider: {
    height: 1,
    marginLeft: 66,
  },
});

// ─── Language Segment Button ──────────────────────────────────────────────────
function LanguageSegmentButton({
  lang,
  active,
  onPress,
  subtle,
  PRIMARY
}: {
  lang: 'english' | 'urdu';
  active: boolean;
  onPress: () => void;
  subtle: string;
  PRIMARY: string;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={{ flex: 1 }}>
      <Pressable
        style={[
          styles.segBtn,
          active && { backgroundColor: PRIMARY },
        ]}
        onPress={onPress}
        onPressIn={() => scale.value = withSpring(0.96, { damping: 15, stiffness: 300 })}
        onPressOut={() => scale.value = withSpring(1, { damping: 15, stiffness: 300 })}
      >
        <Animated.Text style={[styles.segText, { color: active ? '#FFF' : subtle }, animStyle]}>
          {lang === 'english' ? 'English' : 'اردو'}
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const { resolvedTheme, themeName, setThemeName } = useAppTheme();
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const { resetProfile, resetForLanguageChange } = useOnboardingActions();
  const downloadContext = useContext(DownloadContext);

  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return unsub;
  }, []);

  const [notifications, setNotifications] = useState(true);
  const [isSwitchingLanguage, setIsSwitchingLanguage] = useState(false);
  const [devExpanded, setDevExpanded] = useState(false);
  const devAnim = useRef(new RNAnimated.Value(0)).current;

  const toggleDev = () => {
    const toValue = devExpanded ? 0 : 1;
    setDevExpanded(!devExpanded);
    RNAnimated.spring(devAnim, { toValue, tension: 70, friction: 14, useNativeDriver: false }).start();
  };

  const devHeight = devAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 52] });
  const devOpacity = devAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  // Entrance animation
  const fadeAnim  = useRef(new RNAnimated.Value(0)).current;
  const slideAnim = useRef(new RNAnimated.Value(14)).current;

  useEffect(() => {
    RNAnimated.parallel([
      RNAnimated.timing(fadeAnim,  { toValue: 1, duration: 420, useNativeDriver: true }),
      RNAnimated.spring(slideAnim, { toValue: 0, tension: 70, friction: 14, useNativeDriver: true }),
    ]).start();
  }, []);

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#0C0F14' : '#F2F5F9';
  const surface = isDark ? '#1A2030' : '#FFFFFF';
  const border  = isDark ? '#2A3448' : '#D1D8E2';
  const subtle  = isDark ? '#7A8FA3' : '#59677A';
  const text    = resolvedTheme.colors.text;

  // Derived initials for avatar
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'U';
  const initials = displayName.slice(0, 2).toUpperCase();
  const firstName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

  const handleThemeToggle = async (val: boolean) => {
    haptics.selection();
    await setThemeName(val ? 'dark' : 'light');
  };

  const handleLogout = () => {
    haptics.warning();
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOut(auth);
          // Do NOT navigate manually — the root _layout.tsx onAuthStateChanged
          // listener sets user=null and issues <Redirect href="/login"> automatically.
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    haptics.heavy();
    Alert.alert(
      'Delete Account',
      'This will permanently delete all your data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (user) await deleteUser(user);
              // Do NOT navigate manually — root _layout.tsx will redirect once
              // onAuthStateChanged fires with user=null.
            } catch {
              Alert.alert('Error', 'Please sign out and sign back in, then try again.');
            }
          },
        },
      ]
    );
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      Alert.alert('Email sent', `A reset link was sent to ${user.email}`);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  /**
   * handleLanguageChange
   *
   * Shows the Clario loading overlay, performs the switch, then navigates.
   * For an already-completed language  → router.replace('/(tabs)')
   * For a new/incomplete language      → router.replace('/onboarding/triage')
   *   (we skip language/sound-check/persona — those steps are already done)
   */
  const handleLanguageChange = (lang: 'english' | 'urdu') => {
    if (language === lang) return;
    haptics.selection();
    const label = lang === 'urdu' ? 'Urdu' : 'English';
    Alert.alert(
      `Switch to ${label}?`,
      `Your app will switch to ${label} mode.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            setIsSwitchingLanguage(true);
            try {
              // Small delay so the overlay paints before heavy async work
              await new Promise((r) => setTimeout(r, 120));
              await setLanguage(lang);
              const { needsQuestionnaire } = await resetForLanguageChange(lang);
              setIsSwitchingLanguage(false);
              // Do NOT navigate manually here. The root _layout.tsx routing
              // effect watches profile.completed and onboardingStep — it will
              // fire router.replace to the correct screen as soon as
              // resetForLanguageChange updates the context state.
              // A second router.replace from here causes the triage screen to
              // mount twice (double-flash).
              if (!needsQuestionnaire) {
                // Already completed this language — root layout sends to tabs,
                // but we can help it along since completed=true means the effect
                // sets target=null (already on tabs). We navigate explicitly only
                // for the "no questionnaire" path because completed stays true and
                // segments still shows (tabs) so the effect is a no-op.
                router.replace('/(tabs)');
              }
              // needsQuestionnaire=true: root layout handles it via the effect.
            } catch (e) {
              // On any error, dismiss the overlay so settings isn't stuck
              setIsSwitchingLanguage(false);
            }
          },
        },
      ]
    );
  };

  const handleResetOnboarding = () => {
    haptics.warning();
    Alert.alert(
      'Reset Speech Profile',
      'This will clear your current speech profile and restart onboarding so you can reconfigure your plan. Your account and any saved progress are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Profile',
          style: 'destructive',
          onPress: async () => {
            if (downloadContext) {
              await downloadContext.clearAllCachedModules();
            }
            await resetProfile();
            router.replace('/onboarding');
          },
        },
      ]
    );
  };

  const handleDebugReset = () => {
    Alert.alert('Reset All Data', 'This wipes both English and Urdu profiles.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset Everything',
        style: 'destructive',
        onPress: async () => {
          // Clear the download cache so modules don't appear cached after reset
          if (downloadContext) {
            await downloadContext.clearAllCachedModules();
          }
          await resetProfile();
          router.replace('/onboarding');
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <GradientGlow color={PRIMARY} isDark={isDark} />
      
      {/* Language-switch loading overlay — renders on top of everything */}
      {isSwitchingLanguage && (
        <View style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: bg, zIndex: 999 },
        ]}>
          <LoadingScreen />
        </View>
      )}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <RNAnimated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

          {/* ── PAGE HEADER ──────────────────────────── */}
          <View style={styles.pageHeader}>
            <View>
              <Text style={[styles.pageTitle, { color: PRIMARY }]}>Settings</Text>
              <Text style={[styles.pageSubtitle, { color: subtle }]}>
                Manage your account & preferences
              </Text>
            </View>
            {/* Waveform identity mark */}
            <BrandWaveform size="sm" />
          </View>

          {/* ── PROFILE CARD ──────────────────────────── */}
          <View style={[styles.profileCard, { backgroundColor: surface, borderColor: border }]}>
            {/* Background waveform texture */}
            <View style={styles.profileWaveOverlay} pointerEvents="none">
              {[0.3, 0.5, 0.7, 0.9, 1, 0.85, 0.65, 0.45, 0.7, 0.5, 0.35, 0.6].map((h, i) => (
                <View key={i} style={[styles.profileWaveBar, {
                  height: 48 * h,
                  backgroundColor: PRIMARY,
                  opacity: isDark ? 0.04 + h * 0.04 : 0.03 + h * 0.03,
                }]} />
              ))}
            </View>

            <View style={styles.profileInner}>
              {/* Initials avatar */}
              <View style={[styles.avatar, { backgroundColor: PRIMARY + '15', borderColor: PRIMARY + '30' }]}>
                <Text style={[styles.avatarText, { color: PRIMARY }]}>{initials}</Text>
              </View>

              <View style={styles.profileText}>
                <Text style={[styles.profileName, { color: text }]}>{firstName}</Text>
                <Text style={[styles.profileEmail, { color: subtle }]} numberOfLines={1}>
                  {user?.email || 'Not signed in'}
                </Text>
              </View>

              {/* Active language badge */}
              <View style={[styles.langBadge, { backgroundColor: isDark ? '#242E3C' : '#EEF1F5', borderColor: isDark ? '#2A3648' : '#E1E5EA' }]}>
                <Text style={[styles.langBadgeText, { color: subtle }]}>
                  {language === 'urdu' ? 'اردو' : 'EN'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── LANGUAGE ──────────────────────────────── */}
          <Section title="Language" surface={surface} border={border} subtle={subtle}>
            <View style={styles.segmentWrap}>
              <View style={[styles.segment, { backgroundColor: isDark ? '#1E2530' : '#EEF1F5' }]}>
                {(['english', 'urdu'] as const).map((lang) => (
                  <LanguageSegmentButton
                    key={lang}
                    lang={lang}
                    active={language === lang}
                    onPress={() => handleLanguageChange(lang)}
                    subtle={subtle}
                    PRIMARY={PRIMARY}
                  />
                ))}
              </View>
              <Text style={[styles.segHint, { color: subtle }]}>
                Switching language will update your speech plan.
              </Text>
            </View>
          </Section>

          {/* ── APPEARANCE ────────────────────────────── */}
          <Section title="Appearance" surface={surface} border={border} subtle={subtle}>
            <SettingRow
              icon="moon-outline"
              label="Dark Mode"
              iconBg={isDark ? '#1E2530' : '#F0F2F5'}
              iconColor={PRIMARY}
              border={border}
              textColor={text}
              subtleColor={subtle}
              showChevron={false}
              isLast
              rightSlot={
                <Switch
                  value={isDark}
                  onValueChange={handleThemeToggle}
                  trackColor={{ false: isDark ? '#2A3344' : '#E0E6EA', true: PRIMARY }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={isDark ? '#2A3344' : '#E0E6EA'}
                />
              }
            />
          </Section>

          {/* ── NOTIFICATIONS ─────────────────────────── */}
          <Section title="Notifications" surface={surface} border={border} subtle={subtle}>
            <SettingRow
              icon="notifications-outline"
              label="Practice Reminders"
              sublabel="Daily nudges to keep your streak"
              iconBg={isDark ? '#1E2530' : '#F0F2F5'}
              iconColor={PRIMARY}
              border={border}
              textColor={text}
              subtleColor={subtle}
              showChevron={false}
              isLast
              rightSlot={
                <Switch
                  value={notifications}
                  onValueChange={setNotifications}
                  trackColor={{ false: isDark ? '#2A3344' : '#E0E6EA', true: PRIMARY }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor={isDark ? '#2A3344' : '#E0E6EA'}
                />
              }
            />
          </Section>

          {/* ── ACCOUNT ───────────────────────────────── */}
          <Section title="Account" surface={surface} border={border} subtle={subtle}>
            <SettingRow
              icon="lock-closed-outline"
              label="Reset Password"
              sublabel="Send a reset link to your email"
              iconBg={isDark ? '#1E2530' : '#F0F2F5'}
              iconColor={PRIMARY}
              border={border}
              textColor={text}
              subtleColor={subtle}
              onPress={handleResetPassword}
            />
            <SettingRow
              icon="refresh-circle-outline"
              label="Reset Speech Profile"
              sublabel="Redo onboarding to update your speech plan"
              iconBg={isDark ? '#1E2530' : '#F0F2F5'}
              iconColor={PRIMARY}
              border={border}
              textColor={text}
              subtleColor={subtle}
              onPress={handleResetOnboarding}
            />
            <SettingRow
              icon="log-out-outline"
              label="Sign Out"
              iconBg={isDark ? '#1E2530' : '#F0F2F5'}
              iconColor="#FF6B00"
              border={border}
              textColor={text}
              subtleColor={subtle}
              onPress={handleLogout}
              isLast
            />
          </Section>

          {/* ── DANGER ZONE ───────────────────────────── */}
          <Section title="Danger Zone" surface={surface} border={border} subtle={subtle} danger>
            <SettingRow
              icon="trash-outline"
              label="Delete Account"
              sublabel="Permanently remove all your data"
              iconBg="#E5393510"
              iconColor="#E53935"
              border={border}
              textColor={text}
              subtleColor={subtle}
              danger
              onPress={handleDeleteAccount}
              isLast
            />
          </Section>

          {/* ── DEV TOOLS ─────────────────────────────── */}
          <View style={[styles.devCard, { backgroundColor: isDark ? '#141824' : '#FEFCE8', borderColor: '#F59E0B30' }]}>
            <TouchableOpacity style={styles.devRow} onPress={toggleDev} activeOpacity={0.7}>
              <Ionicons name="construct-outline" size={16} color="#F59E0B" />
              <Text style={styles.devLabel}>Developer Tools</Text>
              <Ionicons name={devExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#F59E0B" />
            </TouchableOpacity>

            <RNAnimated.View style={{ height: devHeight, opacity: devOpacity, overflow: 'hidden' }}>
              <View style={[styles.devDivider, { backgroundColor: '#F59E0B20' }]} />
              <TouchableOpacity style={styles.devAction} onPress={handleDebugReset} activeOpacity={0.7}>
                <Ionicons name="refresh-outline" size={14} color="#F59E0B" />
                <Text style={styles.devActionLabel}>Reset All Onboarding Data</Text>
              </TouchableOpacity>
            </RNAnimated.View>
          </View>

          <View style={{ height: 40 }} />

        </RNAnimated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 20,
  },

  // Page header
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginBottom: 3,
  },
  pageSubtitle: {
    fontSize: 13,
    fontWeight: '400',
  },


  // Profile card
  profileCard: {
    borderRadius: 26,
    borderWidth: 1,
    marginBottom: 28,
    overflow: 'hidden',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  profileWaveOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 52,
    gap: 2,
  },
  profileWaveBar: {
    flex: 1,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  profileInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  profileText: { flex: 1 },
  profileName: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  profileEmail: {
    fontSize: 13,
    fontWeight: '400',
  },
  langBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  langBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Language segment
  segmentWrap: {
    padding: 18,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    gap: 4,
    marginBottom: 10,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  segText: {
    fontSize: 14,
    fontWeight: '600',
  },
  segHint: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '400',
  },

  // Dev tools
  devCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 8,
  },
  devRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 10,
  },
  devLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#F59E0B',
  },
  devDivider: {
    height: 1,
    marginHorizontal: 0,
  },
  devAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 10,
  },
  devActionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#F59E0B',
    opacity: 0.85,
  },
});
