import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { cacheClear } from './lib/api.js';
import { APP_VERSION } from './lib/format.js';

// Data saved by an older version may not have the shape this version expects; start clean after an update.
try {
  if (localStorage.getItem('stt_version') !== APP_VERSION) {
    cacheClear();
    localStorage.setItem('stt_version', APP_VERSION);
  }
} catch { /* storage blocked */ }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
