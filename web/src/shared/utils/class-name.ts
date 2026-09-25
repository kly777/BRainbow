/**
 * 拼接 CSS 类名：丢掉 `false` / `undefined` / 空串，用单个空格连接。
 *
 * 组件里"基础类 + 可选的修饰类"是最高频的写法，此前 `atoms/control.ts` 与
 * `atoms/Layout.tsx` 各写了一份**字面相同**的私有实现（后者还没导出）。
 */
export function joinClass(...parts: (string | false | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}
