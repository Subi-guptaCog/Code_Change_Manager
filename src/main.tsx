import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign iframe WebSocket and HMR script warnings
if (typeof window !== "undefined") {
  // Catch typical global runtime script error boundaries
  const originalOnerror = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    const msg = String(message || "");
    if (
      msg.includes("WebSocket") ||
      msg.includes("websocket") ||
      msg.includes("Script error") ||
      msg.toLowerCase().includes("failed to connect")
    ) {
      return true; // Stop event from propagating/showing up in alert overlays
    }
    if (originalOnerror) {
      return originalOnerror.apply(this, arguments as any);
    }
    return false;
  };

  const originalConsoleError = console.error;
  console.error = function (...args) {
    const combined = args.join(" ");
    if (
      combined.includes("WebSocket") ||
      combined.includes("websocket") ||
      combined.includes("Script error") ||
      combined.toLowerCase().includes("failed to connect")
    ) {
      return;
    }
    originalConsoleError.apply(console, args);
  };

  const originalConsoleWarn = console.warn;
  console.warn = function (...args) {
    const combined = args.join(" ");
    if (
      combined.includes("WebSocket") ||
      combined.includes("websocket") ||
      combined.includes("Script error") ||
      combined.toLowerCase().includes("failed to connect")
    ) {
      return;
    }
    originalConsoleWarn.apply(console, args);
  };

  window.addEventListener("unhandledrejection", (event) => {
    const reasonStr = String(event.reason || "");
    const reasonMsg = String(event.reason?.message || "");
    if (
      reasonStr.includes("WebSocket") ||
      reasonStr.includes("websocket") ||
      reasonMsg.includes("WebSocket") ||
      reasonMsg.includes("websocket") ||
      reasonStr.includes("Script error")
    ) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  });

  window.addEventListener("error", (event) => {
    const msg = String(event.message || "");
    if (
      msg.includes("WebSocket") ||
      msg.includes("websocket") ||
      msg.includes("Script error") ||
      msg.toLowerCase().includes("failed to connect")
    ) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
