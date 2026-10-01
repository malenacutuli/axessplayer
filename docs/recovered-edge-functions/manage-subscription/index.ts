import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the authorization header from the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create supabase client with service role for secure operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    
    // Create client with user auth for verification
    const supabaseAnon = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
    
    // Verify the user's JWT token
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(jwt);
    
    if (authError || !user) {
      throw new Error('Authentication failed');
    }

    const { action, channel_id, subscriber_user_id } = await req.json();

    // Security validation
    if (!action || !channel_id) {
      throw new Error('Missing required parameters: action, channel_id');
    }

    // Verify the user is authorized to perform this action
    if (subscriber_user_id && subscriber_user_id !== user.id) {
      throw new Error('SECURITY VIOLATION: User can only manage their own subscriptions');
    }

    console.log(`🔒 Secure subscription ${action} for user ${user.id} on channel ${channel_id}`);

    if (action === 'subscribe') {
      // Verify channel exists and is public
      const { data: channel, error: channelError } = await supabaseService
        .from('channels')
        .select('id, is_public')
        .eq('id', channel_id)
        .eq('is_public', true)
        .single();

      if (channelError || !channel) {
        throw new Error('Channel not found or not public');
      }

      // Check if already subscribed
      const { data: existing } = await supabaseService
        .from('channel_subscriptions')
        .select('id')
        .eq('channel_id', channel_id)
        .eq('subscriber_user_id', user.id)
        .single();

      if (existing) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Already subscribed' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create subscription using service role
      const { error: insertError } = await supabaseService
        .from('channel_subscriptions')
        .insert({
          channel_id: channel_id,
          subscriber_user_id: user.id,
        });

      if (insertError) {
        throw new Error(`Failed to create subscription: ${insertError.message}`);
      }

      // Log security event
      await supabaseService
        .from('security_events')
        .insert({
          event_type: 'subscription_created',
          user_id: user.id,
          resource_id: channel_id,
          details: { action: 'subscribe', channel_id }
        });

      console.log(`✅ User ${user.id} successfully subscribed to channel ${channel_id}`);

    } else if (action === 'unsubscribe') {
      // Remove subscription using service role
      const { error: deleteError } = await supabaseService
        .from('channel_subscriptions')
        .delete()
        .eq('channel_id', channel_id)
        .eq('subscriber_user_id', user.id);

      if (deleteError) {
        throw new Error(`Failed to remove subscription: ${deleteError.message}`);
      }

      // Log security event
      await supabaseService
        .from('security_events')
        .insert({
          event_type: 'subscription_removed',
          user_id: user.id,
          resource_id: channel_id,
          details: { action: 'unsubscribe', channel_id }
        });

      console.log(`✅ User ${user.id} successfully unsubscribed from channel ${channel_id}`);

    } else {
      throw new Error(`Invalid action: ${action}`);
    }

    return new Response(JSON.stringify({ 
      success: true,
      action: action,
      channel_id: channel_id 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Subscription management error:', error);
    
    // Log security violation attempts
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
      
      await supabaseService
        .from('security_events')
        .insert({
          event_type: 'subscription_security_error',
          user_id: null,
          resource_id: null,
          details: { 
            error: error.message,
            timestamp: new Date().toISOString()
          }
        });
    } catch (auditError) {
      console.error('Failed to log security event:', auditError);
    }

    return new Response(JSON.stringify({ 
      error: error.message || 'Subscription operation failed',
      success: false
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});