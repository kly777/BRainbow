mod handler;
mod model;
mod repository;
mod service;

pub use handler::{
    create_onto_handler, get_ontos_handler, get_onto_handler,
    update_onto_handler, delete_onto_handler,
};
pub use model::Onto;
pub use service::OntoService;
