import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from './Icon.tsx';
import { prototypeUrl } from '../lib/catalog.ts';
import { addressPath } from '../lib/address.ts';
import { buyerContextPath } from '../lib/product.ts';
export function Header({ keyword, onSearch, storeSearch }: {
  keyword: string; onSearch: (keyword: string) => void; storeSearch?: { name?: string; onSearchAll: (keyword: string) => void };
}) {
  const [draft, setDraft] = useState(keyword), [open, setOpen] = useState(false);
  const location = useLocation();
  const returnPath = location.pathname === '/buyer' ? `${location.pathname}${location.search}` : buyerContextPath(new URLSearchParams(location.search).get('return_to'));
  const account = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => setDraft(keyword), [keyword]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!account.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  function submit(event: FormEvent) { event.preventDefault(); onSearch(draft.trim()); }
  return <header className="site-header">
    <div className="brand-row"><Link className="brand" to="/buyer" aria-label="拾集首页"><span className="brand-mark">拾</span><span>拾集</span></Link>
      <div className="account" ref={account} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        <button className="account-trigger" ref={trigger} aria-expanded={open} aria-controls="account-menu" onClick={() => setOpen(value => !value)}>
          <span className="avatar">拾</span><span className="account-copy"><strong>拾光同学</strong><small>正在逛商城</small></span><Icon name="chevron" />
        </button>
        {open && <nav id="account-menu" className="account-menu" aria-label="账号菜单"><p>拾光同学 <small>原型演示账号</small></p>
          {[['profile', '个人资料'], ['orders', '我的订单'], ['addresses', '收货地址'], ['opening', '商家中心']].map(([page, text]) => (page === 'addresses' || page === 'orders')
            ? <Link key={page} to={page === 'orders' ? '/orders' : addressPath(returnPath)} onClick={() => setOpen(false)}>{text}</Link>
            : <a key={page} href={prototypeUrl(page)} target="_blank" rel="noopener noreferrer" title={`${text}（在新标签页查看原型）`}>{text}<span aria-hidden="true">↗</span></a>)}
          <Link to="/merchant/products" onClick={() => setOpen(false)}>店铺商品</Link>
          <Link to="/merchant/orders" onClick={() => setOpen(false)}>店铺订单</Link>
        </nav>}
      </div>
    </div>
    <form className="search" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor="search-keyword">{storeSearch ? '搜索本店商品' : '搜索商品或店铺'}</label>
      <input id="search-keyword" value={draft} maxLength={120} placeholder={storeSearch ? storeSearch.name ? `在${storeSearch.name}中搜索` : '搜索本店商品' : '搜索喜欢的商品或店铺'} onChange={event => setDraft(event.target.value)} />
      <button className="button button--primary" type="submit"><Icon name="search" />{storeSearch ? '搜本店' : '搜索'}</button>
      {storeSearch && <button className="text-button search-all" type="button" onClick={() => storeSearch.onSearchAll(draft.trim())}>搜全站</button>}
    </form>
  </header>;
}
