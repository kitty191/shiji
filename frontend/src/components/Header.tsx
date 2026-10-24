import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from './Icon.tsx';
import { prototypeUrl } from '../lib/catalog.ts';
export function Header({ keyword, onSearch }: { keyword: string; onSearch: (keyword: string) => void }) {
  const [draft, setDraft] = useState(keyword), [open, setOpen] = useState(false);
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
    <div className="brand-row"><a className="brand" href="#/buyer" aria-label="拾集首页"><span className="brand-mark">拾</span><span>拾集</span></a>
      <div className="account" ref={account} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
        <button className="account-trigger" ref={trigger} aria-expanded={open} aria-controls="account-menu" onClick={() => setOpen(value => !value)}>
          <span className="avatar">拾</span><span className="account-copy"><strong>拾光同学</strong><small>正在逛商城</small></span><Icon name="chevron" />
        </button>
        {open && <nav id="account-menu" className="account-menu" aria-label="账号菜单"><p>拾光同学 <small>原型演示账号</small></p>
          {[['profile', '个人资料'], ['orders', '我的订单'], ['addresses', '收货地址'], ['opening', '商家中心']].map(([page, text]) => <a key={page} href={prototypeUrl(page)} target="_blank" rel="noopener noreferrer" title={`${text}（在新标签页查看原型）`}>{text}<span aria-hidden="true">↗</span></a>)}
        </nav>}
      </div>
    </div>
    <form className="search" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor="search-keyword">搜索商品或店铺</label>
      <input id="search-keyword" value={draft} maxLength={120} placeholder="搜索喜欢的商品或店铺" onChange={event => setDraft(event.target.value)} />
      <button className="button button--primary" type="submit"><Icon name="search" />搜索</button>
    </form>
  </header>;
}
