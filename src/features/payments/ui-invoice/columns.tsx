// columns.tsx
"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Checkbox } from "@/components/ui/checkbox"

export type InvoiceUI = {
  idx: number
  serviceAddress: string
  seasonal_2nd: boolean
  monthly: string
  hasSeasonalService: boolean  // Added to indicate if seasonal service is available
}

export type InvoiceTableMeta = {
  clientLocked: boolean
  toggleSeasonal: (idx: number, next: boolean) => void
}

export function createColumns(): ColumnDef<InvoiceUI, unknown>[] {

  return [
    {
      accessorKey: "serviceAddress",
      header: "Service Address",
    },
    {
      id: "trash",
      header: "Weekly Service",
      size: 80,
      enableSorting: false,
      enableColumnFilter: false,
      cell: () => (
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked disabled className="opacity-100" />
            Trash Valet
          </label>
        </div>
      ),
      meta: { columnClassName: "w-24 text-center" },
    },
    {
      id: "services",
      header: "Additional Services",
      cell: ({ row, table }) => {
        const meta = table.options.meta as InvoiceTableMeta | undefined
        const locked = !!meta?.clientLocked
        const { idx, seasonal_2nd, hasSeasonalService } = row.original

        if (!hasSeasonalService) {
          return (
            <div className="text-sm text-muted-foreground">
              No seasonal service available
            </div>
          )
        }

        return (
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={seasonal_2nd}
                disabled={locked}
                onCheckedChange={(v) => meta?.toggleSeasonal?.(idx, Boolean(v))}
              />
              2nd Day Valet
            </label>
          </div>
        )
      },
    },
    {
      accessorKey: "monthly",
      header: "Price/month",
      cell: ({ getValue }) => (
        <span className="ml-auto block text-left">{String(getValue())}</span>
      ),
    },
  ]
}