import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startWebviewHeartbeat } from "./perfLog";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root element");

startWebviewHeartbeat();
createRoot(container).render(<App />);
