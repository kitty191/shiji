import type { DraftFields } from '../types/merchantProduct.ts';
import { CommerceError } from './commerce.ts';
import { centsToYuan } from './catalog.ts';
export interface DraftForm {
  title: string;
  category_id: string;
  description: string;
  price: string;
}
export class DraftInputError extends CommerceError {
  field: keyof DraftForm;
  constructor(field: keyof DraftForm, message: string) {
    super('INVALID_ARGUMENT', message);
    this.field = field;
  }
}
export function draftForm(fields: DraftFields): DraftForm {
  return {
    title: fields.title ?? '',
    category_id: fields.category_id ?? '',
    description: fields.description ?? '',
    price: fields.display_price_override === null ? '' : centsToYuan(fields.display_price_override),
  };
}
export function draftFields(form: DraftForm): DraftFields {
  const raw = form.price.trim();
  let price: number | null = null;
  if (raw) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw))
      throw new DraftInputError('price', '展示价请填写非负金额，最多两位小数，或留空。');
    const [whole, decimal = ''] = raw.split('.');
    price = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
    if (!Number.isSafeInteger(price))
      throw new DraftInputError('price', '展示价金额过大，请检查输入。');
  }
  return {
    title: form.title.trim() || null,
    category_id: form.category_id || null,
    description: form.description.trim() || null,
    display_price_override: price,
  };
}
