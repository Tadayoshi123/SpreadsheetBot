import type { APIInteractionGuildMember, GuildMember } from "discord.js";
import { trackIdsForGuild } from "./config.js";
import type { AppConfig } from "./types.js";

function roleIdsOf(
  member: GuildMember | APIInteractionGuildMember
): string[] {
  const maybeGuildMember = member as GuildMember;
  if (maybeGuildMember.roles?.cache) {
    return [...maybeGuildMember.roles.cache.keys()];
  }
  return [...(member as APIInteractionGuildMember).roles];
}

/** True if the member has at least one of the allowed role IDs. */
export function memberHasAnyRole(
  member: GuildMember | APIInteractionGuildMember | null,
  allowedRoleIds: readonly string[]
): boolean {
  if (!member || allowedRoleIds.length === 0) return false;
  const ids = new Set(roleIdsOf(member));
  return allowedRoleIds.some((r) => ids.has(r));
}

/**
 * Track-level ACL: if the track defines allowedRoleIds, those are used;
 * otherwise the global DISCORD_ALLOWED_ROLE_IDS list applies.
 */
export function memberCanUseTrack(
  member: GuildMember | APIInteractionGuildMember | null,
  globalAllowedRoleIds: readonly string[],
  trackAllowedRoleIds: readonly string[]
): boolean {
  const effective =
    trackAllowedRoleIds.length > 0
      ? trackAllowedRoleIds
      : globalAllowedRoleIds;
  if (effective.length === 0) return false;
  return memberHasAnyRole(member, effective);
}

/** Track IDs on this guild that the member may use for add/edit (from tracks.json allowedRoleIds). */
export function memberAllowedTrackIds(
  cfg: AppConfig,
  guildId: string,
  member: GuildMember | APIInteractionGuildMember | null
): string[] {
  return trackIdsForGuild(cfg, guildId).filter((id) => {
    const track = cfg.tracks.get(id);
    if (!track) return false;
    return memberCanUseTrack(member, cfg.allowedRoleIds, track.allowedRoleIds);
  });
}
