
import { useState } from 'react';

import Iconify from '../../../../core/components/iconify';
import type { Change } from '../types';

interface ReleaseChangesProps {
  name: string;
  changes: Change[];
}

export default function ReleaseChanges({ name, changes }: ReleaseChangesProps) {

  const [isExpanded, setIsExpanded] = useState(false)

  const handleOnToggle = () => setIsExpanded(open => !open)

  return (
    <details className="p-4 rounded-xl border border-tp-hairline bg-tp-canvas" open={isExpanded} onToggle={handleOnToggle}>
      <summary className="cursor-pointer text-lg font-normal text-tp-ink marker:content-none">
        <span className="text-tp-ink-tint">{name}</span>{' '}
        <span className="text-tp-muted">({changes.length})</span>
        <Iconify icon={isExpanded ? 'mdi:chevron-down' : 'mdi:chevron-right'} width={14} />

      </summary>

      <ul className="list-disc marker:text-tp-primary overflow-hidden mt-4 space-y-3 pl-5">
        {changes.map(change => (
          <li key={change.id} className="text-base leading-7 text-tp-steel">
            {change.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
