import { Route, Router } from "@solidjs/router";
import { lazy } from "solid-js";
import { render } from "solid-js/web";
import { AuthProvider } from "./auth/context.tsx";
import Layout from "./Layout.tsx";
import "@/global.css";
import "@/normalize.css";

const HomePage = lazy(() => import("./pages/HomePage.tsx"));
const TaskManagerPage = lazy(() => import("./pages/TaskManager.tsx"));
const OntologyListPage = lazy(() =>
    import("./pages/ontology/OntologyList.tsx")
);
const CardsListPage = lazy(() => import("./pages/notes/CardsList.tsx"));
const CardDetailPage = lazy(() => import("./pages/notes/CardDetail.tsx"));
const CardEditPage = lazy(() => import("./pages/notes/CardEdit.tsx"));
const ImagesListPage = lazy(() => import("./pages/notes/ImagesList.tsx"));
const DbViewerPage = lazy(() => import("./pages/DbViewer.tsx"));
const RainbowDrawer = lazy(() => import("./pages/RainbowGenerator.tsx"));

function App() {
    return (
        <AuthProvider>
            <Router root={Layout}>
                <Route path="/" component={() => <HomePage />} />
                <Route path="/t" component={() => <TaskManagerPage />} />
                <Route path="/o" component={() => <OntologyListPage />} />
                <Route path="/c" component={() => <CardsListPage />} />
                <Route path="/c/:id" component={() => <CardDetailPage />} />
                <Route path="/c/edit/:id" component={() => <CardEditPage />} />
                <Route path="/i" component={() => <ImagesListPage />} />
                <Route path="/db" component={() => <DbViewerPage />} />
                <Route path="/rd" component={() => <RainbowDrawer />} />
            </Router>
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
