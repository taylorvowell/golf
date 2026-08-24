import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { ProfileResponse } from "@swingsage/schema/contract";

import { api } from "../../platform/client";
import { primeProfile } from "./useProfile";

/**
 * The profile photo's two verbs — change and remove — kept out of the surface that offers them.
 *
 * The picker crops ON THE PHONE (`allowsEditing`, square) so what the golfer frames is exactly
 * what every surface renders, and the crop is then DOWNSCALED on the phone too: the picker's
 * output keeps the camera's full resolution, so without this a 12 MP square rides the wire to
 * become 512px on the server. What uploads is a ~100 KB JPEG. The server still re-encodes
 * (EXIF strip, exact 512² cover, sharp-or-415) — the client pass is bandwidth, the server pass
 * is trust, and neither replaces the other.
 *
 * Both verbs answer with the whole profile, which is primed into the profile cache — every
 * mounted `Avatar` redraws from the same confirmation the server stored, no refetch.
 */

export type PhotoOutcome = "done" | "cancelled" | "denied" | "failed";

/** Matches the server's stored size — sending more is bandwidth the resize throws away. */
const UPLOAD_PX = 512;

/**
 * The picked image, shrunk to upload size on the phone. Falls back to the original on any
 * manipulation failure: the server resizes anyway and its body cap holds, so a shrink that
 * broke must cost bytes, never the photo.
 */
async function shrinkForUpload(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  if (asset.width > 0 && asset.width <= UPLOAD_PX) return asset.uri;
  const context = ImageManipulator.manipulate(asset.uri);
  try {
    // Width only — height follows the aspect ratio, so a crop the platform picker skipped
    // (some Android skins ignore `allowsEditing`) is not distorted; the server squares it.
    context.resize({ width: UPLOAD_PX });
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
      return saved.uri;
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}

export async function changeProfilePhoto(): Promise<PhotoOutcome> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return "denied";

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      allowsEditing: true,
      aspect: [1, 1],
      // Near-lossless out of the picker: the server re-encodes once more, and stacking two
      // aggressive JPEG passes is how a face gets visibly muddy at 512px.
      quality: 0.92,
    });
    if (result.canceled) return "cancelled";
    const asset = result.assets[0];
    if (!asset) return "cancelled";

    let uploadUri = asset.uri;
    try {
      uploadUri = await shrinkForUpload(asset);
    } catch (err) {
      console.error("avatar shrink failed; uploading the original:", err);
    }

    const { url, headers } = await api.uploadTarget("api/v1/profile/avatar", {
      // Always JPEG after the shrink; the fallback original keeps whatever the picker said.
      "Content-Type": uploadUri === asset.uri ? (asset.mimeType ?? "image/jpeg") : "image/jpeg",
    });
    const res = await FileSystem.uploadAsync(url, uploadUri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers,
    });
    if (res.status < 200 || res.status >= 300) {
      console.error(`avatar upload refused ${res.status}: ${res.body?.slice(0, 200)}`);
      return "failed";
    }
    primeProfile(JSON.parse(res.body) as ProfileResponse);
    return "done";
  } catch (err) {
    console.error("avatar upload failed:", err);
    return "failed";
  }
}

/** Back to the default face. True when the server confirmed. */
export async function removeProfilePhoto(): Promise<boolean> {
  try {
    const confirmed = await api.request<ProfileResponse>("profile/avatar", { method: "DELETE" });
    primeProfile(confirmed);
    return true;
  } catch {
    return false;
  }
}
