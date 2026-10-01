// Viewer preferences that must survive restarts: analytics consent (default OFF, first-launch prompt)
// and captions (default ON). Stored in AsyncStorage through the tested consent module. No em dashes.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { analyticsAllowed, loadConsent, saveConsent, type ConsentState, type KeyValueStore } from "../core/consent/consent";

const CAPTIONS_KEY = "axessplayer.prefs.captions.v1";

const store: KeyValueStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
};

export interface PrefsValue {
  loaded: boolean;
  consent: ConsentState;
  setConsent(next: "granted" | "denied"): void;
  // Read at send time by the events client, so revoking consent stops events at once.
  analyticsAllowedNow(): boolean;
  captionsEnabled: boolean;
  setCaptionsEnabled(on: boolean): void;
}

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [consent, setConsentState] = useState<ConsentState>("unset");
  const [captionsEnabled, setCaptions] = useState(true);
  const consentRef = useRef<ConsentState>("unset");

  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await loadConsent(store);
      let captions: string | null = null;
      try {
        captions = await AsyncStorage.getItem(CAPTIONS_KEY);
      } catch {
        captions = null;
      }
      if (!alive) return;
      consentRef.current = c;
      setConsentState(c);
      setCaptions(captions !== "off");
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setConsent = useCallback((next: "granted" | "denied") => {
    consentRef.current = next;
    setConsentState(next);
    saveConsent(store, next).catch(() => undefined);
  }, []);

  const setCaptionsEnabled = useCallback((on: boolean) => {
    setCaptions(on);
    AsyncStorage.setItem(CAPTIONS_KEY, on ? "on" : "off").catch(() => undefined);
  }, []);

  const analyticsAllowedNow = useCallback(() => analyticsAllowed(consentRef.current), []);

  const value = useMemo<PrefsValue>(
    () => ({ loaded, consent, setConsent, analyticsAllowedNow, captionsEnabled, setCaptionsEnabled }),
    [loaded, consent, setConsent, analyticsAllowedNow, captionsEnabled, setCaptionsEnabled]
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const v = useContext(PrefsContext);
  if (!v) throw new Error("usePrefs outside PrefsProvider");
  return v;
}
