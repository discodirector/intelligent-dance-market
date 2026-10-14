// bot/post: DRY_RUN (default) writes out/queue/<ts>/{video.mp4,caption.txt,facts.json}; otherwise posts to X.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPost, credsFromEnv, hasCreds, uploadVideo } from "./x.ts";
import type { Facts } from "../lib/facts.ts";

export const isDryRun = () => (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

export interface PostInput {
  caption: string;
  captionSource: string;
  facts: Facts;
  video: string; // primary (1080x1080)
  extraVideos?: string[];
}

export interface PostResult { mode: "dry-run" | "x"; dir: string; postId?: string }

export async function publish(p: PostInput, outRoot = process.env.OUT_DIR ?? "out"): Promise<PostResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = resolve(join(outRoot, "queue", `${stamp}_${p.facts.kind}`));
  mkdirSync(dir, { recursive: true });
  copyFileSync(p.video, join(dir, "video.mp4"));
  for (const v of p.extraVideos ?? []) copyFileSync(v, join(dir, v.split("/").pop()!));
  writeFileSync(join(dir, "caption.txt"), p.caption + "\n");
  writeFileSync(join(dir, "facts.json"), JSON.stringify(p.facts, null, 2) + "\n");

  const dry = isDryRun();
  const meta: Record<string, unknown> = { createdAt: new Date().toISOString(), dryRun: dry, captionSource: p.captionSource };
  let postId: string | undefined;
  if (!dry) {
    const creds = credsFromEnv();
    if (!hasCreds(creds)) throw new Error("DRY_RUN=false but X credentials are missing");
    const media = await uploadVideo(creds, p.video);
    postId = (await createPost(creds, p.caption, media)).id;
    meta.postId = postId;
    meta.mediaId = media;
  }
  writeFileSync(join(dir, "post.json"), JSON.stringify(meta, null, 2) + "\n");
  return { mode: dry ? "dry-run" : "x", dir, postId };
}
