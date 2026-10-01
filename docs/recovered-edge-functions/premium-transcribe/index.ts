import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, audioUrl, language, options } = await req.json();

    if (!projectId || !audioUrl) {
      throw new Error('Missing required parameters: projectId or audioUrl');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get video ID from project
    const { data: project } = await supabase
      .from('video_projects')
      .select('video_id')
      .eq('id', projectId)
      .single();

    if (!project?.video_id) {
      throw new Error('Project not found or has no video');
    }

    const videoId = project.video_id;

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        video_id: videoId,
        type: 'transcription',
        status: 'pending',
        payload: {
          projectId,
          audioUrl,
          language: language || 'en',
          options: options || {}
        }
      })
      .select()
      .single();

    if (jobError) throw jobError;

    console.log('Created transcription job:', job.id);

    // Update job to processing
    await supabase
      .from('jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', job.id);

    // Call Lovable AI for transcription
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const systemPrompt = `You are a professional transcription assistant. 
Given audio content, you will:
1. Transcribe the spoken words accurately
2. Identify different speakers if speaker_labels is enabled
3. Detect sentiment (positive/negative/neutral) if enabled
4. Identify entities (names, places, organizations) if enabled
5. Mark potential highlights if auto_highlights is enabled

Return the transcript in JSON format with an array of segments, each containing:
- text: the spoken text
- speaker: speaker identifier (e.g., "Speaker 1", "Speaker 2")
- start_time: estimated start time in seconds
- end_time: estimated end time in seconds
- sentiment: "positive", "negative", or "neutral" (if enabled)
- entities: array of detected entities (if enabled)
- is_highlight: boolean indicating if this is a key moment (if enabled)`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { 
            role: 'user', 
            content: `Please transcribe this audio from: ${audioUrl}\n\nLanguage: ${language}\nOptions: ${JSON.stringify(options)}` 
          }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'save_transcript',
            description: 'Save the transcribed segments',
            parameters: {
              type: 'object',
              properties: {
                segments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      speaker: { type: 'string' },
                      start_time: { type: 'number' },
                      end_time: { type: 'number' },
                      sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
                      entities: { type: 'array', items: { type: 'string' } },
                      is_highlight: { type: 'boolean' }
                    },
                    required: ['text', 'start_time', 'end_time']
                  }
                }
              },
              required: ['segments']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'save_transcript' } }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error('No transcript generated from AI');
    }

    const transcriptData = JSON.parse(toolCall.function.arguments);
    const segments = transcriptData.segments;

    // Save segments to database
    const segmentInserts = segments.map((seg: any, idx: number) => ({
      project_id: projectId,
      start_time: seg.start_time,
      end_time: seg.end_time,
      text: seg.text,
      speaker: seg.speaker || 'Speaker',
      original_text: seg.text,
      is_modified: false
    }));

    const { error: segmentError } = await supabase
      .from('premium_transcript_segments')
      .insert(segmentInserts);

    if (segmentError) {
      console.error('Failed to save segments:', segmentError);
      throw segmentError;
    }

    // Update job as completed
    await supabase
      .from('jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: {
          segmentCount: segments.length,
          language
        }
      })
      .eq('id', job.id);

    console.log(`Transcription completed for project ${projectId}:`, segments.length, 'segments');

    return new Response(
      JSON.stringify({
        success: true,
        jobId: job.id,
        segmentCount: segments.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Transcription error:', error);
    
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
