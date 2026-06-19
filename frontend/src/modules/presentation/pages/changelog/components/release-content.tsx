import type { ReactNode } from 'react';

interface ReleaseContentProps {
  description: string;
  children?: ReactNode;
}

export default function ReleaseContent({ description, children }: ReleaseContentProps) {
  return (
    <td className="mx-auto rounded-xl border border-tp-hairline bg-tp-canvas p-6">
      <div className="grid grid-cols-10">
        <div className="col-span-3 pr-16">
          <p className="text-lg leading-8 text-tp-ink-tint">{description}</p>
        </div>
        <div className="col-span-7 max-h-[420px] space-y-8 overflow-y-auto">{children}</div>
      </div>
    </td>
  );
}
