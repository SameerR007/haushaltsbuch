"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NEW_CHAT_CONFIRM } from "@/lib/chat/copy";
import { CHAT_CHANGED_EVENT, needsNewChatConfirm, readStoredChat, requestNewChat, showNewChatButton } from "@/lib/chat/persist";
import { SiteNav } from "@/components/site-nav";

export function TrackerHeader() {
  const pathname = usePathname();
  const chat = pathname === "/chat";
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!chat) return;
    const sync = () => setShowNew(showNewChatButton(readStoredChat()));
    sync();
    window.addEventListener(CHAT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CHAT_CHANGED_EVENT, sync);
  }, [chat]);

  return (
    <header className="tracker-header">
      <Link className="tracker-brand" href="/">
        Haushaltsbuch
      </Link>
      <div className="tracker-header-side">
        {chat && showNew ? (
          <button
            type="button"
            className="tracker-new-chat"
            onClick={() => {
              const stored = readStoredChat();
              if (needsNewChatConfirm(stored) && !window.confirm(NEW_CHAT_CONFIRM)) return;
              requestNewChat();
            }}
          >
            New chat
          </button>
        ) : null}
        <SiteNav />
      </div>
    </header>
  );
}
