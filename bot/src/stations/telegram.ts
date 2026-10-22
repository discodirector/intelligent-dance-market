// Telegram for the stations pipeline (docs/STATIONS.md "Automatic pipeline"): notifications to the owner's chat and
// the owner's commands by long polling. Bot API over fetch, no library. Commands are accepted ONLY from
// TELEGRAM_CHAT_ID (anything else is ignored, and never answered). Messages are plain text (no parse_mode, so nothing
// in them is markup), control characters stripped, cut to MAX_TEXT. The token is only ever part of the request URL,
// never logged: errors are reported without the URL.

export const MAX_TEXT = 3500;

/** Plain text a chat can show: no control characters but newlines and tabs, at most `max` characters. */
export function clean(text: string, max = MAX_TEXT): string {
  const s = String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type Command =
  | { cmd: "status" | "balance" | "help" }
  | { cmd: "live" | "hold" | "reject"; key: string };

/** A message's command; null for anything else (plain text, unknown commands, a bad key). */
export function parseCommand(text: string): Command | null {
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(String(text).trim());
  if (!m) return null;
  const [, cmd, arg] = m;
  if (cmd === "status" || cmd === "balance" || cmd === "help" || cmd === "start") return arg ? null : { cmd: cmd === "start" ? "help" : cmd };
  if (cmd === "live" || cmd === "hold" || cmd === "reject") return arg && /^[a-z0-9][a-z0-9-]{0,39}$/.test(arg) ? { cmd, key: arg } : null;
  return null;
}

export interface Update { update_id: number; message?: { chat?: { id?: number | string }; from?: { id?: number }; text?: string } }

/** The commands in a batch of updates that come from the owner's chat (string compare: ids can exceed 2^53). */
export function ownerCommands(updates: Update[], chatId: string): { updateId: number; command: Command | null; text: string }[] {
  return updates
    .filter((u) => u.message && String(u.message.chat?.id) === String(chatId) && typeof u.message.text === "string")
    .map((u) => ({ updateId: u.update_id, command: parseCommand(u.message!.text!), text: u.message!.text! }));
}

export interface Telegram {
  enabled: boolean;
  send(text: string): Promise<void>;
  /** Long poll (timeout seconds): the next updates after `offset`. */
  updates(offset: number, timeoutSec: number): Promise<Update[]>;
}

/** The Bot API client; disabled (logs only) without a token and a chat id. `fetchFn` for tests. */
export function telegram(token: string | undefined, chatId: string | undefined, log: (line: string) => void, fetchFn: typeof fetch = fetch): Telegram {
  const enabled = !!token && !!chatId;
  const call = async (method: string, body: unknown, timeoutMs: number) => {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
    // The description is Telegram's, never the URL (which holds the token).
    if (!j.ok) throw new Error(`telegram ${method}: ${res.status} ${clean(j.description ?? "", 200)}`);
    return j.result;
  };
  return {
    enabled,
    async send(text) {
      const t = clean(text);
      log(`notify: ${t.split("\n")[0]}`);
      if (!enabled) return;
      try {
        await call("sendMessage", { chat_id: chatId, text: t, disable_web_page_preview: true }, 15_000);
      } catch (e) {
        log(`notify failed: ${(e as Error).message}`);
      }
    },
    async updates(offset, timeoutSec) {
      if (!enabled) return [];
      return (await call("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message"] }, (timeoutSec + 15) * 1000)) as Update[];
    },
  };
}
