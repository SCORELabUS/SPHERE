import { useId } from 'react';
import { MAX_DESCRIPTION_LENGTH, MAX_TITLE_LENGTH } from '../../utils/pull-request-state';

/**
 * The title and description of a pull request. Both are shown as plain text to
 * whoever sees the pull request.
 */
export default function ProposalFields({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
}: {
  title: string;
  description: string;
  onTitleChange: (title: string) => void;
  onDescriptionChange: (description: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${id}-title`} className="mb-1 block text-sm font-medium text-tp-slate">
          Title
        </label>
        <input
          id={`${id}-title`}
          type="text"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          placeholder="What does this proposal change?"
          onChange={event => onTitleChange(event.target.value)}
          className="w-full rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none focus:border-tp-primary"
        />
      </div>
      <div>
        <label htmlFor={`${id}-description`} className="mb-1 block text-sm font-medium text-tp-slate">
          Description (optional)
        </label>
        <textarea
          id={`${id}-description`}
          value={description}
          maxLength={MAX_DESCRIPTION_LENGTH}
          rows={3}
          placeholder="Why these changes, and anything a maintainer should check."
          onChange={event => onDescriptionChange(event.target.value)}
          className="w-full resize-y rounded-lg border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none focus:border-tp-primary"
        />
      </div>
    </div>
  );
}
