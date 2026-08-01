// ── 朗读 cue 的 hook（Web Speech API）──

import { createSignal, onCleanup } from "solid-js";
import { isSpeechSupported, speakText, stopSpeaking } from "../../../lib/speech.ts";

export interface UseSpeech {
	/** 是否正在朗读 */
	speaking: () => boolean;
	/** 浏览器是否支持语音合成 */
	supported: boolean;
	/** 切换朗读/停止。传入要朗读的文本（内部会 strip markdown） */
	toggle: (text: string) => void;
	/** 停止朗读 */
	stop: () => void;
}

export function useSpeech(): UseSpeech {
	const [speaking, setSpeaking] = createSignal(false);
	const supported = isSpeechSupported();

	const toggle = (text: string) => {
		if (!supported) return;
		if (speaking()) {
			stopSpeaking();
			setSpeaking(false);
		} else {
			speakText(text);
			setSpeaking(true);
			// 朗读结束/出错时复位状态（原生 API 无事件，用轮询检测）
			pollSpeakingState();
		}
	};

	const stop = () => {
		if (!supported) return;
		stopSpeaking();
		setSpeaking(false);
	};

	// speechSynthesis.speaking 可能异步变化，轻量轮询复位状态
	let timer: ReturnType<typeof setInterval> | undefined;
	const pollSpeakingState = () => {
		clearInterval(timer);
		timer = setInterval(() => {
			if (!window.speechSynthesis.speaking) {
				setSpeaking(false);
				clearInterval(timer);
			}
		}, 300);
	};

	onCleanup(() => {
		clearInterval(timer);
		if (supported) stopSpeaking();
	});

	return { speaking, supported, toggle, stop };
}
