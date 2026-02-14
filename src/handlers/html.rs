use axum::{extract::{Path, State}, response::{Html, IntoResponse}};
use askama::Template;

use crate::entity::{onto, signifier_signified, user};
use crate::state::AppState;
use crate::services::html::HtmlService;

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

// 用户列表模板
#[derive(Template)]
#[template(path = "users.html")]
struct UsersTemplate {
    users: Vec<user::Model>,
}

// 用户详情模板
#[derive(Template)]
#[template(path = "user_detail.html")]
struct UserDetailTemplate {
    user: user::Model,
}

// 用户列表页面
pub async fn users_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let html_service = HtmlService::new(state.db.clone());
    
    match html_service.get_users_for_html().await {
        Ok(users) => {
            let template = UsersTemplate { users };
            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Err(e) => {
            eprintln!("获取用户列表失败: {}", e);
            Html(format!("获取用户列表失败: {}", e)).into_response()
        }
    }
}

// 本体列表页面
pub async fn ontos_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let html_service = HtmlService::new(state.db.clone());
    
    match html_service.get_ontos_for_html().await {
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
            eprintln!("获取本体列表失败: {}", e);
            Html(format!("获取本体列表失败: {}", e)).into_response()
        }
    }
}

// 本体详情页面
pub async fn onto_detail_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let html_service = HtmlService::new(state.db.clone());
    
    match html_service.get_onto_detail_for_html(id).await {
        Ok((onto, signifiers, signifieds)) => {
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
        Err(e) => {
            eprintln!("获取本体详情失败: {}", e);
            Html(format!("获取本体详情失败: {}", e)).into_response()
        }
    }
}

// 关系列表页面
pub async fn signs_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let html_service = HtmlService::new(state.db.clone());
    
    match html_service.get_signs_for_html().await {
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
            eprintln!("获取符号关系列表失败: {}", e);
            Html(format!("获取符号关系列表失败: {}", e)).into_response()
        }
    }
}

// 关系详情页面
pub async fn sign_detail_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let html_service = HtmlService::new(state.db.clone());
    
    match html_service.get_sign_detail_for_html(id).await {
        Ok(sign) => {
            let template = SignDetailTemplate { sign };
            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Err(e) => {
            eprintln!("获取符号关系详情失败: {}", e);
            Html(format!("获取符号关系详情失败: {}", e)).into_response()
        }
    }
}

// 用户详情页面
pub async fn user_detail_handler(
    State(state): State<AppState>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let html_service = HtmlService::new(state.db.clone());
    
    match html_service.get_user_detail_for_html(id).await {
        Ok(user) => {
            let template = UserDetailTemplate { user };
            match template.render() {
                Ok(html) => Html(html).into_response(),
                Err(e) => {
                    eprintln!("模板渲染错误: {}", e);
                    Html(format!("模板渲染错误: {}", e)).into_response()
                }
            }
        }
        Err(e) => {
            eprintln!("获取用户详情失败: {}", e);
            Html(format!("获取用户详情失败: {}", e)).into_response()
        }
    }
}

// 本体列表页面
// 按能指查询关系页面
pub async fn signs_by_signifier_handler(
    State(state): State<AppState>,
    Path(signifier_id): Path<i32>,
) -> impl IntoResponse {
    let html_service = HtmlService::new(state.db.clone());
    
    match html_service.get_signs_by_signifier_for_html(signifier_id).await {
        Ok((onto, signs)) => {
            // 使用本体详情模板，但只显示能指关系
            let template = OntoDetailTemplate {
                onto,
                signifiers: signs,
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
        Err(e) => {
            eprintln!("获取能指相关关系失败: {}", e);
            Html(format!("获取能指相关关系失败: {}", e)).into_response()
        }
    }
}

// 按所指查询关系页面
pub async fn signs_by_signified_handler(
    State(state): State<AppState>,
    Path(signified_id): Path<i32>,
) -> impl IntoResponse {
    let html_service = HtmlService::new(state.db.clone());
    
    match html_service.get_signs_by_signified_for_html(signified_id).await {
        Ok((onto, signs)) => {
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
        Err(e) => {
            eprintln!("获取所指相关关系失败: {}", e);
            Html(format!("获取所指相关关系失败: {}", e)).into_response()
        }
    }
}


