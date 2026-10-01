import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { videoUrl, videoId, language = 'en', mode = 'conservative' } = await req.json()

    if (!videoUrl || !videoId) {
      throw new Error('Video URL and ID required')
    }

    console.log(`🎯 Starting intelligent speaker detection for video ${videoId} (mode: ${mode})`)

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Step 1: Use Deepgram for primary analysis
    const deepgramResult = await analyzeWithDeepgram(videoUrl, mode)
    
    // Step 2: Validate speaker count
    const validatedSpeakers = validateSpeakerCount(deepgramResult, mode)
    
    // Step 3: Assign optimal colors
    const speakersWithColors = assignIntelligentColors(validatedSpeakers)
    
    // Step 4: Update database
    await updateDatabaseWithSpeakers(supabase, videoId, language, speakersWithColors, deepgramResult.segments)
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        speakers: speakersWithColors,
        provider: 'deepgram',
        confidence: deepgramResult.confidence 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Speaker detection error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function analyzeWithDeepgram(videoUrl: string, mode: string) {
  const deepgramApiKey = Deno.env.get('DEEPGRAM_API_KEY')!
  
  console.log('📡 Calling Deepgram API...')
  
  const response = await fetch('https://api.deepgram.com/v1/listen', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${deepgramApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: videoUrl,
      model: 'nova-2',
      version: 'latest',
      language: 'en',
      punctuate: true,
      diarize: true,
      utterances: true,
      smart_format: true,
      // NO speakers_expected - let it auto-detect
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Deepgram API failed: ${error}`)
  }

  const result = await response.json()
  
  // Extract unique speakers
  const speakers = new Set()
  const segments: any[] = []
  
  result.results.utterances?.forEach((utterance: any) => {
    speakers.add(utterance.speaker)
    segments.push({
      speaker: `Speaker ${utterance.speaker}`,
      start: utterance.start / 1000,
      end: utterance.end / 1000,
      text: utterance.text,
      confidence: utterance.confidence
    })
  })
  
  return {
    speakerCount: speakers.size,
    speakers: Array.from(speakers),
    segments,
    confidence: result.results.channels[0].alternatives[0].confidence
  }
}

function validateSpeakerCount(result: any, mode: string) {
  const { speakerCount, speakers, segments } = result
  
  console.log(`🔍 Validating ${speakerCount} detected speakers (mode: ${mode})`)
  
  // Mode-based validation thresholds
  const thresholds = {
    conservative: { maxSpeakers: 2, minSegmentsPerSpeaker: 5 },
    moderate: { maxSpeakers: 4, minSegmentsPerSpeaker: 3 },
    aggressive: { maxSpeakers: 8, minSegmentsPerSpeaker: 2 }
  }
  
  const threshold = thresholds[mode as keyof typeof thresholds] || thresholds.conservative
  
  // Check for over-segmentation
  if (speakerCount > threshold.maxSpeakers && segments.length < 50) {
    console.log('⚠️ Over-segmentation detected, consolidating...')
    return consolidateToReasonableCount(speakers, segments, threshold.maxSpeakers)
  }
  
  // Check temporal overlap - speakers that never overlap might be same person
  const overlapMatrix = checkSpeakerOverlap(segments)
  
  if (hasNoOverlap(overlapMatrix)) {
    console.log('🔀 Non-overlapping speakers detected, likely same person')
    return consolidateNonOverlapping(speakers, segments, overlapMatrix)
  }
  
  return speakers
}

function consolidateToReasonableCount(speakers: string[], segments: any[], maxSpeakers: number) {
  // Sort speakers by segment count
  const speakerCounts: Record<string, number> = {}
  segments.forEach((seg: any) => {
    speakerCounts[seg.speaker] = (speakerCounts[seg.speaker] || 0) + 1
  })
  
  const sortedSpeakers = Object.entries(speakerCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, maxSpeakers)
    .map(([speaker]) => speaker)
  
  console.log(`📊 Consolidated ${speakers.length} speakers to ${sortedSpeakers.length}`)
  return sortedSpeakers
}

function checkSpeakerOverlap(segments: any[]) {
  const matrix: Record<string, Record<string, boolean>> = {}
  
  segments.forEach((seg1: any) => {
    segments.forEach((seg2: any) => {
      if (seg1.speaker !== seg2.speaker) {
        const overlap = seg1.start < seg2.end && seg1.end > seg2.start
        
        if (!matrix[seg1.speaker]) matrix[seg1.speaker] = {}
        matrix[seg1.speaker][seg2.speaker] = matrix[seg1.speaker][seg2.speaker] || overlap
      }
    })
  })
  
  return matrix
}

function hasNoOverlap(matrix: any) {
  return Object.values(matrix).some((speakers: any) => 
    Object.values(speakers).every((overlap: any) => !overlap)
  )
}

function consolidateNonOverlapping(speakers: string[], segments: any[], matrix: any) {
  const consolidated = ['Speaker 1']
  const mergeMap: Record<string, string> = { [speakers[0]]: 'Speaker 1' }
  
  speakers.slice(1).forEach((speaker: string) => {
    const overlapsWithAny = Object.keys(mergeMap).some((existing: string) => 
      matrix[speaker]?.[existing] || matrix[existing]?.[speaker]
    )
    
    if (overlapsWithAny) {
      consolidated.push(speaker)
      mergeMap[speaker] = speaker
    } else {
      mergeMap[speaker] = 'Speaker 1' // Merge into Speaker 1
    }
  })
  
  console.log(`🔀 Consolidated non-overlapping speakers:`, mergeMap)
  return consolidated
}

function assignIntelligentColors(speakers: string[]) {
  const CI_COLORS = {
    main: ['#E5E517', '#17E5E5'], // Bright, high contrast
    supporting: ['#E51717', '#17E517'], // Distinct but secondary
    minor: ['#E517E5', '#E58017'], // Complementary
    background: ['#5E82ED', '#47C2EB', '#EBC247'] // Subtle
  }
  
  return speakers.map((speaker, index) => {
    let colorSet = CI_COLORS.main
    
    if (index >= 2) colorSet = CI_COLORS.supporting
    if (index >= 4) colorSet = CI_COLORS.minor
    if (index >= 6) colorSet = CI_COLORS.background
    
    return {
      speaker,
      color: colorSet[index % colorSet.length],
      characterType: index === 0 ? 'main' : index < 3 ? 'supporting' : 'minor'
    }
  })
}

async function updateDatabaseWithSpeakers(
  supabase: any, 
  videoId: string, 
  language: string, 
  speakers: any[],
  segments: any[]
) {
  console.log('💾 Updating database with validated speakers...')
  
  // Update segments with validated speaker data
  for (const segment of segments) {
    const speakerData = speakers.find(s => segment.speaker.includes(s.speaker))
    
    if (speakerData) {
      await supabase
        .from('transcript_segments')
        .update({
          speaker: `Speaker ${speakerData.speaker}`,
          speaker_color: speakerData.color
        })
        .eq('video_id', videoId)
        .eq('language', language)
        .gte('start_time', segment.start - 0.5)
        .lte('end_time', segment.end + 0.5)
    }
  }
  
  // Auto-create characters
  for (const speakerData of speakers) {
    const { error } = await supabase
      .from('characters')
      .upsert({
        video_id: videoId,
        name: `Character ${speakerData.speaker.replace('Speaker ', '')}`,
        type: speakerData.characterType,
        color: speakerData.color
      }, {
        onConflict: 'video_id,name'
      })
    
    if (error) {
      console.warn('⚠️ Failed to create character:', error)
    }
  }
  
  console.log('✅ Database updated with intelligent speaker detection')
}
