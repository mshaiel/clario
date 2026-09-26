/**
 * Language Context
 * Location: context/LanguageContext.tsx
 * * Phase 8 Fix:
 * - Updated import from deleted firestoreSchema to lib/firestore.
 * - Adheres to Rule 3: Auth before Firestore queries.
 */

import { auth, db } from '@/firebase';
import { FIRESTORE_PATHS } from '@/lib/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type Language = 'english' | 'urdu';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  isRTL: boolean; 
  isLanguageLoaded: boolean; 
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('english');
  const [isLanguageLoaded, setIsLanguageLoaded] = useState(false);

  useEffect(() => {
    let unsubscribeAuth: () => void;

    const initialize = async () => {
      // 1. Try Local Storage first for immediate UI responsiveness
      try {
        const savedLang = await AsyncStorage.getItem('clario_app_language');
        if (savedLang === 'english' || savedLang === 'urdu') {
          setLanguageState(savedLang);
        }
      } catch (e) {
        console.error('Failed to load local language', e);
      }

      // 2. Auth Listener (Cloud Sync)
      unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
        if (user) {
          try {
            const path = FIRESTORE_PATHS.userMeta(user.uid);
            const snap = await getDoc(doc(db, path));
            
            if (snap.exists()) {
              const cloudLang = snap.data().last_active_lang as Language;
              if (cloudLang && (cloudLang === 'english' || cloudLang === 'urdu')) {
                setLanguageState(cloudLang);
                await AsyncStorage.setItem('clario_app_language', cloudLang);
              }
            }
          } catch (e) {
            // Silently fail - use local preference as fallback
          }
        } 
        setIsLanguageLoaded(true);
      });
    };

    initialize();

    return () => {
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    
    try {
      await AsyncStorage.setItem('clario_app_language', lang);
    } catch (e) {}

    const user = auth.currentUser;
    if (user) {
      try {
        const path = FIRESTORE_PATHS.userMeta(user.uid);
        await setDoc(doc(db, path), { last_active_lang: lang }, { merge: true });
      } catch (e) {
        console.error('Failed to save language to cloud', e);
      }
    }
  };

  const isRTL = language === 'urdu';

  return (
    <LanguageContext.Provider value={{ language, setLanguage, isRTL, isLanguageLoaded }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}