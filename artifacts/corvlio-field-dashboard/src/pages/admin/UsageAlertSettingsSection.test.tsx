import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  settings: {
    dailyTotalCallMinutes: 500,
    monthlyTotalCallMinutes: 8000,
    dailyPerBusinessCallMinutes: 120,
    monthlyPerBusinessCallMinutes: 1500,
    dailyProvisionedNumbers: 3,
    monthlyProvisionedNumbers: 20,
    updatedAt: null,
  },
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  getGetAdminUsageAlertSettingsQueryKey: () => ["usage-alert-settings"],
  useGetAdminUsageAlertSettings: () => ({ data: mocks.settings, isLoading: false, isError: false }),
  useUpdateAdminUsageAlertSettings: () => ({
    mutate: mocks.mutate,
    isPending: false,
    isError: false,
  }),
}));

import UsageAlertSettingsSection from "./UsageAlertSettingsSection";

function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidation = vi.spyOn(client, "invalidateQueries");
  const result = render(
    <QueryClientProvider client={client}>
      <UsageAlertSettingsSection />
    </QueryClientProvider>,
  );
  return { ...result, invalidation };
}

describe("UsageAlertSettingsSection", () => {
  beforeEach(() => mocks.mutate.mockReset());

  it("loads thresholds, saves changes, and leaves plan rules advisory", () => {
    const { invalidation } = view();
    expect((screen.getByTestId("input-usage-dailyTotalCallMinutes") as HTMLInputElement).value).toBe("500");
    expect(screen.getByText(/80% and 100%/)).toBeTruthy();
    expect(screen.getByText(/They are advisory only/)).toBeTruthy();

    fireEvent.change(screen.getByTestId("input-usage-dailyTotalCallMinutes"), {
      target: { value: "900" },
    });
    fireEvent.click(screen.getByTestId("button-save-usage-alerts"));
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        data: {
          dailyTotalCallMinutes: 900,
          monthlyTotalCallMinutes: 8000,
          dailyPerBusinessCallMinutes: 120,
          monthlyPerBusinessCallMinutes: 1500,
          dailyProvisionedNumbers: 3,
          monthlyProvisionedNumbers: 20,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    act(() => mocks.mutate.mock.calls[0][1].onSuccess());
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["usage-alert-settings"] });
    expect(screen.getByText("Thresholds saved")).toBeTruthy();
  });
});
