// REELM PROMPT GALLERY: the curated, source-cited library creators and the team pick from. Two parts:
//   STYLES   - reusable visual-style presets (a style line + the CORRECT negative for that look + camera bias).
//              The Cinematographer applies a chosen style to every shot; a creator picks one as inspiration.
//   EXAMPLES - verbatim example prompts from each provider's own docs/research, with provenance, so the team
//              can see exactly what world-class prompts look like per model.
// The famous LTX negative ("...cartoon, childish...") is photoreal-only; each animated style ships its own
// negative so the look is never fought. No em dashes.

import type { VideoProvider } from "./promptcraft.js";

export interface GalleryStyle {
  id: string;
  label: string;
  description: string;
  styleLine: string; // appended as the style clause of every shot in this style
  negative: string[]; // the RIGHT negative for this look (overrides the provider default)
  cameraBias?: string; // a default camera move that suits the style
  animated: boolean; // animated styles must not carry the photoreal "no cartoon" negative
  inspiration: string; // the look's reference (named for creators)
}

// Eight launch styles spanning animation and cinematic, each with a look-appropriate negative.
export const GALLERY_STYLES: GalleryStyle[] = [
  {
    id: "anime-noir",
    label: "Anime Noir",
    description: "Hand-drawn anime with high-contrast noir lighting and rain-slick streets.",
    styleLine: "2D anime, cel-shaded, film-noir lighting, deep shadows, rain-slick neon reflections, dramatic rim light",
    negative: ["blurry", "low quality", "distorted", "extra limbs", "watermark", "on-screen text", "photorealistic"],
    cameraBias: "slow push-in",
    animated: true,
    inspiration: "Cowboy Bebop x Blade Runner",
  },
  {
    id: "neon-cyberpunk",
    label: "Neon Cyberpunk",
    description: "Dense future city, volumetric neon, holographic signage, anamorphic glow.",
    styleLine: "cyberpunk, volumetric neon glow, holographic signage, anamorphic lens flares, teal and magenta palette, light rain",
    negative: ["blurry", "low quality", "distorted", "watermark", "on-screen text", "daylight", "rural"],
    cameraBias: "tracking shot",
    animated: false,
    inspiration: "Blade Runner 2049 cinematography",
  },
  {
    id: "claymation",
    label: "Claymation",
    description: "Stop-motion clay puppets with visible fingerprints and tactile sets.",
    styleLine: "stop-motion claymation, handcrafted clay puppets, visible fingerprints, tactile miniature sets, soft practical lighting",
    negative: ["photorealistic", "smooth CGI", "blurry", "watermark", "on-screen text", "live action"],
    cameraBias: "static shot",
    animated: true,
    inspiration: "Aardman / Laika",
  },
  {
    id: "painterly-storybook",
    label: "Painterly Storybook",
    description: "Soft illustrated storybook with painterly brushwork and warm light.",
    styleLine: "painterly illustrated storybook, soft brushwork, warm golden light, gentle bokeh, hand-painted textures",
    negative: ["photorealistic", "harsh shadows", "blurry", "watermark", "on-screen text", "horror"],
    cameraBias: "slow pan",
    animated: true,
    inspiration: "Studio Ghibli backgrounds",
  },
  {
    id: "retro-80s-film",
    label: "Retro 80s Film",
    description: "1980s color film stock, grain, soft halation, synth-era mood.",
    styleLine: "shot as if on 1980s color film, slightly grainy, soft halation, warm tungsten and neon, retro aesthetic",
    negative: ["modern devices", "clean digital", "blurry", "watermark", "on-screen text"],
    cameraBias: "slow dolly in",
    animated: false,
    inspiration: "Stranger Things / Drive",
  },
  {
    id: "photoreal-cinematic",
    label: "Photoreal Cinematic",
    description: "Anamorphic photoreal cinema, shallow depth of field, natural light.",
    styleLine: "photorealistic cinematic, 35mm anamorphic, shallow depth of field, natural motivated lighting, professional color grade",
    negative: ["pc game", "console game", "video game", "cartoon", "childish", "ugly", "blurry", "watermark", "on-screen text"],
    cameraBias: "slow cinematic push in",
    animated: false,
    inspiration: "Roger Deakins cinematography",
  },
  {
    id: "pixel-8bit",
    label: "8-bit Pixel",
    description: "Retro 8-bit pixel-art animation with a limited palette.",
    styleLine: "8-bit pixel art animation, limited palette, crisp dithering, retro game aesthetic, side-scrolling staging",
    negative: ["photorealistic", "smooth gradients", "3D render", "blurry", "watermark", "on-screen text"],
    cameraBias: "static shot",
    animated: true,
    inspiration: "16-bit era platformers",
  },
  {
    id: "comic-cel",
    label: "Comic Cel",
    description: "Bold comic-book cel shading with ink outlines and halftone shadows.",
    styleLine: "comic book cel shading, bold ink outlines, halftone shadows, saturated flat colors, dynamic action staging",
    negative: ["photorealistic", "soft focus", "muted colors", "blurry", "watermark", "on-screen text"],
    cameraBias: "snap zoom",
    animated: true,
    inspiration: "Spider-Verse",
  },
];

export function findStyle(id: string): GalleryStyle | undefined {
  return GALLERY_STYLES.find((s) => s.id === id);
}

export interface GalleryExample {
  provider: VideoProvider;
  title: string;
  prompt: string; // verbatim from the source
  style: string; // the look it demonstrates
  source: string; // provenance URL (official docs/research where possible)
}

// Verbatim, source-cited exemplars. These are reference material for the team, and few-shot seeds the Writer
// agent can imitate. Quoted exactly from the cited source.
export const GALLERY_EXAMPLES: GalleryExample[] = [
  // LTX (official prompting guide examples, from the LTX docs)
  {
    provider: "ltx",
    title: "Frog yoga studio (animation, dialogue)",
    prompt: "The camera opens in a calm, sunlit frog yoga studio. Warm morning light washes over the wooden floor as incense smoke drifts lazily in the air. The senior frog instructor sits cross-legged at the center, eyes closed, voice deep and calm. \"We are one with the pond.\" All the frogs answer softly: \"Ommm...\"",
    style: "painterly-storybook",
    source: "https://docs.ltx.video/open-source-model/usage-guides/prompting-guide",
  },
  {
    provider: "ltx",
    title: "Live news oil strike (cinematic, dialogue + SFX)",
    prompt: "EXT. SMALL TOWN STREET - MORNING - LIVE NEWS BROADCAST. The shot opens on a news reporter standing in front of a row of cordoned-off cars, yellow caution tape fluttering behind him. The light is warm, early sun reflecting off the camera lens. The reporter, composed but visibly excited, looks directly into the camera: \"this morning, here in the quiet town of New Castle, Vermont, black gold has been found!\"",
    style: "photoreal-cinematic",
    source: "https://docs.ltx.video/open-source-model/usage-guides/prompting-guide",
  },
  // Veo 3 (Google Cloud "Ultimate prompting guide for Veo 3.1")
  {
    provider: "veo",
    title: "Tired 80s office worker (retro film)",
    prompt: "Medium shot, a tired corporate worker, rubbing his temples in exhaustion, in front of a bulky 1980s computer in a cluttered office late at night. The scene is lit by the harsh fluorescent overhead lights and the green glow of the monochrome monitor. Retro aesthetic, shot as if on 1980s color film, slightly grainy.",
    style: "retro-80s-film",
    source: "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1",
  },
  {
    provider: "veo",
    title: "Crane reveal at the canyon (epic fantasy)",
    prompt: "Crane shot starting low on a lone hiker and ascending high above, revealing they are standing on the edge of a colossal, mist-filled canyon at sunrise, epic fantasy style, awe-inspiring, soft morning light.",
    style: "photoreal-cinematic",
    source: "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1",
  },
  {
    provider: "veo",
    title: "Bus window reflection (melancholic close-up)",
    prompt: "Close-up with very shallow depth of field, a young woman's face, looking out a bus window at the passing city lights with her reflection faintly visible on the glass, inside a bus at night during a rainstorm, melancholic mood with cool blue tones, moody, cinematic.",
    style: "neon-cyberpunk",
    source: "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1",
  },
  // Runway (Gen-3 Alpha prompting guide + research page)
  {
    provider: "runway",
    title: "Rainforest woman (formula example)",
    prompt: "Low angle static shot: The camera is angled up at a woman wearing all orange as she stands in a tropical rainforest with colorful flora. The dramatic sky is overcast and gray.",
    style: "photoreal-cinematic",
    source: "https://help.runwayml.com/hc/en-us/articles/30586818553107-Gen-3-Alpha-Prompting-Guide",
  },
  {
    provider: "runway",
    title: "Underwater FPV neighborhood",
    prompt: "FPV flying through a colorful coral lined streets of an underwater suburban neighborhood.",
    style: "neon-cyberpunk",
    source: "https://runwayml.com/research/introducing-gen-3-alpha",
  },
  {
    provider: "runway",
    title: "Handheld night balloon (anime)",
    prompt: "Handheld tracking shot at night, following a dirty blue balloon floating above the ground in an abandoned old European street.",
    style: "anime-noir",
    source: "https://runwayml.com/research/introducing-gen-3-alpha",
  },
  // Seedance (fal.ai prompt guides)
  {
    provider: "seedance",
    title: "Golden retriever beach (tracking, single shot)",
    prompt: "A golden retriever runs across a sandy beach at sunset, kicking up wet sand with each stride, the camera tracking alongside at ground level. Waves crash softly in the background.",
    style: "photoreal-cinematic",
    source: "https://fal.ai/learn/tools/how-to-use-seedance-2-0",
  },
  {
    provider: "seedance",
    title: "Courtroom closing argument (native audio)",
    prompt: "Defense attorney declaring 'Ladies and gentlemen, reasonable doubt isn't just a phrase, it's the foundation of justice itself', footsteps on marble, jury shifting, courtroom drama, closing argument power.",
    style: "photoreal-cinematic",
    source: "https://fal.ai/learn/devs/seedance-1-5-prompt-guide",
  },
  // Higgsfield (preset + prompt; first-party + Academy)
  {
    provider: "higgsfield",
    title: "POV talking-head hook (vertical social)",
    prompt: "Vertical 9:16 POV clip of the host speaking directly to camera with an energetic crash-zoom-in on the first word for a scroll-stopping hook, bright punchy lighting, vibrant background, fast-paced creator energy, eye-level framing.",
    style: "comic-cel",
    source: "https://academy.techpresso.co/prompts/higgsfield-prompts",
  },
  {
    provider: "higgsfield",
    title: "Bittersweet kitchen close-up (cinematic)",
    prompt: "A cinematic close-up of a middle-aged woman sitting in a softly lit vintage kitchen, looking down with a sorrowful expression. She speaks quietly, her voice trembling as she says, 'I miss you so much...' then her lips curve into a faint, bittersweet smile.",
    style: "retro-80s-film",
    source: "https://higgsfield.ai/blog/Prompt-Guide-to-Cinematic-AI-Videos",
  },
];

// A creator/team-facing payload (served on GET /gallery): styles, examples, and the per-provider craft rules.
export interface GalleryPayload {
  styles: GalleryStyle[];
  examples: GalleryExample[];
}
export function galleryPayload(): GalleryPayload {
  return { styles: GALLERY_STYLES, examples: GALLERY_EXAMPLES };
}
