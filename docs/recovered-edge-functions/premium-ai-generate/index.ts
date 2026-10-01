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

    console.log('[premium-ai-generate] Request received:', { versionId, options });

    if (!versionId || !options) {
      throw new Error('Missing required parameters: versionId and options are required');
    }

    const { type, prompt, aspectRatio, duration, style, voice, language } = options;

    // Build AI prompt based on generation type
    let systemPrompt = '';
    let userPrompt = prompt;

    switch (type) {
      case 'video':
        systemPrompt = `You are a video generation expert. Generate detailed video descriptions and storyboards.
Output Format: JSON with structure: {"scenes": [{"duration": number, "description": string, "visuals": string, "audio": string}], "totalDuration": number}`;
        userPrompt = `Create a video concept for: ${prompt}\nAspect Ratio: ${aspectRatio}\nDuration: ${duration || 30}s\nStyle: ${style || 'cinematic'}`;
        break;

      case 'audio':
        systemPrompt = `You are an audio generation expert. Generate detailed audio production specifications.
Output Format: JSON with structure: {"type": string, "description": string, "voice": string, "effects": string[], "duration": number}`;
        userPrompt = `Create audio for: ${prompt}\nVoice: ${voice || 'neutral'}\nLanguage: ${language || 'en'}\nDuration: ${duration || 30}s`;
        break;

      case 'image':
        systemPrompt = `You are an image generation expert. Generate detailed image prompts with artistic direction.
Output Format: JSON with structure: {"prompt": string, "style": string, "composition": string, "lighting": string, "mood": string}`;
        userPrompt = `Create an image concept for: ${prompt}\nAspect Ratio: ${aspectRatio}\nStyle: ${style || 'professional'}`;
        break;

      case 'text':
        systemPrompt = 'You are a content generation expert. Create compelling text content based on the brief.';
        break;

      default:
        throw new Error(`Unsupported generation type: ${type}`);
    }

    // Call Lovable AI
    console.log('[premium-ai-generate] Calling Lovable AI...');
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
        temperature: 0.8,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[premium-ai-generate] AI API error:', aiResponse.status, errorText);
      throw new Error(`AI generation failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const generatedContent = aiData.choices[0].message.content;

    console.log('[premium-ai-generate] AI generation successful');

    // Create job record for tracking
    const { data: job, error: jobError } = await supabase
      .from('premium_video_edits')
      .insert({
        created_by: versionId,
        edit_type: `ai-generate-${type}`,
        status: 'completed',
        edit_data: {
          type,
          prompt,
          options,
          result: generatedContent
        }
      })
      .select()
      .single();

    if (jobError) {
      console.error('[premium-ai-generate] Job creation error:', jobError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          jobId: job?.id,
          type,
          content: generatedContent,
          prompt
        },
        creditsUsed: 1
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[premium-ai-generate] Error:', error);
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
