// ── 错误模型（旧路径，保留再导出）──
//
// 实现已搬到 `shared/errors/model.ts`；这里只做再导出，让 `@shared/api` 的老写法
// （`import { HttpError, getErrorMessage } from "@shared/api"`）继续可用。
// 新代码请从 `@shared/errors` 引（见 doc/error-handling.md）。

export * from "../../errors/model.ts";
