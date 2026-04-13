import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

// Point API client to the backend server
setBaseUrl(import.meta.env.VITE_API_URL ?? "http://localhost:8080");

createRoot(document.getElementById("root")!).render(<App />);
