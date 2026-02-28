import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { taskApi } from './api';
import type { Task, CreateTaskRequest, UpdateTaskRequest } from './types';

@customElement('task-form')
export class TaskForm extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: Arial, sans-serif;
    }

    .container {
      max-width: 800px;
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

    .form-container {
      background-color: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .form-group {
      margin-bottom: 25px;
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

    input[type="text"],
    textarea {
      width: 100%;
      padding: 12px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-size: 14px;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }

    input[type="text"]:focus,
    textarea:focus {
      outline: none;
      border-color: #0066cc;
      box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.1);
    }

    textarea {
      min-height: 120px;
      resize: vertical;
      font-family: inherit;
    }

    .form-actions {
      display: flex;
      gap: 15px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #dee2e6;
    }

    button {
      padding: 10px 20px;
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

    .success {
      background-color: #d4edda;
      color: #155724;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 20px;
      border: 1px solid #c3e6cb;
    }

    .help-text {
      font-size: 12px;
      color: #6c757d;
      margin-top: 5px;
    }

    .character-count {
      font-size: 12px;
      color: #6c757d;
      text-align: right;
      margin-top: 5px;
    }

    .character-count.warning {
      color: #dc3545;
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
      .container {
        padding: 10px;
      }

      .form-container {
        padding: 20px;
      }

      .form-actions {
        flex-direction: column;
      }

      button {
        width: 100%;
      }
    }
  `;

  @property({ type: Number })
  taskId?: number;

  @property({ type: Boolean })
  editMode = false;

  @state()
  private title = '';

  @state()
  private description = '';

  @state()
  private loading = false;

  @state()
  private saving = false;

  @state()
  private error: string | null = null;

  @state()
  private success: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    if (this.editMode && this.taskId) {
      this.loadTask();
    }
  }

  private async loadTask() {
    if (!this.taskId) return;

    this.loading = true;
    this.error = null;

    try {
      const taskDetail = await taskApi.getTask(this.taskId);
      this.title = taskDetail.task.title;
      this.description = taskDetail.task.description || '';
    } catch (err) {
      this.error = err instanceof Error ? err.message : '加载任务失败';
      console.error('Failed to load task:', err);
    } finally {
      this.loading = false;
    }
  }

  private handleTitleChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.title = input.value;
  }

  private handleDescriptionChange(event: Event) {
    const textarea = event.target as HTMLTextAreaElement;
    this.description = textarea.value;
  }

  private validateForm(): boolean {
    if (!this.title.trim()) {
      this.error = '标题不能为空';
      return false;
    }

    if (this.title.length > 200) {
      this.error = '标题不能超过200个字符';
      return false;
    }

    if (this.description.length > 5000) {
      this.error = '描述不能超过5000个字符';
      return false;
    }

    return true;
  }

  private async handleSubmit(event: Event) {
    event.preventDefault();

    if (!this.validateForm()) {
      return;
    }

    this.saving = true;
    this.error = null;
    this.success = null;

    try {
      const taskData: CreateTaskRequest | UpdateTaskRequest = {
        title: this.title.trim(),
        description: this.description.trim() || null
      };

      if (this.editMode && this.taskId) {
        await taskApi.updateTask(this.taskId, taskData);
        this.success = '任务更新成功！';
      } else {
        await taskApi.createTask(taskData);
        this.success = '任务创建成功！';
        this.title = '';
        this.description = '';
      }

      // 通知父组件任务已保存
      this.dispatchEvent(new CustomEvent('task-saved', {
        detail: { taskId: this.taskId }
      }));

    } catch (err) {
      this.error = err instanceof Error ? err.message : '保存任务失败';
      console.error('Failed to save task:', err);
    } finally {
      this.saving = false;
    }
  }

  private handleCancel() {
    this.dispatchEvent(new CustomEvent('cancel'));
  }

  private handleBack() {
    this.dispatchEvent(new CustomEvent('back'));
  }

  private get characterCountWarning(): boolean {
    return this.description.length > 4500;
  }

  render() {
    if (this.loading) {
      return html`
        <div class="container">
          <div class="loading">加载中...</div>
        </div>
      `;
    }

    return html`
      <div class="container">
        <a class="back-link" @click=${this.handleBack}>
          ← 返回任务列表
        </a>

        <div class="header">
          <h1>${this.editMode ? '编辑任务' : '创建新任务'}</h1>
        </div>

        ${this.error ? html`
          <div class="error">
            ${this.error}
          </div>
        ` : ''}

        ${this.success ? html`
          <div class="success">
            ${this.success}
          </div>
        ` : ''}

        <div class="form-container">
          <form @submit=${this.handleSubmit}>
            <div class="form-group">
              <label for="title" class="required">标题</label>
              <input
                type="text"
                id="title"
                .value=${this.title}
                @input=${this.handleTitleChange}
                placeholder="请输入任务标题"
                required
                maxlength="200"
                ?disabled=${this.saving}
              />
              <div class="help-text">简洁明了地描述任务内容，最多200个字符</div>
            </div>

            <div class="form-group">
              <label for="description">描述</label>
              <textarea
                id="description"
                .value=${this.description}
                @input=${this.handleDescriptionChange}
                placeholder="请输入任务详细描述（可选）"
                ?disabled=${this.saving}
                maxlength="5000"
              ></textarea>
              <div class="character-count ${this.characterCountWarning ? 'warning' : ''}">
                ${this.description.length}/5000
              </div>
              <div class="help-text">详细描述任务要求、目标、注意事项等信息</div>
            </div>

            <div class="form-actions">
              <button type="submit" ?disabled=${this.saving}>
                ${this.saving ? '保存中...' : (this.editMode ? '更新任务' : '创建任务')}
              </button>
              <button type="button" class="secondary" @click=${this.handleCancel} ?disabled=${this.saving}>
                取消
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'task-form': TaskForm;
  }
}