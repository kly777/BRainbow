// ── 任务列表 / 看板的空态 ──
//
// 两种"空"要说不同的话（共享组件 EmptyState 的注释也强调这一点：是不是空、
// 空态说什么由调用方决定）：
//
// - **有筛选或搜索** → 空是用户自己设的条件造成的。先让他看见"是被条件挡住的"，
//   再给一键清除。对照参考产品：Todoist / Things 在筛选无结果时都留一条"清除筛选"，
//   而不是一句"暂无数据"让人怀疑是不是坏了。
// - **什么都没设** → 收件箱真的空。这里指回录入框（P6：收件箱要能接住"想做的事"，
//   所以文案是"记下来就行"，不是"请先创建任务"）。
//
// 只出文案与动作，排版交给 @components/ui 的 EmptyState。

import { Button, EmptyState } from "@components/ui";
import { List, Search } from "@components/ui/icons";
import { type Component, Show } from "solid-js";

interface Props {
	/** 有筛选或搜索：此时空是用户自己造成的，给"清除"这条路 */
	filtered: boolean;
	/** 清掉筛选与搜索（两者分属 provider 与 URL，调用方一起清） */
	onClear: () => void;
	class?: string;
}

export const TaskEmpty: Component<Props> = (props) => (
	<Show
		when={props.filtered}
		fallback={
			<EmptyState
				class={props.class}
				icon={<List size={20} />}
				title="还没有任务"
				hint="在上面的输入框写一句话就行，回车即创建 —— 截止、标签、优先级都可以以后再加。"
			/>
		}
	>
		<EmptyState
			class={props.class}
			icon={<Search size={20} />}
			title="没有符合条件的任务"
			hint="当前的筛选或搜索把任务都挡在外面了。"
			action={
				<Button variant="secondary" size="sm" onClick={props.onClear}>
					清除筛选
				</Button>
			}
		/>
	</Show>
);
