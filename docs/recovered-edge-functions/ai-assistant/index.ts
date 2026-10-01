import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { command, context } = await req.json();

    console.log('AI Assistant request:', { command, context });

    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an AI video editing assistant helping users edit videos with natural language.
              
Available editing actions:
- remove_pauses: Remove silence/pauses from video (threshold in seconds)
- apply_template: Apply caption templates (viral-tiktok, professional, educational)
- remove_fillers: Remove filler words (um, uh, like, you know)
- split_scenes: Split video into scenes (interval in seconds)
- add_music: Add background music (style: upbeat/calm/epic/corporate, volume 0-1)
- create_highlights: Create highlight reel (duration in seconds)
- export: Export video (format: mp4/mov/webm, resolution: 1080p/4k)

Respond concisely with helpful instructions. For actionable requests, describe what you'll do.
Keep responses under 100 words and friendly.`
          },
          {
            role: 'user',
            content: command
          }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    console.log('AI response:', aiResponse);

    // Parse actions from command
    const actions = parseActionsFromCommand(command.toLowerCase());

    return new Response(
      JSON.stringify({
        response: aiResponse,
        actions
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('AI Assistant error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Unknown error',
        response: "I'm having trouble processing that request. Could you try rephrasing it?"
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

function parseActionsFromCommand(command: string) {
  const actions = [];
  
  // Pause removal
  if (command.includes('pause') || command.includes('silence')) {
    const match = command.match(/(\d+)\s*second/);
    const threshold = match ? parseInt(match[1]) : 2;
    actions.push({
      type: 'remove_pauses',
      label: 'Remove Pauses',
      data: { threshold }
    });
  }
  
  // Captions
  if (command.includes('caption') || command.includes('subtitle')) {
    if (command.includes('viral') || command.includes('tiktok')) {
      actions.push({
        type: 'apply_template',
        label: 'Apply Viral Captions',
        data: { templateId: 'viral-tiktok' }
      });
    } else if (command.includes('professional')) {
      actions.push({
        type: 'apply_template',
        label: 'Apply Professional Captions',
        data: { templateId: 'professional' }
      });
    } else {
      actions.push({
        type: 'apply_template',
        label: 'Apply Captions',
        data: { templateId: 'auto' }
      });
    }
  }
  
  // Filler word removal
  if (command.includes('filler') || command.includes('um') || command.includes('uh') || command.includes('like')) {
    actions.push({
      type: 'remove_fillers',
      label: 'Remove Filler Words',
      data: { words: ['um', 'uh', 'like', 'you know'] }
    });
  }
  
  // Scene splitting
  if (command.includes('split') || command.includes('scene')) {
    const match = command.match(/(\d+)\s*(second|minute)/);
    const duration = match ? parseInt(match[1]) * (match[2] === 'minute' ? 60 : 1) : 30;
    actions.push({
      type: 'split_scenes',
      label: 'Split into Scenes',
      data: { interval: duration }
    });
  }
  
  // Music
  if (command.includes('music') || command.includes('soundtrack')) {
    let style = 'upbeat';
    if (command.includes('calm')) style = 'calm';
    else if (command.includes('epic')) style = 'epic';
    else if (command.includes('corporate')) style = 'corporate';
    
    actions.push({
      type: 'add_music',
      label: `Add ${style.charAt(0).toUpperCase() + style.slice(1)} Music`,
      data: { style, volume: 0.2 }
    });
  }
  
  // Highlights
  if (command.includes('highlight') || command.includes('best moment')) {
    const match = command.match(/(\d+)\s*second/);
    const duration = match ? parseInt(match[1]) : 60;
    actions.push({
      type: 'create_highlights',
      label: `Create ${duration}s Highlights`,
      data: { duration }
    });
  }
  
  // Export
  if (command.includes('export') || command.includes('download')) {
    actions.push({
      type: 'export',
      label: 'Export Video',
      data: { format: 'mp4', resolution: '1080p' }
    });
  }
  
  return actions;
}
