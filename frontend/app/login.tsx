import { BrandWaveform } from '@/components/ui/BrandWaveform';
import { haptics } from '@/lib/haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { auth } from '../firebase';
import { useAppTheme } from '../theme-provider';

export default function LoginScreen() {
  const router = useRouter();
  const { resolvedTheme } = useAppTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const fadeUp = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeUp, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, tension: 70, friction: 14, useNativeDriver: true }),
    ]).start();
  }, []);

  const validateInputs = () => {
    const issues: string[] = [];
    if (touched.email && !email.includes('@')) issues.push('Invalid email format');
    if (touched.password && password.length < 6) issues.push('Password must be at least 6 characters');
    return issues;
  };

  useEffect(() => { setErrors(validateInputs()); }, [email, password, touched]);

  const getReadableError = (code: string) => {
    switch (code) {
      case 'auth/invalid-email': return 'The email address is not valid.';
      case 'auth/missing-password': return 'Please enter your password.';
      case 'auth/invalid-credential': return 'Incorrect email or password.';
      case 'auth/user-not-found': return 'No account found with this email.';
      case 'auth/wrong-password': return 'Incorrect password. Please try again.';
      case 'auth/too-many-requests': return 'Too many attempts. Try again later.';
      default: return 'Sign in failed. Please try again.';
    }
  };

  const handleLogin = async () => {
    setTouched({ email: true, password: true });
    const issues = validateInputs();
    if (issues.length > 0) { setErrors(issues); return; }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setErrors([]);
      haptics.success();
    } catch (error: any) {
      setErrors([getReadableError(error.code || '')]);
      haptics.error();
    } finally {
      setLoading(false);
    }
  };

  const isDark = resolvedTheme.dark;
  const PRIMARY = resolvedTheme.colors.primary;
  const bg       = isDark ? '#0C0F14' : '#F8FAFB';
  const surface  = isDark ? '#161B24' : '#FFFFFF';
  const inputBg  = isDark ? '#1E2530' : '#F1F4F6';
  const border   = isDark ? '#252D3A' : '#E5EAED';
  const subtle   = isDark ? '#7A8FA3' : '#8D9FAE';
  const text     = resolvedTheme.colors.text;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Animated.View style={{ opacity: fadeUp, transform: [{ translateY: slide }] }}>

            {/* ── BRAND BLOCK ─────────────────────────── */}
            <View style={styles.brand}>
              {/* Logo: two overlapping pill shapes — unique Clario identity */}
              <View style={styles.logoWrap}>
                <View style={[styles.pillL, { backgroundColor: PRIMARY }]} />
                <View style={[styles.pillR, { backgroundColor: PRIMARY, opacity: 0.38 }]} />
              </View>

              <Text style={[styles.wordmark, { color: text }]}>clario</Text>

              {/* Waveform signature — audio identity of the app */}
              <BrandWaveform size="md" />
            </View>

            {/* ── PAGE TITLE ──────────────────────────── */}
            <View style={styles.titleBlock}>
              <Text style={[styles.title, { color: text }]}>Sign in</Text>
              <Text style={[styles.subtitle, { color: subtle }]}>
                Good to have you back
              </Text>
            </View>

            {/* ── ERROR ───────────────────────────────── */}
            {errors.length > 0 && (
              <View style={[styles.errorBanner, { backgroundColor: isDark ? '#1F1010' : '#FFF3F3', borderColor: '#E5353515' }]}>
                <Ionicons name="alert-circle-outline" size={15} color="#E53935" />
                <Text style={styles.errorMsg}>{errors[0]}</Text>
              </View>
            )}

            {/* ── INPUT GROUP ─────────────────────────── */}
            {/* Grouped card — both inputs share one surface, separated by a line.
                This is the cleanest pattern used by Apple, Notion, Linear etc. */}
            <View style={[styles.inputCard, { backgroundColor: surface, borderColor: border }]}>

              {/* Email row */}
              <View style={[
                styles.inputRow,
                styles.inputRowTop,
                emailFocused && { borderColor: PRIMARY },
                { backgroundColor: inputBg },
              ]}>
                <Ionicons name="mail-outline" size={16} color={emailFocused ? PRIMARY : subtle} style={styles.icoL} />
                <TextInput
                  style={[styles.inputField, { color: text }]}
                  placeholder="Email"
                  placeholderTextColor={subtle}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => { setEmailFocused(false); setTouched(t => ({ ...t, email: true })); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                />
              </View>

              {/* Divider between inputs */}
              <View style={[styles.divider, { backgroundColor: border }]} />

              {/* Password row */}
              <View style={[
                styles.inputRow,
                styles.inputRowBottom,
                passwordFocused && { borderColor: PRIMARY },
                { backgroundColor: inputBg },
              ]}>
                <Ionicons name="lock-closed-outline" size={16} color={passwordFocused ? PRIMARY : subtle} style={styles.icoL} />
                <TextInput
                  style={[styles.inputField, { color: text }]}
                  placeholder="Password"
                  placeholderTextColor={subtle}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => { setPasswordFocused(false); setTouched(t => ({ ...t, password: true })); }}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity onPress={() => setShowPassword(s => !s)} style={styles.icoR}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={16} color={subtle} />
                </TouchableOpacity>
              </View>

            </View>

            {/* Forgot password — right-aligned, understated */}
            <TouchableOpacity onPress={() => router.push('/forgot-password')} style={styles.forgotWrap}>
              <Text style={[styles.forgotText, { color: PRIMARY }]}>Forgot password?</Text>
            </TouchableOpacity>

            {/* ── PRIMARY CTA ─────────────────────────── */}
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: PRIMARY }, loading && styles.ctaLoading]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.84}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.ctaLabel}>Sign In</Text>
              }
            </TouchableOpacity>

            {/* ── FOOTER LINK ─────────────────────────── */}
            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: subtle }]}>New to Clario? </Text>
              <TouchableOpacity onPress={() => router.replace('/signup')}>
                <Text style={[styles.footerLink, { color: PRIMARY }]}>Create account</Text>
              </TouchableOpacity>
            </View>

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1 },
  flex:  { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },

  // Brand
  brand: { alignItems: 'center', marginBottom: 44 },
  logoWrap: {
    width: 48,
    height: 28,
    marginBottom: 18,
    position: 'relative',
  },
  pillL: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 32,
    height: 28,
    borderRadius: 14,
  },
  pillR: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 32,
    height: 28,
    borderRadius: 14,
  },
  wordmark: {
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: -2,
    marginBottom: 14,
  },


  // Title
  titleBlock: { marginBottom: 24 },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '400',
  },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  errorMsg: {
    color: '#E53935',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },

  // Inputs
  inputCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 54,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inputRowTop: {
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
  },
  inputRowBottom: {
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
  },
  icoL: { marginRight: 12 },
  icoR: { padding: 4 },
  inputField: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
  },
  divider: { height: 1 },

  // Forgot
  forgotWrap: { alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 28 },
  forgotText: { fontSize: 14, fontWeight: '500' },

  // CTA
  cta: {
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  ctaLoading: { opacity: 0.7 },
  ctaLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  // Footer
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, fontWeight: '600' },
});
