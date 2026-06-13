import { CreateCollectionFormFieldProps } from "../create-collection-form";

export default function CollectionDescriptionInput({value, onChange}: CreateCollectionFormFieldProps){  
  return (
      <textarea
        placeholder="Description of this collection"
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={5}
        className="w-full rounded-md border border-tp-input-border bg-tp-input-bg px-3 py-2 text-sm text-tp-ink outline-none focus:border-tp-primary focus:ring-1 focus:ring-tp-primary/20 dark:focus:ring-tp-primary/20"
      />
  );
}