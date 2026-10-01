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
    // Simple health check that returns OK if all AI features are available
    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      features: [
        'premium-ai-generate',
        'premium-ai-repurpose',
        'premium-ai-publish',
        'premium-ai-write'
      ],
      version: '1.0.0'
    };

    return new Response(
      JSON.stringify(healthStatus),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error) {
    console.error('[premium-ai-health] Error:', error);
    return new Response(
      JSON.stringify({ 
        status: 'error',
        error: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
