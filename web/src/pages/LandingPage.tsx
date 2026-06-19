import { A } from "@solidjs/router";
import { useAuth } from "../auth/context.tsx";
import styles from "./LandingPage.module.css";

const modules = [
  { path: "/t", icon: "📋", title: "任务管理", desc: "列表/看板/日历/DAG多视图管理待办事项" },
  { path: "/c", icon: "📇", title: "知识卡片", desc: "记录和浏览知识片段" },
  { path: "/o", icon: "🧠", title: "本体系统", desc: "管理概念本体与符号关系" },
  { path: "/m", icon: "🧩", title: "间隔记忆", desc: "基于 FSRS 的智能复习系统" },
  { path: "/text", icon: "✍️", title: "文本编辑", desc: "多标签纯文本编辑器" },
  { path: "/i", icon: "🖼️", title: "图片管理", desc: "上传和管理图片资源" },
];

export default function LandingPage() {
  const { auth } = useAuth();

  if (auth().user) return null;

  return (
    <div class={styles.landingPage}>
      <h1 class={styles.heroTitle}>🧠 Brainbow</h1>
      <p class={styles.heroSubtitle}>
        个人知识管理与思维工具集——任务、卡片、本体、记忆，一站式工作台
      </p>

      <div class={styles.ctaRow}>
        <button
          type="button"
          class={styles.ctaPrimary}
          onClick={() =>
            globalThis.dispatchEvent(new CustomEvent("auth:required"))
          }
        >
          开始使用
        </button>
      </div>

      <div class={styles.featureGrid}>
        {modules.map((m) => (
          <A href={m.path} class={styles.featureCard}>
            <span class={styles.featureIcon}>{m.icon}</span>
            <h3>{m.title}</h3>
            <p>{m.desc}</p>
          </A>
        ))}
      </div>

      <p class={styles.hint}>
        按 <kbd>Ctrl+K</kbd> 打开命令面板，输入 <kbd>/</kbd> 导航、<kbd>?</kbd> 搜索、<kbd>:</kbd> 指令
      </p>
    </div>
  );
}
