// Audio description segment, lifted from the Axessible types (types/audioDescription.ts), trimmed to what the
// player needs. WCAG 2.2 AAA / EAD: requiresExtension means the AD audio is longer than the dialogue gap, so
// the player must pause or slow the video until the AD finishes. No em dashes.

export interface AudioDescriptionSegment {
  id: string;
  text: string;
  startTime: number; // seconds
  endTime: number;
  audioUrl: string;
  audioDurationMs?: number;
  requiresExtension?: boolean;
  extensionType?: "pause" | "slowdown";
}

export interface AudioDescriptionDoc {
  version?: number;
  voice?: string;
  segments: AudioDescriptionSegment[];
}
