import "@tanstack/react-table";

declare module "@tanstack/react-table" {
  
  interface TableMeta {
    clientLocked: boolean;
    toggleSeasonal: (idx: number, next: boolean) => void;
  }
}