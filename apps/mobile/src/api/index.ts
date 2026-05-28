export { api, API_BASE_URL, ApiError, unwrap } from './client';
export { authApi } from './endpoints/auth';
export type { AuthUser, AuthTokens, OtpSendResponse, OtpVerifyResponse } from './endpoints/auth';
export { uploadFile, getMediaAsset } from './media';
export type {
  UploadableAsset,
  UploadOptions,
  UploadProgressEvent,
  UploadResult,
  MediaReadDescriptor,
} from './media';
