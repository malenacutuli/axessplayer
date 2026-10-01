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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const { versionId, options } = await req.json();

    console.log('[premium-ai-repurpose] Request received:', { versionId, options });

    if (!versionId || !options) {
      throw new Error('Missing required parameters: versionId and options are required');
    }

    const { outputFormat, platform, duration, includeSubtitles, includeCaptions, brandKit } = options;

    // Platform-specific optimization guidelines
    const platformSpecs = {
      youtube: { aspectRatio: '16:9', maxDuration: 3600, hooks: 'first 8 seconds' },
      instagram: { aspectRatio: '4:5', maxDuration: 90, hooks: 'first 3 seconds' },
      tiktok: { aspectRatio: '9:16', maxDuration: 60, hooks: 'first 2 seconds' },
      linkedin: { aspectRatio: '16:9', maxDuration: 600, hooks: 'professional tone' },
      twitter: { aspectRatio: '16:9', maxDuration: 140, hooks: 'immediate impact' },
      blog: { aspectRatio: '16:9', maxDuration: 300, hooks: 'narrative flow' }
    };

    const specs = platformSpecs[platform] || platformSpecs.youtube;

    const systemPrompt = `You are a video repurposing expert specialized in optimizing content for different platforms.
Generate detailed repurposing instructions based on platform best practices.
Output Format: JSON with structure: {
  "editingPlan": {
    "cuts": [{"timestamp": number, "duration": number, "reason": string}],
    "crops": {"aspectRatio": string, "focusPoint": string},
    "overlays": [{"type": string, "position": string, "content": string}]
  },
  "captions": {"style": string, "position": string, "animation": string},
  "hooks": [{"timestamp": number, "text": string, "type": string}],
  "optimizations": string[]
}`;

    const userPrompt = `Repurpose video for ${platform} as a ${outputFormat}.
Platform: ${platform}
Target Format: ${outputFormat}
Aspect Ratio: ${specs.aspectRatio}
Max Duration: ${duration || specs.maxDuration}s
Include Subtitles: ${includeSubtitles}
Include Captions: ${includeCaptions}
${brandKit ? `Brand Guidelines: ${brandKit}` : ''}

Generate a complete repurposing plan with timing, cuts, crops, and platform-specific optimizations.`;

    console.log('[premium-ai-repurpose] Calling Lovable AI...');
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[premium-ai-repurpose] AI API error:', aiResponse.status, errorText);
      throw new Error(`AI repurpose failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const repurposePlan = aiData.choices[0].message.content;

    console.log('[premium-ai-repurpose] AI repurpose plan generated');

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from('premium_video_edits')
      .insert({
        created_by: versionId,
        edit_type: 'ai-repurpose',
        status: 'pending',
        edit_data: {
          platform,
          outputFormat,
          options,
          plan: repurposePlan
        }
      })
      .select()
      .single();

    if (jobError) {
      console.error('[premium-ai-repurpose] Job creation error:', jobError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          jobId: job?.id,
          platform,
          outputFormat,
          plan: repurposePlan,
          specs
        },
        creditsUsed: 1
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[premium-ai-repurpose] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        creditsUsed: 0
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
