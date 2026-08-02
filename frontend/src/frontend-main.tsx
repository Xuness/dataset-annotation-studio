import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initializeRuntimePlatform } from "./shared/desktop/runtimePlatform";
import { FrontendApp } from "./v2/app/FrontendApp";
import "./v2/styles/reset.css";
import "./v2/styles/shell.css";

initializeRuntimePlatform();

const root = document.getElementById("root");
if (!root) throw new Error('Application root element "#root" was not found.');

createRoot(root).render(
  <StrictMode>
    <FrontendApp />
  </StrictMode>,
);
