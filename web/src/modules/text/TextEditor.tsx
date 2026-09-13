import { For } from "solid-js";
import { useTextEditor } from "./hooks/useTextEditor.ts";
import styles from "./TextEditor.module.css";

export default function TextEditor() {
	const m = useTextEditor();

	return (
		<div class={styles.page}>
			<div class={styles.tabs} role="tablist">
				<For each={m.tabs()}>
					{(tab, i) => (
						<div
							role="tab"
							tabIndex={m.active() === i() ? 0 : -1}
							aria-selected={m.active() === i()}
							classList={{
								[styles.tab]: true,
								[styles.tabActive]: m.active() === i(),
							}}
							onClick={() => m.selectTab(i())}
							onDblClick={() => m.startRename(i())}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									m.selectTab(i());
								}
								if (e.key === "ArrowLeft") {
									e.preventDefault();
									m.selectTab((i() - 1 + m.tabs().length) % m.tabs().length);
								}
								if (e.key === "ArrowRight") {
									e.preventDefault();
									m.selectTab((i() + 1) % m.tabs().length);
								}
							}}
						>
							{m.editing() === i() ? (
								<input
									ref={m.bindEditInput}
									class={styles.renameInput}
									aria-label="重命名标签"
									value={m.editValue()}
									onInput={(e) => m.setEditValue(e.currentTarget.value)}
									onBlur={() => m.commitRename(i())}
									onKeyDown={(e) => {
										if (e.key === "Enter") m.commitRename(i());
										if (e.key === "Escape") m.cancelRename();
										e.stopPropagation();
									}}
									onClick={(e) => e.stopPropagation()}
								/>
							) : (
								<span>{tab.name}</span>
							)}
							<button
								type="button"
								class={styles.closeBtn}
								onClick={(e) => {
									e.stopPropagation();
									m.removeTab(i());
								}}
								disabled={m.tabs().length <= 1}
								aria-label={`关闭 ${tab.name}`}
							>
								×
							</button>
						</div>
					)}
				</For>
				<button
					type="button"
					class={styles.addBtn}
					onClick={m.addTab}
					aria-label="新建标签"
				>
					+
				</button>
			</div>
			<textarea
				class={styles.editor}
				value={m.tabs()[m.active()]?.content ?? ""}
				onInput={(e) => m.onTextInput(e.currentTarget.value)}
				placeholder="在这里输入…"
				spellcheck={false}
				aria-label="文本内容"
			/>
		</div>
	);
}
