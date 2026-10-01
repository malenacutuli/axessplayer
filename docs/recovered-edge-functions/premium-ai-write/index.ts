import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const { versionId, options, context } = await req.json();

    console.log('[premium-ai-write] Request received:', { versionId, options });

    if (!versionId || !options) {
      throw new Error('Missing required parameters: versionId and options are required');
    }

    const { type, tone = 'professional', length = 'medium', keywords = [], includeEmojis = false, seoOptimized = false } = options;

    // Content type specifications
    const contentSpecs = {
      script: {
        instruction: 'Write a compelling video script with scene descriptions and dialogue',
        format: 'Scene-by-scene format with timestamps and speaker notes'
      },
      description: {
        instruction: 'Write an engaging video description that maximizes viewer engagement',
        format: 'Paragraph format with key points highlighted'
      },
      title: {
        instruction: 'Generate attention-grabbing video titles',
        format: 'List of 5 title options, ranked by impact'
      },
      tags: {
        instruction: 'Generate relevant tags and hashtags for maximum discoverability',
        format: 'Comma-separated list of tags, grouped by category'
      },
      captions: {
        instruction: 'Write engaging social media captions',
        format: 'Multiple caption options for different platforms'
      },
      blog: {
        instruction: 'Write a comprehensive blog post based on video content',
        format: 'Full article with introduction, body paragraphs, and conclusion'
      }
    };

    const spec = contentSpecs[type] || contentSpecs.description;

    // Length guidelines
    const lengthGuide = {
      short: 'Keep it concise (50-150 words)',
      medium: 'Provide good detail (150-400 words)',
      long: 'Create comprehensive content (400-1000 words)'
    };

    const systemPrompt = `You are a professional content writer specializing in video-related content.
Tone: ${tone}
Style: ${includeEmojis ? 'Include relevant emojis' : 'Professional text only'}
${seoOptimized ? 'SEO: Optimize for search engines with natural keyword integration' : ''}
${keywords.length > 0 ? `Keywords to include: ${keywords.join(', ')}` : ''}

${spec.instruction}
Format: ${spec.format}
Length: ${lengthGuide[length]}`;

    const userPrompt = context
      ? `Based on this video context:\n${context}\n\nGenerate ${type} content.`
      : `Generate ${type} content for a video project.`;

    console.log('[premium-ai-write] Calling Lovable AI...');
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
      console.error('[premium-ai-write] AI API error:', aiResponse.status, errorText);
      throw new Error(`AI write failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const generatedText = aiData.choices[0].message.content;

    console.log('[premium-ai-write] Content generated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          text: generatedText,
          type,
          tone,
          length,
          wordCount: generatedText.split(/\s+/).length
        },
        creditsUsed: 1
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[premium-ai-write] Error:', error);
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
