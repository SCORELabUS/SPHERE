import ReleaseChanges from "./release-changes";
import { Change } from "../types";

interface ReleaseSectionProps {
  name: string | null;
  features: Change[];
  fixes: Change[];
}

export default function ReleaseSection({ name, features, fixes }: ReleaseSectionProps) {
  if (features.length + fixes.length === 0) return null;

  return (
    <section className="space-y-4">
      {name && <h3 className="text-xl font-medium text-tp-ink">{name}</h3>}
      <ReleaseChanges name="Features" changes={features} />
      <ReleaseChanges name="Fixes" changes={fixes} />
    </section>
  );
}
