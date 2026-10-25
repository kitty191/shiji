import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { commerceAvailable } from '../api/commerce.ts';
import { Header } from './Header.tsx';
import { FloatingTools, useRailState } from './FloatingTools.tsx';
import { formatMoney, prototypeUrl, queryParams, readQuery } from '../lib/catalog.ts';
import type { CheckoutLine } from '../types/commerce.ts';

export function BuyerWorkflow({ title, subtitle, backTo = '/buyer', backLabel = '返回商城', children }: {
  title: string; subtitle: string; backTo?: string; backLabel?: string; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useRailState(), navigate = useNavigate();
  return <div className="site-shell">
    <div className="preview-note"><span>{title}预览 · {commerceAvailable ? '模拟数据' : 'API 数据'}</span><a href={prototypeUrl('buyer')} target="_blank" rel="noopener noreferrer">查看完整交互原型 ↗</a></div>
    <Header keyword="" onSearch={keyword => navigate(`/buyer?${queryParams({ ...readQuery(new URLSearchParams()), keyword })}`)} />
    <main id="main-content" className={`catalog-page workflow-page ${collapsed ? 'rail-collapsed' : ''}`}>
      <nav className="detail-breadcrumb" aria-label={`${title}导航`}><Link to={backTo}>‹ {backLabel}</Link><span>{title}</span></nav>
      <div className="cart-page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div></div>
      {children}
      <p className="catalog-note">本机虚构账号与模拟交易，不会发起实际配送或资金交易。</p>
    </main><FloatingTools collapsed={collapsed} onCollapse={setCollapsed} />
  </div>;
}
function LineImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return <span className="transaction-image">{src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} width="72" height="72" /> : '暂无图片'}</span>;
}
export function TransactionLines({ items }: { items: Omit<CheckoutLine, 'cart_item_id'>[] }) {
  return <ul className="transaction-lines">{items.map(item => <li key={item.sku_id}>
    <LineImage key={item.image_url} src={item.image_url} /><div className="transaction-item-copy"><strong>{item.name}</strong><p>{item.spec_values.map(v => v.value).join(' · ') || '默认规格'}</p><p>¥{formatMoney(item.unit_price)} × {item.quantity}</p></div>
    <strong className="transaction-line-amount">¥{formatMoney(item.line_amount)}</strong>
  </li>)}</ul>;
}
export function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return now;
}
export function remainingTime(deadline: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - Math.max(now, Date.now())) / 1000));
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}
