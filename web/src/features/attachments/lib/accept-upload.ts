import { ALLOWED_UPLOAD_MIME_TYPES } from '@coretask/contracts';
import { toast } from 'sonner';

export const MAX_FILE_SIZE_MB = 25;

/**
 * Checked client-side as well as on the server so the person picking a 400 MB
 * video finds out immediately rather than after uploading it. The API still
 * decides.
 */
export function acceptUpload(file: File): boolean {
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    toast.error(`${file.name} is larger than ${MAX_FILE_SIZE_MB} MB.`);
    return false;
  }
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type)) {
    toast.error(`${file.name} is not a supported file type.`);
    return false;
  }
  return true;
}
