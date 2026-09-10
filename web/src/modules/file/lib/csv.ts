/**
 * 简易 CSV 解析（RFC 4180 子集）：逗号分隔、双引号包裹、"" 转义、跨行字段。
 * 预览场景宽容处理：引号未闭合时返回已解析内容，不抛错。
 */

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;
	let i = 0;

	const pushRow = () => {
		row.push(field);
		rows.push(row);
		row = [];
		field = "";
	};

	while (i < text.length) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					// "" 转义 → 字面双引号
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i += 1;
				continue;
			}
			field += c;
			i += 1;
			continue;
		}
		if (c === '"' && field === "") {
			inQuotes = true;
			i += 1;
			continue;
		}
		if (c === ",") {
			row.push(field);
			field = "";
			i += 1;
			continue;
		}
		if (c === "\n") {
			pushRow();
			i += 1;
			continue;
		}
		if (c === "\r") {
			// 兼容 \r\n：跳过 \r
			i += 1;
			continue;
		}
		field += c;
		i += 1;
	}

	if (field !== "" || row.length > 0) {
		pushRow();
	}

	// 去掉空文本产生的单空行
	return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
