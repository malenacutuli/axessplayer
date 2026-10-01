const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
const MULTIPART_THRESHOLD = 100 * 1024 * 1024; // 100MB
const CHUNK_SIZE_200MB = 200 * 1024 * 1024; // 200MB chunks

const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/x-msvideo',
  'video/avi',
  'video/mpeg',
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
  useMultipart: boolean;
  partCount: number;
  partSize: number;
}

export function validateFile(
  filename: string,
  contentType: string,
  fileSize: number
): ValidationResult {
  if (fileSize <= 0) {
    return { 
      valid: false, 
      error: 'File size must be greater than 0', 
      useMultipart: false, 
      partCount: 0,
      partSize: 0,
    };
  }

  if (fileSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is 10GB`,
      useMultipart: false,
      partCount: 0,
      partSize: 0,
    };
  }

  if (!ALLOWED_VIDEO_TYPES.includes(contentType.toLowerCase())) {
    return {
      valid: false,
      error: `Invalid file type. Allowed: ${ALLOWED_VIDEO_TYPES.join(', ')}`,
      useMultipart: false,
      partCount: 0,
      partSize: 0,
    };
  }

  const useMultipart = fileSize >= MULTIPART_THRESHOLD;
  const partSize = useMultipart ? CHUNK_SIZE_200MB : fileSize;
  const partCount = useMultipart ? Math.ceil(fileSize / partSize) : 1;

  return {
    valid: true,
    useMultipart,
    partCount,
    partSize,
  };
}

export function generateUniqueFilename(originalFilename: string, userId?: string): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 10);
  const sanitizedFilename = originalFilename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .substring(0, 200);
  const prefix = userId ? `users/${userId}/` : 'uploads/';
  return `${prefix}${timestamp}-${randomStr}-${sanitizedFilename}`;
}
