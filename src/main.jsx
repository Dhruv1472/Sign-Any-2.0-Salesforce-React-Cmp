import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import ThankYou from "./pages/ThankYou.jsx";
import Rejected from "./pages/Rejected.jsx";
import NotFound from "./pages/NotFound.jsx";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<App />} />
                <Route path="/thank-you" element={<ThankYou />} />
                <Route path="/rejected" element={<Rejected />} />
                {/* Catch-all route - redirects to root with preserved parameters */}
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    </StrictMode>
);
