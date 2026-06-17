import React from "react";

interface AvatarProps {
  src?: string | null;
  nick: string | null;
  /** Rendered pixel size (width = height). */
  size?: number;
  /** Highlights the ring, e.g. for "about to play". */
  active?: boolean;
  className?: string;
}

function initial(nick: string | null): string {
  const trimmed = nick?.trim();
  return trimmed ? Array.from(trimmed)[0]!.toUpperCase() : "?";
}

/**
 * Circular player avatar. Renders the image when `src` is set, otherwise a
 * brass-on-dark initial. Falls back to the initial if the image fails to load
 * (e.g. a default `/images/*.png` that hasn't been added yet) — never a broken
 * image.
 */
export function Avatar({ src, nick, size = 40, active = false, className }: AvatarProps) {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImage = Boolean(src) && !failed;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  return (
    <span
      className={["avatar", active ? "avatar--active" : "", className ?? ""].filter(Boolean).join(" ")}
      style={style}
    >
      {showImage ? (
        <img
          className="avatar__img"
          src={src!}
          alt={`${nick ?? "玩家"} 的头像`}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="avatar__fallback" aria-hidden="true">
          {initial(nick)}
        </span>
      )}
    </span>
  );
}
