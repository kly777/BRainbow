import { splitProps, type JSX } from "solid-js";

type IconProps = Omit<
  JSX.SvgSVGAttributes<SVGSVGElement>,
  "color" | "height" | "width"
> & {
  alt?: string;
  color?: string;
  mirrored?: boolean;
  size?: string | number;
};

type IconBaseProps = IconProps & {
  path: string;
};

function IconBase(inputProps: IconBaseProps) {
  const [props, rest] = splitProps(inputProps, [
    "alt",
    "color",
    "mirrored",
    "path",
    "size",
  ]);
  const transformProps = () =>
    props.mirrored ? { transform: "scale(-1, 1)" } : {};

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? "1em"}
      height={props.size ?? "1em"}
      fill={props.color ?? "currentColor"}
      viewBox="0 0 256 256"
      {...rest}
      {...transformProps()}
    >
      {props.alt ? <title>{props.alt}</title> : null}
      <path d={props.path} />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"
    />
  );
}

export function CheckRegularIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"
    />
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"
    />
  );
}

export function CaretDownIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M208.49,96.49l-72,72a12,12,0,0,1-17,0l-72-72a12,12,0,0,1,17-17L128,143,191.51,79.51a12,12,0,0,1,17,17Z"
    />
  );
}

export function CaretUpDownIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M181.66,170.34a8,8,0,0,1,0,11.32l-48,48a8,8,0,0,1-11.32,0l-48-48a8,8,0,0,1,11.32-11.32L128,212.69l42.34-42.35A8,8,0,0,1,181.66,170.34Zm-96-84.68L128,43.31l42.34,42.35a8,8,0,0,0,11.32-11.32l-48-48a8,8,0,0,0-11.32,0l-48,48A8,8,0,0,0,85.66,85.66Z"
    />
  );
}

export function CaretLeftIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M160.49,208.49a12,12,0,0,1-17,0l-72-72a12,12,0,0,1,0-17l72-72a12,12,0,0,1,17,17L97,128l63.51,63.51a12,12,0,0,1,0,17Z"
    />
  );
}

export function CaretDoubleLeftIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M144.49,208.49a12,12,0,0,1-17,0l-72-72a12,12,0,0,1,0-17l72-72a12,12,0,0,1,17,17L81,128l63.51,63.51a12,12,0,0,1,0,17Zm64,0a12,12,0,0,0,0-17L145,128l63.51-63.51a12,12,0,0,0-17-17l-72,72a12,12,0,0,0,0,17l72,72a12,12,0,0,0,17,0Z"
    />
  );
}

export function CaretRightIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M184.49,136.49l-72,72a12,12,0,0,1-17-17L159,128,95.51,64.49a12,12,0,0,1,17-17l72,72a12,12,0,0,1,0,17Z"
    />
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"
    />
  );
}

export function ArrowSquareOutIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M224,104a8,8,0,0,1-16,0V59.32l-66.33,66.34a8,8,0,0,1-11.32-11.32L196.68,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z"
    />
  );
}

export function MagnifyingGlassIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z"
    />
  );
}

export function CaretDoubleRightIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M200.49,136.49l-72,72a12,12,0,0,1-17-17L175,128,111.51,64.49a12,12,0,0,1,17-17l72,72a12,12,0,0,1,0,17Zm-64,0a12,12,0,0,0,0-17l-72-72a12,12,0,0,0-17,17L111,128,47.51,191.51a12,12,0,0,0,17,17Z"
    />
  );
}

export function GlobeHemisphereWestIcon(inputProps: IconProps) {
  const [props, rest] = splitProps(inputProps, [
    "alt",
    "color",
    "mirrored",
    "size",
  ]);
  const transformProps = () =>
    props.mirrored ? { transform: "scale(-1, 1)" } : {};

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size ?? "1em"}
      height={props.size ?? "1em"}
      fill="none"
      viewBox="0 0 256 256"
      color={props.color ?? "currentColor"}
      {...rest}
      {...transformProps()}
    >
      {props.alt ? <title>{props.alt}</title> : null}
      <circle
        cx="128"
        cy="128"
        r="96"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="16"
      />
      <path
        d="M75.88,123.26,89.2,100a8,8,0,0,1,6.94-4h16.71a7.9,7.9,0,0,0,3.86-1L129,88.24a7.12,7.12,0,0,0,1.49-1.07l26.92-24.33A8,8,0,0,0,159,53l-10.5-18.81"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="16"
      />
      <path
        d="M67.78,53.23,56,81.08A8,8,0,0,0,55.88,87l11.5,30.67a8,8,0,0,0,5.81,5l21.43,4.61a8,8,0,0,1,5.52,4.33l3.8,7.87a8,8,0,0,0,7.2,4.51h13.8"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="16"
      />
      <path
        d="M213.09,172.48l-52.38-32.22a8.11,8.11,0,0,0-3.12-1.11l-22.82-3.08a8,8,0,0,0-8.38,4.67l-13.7,30.74a8,8,0,0,0,1.44,8.69l19.74,20.33a8,8,0,0,1,2,6.95l-3.17,16.44"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="16"
      />
    </svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z"
    />
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z"
    />
  );
}

export function InfoFillIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z"
    />
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"
    />
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z"
    />
  );
}

export function WarningOctagonIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M227.31,80.23,175.77,28.69A16.13,16.13,0,0,0,164.45,24H91.55a16.13,16.13,0,0,0-11.32,4.69L28.69,80.23A16.13,16.13,0,0,0,24,91.55v72.9a16.13,16.13,0,0,0,4.69,11.32l51.54,51.54A16.13,16.13,0,0,0,91.55,232h72.9a16.13,16.13,0,0,0,11.32-4.69l51.54-51.54A16.13,16.13,0,0,0,232,164.45V91.55A16.13,16.13,0,0,0,227.31,80.23ZM120,80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z"
    />
  );
}

export function XIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M181.66,170.34a8,8,0,0,1-11.32,11.32L128,139.31,85.66,181.66a8,8,0,0,1-11.32-11.32L116.69,128,74.34,85.66A8,8,0,0,1,85.66,74.34L128,116.69l42.34-42.35a8,8,0,0,1,11.32,11.32L139.31,128Z"
    />
  );
}

export function ArrowsClockwiseIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.69V48a8,8,0,0,1,16,0ZM186.41,183.29a80,80,0,0,1-112.47-.66L59.31,168H88a8,8,0,0,0,0-16H40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V179.31l14.63,14.63A95.43,95.43,0,0,0,130,222.06h.53a95.36,95.36,0,0,0,67.07-27.33,8,8,0,0,0-11.18-11.44Z"
    />
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"
    />
  );
}

export function EyeSlashIcon(props: IconProps) {
  return (
    <IconBase
      {...props}
      path="M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z"
    />
  );
}
