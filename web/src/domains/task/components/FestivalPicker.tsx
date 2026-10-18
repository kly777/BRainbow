// ── 订阅传统节日 ──
//
// 目录由后端给出（含清明的节气规则）；订阅后生成 event series，materializer 负责具体日期。

import { Button, Modal } from "@components/ui";
import { createResource, createSignal, For, Show } from "solid-js";
import { getFestivalsE, subscribeFestivalsE } from "../calendarApi.ts";
import styles from "./FestivalPicker.module.css";

export interface FestivalPickerProps {
	isOpen: boolean;
	onClose: () => void;
	onSaved: () => void;
}

export default function FestivalPicker(props: FestivalPickerProps) {
	const [festivals] = createResource(() => getFestivalsE());
	const [selected, setSelected] = createSignal<Set<string>>(new Set());
	const [error, setError] = createSignal<string | null>(null);
	const [saving, setSaving] = createSignal(false);

	const toggle = (key: string) => {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const submit = async () => {
		if (selected().size === 0) {
			setError("至少选一个节日");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await subscribeFestivalsE([...selected()]);
			props.onSaved();
			props.onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "订阅失败");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal
			isOpen={props.isOpen}
			onClose={props.onClose}
			title="订阅传统节日"
			actions={
				<>
					<Button variant="secondary" onClick={props.onClose}>
						取消
					</Button>
					<Button variant="primary" onClick={submit} disabled={saving()}>
						{saving() ? "订阅中…" : "订阅"}
					</Button>
				</>
			}
		>
			<div class={styles.list}>
				<Show when={festivals()} fallback={<p class={styles.hint}>加载中…</p>}>
					{(items) => (
						<For each={items()}>
							{(festival) => (
								<label class={styles.item}>
									<input
										type="checkbox"
										checked={selected().has(festival.key)}
										onChange={() => toggle(festival.key)}
									/>
									<span class={styles.name}>{festival.title}</span>
									<span class={styles.note}>{festival.note}</span>
								</label>
							)}
						</For>
					)}
				</Show>
				<Show when={error()}>
					{(message) => (
						<p class={styles.error} role="alert">
							{message()}
						</p>
					)}
				</Show>
			</div>
		</Modal>
	);
}
