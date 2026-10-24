import type { Result, ResultCode } from '../types/result.ts';
export class ApiError extends Error {
  constructor(public readonly code: ResultCode, message: string) { super(message); this.name = 'ApiError'; }
}
export async function get<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<Result<T>> {
  const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
  let response: Response;
  try { response = await fetch(`${base}${path}${params?.size ? `?${params}` : ''}`, { signal, credentials: 'omit' }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('SERVICE_UNAVAILABLE', '暂时无法连接服务，请稍后重试。');
  }
  let result: Result<T>;
  try { result = await response.json() as Result<T>; }
  catch { throw new ApiError('SERVICE_UNAVAILABLE', '服务暂时不可用，请稍后重试。'); }
  if (!result || typeof result.code !== 'string' || typeof result.message !== 'string' || !('data' in result) || typeof result.request_id !== 'string') {
    throw new ApiError('SERVICE_UNAVAILABLE', '服务暂时不可用，请稍后重试。');
  }
  if (!response.ok || result.code !== 'SUCCESS') throw new ApiError(result.code === 'SUCCESS' ? 'SERVICE_UNAVAILABLE' : result.code, result.message);
  return result;
}
