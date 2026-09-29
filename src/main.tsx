import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// `styles.css` must be evaluated before `App`, which pulls in the statement stylesheet
// (`report/statement.css`) through `report/ReportStatement.tsx`. Stylesheets concatenate in
// import order, and the statement's rules exist to override the app's, so this line stays first.
import "./styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
