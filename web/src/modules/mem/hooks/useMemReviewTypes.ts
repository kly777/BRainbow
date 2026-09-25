// ── useMemReview 的公开接口类型 ──

import type { MemCounts, MemItem, TagInfo } from "../api.ts";

export interface UseMemReview {
	due: () => MemItem[];
	current: () => number;
	showAnswer: () => boolean;
	loading: () => boolean;
	isPreview: () => boolean;
	done: () => boolean;
	editing: () => boolean;
	editCue: () => string;
	editTarget: () => string;
	intervals: () => readonly number[];
	showUndo: () => boolean;
	sidebarOpen: () => boolean;
	allFar: () => boolean;
	upcoming: () => number;
	counts: () => MemCounts | null;
	estimatedTotal: () => number;
	allTags: () => TagInfo[];
	tagFilterIds: () => number[];
	tagMode: () => "include" | "exclude";
	tagFilterTags: () => TagInfo[];
	avgCardTime: () => number;
	estRemaining: () => number;
	maxLearning: () => number;
	item: () => MemItem | undefined;
	addTagFilter: (tag: TagInfo) => void;
	removeTagFilter: (tagId: number) => void;
	toggleTagMode: () => void;
	clearTagFilters: () => void;
	setSidebarOpen: (v: boolean) => void;
	setCurrent: (i: number) => void;
	setShowAnswer: (v: boolean) => void;
	setEditing: (v: boolean) => void;
	setEditCue: (v: string) => void;
	setEditTarget: (v: string) => void;
	loadDue: () => Promise<void>;
	rate: (rating: number) => Promise<void>;
	bury: () => Promise<void>;
	undo: () => Promise<void>;
	resumeSuspend: () => Promise<void>;
	startEdit: () => void;
	saveEdit: () => Promise<void>;
	handleCopyCard: () => void;
	mnemonic: () => string | undefined;
	mnemonicLoading: () => boolean;
	generateMnemonic: () => Promise<void>;
}
