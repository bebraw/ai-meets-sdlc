import { type SpeakerWorkspaceContent } from "./canonical-content.ts";

export type SocialField =
  | "website"
  | "linkedin"
  | "x"
  | "github"
  | "devto"
  | "scholar";

export interface SpeakerAccessRow {
  access_generation: number;
  invite_expires_at: string;
  speaker_id: string;
}

export interface SpeakerSessionRow extends SpeakerAccessRow {
  expires_at: string;
  token_hash: string;
}

export interface SpeakerMagicLinkRow {
  access_generation: number;
  speaker_id: string;
}

type SpeakerDinnerAttendance = "attending" | "not_attending";

type SpeakerDinnerMealPreference =
  | ""
  | "omnivore"
  | "vegetarian"
  | "vegan"
  | "other";

type SpeakerDinnerCrossContamination = "" | "yes" | "no" | "unsure";

export interface SpeakerDinnerResponseData {
  attendance: SpeakerDinnerAttendance;
  cross_contamination: SpeakerDinnerCrossContamination;
  food_requirements: string;
  meal_preference: SpeakerDinnerMealPreference;
}

export interface SpeakerDinnerRow {
  consent_text: string | null;
  expires_at: string;
  responded_at: string | null;
  response_ciphertext: string | null;
  response_iv: string | null;
  speaker_id: string;
  updated_at: string;
}

type SpeakerPresentationDeliveryMethod = "advance_materials" | "own_laptop";

type SpeakerPresentationMaterialFormat = "" | "pdf" | "powerpoint" | "web";

export interface SpeakerPresentationResponseData {
  delivery_method: SpeakerPresentationDeliveryMethod;
  material_format: SpeakerPresentationMaterialFormat;
  material_url: string;
}

export interface SpeakerPresentationRow {
  expires_at: string;
  responded_at: string;
  response_ciphertext: string;
  response_iv: string;
  speaker_id: string;
  updated_at: string;
}

export interface SpeakerLoginContactRow extends SpeakerAccessRow {
  delivery_status: "active" | "suppressed";
  email_ciphertext: string;
  email_iv: string;
  retention_until: string;
}

export interface SpeakerRevisionRow {
  base_content_hash: string;
  base_content_version: number;
  content_json: string;
  revision_id: string;
  state: "approved" | "draft" | "rejected" | "submitted";
  submitted_at: string | null;
  updated_at: string;
}

export interface SpeakerContactRow {
  delivery_status: "active" | "suppressed";
  email_ciphertext: string;
  email_confirmed_at: string | null;
  email_iv: string;
  operational_email_enabled: number;
  promotion_email_enabled: number;
  retention_until: string;
  speaker_id: string;
  updated_at: string;
}

export interface SpeakerAdminAccessRow {
  invite_expires_at: string;
  last_sent_at: string | null;
  revoked_at: string | null;
  speaker_id: string;
}

export interface SpeakerAdminRevisionRow extends SpeakerRevisionRow {
  review_note: string | null;
  reviewed_at: string | null;
  speaker_id: string;
}

export type SpeakerEmailCategory = "operational" | "promotion";

export interface SpeakerAnnouncementInput {
  category: SpeakerEmailCategory;
  speakerIds: string[];
  subject: string;
  textBody: string;
}

export interface SpeakerAnnouncementRecipient {
  email: string;
  name: string;
  speakerId: string;
}

export interface SpeakerEmailCampaignRow {
  campaign_id: string;
  category: SpeakerEmailCategory;
  completed_at: string | null;
  created_at: string;
  failed_count: number;
  html_body: string;
  recipient_count: number;
  sent_count: number;
  status: "failed" | "partial" | "sending" | "sent";
  subject: string;
  text_body: string;
}

export interface ValidationResult {
  content?: SpeakerWorkspaceContent;
  errors: Record<string, string>;
}
