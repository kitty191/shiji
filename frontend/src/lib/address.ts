import type { AddressCreateRequest, AddressEditRequest } from '../types/address.ts';
import type { ResultCode } from '../types/result.ts';
import { buyerReturnPath } from './product.ts';

export const addressFields = [
  { name: 'recipient_name', label: '收货人', maxLength: 20 },
  { name: 'recipient_phone', label: '手机号', maxLength: 11 },
  { name: 'province', label: '省 / 直辖市', maxLength: 40 },
  { name: 'city', label: '市', maxLength: 40 },
  { name: 'district', label: '区 / 县', maxLength: 40 },
  { name: 'detail_address', label: '详细地址', maxLength: 100 },
] as const;
export type AddressField = typeof addressFields[number]['name'];
export type AddressFieldErrors = Partial<Record<AddressField, string>>;

export class AddressError extends Error {
  readonly code: ResultCode;
  readonly retryable: boolean;
  readonly fields: AddressFieldErrors;
  constructor(code: ResultCode, message: string, fields: AddressFieldErrors = {}, retryable = false) {
    super(message); this.name = 'AddressError'; this.code = code; this.fields = fields; this.retryable = retryable;
  }
}

export function emptyAddress(): AddressCreateRequest {
  return { recipient_name: '', recipient_phone: '', province: '', city: '', district: '', detail_address: '', is_default: false };
}

export function normalizeAddress(request: AddressCreateRequest): AddressCreateRequest {
  const result = emptyAddress(), fields: AddressFieldErrors = {};
  for (const field of addressFields) {
    const value = typeof request[field.name] === 'string' ? request[field.name].trim() : '';
    result[field.name] = value;
    if (!value) fields[field.name] = `请填写${field.label}。`;
    else if (value.length > field.maxLength) fields[field.name] = `${field.label}最多填写 ${field.maxLength} 个字符。`;
  }
  if (result.recipient_phone && !/^\d{11}$/.test(result.recipient_phone)) fields.recipient_phone = '手机号须为 11 位数字。';
  if (request.is_default !== undefined && typeof request.is_default !== 'boolean') throw new AddressError('INVALID_ARGUMENT', '请检查默认地址选项。');
  result.is_default = request.is_default === true;
  if (Object.keys(fields).length) throw new AddressError('INVALID_ARGUMENT', '请检查地址信息。', fields);
  return result;
}

export function addressPath(returnTo: string | null): string {
  const path = buyerReturnPath(returnTo);
  return path === '/buyer' ? '/addresses' : `/addresses?${new URLSearchParams({ return_to: path })}`;
}

export function addressEditRequest(draft: AddressCreateRequest, editToken: string): AddressEditRequest {
  if (typeof editToken !== 'string' || !editToken) throw new AddressError('INVALID_ARGUMENT', '请重新载入要编辑的地址。');
  const { is_default: _default, ...fields } = normalizeAddress(draft);
  return { ...fields, edit_token: editToken };
}
