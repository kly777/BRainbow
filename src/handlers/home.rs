use axum::response::Html;

pub async fn handler() -> Html<&'static str> {
    Html("<a href=\"/graphql\">Graphql</a>")
}
