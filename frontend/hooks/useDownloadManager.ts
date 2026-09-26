
/**
 * Download Manager Hook
 * Location: hooks/useDownloadManager.ts
 * * Safely exposes the DownloadContext to the rest of the application.
 * Ensures components like the Dashboard and Onboarding flow stay perfectly in sync.
 */

import { useContext } from 'react';
import { DownloadContext, DownloadContextType } from '@/context/DownloadContext';

export function useDownloadManager(): DownloadContextType {
  const context = useContext(DownloadContext);
  
  if (!context) {
    throw new Error('useDownloadManager must be used within a DownloadProvider');
  }
  
  return context;
}
