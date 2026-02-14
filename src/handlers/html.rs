use axum::{
    extract::{Path, State},
    response::{Html, IntoResponse},
};
use askama::Template;
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait};

use crate::entity::{onto, signifier_signified};
use crate::state::AppState;

// 模板结构体
#[derive(Template)]
#[template(path = "ontos.html")]
struct OntosTemplate {
    ontos: Vec<onto::Model>,
}

#[derive(Template)]
#[template(path = "onto_detail.html")]
struct OntoDetailTemplate {
    onto: onto::Model,
    signifiers: Vec<signifier_signified::Model>,
    signifieds: Vec<signifier_signified::Model>,
}

#[derive(Template)]
#[template(path = "signs.html")]
struct SignsTemplate {
    signs: Vec<signifier_signified::Model>,
}

#[derive(Template)]
#[template(path = "sign_detail.html")]
struct SignDetailTemplate {
    sign: signifier_signified::Model,
}

// 本体列表页面
pub async fn ontos_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    match onto::Entity::find().all(&*state.db).await {
        Ok(ontos) => {
            let template = OntosTemplate { ontos };
            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Err(e) => {
            eprintln!("数据库查询错误: {}", e);
            Html(format!("数据库查询错误: {}", e)).into_response()
        }
    }
}

// 本体详情页面
pub async fn onto_detail_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    // 获取本体信息
    let onto_result = onto::Entity::find_by_id(id).one(&*state.db).await;

    match onto_result {
        Ok(Some(onto)) => {
            // 获取作为能指的关系
            let signifiers_result = signifier_signified::Entity::find()
                .filter(signifier_signified::Column::SignifierId.eq(id))
                .all(&*state.db)
                .await;

            // 获取作为所指的关系
            let signifieds_result = signifier_signified::Entity::find()
                .filter(signifier_signified::Column::SignifiedId.eq(id))
                .all(&*state.db)
                .await;

            let signifiers = signifiers_result.unwrap_or_default();
            let signifieds = signifieds_result.unwrap_or_default();

            let template = OntoDetailTemplate {
                onto,
                signifiers,
                signifieds,
            };

            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Ok(None) => {
            Html(format!("未找到ID为 {} 的本体", id)).into_response()
        }
        Err(e) => {
            eprintln!("数据库查询错误: {}", e);
            Html(format!("数据库查询错误: {}", e)).into_response()
        }
    }
}

// 关系列表页面
pub async fn signs_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    match signifier_signified::Entity::find().all(&*state.db).await {
        Ok(signs) => {
            let template = SignsTemplate { signs };
            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Err(e) => {
            eprintln!("数据库查询错误: {}", e);
            Html(format!("数据库查询错误: {}", e)).into_response()
        }
    }
}

// 关系详情页面
pub async fn sign_detail_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match signifier_signified::Entity::find_by_id(id).one(&*state.db).await {
        Ok(Some(sign)) => {
            let template = SignDetailTemplate { sign };
            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Ok(None) => {
            Html(format!("未找到ID为 {} 的关系", id)).into_response()
        }
        Err(e) => {
            eprintln!("数据库查询错误: {}", e);
            Html(format!("数据库查询错误: {}", e)).into_response()
        }
    }
}

// 按能指查询关系页面
pub async fn signs_by_signifier_handler(
    State(state): State<AppState>,
    Path(signifier_id): Path<i32>,
) -> impl IntoResponse {
    // 获取本体信息
    let onto_result = onto::Entity::find_by_id(signifier_id).one(&*state.db).await;

    match onto_result {
        Ok(Some(onto)) => {
            // 获取作为能指的关系
            let signs_result = signifier_signified::Entity::find()
                .filter(signifier_signified::Column::SignifierId.eq(signifier_id))
                .all(&*state.db)
                .await;

            let signs = signs_result.unwrap_or_default();

            // 使用本体详情模板，但只显示能指关系
            let template = OntoDetailTemplate {
                onto,
                signifiers: signs.clone(),
                signifieds: vec![],
            };

            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Ok(None) => {
            Html(format!("未找到ID为 {} 的本体", signifier_id)).into_response()
        }
        Err(e) => {
            eprintln!("数据库查询错误: {}", e);
            Html(format!("数据库查询错误: {}", e)).into_response()
        }
    }
}

// 按所指查询关系页面
pub async fn signs_by_signified_handler(
    State(state): State<AppState>,
    Path(signified_id): Path<i32>,
) -> impl IntoResponse {
    // 获取本体信息
    let onto_result = onto::Entity::find_by_id(signified_id).one(&*state.db).await;

    match onto_result {
        Ok(Some(onto)) => {
            // 获取作为所指的关系
            let signs_result = signifier_signified::Entity::find()
                .filter(signifier_signified::Column::SignifiedId.eq(signified_id))
                .all(&*state.db)
                .await;

            let signs = signs_result.unwrap_or_default();

            // 使用本体详情模板，但只显示所指关系
            let template = OntoDetailTemplate {
                onto,
                signifiers: vec![],
                signifieds: signs,
            };

            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Ok(None) => {
            Html(format!("未找到ID为 {} 的本体", signified_id)).into_response()
        }
        Err(e) => {
            eprintln!("数据库查询错误: {}", e);
            Html(format!("数据库查询错误: {}", e)).into_response()
        }
    }
}
