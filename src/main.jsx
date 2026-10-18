import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/gloock/400.css';
import '@fontsource-variable/figtree';
import './styles.css';
import App from './ui/App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
