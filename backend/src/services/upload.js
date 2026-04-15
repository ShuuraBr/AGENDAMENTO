import { createDocumentUpload, createAvariaImageUpload, AVARIA_IMAGE_MAX_BYTES, AVARIA_IMAGE_MAX_COUNT, AVARIA_ALLOWED_MIME_TYPES } from '../utils/upload-policy.js';

export const upload = createDocumentUpload();
export const uploadAvaria = createAvariaImageUpload();
export const uploadPolicy = {
  avaria: {
    maxBytes: AVARIA_IMAGE_MAX_BYTES,
    maxCount: AVARIA_IMAGE_MAX_COUNT,
    allowedMimeTypes: AVARIA_ALLOWED_MIME_TYPES
  }
};
