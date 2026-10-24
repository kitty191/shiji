import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from './Icon.tsx';
import { prototypeUrl } from '../lib/catalog.ts';
import { useCart } from './CartContext.ts';
import { CartPanel } from './CartPanel.tsx';
const storedCollapsed = () => { try { return localStorage.getItem('shiji:rail-collapsed') === 'true'; } catch { return false; } };
export function FloatingTools({ collapsed, onCollapse }: { collapsed: boolean; onCollapse: (value: boolean) => void }) {
  const { state, open, show, close } = useCart();
  const location = useLocation();
  const onCartPage = location.pathname === '/cart';
  const cartTrigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 220, showBack: false });
  useEffect(() => {
    let pending = 0;
    function update() {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setPosition({
        top: Math.max(24, Math.min(220, window.innerHeight - 320) - window.scrollY),
        showBack: window.scrollY >= window.innerHeight * 2,
      }));
    }
    update(); window.addEventListener('scroll', update, { passive: true }); window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(pending); window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
  return <>
    <aside className={`floating-tools ${collapsed ? 'is-collapsed' : ''}`} style={{ top: position.top }} aria-label="快捷工具栏">
      {collapsed ? <button className="rail-handle" onClick={() => onCollapse(false)} aria-label="展开工具栏">工具栏 ‹</button> : <>
        {onCartPage ? <Link className="cart-trigger" to={`${location.pathname}${location.search}`} aria-current="page" aria-label={`购物车，${state.view.quantity_total} 件商品`}><Icon name="cart" /><span>购物车</span>{state.view.quantity_total > 0 && <small className="cart-badge" aria-hidden="true">{state.view.quantity_total > 99 ? '99+' : state.view.quantity_total}</small>}</Link> : <button ref={cartTrigger} className="cart-trigger" aria-expanded={open} aria-controls="cart-panel" aria-label={`购物车，${state.view.quantity_total} 件商品`} onClick={() => open ? close() : show()}><Icon name="cart" /><span>购物车</span>{state.view.quantity_total > 0 && <small className="cart-badge" aria-hidden="true">{state.view.quantity_total > 99 ? '99+' : state.view.quantity_total}</small>}</button>}
        <a href={prototypeUrl('messages')} target="_blank" rel="noopener noreferrer" title="在新标签页查看消息原型"><Icon name="message" /><span>消息</span></a>
        <a href={prototypeUrl('buyer')} target="_blank" rel="noopener noreferrer" title="在完整原型的右侧工具栏查看客服"><Icon name="help" /><span>客服</span></a>
        <button className="rail-collapse" onClick={() => { close(); onCollapse(true); }} aria-label="收起工具栏">收起 ›</button>
      </>}
    </aside>
    {open && !onCartPage && <CartPanel top={position.top} trigger={cartTrigger} />}
    {position.showBack && <button className={`back-top ${collapsed ? 'is-collapsed' : ''}`} onClick={() => window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}><Icon name="up" /><span>返回顶部</span></button>}
  </>;
}
export function useRailState(): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  return [collapsed, value => { setCollapsed(value); try { localStorage.setItem('shiji:rail-collapsed', String(value)); } catch { /* Persistence is optional. */ } }];
}
