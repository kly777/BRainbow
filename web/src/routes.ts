import { lazy, type Component } from "solid-js";
import type { RouteDefinition } from "@solidjs/router";

export interface RouteConfig {
  path: string;
  label: string;
  desc: string;
  /** 是否为导航入口（显示在 / 命令面板中） */
  nav?: boolean;
  component: Component;
}

/** 提取 Router 需要的字段 */
export function toRouteDefs(config: RouteConfig[]): RouteDefinition[] {
  return config.map(({ path, component }) => ({ path, component }));
}

export const ROUTES: RouteConfig[] = [
  {
    path: "/",
    label: "主页",
    desc: "首页面板",
    nav: true,
    component: lazy(() => import("./pages/HomeGuard.tsx")),
  },
  {
    path: "/t",
    label: "任务",
    desc: "任务管理",
    nav: true,
    component: lazy(() => import("./pages/TaskManager.tsx")),
  },
  {
    path: "/o",
    label: "本体",
    desc: "本体与符号系统",
    nav: true,
    component: lazy(() => import("./pages/ontology/OntologyList.tsx")),
  },
  {
    path: "/c",
    label: "卡片",
    desc: "知识卡片浏览",
    nav: true,
    component: lazy(() => import("./pages/card/CardsList.tsx")),
  },
  {
    path: "/c/:id",
    label: "卡片详情",
    desc: "",
    component: lazy(() => import("./pages/card/CardDetail.tsx")),
  },
  {
    path: "/c/edit/:id",
    label: "编辑卡片",
    desc: "",
    component: lazy(() => import("./pages/card/CardEdit.tsx")),
  },
  {
    path: "/i",
    label: "图片",
    desc: "图片管理",
    nav: true,
    component: lazy(() => import("./pages/media/MediaList.tsx")),
  },
  {
    path: "/db",
    label: "数据库",
    desc: "管理员数据库查看",
    nav: true,
    component: lazy(() => import("./pages/DbViewer.tsx")),
  },
  {
    path: "/rg",
    label: "彩虹生成器",
    desc: "Rainbow Generator",
    nav: true,
    component: lazy(() => import("./pages/RainbowGenerator.tsx")),
  },
  {
    path: "/text",
    label: "文本编辑",
    desc: "多标签纯文本编辑器",
    nav: true,
    component: lazy(() => import("./pages/TextEditor.tsx")),
  },
  {
    path: "/m",
    label: "记忆",
    desc: "间隔重复记忆系统",
    nav: true,
    component: lazy(() => import("./pages/MemPage.tsx")),
  },
  {
    path: "/m/add",
    label: "添加记忆",
    desc: "",
    nav: false,
    component: lazy(() => import("./pages/MemAdd.tsx")),
  },
  {
    path: "/m/manage",
    label: "记忆管理",
    desc: "",
    nav: false,
    component: lazy(() => import("./pages/MemManage.tsx")),
  },
];

/** 仅导航入口，用于命令面板 */
export const NAV_ROUTES = ROUTES.filter((r) => r.nav);
