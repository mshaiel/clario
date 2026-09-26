import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AICoPilotContextType {
  aiEnabled: boolean;
  setAiEnabled: (enabled: boolean) => void;
}

const AICoPilotContext = createContext<AICoPilotContextType | undefined>(undefined);

export function AICoPilotProvider({ children }: { children: ReactNode }) {
  // Default to true. The AI is on by default.
  const [aiEnabled, setAiEnabledState] = useState<boolean>(true);

  // 1. Load preference on mount
  useEffect(() => {
    const loadPreference = async () => {
      try {
        const stored = await AsyncStorage.getItem('clario_ai_copilot_enabled');
        if (stored !== null) {
          setAiEnabledState(JSON.parse(stored));
        }
      } catch (err) {
        console.error('Failed to load AI Co-Pilot preference:', err);
      }
    };
    loadPreference();
  }, []);

  // 2. Save preference whenever it changes
  const setAiEnabled = async (enabled: boolean) => {
    setAiEnabledState(enabled);
    try {
      await AsyncStorage.setItem('clario_ai_copilot_enabled', JSON.stringify(enabled));
    } catch (err) {
      console.error('Failed to save AI Co-Pilot preference:', err);
    }
  };

  return (
    <AICoPilotContext.Provider value={{ aiEnabled, setAiEnabled }}>
      {children}
    </AICoPilotContext.Provider>
  );
}

export function useAICoPilot() {
  const context = useContext(AICoPilotContext);
  if (!context) {
    throw new Error('useAICoPilot must be used within an AICoPilotProvider');
  }
  return context;
}