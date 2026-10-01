export const R2_CONFIG = {
  accountId: Deno.env.get('CLOUDFLARE_R2_ACCOUNT_ID')!,
  accessKeyId: Deno.env.get('CLOUDFLARE_R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('CLOUDFLARE_R2_SECRET_ACCESS_KEY')!,
  bucketName: Deno.env.get('CLOUDFLARE_R2_BUCKET_NAME')!,
  endpoint: `https://${Deno.env.get('CLOUDFLARE_R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  publicUrl: 'https://pub-39b722100bf84ae6bb7fee3bbbdb93bb.r2.dev',
};

export function getR2Endpoint(): string {
  return `${R2_CONFIG.endpoint}/${R2_CONFIG.bucketName}`;
}

export function getPublicUrl(key: string): string {
  return `${R2_CONFIG.publicUrl}/${key}`;
}
