// Task API Types
export interface Task {
  id: number;
  title: string;
  description: string | null;
  created_at: string; // ISO 8601 datetime string
}

export interface TimeWindow {
  id: number;
  starts_at: string; // ISO 8601 datetime string
  ends_at: string; // ISO 8601 datetime string
}

export interface TaskDetail {
  task: Task;
  parent_tasks: Task[];
  sub_tasks: Task[];
  time_windows: TimeWindow[];
  dependencies: Task[]; // 依赖的任务（需要等待的任务）
  dependents: Task[]; // 被依赖的任务（前提任务）
}

export interface CreateTaskRequest {
  title: string;
  description?: string | null;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string | null;
}

export interface AddTimeWindowRequest {
  time_window_id: number;
  allocation_type: number;
}

export interface AddSubTaskRequest {
  sub_task_id: number;
}

export interface AddDependencyRequest {
  prerequisite_id: number;
}

export interface ApiError {
  error: string;
}

export interface ApiMessage {
  message: string;
}

// API Response types
export type TasksResponse = Task[];
export type TaskResponse = Task;
export type TaskDetailResponse = TaskDetail;
export type TimeWindowsResponse = TimeWindow[];
export type ParentTasksResponse = Task[];
export type SubTasksResponse = Task[];
export type DependenciesResponse = Task[];
export type DependentsResponse = Task[];

// API Client interface
export interface TaskApiClient {
  // Task operations
  getTasks(search?: string): Promise<Task[]>;
  getTask(id: number): Promise<TaskDetail>;
  createTask(task: CreateTaskRequest): Promise<Task>;
  updateTask(id: number, task: UpdateTaskRequest): Promise<Task>;
  deleteTask(id: number): Promise<void>;
  
  // Task relationships
  getParentTasks(id: number): Promise<Task[]>;
  getSubTasks(id: number): Promise<Task[]>;
  getTimeWindows(id: number): Promise<TimeWindow[]>;
  getDependencies(id: number): Promise<Task[]>;
  getDependents(id: number): Promise<Task[]>;
  
  // Relationship management
  addTimeWindow(id: number, request: AddTimeWindowRequest): Promise<void>;
  removeTimeWindow(id: number, timeWindowId: number, allocationType?: number): Promise<void>;
  addSubTask(id: number, request: AddSubTaskRequest): Promise<void>;
  removeSubTask(id: number, subTaskId: number): Promise<void>;
  addDependency(id: number, request: AddDependencyRequest): Promise<void>;
  removeDependency(id: number, prerequisiteId: number): Promise<void>;
}