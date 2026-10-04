import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Controls answer on the press. One primary per view at most; everything else is quiet.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-[background-color,border-color,color,transform] duration-100 ease-out active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink shadow-raised hover:bg-focus",
        quiet: "border border-rule-2 bg-paper-3 text-ink-2 shadow-raised hover:border-muted hover:text-ink",
        ghost: "text-ink-2 hover:bg-paper-4 hover:text-ink",
        outline: "border border-accent-dim text-accent hover:bg-accent hover:text-accent-ink",
      },
      size: { sm: "h-6 px-2 text-xs", md: "h-7 px-2.5 text-sm", lg: "h-8 px-3 text-md" },
    },
    defaultVariants: { variant: "quiet", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
