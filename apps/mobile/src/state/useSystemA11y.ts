// Live OS accessibility settings: reduce motion and screen reader. With reduce motion on, shorts do not
// autoplay and scroll changes are not animated. With a screen reader on, the shorts feed exposes
// "next / previous video" actions so VoiceOver and TalkBack users never need the swipe gesture. No em
// dashes.

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useSystemA11y(): { reduceMotion: boolean; screenReader: boolean } {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader).catch(() => undefined);
    const a = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    const b = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return { reduceMotion, screenReader };
}
