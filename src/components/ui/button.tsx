import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline";

const styles: Record<Variant, string> = {
  primary:
    "bg-brand-amber text-white shadow-soft hover:bg-brand-amber-hover hover:shadow-lift active:translate-y-px",
  outline:
    "border border-line bg-card text-ink hover:border-brand-amber hover:text-brand-amber"
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={`rounded-control px-6 py-3 font-semibold transition-all duration-200 ${styles[variant]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = "Button";
