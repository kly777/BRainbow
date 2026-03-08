import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { lazy } from 'solid-js';
import './style.css';

// 懒加载页面组件
const TaskListPage = lazy(() => import('./pages/TaskList'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetail'));
const TaskFormPage = lazy(() => import('./pages/TaskForm'));

// 布局组件
function Layout(props: { children: any }) {
  return (
    <div class="app-container">
      <header class="app-header">
        <div class="header-content">
          <h1 class="app-title">Brainbow <span>任务管理</span></h1>
          <nav class="nav-links">
            <a href="/" class="nav-link">
              任务列表
            </a>
            <a href="/create" class="nav-link">
              创建任务
            </a>
          </nav>
        </div>
      </header>
      <main class="app-content">
        {props.children}
      </main>
      <footer class="footer">
        <p>© {new Date().getFullYear()} Brainbow 任务管理系统</p>
      </footer>
    </div>
  );
}

// 根组件
function App() {
  return (
    <Router>

        <Route path="/" component={() => (
          <Layout>
            <TaskListPage />
          </Layout>
        )} />
        <Route path="/task/:id" component={() => (
          <Layout>
            <TaskDetailPage />
          </Layout>
        )} />
        <Route path="/create" component={() => (
          <Layout>
            <TaskFormPage />
          </Layout>
        )} />
        <Route path="/edit/:id" component={() => (
          <Layout>
            <TaskFormPage editMode />
          </Layout>
        )} />

    </Router>
  );
}

// 渲染应用
const root = document.getElementById('app');
if (!root) {
  // 如果不存在root元素，创建一个
  const appDiv = document.createElement('div');
  appDiv.id = 'app';
  document.body.appendChild(appDiv);
  render(() => <App />, appDiv);
} else {
  render(() => <App />, root);
}
