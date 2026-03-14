import { Effect, Data, Schema } from "effect"

// ==================== Schemas ====================

export const TaskSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  created_at: Schema.String, // ISO 8601 datetime string
})

export const TimeWindowSchema = Schema.Struct({
  id: Schema.Number,
  starts_at: Schema.String, // ISO 8601 datetime string
  ends_at: Schema.String, // ISO 8601 datetime string
})

export const TaskDetailSchema = Schema.Struct({
  task: TaskSchema,
  parent_task: Schema.NullOr(TaskSchema),
  sub_tasks: Schema.Array(TaskSchema),
  time_windows: Schema.Array(TimeWindowSchema),
  dependencies: Schema.Array(TaskSchema), // 依赖的任务（需要等待的任务）
  dependents: Schema.Array(TaskSchema), // 被依赖的任务（前提任务）
})

export const CreateTaskRequestSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
})

export const UpdateTaskRequestSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
})

export const AddTimeWindowRequestSchema = Schema.Struct({
  time_window_id: Schema.Number,
  allocation_type: Schema.Number,
})

export const AddSubTaskRequestSchema = Schema.Struct({
  sub_task_id: Schema.Number,
})

export const AddDependencyRequestSchema = Schema.Struct({
  prerequisite_id: Schema.Number,
})

export const ApiErrorSchema = Schema.Struct({
  error: Schema.String,
})

export const ApiMessageSchema = Schema.Struct({
  message: Schema.String,
})

// ==================== Types ====================

export type Task = Schema.Schema.Type<typeof TaskSchema>
export type TimeWindow = Schema.Schema.Type<typeof TimeWindowSchema>
export type TaskDetail = Schema.Schema.Type<typeof TaskDetailSchema>
export type CreateTaskRequest = Schema.Schema.Type<typeof CreateTaskRequestSchema>
export type UpdateTaskRequest = Schema.Schema.Type<typeof UpdateTaskRequestSchema>
export type AddTimeWindowRequest = Schema.Schema.Type<typeof AddTimeWindowRequestSchema>
export type AddSubTaskRequest = Schema.Schema.Type<typeof AddSubTaskRequestSchema>
export type AddDependencyRequest = Schema.Schema.Type<typeof AddDependencyRequestSchema>
export type ApiError = Schema.Schema.Type<typeof ApiErrorSchema>
export type ApiMessage = Schema.Schema.Type<typeof ApiMessageSchema>

// ==================== Errors ====================

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly cause: unknown
}> {
  static fromUnknown(cause: unknown): NetworkError {
    return new NetworkError({ cause })
  }
}

export class HttpError extends Data.TaggedError("HttpError")<{
  readonly status: number
  readonly message: string
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly error: unknown
}> {}

export type ApiErrorType = NetworkError | HttpError | ValidationError

// ==================== API Configuration ====================

const API_BASE_URL = "http://localhost:3000/api"

// ==================== API Client Implementation ====================

const request = <T>(
  endpoint: string,
  schema: Schema.Schema<T>,
  options: RequestInit = {}
): Effect.Effect<T, ApiErrorType> =>
  Effect.gen(function* () {
    const url = `${API_BASE_URL}${endpoint}`

    const response = yield* Effect.tryPromise({
      try: async () =>
        fetch(url, {
          ...options,
          headers: (() => {
            const headers = new Headers({
              "Content-Type": "application/json",
            });
            if (options.headers) {
              if (Array.isArray(options.headers)) {
                for (const [key, value] of options.headers) {
                  if (value !== undefined) {
                    headers.append(key, String(value));
                  }
                }
              } else if (typeof options.headers === 'object') {
                for (const [key, value] of Object.entries(options.headers)) {
                  if (value !== undefined) {
                    headers.append(key, String(value));
                  }
                }
              }
            }
            return headers;
          })(),
        }),
      catch: (cause: unknown) => new NetworkError({ cause }),
    })

    if (!response.ok) {
      if (response.status === 204) {
        // Handle void response
        return undefined as T
      }

      let errorMessage = `HTTP ${response.status}`
      try {
        const errorData = yield* Effect.tryPromise({
          try: async (): Promise<ApiError> => response.json(),
          catch: (cause: unknown) => new NetworkError({ cause }),
        })
        errorMessage = errorData.error || errorMessage
      } catch {
        // If we can't parse JSON error, use default message
      }

      return yield* Effect.fail(new HttpError({ status: response.status, message: errorMessage }))
    }

    if (response.status === 204) {
      return undefined as unknown as T
    }

    const json = yield* Effect.tryPromise({
      try: async () => response.json() as unknown,
      catch: (cause: unknown) => new NetworkError({ cause }),
    })

    const result = yield* Schema.decodeUnknown(schema)(json).pipe(
      Effect.mapError((issue: unknown) => new ValidationError({ error: issue }))
    )

    return result
  })

// ==================== API Functions ====================

// Task operations
export const getTasks = (search?: string): Effect.Effect<readonly Task[], ApiErrorType> => {
  const endpoint = search ? `/task?search=${encodeURIComponent(search)}` : "/task"
  return request(endpoint, Schema.Array(TaskSchema), {})
}

export const getTask = (id: number): Effect.Effect<TaskDetail, ApiErrorType> =>
  request(`/task/${id}`, TaskDetailSchema, {})

export const createTask = (task: CreateTaskRequest): Effect.Effect<Task, ApiErrorType> =>
  request("/task", TaskSchema, {
    method: "POST",
    body: JSON.stringify(task),
  })

export const updateTask = (id: number, task: UpdateTaskRequest): Effect.Effect<Task, ApiErrorType> =>
  request(`/task/${id}`, TaskSchema, {
    method: "PUT",
    body: JSON.stringify(task),
  })

export const deleteTask = (id: number): Effect.Effect<void, ApiErrorType> =>
  request(`/task/${id}`, Schema.Void, {
    method: "DELETE",
  })

// Task relationships
export const getParentTask = (id: number): Effect.Effect<Task | null, ApiErrorType> =>
  request(`/task/${id}/parent-task`, Schema.NullOr(TaskSchema), {})

export const getSubTasks = (id: number): Effect.Effect<readonly Task[], ApiErrorType> =>
  request(`/task/${id}/sub-tasks`, Schema.Array(TaskSchema), {})

export const getTimeWindows = (id: number): Effect.Effect<readonly TimeWindow[], ApiErrorType> =>
  request(`/task/${id}/time-windows`, Schema.Array(TimeWindowSchema), {})

export const getAllTimeWindows = (): Effect.Effect<readonly TimeWindow[], ApiErrorType> =>
  request("/time-window", Schema.Array(TimeWindowSchema), {})

export const getDependencies = (id: number): Effect.Effect<readonly Task[], ApiErrorType> =>
  request(`/task/${id}/dependencies`, Schema.Array(TaskSchema), {})

export const getDependents = (id: number): Effect.Effect<readonly Task[], ApiErrorType> =>
  request(`/task/${id}/dependents`, Schema.Array(TaskSchema), {})

// Relationship management
export const addTimeWindow = (id: number, requestBody: AddTimeWindowRequest): Effect.Effect<void, ApiErrorType> =>
  request(`/task/${id}/time-window`, Schema.Void, {
    method: "POST",
    body: JSON.stringify(requestBody),
  })

export const removeTimeWindow = (
  id: number,
  timeWindowId: number,
  allocationType = 0
): Effect.Effect<void, ApiErrorType> => {
  const endpoint = `/task/${id}/time-window/${timeWindowId}?allocation_type=${allocationType}`
  return request(endpoint, Schema.Void, { method: "DELETE" })
}

export const addSubTask = (id: number, requestBody: AddSubTaskRequest): Effect.Effect<void, ApiErrorType> =>
  request(`/task/${id}/sub-task`, Schema.Void, {
    method: "POST",
    body: JSON.stringify(requestBody),
  })

export const removeSubTask = (id: number, subTaskId: number): Effect.Effect<void, ApiErrorType> =>
  request(`/task/${id}/sub-task/${subTaskId}`, Schema.Void, {
    method: "DELETE",
  })

export const addDependency = (id: number, requestBody: AddDependencyRequest): Effect.Effect<void, ApiErrorType> =>
  request(`/task/${id}/dependency`, Schema.Void, {
    method: "POST",
    body: JSON.stringify(requestBody),
  })

export const removeDependency = (id: number, prerequisiteId: number): Effect.Effect<void, ApiErrorType> =>
  request(`/task/${id}/dependency/${prerequisiteId}`, Schema.Void, {
    method: "DELETE",
  })

// Helper function to run API effects
export const runApiEffect = async <A>(effect: Effect.Effect<A, ApiErrorType>): Promise<A> =>
  Effect.runPromise(effect)

// ==================== Utility Functions ====================

export const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return dateString
  }
}

// ==================== TaskApi Class (for compatibility) ====================

export class TaskApiClient {
  // Task operations
  async getTasks(search?: string): Promise<Task[]> {
    const result = await runApiEffect(getTasks(search))
    return [...result] // Convert readonly to mutable
  }

  async getTask(id: number): Promise<TaskDetail> {
    return runApiEffect(getTask(id))
  }

  async createTask(task: CreateTaskRequest): Promise<Task> {
    return runApiEffect(createTask(task))
  }

  async updateTask(id: number, task: UpdateTaskRequest): Promise<Task> {
    return runApiEffect(updateTask(id, task))
  }

  async deleteTask(id: number): Promise<void> {
    return runApiEffect(deleteTask(id))
  }

  // Task relationships
  async getParentTask(id: number): Promise<Task | null> {
    return runApiEffect(getParentTask(id))
  }

  async getSubTasks(id: number): Promise<Task[]> {
    const result = await runApiEffect(getSubTasks(id))
    return [...result] // Convert readonly to mutable
  }

  async getTimeWindows(id: number): Promise<TimeWindow[]> {
    const result = await runApiEffect(getTimeWindows(id))
    return [...result] // Convert readonly to mutable
  }

  async getAllTimeWindows(): Promise<TimeWindow[]> {
    const result = await runApiEffect(getAllTimeWindows())
    return [...result] // Convert readonly to mutable
  }

  async getDependencies(id: number): Promise<Task[]> {
    const result = await runApiEffect(getDependencies(id))
    return [...result] // Convert readonly to mutable
  }

  async getDependents(id: number): Promise<Task[]> {
    const result = await runApiEffect(getDependents(id))
    return [...result] // Convert readonly to mutable
  }

  // Relationship management
  async addTimeWindow(id: number, request: AddTimeWindowRequest): Promise<void> {
    return runApiEffect(addTimeWindow(id, request))
  }

  async removeTimeWindow(id: number, timeWindowId: number, allocationType = 0): Promise<void> {
    return runApiEffect(removeTimeWindow(id, timeWindowId, allocationType))
  }

  async addSubTask(id: number, request: AddSubTaskRequest): Promise<void> {
    return runApiEffect(addSubTask(id, request))
  }

  async removeSubTask(id: number, subTaskId: number): Promise<void> {
    return runApiEffect(removeSubTask(id, subTaskId))
  }

  async addDependency(id: number, request: AddDependencyRequest): Promise<void> {
    return runApiEffect(addDependency(id, request))
  }

  async removeDependency(id: number, prerequisiteId: number): Promise<void> {
    return runApiEffect(removeDependency(id, prerequisiteId))
  }
}

// Export for compatibility with existing code
export const taskApi = new TaskApiClient()
