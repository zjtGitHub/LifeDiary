import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { VaultGate } from "./components/VaultGate";
import { privateMode } from "./lib/vault/storage";
import "./styles.css";
import "./stocks.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {privateMode ? <VaultGate><App /></VaultGate> : <App />}
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch(() => {
      // The app still works normally when service workers are unavailable.
    });
  });
}
