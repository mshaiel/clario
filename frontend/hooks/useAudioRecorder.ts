import { Audio } from 'expo-av';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [metering, setMetering] = useState<number>(-160); 
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  // Set to true synchronously at the start of startRecording, before any async
  // work. Lets stopRecording know an attempt is in progress even if the
  // recording object hasn't been assigned yet.
  const startAttemptedRef = useRef(false);

  // Custom WAV/PCM preset — records as uncompressed Linear PCM (WAV) on both iOS and Android.
  // This matches the 'audio/wav' MIME we send to the UA backend and what the
  // Clario analysis backend expects. HIGH_QUALITY records M4A/AAC on iOS which
  // causes the analysis backend to reject or misparse the audio.
  const WAV_RECORDING_OPTIONS: Audio.RecordingOptions = {
    isMeteringEnabled: true,
    android: {
      extension: '.wav',
      outputFormat: Audio.AndroidOutputFormat.DEFAULT,
      audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000,
    },
    ios: {
      extension: '.wav',
      outputFormat: Audio.IOSOutputFormat.LINEARPCM,
      audioQuality: Audio.IOSAudioQuality.HIGH,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
      mimeType: 'audio/wav',
      bitsPerSecond: 256000,
    },
  };

  // Tracks the in-flight startRecording promise so stopRecording can await it
  // if the user releases the button before startRecording fully resolves.
  const startPromiseRef = useRef<Promise<void> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => { cleanup(); };
  }, []);

  const cleanup = useCallback(async () => {
    if (recordingRef.current) {
      try {
        const status = await recordingRef.current.getStatusAsync();
        // ✅ FIX: Removed 'isLoaded' and 'unloadAsync' which do not exist on Recording objects.
        // If the recorder is prepared (canRecord) or actively recording, we must stop and unload it.
        if (status.canRecord || status.isRecording) {
          await recordingRef.current.stopAndUnloadAsync();
        }
      } catch (err) {
        // Ignore errors during cleanup (e.g. if already unloaded)
      }
      recordingRef.current = null;
      setIsRecording(false);
    }
  }, []);

  // ✅ NEW: Added clearRecording to reset state when discarding a recording
  const clearRecording = useCallback(async () => {
    startAttemptedRef.current = false;
    await cleanup();
    setMetering(-160);
    setError(null);
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    // Set synchronously so stopRecording knows a start was requested,
    // even before prepareToRecordAsync / startAsync completes.
    startAttemptedRef.current = true;

    const doStart = async () => {
      try {
        setError(null);
        // 1. Force cleanup of any previous instance
        await cleanup();

        const permission = await Audio.requestPermissionsAsync();
        if (permission.status !== 'granted') throw new Error('Microphone permission not granted');

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });

        const recording = new Audio.Recording();
        
        try {
          await recording.prepareToRecordAsync(WAV_RECORDING_OPTIONS);
        } catch (prepError: any) {
          if (prepError && prepError.message && (prepError.message.includes('already prepared') || prepError.message.includes('Only one Recording'))) {
              console.warn('⚠️ Audio conflict detected. Forcing global reset.');
              await new Promise(resolve => setTimeout(resolve, 500)); 
              
              // Try one more time after delay
              await recording.prepareToRecordAsync(WAV_RECORDING_OPTIONS);
          } else {
              throw prepError;
          }
        }
        
        recording.setOnRecordingStatusUpdate((status) => {
          if (status.isRecording && status.metering !== undefined) {
              setMetering(status.metering);
          }
        });

        await recording.startAsync();
        recordingRef.current = recording;
        setIsRecording(true);

      } catch (err: any) {
        console.error('Failed start:', err);
        setError(err.message);
        setIsRecording(false);
        startAttemptedRef.current = false;
      }
    };

    // Store the promise so stopRecording can await it if the user releases fast
    startPromiseRef.current = doStart();
    await startPromiseRef.current;
    startPromiseRef.current = null;
  }, [cleanup, WAV_RECORDING_OPTIONS]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    // If startRecording is still in-flight (user released very fast),
    // wait for it to finish before attempting to stop.
    if (startPromiseRef.current) {
      await startPromiseRef.current;
    }

    // If start was never attempted or failed early, nothing to stop.
    if (!startAttemptedRef.current) return null;
    startAttemptedRef.current = false;

    if (!recordingRef.current) return null;

    const isNoAudioDataError = (err: any) => {
      const message = String(err?.message || err || '').toLowerCase();
      return message.includes('no valid audio data');
    };

    try {
      const recording = recordingRef.current;
      const status = await recording.getStatusAsync();
      if (!status.canRecord && !status.isRecording) {
        recordingRef.current = null;
        setIsRecording(false);
        setMetering(-160);
        return null;
      }

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      setMetering(-160);
      return uri ?? null;
    } catch (err: any) {
      if (isNoAudioDataError(err)) {
        recordingRef.current = null;
        setIsRecording(false);
        setMetering(-160);
        return null;
      }
      console.error('Failed to stop recording:', err);
      recordingRef.current = null;
      setIsRecording(false);
      setError('Failed to stop');
      return null;
    }
  }, []);

  return {
    isRecording,
    metering,
    error,
    startRecording,
    stopRecording,
    clearRecording,
  };
}
