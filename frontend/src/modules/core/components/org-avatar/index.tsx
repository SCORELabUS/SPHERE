import { useMemo } from 'react';

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

  if (avatar) {
    return (
      <div className={`relative shrink-0 overflow-hidden ${radius} ${className}`} style={{ width: size, height: size }}>
        <img
          src={avatar}
          alt={name}
          className="h-full w-full object-cover"
        />
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
