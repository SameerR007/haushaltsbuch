"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { assistantHomeLabel, readConnection, type AssistantSettings } from "@/lib/connection";

export function WelcomeAssistant() {
  const [assistant, setAssistant] = useState<AssistantSettings | null>(null);

  useEffect(() => {
    setAssistant(readConnection()?.assistant ?? null);
  }, []);

  if (!assistant) return null;
  const label = assistantHomeLabel(assistant);
  return (
    <div className="assistant-home returning-only" data-testid="welcome-assistant">
      {assistant.type === "endpoint" ? (
        <>
          <p className="assistant-home-label">Assistant:</p>
          <p className="assistant-home-value">{label}</p>
        </>
      ) : (
        <p className="assistant-home-inline">
          <span className="assistant-home-label">Assistant:</span> <strong>{label}</strong>
          {assistant.type === "openai" ? (
            <>
              {" "}
              <Link href="/data/assistant">Change assistant</Link>
            </>
          ) : null}
        </p>
      )}
      {assistant.type !== "openai" ? (
        <p>
          <Link href="/data/assistant">Change assistant</Link>
        </p>
      ) : null}
    </div>
  );
}
