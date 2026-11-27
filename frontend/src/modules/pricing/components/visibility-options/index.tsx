interface VisibilityOptionsProps {
  value: string;
  onChange: (value: string) => void;
  /** The choices offered, in order. Collections only have Public and Private. */
  options?: readonly string[];
  /** A line of help under each choice. */
  descriptions?: Partial<Record<string, string>>;
  name?: string;
}

export default function VisibilityOptions({
  value,
  onChange,
  options = ['Public', 'Private'],
  descriptions,
  name = 'visibility',
}: VisibilityOptionsProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      {options.map(option => (
        <label key={option} className="flex cursor-pointer items-start gap-2 text-sm text-tp-ink">
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
          />
          <span>
            <span className="block">{option}</span>
            {descriptions?.[option] && (
              <span className="mt-0.5 block text-xs text-tp-steel">{descriptions[option]}</span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
