import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateFile, generateUniqueFilename } from '../_shared/validation.ts';
import { 
  generatePresignedUrl, 
  initiateMultipartUpload,
  generateMultipartPresignedUrls 
} from '../_shared/aws-signature.ts';
import { getPublicUrl } from '../_shared/r2-config.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface UploadRequest {
  filename: string;
  contentType: string;
  fileSize: number;
  userId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { filename, contentType, fileSize, userId }: UploadRequest = await req.json();

    console.log(`[UPLOAD-URL] Request: ${filename}, ${fileSize} bytes, ${contentType}`);

    const validation = validateFile(filename, contentType, fileSize);
    
    if (!validation.valid) {
      console.error(`[UPLOAD-URL] Validation failed: ${validation.error}`);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const uniqueFilename = generateUniqueFilename(filename, userId);

    if (validation.useMultipart) {
      console.log(`[UPLOAD-URL] Multipart: ${validation.partCount} parts of ${validation.partSize} bytes`);
      
      const uploadId = await initiateMultipartUpload(uniqueFilename, contentType);
      const partUrls = await generateMultipartPresignedUrls(
        uniqueFilename,
        uploadId,
        validation.partCount,
        contentType
      );

      console.log(`[UPLOAD-URL] Generated ${partUrls.length} presigned URLs for multipart upload`);

      return new Response(
        JSON.stringify({
          method: 'multipart',
          key: uniqueFilename,
          uploadId,
          partUrls,
          partCount: validation.partCount,
          partSize: validation.partSize,
          publicUrl: getPublicUrl(uniqueFilename),
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
      
    } else {
      console.log(`[UPLOAD-URL] Presigned URL for small file`);
      
      const uploadUrl = await generatePresignedUrl(uniqueFilename, contentType, 3600);

      return new Response(
        JSON.stringify({
          method: 'presigned',
          uploadUrl,
          key: uniqueFilename,
          publicUrl: getPublicUrl(uniqueFilename),
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

  } catch (error) {
    console.error('[UPLOAD-URL] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
