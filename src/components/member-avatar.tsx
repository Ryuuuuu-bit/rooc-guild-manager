"use client";

import Image from "next/image";
import { useState } from "react";

const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

interface CommonProps {
  /** The member's stored Discord avatar URL (already includes the correct
   * .gif extension for animated avatars — see discordAvatarUrl in
   * src/lib/discord.ts / normalizeMember in bot/sync.ts). Null falls back
   * to Discord's default avatar immediately, no failed request needed. */
  src: string | null;
  alt: string;
  className?: string;
}

interface FixedSizeProps extends CommonProps {
  width: number;
  height: number;
  fill?: false;
}

interface FillProps extends CommonProps {
  fill: true;
  sizes: string;
}

/**
 * Member avatar `<Image>` with a built-in broken-image fallback. Discord's
 * CDN occasionally fails to serve a *specific* avatar on a given page load
 * (transient hiccup, or just a much larger payload for an animated GIF
 * avatar competing with dozens of other images loading at once on a busy
 * page like the party board) even though the URL itself is correctly
 * built — previously that showed the browser's ugly broken-image icon.
 * `onError` here swaps to Discord's default avatar instead, so a one-off
 * CDN failure degrades gracefully rather than looking broken.
 */
export function MemberAvatar(props: FixedSizeProps | FillProps) {
  const [errored, setErrored] = useState(false);
  const src = errored || !props.src ? DEFAULT_AVATAR : props.src;
  const onError = () => setErrored(true);

  if (props.fill) {
    return (
      <Image
        src={src}
        alt={props.alt}
        fill
        unoptimized
        sizes={props.sizes}
        className={props.className}
        onError={onError}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={props.alt}
      width={props.width}
      height={props.height}
      unoptimized
      className={props.className}
      onError={onError}
    />
  );
}
