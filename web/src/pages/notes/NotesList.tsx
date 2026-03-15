import { type Component, createSignal, For, Show } from "solid-js";
import styles from "@/styles/notes/notesList.module.css";

// 模拟笔记数据类型
interface Note {
	id: number;
	title: string;
	content: string;
	category: string;
	tags: string[];
	created_at: string;
	updated_at: string;
}

const NotesListPage: Component = () => {
	// 模拟笔记数据
	const [notes, setNotes] = createSignal<Note[]>([
		{
			id: 1,
			title: "SolidJS 学习笔记",
			content: "SolidJS 是一个用于构建用户界面的声明式 JavaScript 库...",
			category: "技术",
			tags: ["SolidJS", "前端", "JavaScript"],
			created_at: "2024-01-15T10:30:00Z",
			updated_at: "2024-01-16T14:20:00Z",
		},
		{
			id: 2,
			title: "项目会议记录",
			content: "讨论了项目进度和下一步计划...",
			category: "工作",
			tags: ["会议", "项目", "计划"],
			created_at: "2024-01-14T09:15:00Z",
			updated_at: "2024-01-14T09:15:00Z",
		},
		{
			id: 3,
			title: "读书笔记 - 《设计模式》",
			content: "单例模式、工厂模式、观察者模式的应用场景...",
			category: "学习",
			tags: ["设计模式", "编程", "读书"],
			created_at: "2024-01-13T16:45:00Z",
			updated_at: "2024-01-15T11:10:00Z",
		},
		{
			id: 4,
			title: "旅行计划",
			content: "3月份计划去日本旅行，需要准备签证和行程...",
			category: "生活",
			tags: ["旅行", "日本", "计划"],
			created_at: "2024-01-12T13:20:00Z",
			updated_at: "2024-01-12T13:20:00Z",
		},
		{
			id: 5,
			title: "健康饮食记录",
			content: "本周饮食记录，需要注意蛋白质摄入...",
			category: "健康",
			tags: ["健康", "饮食", "记录"],
			created_at: "2024-01-11T08:30:00Z",
			updated_at: "2024-01-13T19:45:00Z",
		},
	]);

	const [searchQuery, setSearchQuery] = createSignal("");
	const [selectedCategory, setSelectedCategory] = createSignal<string>("全部");
	const [selectedTag, setSelectedTag] = createSignal<string>("");

	// 获取所有分类
	const categories = () => {
		const allCategories = ["全部", ...new Set(notes().map((note) => note.category))];
		return allCategories;
	};

	// 获取所有标签
	const allTags = () => {
		const tags = new Set<string>();
		notes().forEach((note) => {
			note.tags.forEach((tag) => {
				tags.add(tag);
			});
		});
		return Array.from(tags);
	};

	// 过滤笔记
	const filteredNotes = () => {
		return notes().filter((note) => {
			const matchesSearch =
				searchQuery() === "" ||
				note.title.toLowerCase().includes(searchQuery().toLowerCase()) ||
				note.content.toLowerCase().includes(searchQuery().toLowerCase());

			const matchesCategory =
				selectedCategory() === "全部" || note.category === selectedCategory();

			const matchesTag =
				selectedTag() === "" || note.tags.includes(selectedTag());

			return matchesSearch && matchesCategory && matchesTag;
		});
	};

	const formatDate = (dateString: string): string => {
		try {
			const date = new Date(dateString);
			return date.toLocaleDateString("zh-CN", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return dateString;
		}
	};

	const handleCreateNote = () => {
		alert("创建笔记功能待实现");
	};

	const handleEditNote = (noteId: number) => {
		alert(`编辑笔记 ${noteId} 功能待实现`);
	};

	const handleDeleteNote = (noteId: number) => {
		if (confirm("确定要删除这个笔记吗？此操作不可撤销。")) {
			setNotes(notes().filter((note) => note.id !== noteId));
		}
	};

	const handleViewNote = (noteId: number) => {
		alert(`查看笔记 ${noteId} 功能待实现`);
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1>笔记管理</h1>
				<div class={styles.actions}>
					<button
						type="button"
						class={styles.primaryButton}
						onClick={handleCreateNote}
					>
						新建笔记
					</button>
				</div>
			</div>

			<div class={styles.filters}>
				<div class={styles.searchSection}>
					<input
						type="text"
						class={styles.searchInput}
						placeholder="搜索笔记标题或内容..."
						value={searchQuery()}
						onInput={(e) => setSearchQuery(e.currentTarget.value)}
					/>
				</div>

				<div class={styles.filterControls}>
					<div class={styles.filterGroup}>
						<label for="category-select" class={styles.filterLabel}>分类:</label>
						<select
							id="category-select"
							class={styles.filterSelect}
							value={selectedCategory()}
							onChange={(e) => setSelectedCategory(e.currentTarget.value)}
						>
							<For each={categories()}>
								{(category) => <option value={category}>{category}</option>}
							</For>
						</select>
					</div>

					<div class={styles.filterGroup}>
						<label for="tag-select" class={styles.filterLabel}>标签:</label>
						<select
							id="tag-select"
							class={styles.filterSelect}
							value={selectedTag()}
							onChange={(e) => setSelectedTag(e.currentTarget.value)}
						>
							<option value="">全部标签</option>
							<For each={allTags()}>
								{(tag) => <option value={tag}>{tag}</option>}
							</For>
						</select>
					</div>
				</div>
			</div>

			<Show
				when={filteredNotes().length > 0}
				fallback={
					<div class={styles.emptyState}>
						<p>没有找到匹配的笔记</p>
						<button
							type="button"
							class={styles.primaryButton}
							onClick={handleCreateNote}
						>
							创建第一个笔记
						</button>
					</div>
				}
			>
				<div class={styles.notesGrid}>
					<For each={filteredNotes()}>
						{(note) => (
							<div class={styles.noteCard}>
								<div class={styles.noteHeader}>
									<h3 class={styles.noteTitle}>{note.title}</h3>
									<span class={styles.noteCategory}>{note.category}</span>
								</div>

								<div class={styles.noteContent}>
									<p class={styles.notePreview}>
										{note.content.length > 100
											? `${note.content.substring(0, 100)}...`
											: note.content}
									</p>
								</div>

								<div class={styles.noteTags}>
									<For each={note.tags}>
										{(tag) => (
											<button
												type="button"
												class={styles.tag}
												onClick={() => setSelectedTag(tag)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														setSelectedTag(tag);
													}
												}}
											>
												{tag}
											</button>
										)}
									</For>
								</div>

								<div class={styles.noteMeta}>
									<div class={styles.metaItem}>
										<span class={styles.metaLabel}>创建:</span>
										<span>{formatDate(note.created_at)}</span>
									</div>
									<div class={styles.metaItem}>
										<span class={styles.metaLabel}>更新:</span>
										<span>{formatDate(note.updated_at)}</span>
									</div>
								</div>

								<div class={styles.noteActions}>
									<button
										type="button"
										class={styles.primaryButton}
										onClick={() => handleViewNote(note.id)}
									>
										查看
									</button>
									<button
										type="button"
										class={styles.secondaryButton}
										onClick={() => handleEditNote(note.id)}
									>
										编辑
									</button>
									<button
										type="button"
										class={styles.deleteButton}
										onClick={() => handleDeleteNote(note.id)}
									>
										删除
									</button>
								</div>
							</div>
						)}
					</For>
				</div>
			</Show>

			<div class={styles.stats}>
				<p>
					共 {filteredNotes().length} 篇笔记
					{selectedCategory() !== "全部" && ` (分类: ${selectedCategory()})`}
					{selectedTag() !== "" && ` (标签: ${selectedTag()})`}
				</p>
			</div>
		</div>
	);
};

export default NotesListPage;