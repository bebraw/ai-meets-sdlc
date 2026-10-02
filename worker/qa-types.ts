export type QaRole = "attendee" | "moderator" | "mc" | "admin";
export type QaRoomStatus = "open" | "paused" | "archived";
export type QaQuestionStatus =
  | "pending"
  | "approved"
  | "active"
  | "answered"
  | "hidden";
export type QaView =
  | "attendee"
  | "moderator"
  | "mc"
  | "present"
  | "screen"
  | "admin";

export interface QaActor {
  role: QaRole;
  id: string;
  participantKey: string;
}
export interface QaQuestion {
  id: string;
  text: string;
  status: QaQuestionStatus;
  createdAt: string;
  revision: number;
  votes: number;
  own: boolean;
  voted: boolean;
}
export interface QaSnapshot {
  revision: number;
  status: QaRoomStatus;
  activeQuestionId: string | null;
  questions: QaQuestion[];
}
export interface QaCommand {
  action: string;
  questionId: string;
  text: string;
  requestId: string;
  revision: number;
  expectedActiveId: string;
  status: string;
  confirmation: string;
}
export interface QaResult {
  ok: boolean;
  changed: boolean;
  message: string;
  status: number;
}
export interface QaRoomRecord {
  id: string;
  title: string;
  object_name: string;
  position: number;
}
export interface QaSettings {
  active_room_id: string | null;
  revision: number;
}
export interface QaGrant {
  id: string;
  label: string;
  role: "moderator" | "mc";
  created_at: string;
  revoked_at: string | null;
  link: string | null;
}
export interface QaPageData {
  view: QaView;
  room: QaRoomRecord | null;
  snapshot: QaSnapshot | null;
  settings: QaSettings;
  rooms: (QaRoomRecord & { snapshot: QaSnapshot })[];
  grants: QaGrant[];
  notice: string;
  draft: string;
  role: QaRole;
}
