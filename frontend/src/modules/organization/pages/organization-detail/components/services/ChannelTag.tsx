import { channelStyle } from './interfaces';

/** The short tag of an interface's channel, as in Helena's tree: Int, Prog, Conv, Agent, Event. */
export default function ChannelTag({
  channel,
  full = false,
}: {
  channel: string | null;
  full?: boolean;
}) {
  const style = channelStyle(channel);
  return (
    <span
      title={style.label}
      className={`inline-flex min-w-[2.6rem] shrink-0 justify-center rounded-full px-1.5 py-0.5 font-sans text-[10px] font-semibold ${style.className}`}
    >
      {full ? style.label : style.tag}
    </span>
  );
}
