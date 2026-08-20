import { MarkdownEditor } from "@components";
import {
	AsyncView,
	Button,
	Markdown as MarkdownRenderer,
} from "@components/ui";
import { fmtLocal } from "@lib/utils";
import { type Component, Show } from "solid-js";
import styles from "./CardEdit.module.css";
import { useCardEdit } from "./hooks/useCardEdit.ts";

const DirtyBadge: Component<{ dirty: boolean }> = (props) => (
	<Show when={props.dirty}>
		<span class={styles.dirty}>
			<span class={styles.dirtyDot} />
			未保存
		</span>
	</Show>
);

const CardEditHeader: Component<{
	cardId: number;
	dirty: boolean;
	isSubmitting: boolean;
	stampLabel: string;
	stamp: string;
	onDelete: () => void;
	onView: () => void;
	onSave: () => void;
}> = (props) => (
	<header class={styles.header}>
		<div class={styles.titleRow}>
			<h1 class={styles.title}>
				编辑卡片 <span class={styles.cardNo}>#{props.cardId}</span>
			</h1>
			<div class={styles.actions}>
				<Button variant="danger" size="sm" onClick={props.onDelete}>
					删除
				</Button>
				<Button variant="secondary" size="sm" onClick={props.onView}>
					查看
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={props.onSave}
					disabled={props.isSubmitting || !props.dirty}
				>
					{props.isSubmitting ? "保存中…" : "保存"}
				</Button>
			</div>
		</div>
		<div class={styles.metaRow}>
			<span class={styles.meta}>
				{props.stampLabel} {fmtLocal(props.stamp)}
			</span>
			<DirtyBadge dirty={props.dirty} />
		</div>
	</header>
);

const EditorPane: Component<{
	value: string;
	onInput: (value: string) => void;
}> = (props) => (
	<section class={styles.pane}>
		<div class={styles.paneHead}>
			编辑
			<span class={styles.paneHint}>Markdown · 粘贴/拖拽图片自动上传</span>
		</div>
		<MarkdownEditor
			editorClass={styles.editor}
			class={styles.textarea}
			value={props.value}
			onInput={props.onInput}
			rows={8}
			placeholder="输入 Markdown 内容…"
		/>
	</section>
);

const PreviewPane: Component<{ content: string }> = (props) => (
	<section class={styles.pane}>
		<div class={styles.paneHead}>实时预览</div>
		<div class={styles.preview}>
			<Show
				when={props.content.trim()}
				fallback={
					<div class={styles.previewEmpty}>
						开始输入，此处实时渲染 Markdown…
					</div>
				}
			>
				<MarkdownRenderer content={props.content} />
			</Show>
		</div>
	</section>
);

const CardEditWorkspace: Component<{
	content: string;
	onInput: (value: string) => void;
	onKeyDown: (e: KeyboardEvent) => void;
}> = (props) => (
	<div class={styles.workspace} onKeyDown={props.onKeyDown} role="none">
		<div class={styles.panes}>
			<EditorPane value={props.content} onInput={props.onInput} />
			<div class={styles.fold} />
			<PreviewPane content={props.content} />
		</div>
		<footer class={styles.statusbar}>
			<span>{props.content.length} 字</span>
			<span class={styles.shortcut}>
				<kbd>Ctrl</kbd> + <kbd>Enter</kbd> 保存
			</span>
		</footer>
	</div>
);

const CardEditPage: Component = () => {
	const m = useCardEdit();

	return (
		<div class={styles.container}>
			<CardEditHeader
				cardId={m.cardId()}
				dirty={m.dirty()}
				isSubmitting={m.isSubmitting()}
				stampLabel={m.stampLabel()}
				stamp={m.stamp()}
				onDelete={m.handleDelete}
				onView={m.handleView}
				onSave={m.doSave}
			/>

			<Show when={m.error()}>
				<div class={styles.errorMsg}>{m.error()}</div>
			</Show>

			<AsyncView
				data={m.card() ? [m.card()] : []}
				loading={m.cardLoading}
				error={m.cardError}
				onRetry={m.refetch}
			>
				{() => (
					<Show when={!m.cardLoading && !m.cardError}>
						<CardEditWorkspace
							content={m.content()}
							onInput={m.setContent}
							onKeyDown={m.onKeyDown}
						/>
					</Show>
				)}
			</AsyncView>
		</div>
	);
};

export default CardEditPage;
