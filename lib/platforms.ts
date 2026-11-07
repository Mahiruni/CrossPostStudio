export const socialPlatforms = [
  { id: "facebook", name: "Facebook", color: "#1877f2", formats: ["video", "image", "text"], connection: "meta" },
  { id: "instagram", name: "Instagram", color: "#e4405f", formats: ["video", "image"], connection: "meta" },
  { id: "linkedin", name: "LinkedIn", color: "#0a66c2", formats: ["video", "image", "text"], connection: "linkedin" },
  { id: "tiktok", name: "TikTok", color: "#111111", formats: ["video"], connection: "tiktok" },
  { id: "youtube", name: "YouTube", color: "#ff0033", formats: ["video"], connection: "google" },
] as const;

export type SocialPlatform = (typeof socialPlatforms)[number]["id"];
export type SocialFormat = (typeof socialPlatforms)[number]["formats"][number];

export function supportsFormat(platform: SocialPlatform, format: SocialFormat) {
  return socialPlatforms.find((item) => item.id === platform)?.formats.includes(format as never) ?? false;
}
