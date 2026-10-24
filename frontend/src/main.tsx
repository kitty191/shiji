import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { BuyerHome } from './pages/BuyerHome.tsx';
import './styles.css';

const router = createHashRouter([
  { path: '/', element: <Navigate to="/buyer" replace /> },
  { path: '/buyer', element: <BuyerHome /> },
  { path: '*', element: <main className="route-error"><h1>没有找到这个页面</h1><a href="#/buyer">返回首页</a></main> },
]);
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
