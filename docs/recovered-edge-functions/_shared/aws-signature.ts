import { R2_CONFIG } from './r2-config.ts';

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

function getDateStamp(amzDate: string): string {
  return amzDate.substring(0, 8);
}

export async function generatePresignedUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucketName, endpoint } = R2_CONFIG;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const baseEndpoint = `https://${host}`;
  const region = 'auto';
  const service = 's3';
  
  const amzDate = getAmzDate();
  const dateStamp = getDateStamp(amzDate);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = `/${bucketName}/${key}`;
  const canonicalQuerystring = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresIn.toString(),
    'X-Amz-SignedHeaders': 'host',
  }).toString();

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

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
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');

  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  return `${baseEndpoint}${canonicalUri}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;
}

export async function initiateMultipartUpload(
  key: string,
  contentType: string
): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = R2_CONFIG;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucketName}/${key}?uploads`;
  
  const amzDate = getAmzDate();
  const dateStamp = getDateStamp(amzDate);

  const canonicalUri = `/${bucketName}/${key}`;
  const canonicalQuerystring = 'uploads=';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const payloadHash = 'UNSIGNED-PAYLOAD';

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
      'Content-Type': contentType,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
      'Authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to initiate multipart upload: ${error}`);
  }

  const xmlText = await response.text();
  const uploadIdMatch = xmlText.match(/<UploadId>([^<]+)<\/UploadId>/);
  
  if (!uploadIdMatch) {
    throw new Error('Failed to extract UploadId from response');
  }

  return uploadIdMatch[1];
}

export async function generateMultipartPresignedUrls(
  key: string,
  uploadId: string,
  partCount: number,
  contentType: string
): Promise<string[]> {
  const urls: string[] = [];
  
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    const partKey = `${key}?partNumber=${partNumber}&uploadId=${uploadId}`;
    const url = await generatePresignedUrl(partKey, contentType, 3600);
    urls.push(url);
  }
  
  return urls;
}
