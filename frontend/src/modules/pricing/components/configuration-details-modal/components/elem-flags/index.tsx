import { v4 as uuidv4 } from 'uuid';

export default function FlagGrid({ data }: Readonly<{ data: string[] }>) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-evenly gap-2">
      {data.map((item) => (
        <div
          key={uuidv4()}
          className="rounded-md border border-tp-primary px-5 py-2 text-tp-ink transition-all duration-300 hover:cursor-pointer hover:bg-tp-primary hover:font-bold hover:text-white"
        >
          {item}
        </div>
      ))}
    </div>
  );
}
