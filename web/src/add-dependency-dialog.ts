import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { taskApi } from './api';
import type { Task } from './types';

@customElement('add-dependency-dialog')
export class AddDependencyDialog extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: Arial, sans-serif;
    }

    .dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      animation: fadeIn 0.2s ease-out;
    }

    .dialog-content {
      background-color: white;
      border-radius: 8px;
      width: 90%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      animation: slideInUp 0.3s ease-out;
    }

    .dialog-header {
      padding: 20px;
      border-bottom: 1px solid #e9ecef;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .dialog-title {
      margin: 0;
      color: #333;
      font-size: 18px;
    }

    .close-button {
      background: none;
      border: none;
      font-size: 24px;
      color: #6c757d;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background-color 0.2s;
    }

    .close-button:hover {
      background-color: #f8f9fa;
      color: #333;
    }

    .dialog-body {
      padding: 20px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-weight: bold;
      color: #495057;
    }

    .required::after {
      content: ' *';
      color: #dc3545;
    }

    select {
      width: 100%;
      padding: 10px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 14px;
      background-color: white;
      cursor: pointer;
      transition: border-color 0.2s;
    }

    select:focus {
      outline: none;
      border-color: #0066cc;
      box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.1);
    }

    .loading {
      text-align: center;
      padding: 20px;
      color: #666;
    }

    .error {
      background-color: #f8d7da;
      color: #721c24;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 20px;
      border: 1px solid #f5c6cb;
      font-size: 14px;
    }

    .empty-state {
      text-align: center;
      padding: 30px;
      color: #6c757d;
      background-color: #f8f9fa;
      border-radius: 6px;
      border: 1px dashed #dee2e6;
    }

    .dialog-footer {
      padding: 20px;
      border-top: 1px solid #e9ecef;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    button[type="submit"] {
      background-color: #0066cc;
      color: white;
    }

    button[type="submit"]:hover {
      background-color: #0052a3;
    }

    button[type="submit"]:disabled {
      background-color: #6c757d;
      cursor: not-allowed;
    }

    button.secondary {
      background-color: #6c757d;
      color: white;
    }

    button.secondary:hover {
      background-color: #545b62;
    }

    .task-list {
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid #ced4da;
      border-radius: 4px;
    }

    .task-item {
      padding: 12px 15px;
      border-bottom: 1px solid #e9ecef;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .task-item:hover {
      background-color: #f8f9fa;
    }

    .task-item.selected {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
    }

    .task-item:last-child {
      border-bottom: none;
    }

    .task-title {
      font-weight: 500;
      color: #333;
    }

    .task-id {
      color: #6c757d;
      font-size: 12px;
      margin-left: 5px;
    }

    .task-description {
      color: #6c757d;
      font-size: 13px;
      margin-top: 5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .help-text {
      font-size: 12px;
      color: #6c757d;
      margin-top: 5px;
      line-height: 1.4;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes slideInUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    @media (max-width: 768px) {
      .dialog-content {
        width: 95%;
        margin: 10px;
      }

      .dialog-footer {
        flex-direction: column;
      }

      button {
        width: 100%;
      }
    }
  `;

  @property({ type: Number })
  taskId!: number;

  @state()
  private tasks: Task[] = [];

  @state()
  private loading = false;

  @state()
  private error: string | null = null;

  @state()
  private selectedTaskId: number | null = null;

  @state()
  private saving = false;

  connectedCallback() {
    super.connectedCallback();
    this.loadTasks();
  }

  private async loadTasks() {
    this.loading = true;
    this.error = null;

    try {
      // 获取所有任务，排除当前任务本身
      const allTasks = await taskApi.getTasks();
      this.tasks = allTasks.filter(task => task.id !== this.taskId);
    } catch (err) {
      this.error = err instanceof Error ? err.message : '加载任务列表失败';
      console.error('Failed to load tasks:', err);
    } finally {
      this.loading = false;
    }
  }

  private handleTaskSelect(taskId: number) {
    this.selectedTaskId = taskId;
  }

  private async handleSubmit(event: Event) {
    event.preventDefault();

    if (!this.selectedTaskId) {
      this.error = '请选择一个任务作为依赖';
      return;
    }

    this.saving = true;
    this.error = null;

    try {
      await taskApi.addDependency(this.taskId, {
        prerequisite_id: this.selectedTaskId
      });

      // 通知父组件依赖已添加
      this.dispatchEvent(new CustomEvent('dependency-added', {
        detail: { 
          taskId: this.taskId,
          prerequisiteId: this.selectedTaskId
        }
      }));

      // 关闭对话框
      this.close();
    } catch (err) {
      this.error = err instanceof Error ? err.message : '添加依赖失败';
      console.error('Failed to add dependency:', err);
    } finally {
      this.saving = false;
    }
  }

  private close() {
    this.dispatchEvent(new CustomEvent('close'));
  }

  private handleCancel() {
    this.close();
  }

  render() {
    return html`
      <div class="dialog-overlay" @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains('dialog-overlay')) {
          this.close();
        }
      }}>
        <div class="dialog-content">
          <div class="dialog-header">
            <h2 class="dialog-title">添加任务依赖</h2>
            <button class="close-button" @click=${this.close}>×</button>
          </div>

          <div class="dialog-body">
            ${this.error ? html`
              <div class="error">
                ${this.error}
              </div>
            ` : ''}

            <form @submit=${this.handleSubmit}>
              <div class="form-group">
                <label class="required">选择依赖的任务</label>
                <div class="help-text">
                  选择当前任务需要等待完成的任务。当前任务将在所选任务完成后才能开始。
                </div>
                ${this.loading ? html`
                  <div class="loading">加载任务列表中...</div>
                ` : this.tasks.length === 0 ? html`
                  <div class="empty-state">
                    没有可用的任务作为依赖
                  </div>
                ` : html`
                  <div class="task-list">
                    ${this.tasks.map(task => html`
                      <div 
                        class="task-item ${this.selectedTaskId === task.id ? 'selected' : ''}"
                        @click=${() => this.handleTaskSelect(task.id)}
                      >
                        <div class="task-title">
                          ${task.title}
                          <span class="task-id">#${task.id}</span>
                        </div>
                        ${task.description ? html`
                          <div class="task-description" title=${task.description}>
                            ${task.description}
                          </div>
                        ` : ''}
                      </div>
                    `)}
                  </div>
                `}
              </div>

              <div class="dialog-footer">
                <button type="submit" ?disabled=${!this.selectedTaskId || this.saving}>
                  ${this.saving ? '添加中...' : '添加依赖'}
                </button>
                <button type="button" class="secondary" @click=${this.handleCancel} ?disabled=${this.saving}>
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'add-dependency-dialog': AddDependencyDialog;
  }
}