import { mountApp } from "./app/mountApp";
import { LegacyApp } from "./legacy/LegacyApp";
import { initializeRuntimePlatform } from "../src/shared/desktop/runtimePlatform";
import { initializeAppPreferences } from "./shared/theme/appPreferences";
import "./styles/global.css";

initializeRuntimePlatform();
initializeAppPreferences();
mountApp(<LegacyApp />);
