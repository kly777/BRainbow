import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { taskApi } from './api';
import type { TaskDetail, Task, TimeWindow } from './types';

@customElement('task-detail')
export class TaskDetailComponent extends LitElement {
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

    button.danger {
      background-color: #dc3545;
    }

    button.danger:hover {
      background-color: #c82333;
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

    .basic-info {
      background-color: #f8f9fa;
      border-radius: 8px;
      padding: 25px;
      margin-bottom: 30px;
      border: 1px solid #e9ecef;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }

    .info-item {
      margin-bottom: 15px;
    }

    .info-label {
      font-weight: bold;
      color: #495057;
      margin-bottom: 5px;
      font-size: 14px;
    }

    .info-value {
      color: #212529;
      font-size: 16px;
    }

    .description {
      background-color: white;
      border: 1px solid #dee2e6;
      border-radius: 6px;
      padding: 20px;
      margin-top: 10px;
      line-height: 1.6;
    }

    .section {
      margin-bottom: 40px;
    }

    .section-title {
      font-size: 20px;
      color: #333;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 1px solid #dee2e6;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }

    .card {
      background-color: white;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 20px;
      transition: box-shadow 0.2s;
    }

    .card:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .card-title {
      font-size: 16px;
      font-weight: bold;
      color: #495057;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e9ecef;
    }

    .empty-state {
      text-align: center;
      padding: 30px;
      color: #6c757d;
      background-color: #f8f9fa;
      border-radius: 6px;
      border: 1px dashed #dee2e6;
    }

    .task-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .task-item {
      padding: 12px 15px;
      margin-bottom: 10px;
      background-color: #f8f9fa;
      border-radius: 6px;
      border: 1px solid #e9ecef;
      transition: background-color 0.2s;
    }

    .task-item:hover {
      background-color: #e9ecef;
    }

    .task-link {
      display: block;
      text-decoration: none;
      color: #0066cc;
      font-weight: 500;
      cursor: pointer;
    }

    .task-link:hover {
      text-decoration: underline;
    }

    .task-id {
      color: #6c757d;
      font-size: 12px;
      margin-left: 5px;
    }

    .time-window-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .time-window-item {
      padding: 12px 15px;
      margin-bottom: 10px;
      background-color: #e7f3ff;
      border-radius: 6px;
      border: 1px solid #b3d7ff;
    }

    .time-window-dates {
      display: flex;
      justify-content: space-between;
      margin-top: 5px;
      font-size: 12px;
      color: #495057;
    }

    .date-label {
      font-weight: bold;
      margin-right: 5px;
    }

    .relationship-actions {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #dee2e6;
    }

    .relationship-actions button {
      padding: 6px 12px;
      font-size: 13px;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #0066cc;
      text-decoration: none;
      margin-bottom: 20px;
      cursor: pointer;
    }

    .back-link:hover {
      text-decoration: underline;
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

      .info-grid {
        grid-template-columns: 1fr;
      }

      .cards-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  @property({ type: Number })
  taskId!: number;

  @state()
  private taskDetail: TaskDetail | null = null;

  @state()
  private loading = false;

  @state()
  private error: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.loadTaskDetail();
  }

  updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('taskId')) {
      this.loadTaskDetail();
    }
  }

  private async loadTaskDetail() {
    if (!this.taskId) return;

    this.loading = true;
    this.error = null;
    this.taskDetail = null;

    try {
      this.taskDetail = await taskApi.getTask(this.taskId);
    } catch (err) {
      this.error = err instanceof Error ? err.message : '加载任务详情失败';
      console.error('Failed to load task detail:', err);
    } finally {
      this.loading = false;
    }
  }

  private handleBack() {
    this.dispatchEvent(new CustomEvent('back'));
  }

  private handleEdit() {
    this.dispatchEvent(new CustomEvent('edit', {
      detail: { taskId: this.taskId }
    }));
  }

  private async handleDelete() {
    if (!confirm('确定要删除这个任务吗？此操作不可撤销。')) {
      return;
    }

    try {
      await taskApi.deleteTask(this.taskId);
      this.dispatchEvent(new CustomEvent('deleted', {
        detail: { taskId: this.taskId }
      }));
    } catch (err) {
      this.error = err instanceof Error ? err.message : '删除任务失败';
      console.error('Failed to delete task:', err);
    }
  }

  private handleViewTask(taskId: number) {
    this.dispatchEvent(new CustomEvent('view-task', {
      detail: { taskId }
    }));
  }

  private formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return dateString;
    }
  }

  private formatTimeWindowDates(startsAt: string, endsAt: string): string {
    try {
      const startDate = new Date(startsAt);
      const endDate = new Date(endsAt);
      
      const startStr = startDate.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const endStr = endDate.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      return `${startStr} - ${endStr}`;
    } catch {
      return `${startsAt} - ${endsAt}`;
    }
  }

  private renderTaskList(tasks: Task[], title: string, emptyMessage: string) {
    return html`
      <div class="card">
        <div class="card-title">${title} (${tasks.length})</div>
        ${tasks.length === 0 ? html`
          <div class="empty-state">${emptyMessage}</div>
        ` : html`
          <ul class="task-list">
            ${tasks.map(task => html`
              <li class="task-item">
                <a class="task-link" @click=${() => this.handleViewTask(task.id)}>
                  ${task.title}
                  <span class="task-id">#${task.id}</span>
                </a>
              </li>
            `)}
          </ul>
        `}
      </div>
    `;
  }

  private renderSingleTask(task: Task | null, title: string, emptyMessage: string) {
    return html`
      <div class="card">
        <div class="card-title">${title}</div>
        ${!task ? html`
          <div class="empty-state">${emptyMessage}</div>
        ` : html`
          <div class="task-item">
            <a class="task-link" @click=${() => this.handleViewTask(task.id)}>
              ${task.title}
              <span class="task-id">#${task.id}</span>
            </a>
          </div>
        `}
      </div>
    `;
  }

  private renderTimeWindows(timeWindows: TimeWindow[]) {
    return html`
      <div class="card">
        <div class="card-title">时间窗口分配 (${timeWindows.length})</div>
        ${timeWindows.length === 0 ? html`
          <div class="empty-state">暂无时间窗口分配</div>
        ` : html`
          <ul class="time-window-list">
            ${timeWindows.map(window => html`
              <li class="time-window-item">
                <div>时间窗口 #${window.id}</div>
                <div class="time-window-dates">
                  <div>
                    <span class="date-label">开始:</span>
                    ${this.formatDate(window.starts_at)}
                  </div>
                  <div>
                    <span class="date-label">结束:</span>
                    ${this.formatDate(window.ends_at)}
                  </div>
                </div>
              </li>
            `)}
          </ul>
        `}
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`
        <div class="container">
          <div class="loading">加载中...</div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="container">
          <div class="error">${this.error}</div>
          <button @click=${this.handleBack}>返回任务列表</button>
        </div>
      `;
    }

    if (!this.taskDetail) {
      return html`
        <div class="container">
          <div class="empty-state">任务不存在</div>
          <button @click=${this.handleBack}>返回任务列表</button>
        </div>
      `;
    }

    const { task, parent_task, sub_tasks, time_windows, dependencies, dependents } = this.taskDetail;

    return html`
      <div class="container">
        <a class="back-link" @click=${this.handleBack}>
          ← 返回任务列表
        </a>

        <div class="header">
          <h1>${task.title}</h1>
          <div class="actions">
            <button @click=${this.handleEdit}>编辑</button>
            <button class="danger" @click=${this.handleDelete}>删除</button>
            <button class="secondary" @click=${() => this.loadTaskDetail()}>刷新</button>
          </div>
        </div>

        <div class="basic-info">
          <div class="info-grid">
            <div class="info-item">
              <div class="info-label">任务 ID</div>
              <div class="info-value">${task.id}</div>
            </div>
            <div class="info-item">
              <div class="info-label">创建时间</div>
              <div class="info-value">${this.formatDate(task.created_at)}</div>
            </div>
          </div>
          
          ${task.description ? html`
            <div class="info-item">
              <div class="info-label">描述</div>
              <div class="description">${task.description}</div>
            </div>
          ` : ''}
        </div>

        <div class="section">
          <h2 class="section-title">任务关系</h2>
          <div class="cards-grid">
            ${this.renderSingleTask(parent_task, '父任务', '暂无父任务')}
            ${this.renderTaskList(sub_tasks, '子任务', '暂无子任务')}
            ${this.renderTimeWindows(time_windows)}
            ${this.renderTaskList(dependencies, '依赖的任务（需要等待的任务）', '暂无依赖的任务')}
            ${this.renderTaskList(dependents, '被依赖的任务（前提任务）', '暂无被依赖的任务')}
          </div>
        </div>

        <div class="relationship-actions">
          <button @click=${() => this.dispatchEvent(new CustomEvent('add-sub-task', { detail: { taskId: this.taskId } }))}>
            添加子任务
          </button>
          <button @click=${() => this.dispatchEvent(new CustomEvent('add-dependency', { detail: { taskId: this.taskId } }))}>
            添加依赖
          </button>
          <button @click=${() => this.dispatchEvent(new CustomEvent('add-time-window', { detail: { taskId: this.taskId } }))}>
            分配时间窗口
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'task-detail': TaskDetailComponent;
  }
}