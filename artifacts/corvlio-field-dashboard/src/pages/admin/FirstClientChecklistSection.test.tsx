import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  getGetAdminBusinessQueryKey: (businessId: number) => ["admin-business", businessId],
  getGetAdminOverviewQueryKey: () => ["admin-overview"],
  useUpdateAdminFirstClientChecklistItem: () => ({
    mutate: mocks.mutate,
    isPending: false,
    isError: false,
  }),
}));

import FirstClientChecklistSection from "./FirstClientChecklistSection";

const items: Parameters<typeof FirstClientChecklistSection>[0]["items"] = [
  { key: "business_details_reviewed", label: "Business details reviewed", completed: true, completedAt: "2026-11-01T12:00:00.000Z" },
  { key: "plan_assigned", label: "Plan assigned", completed: false, completedAt: null },
];

function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidation = vi.spyOn(client, "invalidateQueries");
  const result = render(
    <QueryClientProvider client={client}>
      <FirstClientChecklistSection businessId={52} items={items} />
    </QueryClientProvider>,
  );
  return { ...result, invalidation };
}

describe("FirstClientChecklistSection", () => {
  beforeEach(() => mocks.mutate.mockReset());

  it("shows progress and persists a completion before refreshing the list and detail", () => {
    const { invalidation } = view();
    expect(screen.getByText(/1 of 2 steps complete/)).toBeTruthy();
    expect(screen.getByText(/Completed/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("checkbox-plan_assigned"));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { businessId: 52, itemKey: "plan_assigned", data: { completed: true } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    mocks.mutate.mock.calls[0][1].onSuccess();
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["admin-business", 52] });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["admin-overview"] });
  });
});
