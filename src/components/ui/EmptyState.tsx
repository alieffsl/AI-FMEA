import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-steel-200 bg-white px-6 py-20 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-accent-500">
        {icon ?? <Inbox size={24} />}
      </div>
      <h3 className="mt-5 text-lg font-semibold text-steel-900">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-steel-500">{description}</p>
      {action ? <div className="mt-7">{action}</div> : null}
    </div>
  );
}
