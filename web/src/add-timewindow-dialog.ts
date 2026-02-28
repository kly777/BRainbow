import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { taskApi } from './api';
import type { TimeWindow } from './types';

@customElement('add-timewindow-dialog')
export class AddTimeWindowDialog extends LitElement {
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

    .timewindow-list {
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid #ced4da;
      border-radius: 4px;
    }

    .timewindow-item {
      padding: 12px 15px;
      border-bottom: 1px solid #e9ecef;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .timewindow-item:hover {
      background-color: #f8f9fa;
    }

    .timewindow-item.selected {
      background-color: #e7f3ff;
      border-left: 4px solid #0066cc;
    }

    .timewindow-item:last-child {
      border-bottom: none;
    }

    .timewindow-id {
      font-weight: 500;
      color: #333;
    }

    .timewindow-dates {
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

    .allocation-type-group {
      margin-top: 20px;
    }

    .allocation-type-options {
      display: flex;
      gap: 15px;
      margin-top: 10px;
    }

    .allocation-type-option {
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
    }

    .allocation-type-option input[type="radio"] {
      margin: 0;
    }

    .allocation-type-label {
      font-size: 14px;
      color: #495057;
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

      .timewindow-dates {
        flex-direction: column;
        gap: 5px;
      }
    }
  `;

  @property({ type: Number })
  taskId!: number;

  @state()
  private timeWindows: TimeWindow[] = [];

  @state()
  private loading = false;

  @state()
  private error: string | null = null;

  @state()
  private selectedTimeWindowId: number | null = null;

  @state()
  private allocationType: number = 0;

  @state()
  private saving = false;

  connectedCallback() {
    super.connectedCallback();
    this.loadTimeWindows();
  }

  private async loadTimeWindows() {
    this.loading = true;
    this.error = null;

    try {
      // 获取所有时间窗口
      this.timeWindows = await taskApi.getAllTimeWindows();
    } catch (err) {
      this.error = err instanceof Error ? err.message : '加载时间窗口失败';
      console.error('Failed to load time windows:', err);
    } finally {
      this.loading = false;
    }
  }

  private handleTimeWindowSelect(timeWindowId: number) {
    this.selectedTimeWindowId = timeWindowId;
  }

  private handleAllocationTypeChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.allocationType = parseInt(input.value);
  }

  private async handleSubmit(event: Event) {
    event.preventDefault();

    if (!this.selectedTimeWindowId) {
      this.error = '请选择一个时间窗口';
      return;
    }

    this.saving = true;
    this.error = null;

    try {
      await taskApi.addTimeWindow(this.taskId, {
        time_window_id: this.selectedTimeWindowId,
        allocation_type: this.allocationType
      });

      // 通知父组件时间窗口已添加
      this.dispatchEvent(new CustomEvent('timewindow-added', {
        detail: {
          taskId: this.taskId,
          timeWindowId: this.selectedTimeWindowId,
          allocationType: this.allocationType
        }
      }));

      // 关闭对话框
      this.close();
    } catch (err) {
      this.error = err instanceof Error ? err.message : '分配时间窗口失败';
      console.error('Failed to add time window:', err);
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

  private formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('zh-CN', {
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
      <div class="dialog-overlay" @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains('dialog-overlay')) {
          this.close();
        }
      }}>
        <div class="dialog-content">
          <div class="dialog-header">
            <h2 class="dialog-title">分配时间窗口</h2>
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
                <label class="required">选择时间窗口</label>
                <div class="help-text">
                  为任务选择一个可用的时间窗口。任务将在所选时间窗口内进行。
                </div>
                ${this.loading ? html`
                  <div class="loading">加载时间窗口中...</div>
                ` : this.timeWindows.length === 0 ? html`
                  <div class="empty-state">
                    没有可用的时间窗口
                  </div>
                ` : html`
                  <div class="timewindow-list">
                    ${this.timeWindows.map(timeWindow => html`
                      <div
                        class="timewindow-item ${this.selectedTimeWindowId === timeWindow.id ? 'selected' : ''}"
                        @click=${() => this.handleTimeWindowSelect(timeWindow.id)}
                      >
                        <div class="timewindow-id">
                          时间窗口 #${timeWindow.id}
                        </div>
                        <div class="timewindow-dates">
                          <div>
                            <span class="date-label">开始:</span>
                            ${this.formatDate(timeWindow.starts_at)}
                          </div>
                          <div>
                            <span class="date-label">结束:</span>
                            ${this.formatDate(timeWindow.ends_at)}
                          </div>
                        </div>
                      </div>
                    `)}
                  </div>
                `}
              </div>

              <div class="form-group allocation-type-group">
                <label class="required">分配类型</label>
                <div class="help-text">
                  选择任务在时间窗口中的分配方式。
                </div>
                <div class="allocation-type-options">
                  <label class="allocation-type-option">
                    <input
                      type="radio"
                      name="allocationType"
                      value="0"
                      .checked=${this.allocationType === 0}
                      @change=${this.handleAllocationTypeChange}
                    />
                    <span class="allocation-type-label">独占分配</span>
                  </label>
                  <label class="allocation-type-option">
                    <input
                      type="radio"
                      name="allocationType"
                      value="1"
                      .checked=${this.allocationType === 1}
                      @change=${this.handleAllocationTypeChange}
                    />
                    <span class="allocation-type-label">共享分配</span>
                  </label>
                  <label class="allocation-type-option">
                    <input
                      type="radio"
                      name="allocationType"
                      value="2"
                      .checked=${this.allocationType === 2}
                      @change=${this.handleAllocationTypeChange}
                    />
                    <span class="allocation-type-label">弹性分配</span>
                  </label>
                </div>
              </div>

              <div class="dialog-footer">
                <button type="submit" ?disabled=${!this.selectedTimeWindowId || this.saving}>
                  ${this.saving ? '分配中...' : '分配时间窗口'}
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
    'add-timewindow-dialog': AddTimeWindowDialog;
  }
}
