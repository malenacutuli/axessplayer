import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Disabled. This slug was a temporary diagnostic probe and is no longer in use.
// Delete it from the Supabase dashboard (Edge Functions > axess-signapse-probe).
Deno.serve(() =>
  new Response(JSON.stringify({ disabled: true }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
