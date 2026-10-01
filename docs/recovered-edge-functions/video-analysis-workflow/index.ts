import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WorkflowStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  data?: any;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log('📥 Received request body:', JSON.stringify(body));
    
    const { videoId, videoUrl, action, payload } = body;

    if (!videoId) {
      throw new Error('Video ID is required');
    }

    if (action === 'start_full_analysis' && !videoUrl) {
      throw new Error('Video URL is required for analysis');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`🎬 Video Analysis Workflow: ${action} for video ${videoId}`);
    console.log(`🔗 Video URL provided: ${videoUrl ? 'Yes' : 'No'}`);

    switch (action) {
      case 'start_full_analysis':
        return await startFullAnalysis(supabase, videoId, videoUrl, payload);
      
      case 'get_workflow_status':
        return await getWorkflowStatus(supabase, videoId);
      
      case 'apply_character_mappings':
        return await applyCharacterMappings(supabase, videoId, payload);
      
      case 'save_intonation_settings':
        return await saveIntonationSettings(supabase, videoId, payload);
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    console.error('❌ Workflow error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', JSON.stringify({
      name: error.name,
      message: error.message,
      cause: error.cause
    }));
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Workflow failed',
        errorType: 'workflow_error',
        details: error.toString()
      }),
      {
        status: 400, // Use 400 instead of 500 for client errors
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function startFullAnalysis(supabase: any, videoId: string, videoUrl: string, options: any = {}) {
  const steps: WorkflowStep[] = [
    { id: 'speaker_analysis', name: 'Analyzing speakers and voices', status: 'pending', progress: 0 },
    { id: 'transcript_extraction', name: 'Extracting transcript with timestamps', status: 'pending', progress: 0 },
    { id: 'speaker_assignment', name: 'Assigning segments to speakers', status: 'pending', progress: 0 },
    { id: 'character_setup', name: 'Setting up character framework', status: 'pending', progress: 0 }
  ];

  // Store initial workflow state
  await supabase
    .from('content_generation_cache')
    .upsert({
      video_id: videoId,
      content_type: 'analysis_workflow',
      language: options.language || 'en',
      generation_params: { started_at: new Date().toISOString(), options },
      result_data: { steps, current_step: 'speaker_analysis' }
    });

  // FAST PATH: If transcript segments already exist, synthesize analysis and finish
  const { data: existingSegments } = await supabase
    .from('transcript_segments')
    .select('*')
    .eq('video_id', videoId)
    .eq('language', options.language || 'en')
    .order('start_time');

  if (existingSegments && existingSegments.length > 0) {
    console.log(`ℹ️ Found existing transcript segments: ${existingSegments.length}. Using fast path.`);

    // Mark analysis running briefly
    await updateWorkflowStep(supabase, videoId, 'speaker_analysis', 'running', 10);

    // Build speaker data from existing segments
    const stats = extractSpeakerStats(existingSegments);
    const speakersList = Object.entries(stats).map(([name, s]: [string, any]) => ({
      name,
      id: name,
      totalTimeSeconds: (s as any).totalTime,
      confidence: (s as any).averageConfidence,
      color: (s as any).color,
    }));

    const formattedSegments = existingSegments.map((seg: any) => ({
      start: seg.start_time ?? seg.startTime,
      end: seg.end_time ?? seg.endTime,
      text: seg.text,
      speaker: seg.speaker,
      speakerColor: seg.speaker_color,
      confidence: seg.confidence ?? 0.9,
      words: seg.words ?? []
    }));

    const speakerData = { speakers: speakersList, segments: formattedSegments };

    await updateWorkflowStep(supabase, videoId, 'speaker_analysis', 'completed', 100, speakerData);

    // Transcript extraction is implicitly complete
    await updateWorkflowStep(supabase, videoId, 'transcript_extraction', 'completed', 100);

    // Speaker assignment verification
    await updateWorkflowStep(supabase, videoId, 'speaker_assignment', 'completed', 100, {
      total_segments: existingSegments.length,
      speakers_detected: speakersList.length
    });

    // Character suggestions from stats
    const characterSuggestions = Object.entries(stats).map(([speakerName, s]: [string, any], index: number) => ({
      suggested_name: speakerName,
      speaker_id: speakerName,
      suggested_type: determineSpeakerTypeFromStats(s, index, Object.keys(stats).length),
      speaking_time: s.totalTime,
      confidence: s.averageConfidence,
      color: s.color || `#${Math.floor(Math.random()*16777215).toString(16)}`
    }));

    await updateWorkflowStep(supabase, videoId, 'character_setup', 'completed', 100, {
      character_suggestions: characterSuggestions,
      ready_for_user_input: true
    });

    // Finalize workflow as completed
    await supabase
      .from('content_generation_cache')
      .upsert({
        video_id: videoId,
        content_type: 'analysis_workflow',
        language: options.language || 'en',
        generation_params: { completed_at: new Date().toISOString(), options },
        result_data: {
          steps: steps.map(s => ({ ...s, status: 'completed', progress: 100 })),
          current_step: 'completed',
          speaker_data: speakerData,
          character_suggestions: characterSuggestions,
          ready_for_user_configuration: true
        }
      });

    return new Response(
      JSON.stringify({
        success: true,
        workflow_complete: true,
        speaker_data: speakerData,
        character_suggestions: characterSuggestions,
        total_segments: existingSegments.length,
        next_step: 'user_character_configuration'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Step 1: Enhanced speaker analysis
  console.log('🎭 Starting enhanced speaker analysis...');
  updateWorkflowStep(supabase, videoId, 'speaker_analysis', 'running', 10);

  // Primary: Use advanced AI analysis for superior speaker diarization
  const primaryResponse = await supabase.functions.invoke('twelve-labs-analysis', {
    body: {
      videoUrl,
      videoId,
      language: options.language || 'en'
    }
  });

  let speakerData;
  
  if (primaryResponse.error || !primaryResponse.data || primaryResponse.data.error) {
    console.warn('⚠️ Primary analysis failed, falling back to secondary method:', primaryResponse.error);
    await updateWorkflowStep(supabase, videoId, 'speaker_analysis', 'running', 20);
    
    // Fallback: Use secondary speaker diarization
    const fallbackResponse = await supabase.functions.invoke('speaker-diarization', {
      body: {
        videoUrl,
        videoId,
        analysisDepth: options.analysisDepth || 'standard',
        confidenceThreshold: options.confidenceThreshold || 0.6
      }
    });

    if (fallbackResponse.error) {
      await updateWorkflowStep(supabase, videoId, 'speaker_analysis', 'error', 0, fallbackResponse.error.message);
      throw new Error(`Both primary and fallback speaker analysis failed: ${fallbackResponse.error.message}`);
    }

    speakerData = fallbackResponse.data;
    console.log('✅ Fallback speaker analysis completed');
  } else {
    speakerData = primaryResponse.data;
    console.log(`✅ Enhanced speaker analysis completed: ${speakerData.segments?.length || 0} segments, ${speakerData.speakers?.length || 0} unique speakers identified`);
  }

  await updateWorkflowStep(supabase, videoId, 'speaker_analysis', 'completed', 100, speakerData);

  // Step 2: Save Enhanced Transcript (if we have segments from AI analysis)
  console.log('📝 Processing enhanced transcript data...');
  await updateWorkflowStep(supabase, videoId, 'transcript_extraction', 'running', 25);

  // If AI analysis provided segments, save them directly
  if (speakerData.segments && speakerData.segments.length > 0) {
    console.log(`💾 Saving ${speakerData.segments.length} enhanced segments from AI analysis...`);
    
    // Transform segments to match our database format
    const transformedSegments = speakerData.segments.map((segment: any, idx: number) => ({
      idx,
      startTime: segment.start,
      endTime: segment.end,
      text: segment.text,
      speaker: segment.speaker,
      speakerColor: segment.speakerColor,
      confidence: segment.confidence || 0.9,
      words: segment.words || []
    }));

    // Save using our transcript upsert function
    const { error: upsertError } = await supabase.rpc('upsert_transcript_segments', {
      p_video_id: videoId,
      p_language: options.language || 'en',
      p_created_by: null, // System generated
      p_segments: transformedSegments
    });

    if (upsertError) {
      console.error('❌ Failed to save enhanced transcript:', upsertError);
    }
  } else {
    // Fallback: Use standard transcript extraction
    const transcriptResponse = await supabase.functions.invoke('transcribe', {
      body: {
        videoUrl,
        videoId,
        language: options.language || 'en'
      }
    });

    if (transcriptResponse.error) {
      await updateWorkflowStep(supabase, videoId, 'transcript_extraction', 'error', 0, transcriptResponse.error.message);
      throw new Error(`Transcript extraction failed: ${transcriptResponse.error.message}`);
    }
  }

  await updateWorkflowStep(supabase, videoId, 'transcript_extraction', 'completed', 100);

  // Step 3: Speaker Assignment Verification
  console.log('🔄 Verifying speaker assignments...');
  await updateWorkflowStep(supabase, videoId, 'speaker_assignment', 'running', 75);

  // Get current transcript segments to verify speaker assignments
  const { data: segments } = await supabase
    .from('transcript_segments')
    .select('*')
    .eq('video_id', videoId)
    .order('start_time');

  await updateWorkflowStep(supabase, videoId, 'speaker_assignment', 'completed', 100, { 
    total_segments: segments?.length || 0,
    speakers_detected: speakerData.speakers?.length || 0
  });

  // Step 4: Enhanced Character Framework Setup
  console.log('👥 Setting up enhanced character framework...');
  await updateWorkflowStep(supabase, videoId, 'character_setup', 'running', 90);

  // Create intelligent character suggestions based on enhanced speaker analysis
  let characterSuggestions = [];
  
  if (speakerData.speakers && speakerData.speakers.length > 0) {
    // Use AI analysis speaker data with better naming
    characterSuggestions = speakerData.speakers.map((speaker: any, index: number) => ({
      suggested_name: speaker.name || `Speaker ${index + 1}`,
      speaker_id: speaker.id || speaker.name,
      suggested_type: determineSpeakerType(speaker, index, speakerData.speakers),
      speaking_time: speaker.totalTimeSeconds || calculateSpeakingTime(speaker, speakerData.segments),
      confidence: speaker.confidence || 0.9,
      color: speaker.color || `#${Math.floor(Math.random()*16777215).toString(16)}`
    }));
  } else if (segments && segments.length > 0) {
    // Fallback: Extract speakers from saved segments
    const speakerStats = extractSpeakerStats(segments);
    characterSuggestions = Object.entries(speakerStats).map(([speakerName, stats]: [string, any], index: number) => ({
      suggested_name: speakerName,
      speaker_id: speakerName,
      suggested_type: determineSpeakerTypeFromStats(stats, index, Object.keys(speakerStats).length),
      speaking_time: stats.totalTime,
      confidence: stats.averageConfidence,
      color: stats.color || `#${Math.floor(Math.random()*16777215).toString(16)}`
    }));
  }

  console.log(`✅ Created ${characterSuggestions.length} character suggestions`);

  await updateWorkflowStep(supabase, videoId, 'character_setup', 'completed', 100, {
    character_suggestions: characterSuggestions,
    ready_for_user_input: true
  });

  // Final workflow completion
  await supabase
    .from('content_generation_cache')
    .upsert({
      video_id: videoId,
      content_type: 'analysis_workflow',
      language: options.language || 'en',
      generation_params: { completed_at: new Date().toISOString(), options },
      result_data: { 
        steps: steps.map(s => s.id === 'character_setup' ? { ...s, status: 'completed', progress: 100 } : s),
        current_step: 'completed',
        speaker_data: speakerData,
        character_suggestions: characterSuggestions,
        ready_for_user_configuration: true
      }
    });

  return new Response(
    JSON.stringify({
      success: true,
      workflow_complete: true,
      speaker_data: speakerData,
      character_suggestions: characterSuggestions,
      total_segments: segments?.length || 0,
      next_step: 'user_character_configuration'
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

async function getWorkflowStatus(supabase: any, videoId: string) {
  const { data } = await supabase
    .from('content_generation_cache')
    .select('result_data')
    .eq('video_id', videoId)
    .eq('content_type', 'analysis_workflow')
    .single();

  return new Response(
    JSON.stringify({
      success: true,
      workflow_data: data?.result_data || { steps: [], current_step: 'not_started' }
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

async function applyCharacterMappings(supabase: any, videoId: string, payload: any) {
  console.log('🎭 Applying character mappings:', payload);
  
  const { characters, speaker_mappings, language = 'en' } = payload;

  // Apply character data to database
  for (const character of characters) {
    await supabase
      .from('characters')
      .upsert({
        video_id: videoId,
        name: character.name,
        type: character.type,
        color: character.color,
        is_off_camera: character.isOffCamera || false,
        voice_id: character.voiceId,
        voice_name: character.voiceName,
        voice_type: character.voiceType,
        emphasis: character.emphasis || 'normal',
        pitch: character.pitch || 'normal'
      });
  }

  // Apply speaker mappings to transcript segments
  for (const [originalSpeaker, characterName] of Object.entries(speaker_mappings)) {
    const character = characters.find((c: any) => c.name === characterName);
    if (character) {
      await supabase
        .from('transcript_segments')
        .update({
          speaker: characterName,
          speaker_color: character.color,
          is_off_camera: character.isOffCamera || false
        })
        .eq('video_id', videoId)
        .eq('language', language)
        .eq('speaker', originalSpeaker);
    }
  }

  // Store speaker mappings
  await supabase
    .from('speaker_mappings')
    .upsert({
      video_id: videoId,
      language,
      mappings: speaker_mappings,
      created_by: null // System-generated
    });

  return new Response(
    JSON.stringify({
      success: true,
      characters_applied: characters.length,
      mappings_applied: Object.keys(speaker_mappings).length
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

async function saveIntonationSettings(supabase: any, videoId: string, payload: any) {
  console.log('🎵 Saving intonation settings:', payload);
  
  const { segment_updates, language = 'en' } = payload;

  // Apply intonation updates to transcript segments
  for (const update of segment_updates) {
    await supabase
      .from('transcript_segments')
      .update({
        emphasis: update.emphasis,
        pitch: update.pitch,
        // Store word-level intonation in words jsonb field
        words: update.words
      })
      .eq('id', update.segment_id);
  }

  return new Response(
    JSON.stringify({
      success: true,
      segments_updated: segment_updates.length
    }),
    {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

async function updateWorkflowStep(supabase: any, videoId: string, stepId: string, status: string, progress: number, data?: any) {
  // Get current workflow data
  const { data: current } = await supabase
    .from('content_generation_cache')
    .select('result_data')
    .eq('video_id', videoId)
    .eq('content_type', 'analysis_workflow')
    .single();

  if (current?.result_data) {
    const workflowData = current.result_data;
    const updatedSteps = workflowData.steps.map((step: any) => 
      step.id === stepId 
        ? { ...step, status, progress, ...(data && { data }) }
        : step
    );

    await supabase
      .from('content_generation_cache')
      .update({
        result_data: {
          ...workflowData,
          steps: updatedSteps,
          current_step: stepId,
          last_updated: new Date().toISOString()
        }
      })
      .eq('video_id', videoId)
      .eq('content_type', 'analysis_workflow');
  }
}

// Helper functions for enhanced character suggestions

function determineSpeakerType(speaker: any, index: number, allSpeakers: any[]): string {
  const speakingTime = speaker.totalTimeSeconds || 0;
  const maxSpeakingTime = Math.max(...allSpeakers.map(s => s.totalTimeSeconds || 0));
  
  // Determine type based on speaking time and position
  if (speakingTime > maxSpeakingTime * 0.7) return 'main';
  if (speakingTime > maxSpeakingTime * 0.3) return 'supporting';
  return 'minor';
}

function determineSpeakerTypeFromStats(stats: any, index: number, totalSpeakers: number): string {
  // First speaker with most time is usually main
  if (index === 0) return 'main';
  if (index < Math.min(3, totalSpeakers)) return 'supporting';
  return 'minor';
}

function calculateSpeakingTime(speaker: any, segments: any[]): number {
  if (!segments) return 0;
  
  return segments
    .filter(seg => seg.speaker === speaker.name || seg.speaker === speaker.id)
    .reduce((total, seg) => total + (seg.end - seg.start), 0);
}

function extractSpeakerStats(segments: any[]): Record<string, any> {
  const stats: Record<string, any> = {};
  
  segments.forEach(segment => {
    const speaker = segment.speaker || 'Unknown';
    
    if (!stats[speaker]) {
      stats[speaker] = {
        totalTime: 0,
        segmentCount: 0,
        confidenceSum: 0,
        color: segment.speaker_color
      };
    }
    
    stats[speaker].totalTime += (segment.end_time || segment.endTime) - (segment.start_time || segment.startTime);
    stats[speaker].segmentCount += 1;
    stats[speaker].confidenceSum += segment.confidence || 0.9;
  });
  
  // Calculate averages
  Object.values(stats).forEach((stat: any) => {
    stat.averageConfidence = stat.confidenceSum / stat.segmentCount;
  });
  
  // Sort by speaking time
  return Object.fromEntries(
    Object.entries(stats).sort(([,a], [,b]) => (b as any).totalTime - (a as any).totalTime)
  );
}