import {
  Task,
  TaskDetail,
  CreateTaskRequest,
  UpdateTaskRequest,
  AddTimeWindowRequest,
  AddSubTaskRequest,
  AddDependencyRequest,
  TaskApiClient,
  ApiError,
  ApiMessage
} from './types';

const API_BASE_URL = 'localhost:3000/api';

class TaskApiClientImpl implements TaskApiClient {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 204) {
        return {} as T;
      }

      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json() as ApiError;
        errorMessage = errorData.error || errorMessage;
      } catch {
        // Ignore JSON parsing errors
      }
      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  // Task operations
  async getTasks(search?: string): Promise<Task[]> {
    const endpoint = search ? `/task?search=${encodeURIComponent(search)}` : '/task';
    return this.request<Task[]>(endpoint);
  }

  async getTask(id: number): Promise<TaskDetail> {
    return this.request<TaskDetail>(`/task/${id}`);
  }

  async createTask(task: CreateTaskRequest): Promise<Task> {
    return this.request<Task>('/task', {
      method: 'POST',
      body: JSON.stringify(task),
    });
  }

  async updateTask(id: number, task: UpdateTaskRequest): Promise<Task> {
    return this.request<Task>(`/task/${id}`, {
      method: 'PUT',
      body: JSON.stringify(task),
    });
  }

  async deleteTask(id: number): Promise<void> {
    await this.request<ApiMessage>(`/task/${id}`, {
      method: 'DELETE',
    });
  }

  // Task relationships
  async getParentTasks(id: number): Promise<Task[]> {
    return this.request<Task[]>(`/task/${id}/parent-tasks`);
  }

  async getSubTasks(id: number): Promise<Task[]> {
    return this.request<Task[]>(`/task/${id}/sub-tasks`);
  }

  async getTimeWindows(id: number): Promise<TimeWindow[]> {
    return this.request<TimeWindow[]>(`/task/${id}/time-windows`);
  }

  async getDependencies(id: number): Promise<Task[]> {
    return this.request<Task[]>(`/task/${id}/dependencies`);
  }

  async getDependents(id: number): Promise<Task[]> {
    return this.request<Task[]>(`/task/${id}/dependents`);
  }

  // Relationship management
  async addTimeWindow(id: number, request: AddTimeWindowRequest): Promise<void> {
    await this.request<ApiMessage>(`/task/${id}/time-window`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async removeTimeWindow(id: number, timeWindowId: number, allocationType: number = 0): Promise<void> {
    const endpoint = `/task/${id}/time-window/${timeWindowId}?allocation_type=${allocationType}`;
    await this.request<ApiMessage>(endpoint, {
      method: 'DELETE',
    });
  }

  async addSubTask(id: number, request: AddSubTaskRequest): Promise<void> {
    await this.request<ApiMessage>(`/task/${id}/sub-task`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async removeSubTask(id: number, subTaskId: number): Promise<void> {
    await this.request<ApiMessage>(`/task/${id}/sub-task/${subTaskId}`, {
      method: 'DELETE',
    });
  }

  async addDependency(id: number, request: AddDependencyRequest): Promise<void> {
    await this.request<ApiMessage>(`/task/${id}/dependency`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async removeDependency(id: number, prerequisiteId: number): Promise<void> {
    await this.request<ApiMessage>(`/task/${id}/dependency/${prerequisiteId}`, {
      method: 'DELETE',
    });
  }
}

export const taskApi = new TaskApiClientImpl();
