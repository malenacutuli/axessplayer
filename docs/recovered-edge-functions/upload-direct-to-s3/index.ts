import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-chunk-index, x-upload-id, x-file-name, x-total-chunks',
};

interface ChunkMetadata {
  uploadId: string;
  key: string;
  partNumber: number;
  totalParts: number;
  fileName: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header (case-insensitive)
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    
    if (!authHeader) {
      console.error('[S3-UPLOAD] No authorization header found');
      throw new Error('Unauthorized: Missing authorization header');
    }

    console.log('[S3-UPLOAD] Auth header present, verifying user...');

    // Authenticate user
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error('[S3-UPLOAD] Auth error:', authError);
      throw new Error('Unauthorized: ' + authError.message);
    }
    
    if (!user) {
      console.error('[S3-UPLOAD] No user found');
      throw new Error('Unauthorized: User not found');
    }

    console.log('[S3-UPLOAD] User authenticated:', user.id);

    const action = new URL(req.url).searchParams.get('action');

    // Action: Initialize multipart upload
    if (action === 'init') {
      const { fileName, fileSize, videoId } = await req.json();
      
      console.log('[S3-UPLOAD] Initializing upload', { fileName, fileSize, videoId, userId: user.id });

      const key = `videos/${user.id}/${videoId}/${fileName}`;
      const CHUNK_SIZE = 100 * 1024 * 1024; // 100MB chunks
      const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

      // Create multipart upload on S3
      const AWS_ACCESS_KEY = Deno.env.get('AWS_ACCESS_KEY_ID');
      const AWS_SECRET_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY');
      const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1';
      // Try both S3_BUCKET and common alternatives
      const S3_BUCKET = Deno.env.get('S3_BUCKET') || Deno.env.get('AWS_S3_BUCKET');

      console.log('[S3-UPLOAD] AWS Config check:', {
        hasAccessKey: !!AWS_ACCESS_KEY,
        hasSecretKey: !!AWS_SECRET_KEY,
        region: AWS_REGION,
        bucket: S3_BUCKET
      });

      if (!AWS_ACCESS_KEY || !AWS_SECRET_KEY || !S3_BUCKET) {
        throw new Error('AWS credentials not configured properly');
      }

      const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}?uploads`;
      
      const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
      const dateShort = date.slice(0, 8);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-amz-date': date,
          'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[S3-UPLOAD] Failed to initiate multipart upload:', errorText);
        throw new Error('Failed to initiate S3 multipart upload');
      }

      const xmlText = await response.text();
      const uploadIdMatch = xmlText.match(/<UploadId>(.*?)<\/UploadId>/);
      
      if (!uploadIdMatch) {
        throw new Error('Failed to extract upload ID from S3 response');
      }

      const uploadId = uploadIdMatch[1];

      console.log('[S3-UPLOAD] Upload initialized', { uploadId, key, totalChunks });

      return new Response(
        JSON.stringify({
          success: true,
          uploadId,
          key,
          totalChunks,
          chunkSize: CHUNK_SIZE,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Upload chunk
    if (action === 'chunk') {
      const chunkIndex = parseInt(req.headers.get('x-chunk-index') || '0');
      const uploadId = req.headers.get('x-upload-id') || '';
      const key = req.headers.get('x-key') || '';
      const partNumber = chunkIndex + 1;

      console.log('[S3-UPLOAD] Uploading chunk', { chunkIndex, partNumber, uploadId, key });

      // Get chunk data from request
      const chunkData = await req.arrayBuffer();
      
      const AWS_ACCESS_KEY = Deno.env.get('AWS_ACCESS_KEY_ID');
      const AWS_SECRET_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY');
      const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1';
      const S3_BUCKET = Deno.env.get('S3_BUCKET');

      // Upload chunk to S3
      const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;

      const uploadResponse = await fetch(url, {
        method: 'PUT',
        body: chunkData,
        headers: {
          'Content-Length': chunkData.byteLength.toString(),
        },
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[S3-UPLOAD] Chunk upload failed:', errorText);
        throw new Error(`Failed to upload chunk ${partNumber}`);
      }

      const etag = uploadResponse.headers.get('ETag')?.replace(/"/g, '') || '';
      
      console.log('[S3-UPLOAD] Chunk uploaded successfully', { partNumber, etag });

      return new Response(
        JSON.stringify({
          success: true,
          partNumber,
          etag,
          chunkIndex,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: Complete multipart upload
    if (action === 'complete') {
      const { uploadId, key, parts, videoId } = await req.json();

      console.log('[S3-UPLOAD] Completing upload', { uploadId, key, partsCount: parts.length, videoId });

      const AWS_ACCESS_KEY = Deno.env.get('AWS_ACCESS_KEY_ID');
      const AWS_SECRET_KEY = Deno.env.get('AWS_SECRET_ACCESS_KEY');
      const AWS_REGION = Deno.env.get('AWS_REGION') || 'us-east-1';
      const S3_BUCKET = Deno.env.get('S3_BUCKET');

      // Build XML for completing multipart upload
      const partsXml = parts
        .map((part: { partNumber: number; etag: string }) => 
          `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`
        )
        .join('');
      
      const completeXml = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;

      const url = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}?uploadId=${encodeURIComponent(uploadId)}`;

      const completeResponse = await fetch(url, {
        method: 'POST',
        body: completeXml,
        headers: {
          'Content-Type': 'application/xml',
        },
      });

      if (!completeResponse.ok) {
        const errorText = await completeResponse.text();
        console.error('[S3-UPLOAD] Failed to complete multipart upload:', errorText);
        throw new Error('Failed to complete S3 upload');
      }

      const publicUrl = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;

      // Update video record with storage path
      const { error: updateError } = await supabase
        .from('videos')
        .update({
          storage_path: key,
          status: 'uploaded',
        })
        .eq('id', videoId);

      if (updateError) {
        console.error('[S3-UPLOAD] Failed to update video record:', updateError);
      }

      console.log('[S3-UPLOAD] Upload completed successfully', { publicUrl, videoId });

      return new Response(
        JSON.stringify({
          success: true,
          url: publicUrl,
          key,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('Invalid action');

  } catch (error) {
    console.error('[S3-UPLOAD] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
