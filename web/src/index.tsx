import { Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { AuthProvider } from "./auth/context.tsx";
import Layout from "./Layout.tsx";
import { ROUTES, toRouteDefs } from "./routes.ts";
import "@/global.css";

function App() {
    return (
        <AuthProvider>
            <Router root={Layout}>{toRouteDefs(ROUTES)}</Router>
        </AuthProvider>
    );
}

const root = document.getElementById("app");
if (!root) {
    const el = document.createElement("div");
    el.id = "app";
    document.body.appendChild(el);
    render(() => <App />, el);
} else {
    render(() => <App />, root);
}
