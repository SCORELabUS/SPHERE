import { useEffect, useMemo, useState } from 'react';

interface OrgAvatarProps {
  name: string;
  avatar?: string | null;
  avatarBgColor?: string;
  avatarFgColor?: string;
  isPersonal?: boolean;
  size?: number;
  square?: boolean;
  className?: string;
}

function getInitials(name: string): string {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const svgCache: Record<string, string> = {};

const API_BASE = import.meta.env.VITE_API_URL.replace('/api/v1', '');

/**
 * Turns whatever the API stored into a URL this page can actually load.
 *
 * The API builds absolute URLs out of its own `SERVER_HOST`, which is not
 * always an origin the browser can reach: in local development it names a port
 * the API need not be listening on, and the request fails outright. Everything
 * under `/static` is served from this page's own origin in every environment —
 * Vite proxies it in development, nginx proxies it to the API in production —
 * so the path is kept and the host it was stamped with is dropped. Anything
 * else (a data URI, or a genuinely external image) is left alone.
 */
function resolveAvatarUrl(avatar: string): string {
  if (avatar.startsWith('data:') || avatar.startsWith('blob:')) return avatar;
  try {
    const { pathname } = new URL(avatar, window.location.origin);
    return pathname.startsWith('/static/') ? `${API_BASE}${pathname}` : avatar;
  } catch {
    return avatar;
  }
}

/**
 * Loads a predefined avatar and paints it in the requested colour.
 *
 * The files are drawn with `currentColor`, so one file covers every colour the
 * picker offers; the substitution happens here rather than in CSS because the
 * result is used as an `<img>` source. Results are cached by file and colour —
 * a list of organizations would otherwise refetch the same handful of files for
 * every row.
 */
async function loadSvgWithColor(url: string, color: string): Promise<string> {
  const cacheKey = `${url}:${color}`;
  if (svgCache[cacheKey]) return svgCache[cacheKey];

  try {
    const response = await fetch(url);
    const text = (await response.text()).replace(/currentColor/g, color);
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(text)}`;
    svgCache[cacheKey] = dataUri;
    return dataUri;
  } catch {
    return '';
  }
}

export default function OrgAvatar({
  name,
  avatar,
  avatarBgColor,
  avatarFgColor,
  size = 32,
  square = false,
  className = '',
}: OrgAvatarProps) {
  const initials = useMemo(() => getInitials(name), [name]);
  const bgColor = avatarBgColor || '#023e8a';
  const fgColor = avatarFgColor || '#ffffff';
  const radius = square ? 'rounded-sm' : 'rounded-full';

  const isSvg = avatar?.includes('.svg') ?? false;
  const [svgDataUri, setSvgDataUri] = useState('');

  useEffect(() => {
    if (!isSvg || !avatar) {
      setSvgDataUri('');
      return;
    }
    let isCurrent = true;
    loadSvgWithColor(resolveAvatarUrl(avatar), fgColor).then(uri => {
      if (isCurrent) setSvgDataUri(uri);
    });
    // A colour change while the fetch is in flight would otherwise land after
    // the newer one and repaint the old colour.
    return () => {
      isCurrent = false;
    };
  }, [isSvg, avatar, fgColor]);

  if (avatar && isSvg) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden ${radius} ${className}`}
        style={{ width: size, height: size, backgroundColor: bgColor }}
      >
        {svgDataUri && (
          <img src={svgDataUri} alt={name} className="h-[60%] w-[60%] object-contain" />
        )}
      </div>
    );
  }

  if (avatar) {
    return (
      <div
        className={`relative shrink-0 overflow-hidden ${radius} ${className}`}
        style={{ width: size, height: size }}
      >
        <img src={resolveAvatarUrl(avatar)} alt={name} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden ${radius} font-semibold ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: bgColor,
        color: fgColor,
        fontSize: size * 0.38,
      }}
    >
      {initials}
    </div>
  );
}
