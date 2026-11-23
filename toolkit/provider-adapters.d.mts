import type { ToolkitOptions } from "@sdlcai/event-toolkit";

type Services = NonNullable<ToolkitOptions["services"]>;
export function createSmtpSender(options: {
  url: string;
  from: string;
}): Promise<NonNullable<Services["sendMail"]>>;
export function createTurnstileVerifier(options: {
  secret: string;
  publicOrigin: string | (() => string | undefined);
}): NonNullable<Services["verifyChallenge"]>;
