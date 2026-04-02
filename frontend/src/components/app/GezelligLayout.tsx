import type { ReactNode } from "react";

interface GezelligLayoutProps {
  children: ReactNode;
}

export function GezelligLayout({ children }: GezelligLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="text-gezellig-500">Gezellig</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Je Nederlandse taalleraar — Your Dutch Language Tutor
        </p>
      </header>
      <main className="w-full max-w-4xl">{children}</main>
    </div>
  );
}
