/**
 * Says that two pricing texts compared line by line were formatted differently
 * and are shown in one format (`textsToCompare`), so their lines no longer match
 * the files as written.
 */
export default function FormatNote({ first, second }: { first: string; second: string }) {
  return (
    <p className="text-xs text-tp-steel">
      {first} and {second} are formatted differently (quotes, line breaks or comments). Both are shown in one format, so
      only what changes in the pricing is marked.
    </p>
  );
}
