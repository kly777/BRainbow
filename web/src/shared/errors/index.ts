// ── 错误处理的唯一入口（见 doc/error-handling.md）──
//
// 分三层，都从这里出：
//   · model.ts   错误类（NetworkError / HttpError / ValidationError）+ `getErrorMessage`
//                —— 零 UI 依赖，谁都能引
//   · notify.ts  提示：`notifyError / notifySuccess / notifyWarning / notifyInfo`
//                （`notifyError` 对 401/403/5xx 静默：传输层已经说过一次了）
//   · actions.ts 动作封装：`tryOrNotify / confirmAndRun / confirmAndDelete` + `showConfirm`
//
// 新代码一律 `import { … } from "@shared/errors"`。传输层的全局副作用（401 弹登录框、
// 403/5xx 提示）不在这里，在 `shared/api/request.ts` 的 handleGlobalError。
//
// 旧入口保留再导出以免改动 50+ 处调用点：`@shared/utils`（notify* / tryOrNotify…）
// 与 `@shared/api`（错误类 / getErrorMessage）。

export * from "./actions.ts";
export * from "./model.ts";
export * from "./notify.ts";
