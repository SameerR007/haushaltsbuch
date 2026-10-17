import { randomUUID } from "node:crypto";

/** Browser key holding the server run the saved chat belongs to. */
export const CHAT_BOOT_STORAGE_KEY = "haushaltsbuch.chat-boot";

const globalBoot = globalThis as typeof globalThis & { __haushaltsbuchBootId?: string };

/**
 * One id per server process. Kept on globalThis so dev reloads of this module keep the same id;
 * only stopping and starting the server makes a new one, which empties the chat.
 */
export function serverBootId(): string {
  globalBoot.__haushaltsbuchBootId ??= randomUUID();
  return globalBoot.__haushaltsbuchBootId;
}
