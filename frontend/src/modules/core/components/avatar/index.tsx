import { useState, useEffect } from 'react';
import { useAuth } from '../../../auth/hooks/useAuth';

const API_BASE = (import.meta.env.VITE_API_URL).replace('/api/v1', '');

const svgCache: Record<string, string> = {};

async function loadSvgWithColor(file: string, color: string): Promise<string> {
  const cacheKey = `${file}:${color}`;
  if (svgCache[cacheKey]) return svgCache[cacheKey];

  try {
    const res = await fetch(`${API_BASE}/static/avatars/users/default/${file}`);
    let text = await res.text();
    text = text.replace(/currentColor/g, color);
    const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(text)}`;
    svgCache[cacheKey] = dataUri;
    return dataUri;
  } catch {
    return '';
  }
}

function resolveAvatarUrl(avatar: string): string {
  if (!avatar) return '';
  if (avatar.startsWith('http') || avatar.startsWith('data:') || avatar.startsWith('blob:')) return avatar;
  if (avatar.startsWith('/')) return `${API_BASE}${avatar}`;
  return `${API_BASE}/${avatar}`;
}

interface Props {
  w?: number | string;
  h?: number | string;
}

export default function Avatar({ w = 32, h = 32 }: Props) {
  const { authUser } = useAuth();
  const user = authUser.user;

  const avatar = user?.avatar || '';
  const bg = user?.settings?.avatarBgColor || '#fa520f';
  const fg = user?.settings?.avatarFgColor || '#ffffff';
  const firstName = user?.firstName || '';
  const lastName = user?.lastName || '';
  const isSvg = avatar.includes('.svg');
  const isUploaded = avatar && !isSvg;

  const initials = `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase() || '?';

  const [svgDataUri, setSvgDataUri] = useState<string>('');

  useEffect(() => {
    if (!isSvg || !avatar) return;

    const file = avatar.split('/').pop() || '';
    if (!file) return;

    loadSvgWithColor(file, fg).then(setSvgDataUri);
  }, [isSvg, avatar, fg]);

  const style: React.CSSProperties = { width: w, height: h };

  if (isUploaded) {
    const src = resolveAvatarUrl(avatar);
    return (
      <img
        src={src}
        alt={firstName || 'User'}
        className="shrink-0 overflow-hidden rounded-full object-cover"
        style={style}
      />
    );
  }

  if (isSvg && svgDataUri) {
    return (
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-full"
        style={{ ...style, backgroundColor: bg }}
      >
        <img src={svgDataUri} alt="" className="h-[60%] w-[60%] object-contain" />
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold"
      style={{ ...style, backgroundColor: bg, color: fg, fontSize: Math.min(Number(w), Number(h)) * 0.4 }}
    >
      {initials}
    </div>
  );
}
