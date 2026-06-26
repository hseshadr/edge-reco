import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

// Auto-update: a new shell is fetched in the background and taken over on the next
// load. Bundle updates flow through OPFS sync independently of this. No-ops where
// service workers are unavailable.
registerSW({ immediate: true });

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Root element #root not found");
createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
