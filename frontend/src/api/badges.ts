// Badges endpoint (plan: achievements-badges). Mirrors
// backend/app/schemas/badge.py. Participation/self-reported only — `earned`
// never implies honesty verification, see the backend module docstring.

import { request } from "./client";

export interface BadgeRead {
  code: string;
  title: string;
  description: string;
  icon: string;
  earned: boolean;
  earned_at: string | null;
}

export function getBadges(): Promise<BadgeRead[]> {
  return request<BadgeRead[]>("/badges");
}
