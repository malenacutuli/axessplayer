import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { videoId, language = 'en' } = await req.json();

    if (!videoId) {
      throw new Error('videoId is required');
    }

    console.log(`[CONSOLIDATE-SPEAKERS] Starting consolidation for video ${videoId}, language: ${language}`);

    // Step 1: Find all unique speakers and their colors
    const { data: segments, error: segmentsError } = await supabase
      .from('transcript_segments')
      .select('speaker, speaker_color')
      .eq('video_id', videoId)
      .eq('language', language);

    if (segmentsError) throw segmentsError;

    // Group segments by speaker to find most common color
    const speakerMap = new Map<string, string[]>();
    segments?.forEach(seg => {
      if (!seg.speaker) return;
      if (!speakerMap.has(seg.speaker)) {
        speakerMap.set(seg.speaker, []);
      }
      speakerMap.get(seg.speaker)!.push(seg.speaker_color || '#3B82F6');
    });

    console.log(`[CONSOLIDATE-SPEAKERS] Found ${speakerMap.size} unique speakers`);

    const consolidatedSpeakers: Array<{ speaker: string; color: string }> = [];

    // Step 2: For each speaker, pick most common color
    speakerMap.forEach((colors, speaker) => {
      const colorCounts: Record<string, number> = {};
      colors.forEach(color => {
        colorCounts[color] = (colorCounts[color] || 0) + 1;
      });

      const mostCommonColor = Object.entries(colorCounts)
        .sort(([, a], [, b]) => b - a)[0][0];

      consolidatedSpeakers.push({ speaker, color: mostCommonColor });
    });

    // Step 3: Update all segments to use consistent colors
    for (const { speaker, color } of consolidatedSpeakers) {
      const { error } = await supabase
        .from('transcript_segments')
        .update({ speaker_color: color })
        .eq('video_id', videoId)
        .eq('language', language)
        .eq('speaker', speaker);

      if (error) {
        console.error(`[CONSOLIDATE-SPEAKERS] Error updating ${speaker}:`, error);
      }
    }

    // Step 4: Auto-create characters for each speaker if they don't exist
    const { data: existingCharacters } = await supabase
      .from('characters')
      .select('id, name')
      .eq('video_id', videoId);

    const existingCharacterNames = new Set(existingCharacters?.map(c => c.name) || []);

    for (const { speaker, color } of consolidatedSpeakers) {
      // Generate better character name
      const characterName = speaker.replace(/Speaker\s*\d*/gi, 'Character').trim() || 'Character';
      
      if (existingCharacterNames.has(characterName)) {
        console.log(`[CONSOLIDATE-SPEAKERS] Character "${characterName}" already exists, skipping`);
        continue;
      }

      const { data: character, error: charError } = await supabase
        .from('characters')
        .insert({
          video_id: videoId,
          name: characterName,
          color: color,
          type: 'main',
          is_off_camera: false
        })
        .select()
        .single();

      if (charError) {
        console.error(`[CONSOLIDATE-SPEAKERS] Error creating character:`, charError);
        continue;
      }

      // Link segments to character via character_id
      const { error: linkError } = await supabase
        .from('transcript_segments')
        .update({ 
          character_id: character.id,
          speaker: characterName,
          speaker_color: color
        })
        .eq('video_id', videoId)
        .eq('language', language)
        .eq('speaker', speaker);

      if (linkError) {
        console.error(`[CONSOLIDATE-SPEAKERS] Error linking segments:`, linkError);
      } else {
        console.log(`[CONSOLIDATE-SPEAKERS] Created character "${characterName}" and linked segments`);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        consolidatedSpeakers,
        message: `Consolidated ${consolidatedSpeakers.length} speakers`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[CONSOLIDATE-SPEAKERS] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
