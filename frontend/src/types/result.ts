// Result codes from docs/openapi.json.
export type ResultCode =
  | 'SUCCESS'
  | 'INVALID_ARGUMENT'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'STORE_DISABLED'
  | 'NOT_FOUND'
  | 'LOGIN_NAME_TAKEN'
  | 'APPLICATION_EXISTS'
  | 'STORE_LIMIT_REACHED'
  | 'INVALID_STATE'
  | 'EDIT_CONFLICT'
  | 'SKU_COMBINATION_CONFLICT'
  | 'ITEM_NOT_PURCHASABLE'
  | 'INSUFFICIENT_STOCK'
  | 'PRICE_CHANGED'
  | 'ADDRESS_CHANGED'
  | 'CART_CHANGED'
  | 'PREVIEW_EXPIRED'
  | 'PAYMENT_EXPIRED'
  | 'RESTORE_EXPIRED'
  | 'FEED_EXPIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';
export type Result<T> =
  | { code: 'SUCCESS'; message: string; data: T; request_id: string }
  | {
      code: Exclude<ResultCode, 'SUCCESS'>;
      message: string;
      data: null;
      request_id: string;
      field_errors?: unknown;
      details?: unknown;
    };
