import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ConsoleProvider } from './console-store';
import './styles/tokens.css';

const container = document.querySelector<HTMLElement>('#shell-root');
if (!container) throw new Error('#shell-root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ConsoleProvider>
      <App />
    </ConsoleProvider>
  </StrictMode>,
);
