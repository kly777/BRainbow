export {
  Input,
  inputVariants,
  KUMO_INPUT_DEFAULT_VARIANTS,
  KUMO_INPUT_STYLING,
  KUMO_INPUT_VARIANTS,
  type InputProps,
  type KumoInputSize,
  type KumoInputVariant,
  type KumoInputVariantsProps,
} from "./input";
export { InputArea, Textarea, type InputAreaProps } from "./input-area";

// Preserve the legacy `components/input` subpath used by the React package.
export {
  InputGroup,
  KUMO_INPUT_GROUP_DEFAULT_VARIANTS,
  KUMO_INPUT_GROUP_VARIANTS,
} from "../input-group";

/**
 * @deprecated `focusMode` is auto-detected by `InputGroup`.
 */
export type KumoInputGroupFocusMode = "container" | "individual";

/**
 * @deprecated Use `InputGroupRootProps` from `components/input-group`.
 */
export interface KumoInputGroupVariantsProps {
  focusMode?: KumoInputGroupFocusMode;
}
