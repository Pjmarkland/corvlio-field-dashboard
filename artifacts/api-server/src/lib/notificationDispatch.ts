import { logger } from "./logger";

const activeChannels = new Map<string, { running: Promise<void>; requested: boolean }>();

function runChannel(channel: { name: string; deliver: () => Promise<void> }): Promise<void> {
  const active = activeChannels.get(channel.name);
  if (active) {
    active.requested = true;
    return active.running;
  }
  const state = { requested: false, running: Promise.resolve() };
  state.running = Promise.resolve().then(async () => {
    try {
      do {
        state.requested = false;
        try {
          await channel.deliver();
        } catch (error) {
          logger.error({
            channel: channel.name,
            error: error instanceof Error ? error.message : "Unknown delivery error",
          }, "Notification channel failed; other channels continue independently");
        }
      } while (state.requested);
    } finally {
      // Clear synchronously with the loop ending, not in a later microtask that
      // could absorb a new request after the final requested check.
      activeChannels.delete(channel.name);
    }
  });
  activeChannels.set(channel.name, state);
  return state.running;
}

/** Coalesce each channel separately: slow email must not delay a new lead's push. */
export async function dispatchNotificationChannels(
  channels: Array<{ name: string; deliver: () => Promise<void> }>,
): Promise<void> {
  await Promise.allSettled(channels.map(runChannel));
}
