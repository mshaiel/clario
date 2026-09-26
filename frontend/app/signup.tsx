import { auth, db } from '@/firebase';
import { useAppTheme } from '@/theme-provider';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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
import { BrandWaveform } from '@/components/ui/BrandWaveform';
import { haptics } from '@/lib/haptics';

const STRENGTH_COLORS = ['', '#E53935', '#FB8C00', '#43A047', '#00897B'];
const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

export default function SignupScreen() {
  const router = useRouter();
  const { resolvedTheme } = useAppTheme();

  const [fullName, setFullName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [showConf, setShowConf]   = useState(false);
  const [touched, setTouched]     = useState({ fullName: false, email: false, password: false, confirm: false });
  const [errors, setErrors]       = useState<string[]>([]);
  const [loading, setLoading]     = useState(false);
  const [fullNameFocused, setFullNameFocused] = useState(false);
  const [emailFocused, setEmailFocused]       = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmFocused, setConfirmFocused]   = useState(false);

  const fadeUp = useRef(new Animated.Value(0)).current;
  const slide  = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeUp, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slide, { toValue: 0, tension: 70, friction: 14, useNativeDriver: true }),
    ]).start();
  }, []);

  const validateInputs = () => {
    const issues: string[] = [];
    if (touched.fullName && fullName.trim().length < 2) issues.push('Please enter your full name');
    if (touched.email && !email.includes('@')) issues.push('Invalid email format');
    if (touched.password && password.length < 6) issues.push('Password must be at least 6 characters');
    if (touched.confirm && password !== confirm) issues.push('Passwords do not match');
    return issues;
  };

  useEffect(() => { setErrors(validateInputs()); }, [fullName, email, password, confirm, touched]);

  const getStrength = () => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  };
  const strength = getStrength();

  const handleSignup = async () => {
    setTouched({ fullName: true, email: true, password: true, confirm: true });
    const currentErrors = validateInputs();
    if (currentErrors.length > 0) return;
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (cred.user) {
        await updateProfile(cred.user, { displayName: fullName.trim() });
        await setDoc(doc(db, 'users', cred.user.uid), { full_name: fullName.trim() }, { merge: true });
      }
      await signOut(auth);
      haptics.success();
      router.replace('/login');
    } catch (error: any) {
      let msg = 'Failed to create account.';
      if (error.code === 'auth/email-already-in-use') msg = 'An account with this email already exists.';
      if (error.code === 'auth/weak-password') msg = 'Password is too weak.';
      haptics.error();
      Alert.alert('Error', msg);
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

  const confirmMatch = confirm.length > 0 && confirm === password;

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

            {/* ── BRAND ───────────────────────────────── */}
            <View style={styles.brand}>
              <View style={styles.logoWrap}>
                <View style={[styles.pillL, { backgroundColor: PRIMARY }]} />
                <View style={[styles.pillR, { backgroundColor: PRIMARY, opacity: 0.38 }]} />
              </View>
              <Text style={[styles.wordmark, { color: text }]}>clario</Text>
              <BrandWaveform size="md" />
            </View>

            {/* ── TITLE ───────────────────────────────── */}
            <View style={styles.titleBlock}>
              <Text style={[styles.title, { color: text }]}>Create account</Text>
              <Text style={[styles.subtitle, { color: subtle }]}>Start your speech journey</Text>
            </View>

            {/* ── ERROR ───────────────────────────────── */}
            {errors.length > 0 && (
              <View style={[styles.errorBanner, { backgroundColor: isDark ? '#1F1010' : '#FFF3F3', borderColor: '#E5353515' }]}>
                <Ionicons name="alert-circle-outline" size={15} color="#E53935" />
                <Text style={styles.errorMsg}>{errors[0]}</Text>
              </View>
            )}

            {/* ── INPUTS ──────────────────────────────── */}
            <View style={[styles.inputCard, { backgroundColor: surface, borderColor: border }]}>

              {/* Full name */}
              <View style={[styles.inputRow, styles.inputRowTop, { backgroundColor: inputBg }, fullNameFocused && { borderColor: PRIMARY }]}>
                <Ionicons name="person-outline" size={16} color={fullNameFocused ? PRIMARY : subtle} style={styles.icoL} />
                <TextInput
                  style={[styles.inputField, { color: text }]}
                  placeholder="Full name"
                  placeholderTextColor={subtle}
                  value={fullName}
                  onChangeText={setFullName}
                  onFocus={() => setFullNameFocused(true)}
                  onBlur={() => { setFullNameFocused(false); setTouched(p => ({ ...p, fullName: true })); }}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>

              <View style={[styles.divider, { backgroundColor: border }]} />

              {/* Email */}
              <View style={[styles.inputRow, { backgroundColor: inputBg }, emailFocused && { borderColor: PRIMARY }]}>
                <Ionicons name="mail-outline" size={16} color={emailFocused ? PRIMARY : subtle} style={styles.icoL} />
                <TextInput
                  style={[styles.inputField, { color: text }]}
                  placeholder="Email"
                  placeholderTextColor={subtle}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => { setEmailFocused(false); setTouched(p => ({ ...p, email: true })); }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="next"
                />
              </View>

              <View style={[styles.divider, { backgroundColor: border }]} />

              {/* Password */}
              <View style={[styles.inputRow, { backgroundColor: inputBg }, passwordFocused && { borderColor: PRIMARY }]}>
                <Ionicons name="lock-closed-outline" size={16} color={passwordFocused ? PRIMARY : subtle} style={styles.icoL} />
                <TextInput
                  style={[styles.inputField, { color: text }]}
                  placeholder="Password"
                  placeholderTextColor={subtle}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => { setPasswordFocused(false); setTouched(p => ({ ...p, password: true })); }}
                  secureTextEntry={!showPass}
                  returnKeyType="next"
                />
                <TouchableOpacity onPress={() => setShowPass(s => !s)} style={styles.icoR}>
                  <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={16} color={subtle} />
                </TouchableOpacity>
              </View>

              <View style={[styles.divider, { backgroundColor: border }]} />

              {/* Confirm password */}
              <View style={[styles.inputRow, styles.inputRowBottom, { backgroundColor: inputBg }, confirmFocused && { borderColor: PRIMARY }]}>
                <Ionicons
                  name={confirmMatch ? 'checkmark-circle-outline' : 'lock-closed-outline'}
                  size={16}
                  color={confirmMatch ? '#43A047' : (confirmFocused ? PRIMARY : subtle)}
                  style={styles.icoL}
                />
                <TextInput
                  style={[styles.inputField, { color: text }]}
                  placeholder="Confirm password"
                  placeholderTextColor={subtle}
                  value={confirm}
                  onChangeText={setConfirm}
                  onFocus={() => setConfirmFocused(true)}
                  onBlur={() => { setConfirmFocused(false); setTouched(p => ({ ...p, confirm: true })); }}
                  secureTextEntry={!showConf}
                  returnKeyType="done"
                  onSubmitEditing={handleSignup}
                />
                <TouchableOpacity onPress={() => setShowConf(s => !s)} style={styles.icoR}>
                  <Ionicons name={showConf ? 'eye-off-outline' : 'eye-outline'} size={16} color={subtle} />
                </TouchableOpacity>
              </View>

            </View>

            {/* Password strength — only show when typing */}
            {password.length > 0 && (
              <View style={styles.strengthWrap}>
                <View style={styles.strengthBars}>
                  {[1, 2, 3, 4].map(i => (
                    <View
                      key={i}
                      style={[
                        styles.strengthBar,
                        { backgroundColor: i <= strength ? STRENGTH_COLORS[strength] : (isDark ? '#2A3344' : '#E0E6EA') },
                      ]}
                    />
                  ))}
                </View>
                {strength > 0 && (
                  <Text style={[styles.strengthLabel, { color: STRENGTH_COLORS[strength] }]}>
                    {STRENGTH_LABELS[strength]}
                  </Text>
                )}
              </View>
            )}

            {/* ── CTA ─────────────────────────────────── */}
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: PRIMARY }, loading && styles.ctaLoading]}
              onPress={handleSignup}
              disabled={loading}
              activeOpacity={0.84}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.ctaLabel}>Create Account</Text>
              }
            </TouchableOpacity>

            {/* ── FOOTER ──────────────────────────────── */}
            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: subtle }]}>Already have an account? </Text>
              <TouchableOpacity onPress={() => router.replace('/login')}>
                <Text style={[styles.footerLink, { color: PRIMARY }]}>Sign in</Text>
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

  brand: { alignItems: 'center', marginBottom: 40 },
  logoWrap: { width: 48, height: 28, marginBottom: 18, position: 'relative' },
  pillL: { position: 'absolute', left: 0, top: 0, width: 32, height: 28, borderRadius: 14 },
  pillR: { position: 'absolute', right: 0, top: 0, width: 32, height: 28, borderRadius: 14 },
  wordmark: { fontSize: 40, fontWeight: '700', letterSpacing: -2, marginBottom: 14 },


  titleBlock: { marginBottom: 22 },
  title:    { fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginBottom: 4 },
  subtitle: { fontSize: 15, fontWeight: '400' },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1, marginBottom: 14,
  },
  errorMsg: { color: '#E53935', fontSize: 13, fontWeight: '500', flex: 1 },

  inputCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginBottom: 10 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    height: 54, paddingHorizontal: 16,
    borderWidth: 2, borderColor: 'transparent',
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
  inputField: { flex: 1, fontSize: 16, fontWeight: '400' },
  divider: { height: 1 },

  // Strength meter
  strengthWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24, paddingHorizontal: 2 },
  strengthBars: { flex: 1, flexDirection: 'row', gap: 5 },
  strengthBar: { flex: 1, height: 3, borderRadius: 2 },
  strengthLabel: { fontSize: 12, fontWeight: '600', width: 38, textAlign: 'right' },

  cta: {
    height: 56, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 28,
  },
  ctaLoading: { opacity: 0.7 },
  ctaLabel: { color: '#fff', fontSize: 17, fontWeight: '600', letterSpacing: 0.1 },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, fontWeight: '600' },
});
