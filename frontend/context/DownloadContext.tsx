/**
 * Download Context
 * Location: context/DownloadContext.tsx
 *
 * Fixes in this version:
 *
 * FIX 1 — expo-file-system/legacy import.
 *   SDK 54 throws an actual error (not just a warning) on createDownloadResumable
 *   when importing from 'expo-file-system'. The legacy subpath keeps the full
 *   existing API without any changes to call sites.
 *
 * FIX 2 — Mock CDN bypass.
 *   The mock UAB API returns download URLs pointing to cdn.clario.app which
 *   doesn't exist yet. Without this bypass, downloadModule returns false and
 *   navigateToSession shows "Download Failed" and refuses to open the session.
 *   When the URL hostname matches MOCK_CDN_HOST, we skip the real download and
 *   mark the module as cached immediately so navigation proceeds.
 *   Remove MOCK_CDN_HOST and the bypass block once the real CDN is live.
 *
 * FIX 3 — Duplicate concurrent download guard.
 *   The activeDownloads state check `activeDownloads[moduleId] !== undefined`
 *   was unreliable because the state update from setActiveDownloads is async —
 *   a second call could read stale state and pass the guard before the first
 *   call's state update was committed. Fixed with a synchronous inFlightRef Set
 *   that is updated before any async work.
 */

import { BASE_HTTP_URL } from '@/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import { createContext, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '@/firebase';
import { onAuthStateChanged } from 'firebase/auth';

const FS: any = FileSystem;
const CACHE_DIR = FS.cacheDirectory;
const DOC_DIR = FS.documentDirectory;

/** Returns the AsyncStorage key scoped to the current user. */
function cacheKey(userId: string): string {
  return `clario_cached_modules_${userId}`;
}

/** Returns the on-disk path for a module scoped to a user. */
function modulePath(userId: string, moduleId: string): string {
  return `${DOC_DIR}modules/${userId}/${moduleId}/`;
}

/**
 * MOCK_CDN_HOST — commented out. The real backend returns zip bytes directly
 * from GET /v1/assessments/{id}/bundle?user_id=... so there is no CDN URL.
 * Un-comment and restore the bypass block below if a CDN is added later.
 */
// const MOCK_CDN_HOST = 'cdn.clario.app';

export interface DownloadContextType {
  activeDownloads: Record<string, number>;
  cachedModules: string[];
  downloadModule: (moduleId: string, downloadUrl: string) => Promise<boolean>;
  isModuleCached: (moduleId: string) => boolean;
  clearAllCachedModules: () => Promise<void>;
  clearTrainingModules: () => Promise<void>;
}

export const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [activeDownloads, setActiveDownloads] = useState<Record<string, number>>({});
  const [cachedModules, setCachedModules] = useState<string[]>([]);

  // Track the current user ID so cache operations are always scoped correctly.
  const [userId, setUserId] = useState<string | null>(null);

  // Synchronous in-flight guard — prevents duplicate concurrent downloads
  // even before the async setActiveDownloads state update is committed.
  const inFlightRef = useRef<Set<string>>(new Set());

  // ── Subscribe to auth state changes ──────────────────────────────────────
  // When the user changes (login / logout / switch account):
  //   1. Update userId so subsequent operations use the correct key/path.
  //   2. Flush the in-memory cache list — the new user must re-check their own
  //      AsyncStorage key (loaded in the effect below).
  //   3. Clear in-flight guards so nothing from the old user bleeds through.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const newUid = u?.uid ?? null;
      if (newUid !== userId) {
        setUserId(newUid);
        setCachedModules([]);          // flush old user's in-memory list
        inFlightRef.current.clear();
        setActiveDownloads({});
      }
    });
    return unsub;
  }, [userId]);

  // Initialize cache registry from AsyncStorage whenever userId changes
  useEffect(() => {
    if (!userId) {
      setCachedModules([]);
      return;
    }
    const loadCache = async () => {
      try {
        const stored = await AsyncStorage.getItem(cacheKey(userId));
        if (stored) setCachedModules(JSON.parse(stored));
        else setCachedModules([]);
      } catch (err) {
        console.error('Failed to load cached modules registry:', err);
      }
    };
    loadCache();
  }, [userId]);

  const isModuleCached = useCallback(
    (moduleId: string) => cachedModules.includes(moduleId),
    [cachedModules]
  );

  const clearAllCachedModules = useCallback(async () => {
    try {
      if (userId) await AsyncStorage.removeItem(cacheKey(userId));
      setCachedModules([]);
      setActiveDownloads({});
      inFlightRef.current.clear();
      console.log('[DownloadContext] Cleared all cached modules.');
    } catch (err) {
      console.error('Failed to clear cached modules:', err);
    }
  }, [userId]);

  const clearTrainingModules = useCallback(async () => {
    if (!userId) return;
    try {
      const trainingModules = cachedModules.filter(m => m.startsWith('train_'));
      if (trainingModules.length === 0) return;

      for (const modId of trainingModules) {
        const targetPath = modulePath(userId, modId);
        await FileSystem.deleteAsync(targetPath, { idempotent: true });
      }

      const nextModules = cachedModules.filter(m => !m.startsWith('train_'));
      await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(nextModules));
      setCachedModules(nextModules);
      
      console.log(`[DownloadContext] Cleared ${trainingModules.length} training modules.`);
    } catch (err) {
      console.error('Failed to clear training modules:', err);
    }
  }, [userId, cachedModules]);

  const markModuleComplete = useCallback(async (moduleId: string) => {
    if (!userId) return;
    inFlightRef.current.delete(moduleId);
    setCachedModules((prev) => {
      if (prev.includes(moduleId)) return prev;
      const next = [...prev, moduleId];
      AsyncStorage.setItem(cacheKey(userId), JSON.stringify(next)).catch(console.error);
      return next;
    });
    setTimeout(() => {
      setActiveDownloads((prev) => {
        const copy = { ...prev };
        delete copy[moduleId];
        return copy;
      });
    }, 600);
  }, [userId]);

  const downloadModule = useCallback(async (
    moduleId: string,
    downloadUrl: string
  ): Promise<boolean> => {
    // Already fully cached — nothing to do
    if (isModuleCached(moduleId)) return true;

    // Synchronous in-flight guard (avoids duplicate concurrent calls)
    if (inFlightRef.current.has(moduleId)) {
      console.log(`[OTA] Already downloading ${moduleId}, skipping duplicate.`);
      return false;
    }

    if (!downloadUrl) {
      console.error(`[OTA] Missing downloadUrl for ${moduleId}`);
      return false;
    }

    if (!userId) {
      console.error(`[OTA] No authenticated user — cannot download ${moduleId}`);
      return false;
    }

    const fullUrl = downloadUrl.startsWith('http')
      ? downloadUrl
      : `${BASE_HTTP_URL}${downloadUrl}`;

    // Mark as in-flight before any async work
    inFlightRef.current.add(moduleId);

    try {
      console.log(`[OTA] Fetching Standard Set: ${moduleId}`);

      const targetPath = modulePath(userId, moduleId);

      // Step 1: Fetch ZIP bytes directly from backend (returns raw bytes, not a CDN streaming URL)
      setActiveDownloads((prev) => ({ ...prev, [moduleId]: 10 }));
      const response = await fetch(fullUrl);
      if (!response.ok) throw new Error(`Download HTTP error: ${response.status}`);
      setActiveDownloads((prev) => ({ ...prev, [moduleId]: 50 }));

      // Step 2: Convert to base64 for JSZip
      const arrayBuffer = await response.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + chunkSize)));
      }
      const zipContentBase64 = btoa(binary);
      setActiveDownloads((prev) => ({ ...prev, [moduleId]: 70 }));

      // ── LEGACY: createDownloadResumable path (commented out) ───────────────
      // Use this path if the backend switches to a streaming CDN URL in future.
      // const downloadResumable = FileSystem.createDownloadResumable(
      //   fullUrl, zipUri, {},
      //   (progressEvent) => {
      //     const progress = progressEvent.totalBytesExpectedToWrite > 0
      //       ? (progressEvent.totalBytesWritten / progressEvent.totalBytesExpectedToWrite) * 100
      //       : 0;
      //     setActiveDownloads((prev) => ({ ...prev, [moduleId]: Math.min(Math.round(progress * 0.8), 80) }));
      //   }
      // );
      // const result = await downloadResumable.downloadAsync();
      // if (!result || result.status !== 200) throw new Error(`Download HTTP error: ${result?.status}`);
      // const zipContentBase64 = await FileSystem.readAsStringAsync(result.uri, { encoding: 'base64' });
      // ─────────────────────────────────────────────────────────────────────

      console.log(`[OTA] Downloaded ${moduleId}. Extracting...`);
      setActiveDownloads((prev) => ({ ...prev, [moduleId]: 80 }));

      // Step 3: Parse with JSZip (pure JS — no native crash)
      const zip = new JSZip();
      await zip.loadAsync(zipContentBase64, { base64: true });

      // Step 4: Write extracted files to Document Directory
      const fileNames = Object.keys(zip.files);
      for (let i = 0; i < fileNames.length; i++) {
        const fileName = fileNames[i];
        const fileObj = zip.files[fileName];
        const fullFilePath = `${targetPath}${fileName}`;

        if (fileObj.dir) {
          await FileSystem.makeDirectoryAsync(fullFilePath, { intermediates: true });
        } else {
          const folderPath = fullFilePath.substring(0, fullFilePath.lastIndexOf('/'));
          await FileSystem.makeDirectoryAsync(folderPath, { intermediates: true });
          const fileBase64 = await fileObj.async('base64');
          await FileSystem.writeAsStringAsync(fullFilePath, fileBase64, { encoding: 'base64' });
        }
      }

      // Step 5: Clean up temp zip (only needed for legacy createDownloadResumable path)
      // await FileSystem.deleteAsync(zipUri, { idempotent: true });

      console.log(`[OTA] ${moduleId} successfully installed!`);
      setActiveDownloads((prev) => ({ ...prev, [moduleId]: 100 }));
      await markModuleComplete(moduleId);
      return true;

    } catch (error) {
      console.error(`[OTA] Download failed for ${moduleId}:`, error);
      inFlightRef.current.delete(moduleId);
      setActiveDownloads((prev) => {
        const copy = { ...prev };
        delete copy[moduleId];
        return copy;
      });
      return false;
    }
  }, [isModuleCached, markModuleComplete]);

  return (
    <DownloadContext.Provider
      value={{ activeDownloads, cachedModules, downloadModule, isModuleCached, clearAllCachedModules, clearTrainingModules }}
    >
      {children}
    </DownloadContext.Provider>
  );
}
