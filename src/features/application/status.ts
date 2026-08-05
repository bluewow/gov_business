import type { ApplicationStatus } from "@/db/schema";

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  SAVED: "담아둠",
  REVIEWED: "검토 완료",
  WRITING: "작성 중",
  SUBMITTED: "제출 완료",
  ARCHIVED: "보관",
};

export const STATUS_ORDER: ApplicationStatus[] = [
  "SAVED",
  "REVIEWED",
  "WRITING",
  "SUBMITTED",
  "ARCHIVED",
];
