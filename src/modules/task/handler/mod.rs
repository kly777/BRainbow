mod crud;
mod dependency;
mod query;
mod status;

pub use crud::{
    create_task_handler, delete_task_handler, get_all_tasks_handler, get_task_detail_handler,
    get_task_handler, get_tasks_handler, quick_create_task_handler, update_task_handler,
};

pub use dependency::{add_dependency_handler, remove_dependency_handler};
pub use query::{
    get_calendar_handler, get_dag_handler, get_stats_handler, get_tree_handler,
    search_tasks_handler,
};
pub use status::{
    activate_task_handler, archive_task_handler, complete_task_handler, get_active_tasks_handler,
    get_archived_tasks_handler, get_backlog_tasks_handler, get_completed_tasks_handler,
    move_to_backlog_handler,
};
