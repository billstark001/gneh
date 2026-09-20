import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app host');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
