import { generateSlug } from '../../utils/generate-slug';

interface SlugPreviewProps {
  value: string;
}

export default function SlugPreview({ value }: SlugPreviewProps) {
  const slug = generateSlug(value);

  return (
    <p className="text-xs text-tp-steel">
      Slug: <span className="font-mono text-tp-ink">{slug}</span>
    </p>
  );
}
