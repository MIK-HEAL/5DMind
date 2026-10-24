import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { SettingsProvider } from "./state/SettingsProvider";
import { WorkspaceProvider } from "./state/WorkspaceProvider";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </SettingsProvider>
  </StrictMode>,
);
