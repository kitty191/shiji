import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Navigate, Outlet, RouterProvider, ScrollRestoration } from 'react-router-dom';
import { BuyerHome } from './pages/BuyerHome.tsx';
import { ProductDetail } from './pages/ProductDetail.tsx';
import { StorePage } from './pages/StorePage.tsx';
import { CartPage } from './pages/CartPage.tsx';
import { CartProvider } from './components/CartProvider.tsx';
import { AddressProvider } from './components/AddressProvider.tsx';
import { AddressesPage } from './pages/AddressesPage.tsx';
import { CheckoutPage } from './pages/CheckoutPage.tsx';
import { OrdersPage } from './pages/OrdersPage.tsx';
import { OrderDetailPage } from './pages/OrderDetailPage.tsx';
import { MerchantOrdersPage } from './pages/MerchantOrdersPage.tsx';
import { MerchantOrderDetailPage } from './pages/MerchantOrderDetailPage.tsx';
import { PaymentResultPage } from './pages/PaymentResultPage.tsx';
import { PaymentPage } from './pages/PaymentPage.tsx';
import { CommerceProvider } from './components/CommerceProvider.tsx';
import './styles.css';

const router = createHashRouter([{
  element: <AddressProvider><CartProvider><CommerceProvider><Outlet /><ScrollRestoration /></CommerceProvider></CartProvider></AddressProvider>, children: [
    { path: '/', element: <Navigate to="/buyer" replace /> },
    { path: '/buyer', element: <BuyerHome /> },
    { path: '/cart', element: <CartPage /> },
    { path: '/addresses', element: <AddressesPage /> },
    { path: '/checkout', element: <CheckoutPage /> },
    { path: '/payments/:paymentId', element: <PaymentPage /> },
    { path: '/payments/:paymentId/result', element: <PaymentResultPage /> },
    { path: '/merchant/orders', element: <MerchantOrdersPage /> },
    { path: '/merchant/orders/:orderId', element: <MerchantOrderDetailPage /> },
    { path: '/orders', element: <OrdersPage /> },
    { path: '/orders/:orderId', element: <OrderDetailPage /> },
    { path: '/products/:productId', element: <ProductDetail /> },
    { path: '/stores/:storeId', element: <StorePage /> },
    { path: '*', element: <main className="route-error"><h1>没有找到这个页面</h1><a href="#/buyer">返回首页</a></main> },
  ]
}]);
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
