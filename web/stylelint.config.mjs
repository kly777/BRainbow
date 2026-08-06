export default {
	extends: ["stylelint-config-standard"],
	rules: {
		// 类名沿用原 vanilla-extract 的 camelCase（.itemTitle），不强制 kebab-case
		"selector-class-pattern": null,
		// 空类（挂载点，如 style({}) 迁移而来）合法
		"block-no-empty": null,
		// 枚举值大小写（如 keyframes 名 selectArrow、字号混排）
		"value-keyword-case": null,
		// 旧 range 语法 (max-width: 600px) 更兼容
		"media-feature-range-notation": null,
		// oklch 统一数字记法（0.52 0.1 165 / 0.5）
		"lightness-notation": null,
		"hue-degree-notation": null,
		"alpha-value-notation": null,
		// word-break: break-word 兼容写法
		"declaration-property-value-keyword-no-deprecated": null,
		// composes 是 CSS Modules 语法
		"property-no-unknown": [
			true,
			{
				ignoreProperties: ["composes"],
			},
		],
		// keyframes 名沿用原命名（slideIn 等）
		"keyframes-name-pattern": null,
		// 机械迁移保留原 selectors 声明顺序（如 :disabled 与 :hover:not(:disabled)）
		"no-descending-specificity": null,
		// 迁移产物中同名类块（style({}) 空块）重复定义
		"no-duplicate-selectors": null,
		// 跨浏览器必需的 vendor 前缀
		"property-no-vendor-prefix": [
			true,
			{
				ignoreProperties: [
					"-webkit-appearance",
					"-webkit-line-clamp",
					"-webkit-box-orient",
					"-moz-osx-font-smoothing",
					"-webkit-font-smoothing",
					"-webkit-text-size-adjust",
				],
			},
		],
		// 令牌变量带前缀 --t- / --color- / --toast- / --space- 等，统一 kebab 检查
		"custom-property-pattern": null,
		// composes 是 CSS Modules 语法，需要允许
		"at-rule-no-unknown": [
			true,
			{
				ignoreAtRules: ["composes"],
			},
		],
	},
	ignoreFiles: ["dist/**", "scripts/vendor/**"],
};
