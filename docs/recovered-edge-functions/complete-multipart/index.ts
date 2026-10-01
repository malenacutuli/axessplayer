import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { R2_CONFIG } from '../_shared/r2-config.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Part {
  PartNumber: number;
  ETag: string;
}

interface CompleteRequest {
  key: string;
  uploadId: string;
  parts: Part[];
}

async function sha256(message: string): Promise<ArrayBuffer> {
  const msgBuffer = new TextEncoder().encode(message);
  return await crypto.subtle.digest('SHA-256', msgBuffer);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const msgBuffer = new TextEncoder().encode(message);
  return await crypto.subtle.sign('HMAC', cryptoKey, msgBuffer);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getAmzDate(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
}

async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: Part[]
): Promise<void> {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = R2_CONFIG;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucketName}/${key}?uploadId=${uploadId}`;

  const partsXml = parts
    .sort((a, b) => a.PartNumber - b.PartNumber)
    .map(
      (part) =>
        `<Part><PartNumber>${part.PartNumber}</PartNumber><ETag>${part.ETag}</ETag></Part>`
    )
    .join('');
  const body = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;

  const amzDate = getAmzDate();
  const dateStamp = amzDate.substring(0, 8);

  const canonicalUri = `/${bucketName}/${key}`;
  const canonicalQuerystring = `uploadId=${uploadId}`;
  const payloadHash = toHex(await sha256(body));
  const canonicalHeaders = `content-type:application/xml\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'POST',
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const canonicalRequestHash = toHex(await sha256(canonicalRequest));
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  const kDate = await hmacSha256(
    new TextEncoder().encode(`AWS4${secretAccessKey}`),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, 'auto');
  const kService = await hmacSha256(kRegion, 's3');
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Host': host,
      'Content-Type': 'application/xml',
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to complete multipart upload: ${error}`);
  }

  console.log(`[COMPLETE-MULTIPART] Successfully completed upload for ${key}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { key, uploadId, parts }: CompleteRequest = await req.json();

    console.log(`[COMPLETE-MULTIPART] Completing: ${key}, ${parts.length} parts`);

    await completeMultipartUpload(key, uploadId, parts);

    return new Response(
      JSON.stringify({ success: true, message: 'Upload completed successfully' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[COMPLETE-MULTIPART] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
