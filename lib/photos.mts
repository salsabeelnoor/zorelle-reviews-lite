import { MAX_PHOTO_BYTES, MAX_PHOTOS } from "./contract.mts";
import { assertNoUserErrors, gql, ShopifyError, type UserError } from "./shopify.mts";

const STAGE_UPLOADS = `#graphql
  mutation StageReviewPhotos($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;

const CREATE_FILES = `#graphql
  mutation CreateReviewFiles($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus }
      userErrors { field message code }
    }
  }`;

const FILE_STATUS = `#graphql
  query ReviewFileStatus($ids: [ID!]!) {
    nodes(ids: $ids) { ... on MediaImage { id fileStatus } }
  }`;

const DELETE_FILES = `#graphql
  mutation DeleteReviewFiles($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) { userErrors { field message } }
  }`;

/** Accepted types, checked by file signature (not the declared type). */
const TYPES: Record<string, { extension: string; matches: (bytes: Uint8Array) => boolean }> = {
  "image/jpeg": { extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { extension: "png", matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": { extension: "webp", matches: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
};

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

export interface Photo {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
  extension: string;
}

export class PhotoError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Validates uploaded photos by count, size and file signature. */
export async function readPhotos(files: File[]): Promise<Photo[]> {
  const present = files.filter((file) => file.size > 0);
  if (present.length > MAX_PHOTOS) throw new PhotoError(`You can add up to ${MAX_PHOTOS} photos.`);
  const photos: Photo[] = [];
  for (const file of present) {
    if (file.size > MAX_PHOTO_BYTES) throw new PhotoError("Each photo must be 5 MB or smaller.", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entry = Object.entries(TYPES).find(([, type]) => type.matches(bytes));
    if (!entry) throw new PhotoError("Photos must be JPG, PNG or WebP images.");
    photos.push({ bytes, mimeType: entry[0], extension: entry[1].extension });
  }
  return photos;
}

/** Uploads photos to Shopify Files and returns their MediaImage GIDs in order. */
export async function uploadPhotos(photos: Photo[], alt: string): Promise<string[]> {
  if (!photos.length) return [];
  const stamp = Date.now();
  const names = photos.map((photo, index) => `review-${stamp}-${index + 1}.${photo.extension}`);

  const staged = await gql<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: UserError[];
    };
  }>(STAGE_UPLOADS, {
    input: photos.map((photo, index) => ({
      filename: names[index],
      mimeType: photo.mimeType,
      httpMethod: "POST",
      resource: "IMAGE",
      fileSize: String(photo.bytes.byteLength),
    })),
  });
  assertNoUserErrors("Preparing photo upload", staged.stagedUploadsCreate.userErrors);
  const targets = staged.stagedUploadsCreate.stagedTargets;

  await Promise.all(
    targets.map(async (target, index) => {
      const form = new FormData();
      for (const { name, value } of target.parameters) form.append(name, value);
      form.append("file", new Blob([photos[index].bytes], { type: photos[index].mimeType }), names[index]);
      const response = await fetch(target.url, { method: "POST", body: form });
      if (!response.ok) throw new ShopifyError(`Photo upload failed with HTTP ${response.status}`);
    }),
  );

  const created = await gql<{
    fileCreate: { files: { id: string; fileStatus: string }[] | null; userErrors: UserError[] };
  }>(CREATE_FILES, {
    files: targets.map((target) => ({ originalSource: target.resourceUrl, contentType: "IMAGE", alt })),
  });
  assertNoUserErrors("Saving photos", created.fileCreate.userErrors);
  const ids = (created.fileCreate.files ?? []).map((file) => file.id);

  try {
    await waitForProcessing(ids);
  } catch (error) {
    await deleteFiles(ids);
    throw error;
  }
  return ids;
}

/** Polls for up to ~4 seconds; throws if Shopify rejects an image, otherwise continues. */
async function waitForProcessing(ids: string[]) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const data = await gql<{ nodes: ({ id: string; fileStatus: string } | null)[] }>(FILE_STATUS, { ids });
    const statuses = data.nodes.map((node) => node?.fileStatus);
    if (statuses.includes("FAILED")) throw new PhotoError("One of the photos could not be processed. Please try another image.");
    if (statuses.every((status) => status === "READY")) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Best-effort cleanup of uploaded files when a submission fails. */
export async function deleteFiles(ids: string[]) {
  if (!ids.length) return;
  try {
    await gql(DELETE_FILES, { fileIds: ids });
  } catch (error) {
    console.error("Could not delete review photos:", error);
  }
}
