import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline";

const styles: Record<Variant, string> = {
  primary: "bg-amber-600 text-white hover:bg-amber-500",
  outline: "border border-slate-600 text-slate-200 hover:border-amber-500"
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", className = "", ...props }, ref) => (
    <button
      ref={ref}
      className={`rounded-lg px-6 py-3 font-medium transition-colors ${styles[variant]} ${className}`}
      {...props}
    />
  )
);
Button.displayName = "Button";
