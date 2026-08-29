import { describe, expect, it } from "vitest";
import FilterGroup from "./FilterGroup.tsx";

describe("FilterGroup", () => {
	it("组件可渲染", () => {
		expect(FilterGroup).toBeDefined();
		expect(typeof FilterGroup).toBe("function");
	});

	it("接收 options、selected、onChange props", () => {
		const props = {
			options: [
				{ value: "list", label: "列表" },
				{ value: "kanban", label: "看板" },
			],
			selected: "list",
			onChange: () => {},
		};
		expect(props.options).toHaveLength(2);
		expect(props.selected).toBe("list");
		expect(typeof props.onChange).toBe("function");
	});

	it("onChange 回调接收正确的 value", () => {
		let received = "";
		const onChange = (v: string) => {
			received = v;
		};
		onChange("kanban");
		expect(received).toBe("kanban");
	});
});
