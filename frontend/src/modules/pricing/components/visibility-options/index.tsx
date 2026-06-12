interface VisibilityOptionsProps {
  value: string;
  onChange: (value: string) => void;
}

export default function VisibilityOptions({ value, onChange }: VisibilityOptionsProps){
  return (
    <fieldset className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="radio"
          name="visibility"
          value="Public"
          checked={value === 'Public'}
          onChange={(e) => onChange(e.target.value)}
          className="h-4 w-4 cursor-pointer"
        />
        Public
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="radio"
          name="visibility"
          value="Private"
          checked={value === 'Private'}
          onChange={(e) => onChange(e.target.value)}
          className="h-4 w-4 cursor-pointer"
        />
        Private
      </label>
    </fieldset>
  );
};
