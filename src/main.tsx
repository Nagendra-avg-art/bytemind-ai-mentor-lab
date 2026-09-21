import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * main.tsx
 * 
 * WHY THIS FILE IS NEEDED:
 * This is the JavaScript/TypeScript entry point for Vite and React.
 * 
 * 1. It finds the HTML root container (<div id="root"></div> in index.html).
 * 2. It initializes the React 18 Concurrent Root via `ReactDOM.createRoot()`.
 * 3. It mounts our top-level <App /> component inside React.StrictMode 
 *    (which helps detect potential side-effects and bugs during development).
 * 4. It imports global stylesheet `index.css`.
 */

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element with id "root". Check index.html.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
