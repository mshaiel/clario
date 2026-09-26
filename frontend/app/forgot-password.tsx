
// app/forgot-password.tsx
import { useRouter } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../firebase';
import { useAppTheme } from '../theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BrandWaveform } from '@/components/ui/BrandWaveform';
import { haptics } from '@/lib/haptics';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { resolvedTheme } = useAppTheme();

  const [email, setEmail]         = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [sent, setSent]           = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  const fadeUp     = useRef(new Animated.Value(0)).current;
  const slide      = useRef(new Animated.Value(20)).current;
  const successScale = useRef(new Animated.Value(0.88)).current;
  const successFade  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeUp, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, tension: 70, friction: 14, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleSubmit = async () => {
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    if (!email.includes('@')) { setError('Please enter a valid email address.'); return; }
    setLoading(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
      haptics.success();
      Animated.parallel([
        Animated.timing(successFade, { toValue: 1, duration: 360, useNativeDriver: true }),
        Animated.spring(successScale, { toValue: 1, tension: 65, friction: 12, useNativeDriver: true }),
      ]).start();
    } catch (err: any) {
      let msg = 'Something went wrong. Please try again.';
      if (err.code === 'auth/invalid-email') msg = 'Invalid email address.';
      if (err.code === 'auth/user-not-found') msg = 'No account found with this email.';
      haptics.warning();
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const isDark  = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg      = isDark ? '#0C0F14' : '#F8FAFB';
  const surface = isDark ? '#161B24' : '#FFFFFF';
  const inputBg = isDark ? '#1E2530' : '#F1F4F6';
  const border  = isDark ? '#252D3A' : '#E5EAED';
  const subtle  = isDark ? '#7A8FA3' : '#8D9FAE';
  const text    = resolvedTheme.colors.text;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Back button — top left, clean */}
        <TouchableOpacity
          onPress={() => router.push('/login')}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={text} />
        </TouchableOpacity>

        <View style={styles.container}>
          <Animated.View style={{ opacity: fadeUp, transform: [{ translateY: slide }] }}>

            {/* ── BRAND ───────────────────────────────── */}
            <View style={styles.brand}>
              <View style={styles.logoWrap}>
                <View style={[styles.pillL, { backgroundColor: PRIMARY }]} />
                <View style={[styles.pillR, { backgroundColor: PRIMARY, opacity: 0.38 }]} />
              </View>
              <Text style={[styles.wordmark, { color: text }]}>clario</Text>
              <BrandWaveform size="md" />
            </View>

            {sent ? (
              /* ── SUCCESS STATE ───────────────────────── */
              <Animated.View style={[styles.successBox, {
                opacity: successFade,
                transform: [{ scale: successScale }],
              }]}>
                {/* Clean check circle */}
                <View style={[styles.successIcon, { backgroundColor: PRIMARY + '18', borderColor: PRIMARY + '30' }]}>
                  <Ionicons name="checkmark" size={32} color={PRIMARY} />
                </View>

                <Text style={[styles.title, { color: text, textAlign: 'center' }]}>Check your inbox</Text>
                <Text style={[styles.successBody, { color: subtle }]}>
                  We sent a reset link to{'\n'}
                  <Text style={[styles.emailHighlight, { color: text }]}>{email}</Text>
                </Text>

                <TouchableOpacity
                  style={[styles.cta, { backgroundColor: PRIMARY }]}
                  onPress={() => router.push('/login')}
                  activeOpacity={0.84}
                >
                  <Text style={styles.ctaLabel}>Back to Sign In</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { setSent(false); setEmail(''); successFade.setValue(0); successScale.setValue(0.88); }}
                  style={styles.retryWrap}
                >
                  <Text style={[styles.retryText, { color: subtle }]}>Try a different email</Text>
                </TouchableOpacity>
              </Animated.View>
            ) : (
              /* ── FORM STATE ─────────────────────────── */
              <>
                <View style={styles.titleBlock}>
                  <Text style={[styles.title, { color: text }]}>Forgot password?</Text>
                  <Text style={[styles.subtitle, { color: subtle }]}>
                    Enter your email and we'll send you a link to reset it.
                  </Text>
                </View>

                {error ? (
                  <View style={[styles.errorBanner, { backgroundColor: isDark ? '#1F1010' : '#FFF3F3', borderColor: '#E5353515' }]}>
                    <Ionicons name="alert-circle-outline" size={15} color="#E53935" />
                    <Text style={styles.errorMsg}>{error}</Text>
                  </View>
                ) : null}

                {/* Email input */}
                <View style={[styles.inputCard, { backgroundColor: surface, borderColor: border }]}>
                  <View style={[styles.inputRow, { backgroundColor: inputBg }, emailFocused && { borderColor: PRIMARY }]}>
                    <Ionicons name="mail-outline" size={16} color={emailFocused ? PRIMARY : subtle} style={styles.icoL} />
                    <TextInput
                      style={[styles.inputField, { color: text }]}
                      placeholder="Email address"
                      placeholderTextColor={subtle}
                      value={email}
                      onChangeText={(v) => { setEmail(v); setError(''); }}
                      onFocus={() => setEmailFocused(true)}
                      onBlur={() => setEmailFocused(false)}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                      autoFocus
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.cta, { backgroundColor: PRIMARY }, loading && styles.ctaLoading]}
                  onPress={handleSubmit}
                  disabled={loading}
                  activeOpacity={0.84}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.ctaLabel}>Send Reset Link</Text>
                  }
                </TouchableOpacity>

                <View style={styles.footer}>
                  <Text style={[styles.footerText, { color: subtle }]}>Remember it? </Text>
                  <TouchableOpacity onPress={() => router.push('/login')}>
                    <Text style={[styles.footerLink, { color: PRIMARY }]}>Sign in</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

          </Animated.View>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1 },
  flex:      { flex: 1 },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 20,
  },

  backBtn: {
    position: 'absolute',
    top: 12,
    left: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  brand: { alignItems: 'center', marginBottom: 44 },
  logoWrap: { width: 48, height: 28, marginBottom: 18, position: 'relative' },
  pillL: { position: 'absolute', left: 0, top: 0, width: 32, height: 28, borderRadius: 14 },
  pillR: { position: 'absolute', right: 0, top: 0, width: 32, height: 28, borderRadius: 14 },
  wordmark: { fontSize: 40, fontWeight: '700', letterSpacing: -2, marginBottom: 14 },


  titleBlock: { marginBottom: 22 },
  title:    { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 15, fontWeight: '400', lineHeight: 22 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1, marginBottom: 14,
  },
  errorMsg: { color: '#E53935', fontSize: 13, fontWeight: '500', flex: 1 },

  inputCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 16 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    height: 54, paddingHorizontal: 16,
    borderWidth: 2, borderColor: 'transparent',
    borderRadius: 15, // Added to perfectly align border outline with curved card
  },
  icoL: { marginRight: 12 },
  inputField: { flex: 1, fontSize: 16, fontWeight: '400' },

  cta: {
    height: 56, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  ctaLoading: { opacity: 0.7 },
  ctaLabel: { color: '#fff', fontSize: 17, fontWeight: '600', letterSpacing: 0.1 },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, fontWeight: '600' },

  // Success
  successBox: { alignItems: 'center' },
  successIcon: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, marginBottom: 28,
  },
  successBody: {
    fontSize: 15, textAlign: 'center',
    lineHeight: 24, marginTop: 10, marginBottom: 36,
  },
  emailHighlight: { fontWeight: '600' },
  retryWrap: { marginTop: 16 },
  retryText: { fontSize: 13, fontWeight: '500', textDecorationLine: 'underline' },
});
