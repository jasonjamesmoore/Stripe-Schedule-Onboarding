import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { cn } from "@/lib/utils"


type ProgressColor = "primary" | "success" | "warning" | "info" | "destructive"

const INDICATOR_COLORS: Record<ProgressColor, string> = {
  primary: "bg-primary",
  success: "bg-emerald-600",
  warning: "bg-amber-500",
  info: "bg-sky-600",
  destructive: "bg-destructive",
}

type ProgressProps =
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    /** Semantic color for the filled bar */
    color?: ProgressColor
    /** Extra classes for the outer track */
    trackClassName?: string
    /** Extra classes for the inner indicator/bar */
    indicatorClassName?: string
  }

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(function Progress(
  { className, trackClassName, indicatorClassName, color = "primary", value = 0, ...props },
  ref
) {
  return (
    <ProgressPrimitive.Root
    ref={ref}
      data-slot="progress"
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        trackClassName,
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("bg-primary h-full w-full flex-1 transition-all", 
          INDICATOR_COLORS[color], 
          indicatorClassName
        )}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
})
