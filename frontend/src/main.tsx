import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Navigate, Outlet, RouterProvider, ScrollRestoration } from 'react-router-dom';
import { BuyerHome } from './pages/BuyerHome.tsx';
import { ProductDetail } from './pages/ProductDetail.tsx';
import { CartPage } from './pages/CartPage.tsx';
import { CartProvider } from './components/CartProvider.tsx';
import './styles.css';

const router = createHashRouter([{ element: <CartProvider><Outlet /><ScrollRestoration /></CartProvider>, children: [
  { path: '/', element: <Navigate to="/buyer" replace /> },
  { path: '/buyer', element: <BuyerHome /> },
  { path: '/cart', element: <CartPage /> },
  { path: '/products/:productId', element: <ProductDetail /> },
  { path: '*', element: <main className="route-error"><h1>没有找到这个页面</h1><a href="#/buyer">返回首页</a></main> },
] }]);
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
