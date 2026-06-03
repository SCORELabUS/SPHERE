import { generateSlug } from '../../utils/generate-slug';

interface SlugPreviewProps {
  value: string;
}

export default function SlugPreview({ value }: SlugPreviewProps) {
  const slug = generateSlug(value);

  if (!value.trim()) return null;

  return (
    <p className="text-xs text-tp-steel mt-1">
      Slug: <span className="font-mono text-tp-ink">{slug}</span>
    </p>
  );
}
