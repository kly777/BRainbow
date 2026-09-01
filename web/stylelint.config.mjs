export default {
	extends: ["stylelint-config-standard"],
	rules: {
		// ── 真误报（工具不认识合法语法/语义） ──
		// composes 是 CSS Modules 语法，stylelint 当作未知属性
		"property-no-unknown": [
			true,
			{
				ignoreProperties: ["composes"],
			},
		],
		// 无标准替代、必须手写的前缀（其余前缀由 autoprefixer 按 browserslist 生成）：
		// -webkit-line-clamp 体系（-webkit-box-orient + display: -webkit-box 配套）、
		// 非标准渲染属性（font-smoothing 系）、text-size-adjust（normalize 惯例）
		"property-no-vendor-prefix": [
			true,
			{
				ignoreProperties: [
					"-webkit-line-clamp",
					"-webkit-box-orient",
					"-moz-osx-font-smoothing",
					"-webkit-font-smoothing",
					"-webkit-text-size-adjust",
					// number input spinner 隐藏：WebKit 伪元素属性必须带前缀
					"-webkit-appearance",
					"-moz-appearance",
				],
			},
		],
		// currentColor 是唯一 camelCase 的标准关键字（规范如此）
		"value-keyword-case": [
			"lower",
			{
				ignoreKeywords: ["currentColor"],
			},
		],
		// ── 门禁：禁止 !important（道之原则：样式表是建议而非控制）
		// 已知例外写入 media 区域（打印、reduced-motion 等），
		// 用 stylelint-disable-next-line 逐条豁免。
		"declaration-no-important": true,
	},
	ignoreFiles: ["dist/**", "scripts/vendor/**"],
};
