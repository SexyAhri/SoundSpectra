import type { ComponentProps, ReactNode } from "react";
import { Search } from "lucide-react";
import "./search-field.css";

/** One focus surface for search inputs, including optional trailing controls. */
export function SearchField({
  className = "",
  children,
  ...props
}: Omit<ComponentProps<"input">, "type" | "className" | "children"> & {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`ui-search-field ${className}`}
      data-disabled={props.disabled || undefined}
    >
      <Search size={15} aria-hidden="true" />
      <input {...props} type="search" />
      {children}
    </div>
  );
}
