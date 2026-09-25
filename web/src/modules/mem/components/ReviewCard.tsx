// ── v2 复习卡片：目录卡 + 3D 翻面 + 卡牌层叠 ──
// 线索与答案分居卡片两面，点"显示答案"实体翻转。

import { MarkdownEditor } from "@components";
import { Button, Icon, Markdown as MarkdownRenderer } from "@components/ui";
import {
	MarkdownFilePicker,
	uploadToFileService,
} from "@modules/file/markdown-editor-support.tsx";
import { copyTextWithToast, fmtInterval, fmtLocal } from "@shared/utils";
import { Show } from "solid-js";
import type { UseMemReview } from "../hooks/useMemReviewTypes.ts";
import { useSpeech } from "../hooks/useSpeech.ts";
import styles from "./ReviewCard.module.css";

type Speech = ReturnType<typeof useSpeech>;

interface ReviewCardProps {
	m: UseMemReview;
}

interface MemProps {
	m: UseMemReview;
}

interface CardTabProps {
	label: string;
	no: string;
}

interface ReviewStageProps {
	m: UseMemReview;
	speech: Speech;
}

interface ActionRowProps {
	m: UseMemReview;
	goPrev: () => void;
	goNext: () => void;
}

interface CueFaceProps {
	m: UseMemReview;
	speech: Speech;
}

function CardTab(props: CardTabProps) {
	return (
		<div class={styles.cardTab}>
			<span class={styles.cardTabText}>{props.label}</span>
			<span class={styles.cardTabNo}>{props.no}</span>
		</div>
	);
}

function DoneEmpty(props: MemProps) {
	return (
		<div class={styles.empty}>
			<p class={styles.emptyTitle}>🎉 本轮学习完成！</p>
			<Show when={props.m.upcoming() > 0}>
				<p class={styles.emptyHint}>
					还有 {props.m.upcoming()} 张卡在未来等待复习
				</p>
			</Show>
			<Button variant="primary" size="sm" onClick={props.m.loadDue}>
				再学一轮
			</Button>
		</div>
	);
}

function EditCard(props: MemProps) {
	return (
		<div class={styles.cardWrap}>
			<div class={styles.cardFlat}>
				<div class={styles.section}>
					<div class={styles.sectionLabel}>线索</div>
					<MarkdownEditor
						onUploadFile={uploadToFileService}
						filePicker={MarkdownFilePicker}
						class={styles.editArea}
						value={props.m.editCue()}
						onInput={props.m.setEditCue}
						rows={3}
					/>
				</div>
				<div class={styles.divider} />
				<div class={styles.section}>
					<div class={styles.sectionLabel}>答案</div>
					<MarkdownEditor
						onUploadFile={uploadToFileService}
						filePicker={MarkdownFilePicker}
						class={styles.editArea}
						value={props.m.editTarget()}
						onInput={props.m.setEditTarget}
						rows={3}
					/>
				</div>
			</div>
		</div>
	);
}

function CueFace(props: CueFaceProps) {
	const { m, speech } = props;
	return (
		<div
			classList={{
				[styles.face]: true,
				[styles.faceFill]: !m.showAnswer(),
			}}
		>
			<CardTab label="线索" no={`#${m.item()?.id}`} />
			<div class={styles.cardBody}>
				<div class={styles.content}>
					<MarkdownRenderer content={m.item()?.cue.content ?? ""} />
				</div>
			</div>
			<div class={styles.cardTools}>
				<button
					type="button"
					class={styles.toolBtn}
					title="朗读线索"
					onClick={() => speech.toggle(m.item()?.cue.content ?? "")}
					disabled={!speech.supported}
				>
					{speech.speaking() ? (
						<Icon name="stop" size={15} />
					) : (
						<Icon name="speaker" size={15} />
					)}
				</button>
				<button
					type="button"
					class={styles.toolBtn}
					title="复制线索"
					onClick={() => void copyTextWithToast(m.item()?.cue.content ?? "")}
				>
					<Icon name="clipboard" size={15} />
				</button>
				<button
					type="button"
					class={styles.toolBtn}
					title="复制整张卡片"
					onClick={m.handleCopyCard}
				>
					<Icon name="stack" size={15} />
				</button>
				<button
					type="button"
					class={styles.toolBtn}
					title={m.mnemonic() ? "重新生成助记" : "AI 生成助记"}
					onClick={m.generateMnemonic}
					disabled={m.mnemonicLoading()}
				>
					{m.mnemonicLoading() ? (
						<Icon name="clock" size={15} />
					) : (
						<Icon name="bot" size={15} />
					)}
				</button>
			</div>
		</div>
	);
}

function MnemonicBlock(props: MemProps) {
	return (
		<Show when={props.m.mnemonic() || props.m.mnemonicLoading()}>
			<div class={styles.mnemonic}>
				<div class={styles.mnemonicLabel}>AI 助记</div>
				<Show
					when={props.m.mnemonicLoading()}
					fallback={<MarkdownRenderer content={props.m.mnemonic() ?? ""} />}
				>
					<span class={styles.mnemonicLoading}>生成中…</span>
				</Show>
			</div>
		</Show>
	);
}

function AnswerFace(props: MemProps) {
	return (
		<div class={styles.answer}>
			<CardTab
				label="答案"
				no={`#${props.m.item()?.id} · ${props.m.item()?.state}`}
			/>
			<div class={styles.cardBody}>
				<div class={styles.content}>
					<MarkdownRenderer content={props.m.item()?.target.content ?? ""} />
				</div>
				<MnemonicBlock m={props.m} />
			</div>
		</div>
	);
}

function ActionRow(props: ActionRowProps) {
	const { m, goPrev, goNext } = props;
	return (
		<Show when={!m.showAnswer()}>
			<div class={styles.actionRow}>
				<button
					type="button"
					class={styles.navBtn}
					onClick={goPrev}
					disabled={m.current() <= 0}
					title="上一张 (←)"
				>
					‹
				</button>
				<Button variant="ghost" size="sm" onClick={m.bury}>
					跳过
				</Button>
				<Button variant="ghost" size="sm" onClick={m.resumeSuspend}>
					挂起
				</Button>
				<Show when={m.showUndo()}>
					<Button variant="ghost" size="sm" onClick={m.undo}>
						撤销
					</Button>
				</Show>
				<Button
					variant="primary"
					size="sm"
					onClick={() => m.setShowAnswer(true)}
				>
					显示答案
				</Button>
				<button
					type="button"
					class={styles.navBtn}
					onClick={goNext}
					disabled={m.current() >= m.due().length - 1}
					title="下一张 (→)"
				>
					›
				</button>
			</div>
		</Show>
	);
}

function Ratings(props: MemProps) {
	return (
		<Show when={props.m.showAnswer()}>
			<div class={styles.ratings}>
				<button
					type="button"
					class={styles.ratingBtn}
					classList={{ [styles.again]: true }}
					onClick={() => props.m.rate(1)}
				>
					<span class={styles.ratingLabel}>忘记</span>
					<span class={styles.ratingTime}>
						{fmtInterval(props.m.intervals()[0])}
					</span>
				</button>
				<button
					type="button"
					class={styles.ratingBtn}
					classList={{ [styles.hard]: true }}
					onClick={() => props.m.rate(2)}
				>
					<span class={styles.ratingLabel}>困难</span>
					<span class={styles.ratingTime}>
						{fmtInterval(props.m.intervals()[1])}
					</span>
				</button>
				<button
					type="button"
					class={styles.ratingBtn}
					classList={{ [styles.good]: true }}
					onClick={() => props.m.rate(3)}
				>
					<span class={styles.ratingLabel}>良好</span>
					<span class={styles.ratingTime}>
						{fmtInterval(props.m.intervals()[2])}
					</span>
				</button>
				<button
					type="button"
					class={styles.ratingBtn}
					classList={{ [styles.easy]: true }}
					onClick={() => props.m.rate(4)}
				>
					<span class={styles.ratingLabel}>简单</span>
					<span class={styles.ratingTime}>
						{fmtInterval(props.m.intervals()[3])}
					</span>
				</button>
			</div>
		</Show>
	);
}

function ReviewStage(props: ReviewStageProps) {
	return (
		<div class={styles.cardWrap}>
			<Show when={props.m.isPreview() && props.m.current() === 0}>
				<div class={styles.previewBanner}>
					将于 {fmtLocal(props.m.item()?.due_at ?? "")} 到期
				</div>
			</Show>
			<div class={styles.cardStage}>
				<div class={styles.card}>
					<CueFace m={props.m} speech={props.speech} />
					<Show when={props.m.showAnswer()}>
						<AnswerFace m={props.m} />
					</Show>
				</div>
			</div>
		</div>
	);
}

export default function ReviewCard(props: ReviewCardProps) {
	const { m } = props;
	const speech = useSpeech();

	const goPrev = () => {
		m.setCurrent(Math.max(0, m.current() - 1));
		m.setShowAnswer(false);
	};
	const goNext = () => {
		m.setCurrent(Math.min(m.due().length - 1, m.current() + 1));
		m.setShowAnswer(false);
	};

	return (
		<>
			{/* 完成态 */}
			<Show when={m.done()}>
				<DoneEmpty m={m} />
			</Show>

			{/* 卡片区：有旧卡时保持显示（stale-while-revalidate），loading 仅作用于无卡空态 */}
			<Show
				when={!m.done() && m.due().length > 0}
				fallback={
					<div class={styles.empty}>
						{m.loading() ? "加载中…" : "没有记忆卡片，去添加一些吧！"}
					</div>
				}
			>
				<Show when={m.allFar()}>
					<div class={styles.banner}>
						📅 所有卡的下次复习都在 24h 之后，当前为提前复习
					</div>
				</Show>

				{/* 编辑模式：普通纵向布局 */}
				<Show when={m.editing()}>
					<EditCard m={m} />
				</Show>

				{/* 复习模式：翻面卡片 */}
				<Show when={!m.editing()}>
					<ReviewStage m={m} speech={speech} />
					<ActionRow m={m} goPrev={goPrev} goNext={goNext} />
					<Ratings m={m} />
				</Show>
			</Show>
		</>
	);
}
