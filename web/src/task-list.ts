import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { taskApi } from './api';
import type { Task } from './types';

@customElement('task-list')
export class TaskList extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: Arial, sans-serif;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 15px;
      border-bottom: 2px solid #333;
    }

    h1 {
      margin: 0;
      color: #333;
    }

    .actions {
      display: flex;
      gap: 10px;
    }

    button {
      padding: 8px 16px;
      background-color: #0066cc;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.2s;
    }

    button:hover {
      background-color: #0052a3;
    }

    button.secondary {
      background-color: #6c757d;
    }

    button.secondary:hover {
      background-color: #545b62;
    }

    .search-box {
      margin-bottom: 20px;
    }

    .search-input {
      width: 100%;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
      box-sizing: border-box;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #666;
    }

    .error {
      background-color: #f8d7da;
      color: #721c24;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 20px;
      border: 1px solid #f5c6cb;
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: #666;
      background-color: #f8f9fa;
      border-radius: 4px;
    }

    .empty-state button {
      margin-top: 15px;
    }

    .tasks-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }

    .tasks-table th,
    .tasks-table td {
      padding: 12px 15px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }

    .tasks-table th {
      background-color: #f2f2f2;
      font-weight: bold;
      color: #333;
    }

    .tasks-table tr:hover {
      background-color: #f5f5f5;
    }

    .task-title {
      font-weight: 500;
      color: #0066cc;
      cursor: pointer;
      text-decoration: none;
    }

    .task-title:hover {
      text-decoration: underline;
    }

    .task-description {
      color: #666;
      font-size: 13px;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .task-actions {
      display: flex;
      gap: 8px;
    }

    .task-actions button {
      padding: 4px 8px;
      font-size: 12px;
    }

    .task-actions button.delete {
      background-color: #dc3545;
    }

    .task-actions button.delete:hover {
      background-color: #c82333;
    }

    .created-at {
      color: #666;
      font-size: 13px;
    }

    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 10px;
      margin-top: 30px;
    }

    .pagination button {
      padding: 6px 12px;
      font-size: 13px;
    }

    .pagination button:disabled {
      background-color: #ccc;
      cursor: not-allowed;
    }

    .pagination-info {
      color: #666;
      font-size: 14px;
    }

    .stats {
      display: flex;
      gap: 20px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }

    .stat-item {
      text-align: center;
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 4px;
      flex: 1;
    }

    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #0066cc;
    }

    .stat-label {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
      text-transform: uppercase;
    }

    @media (max-width: 768px) {
      .header {
        flex-direction: column;
        align-items: flex-start;
        gap: 15px;
      }

      .actions {
        width: 100%;
        justify-content: flex-start;
      }

      .tasks-table {
        display: block;
        overflow-x: auto;
      }

      .stats {
        flex-direction: column;
      }
    }
  `;

  @state()
  private tasks: Task[] = [];

  @state()
  private loading = false;

  @state()
  private error: string | null = null;

  @state()
  private searchQuery = '';

  @property({ type: Number })
  currentPage = 1;

  @property({ type: Number })
  pageSize = 10;

  connectedCallback() {
    super.connectedCallback();
    this.loadTasks();
  }

  private async loadTasks() {
    this.loading = true;
    this.error = null;

    try {
      if (this.searchQuery.trim()) {
        this.tasks = await taskApi.getTasks(this.searchQuery);
      } else {
        this.tasks = await taskApi.getTasks();
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : '加载任务列表失败';
      console.error('Failed to load tasks:', err);
    } finally {
      this.loading = false;
    }
  }

  private handleSearch(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery = input.value;
    this.currentPage = 1;
    this.loadTasks();
  }

  private handleCreateTask() {
    this.dispatchEvent(new CustomEvent('create-task'));
  }

  private handleViewTask(taskId: number) {
    this.dispatchEvent(new CustomEvent('view-task', {
      detail: { taskId }
    }));
  }

  private handleEditTask(taskId: number) {
    this.dispatchEvent(new CustomEvent('edit-task', {
      detail: { taskId }
    }));
  }

  private async handleDeleteTask(taskId: number) {
    if (!confirm('确定要删除这个任务吗？此操作不可撤销。')) {
      return;
    }

    try {
      await taskApi.deleteTask(taskId);
      this.tasks = this.tasks.filter(task => task.id !== taskId);
    } catch (err) {
      this.error = err instanceof Error ? err.message : '删除任务失败';
      console.error('Failed to delete task:', err);
    }
  }

  private get paginatedTasks(): Task[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    return this.tasks.slice(startIndex, endIndex);
  }

  private get totalPages(): number {
    return Math.ceil(this.tasks.length / this.pageSize);
  }

  private handlePreviousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  private handleNextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  private formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  }

  render() {
    return html`
      <div class="container">
        <div class="header">
          <h1>任务列表</h1>
          <div class="actions">
            <button @click=${this.handleCreateTask}>创建新任务</button>
            <button class="secondary" @click=${() => this.loadTasks()}>刷新</button>
          </div>
        </div>

        <div class="search-box">
          <input
            type="text"
            class="search-input"
            placeholder="搜索任务标题..."
            .value=${this.searchQuery}
            @input=${this.handleSearch}
          />
        </div>

        ${this.error ? html`
          <div class="error">
            ${this.error}
          </div>
        ` : ''}

        ${this.loading ? html`
          <div class="loading">
            加载中...
          </div>
        ` : this.tasks.length === 0 ? html`
          <div class="empty-state">
            <p>${this.searchQuery ? '没有找到匹配的任务' : '暂无任务数据'}</p>
            ${!this.searchQuery ? html`
              <button @click=${this.handleCreateTask}>创建第一个任务</button>
            ` : ''}
          </div>
        ` : html`
          <table class="tasks-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>标题</th>
                <th>描述</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${this.paginatedTasks.map(task => html`
                <tr>
                  <td>${task.id}</td>
                  <td>
                    <a class="task-title" @click=${() => this.handleViewTask(task.id)}>
                      ${task.title}
                    </a>
                  </td>
                  <td>
                    <div class="task-description" title=${task.description || ''}>
                      ${task.description || '无描述'}
                    </div>
                  </td>
                  <td class="created-at">
                    ${this.formatDate(task.created_at)}
                  </td>
                  <td>
                    <div class="task-actions">
                      <button @click=${() => this.handleViewTask(task.id)}>查看</button>
                      <button class="secondary" @click=${() => this.handleEditTask(task.id)}>编辑</button>
                      <button class="delete" @click=${() => this.handleDeleteTask(task.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              `)}
            </tbody>
          </table>

          ${this.totalPages > 1 ? html`
            <div class="pagination">
              <button 
                @click=${this.handlePreviousPage}
                ?disabled=${this.currentPage === 1}
              >
                上一页
              </button>
              <span class="pagination-info">
                第 ${this.currentPage} 页，共 ${this.totalPages} 页
              </span>
              <button 
                @click=${this.handleNextPage}
                ?disabled=${this.currentPage === this.totalPages}
              >
                下一页
              </button>
            </div>
          ` : ''}

          <div class="stats">
            <div class="stat-item">
              <div class="stat-value">${this.tasks.length}</div>
              <div class="stat-label">总任务数</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${this.pageSize}</div>
              <div class="stat-label">每页显示</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${this.totalPages}</div>
              <div class="stat-label">总页数</div>
            </div>
          </div>
        `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'task-list': TaskList;
  }
}