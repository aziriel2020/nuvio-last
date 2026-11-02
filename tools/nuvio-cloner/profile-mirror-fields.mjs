// Explicit allowlist for the profile row: target identity must remain untouched.
// The destination retains its name, avatar_id, avatar_url and avatar_color_hex.
const ALLOWED_APPEARANCE_FIELDS=['profile_background_id','profile_background_url'];
export function createMirrorProfileUpdate(sourceProfile={}) {
  const patch=Object.fromEntries(ALLOWED_APPEARANCE_FIELDS
    .filter(key=>Object.hasOwn(sourceProfile,key))
    .map(key=>[key,sourceProfile[key]]));
  // Prevent the target from inheriting different addons/plugins from its own primary profile.
  patch.uses_primary_addons=false;
  patch.uses_primary_plugins=false;
  return patch;
}
