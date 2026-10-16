/**
 * Media kinds (image / GIF / video) and the X category strings each one maps to.
 *
 * An upload's media_category and the content_state MEDIA entity's media_category
 * both follow the media kind, and the kind follows the MIME type. The two must pair
 * up, because X looks an article's media up under the media type its DraftTweet*
 * category implies. Observed 2026-10: a video uploaded as amplify_video (media key
 * type 13) and referenced as DraftTweetVideo came back in the article's media_entities
 * as an ApiMedia id keyed by type 7 (tweet_video) with no media_id or media_info, so
 * the article editor showed an endless spinner. Hence video uploads use tweet_video.
 */
import type { DraftMediaCategory, MediaKind, UploadMediaCategory } from './types.js';

/** INIT media_category per kind. */
export const UPLOAD_CATEGORY_BY_KIND: Record<MediaKind, UploadMediaCategory> = {
  image: 'tweet_image',
  gif: 'tweet_gif',
  video: 'tweet_video',
};

/** media_items[].media_category per kind inside content_state. */
export const DRAFT_CATEGORY_BY_KIND: Record<MediaKind, DraftMediaCategory> = {
  image: 'DraftTweetImage',
  gif: 'DraftTweetGif',
  video: 'DraftTweetVideo',
};

/** X's GIF upload limit (tweet_gif). Images are capped at 5MB; video limits depend on the account. */
export const MAX_X_GIF_BYTES = 15_728_640;

/** Classifies a MIME type. Anything that is neither a GIF nor a video is treated as an image. */
export function mediaKindFromMime(mime: string): MediaKind {
  const m = mime.trim().toLowerCase();
  if (m === 'image/gif') return 'gif';
  if (m.startsWith('video/')) return 'video';
  return 'image';
}
