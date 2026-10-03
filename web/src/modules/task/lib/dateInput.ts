// ── 日期文本控件的解析与格式化（MD3 契约）──
//
// 第 2 层的日期控件是"文本输入 + 日历图标"的组合，两条独立规则（照 MD3 官方规范）：
//
// 1. **打字是主路径，日历只是入口**：MD3 把「Enter dates manually by inputting text」
//    列为第一条用例，日历图标只是"可选的快捷方式"。
// 2. **失焦/回车才格式化，输入过程中不格式化**（禁输入掩码）：MD3 的原话是输入掩码
//    "changes what they typed" —— 读屏用户听到的与看到的不一致就是这条的真实理由。
//    项目的输入法闸门同理：组字期间绝不碰输入框的值。
//
// 另外照 MD3 收 `- / . 空格` 四种分隔符且**不强制补零**（`10/3` 合法）。

/** 只给日期不给时间时的钟点（写进控件下方的 helper 文案，别偷偷改） */
export const DEFAULT_HOUR = 9;

// `T` 也在分隔符里：`2026-10-03T15:30` 切掉时间后尾巴会留一个 T
const DATE_PARTS = /[-/.\sT]+/u;
const TIME_SUFFIX = /(\d{1,2}):(\d{2})(?::(\d{2}))?$/u;

/**
 * 解析用户敲的日期文本 → 本地时间；认不出来返回 `null`。
 *
 * 收：`2026-10-03` / `2026/10/3` / `2026.10.3` / `2026 10 3` / `10/3`（今年）/
 * `2026-10-03 15:00` / `2026-10-03T15:00`；不给时间按 [`DEFAULT_HOUR`] 点。
 */
export function parseDateInput(input: string): Date | null {
	const text = input.trim();
	if (!text) {
		return null;
	}

	// 先把时间尾巴切下来：`2026-10-03 15:00` 与 `2026 10 03 15:00` 都要认
	const timeMatch = TIME_SUFFIX.exec(text);
	let hour = DEFAULT_HOUR;
	let minute = 0;
	let datePart = text;
	if (timeMatch) {
		hour = Number(timeMatch[1]);
		minute = Number(timeMatch[2]);
		datePart = text.slice(0, timeMatch.index);
	}
	const numbers = datePart
		.split(DATE_PARTS)
		.filter((part) => part !== "")
		.map(Number);
	const [year, month, day] =
		numbers.length === 3
			? numbers
			: numbers.length === 2
				? [new Date().getFullYear(), numbers[0], numbers[1]]
				: [];
	if (
		year === undefined ||
		month === undefined ||
		day === undefined ||
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(day) ||
		hour > 23 ||
		minute > 59
	) {
		return null;
	}

	const date = new Date(year, month - 1, day, hour, minute, 0, 0);
	// 反问一遍：`2026-02-31` 会被 Date 悄悄挪成 3 月 3 日，那不是用户写的日期
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null;
	}
	return date;
}

/** 本地时间 → 控件里的显示文本 `2026-10-03 15:00` */
export function formatDateInput(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 控件的 helper 文案（MD3：格式要写在 helper 里，不是 placeholder） */
export const DATE_HELPER = `格式 2026-10-03 15:00，可省时间（按 ${DEFAULT_HOUR}:00）`;

/**
 * 本地时间 → `<input type="datetime-local">` 的 value（`2026-10-03T15:00`，不带时区）。
 *
 * 与 [`formatDateInput`] 的区别只是分隔符：文本控件给人看，原生控件给浏览器读。
 */
export function toDateInputValue(date: Date | null): string {
	if (!date) {
		return "";
	}
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 服务端的 ISO 串（UTC）→ 本地 `Date`；空值/坏值返回 null */
export function fromIso(iso: string | null | undefined): Date | null {
	if (!iso) {
		return null;
	}
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}
