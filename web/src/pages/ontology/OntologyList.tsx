import { type Component, createSignal, For, Show } from "solid-js";
import styles from "@/styles/ontology/ontologyList.module.css";

// 模拟知识实体数据类型
interface OntologyEntity {
	id: number;
	name: string;
	description: string;
	type: "概念" | "实体" | "关系" | "属性";
	properties: { key: string; value: string }[];
	relationships: { target: string; type: string }[];
	created_at: string;
	updated_at: string;
}

const OntologyListPage: Component = () => {
	// 模拟知识实体数据
	const [entities, setEntities] = createSignal<OntologyEntity[]>([
		{
			id: 1,
			name: "人工智能",
			description:
				"研究、开发用于模拟、延伸和扩展人的智能的理论、方法、技术及应用系统的一门新的技术科学",
			type: "概念",
			properties: [
				{ key: "领域", value: "计算机科学" },
				{ key: "创立时间", value: "1956年" },
				{ key: "主要分支", value: "机器学习、自然语言处理、计算机视觉" },
			],
			relationships: [
				{ target: "机器学习", type: "包含" },
				{ target: "深度学习", type: "包含" },
				{ target: "神经网络", type: "使用" },
			],
			created_at: "2024-01-15T10:30:00Z",
			updated_at: "2024-01-16T14:20:00Z",
		},
		{
			id: 2,
			name: "机器学习",
			description: "人工智能的一个分支，研究计算机如何模拟或实现人类的学习行为",
			type: "概念",
			properties: [
				{ key: "类型", value: "监督学习、无监督学习、强化学习" },
				{ key: "应用领域", value: "推荐系统、图像识别、自然语言处理" },
			],
			relationships: [
				{ target: "人工智能", type: "属于" },
				{ target: "深度学习", type: "包含" },
				{ target: "神经网络", type: "使用" },
			],
			created_at: "2024-01-14T09:15:00Z",
			updated_at: "2024-01-14T09:15:00Z",
		},
		{
			id: 3,
			name: "神经网络",
			description: "模仿生物神经网络结构和功能的计算模型",
			type: "概念",
			properties: [
				{ key: "结构", value: "输入层、隐藏层、输出层" },
				{ key: "类型", value: "前馈神经网络、循环神经网络、卷积神经网络" },
			],
			relationships: [
				{ target: "机器学习", type: "被使用" },
				{ target: "深度学习", type: "基础" },
			],
			created_at: "2024-01-13T16:45:00Z",
			updated_at: "2024-01-15T11:10:00Z",
		},
		{
			id: 4,
			name: "Python",
			description: "一种广泛使用的高级编程语言",
			type: "实体",
			properties: [
				{ key: "类型", value: "编程语言" },
				{ key: "设计者", value: "Guido van Rossum" },
				{ key: "首次发布", value: "1991年" },
				{ key: "主要用途", value: "Web开发、数据分析、人工智能" },
			],
			relationships: [
				{ target: "人工智能", type: "用于" },
				{ target: "机器学习", type: "常用语言" },
			],
			created_at: "2024-01-12T13:20:00Z",
			updated_at: "2024-01-12T13:20:00Z",
		},
		{
			id: 5,
			name: "继承关系",
			description: "面向对象编程中的一种关系，表示一个类继承另一个类的特性",
			type: "关系",
			properties: [
				{ key: "类型", value: "面向对象关系" },
				{ key: "特点", value: "代码复用、多态性" },
			],
			relationships: [
				{ target: "面向对象编程", type: "属于" },
				{ target: "类", type: "连接" },
			],
			created_at: "2024-01-11T08:30:00Z",
			updated_at: "2024-01-13T19:45:00Z",
		},
	]);

	const [searchQuery, setSearchQuery] = createSignal("");
	const [selectedType, setSelectedType] = createSignal<string>("全部");
	const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");

	// 获取所有类型
	const types = () => {
		const allTypes = [
			"全部",
			...new Set(entities().map((entity) => entity.type)),
		];
		return allTypes;
	};

	// 过滤实体
	const filteredEntities = () => {
		return entities().filter((entity) => {
			const matchesSearch =
				searchQuery() === "" ||
				entity.name.toLowerCase().includes(searchQuery().toLowerCase()) ||
				entity.description.toLowerCase().includes(searchQuery().toLowerCase());

			const matchesType =
				selectedType() === "全部" || entity.type === selectedType();

			return matchesSearch && matchesType;
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

	const handleCreateEntity = () => {
		alert("创建知识实体功能待实现");
	};

	const handleEditEntity = (entityId: number) => {
		alert(`编辑知识实体 ${entityId} 功能待实现`);
	};

	const handleDeleteEntity = (entityId: number) => {
		if (confirm("确定要删除这个知识实体吗？此操作不可撤销。")) {
			setEntities(entities().filter((entity) => entity.id !== entityId));
		}
	};

	const handleViewEntity = (entityId: number) => {
		alert(`查看知识实体 ${entityId} 功能待实现`);
	};

	const getTypeColor = (type: string) => {
		switch (type) {
			case "概念":
				return "#0066cc";
			case "实体":
				return "#28a745";
			case "关系":
				return "#ffc107";
			case "属性":
				return "#dc3545";
			default:
				return "#6c757d";
		}
	};

	return (
		<div class={styles.container}>
			<div class={styles.header}>
				<h1>知识管理</h1>
				<div class={styles.actions}>
					<button
						type="button"
						class={styles.primaryButton}
						onClick={handleCreateEntity}
					>
						新建实体
					</button>
				</div>
			</div>

			<div class={styles.filters}>
				<div class={styles.searchSection}>
					<input
						type="text"
						class={styles.searchInput}
						placeholder="搜索实体名称或描述..."
						value={searchQuery()}
						onInput={(e) => setSearchQuery(e.currentTarget.value)}
					/>
				</div>

				<div class={styles.filterControls}>
					<div class={styles.filterGroup}>
						<label for="type-select" class={styles.filterLabel}>
							类型:
						</label>
						<select
							id="type-select"
							class={styles.filterSelect}
							value={selectedType()}
							onChange={(e) => setSelectedType(e.currentTarget.value)}
						>
							<For each={types()}>
								{(type) => <option value={type}>{type}</option>}
							</For>
						</select>
					</div>

					<div class={styles.viewToggle}>
						<button
							type="button"
							class={`${styles.viewButton} ${
								viewMode() === "grid" ? styles.active : ""
							}`}
							onClick={() => setViewMode("grid")}
						>
							网格视图
						</button>
						<button
							type="button"
							class={`${styles.viewButton} ${
								viewMode() === "list" ? styles.active : ""
							}`}
							onClick={() => setViewMode("list")}
						>
							列表视图
						</button>
					</div>
				</div>
			</div>

			<Show
				when={filteredEntities().length > 0}
				fallback={
					<div class={styles.emptyState}>
						<p>没有找到匹配的知识实体</p>
						<button
							type="button"
							class={styles.primaryButton}
							onClick={handleCreateEntity}
						>
							创建第一个实体
						</button>
					</div>
				}
			>
				<Show
					when={viewMode() === "grid"}
					fallback={
						<div class={styles.entitiesList}>
							<table class={styles.entitiesTable}>
								<thead>
									<tr>
										<th>名称</th>
										<th>类型</th>
										<th>描述</th>
										<th>属性</th>
										<th>关系</th>
										<th>更新时间</th>
										<th>操作</th>
									</tr>
								</thead>
								<tbody>
									<For each={filteredEntities()}>
										{(entity) => (
											<tr>
												<td>
													<strong>{entity.name}</strong>
												</td>
												<td>
													<span
														class={styles.entityType}
														style={{
															"background-color": getTypeColor(entity.type),
														}}
													>
														{entity.type}
													</span>
												</td>
												<td class={styles.entityDescription}>
													{entity.description.length > 80
														? `${entity.description.substring(0, 80)}...`
														: entity.description}
												</td>
												<td>
													<div class={styles.propertiesList}>
														<For each={entity.properties.slice(0, 2)}>
															{(prop) => (
																<div class={styles.propertyItem}>
																	<span class={styles.propertyKey}>
																		{prop.key}:
																	</span>
																	<span class={styles.propertyValue}>
																		{prop.value}
																	</span>
																</div>
															)}
														</For>
														{entity.properties.length > 2 && (
															<div class={styles.moreProperties}>
																还有 {entity.properties.length - 2} 个属性
															</div>
														)}
													</div>
												</td>
												<td>
													<div class={styles.relationshipsList}>
														<For each={entity.relationships.slice(0, 2)}>
															{(rel) => (
																<div class={styles.relationshipItem}>
																	{rel.type} → {rel.target}
																</div>
															)}
														</For>
														{entity.relationships.length > 2 && (
															<div class={styles.moreRelationships}>
																还有 {entity.relationships.length - 2} 个关系
															</div>
														)}
													</div>
												</td>
												<td class={styles.updatedAt}>
													{formatDate(entity.updated_at)}
												</td>
												<td>
													<div class={styles.entityActions}>
														<button
															type="button"
															class={styles.primaryButton}
															onClick={() => handleViewEntity(entity.id)}
														>
															查看
														</button>
														<button
															type="button"
															class={styles.secondaryButton}
															onClick={() => handleEditEntity(entity.id)}
														>
															编辑
														</button>
													</div>
												</td>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</div>
					}
				>
					<div class={styles.entitiesGrid}>
						<For each={filteredEntities()}>
							{(entity) => (
								<div class={styles.entityCard}>
									<div class={styles.entityHeader}>
										<h3 class={styles.entityName}>{entity.name}</h3>
										<span
											class={styles.entityType}
											style={{ "background-color": getTypeColor(entity.type) }}
										>
											{entity.type}
										</span>
									</div>

									<div class={styles.entityDescription}>
										<p>{entity.description}</p>
									</div>

									<div class={styles.entityProperties}>
										<h4 class={styles.sectionTitle}>属性</h4>
										<div class={styles.propertiesList}>
											<For each={entity.properties}>
												{(prop) => (
													<div class={styles.propertyItem}>
														<span class={styles.propertyKey}>{prop.key}:</span>
														<span class={styles.propertyValue}>
															{prop.value}
														</span>
													</div>
												)}
											</For>
										</div>
									</div>

									<div class={styles.entityRelationships}>
										<h4 class={styles.sectionTitle}>关系</h4>
										<div class={styles.relationshipsList}>
											<For each={entity.relationships}>
												{(rel) => (
													<div class={styles.relationshipItem}>
														<span class={styles.relationshipType}>
															{rel.type}
														</span>
														<span class={styles.relationshipArrow}>→</span>
														<span class={styles.relationshipTarget}>
															{rel.target}
														</span>
													</div>
												)}
											</For>
										</div>
									</div>

									<div class={styles.entityMeta}>
										<div class={styles.metaItem}>
											<span class={styles.metaLabel}>创建:</span>
											<span>{formatDate(entity.created_at)}</span>
										</div>
										<div class={styles.metaItem}>
											<span class={styles.metaLabel}>更新:</span>
											<span>{formatDate(entity.updated_at)}</span>
										</div>
									</div>

									<div class={styles.entityActions}>
										<button
											type="button"
											class={styles.primaryButton}
											onClick={() => handleViewEntity(entity.id)}
										>
											查看
										</button>
										<button
											type="button"
											class={styles.secondaryButton}
											onClick={() => handleEditEntity(entity.id)}
										>
											编辑
										</button>
										<button
											type="button"
											class={styles.deleteButton}
											onClick={() => handleDeleteEntity(entity.id)}
										>
											删除
										</button>
									</div>
								</div>
							)}
						</For>
					</div>
				</Show>
			</Show>

			<div class={styles.stats}>
				<p>
					共 {filteredEntities().length} 个知识实体
					{selectedType() !== "全部" && ` (类型: ${selectedType()})`}
				</p>
			</div>
		</div>
	);
};

export default OntologyListPage;
