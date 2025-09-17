import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        // Improved visual style: subtle gradient, border, and shadow
        "rounded-md border border-border/40 shadow-sm",
        // Softer background that adapts to theme
        "bg-gradient-to-br from-muted/60 to-muted/30 dark:from-muted/30 dark:to-muted/20",
        // Respect reduced motion while keeping a pleasant shimmer effect
        "motion-safe:animate-pulse",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }