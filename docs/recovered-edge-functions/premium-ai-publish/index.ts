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

    console.log('[premium-ai-publish] Request received:', { versionId, options });

    if (!versionId || !options) {
      throw new Error('Missing required parameters: versionId and options are required');
    }

    const { platform, title, description, tags = [], thumbnail, schedule, visibility } = options;

    // Platform publishing guidelines
    const platformGuidelines = {
      youtube: {
        titleMaxLength: 100,
        descriptionMaxLength: 5000,
        tagLimit: 500,
        features: ['chapters', 'endscreen', 'cards', 'playlists']
      },
      vimeo: {
        titleMaxLength: 128,
        descriptionMaxLength: 5000,
        tagLimit: 100,
        features: ['privacy', 'password', 'chapters']
      },
      instagram: {
        titleMaxLength: 150,
        descriptionMaxLength: 2200,
        tagLimit: 30,
        features: ['hashtags', 'location', 'mentions']
      },
      tiktok: {
        titleMaxLength: 150,
        descriptionMaxLength: 150,
        tagLimit: 100,
        features: ['hashtags', 'duet', 'stitch', 'sounds']
      },
      linkedin: {
        titleMaxLength: 200,
        descriptionMaxLength: 3000,
        tagLimit: 100,
        features: ['mentions', 'articles', 'documents']
      },
      twitter: {
        titleMaxLength: 280,
        descriptionMaxLength: 280,
        tagLimit: 10,
        features: ['threads', 'mentions', 'hashtags']
      }
    };

    const guidelines = platformGuidelines[platform] || platformGuidelines.youtube;

    // Use AI to optimize metadata for the platform
    const systemPrompt = `You are a social media publishing expert specialized in ${platform}.
Generate optimized publishing metadata based on platform best practices.
Output Format: JSON with structure: {
  "optimizedTitle": string,
  "optimizedDescription": string,
  "suggestedTags": string[],
  "recommendations": {
    "timing": string,
    "engagement": string[],
    "seo": string[]
  },
  "warnings": string[]
}`;

    const userPrompt = `Optimize this content for ${platform}:
Title: ${title}
Description: ${description}
Tags: ${tags.join(', ')}
Visibility: ${visibility}
${schedule ? `Scheduled for: ${schedule}` : 'Publish immediately'}

Platform Guidelines:
- Max title length: ${guidelines.titleMaxLength}
- Max description length: ${guidelines.descriptionMaxLength}
- Max tags: ${guidelines.tagLimit}
- Features: ${guidelines.features.join(', ')}

Provide optimization suggestions and identify any issues.`;

    console.log('[premium-ai-publish] Calling Lovable AI for optimization...');
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
        temperature: 0.6,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[premium-ai-publish] AI API error:', aiResponse.status, errorText);
      throw new Error(`AI optimization failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const optimization = aiData.choices[0].message.content;

    console.log('[premium-ai-publish] Optimization complete');

    // Create publish job record
    const { data: job, error: jobError } = await supabase
      .from('premium_video_edits')
      .insert({
        created_by: versionId,
        edit_type: 'ai-publish',
        status: 'pending',
        edit_data: {
          platform,
          title,
          description,
          tags,
          visibility,
          schedule,
          optimization
        }
      })
      .select()
      .single();

    if (jobError) {
      console.error('[premium-ai-publish] Job creation error:', jobError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          jobId: job?.id,
          platform,
          optimization,
          guidelines,
          status: 'queued'
        },
        creditsUsed: 1
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[premium-ai-publish] Error:', error);
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
