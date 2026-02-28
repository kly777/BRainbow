import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './task-list';
import './task-detail';
import './task-form';
import './add-subtask-dialog';
import './add-dependency-dialog';
import './add-timewindow-dialog';
import type { Task } from './types';

@customElement('brainbow-app')
export class BrainbowApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: Arial, sans-serif;
      min-height: 100vh;
      background-color: #f5f5f5;
    }

    .app-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    .app-header {
      background-color: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .app-title {
      margin: 0;
      color: #333;
      font-size: 24px;
    }

    .app-title span {
      color: #0066cc;
    }

    .nav-links {
      display: flex;
      gap: 20px;
    }

    .nav-link {
      color: #0066cc;
      text-decoration: none;
      font-weight: 500;
      padding: 8px 16px;
      border-radius: 4px;
      transition: background-color 0.2s;
    }

    .nav-link:hover {
      background-color: #f0f7ff;
    }

    .nav-link.active {
      background-color: #0066cc;
      color: white;
    }

    .app-content {
      background-color: white;
      border-radius: 8px;
      padding: 0;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      min-height: 600px;
    }

    .breadcrumb {
      padding: 15px 20px;
      border-bottom: 1px solid #e9ecef;
      background-color: #f8f9fa;
      border-radius: 8px 8px 0 0;
    }

    .breadcrumb-item {
      display: inline-flex;
      align-items: center;
      color: #6c757d;
      font-size: 14px;
    }

    .breadcrumb-item:not(:last-child)::after {
      content: '›';
      margin: 0 10px;
      color: #adb5bd;
    }

    .breadcrumb-link {
      color: #0066cc;
      text-decoration: none;
      cursor: pointer;
    }

    .breadcrumb-link:hover {
      text-decoration: underline;
    }

    .content-area {
      padding: 20px;
    }

    .footer {
      text-align: center;
      padding: 20px;
      margin-top: 20px;
      color: #6c757d;
      font-size: 14px;
      border-top: 1px solid #e9ecef;
    }

    @media (max-width: 768px) {
      .app-container {
        padding: 10px;
      }

      .header-content {
        flex-direction: column;
        align-items: flex-start;
        gap: 15px;
      }

      .nav-links {
        width: 100%;
        justify-content: space-between;
      }

      .nav-link {
        flex: 1;
        text-align: center;
      }
    }
  `;

  @state()
  private currentView: 'list' | 'detail' | 'create' | 'edit' = 'list';

  @state()
  private currentTaskId: number | null = null;

  @state()
  private breadcrumb: Array<{ label: string; action?: () => void }> = [
    { label: '任务列表' }
  ];

  @state()
  private showAddSubTaskDialog = false;

  @state()
  private showAddDependencyDialog = false;

  @state()
  private showAddTimeWindowDialog = false;

  private updateBreadcrumb() {
    switch (this.currentView) {
      case 'list':
        this.breadcrumb = [{ label: '任务列表' }];
        break;
      case 'detail':
        this.breadcrumb = [
          { label: '任务列表', action: () => this.showListView() },
          { label: '任务详情' }
        ];
        break;
      case 'create':
        this.breadcrumb = [
          { label: '任务列表', action: () => this.showListView() },
          { label: '创建任务' }
        ];
        break;
      case 'edit':
        this.breadcrumb = [
          { label: '任务列表', action: () => this.showListView() },
          { label: '任务详情', action: () => this.showTaskDetail(this.currentTaskId!) },
          { label: '编辑任务' }
        ];
        break;
    }
  }

  private showListView() {
    this.currentView = 'list';
    this.currentTaskId = null;
    this.updateBreadcrumb();
  }

  private showTaskDetail(taskId: number) {
    this.currentView = 'detail';
    this.currentTaskId = taskId;
    this.updateBreadcrumb();
  }

  private showCreateView() {
    this.currentView = 'create';
    this.currentTaskId = null;
    this.updateBreadcrumb();
  }

  private showEditView(taskId: number) {
    this.currentView = 'edit';
    this.currentTaskId = taskId;
    this.updateBreadcrumb();
  }

  private handleViewTask(event: CustomEvent<{ taskId: number }>) {
    this.showTaskDetail(event.detail.taskId);
  }

  private handleEditTask(event: CustomEvent<{ taskId: number }>) {
    this.showEditView(event.detail.taskId);
  }

  private handleCreateTask() {
    this.showCreateView();
  }

  private handleTaskSaved() {
    this.showListView();
  }

  private handleCancel() {
    if (this.currentView === 'create') {
      this.showListView();
    } else if (this.currentView === 'edit' && this.currentTaskId) {
      this.showTaskDetail(this.currentTaskId);
    }
  }

  private handleBack() {
    if (this.currentView === 'detail' || this.currentView === 'create' || this.currentView === 'edit') {
      this.showListView();
    }
  }

  private handleDeleted(event: CustomEvent<{ taskId: number }>) {
    this.showListView();
  }

  private handleAddSubTask(event: CustomEvent<{ taskId: number }>) {
    this.currentTaskId = event.detail.taskId;
    this.showAddSubTaskDialog = true;
  }

  private handleAddDependency(event: CustomEvent<{ taskId: number }>) {
    this.currentTaskId = event.detail.taskId;
    this.showAddDependencyDialog = true;
  }

  private handleAddTimeWindow(event: CustomEvent<{ taskId: number }>) {
    this.currentTaskId = event.detail.taskId;
    this.showAddTimeWindowDialog = true;
  }

  private handleSubTaskAdded() {
    this.showAddSubTaskDialog = false;
    // 刷新任务详情
    if (this.currentTaskId && this.currentView === 'detail') {
      const detailComponent = this.shadowRoot?.querySelector('task-detail');
      if (detailComponent) {
        (detailComponent as any).loadTaskDetail();
      }
    }
  }

  private handleDependencyAdded() {
    this.showAddDependencyDialog = false;
    // 刷新任务详情
    if (this.currentTaskId && this.currentView === 'detail') {
      const detailComponent = this.shadowRoot?.querySelector('task-detail');
      if (detailComponent) {
        (detailComponent as any).loadTaskDetail();
      }
    }
  }

  private handleTimeWindowAdded() {
    this.showAddTimeWindowDialog = false;
    // 刷新任务详情
    if (this.currentTaskId && this.currentView === 'detail') {
      const detailComponent = this.shadowRoot?.querySelector('task-detail');
      if (detailComponent) {
        (detailComponent as any).loadTaskDetail();
      }
    }
  }

  private handleDialogClose() {
    this.showAddSubTaskDialog = false;
    this.showAddDependencyDialog = false;
    this.showAddTimeWindowDialog = false;
  }

  renderBreadcrumb() {
    return html`
      <div class="breadcrumb">
        ${this.breadcrumb.map((item, index) => html`
          <span class="breadcrumb-item">
            ${item.action ? html`
              <a class="breadcrumb-link" @click=${item.action}>${item.label}</a>
            ` : html`
              ${item.label}
            `}
          </span>
        `)}
      </div>
    `;
  }

  renderContent() {
    switch (this.currentView) {
      case 'list':
        return html`
          <task-list
            @view-task=${this.handleViewTask}
            @edit-task=${this.handleEditTask}
            @create-task=${this.handleCreateTask}
          ></task-list>
        `;
      case 'detail':
        if (!this.currentTaskId) return html`<div>任务ID无效</div>`;
        return html`
          <task-detail
            .taskId=${this.currentTaskId}
            @back=${this.handleBack}
            @edit=${this.handleEditTask}
            @deleted=${this.handleDeleted}
            @view-task=${this.handleViewTask}
            @add-sub-task=${this.handleAddSubTask}
            @add-dependency=${this.handleAddDependency}
            @add-time-window=${this.handleAddTimeWindow}
          ></task-detail>
        `;
      case 'create':
        return html`
          <task-form
            @task-saved=${this.handleTaskSaved}
            @cancel=${this.handleCancel}
            @back=${this.handleBack}
          ></task-form>
        `;
      case 'edit':
        if (!this.currentTaskId) return html`<div>任务ID无效</div>`;
        return html`
          <task-form
            .taskId=${this.currentTaskId}
            .editMode=${true}
            @task-saved=${this.handleTaskSaved}
            @cancel=${this.handleCancel}
            @back=${this.handleBack}
          ></task-form>
        `;
    }
  }

  render() {
    return html`
      <div class="app-container">
        <header class="app-header">
          <div class="header-content">
            <h1 class="app-title">Brainbow <span>任务管理</span></h1>
            <nav class="nav-links">
              <a class="nav-link ${this.currentView === 'list' ? 'active' : ''}" 
                 @click=${this.showListView}>
                任务列表
              </a>
              <a class="nav-link ${this.currentView === 'create' ? 'active' : ''}" 
                 @click=${this.showCreateView}>
                创建任务
              </a>
            </nav>
          </div>
        </header>

        <main class="app-content">
          ${this.renderBreadcrumb()}
          <div class="content-area">
            ${this.renderContent()}
          </div>
        </main>

        ${this.showAddSubTaskDialog && this.currentTaskId ? html`
          <add-subtask-dialog
            .parentTaskId=${this.currentTaskId}
            @subtask-added=${this.handleSubTaskAdded}
            @close=${this.handleDialogClose}
          ></add-subtask-dialog>
        ` : ''}

        ${this.showAddDependencyDialog && this.currentTaskId ? html`
          <add-dependency-dialog
            .taskId=${this.currentTaskId}
            @dependency-added=${this.handleDependencyAdded}
            @close=${this.handleDialogClose}
          ></add-dependency-dialog>
        ` : ''}

        ${this.showAddTimeWindowDialog && this.currentTaskId ? html`
          <add-timewindow-dialog
            .taskId=${this.currentTaskId}
            @timewindow-added=${this.handleTimeWindowAdded}
            @close=${this.handleDialogClose}
          ></add-timewindow-dialog>
        ` : ''}

        <footer class="footer">
          <p>Brainbow 任务管理系统 &copy; 2024</p>
          <p>基于 Lit 和 TypeScript 构建</p>
        </footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'brainbow-app': BrainbowApp;
  }
}