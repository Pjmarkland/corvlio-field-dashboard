import {
  getGetAdminBusinessQueryKey,
  getGetAdminOverviewQueryKey,
  useUpdateAdminFirstClientChecklistItem,
  type AdminFirstClientChecklistItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatAdminDate, SectionHeading } from "./AdminShared";

export default function FirstClientChecklistSection({
  businessId,
  items,
}: {
  businessId: number;
  items: AdminFirstClientChecklistItem[];
}) {
  const queryClient = useQueryClient();
  const mutation = useUpdateAdminFirstClientChecklistItem();
  const completedCount = items.filter((item) => item.completed).length;

  return (
    <section className="mb-8" data-testid="section-first-client-checklist">
      <SectionHeading
        eyebrow="First-client operations"
        title="First-client checklist"
        detail={`${completedCount} of ${items.length} steps complete. Each change is timestamped and recorded in the admin audit log.`}
      />
      <div className="admin-panel divide-y divide-[#e1e6df] rounded-2xl px-4 sm:px-5">
        {items.map((item) => (
          <label
            key={item.key}
            className="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm text-[#30443a]"
            data-testid={`checklist-item-${item.key}`}
          >
            <input
              type="checkbox"
              checked={item.completed}
              disabled={mutation.isPending}
              onChange={(event) => mutation.mutate({
                businessId,
                itemKey: item.key,
                data: { completed: event.target.checked },
              }, {
                onSuccess: () => {
                  void queryClient.invalidateQueries({ queryKey: getGetAdminBusinessQueryKey(businessId) });
                  void queryClient.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() });
                },
              })}
              className="h-4 w-4 shrink-0 accent-[#244d3f]"
              data-testid={`checkbox-${item.key}`}
            />
            <span className="min-w-0 flex-1">{item.label}</span>
            <span className="text-right text-xs text-[#77847b]">
              {item.completed ? `Completed ${formatAdminDate(item.completedAt)}` : "Not complete"}
            </span>
          </label>
        ))}
      </div>
      {mutation.isError ? (
        <p role="alert" className="mt-2 text-xs text-[#a3432d]">
          Checklist update failed. The saved checklist has not changed.
        </p>
      ) : null}
    </section>
  );
}
