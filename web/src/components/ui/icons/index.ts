/**
 * 项目级图标统一导出。
 * 所有模块从这里引入，禁止手写 SVG 或使用 emoji。
 *
 * 只导出实际使用的图标，减少打包体积。
 * 使用 solid-icons（Feather + Heroicons）替代 lucide-solid，解决 HMR 卡顿问题。
 */

// Feather icons (stroke style, 与 Lucide 视觉风格接近)
export {
	FiAlertTriangle as AlertTriangle,
	FiArrowLeft as ArrowLeft,
	FiArrowRight as ArrowRight,
	FiCheck as Check,
	FiCheckCircle as CheckCircle2,
	FiChevronLeft as ChevronLeft,
	FiChevronRight as ChevronRight,
	FiEdit as Pencil,
	FiInfo as Info,
	FiLink as Link,
	FiLoader as Loader2,
	FiRefreshCw as RefreshCw,
	FiSettings as Settings,
	FiX as X,
	FiXCircle as XCircle,
} from "solid-icons/fi";

// Heroicons (Sparkles 在 Feather 中没有对应图标)
export { HiOutlineSparkles as Sparkles } from "solid-icons/hi";
