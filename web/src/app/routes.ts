import { NAV_ITEMS } from "@config/navigation";
import { PATHS, type PathValue } from "@config/paths";
import type { RouteDefinition } from "@solidjs/router";
import { useLocation } from "@solidjs/router";
import { type Component, createEffect, lazy } from "solid-js";

export interface RouteConfig {
	path: PathValue;
	label: string;
	desc: string;
	/** 是否为导航入口（显示在 / 命令面板中） */
	nav?: boolean;
	/** 页面标题（英文）。为空则仅显示「Brainbow」。动态标题在组件内用 document.title 覆盖 */
	title?: string;
	component: Component;
}

type PageLoader = () => Promise<{ default: Component }>;

/**
 * 路径 → 页面组件（懒加载）。
 * Record<PathValue, PageLoader> 让 TS 穷尽检查：PATHS 新增路径但漏加 loader 会编译失败。
 */
const PAGE_LOADERS: Record<PathValue, PageLoader> = {
	[PATHS.home]: () => import("@app/routes/HomeGuard.tsx"),
	[PATHS.search]: () => import("@modules/search/SearchPage.tsx"),
	[PATHS.task]: () => import("@modules/task/TaskManager.tsx"),
	[PATHS.taskDetail]: () => import("@modules/task/TaskDetail.tsx"),
	[PATHS.ontology]: () => import("@modules/ontology/OntologyList.tsx"),
	[PATHS.ontologyDetail]: () => import("@modules/ontology/OntologyDetail.tsx"),
	[PATHS.card]: () => import("@modules/card/CardsList.tsx"),
	[PATHS.cardDetail]: () => import("@modules/card/CardDetail.tsx"),
	[PATHS.cardEdit]: () => import("@modules/card/CardEdit.tsx"),
	[PATHS.color]: () => import("@modules/color/ColorPage.tsx"),
	[PATHS.cardAdd]: () => import("@modules/card/CardAdd.tsx"),
	[PATHS.file]: () => import("@modules/file/FileList.tsx"),
	[PATHS.fileDetail]: () => import("@modules/file/FileDetail.tsx"),
	[PATHS.db]: () => import("@modules/db/DbViewer.tsx"),
	[PATHS.rainbow]: () => import("@modules/rainbow/RainbowGenerator.tsx"),
	[PATHS.text]: () => import("@modules/text/TextEditor.tsx"),
	[PATHS.reading]: () => import("@modules/reading/ReadingList.tsx"),
	[PATHS.readingUnknown]: () => import("@modules/reading/ReadingUnknown.tsx"),
	[PATHS.bookmark]: () => import("@modules/bookmark/BookmarkPage.tsx"),
	[PATHS.bookmarkManage]: () =>
		import("@modules/bookmark/BookmarkManagePage.tsx"),
	[PATHS.bookmarkDetail]: () => import("@modules/bookmark/BookmarkDetail.tsx"),
	[PATHS.readingDetail]: () => import("@modules/reading/ReadingDetail.tsx"),
	[PATHS.memory]: () => import("@modules/mem/MemPage.tsx"),
	[PATHS.memoryAdd]: () => import("@modules/mem/MemAdd.tsx"),
	[PATHS.memoryManage]: () => import("@modules/mem/MemManage.tsx"),
	[PATHS.conversation]: () => import("@modules/conv/ConvSearch.tsx"),
	[PATHS.convDetail]: () => import("@modules/conv/ConvDetail.tsx"),
	[PATHS.convConcept]: () => import("@modules/conv/ConvConcept.tsx"),
	[PATHS.chat]: () => import("@modules/chat/ChatPage.tsx"),
	[PATHS.chatPrompts]: () => import("@modules/chat/ChatPromptsPage.tsx"),
	[PATHS.chatMem]: () => import("@modules/chat/ChatMemPage.tsx"),
	[PATHS.key]: () => import("@modules/key/KeyPage.tsx"),
	[PATHS.admin]: () => import("@modules/admin/AdminPage.tsx"),
};

/**
 * 配了数据预取的路由（阶段 6）。这里只放路径清单，**实现按需加载**
 * （`app/route-preloads.ts`）—— 预取代码不该进首屏 chunk。
 */
const PRELOADED_PATHS = new Set<string>([
	PATHS.cardDetail,
	PATHS.ontologyDetail,
	PATHS.bookmarkDetail,
	PATHS.taskDetail,
	PATHS.convDetail,
	PATHS.fileDetail,
]);

/**
 * 提取 Router 需要的字段。
 * `preload`（阶段 6）：路由器在链接悬停 / 预取意图时调用它，把详情数据提前放进
 * shared/api/cache.ts，点击时页面直接命中缓存。是否真的取数由实现里的 intent 门控决定
 * （导航与首屏不重复取，理由见 route-preloads.ts）。
 */
export function toRouteDefs(config: RouteConfig[]): RouteDefinition[] {
	return config.map(({ path, component }) => ({
		path,
		component,
		preload: PRELOADED_PATHS.has(path)
			? async (args) => {
					const { PAGE_PRELOADS, shouldPrefetch } = await import(
						"@app/route-preloads.ts"
					);
					if (!shouldPrefetch(args.intent)) return;
					await PAGE_PRELOADS[path as PathValue]?.(args);
				}
			: undefined,
	}));
}

/** 路由定义：元数据（label/title/desc/nav）来自 navigation.ts 单一来源 */
export const ROUTES: RouteConfig[] = NAV_ITEMS.map((item) => ({
	...item,
	component: lazy(PAGE_LOADERS[item.path]),
}));

/** 将路由路径模式转为匹配用的正则 */
function pathToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regexStr = escaped.replace(/:\w+/g, "[^/]+");
	return new RegExp(`^${regexStr}$`);
}

/** 根据当前路径查找匹配的路由配置 */
export function findRoute(path: string): RouteConfig | undefined {
	return ROUTES.find((r) => pathToRegex(r.path).test(path));
}

/**
 * 放在 Layout 中，根据当前路径自动设置页面标题。
 * 动态标题（如文章阅读页）可以在组件内覆盖：document.title = "..."
 */
export function RouteTitle() {
	const location = useLocation();
	createEffect(() => {
		const route = findRoute(location.pathname);
		const title = route?.title;
		document.title = title ? `${title} · Brainbow` : "Brainbow";
	});
	return null;
}
