// ── 记忆复习页面 ──
// 薄壳视图层：渲染逻辑全部来自 useMemReview hook

import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import MarkdownRenderer from "../../components/ui/Markdown.tsx";
import MarkdownEditor from "../../components/ui/MarkdownEditor.tsx";
import { fmtInterval, fmtLocal } from "../../lib/time.ts";
import { useMemReview } from "./logic/useMemReview.ts";
import styles from "./MemPage.module.css";

export default function MemPage() {
	const m = useMemReview();

	return (
		<div class={styles.page}>
			{/* 侧边栏 */}
			<div
				class={styles.sidebar}
				classList={{ [styles.sidebarOpen]: m.sidebarOpen() }}
			>
				<div class={styles.sidebarHeader}>
					<span>学习池</span>
					<button
						type="button"
						class={styles.sidebarClose}
						onClick={() => m.setSidebarOpen(false)}
					>
						x
					</button>
				</div>
				<Show when={m.counts()}>
					{(c) => (
						<div class={styles.sidebarStats}>
							<span class={styles.statNew}>{c().new}</span>
							<span class={styles.statLearning}>{c().learning}</span>
							<span class={styles.statDue}>{c().due}</span>
							<span class={styles.statBuried}>{c().buried}</span>
							<span class={styles.statSuspended}>{c().suspended}</span>
						</div>
					)}
				</Show>
				<div class={styles.sidebarList}>
					<For each={m.due()}>
						{(mem, i) => (
							<button
								type="button"
								class={
									i() === m.current()
										? styles.sidebarActive
										: styles.sidebarItem
								}
								onClick={() => {
									m.setCurrent(i());
									m.setShowAnswer(false);
									m.setSidebarOpen(false);
								}}
							>
								<span class={styles.sidebarIdx}>#{mem.id}</span>
								<span class={styles.sidebarText}>
									{mem.cue.content.slice(0, 40) || "（空）"}
								</span>
								<span class={styles.sidebarState}>
									{mem.state === "new"
										? "新"
										: mem.state === "learning"
											? "学"
											: mem.state === "relearning"
												? "重"
												: "复"}
								</span>
							</button>
						)}
					</For>
				</div>
			</div>

			{/* 主区域 */}
			<div class={styles.main}>
				{/* 顶栏 */}
				<div class={styles.topBar}>
					<button
						type="button"
						class={styles.hamburger}
						onClick={() => m.setSidebarOpen(!m.sidebarOpen())}
					>
						☰
					</button>
					<span class={styles.title}>记忆复习</span>
					<div class={styles.topRight}>
						<A href="/m/add" class={styles.addLink}>
							＋ 添加
						</A>
						<A href="/m/manage" class={styles.manageLink}>
							管理
						</A>

						<Show
							when={m.editing()}
							fallback={
								<button
									type="button"
									class={styles.editLinkBtn}
									onClick={m.startEdit}
								>
									编辑
								</button>
							}
						>
							<button
								type="button"
								class={styles.editLinkBtn}
								onClick={m.saveEdit}
							>
								保存
							</button>
							<button
								type="button"
								class={styles.editLinkBtn}
								onClick={() => m.setEditing(false)}
							>
								取消
							</button>
						</Show>
						<span class={styles.count}>
							{m.due().length}/{m.maxLearning()}
						</span>
					</div>
				</div>

				{/* 标签过滤栏 */}
				<Show when={m.allTags().length > 0 || m.estimatedTotal() > 0}>
					<div class={styles.tagFilterBar}>
						<button
							type="button"
							class={styles.tagModeBtn}
							onClick={m.toggleTagMode}
							title={
								m.tagMode() === "include" ? "切换为排除模式" : "切换为包含模式"
							}
						>
							{m.tagMode() === "include" ? "☐ 包含" : "☒ 排除"}
						</button>
						<For each={m.tagFilterTags()}>
							{(tag) => (
								<span
									class={
										m.tagMode() === "include"
											? styles.tagFilterChipActive
											: styles.tagFilterChipExcluded
									}
								>
									{tag.name}
									<button
										type="button"
										class={styles.tagClear}
										onClick={() => m.removeTagFilter(tag.id)}
									>
										x
									</button>
								</span>
							)}
						</For>
						<Show when={m.tagFilterTags().length > 0}>
							<button
								type="button"
								class={styles.tagClearAll}
								onClick={m.clearTagFilters}
							>
								清除
							</button>
						</Show>
						<input
							type="text"
							class={styles.tagSearchInput}
							placeholder="添加标签过滤…"
							value={m.tagQuery()}
							onInput={(e) => {
								m.setTagQuery(e.currentTarget.value);
								m.setTagOpen(true);
							}}
							onFocus={() => m.setTagOpen(true)}
							onBlur={() => setTimeout(() => m.setTagOpen(false), 200)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && m.tagSuggestions().length > 0) {
									m.addTagFilter(m.tagSuggestions()[0]);
								}
							}}
						/>
						<Show when={m.tagOpen() && m.tagSuggestions().length > 0}>
							<div class={styles.tagDropdown}>
								{m.tagSuggestions().map((t) => (
									<button
										type="button"
										class={styles.tagOption}
										tabIndex={-1}
										onMouseDown={() => m.addTagFilter(t)}
									>
										{t.name}
									</button>
								))}
							</div>
						</Show>
						<Show when={m.estimatedTotal() > 0}>
							<span class={styles.progressText}>
								≈ {m.estimatedTotal()} 次学习
								<Show when={m.estRemaining() >= 60}>
									· ~{Math.round(m.estRemaining() / 60)}m
								</Show>
								<Show when={m.estRemaining() > 0 && m.estRemaining() < 60}>
									· ~{m.estRemaining()}s
								</Show>
							</span>
						</Show>
					</div>
				</Show>

				{/* 完成态 */}
				<Show when={m.done()}>
					<div class={styles.empty}>
						<p>🎉 本轮学习完成！</p>
						{m.upcoming() > 0 && (
							<p class={styles.hint}>还有 {m.upcoming()} 张卡在未来等待复习</p>
						)}
						<button type="button" class={styles.showBtn} onClick={m.loadDue}>
							再学一轮
						</button>
					</div>
				</Show>

				{/* 卡片区域 */}
				<Show
					when={!m.loading() && !m.done() && m.due().length > 0}
					fallback={
						<div class={styles.empty}>
							{m.loading() ? "加载中…" : "没有记忆卡片，去添加一些吧！"}
						</div>
					}
				>
					<Show when={m.allFar()}>
						<div class={styles.allFarBanner}>
							📅 所有卡的下次复习都在 24h 之后，当前为提前复习
						</div>
					</Show>

					<div class={styles.card}>
						<Show when={m.isPreview() && m.current() === 0}>
							<div class={styles.previewBanner}>
								将于 {fmtLocal(m.item()?.due_at ?? "")} 到期
							</div>
						</Show>

						{/* 复习模式 */}
						<Show when={!m.editing()}>
							<div class={styles.cue}>
								<div class={styles.sectionLabel}>
									线索
									<button
										type="button"
										class={styles.copyBtn}
										title="复制线索"
										onClick={() =>
											navigator.clipboard.writeText(m.item()?.cue.content ?? "")
										}
									>
										📋
									</button>
									<button
										type="button"
										class={styles.copyBtn}
										title="复制整张卡片"
										onClick={m.handleCopyCard}
									>
										📋+
									</button>
								</div>
								<div class={styles.content}>
									<MarkdownRenderer content={m.item()?.cue.content ?? ""} />
								</div>
							</div>
							<Show when={m.showAnswer()}>
								<div class={styles.divider} />
								<div class={styles.target}>
									<div class={styles.sectionLabel}>答案</div>
									<div class={styles.content}>
										<MarkdownRenderer
											content={m.item()?.target.content ?? ""}
										/>
									</div>
								</div>
							</Show>
						</Show>

						{/* 编辑模式 */}
						<Show when={m.editing()}>
							<div class={styles.cue}>
								<div class={styles.sectionLabel}>线索</div>
								<MarkdownEditor
									class={styles.editArea}
									value={m.editCue()}
									onInput={m.setEditCue}
									rows={3}
								/>
							</div>
							<div class={styles.divider} />
							<div class={styles.target}>
								<div class={styles.sectionLabel}>答案</div>
								<MarkdownEditor
									class={styles.editArea}
									value={m.editTarget()}
									onInput={m.setEditTarget}
									rows={3}
								/>
							</div>
						</Show>
					</div>

					{/* 操作区 */}
					<div class={styles.actions}>
						<Show
							when={!m.showAnswer()}
							fallback={
								<div class={styles.ratings}>
									<button
										type="button"
										class={styles.again}
										onClick={() => m.rate(1)}
									>
										<span class={styles.ratingLabel}>忘记</span>
										<span class={styles.ratingTime}>
											{fmtInterval(m.intervals()[0])}
										</span>
									</button>
									<button
										type="button"
										class={styles.hard}
										onClick={() => m.rate(2)}
									>
										<span class={styles.ratingLabel}>困难</span>
										<span class={styles.ratingTime}>
											{fmtInterval(m.intervals()[1])}
										</span>
									</button>
									<button
										type="button"
										class={styles.good}
										onClick={() => m.rate(3)}
									>
										<span class={styles.ratingLabel}>良好</span>
										<span class={styles.ratingTime}>
											{fmtInterval(m.intervals()[2])}
										</span>
									</button>
									<button
										type="button"
										class={styles.easy}
										onClick={() => m.rate(4)}
									>
										<span class={styles.ratingLabel}>简单</span>
										<span class={styles.ratingTime}>
											{fmtInterval(m.intervals()[3])}
										</span>
									</button>
								</div>
							}
						>
							<div class={styles.actionRow}>
								<button type="button" class={styles.buryBtn} onClick={m.bury}>
									跳过
								</button>
								<button
									type="button"
									class={styles.buryBtn}
									onClick={m.resumeSuspend}
								>
									挂起
								</button>
								<Show when={m.showUndo()}>
									<button type="button" class={styles.undoBtn} onClick={m.undo}>
										撤销
									</button>
								</Show>
								<button
									type="button"
									class={styles.showBtn}
									onClick={() => m.setShowAnswer(true)}
								>
									显示答案
								</button>
							</div>
						</Show>
					</div>
				</Show>
			</div>
		</div>
	);
}
