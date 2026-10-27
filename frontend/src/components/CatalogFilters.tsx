import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { CatalogQuery, Category, Sort } from '../types/catalog.ts';
import { formatMoney, priceToCents, queryParams } from '../lib/catalog.ts';
import { Icon } from './Icon.tsx';

type QueryPatch = Partial<Omit<CatalogQuery, 'feed_token'>>;
export function CatalogFilters({ query, categories, onChange: update, onClear }: {
  query: CatalogQuery; categories: Category[]; onChange: (patch: QueryPatch) => void; onClear: () => void;
}) {
  const priceKey = queryParams({ ...query, feed_token: undefined }).toString();
  const [minimum, setMinimum] = useState(''), [maximum, setMaximum] = useState(''), [priceError, setPriceError] = useState('');
  useEffect(() => {
    setMinimum(query.min_price === undefined ? '' : String(query.min_price / 100));
    setMaximum(query.max_price === undefined ? '' : String(query.max_price / 100)); setPriceError('');
  }, [priceKey]);
  function applyPrice(event: FormEvent) {
    event.preventDefault();
    try {
      const min_price = priceToCents(minimum), max_price = priceToCents(maximum);
      if (min_price !== undefined && max_price !== undefined && min_price > max_price) throw new Error('最低价不能高于最高价。');
      setPriceError(''); update({ min_price, max_price });
    } catch (reason) { setPriceError(reason instanceof Error ? reason.message : '请检查价格。'); }
  }
  const active = !!query.keyword || !!query.category_id || query.min_price !== undefined || query.max_price !== undefined;
  const sorts: [Sort, string][] = [['default', '综合'], ['price_asc', '价格 ↑'], ['price_desc', '价格 ↓'], ['newest', '最新上架']];
  return (
      <section className="catalog-tools" aria-label="筛选与排序">
        <div className="filter-row">
          <label className="category-picker"><span className="sr-only">商品分类</span><select aria-label="商品分类" value={query.category_id} onChange={event => update({ category_id: event.target.value })}><option value="">全部分类</option>{query.category_id && !categories.some(category => category.category_id === query.category_id) && <option value={query.category_id}>已选分类</option>}{categories.map(category => <option key={category.category_id} value={category.category_id}>{category.name}</option>)}</select><Icon name="chevron" /></label>
          <form className="price-filter" onSubmit={applyPrice} aria-label="价格区间">
            <label><span aria-hidden="true">¥</span><input aria-label="最低价，单位元" inputMode="decimal" value={minimum} maxLength={12} placeholder="最低价" onChange={event => setMinimum(event.target.value)} aria-describedby={priceError ? 'price-error' : undefined} /></label><span className="price-dash" aria-hidden="true">–</span>
            <label><span aria-hidden="true">¥</span><input aria-label="最高价，单位元" inputMode="decimal" value={maximum} maxLength={12} placeholder="最高价" onChange={event => setMaximum(event.target.value)} aria-describedby={priceError ? 'price-error' : undefined} /></label>
            <button className="button" type="submit">应用</button><button className="text-button" type="button" onClick={() => { setMinimum(''); setMaximum(''); setPriceError(''); update({ min_price: undefined, max_price: undefined }); }}>重置</button>
          </form>
        </div>
        {priceError && <p id="price-error" className="field-error" role="alert">{priceError}</p>}
        {active && <div className="filter-summary" aria-label="已应用的筛选条件">
          {query.keyword && <button onClick={() => update({ keyword: '' })}>关键词：{query.keyword} <Icon name="close" /></button>}
          {query.category_id && <button onClick={() => update({ category_id: '' })}>分类：{categories.find(category => category.category_id === query.category_id)?.name || '所选分类'} <Icon name="close" /></button>}
          {(query.min_price !== undefined || query.max_price !== undefined) && <button onClick={() => update({ min_price: undefined, max_price: undefined })}>价格：{query.min_price === undefined ? '不限' : `¥${formatMoney(query.min_price)}`} – {query.max_price === undefined ? '不限' : `¥${formatMoney(query.max_price)}`} <Icon name="close" /></button>}
          <button className="text-button" onClick={onClear}>清空条件</button>
        </div>}
        <nav className="sort-row" aria-label="商品排序">{sorts.map(([value, label]) => <button key={value} aria-pressed={query.sort === value} onClick={() => update({ sort: value })}>{label}</button>)}</nav>
      </section>
  );
}
