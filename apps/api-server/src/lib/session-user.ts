/**
 * Map a users row to the public SessionUser DTO (signed photo URL).
 */
import type { User } from "@workspace/db";
import type { SessionUser } from "@workspace/api-zod";
import { signUploadUrl } from "./file-tokens";

export function toSessionUser(u: User): SessionUser {
  return {
    id: u.id,
    phone: u.phone,
    role: u.role,
    full_name: u.full_name,
    preferred_language: u.preferred_language,
    state_id: u.state_id ?? null,
    city_id: u.city_id ?? null,
    photo_url: signUploadUrl(u.photo_url ?? null),
    gallery_visibility_opt_in: u.gallery_visibility_opt_in === true,
  };
}
